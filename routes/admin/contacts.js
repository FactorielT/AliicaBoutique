const express = require('express');
const db = require('../../src/db');
const { int } = require('../../src/utils');

const router = express.Router();

const TYPES = {
  clients: {
    table: 'clients', titre: 'Clients', un: 'client', page: 'clients',
    champs: [['nom', 'Nom complet *'], ['telephone', 'Téléphone'], ['email', 'E-mail'], ['adresse', 'Adresse / commune'], ['notes', 'Notes (tailles, préférences…)', 'textarea']],
    liste: `SELECT c.*, COUNT(v.id) FILTER (WHERE v.statut='payee')::int AS nb, COALESCE(SUM(v.total) FILTER (WHERE v.statut='payee'),0)::int AS montant,
      MAX(v.created_at) AS dernier FROM clients c LEFT JOIN ventes v ON v.client_id=c.id
      WHERE ($1='' OR c.nom ILIKE '%'||$1||'%' OR c.telephone ILIKE '%'||$1||'%') GROUP BY c.id ORDER BY c.nom`,
  },
  fournisseurs: {
    table: 'fournisseurs', titre: 'Fournisseurs', un: 'fournisseur', page: 'fournisseurs',
    champs: [['nom', 'Nom / société *'], ['contact', 'Personne à contacter'], ['telephone', 'Téléphone'], ['email', 'E-mail'], ['ville', 'Ville'], ['adresse', 'Adresse'], ['notes', 'Notes', 'textarea']],
    liste: `SELECT f.*, COUNT(a.id) FILTER (WHERE a.statut<>'annule')::int AS nb, COALESCE(SUM(a.total) FILTER (WHERE a.statut<>'annule'),0)::int AS montant,
      MAX(a.date_achat) AS dernier FROM fournisseurs f LEFT JOIN achats a ON a.fournisseur_id=f.id
      WHERE f.actif AND ($1='' OR f.nom ILIKE '%'||$1||'%' OR f.telephone ILIKE '%'||$1||'%' OR f.ville ILIKE '%'||$1||'%') GROUP BY f.id ORDER BY f.nom`,
  },
};

Object.entries(TYPES).forEach(([cle, T]) => {
  router.get(`/${cle}`, async (req, res, next) => {
    try {
      const q = String(req.query.q || '').trim();
      res.render('admin/contacts', { titre: T.titre, page: T.page, T, cle, q, lignes: await db.all(T.liste, [q]) });
    } catch (e) { next(e); }
  });
  router.get(`/${cle}/nouveau`, (req, res) => res.render('admin/contact_form', { titre: `Nouveau ${T.un}`, page: T.page, T, cle, c: {}, historique: [] }));
  router.get(`/${cle}/:id`, async (req, res, next) => {
    try {
      const c = await db.one(`SELECT * FROM ${T.table} WHERE id=$1`, [int(req.params.id)]);
      if (!c) return next();
      const historique = cle === 'clients'
        ? await db.all(`SELECT v.id, v.numero AS ref, v.created_at AS date, v.total, v.statut, v.source,
            (SELECT string_agg(quantite||' × '||libelle, ', ') FROM vente_lignes WHERE vente_id=v.id) AS detail
            FROM ventes v WHERE client_id=$1 ORDER BY created_at DESC`, [c.id])
        : await db.all(`SELECT a.id, COALESCE(a.reference, 'ACH-'||a.id) AS ref, a.date_achat AS date, a.total, a.statut,
            (SELECT string_agg(al.quantite||' × '||p.nom, ', ') FROM achat_lignes al JOIN variantes v ON v.id=al.variante_id JOIN produits p ON p.id=v.produit_id WHERE achat_id=a.id) AS detail
            FROM achats a WHERE fournisseur_id=$1 ORDER BY date_achat DESC, id DESC`, [c.id]);
      const commandes = cle === 'clients' && c.telephone
        ? await db.all("SELECT numero, created_at, total, statut FROM commandes WHERE RIGHT(regexp_replace(telephone,'\\D','','g'),8)=RIGHT(regexp_replace($1,'\\D','','g'),8) ORDER BY created_at DESC", [c.telephone])
        : [];
      return res.render('admin/contact_form', { titre: c.nom, page: T.page, T, cle, c, historique, commandes });
    } catch (e) { return next(e); }
  });
  router.post([`/${cle}/nouveau`, `/${cle}/:id`], async (req, res, next) => {
    try {
      const noms = T.champs.map((ch) => ch[0]);
      const vals = noms.map((n) => (String(req.body[n] || '').trim() || null));
      if (!vals[0]) { req.session.flash = { type: 'erreur', msg: 'Le nom est obligatoire.' }; return res.redirect('back'); }
      let id = req.params.id ? int(req.params.id) : null;
      if (id) {
        await db.query(`UPDATE ${T.table} SET ${noms.map((n, i) => `${n}=$${i + 1}`).join(', ')} WHERE id=$${noms.length + 1}`, [...vals, id]);
      } else {
        id = (await db.one(`INSERT INTO ${T.table} (${noms.join(',')}) VALUES (${noms.map((n, i) => `$${i + 1}`).join(',')}) RETURNING id`, vals)).id;
      }
      req.session.flash = { type: 'ok', msg: 'Enregistré ✔' };
      return res.redirect(`/gestion/${cle}/${id}`);
    } catch (e) { return next(e); }
  });
  router.post(`/${cle}/:id/supprimer`, async (req, res, next) => {
    try {
      if (cle === 'fournisseurs') await db.query('UPDATE fournisseurs SET actif=FALSE WHERE id=$1', [int(req.params.id)]);
      else await db.query('DELETE FROM clients WHERE id=$1', [int(req.params.id)]);
      req.session.flash = { type: 'ok', msg: 'Supprimé.' };
      res.redirect(`/gestion/${cle}`);
    } catch (e) { next(e); }
  });
});

module.exports = router;
