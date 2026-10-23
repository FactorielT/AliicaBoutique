const express = require('express');
const db = require('../../src/db');
const settings = require('../../src/settings');
const upload = require('../../src/upload');
const { int, saveImage, slugify } = require('../../src/utils');
const { creerVente, annulerVente } = require('../../src/ventes');

const router = express.Router();
const ok = (req, msg) => { req.session.flash = { type: 'ok', msg }; };

// ---------- Accueil de la rubrique ----------
router.get('/site', async (req, res, next) => {
  try {
    const stats = await db.one(`SELECT
      (SELECT COUNT(*) FROM slides WHERE actif)::int AS slides,
      (SELECT COUNT(*) FROM sections WHERE actif)::int AS sections,
      (SELECT COUNT(*) FROM produits WHERE actif AND publie_site)::int AS produits,
      (SELECT COUNT(*) FROM newsletter)::int AS abonnes,
      (SELECT COUNT(*) FROM codes_promo WHERE actif)::int AS promos,
      (SELECT COUNT(*) FROM pages)::int AS pages`);
    res.render('admin/site', { titre: 'Mon site web', page: 'site', stats });
  } catch (e) { next(e); }
});

// ---------- Diaporama ----------
router.get('/site/diaporama', async (req, res, next) => {
  try {
    res.render('admin/site_slides', { titre: "Diaporama d'accueil", page: 'site', slides: await db.all('SELECT * FROM slides ORDER BY ordre, id') });
  } catch (e) { next(e); }
});
router.get(['/site/diaporama/nouveau', '/site/diaporama/:id'], async (req, res, next) => {
  try {
    const sl = req.params.id ? await db.one('SELECT * FROM slides WHERE id=$1', [int(req.params.id)]) : { couleur_fond: '#f2f2f2', actif: true, bouton_texte: 'FAITES UN ACHAT', lien: '/boutique' };
    if (!sl) return next();
    const categories = await db.all('SELECT nom, slug FROM categories ORDER BY ordre');
    return res.render('admin/site_slide_form', { titre: sl.id ? 'Modifier la diapositive' : 'Nouvelle diapositive', page: 'site', sl, categories });
  } catch (e) { return next(e); }
});
router.post(['/site/diaporama/nouveau', '/site/diaporama/:id'], upload.single('image'), async (req, res, next) => {
  try {
    const b = req.body;
    const imageId = req.file ? await saveImage(req.file.buffer, req.file.mimetype, 1400) : null;
    const vals = [b.surtitre || null, b.titre || null, b.bouton_texte || null, b.lien || '/boutique', b.couleur_fond || '#f2f2f2', !!b.actif];
    if (req.params.id) {
      await db.query(`UPDATE slides SET surtitre=$1, titre=$2, bouton_texte=$3, lien=$4, couleur_fond=$5, actif=$6 ${imageId ? ', image_id=' + Number(imageId) : ''} WHERE id=$7`, [...vals, int(req.params.id)]);
    } else {
      await db.query('INSERT INTO slides (surtitre, titre, bouton_texte, lien, couleur_fond, actif, image_id, ordre) VALUES ($1,$2,$3,$4,$5,$6,$7,(SELECT COALESCE(MAX(ordre),0)+1 FROM slides))', [...vals, imageId]);
    }
    ok(req, 'Diapositive enregistrée ✔ Elle est visible sur la page d\'accueil.');
    res.redirect('/gestion/site/diaporama');
  } catch (e) { next(e); }
});

// Déplacer / activer / supprimer — générique pour slides & sections
['slides', 'sections'].forEach((table) => {
  const base = table === 'slides' ? '/site/diaporama' : '/site/sections';
  router.post(`${base}/:id/deplacer`, async (req, res, next) => {
    try {
      const rows = await db.all(`SELECT id FROM ${table} ORDER BY ordre, id`);
      const i = rows.findIndex((r) => r.id === int(req.params.id));
      const j = req.body.sens === 'haut' ? i - 1 : i + 1;
      if (i >= 0 && j >= 0 && j < rows.length) [rows[i], rows[j]] = [rows[j], rows[i]];
      for (let k = 0; k < rows.length; k += 1) await db.query(`UPDATE ${table} SET ordre=$1 WHERE id=$2`, [k + 1, rows[k].id]);
      res.redirect(`/gestion${base}`);
    } catch (e) { next(e); }
  });
  router.post(`/api${base}/:id/actif`, async (req, res, next) => {
    try { await db.query(`UPDATE ${table} SET actif=$1 WHERE id=$2`, [!!req.body.valeur, int(req.params.id)]); res.json({ ok: true }); } catch (e) { next(e); }
  });
  router.post(`${base}/:id/supprimer`, async (req, res, next) => {
    try { await db.query(`DELETE FROM ${table} WHERE id=$1`, [int(req.params.id)]); ok(req, 'Supprimé.'); res.redirect(`/gestion${base}`); } catch (e) { next(e); }
  });
});

