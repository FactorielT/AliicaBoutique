const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../../src/db');
const { int } = require('../../src/utils');
const { requireProprietaire } = require('../../src/auth');

const router = express.Router();

router.get('/parametres', async (req, res, next) => {
  try {
    const utilisateurs = res.locals.estProprietaire ? await db.all('SELECT id, nom, identifiant, role, actif, created_at FROM utilisateurs ORDER BY role DESC, nom') : [];
    res.render('admin/parametres', { titre: 'Paramètres', page: 'parametres', utilisateurs });
  } catch (e) { next(e); }
});

router.post('/parametres/mot-de-passe', async (req, res, next) => {
  try {
    const u = await db.one('SELECT * FROM utilisateurs WHERE id=$1', [req.session.user.id]);
    const { actuel, nouveau, confirmation } = req.body;
    let msg = null;
    if (!bcrypt.compareSync(String(actuel || ''), u.mot_de_passe)) msg = 'Mot de passe actuel incorrect.';
    else if (String(nouveau || '').length < 6) msg = 'Le nouveau mot de passe doit faire au moins 6 caractères.';
    else if (nouveau !== confirmation) msg = 'Les deux mots de passe ne correspondent pas.';
    if (msg) { req.session.flash = { type: 'erreur', msg }; return res.redirect('/gestion/parametres'); }
    await db.query('UPDATE utilisateurs SET mot_de_passe=$1 WHERE id=$2', [bcrypt.hashSync(nouveau, 10), u.id]);
    req.session.flash = { type: 'ok', msg: 'Mot de passe modifié ✔' };
    return res.redirect('/gestion/parametres');
  } catch (e) { return next(e); }
});

router.post('/parametres/utilisateurs', requireProprietaire, async (req, res, next) => {
  try {
    const b = req.body;
    const role = b.role === 'proprietaire' ? 'proprietaire' : 'gerante';
    const identifiant = String(b.identifiant || '').trim().toLowerCase().replace(/\s+/g, '');
    if (b.id) {
      const id = int(b.id);
      if (id === req.session.user.id && (role !== 'proprietaire' || !b.actif)) {
        req.session.flash = { type: 'erreur', msg: 'Vous ne pouvez pas retirer vos propres droits de propriétaire.' };
        return res.redirect('/gestion/parametres');
      }
      await db.query('UPDATE utilisateurs SET nom=$1, identifiant=$2, role=$3, actif=$4 WHERE id=$5', [b.nom, identifiant, role, !!b.actif, id]);
      if (b.mot_de_passe) await db.query('UPDATE utilisateurs SET mot_de_passe=$1 WHERE id=$2', [bcrypt.hashSync(b.mot_de_passe, 10), id]);
    } else {
      if (!b.nom || !identifiant || String(b.mot_de_passe || '').length < 6) {
        req.session.flash = { type: 'erreur', msg: 'Nom, identifiant et mot de passe (6 caractères min.) obligatoires.' };
        return res.redirect('/gestion/parametres');
      }
      await db.query('INSERT INTO utilisateurs (nom, identifiant, mot_de_passe, role) VALUES ($1,$2,$3,$4)', [b.nom, identifiant, bcrypt.hashSync(b.mot_de_passe, 10), role]);
    }
    req.session.flash = { type: 'ok', msg: 'Utilisateur enregistré ✔' };
    return res.redirect('/gestion/parametres');
  } catch (e) {
    if (e.code === '23505') { req.session.flash = { type: 'erreur', msg: 'Cet identifiant existe déjà.' }; return res.redirect('/gestion/parametres'); }
    return next(e);
  }
});

module.exports = router;
