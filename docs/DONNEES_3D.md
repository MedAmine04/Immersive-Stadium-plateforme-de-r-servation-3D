# Données 3D : estimé vs vérifié

Aucun plan ni inventaire officiel des sièges n'est public. Le stade est donc généré par `apps/api/app/generator/stadium.py` à partir de dimensions publiques (terrain 105×68, capacité 68 700, Kop sud ≈ 23 000 sur deux niveaux, porte-à-faux de 8 m, toit périphérique) et d'un profil de visibilité (valeur C). Chaque siège porte `estimated=true`, et l'interface affiche en permanence « Modèle estimé · vues indicatives ».

## Remplacer par des données officielles
1. **Géométrie visuelle** : importer un GLB dans *Admin → Stade & ressources* (provenance « Officielle » ou « Capturée »). Chaque import est versionné et activable.
2. **Inventaire des sièges** : remplacer l'appel à `generate()` dans `app/seed.py` par un import (CSV/JSON) vers `sections`, `rows`, `seats`, `seat_geometry` avec `estimated=false`, puis passer `venue.data_fidelity` à `verified`. L'avertissement disparaît automatiquement.
3. **Vues depuis le siège** : les métriques (distance, élévation, dégagement, couverture) sont recalculées côté API depuis la géométrie ; des panoramas capturés peuvent être ajoutés comme ressources `panorama`.
