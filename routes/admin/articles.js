const express = require('express');
const db = require('../../src/db');
const upload = require('../../src/upload');
const { int, uniqueSlug, saveImage } = require('../../src/utils');
const { mouvement } = require('../../src/stock');
const { estProprietaire } = require('../../src/auth');

const router = express.Router();

router.get('/articles', async (req, res, next) => {
  try {
    const q = String(req.query.q || '').trim();
    const cat = int(req.query.categorie) || null;
    const statut = req.query.statut || '';
    const produits = await db.all(`SELECT * FROM (
      SELECT p.*, c.nom AS categorie,
        (SELECT image_id FROM produit_images pi WHERE pi.produit_id=p.id ORDER BY ordre, id LIMIT 1) AS image_id,
        (SELECT COALESCE(SUM(stock),0) FROM variantes v WHERE v.produit_id=p.id AND v.actif)::int AS stock,
        (SELECT COUNT(*) FROM variantes v WHERE v.produit_id=p.id AND v.actif)::int AS nb_var
      FROM produits p LEFT JOIN categories c ON c.id=p.categorie_id
      WHERE p.actif AND ($1='' OR p.nom ILIKE '%'||$1||'%' OR p.marque ILIKE '%'||$1||'%') AND ($2::int IS NULL OR p.categorie_id=$2)) t
      WHERE ($3='' OR ($3='rupture' AND stock<=0) OR ($3='faible' AND stock>0 AND stock<=seuil_alerte) OR ($3='dispo' AND stock>seuil_alerte) OR ($3='hors_ligne' AND NOT publie_site))
      ORDER BY created_at DESC`, [q, cat, statut]);
    const categories = await db.all('SELECT * FROM categories ORDER BY ordre, nom');
    res.render('admin/articles', { titre: 'Articles', page: 'articles', produits, categories, q, cat, statut });
  } catch (e) { next(e); }
});

async function formData(id) {
  const categories = await db.all('SELECT * FROM categories ORDER BY ordre, nom');
  if (!id) return { p: { publie_site: true, seuil_alerte: 3 }, images: [], variantes: [], categories };
  const p = await db.one('SELECT * FROM produits WHERE id=$1', [id]);
  if (!p) return null;
  const images = await db.all('SELECT * FROM produit_images WHERE produit_id=$1 ORDER BY ordre, id', [id]);
  const variantes = await db.all('SELECT * FROM variantes WHERE produit_id=$1 AND actif ORDER BY id', [id]);
  return { p, images, variantes, categories };
}

router.get('/articles/nouveau', async (req, res, next) => {
  try { res.render('admin/article_form', { titre: 'Nouvel article', page: 'articles', ...(await formData()) }); } catch (e) { next(e); }
});
router.get('/articles/:id', async (req, res, next) => {
  try {
    const d = await formData(int(req.params.id));
    if (!d) return next();
    return res.render('admin/article_form', { titre: d.p.nom, page: 'articles', ...d });
  } catch (e) { return next(e); }
});

