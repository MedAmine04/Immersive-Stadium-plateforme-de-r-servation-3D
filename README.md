# Immersive Stadium — plateforme de réservation 3D

Explorez le Complexe Sportif Prince Moulay Abdellah (Rabat) en 3D, choisissez un siège précis, voyez la vue depuis ce siège, comparez jusqu'à 3 places et réservez avec verrouillage temporaire (10 min) sans double réservation.

> **Version de démonstration** : aucun paiement réel, les confirmations ne sont pas des billets.
> **Modèle estimé** : le stade est généré de façon procédurale (68 700 places, Kop sud 23 000 sur deux niveaux avec porte-à-faux, toit 360°). Les vues sont **indicatives**, non issues de plans officiels (voir `docs/DONNEES_3D.md`).

## Démarrage rapide (Windows)

### Option A — tout dans Docker (recommandé)
1. Lancez Docker Desktop.
2. Double-cliquez `scripts\start-docker.bat` (ou `docker compose up --build -d`).
3. Attendez ~1 min au premier démarrage, puis ouvrez **http://localhost:3000**.
4. Arrêt : `scripts\stop.bat`.

### Option B — application en local, base dans Docker
Prérequis : Node.js 20+, Python 3.11+, Docker. Double-cliquez `scripts\start-local.bat`.

## Comptes de démonstration
| Rôle | E-mail | Mot de passe |
|---|---|---|
| Administrateur | admin@stadium.demo | Admin#Stadium2026 |
| Gestionnaire | manager@stadium.demo | Manager#Stadium2026 |
| Spectateur | fan@stadium.demo | Fan#Stadium2026 |

## Utilisation
- **Spectateur** : accueil → événement → cliquez un secteur (3D ou plan 2D) → un siège → « Voir depuis ce siège » → Ajouter / Comparer → panneau Sélection → confirmer. L'onglet *Recommandations* propose des places selon vos critères, avec explication.
- **Gestionnaire** (`/admin`) : événements (tarifs par catégorie, tribunes fermées), réservations, catégories des secteurs, sièges hors service, import de modèles 3D (GLB) et images.
- **Administrateur** : en plus, utilisateurs/rôles et journal d'audit.

## Architecture
```
apps/api   FastAPI + SQLAlchemy + PostgreSQL (source de vérité des réservations)
apps/web   Next.js 16 + React Three Fiber (rendu 3D adaptatif, aucune carte graphique puissante requise)
```
Réservation : index unique partiel `uq_active_seat_per_event` (un siège ne peut avoir qu'une réservation active par événement), verrous de ligne, expiration paresseuse + balayeur, clés d'idempotence, plafond de 8 sièges par utilisateur.
Sécurité : Argon2id, JWT en cookie httpOnly, protection CSRF, limitation de débit, verrouillage de compte, journal d'audit, contrôle des fichiers importés (signature binaire, taille), en-têtes de sécurité, refus de démarrer en production avec une configuration par défaut.

## Tests
```
cd apps/api && pip install -r requirements-dev.txt
set DATABASE_URL=postgresql+psycopg://stadium:stadium_local_pwd@localhost:5433/stadium_test
python -m pytest                      # 25 tests (réservation, sécurité, générateur)
cd apps/web && npx playwright test    # parcours bout en bout (API + web démarrés)
```
(Créez d'abord la base `stadium_test` : `docker compose exec db createdb -U stadium stadium_test`.)

## Passage en production
Définir `ENV=production`, `SECRET_KEY` (≥ 32 car.), `COOKIE_SECURE=true` (HTTPS), `SEED_DEMO_USERS=false`, un `DATABASE_URL` non par défaut, et créer le premier administrateur via `ADMIN_EMAIL` / `ADMIN_PASSWORD`. Voir `.env.example` et `docs/`.
