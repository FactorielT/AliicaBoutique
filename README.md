# ALIICA BOUTIQUE — Site web + Application de gestion

Node.js **24 LTS (≥ 24.22.1)** · Express + EJS · PostgreSQL · prêt pour Render.

Un seul projet contient :

- **le site public** (`/`) : accueil avec diaporama et sections, menus Hommes / Femmes, catalogue avec filtres, fiche produit (tailles, couleurs), favoris, panier, commande avec code promo, suivi de commande, WhatsApp ;
- **l'application de gestion**, accessible uniquement par l'adresse secrète **`/applicationlogin`** (aucun lien sur le site) : tableau de bord, caisse, ventes, articles, stock, approvisionnements, clients, fournisseurs, rapports, dépenses et administration du site web.

## Démarrage en local

```bash
npm install
cp .env.example .env        # puis adaptez DATABASE_URL
npm start                   # site : http://localhost:3000   application : http://localhost:3000/applicationlogin
```

Au premier démarrage, l'application crée automatiquement les tables, les catégories, les pages d'information, le code `ALIICA2025` et un **catalogue de démonstration** (à désactiver avec `SEED_DEMO=false`).

| Compte | Identifiant | Mot de passe par défaut | Accès |
|---|---|---|---|
| Propriétaire | `patronne` | `Aliica@2025` | Tout |
| Gérante | `gerante` | `Gerante@2025` | Tout sauf les données financières |

➡️ **Changez ces mots de passe dès la première connexion** (Paramètres), ou définissez `PROPRIETAIRE_PASSWORD` / `GERANTE_PASSWORD` avant le premier lancement.

## Déploiement sur Render

1. Poussez le projet sur GitHub (`git init && git add . && git commit -m "ALIICA" && git push`).
2. Sur Render : **New → Blueprint**, choisissez le dépôt : `render.yaml` crée la base PostgreSQL `aliica-db` et le service web `aliica-boutique`.
   *(Ou manuellement : créez une base PostgreSQL, puis un Web Service Node avec `npm install` / `npm start` et les variables `DATABASE_URL` (Internal URL), `SESSION_SECRET`, `NODE_ENV=production`, `TZ=Africa/Abidjan`.)*
3. Chaque `git push` redéploie automatiquement.

Les photos sont enregistrées **dans PostgreSQL** (redimensionnées en WebP) : elles ne disparaissent pas lors des redéploiements Render.

## Accès à l'application

- Adresse de connexion : `https://<votre-site>/applicationlogin` (modifiable avec la variable `APP_LOGIN_PATH`).
- Aucun bouton ni lien du site ne mène à l'application, et `robots.txt` ne la mentionne pas.
- Une personne non connectée qui tape `/gestion/...` obtient « Page introuvable » : l'existence de l'application n'est pas révélée.
- Sur un appareil où la patronne ou la gérante s'est déjà connectée, une session expirée ramène directement à la page de connexion.
- Après déconnexion, on revient sur `/applicationlogin`.

## Sécurité — avis Render d'octobre 2026

Le projet applique les consignes de l'avis Render (certificats eMudhra compromis le 19/10, correctifs Node.js du 21/10 : contournement de la vérification TLS du nom d'hôte, faille de décompression Brotli). PHP n'est pas concerné : le projet n'en utilise pas.

| Règle | Ce qui est fait dans le code |
|---|---|
| Node.js corrigé | `package.json` → `"engines": { "node": ">=24.22.1 <25" }` (Render prend la dernière 24.x). Au démarrage, **l'application refuse de se lancer en production** sur un Node.js vulnérable (< 22.23.4, < 24.22.1, < 26.12.1, ou < 22). |
| Pas de confiance aveugle aux certificats | Démarrage refusé en production si `NODE_TLS_REJECT_UNAUTHORIZED=0`, si `NODE_OPTIONS` contient `--use-bundled-ca`, ou si `DATABASE_SSL_NO_VERIFY=true`. |
| Connexion PostgreSQL | URL **interne** Render (réseau privé) : rien ne passe par Internet. Base joignable par Internet : TLS **obligatoire avec vérification du certificat et du nom d'hôte** (l'ancien `rejectUnauthorized: false` a été supprimé). Les paramètres `sslmode=` de l'URL sont ignorés au profit de cette politique. Autorité spécifique possible via `DATABASE_SSL_CA`. |
| Faille Brotli | Le serveur ne décompresse **jamais** de données envoyées par un client : les requêtes `Content-Encoding: gzip/deflate/br` sont refusées (415) et `inflate: false` est imposé aux parseurs. |
| Dépendances à jour | Toutes à la dernière version, `npm audit` : 0 vulnérabilité. Build Render en `npm ci` (versions exactes du `package-lock.json`). |
| Secrets | En production, `SESSION_SECRET` doit faire ≥ 32 caractères aléatoires (généré par `render.yaml`). Cookie de session `httpOnly`, `secure`, `sameSite`. |
| Scripts tiers | Chart.js chargé avec contrôle d'intégrité (SRI) : un fichier modifié sur le CDN est bloqué par le navigateur. En-têtes HTTP de sécurité ajoutés (nosniff, anti-iframe, HSTS…). |

