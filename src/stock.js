/** Mouvement de stock atomique (à appeler dans une transaction) */
async function mouvement(client, { varianteId, quantite, type, reference, motif, utilisateurId, autoriserNegatif = false }) {
  const r = await client.query(
    `SELECT v.id, v.stock, p.nom, v.taille, v.couleur FROM variantes v JOIN produits p ON p.id=v.produit_id WHERE v.id=$1 FOR UPDATE OF v`,
    [varianteId]
  );
  const v = r.rows[0];
  if (!v) throw new Error('Article introuvable');
  const nouveau = v.stock + quantite;
  if (nouveau < 0 && !autoriserNegatif) {
    const lib = [v.nom, v.taille, v.couleur].filter(Boolean).join(' / ');
    const err = new Error(`Stock insuffisant pour « ${lib} » (disponible : ${v.stock})`);
    err.status = 400;
    throw err;
  }
  await client.query('UPDATE variantes SET stock=$1 WHERE id=$2', [nouveau, varianteId]);
  await client.query(
    `INSERT INTO mouvements_stock (variante_id, type, quantite, stock_apres, reference, motif, utilisateur_id) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [varianteId, type, quantite, nouveau, reference || null, motif || null, utilisateurId || null]
  );
  return nouveau;
}

function libelleVariante(nom, taille, couleur) {
  const ext = [taille, couleur].filter(Boolean).join(' / ');
  return ext ? `${nom} (${ext})` : nom;
}

module.exports = { mouvement, libelleVariante };