// ---------- Sections de la page d'accueil ----------
const TYPES_SECTIONS = {
  onglets: 'Produits par onglets (ex. Chemise / Ensemble)',
  banniere: 'Bannière avec 2 photos (ex. « L\'élégance en lin »)',
  offre: 'Bandeau noir « Offre spéciale »',
  texte: 'Texte libre (présentation, message…)',
};
router.get('/site/sections', async (req, res, next) => {
  try {
    const sections = await db.all('SELECT * FROM sections ORDER BY ordre, id');
    const categories = await db.all('SELECT id, nom FROM categories ORDER BY ordre');
    res.render('admin/site_sections', { titre: "Sections de la page d'accueil", page: 'site', sections, categories, TYPES_SECTIONS });
  } catch (e) { next(e); }
});
router.get(['/site/sections/nouveau', '/site/sections/:id'], async (req, res, next) => {
  try {
    const sec = req.params.id ? await db.one('SELECT * FROM sections WHERE id=$1', [int(req.params.id)])
      : { type: TYPES_SECTIONS[req.query.type] ? req.query.type : 'onglets', config: { nombre: 5, categories: [], couleur_fond: '#e1e6e4' }, actif: true };
    if (!sec) return next();
    const categories = await db.all('SELECT id, nom FROM categories ORDER BY ordre');
    return res.render('admin/site_section_form', { titre: TYPES_SECTIONS[sec.type], page: 'site', sec, categories });
  } catch (e) { return next(e); }
});
router.post(['/site/sections/nouveau', '/site/sections/:id'], upload.fields([{ name: 'image_gauche', maxCount: 1 }, { name: 'image_droite', maxCount: 1 }]), async (req, res, next) => {
  try {
    const b = req.body;
    const exist = req.params.id ? await db.one('SELECT * FROM sections WHERE id=$1', [int(req.params.id)]) : null;
    const type = exist ? exist.type : (TYPES_SECTIONS[b.type] ? b.type : 'onglets');
    const old = exist ? exist.config : {};
    let config = {};
    if (type === 'onglets') config = { categories: [].concat(b.categories || []).map(Number), nombre: Math.min(20, Math.max(1, int(b.nombre, 5))) };
    else if (type === 'banniere') {
      config = { surtitre: b.surtitre, titre: b.titre_banniere, bouton_texte: b.bouton_texte, lien: b.lien, couleur_fond: b.couleur_fond, image_gauche: old.image_gauche || null, image_droite: old.image_droite || null };
      for (const k of ['image_gauche', 'image_droite']) {
        const f = req.files && req.files[k] && req.files[k][0];
        if (f) config[k] = await saveImage(f.buffer, f.mimetype, 900);
        if (b[`suppr_${k}`]) config[k] = null;
      }
    } else if (type === 'offre') config = { titre: b.titre_offre, texte: b.texte, bouton_texte: b.bouton_texte, lien: b.lien };
    else config = { texte: b.texte };
    const titre = b.titre || (type === 'banniere' ? b.titre_banniere : type === 'offre' ? b.titre_offre : null);
    if (exist) await db.query('UPDATE sections SET titre=$1, config=$2, actif=$3 WHERE id=$4', [titre, config, !!b.actif, exist.id]);
    else await db.query('INSERT INTO sections (type, titre, config, actif, ordre) VALUES ($1,$2,$3,$4,(SELECT COALESCE(MAX(ordre),0)+1 FROM sections))', [type, titre, config, !!b.actif]);
    ok(req, 'Section enregistrée ✔');
    res.redirect('/gestion/site/sections');
  } catch (e) { next(e); }
});

// ---------- Apparence & informations ----------
router.get('/site/infos', async (req, res, next) => {
  try { res.render('admin/site_infos', { titre: 'Apparence & informations', page: 'site', s: await settings.getAll(true) }); } catch (e) { next(e); }
});
router.post('/site/infos', upload.single('logo'), async (req, res, next) => {
  try {
    const cles = ['nom_boutique', 'bandeau_texte', 'bandeau_lien_texte', 'description_footer', 'telephone', 'whatsapp', 'email', 'adresse', 'horaires_semaine',
      'horaires_weekend', 'facebook', 'instagram', 'tiktok', 'newsletter_titre', 'newsletter_texte', 'copyright', 'frais_livraison', 'livraison_texte', 'modes_paiement_site', 'couleur_accent'];
    const obj = {};
    cles.forEach((k) => { if (req.body[k] !== undefined) obj[k] = req.body[k]; });
    obj.bandeau_actif = req.body.bandeau_actif ? '1' : '0';
    if (req.file) obj.logo_image_id = String(await saveImage(req.file.buffer, req.file.mimetype, 500));
    if (req.body.suppr_logo) obj.logo_image_id = '';
    await settings.set(obj);
    ok(req, 'Informations enregistrées ✔ Le site est à jour.');
    res.redirect('/gestion/site/infos');
  } catch (e) { next(e); }
});

