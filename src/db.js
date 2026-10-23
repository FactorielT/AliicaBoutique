const { Pool } = require('pg');

// Les paramètres ssl* éventuellement présents dans l'URL sont retirés : la politique TLS est définie ci-dessous, et nulle part ailleurs.
const brute = process.env.DATABASE_URL || 'postgres://aliica:aliica@localhost:5432/aliica';
const connectionString = brute.replace(/([?&])(sslmode|ssl|sslrootcert|sslcert|sslkey|uselibpqcompat)=[^&]*/gi, '$1').replace(/[?&]+$/, '').replace(/\?&+/, '?');

/**
 * Politique TLS de la base (règles de sécurité d'octobre 2026) :
 *  - URL interne Render (dpg-xxxx-a, réseau privé) : pas de TLS nécessaire, rien ne passe par Internet ;
 *  - base joignable par Internet : TLS OBLIGATOIRE avec vérification complète du certificat ET du nom d'hôte
 *    (magasin de certificats de Node.js corrigé, ou autorité fournie dans DATABASE_SSL_CA) ;
 *  - DATABASE_SSL_NO_VERIFY=true : désactive la vérification — refusé en production (voir src/securite.js).
 */
const hote = (() => { try { return new URL(connectionString).hostname; } catch (e) { return ''; } })();
const reseauPrive = /^(localhost|127\.0\.0\.1|::1)$/.test(hote) || /^dpg-[a-z0-9]+-a$/.test(hote) || !hote.includes('.');
function configSSL() {
  const local = reseauPrive;
  const actif = process.env.DATABASE_SSL === 'true' || (process.env.DATABASE_SSL !== 'false' && !local);
  if (!actif) return false;
  if (process.env.DATABASE_SSL_NO_VERIFY === 'true') return { rejectUnauthorized: false };
  const ssl = { rejectUnauthorized: true, servername: hote };
  if (process.env.DATABASE_SSL_CA) ssl.ca = process.env.DATABASE_SSL_CA.replace(/\\n/g, '\n');
  return ssl;
}

const sslConf = configSSL();
const pool = new Pool({
  connectionString,
  ssl: sslConf,
  max: 10,
  // Fuseau horaire de la boutique pour tous les calculs par jour / mois
  options: `-c TimeZone=${(process.env.TZ || 'Africa/Abidjan').replace(/[^A-Za-z_/+-]/g, '')}`,
});

async function query(text, params) {
  return pool.query(text, params);
}
async function one(text, params) {
  const r = await pool.query(text, params);
  return r.rows[0] || null;
}
async function all(text, params) {
  const r = await pool.query(text, params);
  return r.rows;
}
/** Exécute fn(client) dans une transaction */
async function tx(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const res = await fn(client);
    await client.query('COMMIT');
    return res;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

module.exports = { pool, query, one, all, tx, tls: { hote, reseauPrive, ssl: sslConf } };
