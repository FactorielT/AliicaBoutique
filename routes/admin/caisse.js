const express = require('express');
const db = require('../../src/db');
const { int } = require('../../src/utils');
const { creerVente, annulerVente } = require('../../src/ventes');

const router = express.Router();
const MODES = ['Espèces', 'Carte', 'Orange Money', 'MTN Money', 'Wave', 'Moov Money'];

router.get('/caisse', async (req, res, next) => {
  try {
    const categories = await db.all('SELECT id, nom FROM categories ORDER BY ordre, nom');
    res.render('admin/caisse', { titre: 'Caisse', page: 'caisse', categories, MODES });
  } catch (e) { next(e); }
});

// Recherche d'articles (caisse, approvisionnement)
router.get('/api/variantes', async (req, res, next) => {
  try {
    const q = String(req.query.q || '').trim();
    const cat = int(req.query.categorie) || null;
    const rows = await db.all(`SELECT v.id, v.taille, v.couleur, v.stock, p.id AS produit_id, p.nom, p.marque,
        COALESCE(p.prix_promo,p.prix_vente) AS prix, p.prix_vente, c.nom AS categorie,
        (SELECT image_id FROM produit_images pi WHERE pi.produit_id=p.id ORDER BY ordre, id LIMIT 1) AS image_id
      FROM variantes v JOIN produits p ON p.id=v.produit_id LEFT JOIN categories c ON c.id=p.categorie_id
      WHERE p.actif AND v.actif AND ($1 = '' OR p.nom ILIKE '%'||$1||'%' OR p.marque ILIKE '%'||$1||'%' OR c.nom ILIKE '%'||$1||'%' OR v.taille ILIKE $1 OR v.couleur ILIKE '%'||$1||'%')
        AND ($2::int IS NULL OR p.categorie_id=$2)
      ORDER BY p.nom, v.id LIMIT 60`, [q, cat]);
    res.json(rows);
  } catch (e) { next(e); }
});

router.get('/api/clients', async (req, res, next) => {
  try {
    const q = String(req.query.q || '').trim();
    res.json(await db.all(`SELECT id, nom, telephone FROM clients WHERE $1='' OR nom ILIKE '%'||$1||'%' OR telephone ILIKE '%'||$1||'%' ORDER BY nom LIMIT 15`, [q]));
  } catch (e) { next(e); }
});
router.post('/api/clients', async (req, res, next) => {
  try {
    const nom = String(req.body.nom || '').trim();
    if (!nom) return res.status(400).json({ error: 'Nom obligatoire' });
    res.json(await db.one('INSERT INTO clients (nom, telephone) VALUES ($1,$2) RETURNING id, nom, telephone', [nom, req.body.telephone || null]));
  } catch (e) { return next(e); }
});

router.post('/api/ventes', async (req, res) => {
  try {
    const b = req.body;
    const mode = MODES.includes(b.mode_paiement) ? b.mode_paiement : 'Espèces';
    const r = await db.tx((c) => creerVente(c, {
      lignes: (b.lignes || []).map((l) => ({ varianteId: int(l.variante_id), quantite: int(l.quantite), prix: l.prix })),
      clientId: int(b.client_id) || null, utilisateurId: req.session.user.id, remise: int(b.remise), modePaiement: mode,
      montantRecu: b.montant_recu ? int(b.montant_recu) : null,
    }));
    res.json({ ok: true, ...r });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

// ---------- Historique des ventes ----------
router.get('/ventes', async (req, res, next) => {
  try {
    const du = req.query.du || new Date(Date.now() - 29 * 864e5).toISOString().slice(0, 10);
    const au = req.query.au || new Date().toISOString().slice(0, 10);
    const q = String(req.query.q || '').trim();
    const ventes = await db.all(`SELECT v.*, c.nom AS client, u.nom AS vendeur,
        (SELECT SUM(quantite) FROM vente_lignes WHERE vente_id=v.id)::int AS articles
      FROM ventes v LEFT JOIN clients c ON c.id=v.client_id LEFT JOIN utilisateurs u ON u.id=v.utilisateur_id
      WHERE v.created_at::date BETWEEN $1 AND $2 AND ($3='' OR v.numero ILIKE '%'||$3||'%' OR c.nom ILIKE '%'||$3||'%')
      ORDER BY v.created_at DESC LIMIT 500`, [du, au, q]);
    const tot = ventes.filter((v) => v.statut === 'payee').reduce((a, v) => a + v.total, 0);
    res.render('admin/ventes', { titre: 'Ventes', page: 'ventes', ventes, du, au, q, tot });
  } catch (e) { next(e); }
});

async function chargerVente(id) {
  const v = await db.one(`SELECT v.*, c.nom AS client, c.telephone AS client_tel, u.nom AS vendeur FROM ventes v
    LEFT JOIN clients c ON c.id=v.client_id LEFT JOIN utilisateurs u ON u.id=v.utilisateur_id WHERE v.id=$1`, [id]);
  if (v) v.lignes = await db.all('SELECT * FROM vente_lignes WHERE vente_id=$1 ORDER BY id', [id]);
  return v;
}

router.get('/ventes/:id', async (req, res, next) => {
  try {
    const v = await chargerVente(int(req.params.id));
    if (!v) return next();
    return res.render('admin/vente', { titre: `Vente ${v.numero}`, page: 'ventes', v });
  } catch (e) { return next(e); }
});
router.get('/ventes/:id/ticket', async (req, res, next) => {
  try {
    const v = await chargerVente(int(req.params.id));
    if (!v) return next();
    const s = await require('../../src/settings').getAll();
    return res.render('admin/ticket', { v, s });
  } catch (e) { return next(e); }
});
router.post('/ventes/:id/annuler', async (req, res, next) => {
  try {
    await db.tx((c) => annulerVente(c, int(req.params.id), req.session.user.id));
    await db.query("UPDATE commandes SET statut='annulee' WHERE vente_id=$1", [int(req.params.id)]);
    req.session.flash = { type: 'ok', msg: 'Vente annulée, les articles ont été remis en stock.' };
    res.redirect(`/gestion/ventes/${int(req.params.id)}`);
  } catch (e) { next(e); }
});

module.exports = router;
