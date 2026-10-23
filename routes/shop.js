const express = require('express');
const db = require('../src/db');
const settings = require('../src/settings');
const { int, numero, escapeHtml } = require('../src/utils');
const { libelleVariante } = require('../src/stock');

const router = express.Router();
const PAR_PAGE = 12;

// ---------- Données communes (menu, réglages, panier) ----------
router.use(async (req, res, next) => {
  try {
    res.locals.s = await settings.getAll();
    const cats = await db.all('SELECT id, nom, slug, genre FROM categories WHERE afficher_menu ORDER BY ordre, nom');
    res.locals.menuHommes = cats.filter((c) => c.genre === 'homme' || c.genre === 'mixte');
    res.locals.menuFemmes = cats.filter((c) => c.genre === 'femme' || c.genre === 'mixte');
    const panier = req.session.panier || [];
    res.locals.nbPanier = panier.reduce((a, l) => a + l.q, 0);
    res.locals.pagesInfo = await db.all('SELECT slug, titre FROM pages WHERE publie ORDER BY id');
    next();
  } catch (e) { next(e); }
});

const SELECT_PRODUIT = `
  SELECT p.id, p.nom, p.slug, p.marque, p.prix_vente, p.prix_promo, p.created_at, p.vedette,
         c.nom AS categorie, c.slug AS categorie_slug, c.genre,
         COALESCE(p.prix_promo, p.prix_vente) AS prix,
         (SELECT image_id FROM produit_images pi WHERE pi.produit_id=p.id ORDER BY ordre, id LIMIT 1) AS image_id,
         (SELECT image_id FROM produit_images pi WHERE pi.produit_id=p.id ORDER BY ordre, id OFFSET 1 LIMIT 1) AS image2_id,
         (SELECT COALESCE(SUM(stock),0) FROM variantes v WHERE v.produit_id=p.id AND v.actif) AS stock
  FROM produits p LEFT JOIN categories c ON c.id=p.categorie_id
  WHERE p.actif AND p.publie_site`;

const TRANCHES = {
  '1': [0, 9999, 'Moins de 10.000 CFA'],
  '2': [10000, 19999, '10.000 – 19.999 CFA'],
  '3': [20000, 49999, '20.000 – 49.999 CFA'],
  '4': [50000, 100000000, '50.000 CFA et plus'],
};

async function listerProduits(f) {
  const where = []; const params = [];
  const add = (sql, v) => { params.push(v); where.push(sql.replace('?', `$${params.length}`)); };
  if (f.categorieId) add('p.categorie_id = ?', f.categorieId);
  if (f.categorieIds) add('p.categorie_id = ANY(?)', f.categorieIds);
  if (f.genres && f.genres.length) add('c.genre = ANY(?)', f.genres);
  if (f.q) { params.push(`%${f.q}%`); const i = params.length; where.push(`(p.nom ILIKE $${i} OR p.marque ILIKE $${i} OR c.nom ILIKE $${i})`); }
  if (f.promo) where.push('p.prix_promo IS NOT NULL');
  if (f.ids) add('p.id = ANY(?)', f.ids);
  if (f.tranches && f.tranches.length) {
    const ors = f.tranches.filter((t) => TRANCHES[t]).map((t) => `COALESCE(p.prix_promo,p.prix_vente) BETWEEN ${TRANCHES[t][0]} AND ${TRANCHES[t][1]}`);
    if (ors.length) where.push(`(${ors.join(' OR ')})`);
  }
  const tri = { prix_asc: 'prix ASC', prix_desc: 'prix DESC', nouveau: 'p.created_at DESC', nom: 'p.nom ASC' }[f.tri] || 'p.vedette DESC, p.created_at DESC';
  const base = `${SELECT_PRODUIT} ${where.length ? 'AND ' + where.join(' AND ') : ''}`;
  const total = (await db.one(`SELECT COUNT(*)::int AS n FROM (${base}) t`, params)).n;
  const limit = f.limit || PAR_PAGE;
  const offset = ((f.page || 1) - 1) * limit;
  const produits = await db.all(`${base} ORDER BY ${tri} LIMIT ${limit} OFFSET ${offset}`, params);
  return { produits, total, pages: Math.max(1, Math.ceil(total / limit)) };
}

