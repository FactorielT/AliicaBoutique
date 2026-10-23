const express = require('express');
const db = require('../../src/db');
const { int } = require('../../src/utils');
const { requireProprietaire, estProprietaire } = require('../../src/auth');

const router = express.Router();
const iso = (d) => d.toISOString().slice(0, 10);

function periode(req) {
  const now = new Date();
  const p = req.query.p || 'mois';
  let du; let au = iso(now);
  if (p === 'jour') du = au;
  else if (p === 'semaine') du = iso(new Date(now - ((now.getDay() + 6) % 7) * 864e5));
  else if (p === 'mois') du = iso(new Date(now.getFullYear(), now.getMonth(), 1, 12));
  else if (p === 'mois_prec') { du = iso(new Date(now.getFullYear(), now.getMonth() - 1, 1, 12)); au = iso(new Date(now.getFullYear(), now.getMonth(), 0, 12)); }
  else if (p === 'annee') du = `${now.getFullYear()}-01-01`;
  else { du = req.query.du || iso(new Date(now - 29 * 864e5)); au = req.query.au || au; }
  return { p, du, au };
}

router.get('/rapports', async (req, res, next) => {
  try {
    const { p, du, au } = periode(req);
    const proprio = estProprietaire(req);
    const W = "v.statut='payee' AND v.created_at::date BETWEEN $1 AND $2";
    const r = await db.one(`SELECT COALESCE(SUM(total),0)::int AS ca, COUNT(*)::int AS nb, COALESCE(SUM(remise),0)::int AS remises,
      COALESCE(SUM(total) FILTER (WHERE source='site'),0)::int AS ca_site FROM ventes v WHERE ${W}`, [du, au]);
    r.articles = (await db.one(`SELECT COALESCE(SUM(vl.quantite),0)::int AS n FROM vente_lignes vl JOIN ventes v ON v.id=vl.vente_id WHERE ${W}`, [du, au])).n;
    r.panier = r.nb ? Math.round(r.ca / r.nb) : 0;
    const parJour = await db.all(`SELECT to_char(d,'DD/MM') AS j, COALESCE(SUM(v.total),0)::int AS total
      FROM generate_series($1::date, $2::date, interval '1 day') d LEFT JOIN ventes v ON v.created_at::date=d::date AND v.statut='payee'
      GROUP BY d ORDER BY d`, [du, au]);
    const parMode = await db.all(`SELECT mode_paiement AS l, COUNT(*)::int AS nb, SUM(total)::int AS total FROM ventes v WHERE ${W} GROUP BY 1 ORDER BY 3 DESC`, [du, au]);
    const parCat = await db.all(`SELECT COALESCE(c.nom,'Non classé') AS l, SUM(vl.quantite)::int AS nb, SUM(vl.quantite*vl.prix_unitaire)::int AS total
      ${proprio ? ', SUM(vl.quantite*(vl.prix_unitaire-vl.cout_unitaire))::int AS marge' : ''}
      FROM vente_lignes vl JOIN ventes v ON v.id=vl.vente_id LEFT JOIN variantes va ON va.id=vl.variante_id LEFT JOIN produits p ON p.id=va.produit_id LEFT JOIN categories c ON c.id=p.categorie_id
      WHERE ${W} GROUP BY 1 ORDER BY 3 DESC`, [du, au]);
    const top = await db.all(`SELECT vl.libelle AS l, SUM(vl.quantite)::int AS nb, SUM(vl.quantite*vl.prix_unitaire)::int AS total
      ${proprio ? ', SUM(vl.quantite*(vl.prix_unitaire-vl.cout_unitaire))::int AS marge' : ''}
      FROM vente_lignes vl JOIN ventes v ON v.id=vl.vente_id WHERE ${W} GROUP BY 1 ORDER BY 2 DESC LIMIT 15`, [du, au]);
    const parVendeur = await db.all(`SELECT COALESCE(u.nom, 'Site web') AS l, COUNT(*)::int AS nb, SUM(v.total)::int AS total
      FROM ventes v LEFT JOIN utilisateurs u ON u.id=v.utilisateur_id WHERE ${W} GROUP BY 1 ORDER BY 3 DESC`, [du, au]);
    let fin = null;
    if (proprio) {
      fin = await db.one(`SELECT COALESCE(SUM(vl.quantite*vl.cout_unitaire),0)::int AS cout FROM vente_lignes vl JOIN ventes v ON v.id=vl.vente_id WHERE ${W}`, [du, au]);
      fin.depenses = (await db.one('SELECT COALESCE(SUM(montant),0)::int AS n FROM depenses WHERE date_depense BETWEEN $1 AND $2', [du, au])).n;
      fin.depParCat = await db.all('SELECT categorie AS l, SUM(montant)::int AS total FROM depenses WHERE date_depense BETWEEN $1 AND $2 GROUP BY 1 ORDER BY 2 DESC', [du, au]);
      fin.achats = (await db.one("SELECT COALESCE(SUM(total),0)::int AS n FROM achats WHERE statut='recu' AND date_achat BETWEEN $1 AND $2", [du, au])).n;
      fin.marge = r.ca - fin.cout;
      fin.taux = r.ca ? Math.round(fin.marge / r.ca * 100) : 0;
      fin.benefice = fin.marge - fin.depenses;
    }
    res.render('admin/rapports', { titre: "Rapports d'activité", page: 'rapports', p, du, au, r, parJour, parMode, parCat, top, parVendeur, fin });
  } catch (e) { next(e); }
});

