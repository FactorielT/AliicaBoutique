const db = require('./db');
let sharp = null;
try { sharp = require('sharp'); } catch (e) { /* sharp optionnel */ }

function slugify(s) {
  return String(s || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'item';
}

async function uniqueSlug(table, base, excludeId) {
  let slug = slugify(base), i = 1;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const r = await db.one(`SELECT id FROM ${table} WHERE slug=$1 AND ($2::int IS NULL OR id<>$2)`, [slug, excludeId || null]);
    if (!r) return slug;
    i += 1; slug = `${slugify(base)}-${i}`;
  }
}

function fcfa(n) {
  const v = Math.round(Number(n) || 0);
  return v.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.') + ' CFA';
}
function nombre(n) {
  return Math.round(Number(n) || 0).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}
function dateFr(d, withTime) {
  if (!d) return '';
  const dt = new Date(d);
  const opts = { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: process.env.TZ || 'Africa/Abidjan' };
  if (withTime) Object.assign(opts, { hour: '2-digit', minute: '2-digit' });
  return dt.toLocaleString('fr-FR', opts);
}
function dateLongue(d) {
  return new Date(d || Date.now()).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: process.env.TZ || 'Africa/Abidjan' });
}
function int(v, def = 0) {
  const n = parseInt(String(v ?? '').replace(/[\s.]/g, ''), 10);
  return Number.isFinite(n) ? n : def;
}

/** Enregistre une image (buffer) en base, redimensionnée en WebP si sharp est disponible */
async function saveImage(buffer, mime, maxWidth = 1400, client) {
  let data = buffer, type = mime || 'image/jpeg';
  if (sharp) {
    try {
      data = await sharp(buffer).rotate().resize({ width: maxWidth, withoutEnlargement: true }).webp({ quality: 82 }).toBuffer();
      type = 'image/webp';
    } catch (e) { /* on garde l'original */ }
  }
  const q = client || db;
  const r = await q.query('INSERT INTO images (mime, data) VALUES ($1,$2) RETURNING id', [type, data]);
  return r.rows[0].id;
}

async function numero(prefix, table) {
  const d = new Date();
  const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  const r = await db.one(`SELECT COUNT(*)::int AS n FROM ${table} WHERE numero LIKE $1`, [`${prefix}${ymd}%`]);
  return `${prefix}${ymd}-${String(r.n + 1).padStart(3, '0')}${Math.random().toString(36).slice(2, 4).toUpperCase()}`;
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
/** Texte simple → HTML (paragraphes, **gras**, listes "- ") pour les pages éditées par la patronne */
function texteEnHtml(t) {
  const blocs = String(t || '').replace(/\r/g, '').split(/\n{2,}/);
  return blocs.map((b) => {
    const lignes = b.split('\n');
    const fmt = (l) => escapeHtml(l).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    if (lignes.every((l) => /^\s*[-•]\s+/.test(l))) {
      return '<ul>' + lignes.map((l) => `<li>${fmt(l.replace(/^\s*[-•]\s+/, ''))}</li>`).join('') + '</ul>';
    }
    if (/^#\s+/.test(lignes[0])) return `<h3>${fmt(lignes[0].replace(/^#\s+/, ''))}</h3>` + (lignes.length > 1 ? `<p>${lignes.slice(1).map(fmt).join('<br>')}</p>` : '');
    return `<p>${lignes.map(fmt).join('<br>')}</p>`;
  }).join('\n');
}

module.exports = { slugify, uniqueSlug, fcfa, nombre, dateFr, dateLongue, int, saveImage, numero, escapeHtml, texteEnHtml };