// ---------- Accueil ----------
router.get('/', async (req, res, next) => {
  try {
    const slides = await db.all('SELECT * FROM slides WHERE actif ORDER BY ordre, id');
    const sections = await db.all('SELECT * FROM sections WHERE actif ORDER BY ordre, id');
    for (const sec of sections) {
      if (sec.type === 'onglets') {
        const ids = (sec.config.categories || []).map(Number);
        const cats = ids.length ? await db.all('SELECT id, nom, slug FROM categories WHERE id = ANY($1)', [ids]) : [];
        sec.onglets = [];
        for (const id of ids) {
          const cat = cats.find((c) => c.id === id);
          if (!cat) continue;
          const { produits } = await listerProduits({ categorieId: id, limit: sec.config.nombre || 5 });
          sec.onglets.push({ ...cat, produits });
        }
      }
    }
    res.render('shop/accueil', { titre: null, slides, sections });
  } catch (e) { next(e); }
});

// ---------- Catalogue ----------
async function catalogue(req, res, opts) {
  const tranches = [].concat(req.query.prix || []);
  const genres = [].concat(req.query.type || opts.genres || []);
  const page = Math.max(1, int(req.query.page, 1));
  const r = await listerProduits({
    categorieId: opts.categorie ? opts.categorie.id : null,
    genres, tranches, promo: req.query.promo === '1', tri: req.query.tri, q: opts.q, page,
  });
  const comptes = await db.all(`SELECT c.genre, COUNT(*)::int AS n FROM produits p JOIN categories c ON c.id=p.categorie_id
    WHERE p.actif AND p.publie_site ${opts.categorie ? 'AND p.categorie_id=' + Number(opts.categorie.id) : ''} GROUP BY c.genre`);
  const qs = (extra) => {
    const u = new URLSearchParams();
    Object.entries({ ...req.query, ...extra }).forEach(([k, v]) => [].concat(v).forEach((x) => { if (x !== undefined && x !== '') u.append(k, x); }));
    return '?' + u.toString();
  };
  res.render('shop/catalogue', {
    titre: opts.titre, fil: opts.fil, ...r, page, tranches, genres, TRANCHES, comptes,
    promo: req.query.promo === '1', tri: req.query.tri || '', vue: req.query.vue || 'grille', q: opts.q || '', qs,
  });
}

router.get('/boutique', (req, res, next) => catalogue(req, res, { titre: 'Boutique', fil: [['Boutique']] }).catch(next));
router.get('/hommes', (req, res, next) => catalogue(req, res, { titre: 'Hommes', fil: [['Hommes']], genres: ['homme'] }).catch(next));
router.get('/femmes', (req, res, next) => catalogue(req, res, { titre: 'Femmes', fil: [['Femmes']], genres: ['femme'] }).catch(next));
router.get('/recherche', (req, res, next) => catalogue(req, res, { titre: `Recherche : « ${req.query.q || ''} »`, fil: [['Recherche']], q: (req.query.q || '').trim() }).catch(next));
router.get('/categorie/:slug', async (req, res, next) => {
  try {
    const categorie = await db.one('SELECT * FROM categories WHERE slug=$1', [req.params.slug]);
    if (!categorie) return next();
    const g = categorie.genre === 'femme' ? ['Femme', '/femmes'] : categorie.genre === 'homme' ? ['Homme', '/hommes'] : ['Boutique', '/boutique'];
    return catalogue(req, res, { titre: categorie.nom, fil: [[g[0], g[1]], [categorie.nom]], categorie });
  } catch (e) { return next(e); }
});

// ---------- Fiche produit ----------
router.get('/produit/:slug', async (req, res, next) => {
  try {
    const p = await db.one(`SELECT p.*, c.nom AS categorie, c.slug AS categorie_slug, c.genre FROM produits p LEFT JOIN categories c ON c.id=p.categorie_id
      WHERE p.slug=$1 AND p.actif AND p.publie_site`, [req.params.slug]);
    if (!p) return next();
    const images = await db.all('SELECT image_id FROM produit_images WHERE produit_id=$1 ORDER BY ordre, id', [p.id]);
    const variantes = await db.all('SELECT id, taille, couleur, stock FROM variantes WHERE produit_id=$1 AND actif ORDER BY id', [p.id]);
    const { produits: similaires } = await listerProduits({ categorieId: p.categorie_id, limit: 5 });
    res.render('shop/produit', { titre: p.nom, p, images, variantes, similaires: similaires.filter((x) => x.id !== p.id).slice(0, 4) });
  } catch (e) { next(e); }
});

