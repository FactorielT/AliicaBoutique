const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const db = require('./db');
const { saveImage } = require('./utils');

async function migrate() {
  const sql = fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8');
  await db.query(sql);
}

async function seedBase() {
  // Comptes par défaut
  const n = await db.one('SELECT COUNT(*)::int AS n FROM utilisateurs');
  if (n.n === 0) {
    const pwP = process.env.PROPRIETAIRE_PASSWORD || 'Aliica@2025';
    const pwG = process.env.GERANTE_PASSWORD || 'Gerante@2025';
    await db.query('INSERT INTO utilisateurs (nom, identifiant, mot_de_passe, role) VALUES ($1,$2,$3,$4),($5,$6,$7,$8)', [
      'Mme la Propriétaire', 'patronne', bcrypt.hashSync(pwP, 10), 'proprietaire',
      'La Gérante', 'gerante', bcrypt.hashSync(pwG, 10), 'gerante',
    ]);
    console.log('» Comptes créés : patronne / gerante (changez les mots de passe dans Paramètres)');
  }

  const c = await db.one('SELECT COUNT(*)::int AS n FROM categories');
  if (c.n === 0) {
    const cats = [
      ['Chemise', 'chemise', 'homme', 1], ['Ensemble', 'ensemble', 'homme', 2], ['Chaussures homme', 'chaussures-homme', 'homme', 3],
      ['Sac à main', 'sac-a-main', 'femme', 4], ['Chaussure', 'chaussure', 'femme', 5], ['Parfum', 'parfum', 'femme', 6],
    ];
    for (const [nom, slug, genre, ordre] of cats) {
      await db.query('INSERT INTO categories (nom, slug, genre, ordre) VALUES ($1,$2,$3,$4)', [nom, slug, genre, ordre]);
    }
  }

  const p = await db.one('SELECT COUNT(*)::int AS n FROM pages');
  if (p.n === 0) {
    const pages = [
      ['infos-legales', 'Infos légales', "# Éditeur du site\nAliica Holding SARL\nAbidjan, Côte d'Ivoire\n\n# Contact\nTél : (+225) 01 41 75 65 26"],
      ['livraison', 'Livraison', "Nous livrons partout à Abidjan sous 24 à 48 h.\n\n- Abidjan : livraison rapide\n- Intérieur du pays : par compagnie de transport\n\nLes frais de livraison vous sont confirmés par téléphone lors de la validation de votre commande."],
      ['retour-articles', 'Retour articles', "Vous disposez de 48 h après réception pour nous signaler un problème.\n\nLes articles doivent être retournés neufs, non portés et dans leur emballage d'origine."],
      ['paiement', 'Paiement', "Modes de paiement acceptés :\n\n- Paiement à la livraison (espèces)\n- Orange Money, MTN Money, Moov Money, Wave\n- Carte bancaire en boutique"],
    ];
    for (const [slug, titre, contenu] of pages) await db.query('INSERT INTO pages (slug, titre, contenu) VALUES ($1,$2,$3)', [slug, titre, contenu]);
  }

  const cp = await db.one('SELECT COUNT(*)::int AS n FROM codes_promo');
  if (cp.n === 0) await db.query("INSERT INTO codes_promo (code, pourcentage, premiere_commande) VALUES ('ALIICA2025', 10, TRUE)");
}

