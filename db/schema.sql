-- ALIICA BOUTIQUE — Schéma PostgreSQL (idempotent : exécuté à chaque démarrage)

CREATE TABLE IF NOT EXISTS utilisateurs (
  id SERIAL PRIMARY KEY,
  nom TEXT NOT NULL,
  identifiant TEXT UNIQUE NOT NULL,
  mot_de_passe TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('proprietaire','gerante')),
  actif BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS images (
  id SERIAL PRIMARY KEY,
  mime TEXT NOT NULL,
  data BYTEA NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS categories (
  id SERIAL PRIMARY KEY,
  nom TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  genre TEXT NOT NULL DEFAULT 'mixte' CHECK (genre IN ('homme','femme','mixte')),
  ordre INT NOT NULL DEFAULT 0,
  afficher_menu BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS produits (
  id SERIAL PRIMARY KEY,
  nom TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  categorie_id INT REFERENCES categories(id) ON DELETE SET NULL,
  marque TEXT,
  description TEXT,
  prix_vente INT NOT NULL DEFAULT 0,
  prix_promo INT,
  prix_achat INT NOT NULL DEFAULT 0,          -- confidentiel (propriétaire)
  seuil_alerte INT NOT NULL DEFAULT 3,
  publie_site BOOLEAN NOT NULL DEFAULT TRUE,
  vedette BOOLEAN NOT NULL DEFAULT FALSE,
  actif BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS produit_images (
  id SERIAL PRIMARY KEY,
  produit_id INT NOT NULL REFERENCES produits(id) ON DELETE CASCADE,
  image_id INT NOT NULL REFERENCES images(id) ON DELETE CASCADE,
  ordre INT NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS variantes (
  id SERIAL PRIMARY KEY,
  produit_id INT NOT NULL REFERENCES produits(id) ON DELETE CASCADE,
  taille TEXT NOT NULL DEFAULT '',
  couleur TEXT NOT NULL DEFAULT '',
  stock INT NOT NULL DEFAULT 0,
  actif BOOLEAN NOT NULL DEFAULT TRUE,
  UNIQUE (produit_id, taille, couleur)
);

CREATE TABLE IF NOT EXISTS clients (
  id SERIAL PRIMARY KEY,
  nom TEXT NOT NULL,
  telephone TEXT,
  email TEXT,
  adresse TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS fournisseurs (
  id SERIAL PRIMARY KEY,
  nom TEXT NOT NULL,
  contact TEXT,
  telephone TEXT,
  email TEXT,
  ville TEXT,
  adresse TEXT,
  notes TEXT,
  actif BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS achats (
  id SERIAL PRIMARY KEY,
  reference TEXT,
  fournisseur_id INT REFERENCES fournisseurs(id) ON DELETE SET NULL,
  date_achat DATE NOT NULL DEFAULT CURRENT_DATE,
  statut TEXT NOT NULL DEFAULT 'recu' CHECK (statut IN ('en_attente','recu','annule')),
  total INT NOT NULL DEFAULT 0,
  notes TEXT,
  utilisateur_id INT REFERENCES utilisateurs(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS achat_lignes (
  id SERIAL PRIMARY KEY,
  achat_id INT NOT NULL REFERENCES achats(id) ON DELETE CASCADE,
  variante_id INT NOT NULL REFERENCES variantes(id),
  quantite INT NOT NULL,
  prix_unitaire INT NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS ventes (
  id SERIAL PRIMARY KEY,
  numero TEXT UNIQUE NOT NULL,
  client_id INT REFERENCES clients(id) ON DELETE SET NULL,
  utilisateur_id INT REFERENCES utilisateurs(id),
  source TEXT NOT NULL DEFAULT 'caisse' CHECK (source IN ('caisse','site')),
  sous_total INT NOT NULL DEFAULT 0,
  remise INT NOT NULL DEFAULT 0,
  total INT NOT NULL DEFAULT 0,
  mode_paiement TEXT NOT NULL DEFAULT 'Espèces',
  montant_recu INT,
  statut TEXT NOT NULL DEFAULT 'payee' CHECK (statut IN ('payee','annulee')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS vente_lignes (
  id SERIAL PRIMARY KEY,
  vente_id INT NOT NULL REFERENCES ventes(id) ON DELETE CASCADE,
  variante_id INT REFERENCES variantes(id) ON DELETE SET NULL,
  libelle TEXT NOT NULL,
  quantite INT NOT NULL,
  prix_unitaire INT NOT NULL,
  cout_unitaire INT NOT NULL DEFAULT 0       -- confidentiel (marge)
);

CREATE TABLE IF NOT EXISTS mouvements_stock (
  id SERIAL PRIMARY KEY,
  variante_id INT NOT NULL REFERENCES variantes(id) ON DELETE CASCADE,
  type TEXT NOT NULL,                         -- vente, achat, ajustement, annulation, inventaire
  quantite INT NOT NULL,                      -- + entrée / - sortie
  stock_apres INT NOT NULL,
  reference TEXT,
  motif TEXT,
  utilisateur_id INT REFERENCES utilisateurs(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS depenses (
  id SERIAL PRIMARY KEY,
  date_depense DATE NOT NULL DEFAULT CURRENT_DATE,
  libelle TEXT NOT NULL,
  categorie TEXT NOT NULL DEFAULT 'Autre',
  montant INT NOT NULL,
  utilisateur_id INT REFERENCES utilisateurs(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ===== Site web =====
CREATE TABLE IF NOT EXISTS parametres (
  cle TEXT PRIMARY KEY,
  valeur TEXT
);

CREATE TABLE IF NOT EXISTS slides (
  id SERIAL PRIMARY KEY,
  surtitre TEXT, titre TEXT, bouton_texte TEXT, lien TEXT,
  image_id INT REFERENCES images(id) ON DELETE SET NULL,
  couleur_fond TEXT NOT NULL DEFAULT '#f2f2f2',
  ordre INT NOT NULL DEFAULT 0,
  actif BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS sections (
  id SERIAL PRIMARY KEY,
  type TEXT NOT NULL CHECK (type IN ('onglets','banniere','offre','texte')),
  titre TEXT,
  config JSONB NOT NULL DEFAULT '{}',
  ordre INT NOT NULL DEFAULT 0,
  actif BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS pages (
  id SERIAL PRIMARY KEY,
  slug TEXT UNIQUE NOT NULL,
  titre TEXT NOT NULL,
  contenu TEXT NOT NULL DEFAULT '',
  publie BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS codes_promo (
  id SERIAL PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,
  pourcentage INT NOT NULL DEFAULT 0,
  premiere_commande BOOLEAN NOT NULL DEFAULT FALSE,
  date_fin DATE,
  actif BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS commandes (
  id SERIAL PRIMARY KEY,
  numero TEXT UNIQUE NOT NULL,
  nom TEXT NOT NULL, telephone TEXT NOT NULL, email TEXT,
  ville TEXT, adresse TEXT, notes TEXT,
  sous_total INT NOT NULL, remise INT NOT NULL DEFAULT 0, frais_livraison INT NOT NULL DEFAULT 0,
  total INT NOT NULL, code_promo TEXT,
  mode_paiement TEXT NOT NULL DEFAULT 'Paiement à la livraison',
  statut TEXT NOT NULL DEFAULT 'nouvelle' CHECK (statut IN ('nouvelle','confirmee','livree','annulee')),
  vente_id INT REFERENCES ventes(id) ON DELETE SET NULL,
  client_id INT REFERENCES clients(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS commande_lignes (
  id SERIAL PRIMARY KEY,
  commande_id INT NOT NULL REFERENCES commandes(id) ON DELETE CASCADE,
  variante_id INT REFERENCES variantes(id) ON DELETE SET NULL,
  libelle TEXT NOT NULL,
  quantite INT NOT NULL,
  prix_unitaire INT NOT NULL
);

CREATE TABLE IF NOT EXISTS newsletter (
  id SERIAL PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS "session" (
  "sid" varchar NOT NULL COLLATE "default" PRIMARY KEY,
  "sess" json NOT NULL,
  "expire" timestamp(6) NOT NULL
);
CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON "session" ("expire");

CREATE INDEX IF NOT EXISTS idx_ventes_date ON ventes(created_at);
CREATE INDEX IF NOT EXISTS idx_vl_vente ON vente_lignes(vente_id);
CREATE INDEX IF NOT EXISTS idx_var_produit ON variantes(produit_id);
CREATE INDEX IF NOT EXISTS idx_mvt_var ON mouvements_stock(variante_id);
CREATE INDEX IF NOT EXISTS idx_pimg ON produit_images(produit_id);