router.post(['/articles/nouveau', '/articles/:id'], upload.array('images', 12), async (req, res, next) => {
  try {
    const b = req.body;
    const id = req.params.id ? int(req.params.id) : null;
    const proprio = estProprietaire(req);
    const nom = String(b.nom || '').trim();
    if (!nom) { req.session.flash = { type: 'erreur', msg: 'Le nom est obligatoire.' }; return res.redirect('back'); }
    const champs = {
      nom, categorie_id: int(b.categorie_id) || null, marque: b.marque || null, description: b.description || null,
      prix_vente: int(b.prix_vente), prix_promo: b.prix_promo ? int(b.prix_promo) || null : null,
      seuil_alerte: int(b.seuil_alerte, 3), publie_site: !!b.publie_site, vedette: !!b.vedette,
    };
    if (champs.prix_promo && champs.prix_promo >= champs.prix_vente) champs.prix_promo = null;

    const pid = await db.tx(async (c) => {
      let produitId = id;
      if (id) {
        const slug = await uniqueSlug('produits', nom, id);
        await c.query(`UPDATE produits SET nom=$1, slug=$2, categorie_id=$3, marque=$4, description=$5, prix_vente=$6, prix_promo=$7,
          seuil_alerte=$8, publie_site=$9, vedette=$10 WHERE id=$11`,
        [nom, slug, champs.categorie_id, champs.marque, champs.description, champs.prix_vente, champs.prix_promo, champs.seuil_alerte, champs.publie_site, champs.vedette, id]);
        if (proprio && b.prix_achat !== undefined) await c.query('UPDATE produits SET prix_achat=$1 WHERE id=$2', [int(b.prix_achat), id]);
      } else {
        const slug = await uniqueSlug('produits', nom);
        const r = await c.query(`INSERT INTO produits (nom, slug, categorie_id, marque, description, prix_vente, prix_promo, prix_achat, seuil_alerte, publie_site, vedette)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
        [nom, slug, champs.categorie_id, champs.marque, champs.description, champs.prix_vente, champs.prix_promo, proprio ? int(b.prix_achat) : 0, champs.seuil_alerte, champs.publie_site, champs.vedette]);
        produitId = r.rows[0].id;
      }

      // Images : suppression, principale, ajouts
      const suppr = [].concat(b.suppr_image || []).map(Number);
      if (suppr.length) await c.query('DELETE FROM produit_images WHERE produit_id=$1 AND id = ANY($2)', [produitId, suppr]);
      for (const f of req.files || []) {
        const imgId = await saveImage(f.buffer, f.mimetype, 1400, c);
        await c.query('INSERT INTO produit_images (produit_id, image_id, ordre) VALUES ($1,$2,(SELECT COALESCE(MAX(ordre),0)+1 FROM produit_images WHERE produit_id=$1))', [produitId, imgId]);
      }
      if (b.principale) {
        await c.query('UPDATE produit_images SET ordre = ordre + 1 WHERE produit_id=$1', [produitId]);
        await c.query('UPDATE produit_images SET ordre = 0 WHERE produit_id=$1 AND id=$2', [produitId, int(b.principale)]);
      }

      // Variantes
      const vIds = [].concat(b.v_id || []); const vT = [].concat(b.v_taille || []); const vC = [].concat(b.v_couleur || []); const vS = [].concat(b.v_stock || []);
      const gardes = [];
      for (let i = 0; i < vT.length; i += 1) {
        const taille = String(vT[i] || '').trim(); const couleur = String(vC[i] || '').trim();
        const vid = int(vIds[i]) || null;
        if (vid) {
          await c.query('UPDATE variantes SET taille=$1, couleur=$2, actif=TRUE WHERE id=$3 AND produit_id=$4', [taille, couleur, vid, produitId]);
          gardes.push(vid);
        } else {
          const ex = await c.query('SELECT id FROM variantes WHERE produit_id=$1 AND taille=$2 AND couleur=$3', [produitId, taille, couleur]);
          let nid;
          if (ex.rows[0]) { nid = ex.rows[0].id; await c.query('UPDATE variantes SET actif=TRUE WHERE id=$1', [nid]); }
          else nid = (await c.query('INSERT INTO variantes (produit_id, taille, couleur, stock) VALUES ($1,$2,$3,0) RETURNING id', [produitId, taille, couleur])).rows[0].id;
          const st = int(vS[i]);
          if (st) await mouvement(c, { varianteId: nid, quantite: st, type: 'inventaire', motif: 'Stock initial', utilisateurId: req.session.user.id });
          gardes.push(nid);
        }
      }
      if (!gardes.length) {
        const ex = await c.query("SELECT id FROM variantes WHERE produit_id=$1 AND taille='' AND couleur=''", [produitId]);
        if (ex.rows[0]) { gardes.push(ex.rows[0].id); await c.query('UPDATE variantes SET actif=TRUE WHERE id=$1', [ex.rows[0].id]); }
        else gardes.push((await c.query("INSERT INTO variantes (produit_id) VALUES ($1) RETURNING id", [produitId])).rows[0].id);
      }
      await c.query('UPDATE variantes SET actif=FALSE WHERE produit_id=$1 AND NOT (id = ANY($2))', [produitId, gardes]);
      return produitId;
    });
    req.session.flash = { type: 'ok', msg: 'Article enregistré ✔' };
    return res.redirect(b.continuer ? '/gestion/articles/nouveau' : `/gestion/articles/${pid}`);
  } catch (e) {
    if (e.code === '23505') { req.session.flash = { type: 'erreur', msg: 'Deux variantes ont la même taille et couleur.' }; return res.redirect('back'); }
    return next(e);
  }
});

router.post('/articles/:id/supprimer', async (req, res, next) => {
  try {
    const id = int(req.params.id);
    const vendu = await db.one('SELECT 1 FROM vente_lignes vl JOIN variantes v ON v.id=vl.variante_id WHERE v.produit_id=$1 LIMIT 1', [id]);
    const achete = await db.one('SELECT 1 FROM achat_lignes al JOIN variantes v ON v.id=al.variante_id WHERE v.produit_id=$1 LIMIT 1', [id]);
    if (vendu || achete) await db.query('UPDATE produits SET actif=FALSE, publie_site=FALSE WHERE id=$1', [id]);
    else await db.query('DELETE FROM produits WHERE id=$1', [id]);
    req.session.flash = { type: 'ok', msg: 'Article supprimé.' };
    res.redirect('/gestion/articles');
  } catch (e) { next(e); }
});

router.post('/api/articles/:id/publie', async (req, res, next) => {
  try {
    const r = await db.one('UPDATE produits SET publie_site = $1 WHERE id=$2 RETURNING publie_site', [!!req.body.valeur, int(req.params.id)]);
    res.json({ ok: true, publie: r.publie_site });
  } catch (e) { next(e); }
});

// ---------- Catégories ----------
router.get('/categories', async (req, res, next) => {
  try {
    const categories = await db.all(`SELECT c.*, (SELECT COUNT(*) FROM produits p WHERE p.categorie_id=c.id AND p.actif)::int AS nb FROM categories c ORDER BY ordre, nom`);
    res.render('admin/categories', { titre: 'Catégories', page: 'articles', categories });
  } catch (e) { next(e); }
});
router.post('/categories', async (req, res, next) => {
  try {
    const b = req.body;
    const nom = String(b.nom || '').trim();
    if (!nom) return res.redirect('/gestion/categories');
    const genre = ['homme', 'femme', 'mixte'].includes(b.genre) ? b.genre : 'mixte';
    if (b.id) {
      await db.query('UPDATE categories SET nom=$1, genre=$2, ordre=$3, afficher_menu=$4, slug=$5 WHERE id=$6',
        [nom, genre, int(b.ordre), !!b.afficher_menu, await uniqueSlug('categories', nom, int(b.id)), int(b.id)]);
    } else {
      await db.query('INSERT INTO categories (nom, slug, genre, ordre, afficher_menu) VALUES ($1,$2,$3,$4,TRUE)', [nom, await uniqueSlug('categories', nom), genre, int(b.ordre)]);
    }
    req.session.flash = { type: 'ok', msg: 'Catégorie enregistrée.' };
    res.redirect('/gestion/categories');
  } catch (e) { next(e); }
});
router.post('/categories/:id/supprimer', async (req, res, next) => {
  try {
    await db.query('DELETE FROM categories WHERE id=$1', [int(req.params.id)]);
    req.session.flash = { type: 'ok', msg: 'Catégorie supprimée (les articles sont devenus « non classés »).' };
    res.redirect('/gestion/categories');
  } catch (e) { next(e); }
});

module.exports = router;