// ---------- Pages ----------
router.get('/site/pages', async (req, res, next) => {
  try { res.render('admin/site_pages', { titre: 'Pages d\'information', page: 'site', pages: await db.all('SELECT * FROM pages ORDER BY id'), edit: null }); } catch (e) { next(e); }
});
router.get('/site/pages/:id', async (req, res, next) => {
  try {
    const edit = req.params.id === 'nouvelle' ? { publie: true } : await db.one('SELECT * FROM pages WHERE id=$1', [int(req.params.id)]);
    if (!edit) return next();
    return res.render('admin/site_pages', { titre: 'Pages d\'information', page: 'site', pages: await db.all('SELECT * FROM pages ORDER BY id'), edit });
  } catch (e) { return next(e); }
});
router.post('/site/pages', async (req, res, next) => {
  try {
    const b = req.body;
    if (!b.titre) return res.redirect('/gestion/site/pages');
    if (b.id) await db.query('UPDATE pages SET titre=$1, contenu=$2, publie=$3 WHERE id=$4', [b.titre, b.contenu || '', !!b.publie, int(b.id)]);
    else {
      let slug = slugify(b.titre); let i = 1;
      while (await db.one('SELECT 1 FROM pages WHERE slug=$1', [slug])) { i += 1; slug = `${slugify(b.titre)}-${i}`; }
      await db.query('INSERT INTO pages (slug, titre, contenu, publie) VALUES ($1,$2,$3,$4)', [slug, b.titre, b.contenu || '', !!b.publie]);
    }
    ok(req, 'Page enregistrée ✔');
    return res.redirect('/gestion/site/pages');
  } catch (e) { return next(e); }
});
router.post('/site/pages/:id/supprimer', async (req, res, next) => {
  try { await db.query('DELETE FROM pages WHERE id=$1', [int(req.params.id)]); ok(req, 'Page supprimée.'); res.redirect('/gestion/site/pages'); } catch (e) { next(e); }
});

// ---------- Codes promo ----------
router.get('/site/promos', async (req, res, next) => {
  try {
    const promos = await db.all(`SELECT cp.*, (SELECT COUNT(*) FROM commandes WHERE UPPER(code_promo)=UPPER(cp.code) AND statut<>'annulee')::int AS utilisations FROM codes_promo cp ORDER BY id DESC`);
    res.render('admin/site_promos', { titre: 'Codes promo', page: 'site', promos });
  } catch (e) { next(e); }
});
router.post('/site/promos', async (req, res, next) => {
  try {
    const b = req.body;
    const code = String(b.code || '').trim().toUpperCase().replace(/\s+/g, '');
    if (!code || !int(b.pourcentage)) { req.session.flash = { type: 'erreur', msg: 'Code et pourcentage obligatoires.' }; return res.redirect('/gestion/site/promos'); }
    await db.query(`INSERT INTO codes_promo (code, pourcentage, premiere_commande, date_fin, actif) VALUES ($1,$2,$3,$4,TRUE)
      ON CONFLICT (code) DO UPDATE SET pourcentage=EXCLUDED.pourcentage, premiere_commande=EXCLUDED.premiere_commande, date_fin=EXCLUDED.date_fin, actif=TRUE`,
    [code, Math.min(90, int(b.pourcentage)), !!b.premiere_commande, b.date_fin || null]);
    ok(req, `Code ${code} enregistré ✔`);
    return res.redirect('/gestion/site/promos');
  } catch (e) { return next(e); }
});
router.post('/api/site/promos/:id/actif', async (req, res, next) => {
  try { await db.query('UPDATE codes_promo SET actif=$1 WHERE id=$2', [!!req.body.valeur, int(req.params.id)]); res.json({ ok: true }); } catch (e) { next(e); }
});
router.post('/site/promos/:id/supprimer', async (req, res, next) => {
  try { await db.query('DELETE FROM codes_promo WHERE id=$1', [int(req.params.id)]); ok(req, 'Code supprimé.'); res.redirect('/gestion/site/promos'); } catch (e) { next(e); }
});

