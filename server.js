require('dotenv').config({ quiet: true });
process.env.TZ = process.env.TZ || 'Africa/Abidjan';

const path = require('path');
const express = require('express');
const session = require('express-session');
const PgSession = require('connect-pg-simple')(session);
const compression = require('compression');
const db = require('./src/db');
const { init } = require('./src/init');
const utils = require('./src/utils');
const securite = require('./src/securite');

// Règles de sécurité (avis Render oct. 2026) : Node.js corrigé, TLS vérifié, secrets solides
securite.verifierDemarrage(db.tls);

const app = express();
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.set('trust proxy', 1);
app.disable('x-powered-by');

app.use(securite.entetes);
app.use(compression()); // compression des réponses uniquement (aucune décompression côté serveur)
// Les corps de requête compressés (gzip/deflate/br) sont refusés : le serveur ne décompresse jamais de données clientes
app.use(securite.refuserCorpsCompresses);
app.use(express.urlencoded({ extended: true, limit: '2mb', inflate: false, parameterLimit: 2000 }));
app.use(express.json({ limit: '2mb', inflate: false }));
app.use('/static', express.static(path.join(__dirname, 'public'), { maxAge: '7d' }));

app.use(session({
  store: new PgSession({ pool: db.pool, tableName: 'session', createTableIfMissing: false }),
  name: 'aliica.sid',
  secret: process.env.SESSION_SECRET || 'aliica-secret-a-changer',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 1000 * 60 * 60 * 24 * 14, sameSite: 'lax', httpOnly: true, secure: process.env.NODE_ENV === 'production' },
}));

// Helpers disponibles dans toutes les vues
app.locals.fcfa = utils.fcfa;
app.locals.nombre = utils.nombre;
app.locals.dateFr = utils.dateFr;
app.locals.dateLongue = utils.dateLongue;
app.locals.texteEnHtml = utils.texteEnHtml;
app.locals.icon = require('./src/icons');
app.locals.imgUrl = (id, fallback = '/static/img/placeholder.svg') => (id ? `/img/${id}` : fallback);

app.use((req, res, next) => {
  res.locals.user = req.session.user || null;
  res.locals.estProprietaire = !!(req.session.user && req.session.user.role === 'proprietaire');
  res.locals.flash = req.session.flash || null;
  delete req.session.flash;
  res.locals.currentPath = req.path;
  next();
});

// Images stockées en base (persistantes même sur Render)
app.get('/img/:id', async (req, res, next) => {
  try {
    const r = await db.one('SELECT mime, data FROM images WHERE id=$1', [utils.int(req.params.id)]);
    if (!r) return res.redirect('/static/img/placeholder.svg');
    res.set('Content-Type', r.mime);
    res.set('Cache-Control', 'public, max-age=31536000, immutable');
    return res.send(r.data);
  } catch (e) { return next(e); }
});

app.get('/healthz', (req, res) => res.send('ok'));

app.use('/gestion', require('./routes/admin'));
app.use('/', require('./routes/shop'));

app.use((req, res) => res.status(404).render('shop/404', { titre: 'Page introuvable' }));
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  const status = err.status || 500;
  if (req.xhr || (req.headers.accept || '').includes('application/json')) return res.status(status).json({ error: err.message });
  res.status(status).send(`<div style="font-family:sans-serif;padding:40px"><h2>Une erreur est survenue</h2><p>${utils.escapeHtml(err.message)}</p><p><a href="javascript:history.back()">← Retour</a></p></div>`);
});

const PORT = process.env.PORT || 3000;
init()
  .then(() => app.listen(PORT, () => console.log(`ALIICA BOUTIQUE en ligne sur ${PORT}`)));
  .catch((e) => { console.error('Erreur au démarrage :', e); process.exit(1); });