// ---------- Panier ----------
async function lignesPanier(req) {
  const panier = req.session.panier || [];
  if (!panier.length) return { lignes: [], sousTotal: 0 };
  const rows = await db.all(`SELECT v.id, v.taille, v.couleur, v.stock, p.nom, p.slug, COALESCE(p.prix_promo,p.prix_vente) AS prix,
      (SELECT image_id FROM produit_images pi WHERE pi.produit_id=p.id ORDER BY ordre, id LIMIT 1) AS image_id
    FROM variantes v JOIN produits p ON p.id=v.produit_id WHERE v.id = ANY($1) AND p.actif AND v.actif`, [panier.map((l) => l.v)]);
  const lignes = panier.map((l) => {
    const r = rows.find((x) => x.id === l.v);
    return r ? { ...r, q: l.q, total: r.prix * l.q } : null;
  }).filter(Boolean);
  req.session.panier = lignes.map((l) => ({ v: l.id, q: l.q }));
  return { lignes, sousTotal: lignes.reduce((a, l) => a + l.total, 0) };
}

router.get('/panier', async (req, res, next) => {
  try { res.render('shop/panier', { titre: 'Panier', ...(await lignesPanier(req)) }); } catch (e) { next(e); }
});

router.post('/panier/ajouter', async (req, res, next) => {
  try {
    const v = int(req.body.variante_id); const q = Math.max(1, int(req.body.quantite, 1));
    const vr = await db.one('SELECT v.stock FROM variantes v JOIN produits p ON p.id=v.produit_id WHERE v.id=$1 AND v.actif AND p.actif AND p.publie_site', [v]);
    if (!vr) return res.status(400).json({ error: 'Article indisponible' });
    const panier = req.session.panier || [];
    const l = panier.find((x) => x.v === v);
    const deja = l ? l.q : 0;
    if (deja + q > vr.stock) {
      const msg = vr.stock <= 0 ? 'Cet article est en rupture de stock.' : `Il ne reste que ${vr.stock} pièce(s) disponible(s).`;
      if (req.xhr || req.is('json')) return res.status(400).json({ error: msg });
      req.session.flash = { type: 'erreur', msg }; return res.redirect('back');
    }
    if (l) l.q += q; else panier.push({ v, q });
    req.session.panier = panier;
    const nb = panier.reduce((a, x) => a + x.q, 0);
    if (req.xhr || req.is('json')) return res.json({ ok: true, nb });
    return res.redirect('/panier');
  } catch (e) { return next(e); }
});

router.post('/panier/maj', async (req, res, next) => {
  try {
    const panier = req.session.panier || [];
    const v = int(req.body.variante_id); const q = int(req.body.quantite);
    const vr = await db.one('SELECT stock FROM variantes WHERE id=$1', [v]);
    const l = panier.find((x) => x.v === v);
    if (l) {
      if (q <= 0) req.session.panier = panier.filter((x) => x.v !== v);
      else l.q = Math.min(q, vr ? vr.stock : q);
    }
    res.redirect('/panier');
  } catch (e) { next(e); }
});

// ---------- Commande ----------
async function verifierPromo(code, telephone, sousTotal) {
  if (!code) return { remise: 0 };
  const cp = await db.one('SELECT * FROM codes_promo WHERE UPPER(code)=UPPER($1) AND actif AND (date_fin IS NULL OR date_fin >= CURRENT_DATE)', [code.trim()]);
  if (!cp) return { erreur: 'Code promo invalide ou expiré.' };
  if (cp.premiere_commande && telephone) {
    const tel = telephone.replace(/\D/g, '').slice(-8);
    const deja = await db.one("SELECT id FROM commandes WHERE RIGHT(regexp_replace(telephone,'\\D','','g'),8)=$1 AND statut<>'annulee' LIMIT 1", [tel]);
    if (deja) return { erreur: 'Ce code est valable uniquement sur la première commande.' };
  }
  return { remise: Math.round(sousTotal * cp.pourcentage / 100), code: cp.code, pourcentage: cp.pourcentage };
}

router.get('/commande', async (req, res, next) => {
  try {
    const p = await lignesPanier(req);
    if (!p.lignes.length) return res.redirect('/panier');
    res.render('shop/commande', { titre: 'Finaliser la commande', ...p, form: {}, erreur: null, frais: int(res.locals.s.frais_livraison) });
  } catch (e) { next(e); }
});

router.post('/api/promo', async (req, res, next) => {
  try {
    const { sousTotal } = await lignesPanier(req);
    const r = await verifierPromo(req.body.code || '', req.body.telephone || '', sousTotal);
    res.json(r);
  } catch (e) { next(e); }
});