// ---------- Newsletter ----------
router.get('/site/newsletter', async (req, res, next) => {
  try { res.render('admin/site_newsletter', { titre: 'Abonnés newsletter', page: 'site', abonnes: await db.all('SELECT * FROM newsletter ORDER BY created_at DESC') }); } catch (e) { next(e); }
});
router.get('/site/newsletter.csv', async (req, res, next) => {
  try {
    const rows = await db.all("SELECT email, to_char(created_at,'DD/MM/YYYY') AS date FROM newsletter ORDER BY created_at");
    res.set('Content-Type', 'text/csv; charset=utf-8').set('Content-Disposition', 'attachment; filename="newsletter.csv"');
    res.send('﻿email;date\n' + rows.map((r) => `${r.email};${r.date}`).join('\n'));
  } catch (e) { next(e); }
});
router.post('/site/newsletter/:id/supprimer', async (req, res, next) => {
  try { await db.query('DELETE FROM newsletter WHERE id=$1', [int(req.params.id)]); res.redirect('/gestion/site/newsletter'); } catch (e) { next(e); }
});

// ---------- Commandes du site ----------
router.get('/commandes', async (req, res, next) => {
  try {
    const statut = req.query.statut || '';
    const commandes = await db.all(`SELECT k.*, (SELECT SUM(quantite) FROM commande_lignes WHERE commande_id=k.id)::int AS articles
      FROM commandes k WHERE ($1='' OR statut=$1) ORDER BY created_at DESC LIMIT 300`, [statut]);
    const compte = await db.all('SELECT statut, COUNT(*)::int AS n FROM commandes GROUP BY statut');
    res.render('admin/commandes', { titre: 'Commandes du site web', page: 'commandes', commandes, statut, compte });
  } catch (e) { next(e); }
});
router.get('/commandes/:id', async (req, res, next) => {
  try {
    const k = await db.one('SELECT * FROM commandes WHERE id=$1', [int(req.params.id)]);
    if (!k) return next();
    k.lignes = await db.all(`SELECT cl.*, v.stock FROM commande_lignes cl LEFT JOIN variantes v ON v.id=cl.variante_id WHERE commande_id=$1`, [k.id]);
    return res.render('admin/commande', { titre: `Commande ${k.numero}`, page: 'commandes', k });
  } catch (e) { return next(e); }
});
router.post('/commandes/:id/statut', async (req, res, next) => {
  const id = int(req.params.id);
  try {
    const nouveau = req.body.statut;
    await db.tx(async (c) => {
      const k = (await c.query('SELECT * FROM commandes WHERE id=$1 FOR UPDATE', [id])).rows[0];
      if (!k) throw new Error('Commande introuvable');
      if ((nouveau === 'confirmee' || nouveau === 'livree') && !k.vente_id) {
        // Création / rattachement du client, puis de la vente (sortie de stock)
        const tel8 = k.telephone.replace(/\D/g, '').slice(-8);
        let cl = (await c.query("SELECT id FROM clients WHERE RIGHT(regexp_replace(COALESCE(telephone,''),'\\D','','g'),8)=$1 LIMIT 1", [tel8])).rows[0];
        if (!cl) cl = (await c.query('INSERT INTO clients (nom, telephone, email, adresse) VALUES ($1,$2,$3,$4) RETURNING id', [k.nom, k.telephone, k.email, [k.adresse, k.ville].filter(Boolean).join(', ')])).rows[0];
        const lignes = (await c.query('SELECT * FROM commande_lignes WHERE commande_id=$1', [id])).rows;
        if (lignes.some((l) => !l.variante_id)) throw Object.assign(new Error('Un article de la commande n\'existe plus.'), { status: 400 });
        const v = await creerVente(c, {
          lignes: lignes.map((l) => ({ varianteId: l.variante_id, quantite: l.quantite, prix: l.prix_unitaire })),
          clientId: cl.id, utilisateurId: req.session.user.id, source: 'site', remise: k.remise, modePaiement: k.mode_paiement, reference: k.numero,
        });
        await c.query('UPDATE commandes SET vente_id=$1, client_id=$2 WHERE id=$3', [v.id, cl.id, id]);
      }
      if (nouveau === 'annulee' && k.vente_id) await annulerVente(c, k.vente_id, req.session.user.id);
      if (['nouvelle', 'confirmee', 'livree', 'annulee'].includes(nouveau)) {
        await c.query('UPDATE commandes SET statut=$1 WHERE id=$2', [nouveau, id]);
        if (nouveau === 'nouvelle' && k.vente_id) {
          await annulerVente(c, k.vente_id, req.session.user.id);
          await c.query('UPDATE commandes SET vente_id=NULL WHERE id=$1', [id]);
        }
      }
    });
    ok(req, { confirmee: 'Commande confirmée : la vente est enregistrée et le stock mis à jour ✔', livree: 'Commande marquée comme livrée ✔', annulee: 'Commande annulée (stock restitué si nécessaire).', nouvelle: 'Commande remise en attente.' }[nouveau] || 'Mis à jour');
    res.redirect(`/gestion/commandes/${id}`);
  } catch (e) {
    if (e.status === 400) { req.session.flash = { type: 'erreur', msg: e.message }; return res.redirect(`/gestion/commandes/${id}`); }
    return next(e);
  }
});

module.exports = router;
