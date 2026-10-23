/**
 * Règles de sécurité — avis Render d'octobre 2026
 * (compromission des certificats intermédiaires eMudhra + correctifs Node.js du 21/10/2026 :
 *  contournement de la vérification du nom d'hôte TLS, faille de décompression Brotli).
 */

// Versions minimales corrigées, par version majeure (avis Render / Node.js)
const VERSIONS_CORRIGEES = { 22: '22.23.4', 24: '24.22.1', 26: '26.12.1' };

function comparer(a, b) {
  const pa = a.split('.').map(Number); const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i += 1) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
  return 0;
}

/** Renvoie null si la version de Node.js est corrigée, sinon un message d'explication */
function problemeVersionNode(version = process.versions.node) {
  const majeure = Number(version.split('.')[0]);
  if (majeure < 22) return `Node.js ${version} est en fin de vie et n'a pas reçu les correctifs du 21/10/2026.`;
  if (majeure % 2 === 1) return `Node.js ${version} n'est pas une version LTS : utilisez Node.js 24.22.1 ou plus (24.x).`;
  const min = VERSIONS_CORRIGEES[majeure];
  if (min && comparer(version, min) < 0) return `Node.js ${version} est vulnérable : passez au minimum à ${min}.`;
  return null;
}

/** Vérifications au démarrage. En production, l'application refuse de démarrer si une règle n'est pas respectée. */
function verifierDemarrage(tls) {
  const prod = process.env.NODE_ENV === 'production';
  const erreurs = [];

  const pbNode = problemeVersionNode();
  if (pbNode && process.env.AUTORISER_NODE_NON_CORRIGE !== 'true') erreurs.push(pbNode);

  // L'option --use-bundled-ca ferait de nouveau confiance au magasin intégré à un Node.js non corrigé
  if (/--use-bundled-ca/.test(process.env.NODE_OPTIONS || '')) erreurs.push('Retirez --use-bundled-ca de NODE_OPTIONS.');

  // Désactivation globale de la vérification TLS : interdite
  if (process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0') erreurs.push('NODE_TLS_REJECT_UNAUTHORIZED=0 désactive toute vérification des certificats : supprimez cette variable.');

  const secret = process.env.SESSION_SECRET || '';
  if (prod && (secret.length < 32 || secret === 'aliica-secret-a-changer')) erreurs.push('SESSION_SECRET doit être une valeur aléatoire d\'au moins 32 caractères.');

  if (tls && !tls.reseauPrive && !tls.ssl) erreurs.push(`La base ${tls.hote} est joignable par Internet sans TLS (DATABASE_SSL=false) : interdit.`);

  if (process.env.DATABASE_SSL_NO_VERIFY === 'true') {
    const msg = 'DATABASE_SSL_NO_VERIFY=true : le certificat de la base de données n\'est pas vérifié.';
    if (prod) erreurs.push(`${msg} Utilisez l'URL interne Render ou fournissez DATABASE_SSL_CA.`);
    else console.warn(`⚠️  ${msg}`);
  }

  if (erreurs.length) {
    const texte = `\n⛔ Règles de sécurité non respectées :\n - ${erreurs.join('\n - ')}\n`;
    if (prod) { console.error(texte); process.exit(1); }
    console.warn(texte.replace('⛔', '⚠️ ') + '   (toléré hors production)\n');
  }
}

/** En-têtes HTTP de sécurité (sans dépendance supplémentaire) */
function entetes(req, res, next) {
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('X-Frame-Options', 'SAMEORIGIN');
  res.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  res.set('Cross-Origin-Opener-Policy', 'same-origin');
  if (process.env.NODE_ENV === 'production') res.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
}

/**
 * Refuse les corps de requête compressés (gzip, deflate, br…) :
 * le serveur ne décompresse jamais de données envoyées par un client (faille Brotli).
 */
function refuserCorpsCompresses(req, res, next) {
  const enc = String(req.headers['content-encoding'] || 'identity').toLowerCase().trim();
  if (enc !== 'identity' && enc !== '') return res.status(415).send('Content-Encoding non accepté');
  return next();
}

module.exports = { verifierDemarrage, problemeVersionNode, entetes, refuserCorpsCompresses, VERSIONS_CORRIGEES };
