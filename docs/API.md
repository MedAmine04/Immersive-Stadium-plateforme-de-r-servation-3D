# API (préfixe /api)
- `GET /health`
- Auth : `GET /auth/csrf`, `POST /auth/register|login|logout|forgot-password|reset-password`, `GET /auth/me`
- Stade : `GET /venues`, `/venues/{slug}`, `/venues/{slug}/sections/{code}/seats` (ETag), `/venues/{slug}/seats/{id}`
- Événements : `GET /events`, `/events/{id}`, `/events/{id}/availability`, `POST /events/{id}/recommend`
- Réservations : `POST /reservations/locks` (en-tête `Idempotency-Key`), `POST /reservations/{id}/confirm|cancel`, `GET /reservations`
- Admin (gestionnaire/administrateur) : `/admin/stats`, `/admin/events`, `/admin/reservations`, `/admin/venues/{slug}/...`, `/admin/users`, `/admin/audit`
Les requêtes modifiantes exigent l'en-tête `X-CSRF-Token` (cookie `csrf_token`). La documentation Swagger est disponible sur `/api/docs` hors production.
