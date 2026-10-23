// Adresse secrète de connexion à l'application (aucun lien ne l'affiche sur le site)
const LOGIN_PATH = '/' + String(process.env.APP_LOGIN_PATH || 'applicationlogin').replace(/^\/+|\/+$/g, '');

function requireAuth(req, res, next) {
  if (req.session.user) return next();
  if (req.xhr || req.path.startsWith('/api')) return res.status(401).json({ error: 'Session expirée, reconnectez-vous.' });
  // Appareil déjà utilisé par la patronne ou la gérante (session expirée) : retour à la connexion
  if (/(?:^|;\s*)aliica_app=1(?:;|$)/.test(req.headers.cookie || '')) {
    if (req.method === 'GET') req.session.retour = req.originalUrl;
    return res.redirect(LOGIN_PATH);
  }
  // Inconnu : l'application est invisible (page introuvable), l'adresse de connexion n'est jamais révélée
  return res.status(404).render('shop/404', { titre: 'Page introuvable' });
}

/** Réservé à la propriétaire (bénéfices, marges, dépenses, stats financières, utilisateurs) */
function requireProprietaire(req, res, next) {
  if (req.session.user && req.session.user.role === 'proprietaire') return next();
  if (req.xhr || req.path.startsWith('/api')) return res.status(403).json({ error: 'Accès réservé à la propriétaire.' });
  return res.status(403).render('admin/interdit', { titre: 'Accès réservé', page: '' });
}

function estProprietaire(req) {
  return !!(req.session.user && req.session.user.role === 'proprietaire');
}

module.exports = { requireAuth, requireProprietaire, estProprietaire, LOGIN_PATH };
