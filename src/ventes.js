const { mouvement, libelleVariante } = require('./stock');
const { numero } = require('./utils');

/**
 * Crée une vente complète dans une transaction existante (client pg).
 * lignes: [{ varianteId, quantite, prix (optionnel → prix catalogue) }]
 */
async function creerVente(c, { lignes, clientId, utilisateurId, source = 'caisse', remise = 0, modePaiement = 'Espèces', montantRecu = null, reference }) {
  if (!lignes || !lignes.length) { const e = new Error('Le panier est vide.'); e.status = 400; throw e; }
  const num = await numero('V', 'ventes');
  const details = [];
  let sousTotal = 0;
  for (const l of lignes) {
    const q = parseInt(l.quantite, 10);
    if (!q || q <= 0) continue;
    const r = await c.query(`SELECT v.id, v.taille, v.couleur, p.nom, p.prix_achat, COALESCE(p.prix_promo, p.prix_vente) AS prix
      FROM variantes v JOIN produits p ON p.id=v.produit_id WHERE v.id=$1`, [l.varianteId]);
    const v = r.rows[0];
    if (!v) { const e = new Error('Article introuvable.'); e.status = 400; throw e; }
    const prix = l.prix != null && l.prix !== '' ? Math.max(0, parseInt(l.prix, 10)) : v.prix;
    details.push({ v, q, prix });
    sousTotal += prix * q;
  }
  if (!details.length) { const e = new Error('Le panier est vide.'); e.status = 400; throw e; }
  remise = Math.min(Math.max(0, parseInt(remise, 10) || 0), sousTotal);
  const total = sousTotal - remise;
  const vr = await c.query(`INSERT INTO ventes (numero, client_id, utilisateur_id, source, sous_total, remise, total, mode_paiement, montant_recu)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id, numero`,
  [num, clientId || null, utilisateurId || null, source, sousTotal, remise, total, modePaiement, montantRecu]);
  const vente = vr.rows[0];
  for (const d of details) {
    await c.query('INSERT INTO vente_lignes (vente_id, variante_id, libelle, quantite, prix_unitaire, cout_unitaire) VALUES ($1,$2,$3,$4,$5,$6)',
      [vente.id, d.v.id, libelleVariante(d.v.nom, d.v.taille, d.v.couleur), d.q, d.prix, d.v.prix_achat || 0]);
    await mouvement(c, { varianteId: d.v.id, quantite: -d.q, type: 'vente', reference: reference || num, utilisateurId });
  }
  return { id: vente.id, numero: vente.numero, total };
}

async function annulerVente(c, venteId, utilisateurId) {
  const r = await c.query("SELECT * FROM ventes WHERE id=$1 FOR UPDATE", [venteId]);
  const v = r.rows[0];
  if (!v) throw new Error('Vente introuvable');
  if (v.statut === 'annulee') return;
  const lignes = await c.query('SELECT * FROM vente_lignes WHERE vente_id=$1', [venteId]);
  for (const l of lignes.rows) {
    if (l.variante_id) await mouvement(c, { varianteId: l.variante_id, quantite: l.quantite, type: 'annulation', reference: v.numero, motif: 'Annulation de vente', utilisateurId, autoriserNegatif: true });
  }
  await c.query("UPDATE ventes SET statut='annulee' WHERE id=$1", [venteId]);
}

module.exports = { creerVente, annulerVente };