/** Catalogue de démonstration (premier démarrage uniquement) */
async function seedDemo() {
  const n = await db.one('SELECT COUNT(*)::int AS n FROM produits');
  const s = await db.one('SELECT COUNT(*)::int AS n FROM slides');
  if (n.n > 0 || s.n > 0 || process.env.SEED_DEMO === 'false') return;
  const dir = path.join(__dirname, '..', 'seed-images');
  const img = async (f) => (fs.existsSync(path.join(dir, f)) ? saveImage(fs.readFileSync(path.join(dir, f)), 'image/jpeg') : null);
  const cat = async (slug) => (await db.one('SELECT id FROM categories WHERE slug=$1', [slug])).id;

  const produits = [
    ['Chemise homme', 'chemise', 15000, null, 8000, 'chemise1.jpg', ['M', 'L', 'XL'], 'Aliica'],
    ['Chemise homme bicolore', 'chemise', 15000, null, 8000, 'chemise2.jpg', ['M', 'L', 'XL'], 'Aliica'],
    ['Chemise homme noire', 'chemise', 15000, null, 8000, 'chemise3.jpg', ['M', 'L', 'XL'], 'Aliica'],
    ['Chemise homme imprimée', 'chemise', 15000, null, 8000, 'chemise4.jpg', ['M', 'L', 'XL'], 'Aliica'],
    ['Chemise homme manches courtes', 'chemise', 15000, null, 8000, 'chemise5.jpg', ['M', 'L', 'XL'], 'Aliica'],
    ['Chemise homme en lin', 'chemise', 20000, 17000, 10000, 'lin1.jpg', ['M', 'L', 'XL'], 'Aliica'],
    ['Chemise homme en lin lavande', 'chemise', 17000, null, 9500, 'lin2.jpg', ['M', 'L', 'XL'], 'Aliica'],
    ['Tunique homme en coton', 'ensemble', 45000, 35000, 20000, 'ensemble1.jpg', ['M', 'L', 'XL'], 'Aliica'],
    ['Cherry Temptation EDP 90 ml', 'parfum', 20000, null, 12000, 'parfum1.jpg', [''], 'Zara'],
    ['Peony EDP 90 ml', 'parfum', 20000, null, 12000, 'parfum2.jpg', [''], 'Zara'],
    ['Woman Gold EDP 90 ml', 'parfum', 20000, null, 12000, 'parfum3.jpg', [''], 'Zara'],
    ['Cherry Blush 90 ml', 'parfum', 20000, null, 12000, 'parfum4.jpg', [''], 'Zara'],
  ];
  const { uniqueSlug } = require('./utils');
  for (const [nom, c, pv, pp, pa, f, tailles, marque] of produits) {
    const slug = await uniqueSlug('produits', nom);
    const r = await db.one(
      `INSERT INTO produits (nom, slug, categorie_id, marque, description, prix_vente, prix_promo, prix_achat, vedette)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,TRUE) RETURNING id`,
      [nom, slug, await cat(c), marque, 'Pièce de la collection Aliica 2025. Coupe élégante, finitions soignées.', pv, pp, pa]
    );
    const im = await img(f);
    if (im) await db.query('INSERT INTO produit_images (produit_id, image_id) VALUES ($1,$2)', [r.id, im]);
    for (const t of tailles) await db.query('INSERT INTO variantes (produit_id, taille, stock) VALUES ($1,$2,$3)', [r.id, t, tailles.length > 1 ? 4 : 6]);
  }

  await db.query(`INSERT INTO slides (surtitre, titre, bouton_texte, lien, image_id, ordre) VALUES
    ('COLLECTION ALIICA 2025', 'Élégance et modernité', 'FAITES UN ACHAT', '/boutique', $1, 1),
    ('NOUVEAUTÉS', 'Offrez l''élégance, créez des sourires', 'FAITES UN ACHAT', '/boutique', $2, 2)`, [await img('hero1.jpg'), await img('hero2.jpg')]);

  const homme = await db.all("SELECT id FROM categories WHERE slug IN ('chemise','ensemble') ORDER BY ordre");
  const femme = await db.all("SELECT id FROM categories WHERE slug IN ('parfum','sac-a-main','chaussure') ORDER BY CASE slug WHEN 'parfum' THEN 1 WHEN 'sac-a-main' THEN 2 ELSE 3 END");
  await db.query(`INSERT INTO sections (type, titre, config, ordre) VALUES
    ('onglets', 'Hommes', $1, 1),
    ('banniere', 'L''élégance en lin', $2, 2),
    ('onglets', 'Femmes', $3, 3),
    ('offre', 'Offre spéciale', $4, 4)`, [
    JSON.stringify({ categories: homme.map((x) => x.id), nombre: 5 }),
    JSON.stringify({ surtitre: 'COLLECTION ALIICA 2025', titre: "L'élégance en lin", bouton_texte: 'FAIRE UN ACHAT', lien: '/categorie/chemise', image_gauche: await img('banner_l.jpg'), image_droite: await img('banner_r.jpg'), couleur_fond: '#e1e6e4' }),
    JSON.stringify({ categories: femme.map((x) => x.id), nombre: 5 }),
    JSON.stringify({ titre: 'OFFRE SPÉCIALE', texte: 'Avec le code promo : ALIICA2025\nvous avez -10% sur votre première commande !', bouton_texte: 'faites un achat', lien: '/boutique' }),
  ]);
  await db.query("INSERT INTO fournisseurs (nom, contact, telephone, ville) VALUES ('ModeFlex', 'M. Koné', '07 07 07 07 07', 'Abidjan'), ('FashionStore', 'Mme Yao', '05 05 05 05 05', 'Adjamé')");
  console.log('» Catalogue de démonstration installé');
}

async function init() {
  await migrate();
  await seedBase();
  await seedDemo();
}

module.exports = { init, migrate };