router.get('/rapports/export.csv', async (req, res, next) => {
  try {
    const { du, au } = periode(req);
    const proprio = estProprietaire(req);
    const rows = await db.all(`SELECT v.numero, to_char(v.created_at,'DD/MM/YYYY HH24:MI') AS date, COALESCE(c.nom,'') AS client, vl.libelle, vl.quantite, vl.prix_unitaire,
        vl.quantite*vl.prix_unitaire AS total_ligne, vl.cout_unitaire, v.mode_paiement, v.source, v.statut, COALESCE(u.nom,'') AS vendeur
      FROM ventes v JOIN vente_lignes vl ON vl.vente_id=v.id LEFT JOIN clients c ON c.id=v.client_id LEFT JOIN utilisateurs u ON u.id=v.utilisateur_id
      WHERE v.created_at::date BETWEEN $1 AND $2 ORDER BY v.created_at`, [du, au]);
    const cols = ['numero', 'date', 'client', 'libelle', 'quantite', 'prix_unitaire', 'total_ligne', ...(proprio ? ['cout_unitaire'] : []), 'mode_paiement', 'source', 'statut', 'vendeur'];
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const csv = '﻿' + [cols.join(';'), ...rows.map((r) => cols.map((c) => esc(r[c])).join(';'))].join('\n');
    res.set('Content-Type', 'text/csv; charset=utf-8');
    res.set('Content-Disposition', `attachment; filename="ventes_${du}_${au}.csv"`);
    res.send(csv);
  } catch (e) { next(e); }
});

// ---------- Dépenses (propriétaire uniquement) ----------
const CATS_DEP = ['Loyer', 'Salaires', 'Électricité / eau', 'Transport / livraison', 'Communication / publicité', 'Internet / téléphone', 'Fournitures', 'Impôts / taxes', 'Entretien', 'Autre'];

router.get('/depenses', requireProprietaire, async (req, res, next) => {
  try {
    const mois = req.query.mois || new Date().toISOString().slice(0, 7);
    const depenses = await db.all(`SELECT d.*, u.nom AS utilisateur FROM depenses d LEFT JOIN utilisateurs u ON u.id=d.utilisateur_id
      WHERE to_char(date_depense,'YYYY-MM')=$1 ORDER BY date_depense DESC, id DESC`, [mois]);
    const total = depenses.reduce((a, d) => a + d.montant, 0);
    res.render('admin/depenses', { titre: 'Dépenses', page: 'depenses', depenses, total, mois, CATS_DEP });
  } catch (e) { next(e); }
});
router.post('/depenses', requireProprietaire, async (req, res, next) => {
  try {
    const b = req.body;
    if (!b.libelle || !int(b.montant)) { req.session.flash = { type: 'erreur', msg: 'Libellé et montant obligatoires.' }; return res.redirect('/gestion/depenses'); }
    await db.query('INSERT INTO depenses (date_depense, libelle, categorie, montant, utilisateur_id) VALUES ($1,$2,$3,$4,$5)',
      [b.date_depense || new Date().toISOString().slice(0, 10), b.libelle, CATS_DEP.includes(b.categorie) ? b.categorie : 'Autre', int(b.montant), req.session.user.id]);
    req.session.flash = { type: 'ok', msg: 'Dépense ajoutée ✔' };
    return res.redirect(`/gestion/depenses?mois=${(b.date_depense || '').slice(0, 7)}`);
  } catch (e) { return next(e); }
});
router.post('/depenses/:id/supprimer', requireProprietaire, async (req, res, next) => {
  try {
    await db.query('DELETE FROM depenses WHERE id=$1', [int(req.params.id)]);
    req.session.flash = { type: 'ok', msg: 'Dépense supprimée.' };
    res.redirect('back');
  } catch (e) { next(e); }
});

module.exports = router;