router.post('/commande', async (req, res, next) => {
  try {
    const p = await lignesPanier(req);
    if (!p.lignes.length) return res.redirect('/panier');
    const f = req.body;
    const frais = int(res.locals.s.frais_livraison);
    const rerender = (erreur) => res.render('shop/commande', { titre: 'Finaliser la commande', ...p, form: f, erreur, frais });
    if (!f.nom || !f.telephone || !f.adresse) return rerender('Merci de renseigner votre nom, téléphone et adresse de livraison.');
    for (const l of p.lignes) if (l.q > l.stock) return rerender(`Stock insuffisant pour ${l.nom} (disponible : ${l.stock}).`);
    const promo = await verifierPromo(f.code_promo || '', f.telephone, p.sousTotal);
    if (promo.erreur) return rerender(promo.erreur);
    const num = await numero('CMD', 'commandes');
    const total = p.sousTotal - promo.remise + frais;
    await db.tx(async (c) => {
      const r = await c.query(`INSERT INTO commandes (numero, nom, telephone, email, ville, adresse, notes, sous_total, remise, frais_livraison, total, code_promo, mode_paiement)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id`,
      [num, f.nom.trim(), f.telephone.trim(), f.email || null, f.ville || null, f.adresse, f.notes || null, p.sousTotal, promo.remise, frais, total, promo.code || null, f.mode_paiement || 'Paiement à la livraison']);
      for (const l of p.lignes) {
        await c.query('INSERT INTO commande_lignes (commande_id, variante_id, libelle, quantite, prix_unitaire) VALUES ($1,$2,$3,$4,$5)',
          [r.rows[0].id, l.id, libelleVariante(l.nom, l.taille, l.couleur), l.q, l.prix]);
      }
    });
    req.session.panier = [];
    req.session.mesCommandes = [...(req.session.mesCommandes || []), num];
    return res.redirect(`/commande/merci/${num}`);
  } catch (e) { return next(e); }
});

router.get('/commande/merci/:numero', async (req, res, next) => {
  try {
    if (!(req.session.mesCommandes || []).includes(req.params.numero)) return res.redirect('/suivi');
    const cmd = await db.one('SELECT * FROM commandes WHERE numero=$1', [req.params.numero]);
    const lignes = await db.all('SELECT * FROM commande_lignes WHERE commande_id=$1', [cmd.id]);
    res.render('shop/merci', { titre: 'Merci pour votre commande', cmd, lignes });
  } catch (e) { next(e); }
});

router.get('/suivi', async (req, res, next) => {
  try {
    let cmd = null; let lignes = []; let cherche = false;
    if (req.query.numero && req.query.telephone) {
      cherche = true;
      const tel = String(req.query.telephone).replace(/\D/g, '').slice(-8);
      cmd = await db.one("SELECT * FROM commandes WHERE UPPER(numero)=UPPER($1) AND RIGHT(regexp_replace(telephone,'\\D','','g'),8)=$2", [req.query.numero.trim(), tel]);
      if (cmd) lignes = await db.all('SELECT * FROM commande_lignes WHERE commande_id=$1', [cmd.id]);
    }
    res.render('shop/suivi', { titre: 'Suivre ma commande', cmd, lignes, cherche, q: req.query });
  } catch (e) { next(e); }
});

// ---------- Pages, newsletter, favoris ----------
router.get('/page/:slug', async (req, res, next) => {
  try {
    const page = await db.one('SELECT * FROM pages WHERE slug=$1 AND publie', [req.params.slug]);
    if (!page) return next();
    res.render('shop/page', { titre: page.titre, page });
  } catch (e) { next(e); }
});

router.post('/newsletter', async (req, res, next) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    let msg = 'Merci ! Vous êtes inscrit(e) à notre newsletter.';
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) msg = 'Adresse e-mail invalide.';
    else await db.query('INSERT INTO newsletter (email) VALUES ($1) ON CONFLICT DO NOTHING', [email]);
    if (req.xhr || req.is('json')) return res.json({ msg });
    req.session.flash = { type: 'ok', msg };
    return res.redirect('back');
  } catch (e) { return next(e); }
});

router.get('/favoris', (req, res) => res.render('shop/favoris', { titre: 'Mes favoris' }));
router.get('/api/produits', async (req, res, next) => {
  try {
    const ids = String(req.query.ids || '').split(',').map(Number).filter(Boolean).slice(0, 60);
    if (!ids.length) return res.json([]);
    const { produits } = await listerProduits({ ids, limit: 60 });
    res.json(produits);
  } catch (e) { next(e); }
});

router.get('/robots.txt', (req, res) => res.type('text').send('User-agent: *\nAllow: /\n'));

module.exports = router;
module.exports.escapeHtml = escapeHtml;