### À faire sur Render (service déjà en ligne)

1. **Dashboard → service → Environment** : supprimez la variable `NODE_VERSION` si elle existe (elle passe avant `package.json`), ou mettez-la à `24.22.1` minimum.
2. Vérifiez que `DATABASE_URL` utilise l'**Internal Database URL** et qu'aucune variable `NODE_TLS_REJECT_UNAUTHORIZED`, `DATABASE_SSL_NO_VERIFY` ou `NODE_OPTIONS=--use-bundled-ca` n'est définie.
3. Poussez le code (`git push`) puis **Manual Deploy → Clear build cache & deploy** pour reconstruire avec le nouveau Node.js et le magasin de certificats à jour.
4. Dans l'onglet **Shell** du service : `npm run verifier:securite`. Les deux adresses de test eMudhra doivent être **rejetées** (erreur de certificat).

Solution provisoire uniquement si la mise à jour est impossible : `NODE_OPTIONS=--use-openssl-ca` (consigne Render).

## Règle de confidentialité

| | Propriétaire | Gérante |
|---|---|---|
| Ventes, caisse, annulations | ✅ | ✅ |
| Articles, prix de vente, promos | ✅ | ✅ |
| Approvisionnements, stock, inventaire | ✅ | ✅ |
| Clients, fournisseurs | ✅ | ✅ |
| Rapports (CA, ventes, top articles) | ✅ | ✅ |
| Administration du site web, commandes web | ✅ | ✅ |
| **Prix d'achat, marges, bénéfice, coût des ventes** | ✅ | ❌ masqué |
| **Dépenses** | ✅ | ❌ (erreur 403) |
| **Valeur du stock au prix d'achat** | ✅ | ❌ |
| Gestion des utilisateurs | ✅ | ❌ |

Les restrictions sont appliquées côté serveur (routes protégées, champs ignorés), pas seulement masquées à l'écran.

## Fonctionnement

- **Stock par variante** (taille × couleur). Chaque entrée / sortie crée un mouvement tracé (vente, achat, ajustement, inventaire, annulation).
- **Caisse** : recherche, choix de la variante, remise, 6 modes de paiement (Espèces, Carte, Orange Money, MTN Money, Wave, Moov Money), calcul de la monnaie, ticket imprimable 80 mm.
- **Approvisionnement** : à la réception, le stock augmente et le prix d'achat est recalculé (coût moyen pondéré) → les marges restent justes.
- **Commandes du site** : statut *Nouvelle → Confirmée → Livrée*. La confirmation crée la vente, le client et sort le stock ; une annulation remet le stock.
- **Code promo** : pourcentage, date de fin, option « première commande uniquement » (vérifiée par numéro de téléphone).
- **Mon site web** : diaporama (photo + textes + aperçu en direct), sections de l'accueil (onglets produits, bannière 2 photos, offre spéciale, texte libre) réordonnables, bandeau, logo, couleur, coordonnées, réseaux, pages d'information, newsletter (export CSV).

## Structure

```
server.js              point d'entrée
db/schema.sql          schéma PostgreSQL (idempotent)
src/                   base de données, initialisation, stock, ventes, réglages
routes/shop.js         site public
routes/admin/          application de gestion (un fichier par module)
views/shop, views/admin, views/partials
public/css, public/js, public/img
seed-images/           photos du catalogue de démonstration
```
