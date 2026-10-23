const express = require('express');
const db = require('../../src/db');
const { int } = require('../../src/utils');
const { mouvement } = require('../../src/stock');

const router = express.Router();

// ---------- Stock ----------
router.get('/stock', async (req, res, next) => {
  try {
    const q = String(req.query.q || '').trim();
    const filtre = req.query.filtre || '';
    const lignes = await db.all(`SELECT v.id, v.taille, v.couleur, v.stock, p.id AS produit_id, p.nom, p.seuil_alerte, p.prix_achat,
        COALESCE(p.prix_promo,p.prix_vente) AS prix, c.nom AS categorie,
        (SELECT image_id FROM produit_images pi WHERE pi.produit_id=p.id ORDER BY ordre, id LIMIT 1) AS image_id
      FROM variantes v JOIN produits p ON p.id=v.produit_id LEFT JOIN categories c ON c.id=p.categorie_id
      WHERE p.actif AND v.actif AND ($1='' OR p.nom ILIKE '%'||$1||'%' OR c.nom ILIKE '%'||$1||'%')
        AND ($2='' OR ($2='alerte' AND v.stock<=p.seuil_alerte) OR ($2='rupture' AND v.stock<=0))
      ORDER BY p.nom, v.id`, [q, filtre]);
    const tot = await db.one(`SELECT COALESCE(SUM(v.stock),0)::int AS pieces,
        COALESCE(SUM(v.stock*COALESCE(p.prix_promo,p.prix_vente)),0)::bigint AS valeur_vente,
        COALESCE(SUM(v.stock*p.prix_achat),0)::bigint AS valeur_achat,
        COUNT(*) FILTER (WHERE v.stock<=0)::int AS ruptures, COUNT(*) FILTER (WHERE v.stock>0 AND v.stock<=p.seuil_alerte)::int AS faibles
      FROM variantes v JOIN produits p ON p.id=v.produit_id WHERE p.actif AND v.actif AND v.stock>=0`);
    res.render('admin/stock', { titre: 'Gestion du stock', page: 'stock', lignes, q, filtre, tot });
  } catch (e) { next(e); }
});

router.post('/stock/ajuster', async (req, res, next) => {
  try {
    const vid = int(req.body.variante_id);
    const mode = req.body.mode;
    const val = int(req.body.valeur);
    await db.tx(async (c) => {
      const cur = (await c.query('SELECT stock FROM variantes WHERE id=$1', [vid])).rows[0];
      if (!cur) throw new Error('Article introuvable');
      let delta = 0;
      if (mode === 'fixer') delta = val - cur.stock;
      else if (mode === 'retirer') delta = -Math.abs(val);
      else delta = Math.abs(val);
      if (delta !== 0) {
        await mouvement(c, { varianteId: vid, quantite: delta, type: mode === 'fixer' ? 'inventaire' : 'ajustement', motif: req.body.motif || null, utilisateurId: req.session.user.id, autoriserNegatif: false });
      }
    });
    req.session.flash = { type: 'ok', msg: 'Stock mis à jour ✔' };
    res.redirect('back');
  } catch (e) {
    if (e.status === 400) { req.session.flash = { type: 'erreur', msg: e.message }; return res.redirect('back'); }
    return next(e);
  }
});

router.get('/stock/mouvements', async (req, res, next) => {
  try {
    const vid = int(req.query.variante) || null;
    const mouvements = await db.all(`SELECT m.*, p.nom, v.taille, v.couleur, u.nom AS utilisateur
      FROM mouvements_stock m JOIN variantes v ON v.id=m.variante_id JOIN produits p ON p.id=v.produit_id LEFT JOIN utilisateurs u ON u.id=m.utilisateur_id
      WHERE ($1::int IS NULL OR m.variante_id=$1) ORDER BY m.created_at DESC, m.id DESC LIMIT 300`, [vid]);
    res.render('admin/mouvements', { titre: 'Mouvements de stock', page: 'stock', mouvements });
  } catch (e) { next(e); }
});

// ---------- Approvisionnements ----------
router.get('/achats', async (req, res, next) => {
  try {
    const achats = await db.all(`SELECT a.*, f.nom AS fournisseur, u.nom AS utilisateur,
        (SELECT SUM(quantite) FROM achat_lignes WHERE achat_id=a.id)::int AS pieces
      FROM achats a LEFT JOIN fournisseurs f ON f.id=a.fournisseur_id LEFT JOIN utilisateurs u ON u.id=a.utilisateur_id
      ORDER BY a.date_achat DESC, a.id DESC LIMIT 300`);
    res.render('admin/achats', { titre: 'Approvisionnements', page: 'achats', achats });
  } catch (e) { next(e); }
});

router.get('/achats/nouveau', async (req, res, next) => {
  try {
    const fournisseurs = await db.all('SELECT id, nom FROM fournisseurs WHERE actif ORDER BY nom');
    res.render('admin/achat_form', { titre: 'Nouvel approvisionnement', page: 'achats', fournisseurs, fId: int(req.query.fournisseur) || null });
  } catch (e) { next(e); }
});

