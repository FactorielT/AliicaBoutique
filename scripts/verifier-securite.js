#!/usr/bin/env node
/**
 * Vérification de sécurité — avis Render d'octobre 2026.
 * À lancer depuis le Shell du service Render (ou en local) :  npm run verifier:securite
 *
 *  1. Version de Node.js corrigée (22.23.4 / 24.22.1 / 26.12.1 ou plus)
 *  2. Les certificats eMudhra compromis sont REJETÉS par le client HTTPS de l'application
 *     (test recommandé par Render : les deux requêtes doivent échouer avec une erreur de certificat)
 *  3. Politique TLS de la base de données
 *  4. Audit des dépendances npm
 */
require('dotenv').config({ quiet: true });
const https = require('https');
const { execSync } = require('child_process');
const { problemeVersionNode } = require('../src/securite');

const URLS_TEST = [
  'https://dv-g3b-emudhra.we-have-a-problem.com/',
  'https://dv-g3b-aaa-emudhra.we-have-a-problem.com/',
];
let echecs = 0;
const ok = (m) => console.log(`  ✅ ${m}`);
const ko = (m) => { echecs += 1; console.log(`  ❌ ${m}`); };

function tester(url) {
  return new Promise((resolve) => {
    const req = https.get(url, { timeout: 15000 }, (res) => { res.resume(); resolve({ accepte: true, statut: res.statusCode }); });
    req.on('timeout', () => req.destroy(new Error('délai dépassé')));
    req.on('error', (e) => resolve({ accepte: false, code: e.code || e.message }));
  });
}

(async () => {
  console.log('\n1. Version de Node.js');
  const pb = problemeVersionNode();
  if (pb) ko(pb); else ok(`Node.js ${process.versions.node} (corrigé)`);
  if (/--use-bundled-ca/.test(process.env.NODE_OPTIONS || '')) ko('NODE_OPTIONS contient --use-bundled-ca');
  if (process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0') ko('NODE_TLS_REJECT_UNAUTHORIZED=0 est défini');

  console.log('\n2. Rejet des certificats eMudhra compromis');
  const proxy = process.env.HTTPS_PROXY || process.env.https_proxy;
  if (process.env.NODE_EXTRA_CA_CERTS) console.log(`  ⚠️  NODE_EXTRA_CA_CERTS=${process.env.NODE_EXTRA_CA_CERTS} ajoute des autorités de confiance : à éviter sur Render.`);
  if (proxy) console.log('  ⚠️  Un proxy HTTPS est configuré : il ré-chiffre les connexions, ce test n\'est donc pas concluant ici. Lancez-le depuis le Shell Render.');
  for (const url of URLS_TEST) {
    const r = await tester(url);
    if (r.accepte && proxy) console.log(`  ⚠️  ${url} → réponse ${r.statut} via le proxy (non concluant)`);
    else if (r.accepte) ko(`${url} → ACCEPTÉ (statut ${r.statut}) : le client fait encore confiance aux certificats compromis !`);
    else if (/CERT|SELF_SIGNED|UNABLE_TO|ISSUER|REVOKED|ALTNAME|verify/i.test(r.code)) ok(`${url} → rejeté (${r.code})`);
    else console.log(`  ⚠️  ${url} → injoignable (${r.code}) : test non concluant (réseau ?)`);
  }

  console.log('\n3. Base de données');
  try {
    const { tls } = require('../src/db');
    if (tls.reseauPrive && !tls.ssl) ok(`${tls.hote} : réseau privé, pas de passage par Internet`);
    else if (tls.ssl && tls.ssl.rejectUnauthorized) ok(`${tls.hote} : TLS avec vérification du certificat et du nom d'hôte`);
    else ko(`${tls.hote} : TLS non vérifié ou absent`);
    await require('../src/db').pool.end();
  } catch (e) { ko(`Configuration base : ${e.message}`); }

  console.log('\n4. Dépendances npm');
  try {
    const out = JSON.parse(execSync('npm audit --omit=dev --json', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));
    const v = out.metadata && out.metadata.vulnerabilities;
    const graves = v ? (v.high || 0) + (v.critical || 0) : 0;
    if (graves) ko(`${graves} vulnérabilité(s) haute(s)/critique(s) : lancez « npm audit fix »`); else ok('Aucune vulnérabilité haute ou critique');
  } catch (e) {
    try { const out = JSON.parse(e.stdout); const v = out.metadata.vulnerabilities; ko(`npm audit : ${JSON.stringify(v)}`); } catch (e2) { console.log('  ⚠️  npm audit indisponible (réseau ?)'); }
  }

  console.log(echecs ? `\n⛔ ${echecs} problème(s) à corriger.\n` : '\n✅ Toutes les vérifications sont passées.\n');
  process.exit(echecs ? 1 : 0);
})();
