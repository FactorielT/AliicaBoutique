const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../../src/db');
const { requireAuth, LOGIN_PATH } = require('../../src/auth');

const router = express.Router();

const nocache = (req, res, next) => { res.set('Cache-Control', 'no-store'); res.set('X-Robots-Tag', 'noindex, nofollow'); next(); };
router.use(nocache);

// ---------- Connexion (montée sur l'adresse secrète LOGIN_PATH, voir server.js) ----------
const login = express.Router();
login.use(nocache);
const tentatives = new Map();
login.get('/', (req, res) => {
  if (req.session.user) return res.redirect('/gestion');
  return res.render('admin/connexion', { erreur: null, identifiant: '' });
});
login.post('/', async (req, res, next) => {
  try {
    const ip = req.ip; const t = tentatives.get(ip) || { n: 0, at: Date.now() };
    if (Date.now() - t.at > 15 * 60000) { t.n = 0; t.at = Date.now(); }
    if (t.n >= 10) return res.status(429).render('admin/connexion', { erreur: 'Trop de tentatives. Réessayez dans 15 minutes.', identifiant: '' });
    const identifiant = String(req.body.identifiant || '').trim().toLowerCase();
    const u = await db.one('SELECT * FROM utilisateurs WHERE LOWER(identifiant)=$1 AND actif', [identifiant]);
    if (!u || !bcrypt.compareSync(String(req.body.mot_de_passe || ''), u.mot_de_passe)) {
      t.n += 1; tentatives.set(ip, t);
      return res.render('admin/connexion', { erreur: 'Identifiant ou mot de passe incorrect.', identifiant });
    }
    tentatives.delete(ip);
    const retour = req.session.retour || '/gestion';
    return req.session.regenerate((err) => {
      if (err) return next(err);
      req.session.user = { id: u.id, nom: u.nom, role: u.role, identifiant: u.identifiant };
      // Marque cet appareil comme appareil de la boutique (permet de revenir à la connexion si la session expire)
      res.cookie('aliica_app', '1', { maxAge: 1000 * 60 * 60 * 24 * 365, httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production' });
      return req.session.save(() => res.redirect(retour));
    });
  } catch (e) { return next(e); }
});
router.get('/deconnexion', (req, res) => req.session.destroy(() => res.redirect(LOGIN_PATH)));

// ---------- Tout le reste nécessite d'être connecté ----------
router.use(requireAuth);
router.use(async (req, res, next) => {
  try {
    res.locals.nbCommandesNouvelles = (await db.one("SELECT COUNT(*)::int AS n FROM commandes WHERE statut='nouvelle'")).n;
    res.locals.nbAlertes = (await db.one(`SELECT COUNT(*)::int AS n FROM variantes v JOIN produits p ON p.id=v.produit_id
      WHERE p.actif AND v.actif AND v.stock <= p.seuil_alerte`)).n;
    // Re-vérifie que le compte est toujours actif
    const u = await db.one('SELECT id, nom, role, actif FROM utilisateurs WHERE id=$1', [req.session.user.id]);
    if (!u || !u.actif) return req.session.destroy(() => res.redirect(LOGIN_PATH));
    req.session.user.role = u.role; req.session.user.nom = u.nom;
    res.locals.user = req.session.user;
    res.locals.estProprietaire = u.role === 'proprietaire';
    return next();
  } catch (e) { return next(e); }
});

// ---------- Tableau de bord ----------
router.get('/', async (req, res, next) => {
  try {
    const proprio = res.locals.estProprietaire;
    const k = await db.one(`SELECT
      COALESCE(SUM(total) FILTER (WHERE created_at::date = CURRENT_DATE),0)::int AS jour,
      COUNT(*) FILTER (WHERE created_at::date = CURRENT_DATE)::int AS nb_jour,
      COALESCE(SUM(total) FILTER (WHERE created_at::date = CURRENT_DATE - 1),0)::int AS hier,
      COALESCE(SUM(total) FILTER (WHERE date_trunc('month',created_at)=date_trunc('month',NOW())),0)::int AS mois,
      COUNT(*) FILTER (WHERE date_trunc('month',created_at)=date_trunc('month',NOW()))::int AS nb_mois,
      COALESCE(SUM(total) FILTER (WHERE date_trunc('month',created_at)=date_trunc('month',NOW() - interval '1 month')
        AND created_at < NOW() - interval '1 month'),0)::int AS mois_prec_meme_periode,
      COUNT(*) FILTER (WHERE date_trunc('month',created_at)=date_trunc('month',NOW() - interval '1 month')
        AND created_at < NOW() - interval '1 month')::int AS nb_mois_prec
      FROM ventes WHERE statut='payee'`);
    const st = await db.one(`SELECT COALESCE(SUM(v.stock),0)::int AS pieces,
      COUNT(DISTINCT p.id) FILTER (WHERE v.stock > 0)::int AS en_stock, COUNT(DISTINCT p.id)::int AS total
      FROM produits p JOIN variantes v ON v.produit_id=p.id AND v.actif WHERE p.actif`);
    const graph = await db.all(`SELECT to_char(m, 'YYYY-MM') AS mois, COALESCE(SUM(v.total),0)::int AS total
      FROM generate_series(date_trunc('month', NOW()) - interval '11 months', date_trunc('month', NOW()), interval '1 month') m
      LEFT JOIN ventes v ON date_trunc('month', v.created_at)=m AND v.statut='payee' GROUP BY m ORDER BY m`);
    const top = await db.all(`SELECT vl.libelle, SUM(vl.quantite)::int AS qte, SUM(vl.quantite*vl.prix_unitaire)::int AS montant
      FROM vente_lignes vl JOIN ventes v ON v.id=vl.vente_id WHERE v.statut='payee' AND date_trunc('month',v.created_at)=date_trunc('month',NOW())
      GROUP BY vl.libelle ORDER BY qte DESC LIMIT 5`);
    const alertes = await db.all(`SELECT p.id, p.nom, v.taille, v.couleur, v.stock, p.seuil_alerte,
      (SELECT image_id FROM produit_images pi WHERE pi.produit_id=p.id ORDER BY ordre, id LIMIT 1) AS image_id
      FROM variantes v JOIN produits p ON p.id=v.produit_id WHERE p.actif AND v.actif AND v.stock <= p.seuil_alerte ORDER BY v.stock, p.nom LIMIT 8`);
    const dernieres = await db.all(`SELECT v.id, v.numero, v.total, v.created_at, v.mode_paiement, v.source, c.nom AS client
      FROM ventes v LEFT JOIN clients c ON c.id=v.client_id WHERE v.statut='payee' ORDER BY v.created_at DESC LIMIT 6`);
    let fin = null;
    if (proprio) {
      fin = await db.one(`SELECT
        COALESCE((SELECT SUM(vl.quantite*(vl.prix_unitaire - vl.cout_unitaire)) FROM vente_lignes vl JOIN ventes v ON v.id=vl.vente_id
          WHERE v.statut='payee' AND date_trunc('month',v.created_at)=date_trunc('month',NOW())),0)::int AS marge_lignes,
        COALESCE((SELECT SUM(remise) FROM ventes WHERE statut='payee' AND date_trunc('month',created_at)=date_trunc('month',NOW())),0)::int AS remises,
        COALESCE((SELECT SUM(montant) FROM depenses WHERE date_trunc('month',date_depense)=date_trunc('month',NOW())),0)::int AS depenses`);
      fin.marge = fin.marge_lignes - fin.remises;
      fin.benefice = fin.marge - fin.depenses;
    }
    res.render('admin/dashboard', { titre: 'Tableau de bord', page: 'dashboard', k, st, graph, top, alertes, dernieres, fin });
  } catch (e) { next(e); }
});

router.use('/', require('./caisse'));
router.use('/', require('./articles'));
router.use('/', require('./stock'));
router.use('/', require('./contacts'));
router.use('/', require('./rapports'));
router.use('/', require('./site'));
router.use('/', require('./parametres'));

module.exports = router;
module.exports.login = login;