async function receptionner(c, achatId, userId) {
  const a = (await c.query('SELECT * FROM achats WHERE id=$1 FOR UPDATE', [achatId])).rows[0];
  const lignes = (await c.query(`SELECT al.*, v.produit_id FROM achat_lignes al JOIN variantes v ON v.id=al.variante_id WHERE achat_id=$1`, [achatId])).rows;
  for (const l of lignes) {
    // Coût moyen pondéré du produit
    if (l.prix_unitaire > 0) {
      const p = (await c.query(`SELECT p.prix_achat, COALESCE((SELECT SUM(GREATEST(stock,0)) FROM variantes WHERE produit_id=p.id AND actif),0)::int AS stock FROM produits p WHERE id=$1`, [l.produit_id])).rows[0];
      const nouveau = p.stock + l.quantite > 0 ? Math.round((p.stock * p.prix_achat + l.quantite * l.prix_unitaire) / (p.stock + l.quantite)) : l.prix_unitaire;
      await c.query('UPDATE produits SET prix_achat=$1 WHERE id=$2', [p.prix_achat ? nouveau : l.prix_unitaire, l.produit_id]);
    }
    await mouvement(c, { varianteId: l.variante_id, quantite: l.quantite, type: 'achat', reference: a.reference || `ACH-${a.id}`, utilisateurId: userId });
  }
  await c.query("UPDATE achats SET statut='recu' WHERE id=$1", [achatId]);
}

router.post('/achats/nouveau', async (req, res, next) => {
  try {
    const b = req.body;
    let lignes = [];
    try { lignes = JSON.parse(b.lignes || '[]'); } catch (e) { lignes = []; }
    lignes = lignes.map((l) => ({ v: int(l.variante_id), q: int(l.quantite), pu: int(l.prix_unitaire) })).filter((l) => l.v && l.q > 0);
    if (!lignes.length) { req.session.flash = { type: 'erreur', msg: 'Ajoutez au moins un article.' }; return res.redirect('/gestion/achats/nouveau'); }
    const total = lignes.reduce((a, l) => a + l.q * l.pu, 0);
    const statut = b.statut === 'en_attente' ? 'en_attente' : 'recu';
    const id = await db.tx(async (c) => {
      const r = await c.query(`INSERT INTO achats (reference, fournisseur_id, date_achat, statut, total, notes, utilisateur_id)
        VALUES ($1,$2,$3,'en_attente',$4,$5,$6) RETURNING id`,
      [b.reference || null, int(b.fournisseur_id) || null, b.date_achat || new Date().toISOString().slice(0, 10), total, b.notes || null, req.session.user.id]);
      const aid = r.rows[0].id;
      for (const l of lignes) await c.query('INSERT INTO achat_lignes (achat_id, variante_id, quantite, prix_unitaire) VALUES ($1,$2,$3,$4)', [aid, l.v, l.q, l.pu]);
      if (statut === 'recu') await receptionner(c, aid, req.session.user.id);
      return aid;
    });
    req.session.flash = { type: 'ok', msg: statut === 'recu' ? 'Approvisionnement enregistré, le stock a été mis à jour ✔' : 'Commande fournisseur enregistrée (en attente de réception).' };
    return res.redirect(`/gestion/achats/${id}`);
  } catch (e) { return next(e); }
});

router.get('/achats/:id', async (req, res, next) => {
  try {
    const a = await db.one(`SELECT a.*, f.nom AS fournisseur, f.telephone AS f_tel, u.nom AS utilisateur FROM achats a
      LEFT JOIN fournisseurs f ON f.id=a.fournisseur_id LEFT JOIN utilisateurs u ON u.id=a.utilisateur_id WHERE a.id=$1`, [int(req.params.id)]);
    if (!a) return next();
    a.lignes = await db.all(`SELECT al.*, p.nom, v.taille, v.couleur FROM achat_lignes al JOIN variantes v ON v.id=al.variante_id JOIN produits p ON p.id=v.produit_id WHERE achat_id=$1`, [a.id]);
    return res.render('admin/achat', { titre: `Approvisionnement #${a.id}`, page: 'achats', a });
  } catch (e) { return next(e); }
});

router.post('/achats/:id/recevoir', async (req, res, next) => {
  try {
    const a = await db.one('SELECT statut FROM achats WHERE id=$1', [int(req.params.id)]);
    if (a && a.statut === 'en_attente') await db.tx((c) => receptionner(c, int(req.params.id), req.session.user.id));
    req.session.flash = { type: 'ok', msg: 'Marchandise réceptionnée, stock mis à jour ✔' };
    res.redirect(`/gestion/achats/${int(req.params.id)}`);
  } catch (e) { next(e); }
});
router.post('/achats/:id/annuler', async (req, res, next) => {
  try {
    await db.query("UPDATE achats SET statut='annule' WHERE id=$1 AND statut='en_attente'", [int(req.params.id)]);
    req.session.flash = { type: 'ok', msg: 'Commande fournisseur annulée.' };
    res.redirect(`/gestion/achats/${int(req.params.id)}`);
  } catch (e) { next(e); }
});

module.exports = router;
