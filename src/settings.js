const db = require('./db');

const DEFAUTS = {
  nom_boutique: 'ALIICA BOUTIQUE',
  bandeau_texte: 'Avec le code promo : ALIICA2025 vous avez -10% sur votre première commande !',
  bandeau_lien_texte: 'Faites un achat',
  bandeau_actif: '1',
  description_footer: "Aliica boutique vous offre des vêtements élégants et accessoires de qualité pour affirmer votre style avec confiance. Sublimez votre allure avec des pièces soigneusement conçues pour chaque occasion.",
  telephone: '(+225) 01 41 75 65 26',
  whatsapp: '2250141756526',
  email: '',
  adresse: 'Abidjan, Côte d\'Ivoire',
  horaires_semaine: 'Lundi – Vendredi : 09 h – 18 h 00',
  horaires_weekend: 'Samedi  09 h – 12 h',
  facebook: 'https://facebook.com/',
  instagram: 'https://instagram.com/',
  tiktok: '',
  newsletter_titre: 'NE MANQUEZ RIEN !',
  newsletter_texte: "Abonnez-vous à notre newsletter et recevez en exclusivité nos dernières collections, offres spéciales et conseils mode. Soyez le premier à découvrir l'élégance Aliica boutique !",
  copyright: '© Aliica Holding SARL.',
  logo_image_id: '',
  frais_livraison: '0',
  livraison_texte: 'Livraison à Abidjan sous 24 à 48 h. Paiement à la livraison ou par Mobile Money.',
  modes_paiement_site: 'Paiement à la livraison,Orange Money,MTN Money,Wave,Moov Money',
  couleur_accent: '#000000',
};

let cache = null, cacheAt = 0;

async function getAll(force) {
  if (!force && cache && Date.now() - cacheAt < 30000) return cache;
  const rows = await db.all('SELECT cle, valeur FROM parametres');
  const s = { ...DEFAUTS };
  rows.forEach((r) => { s[r.cle] = r.valeur ?? ''; });
  cache = s; cacheAt = Date.now();
  return s;
}
async function set(obj) {
  for (const [k, v] of Object.entries(obj)) {
    await db.query('INSERT INTO parametres (cle, valeur) VALUES ($1,$2) ON CONFLICT (cle) DO UPDATE SET valeur=EXCLUDED.valeur', [k, v == null ? '' : String(v)]);
  }
  cache = null;
}
function invalidate() { cache = null; }

module.exports = { getAll, set, invalidate, DEFAUTS };
