from __future__ import annotations

import hashlib
import hmac
import re
import secrets
import threading
import time
from collections import defaultdict, deque
from datetime import datetime, timedelta, timezone

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError
from fastapi import HTTPException, Request, status

from .config import get_settings

settings = get_settings()
_ph = PasswordHasher()  # Argon2id, paramètres par défaut recommandés

AUTH_COOKIE = "stadium_session"
CSRF_COOKIE = "csrf_token"
CSRF_HEADER = "x-csrf-token"
SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}


# --------------------------------------------------------------------------- #
# Mots de passe
# --------------------------------------------------------------------------- #
def hash_password(password: str) -> str:
    return _ph.hash(password)


def verify_password(password: str, hashed: str) -> bool:
    try:
        return _ph.verify(hashed, password)
    except (VerifyMismatchError, VerificationError, InvalidHashError):
        return False


_DUMMY_HASH = _ph.hash("dummy-password-for-timing")


def burn_password_check() -> None:
    """Égalise le temps de réponse quand l'utilisateur n'existe pas (anti-énumération)."""
    verify_password("x", _DUMMY_HASH)


def validate_password_strength(password: str) -> None:
    errors = []
    if len(password) < 10:
        errors.append("au moins 10 caractères")
    if len(password) > 128:
        errors.append("au plus 128 caractères")
    if not re.search(r"[A-Za-z]", password):
        errors.append("au moins une lettre")
    if not re.search(r"\d", password):
        errors.append("au moins un chiffre")
    if errors:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Mot de passe trop faible : " + ", ".join(errors))


# --------------------------------------------------------------------------- #
# JWT de session (cookie httpOnly)
# --------------------------------------------------------------------------- #
def create_access_token(user_id: int, token_version: int) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "sub": str(user_id),
        "ver": token_version,
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(minutes=settings.access_token_minutes)).timestamp()),
    }
    return jwt.encode(payload, settings.secret_key, algorithm="HS256")


def decode_access_token(token: str) -> dict | None:
    try:
        return jwt.decode(token, settings.secret_key, algorithms=["HS256"], options={"require": ["exp", "sub", "ver"]})
    except jwt.PyJWTError:
        return None


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def new_csrf_token() -> str:
    return secrets.token_urlsafe(32)


# --------------------------------------------------------------------------- #
# CSRF (double-submit cookie) : appliqué à toutes les méthodes non sûres
# --------------------------------------------------------------------------- #
async def csrf_protect(request: Request) -> None:
    if request.method in SAFE_METHODS:
        return
    cookie = request.cookies.get(CSRF_COOKIE)
    header = request.headers.get(CSRF_HEADER)
    if not cookie or not header or not hmac.compare_digest(cookie, header):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Jeton CSRF manquant ou invalide")


# --------------------------------------------------------------------------- #
# Limitation de débit (en mémoire, par processus)
# --------------------------------------------------------------------------- #
class RateLimiter:
    def __init__(self) -> None:
        self._hits: dict[str, deque[float]] = defaultdict(deque)
        self._lock = threading.Lock()

    def check(self, key: str, limit: int, window_seconds: int) -> None:
        if not settings.rate_limit_enabled:
            return
        now = time.monotonic()
        with self._lock:
            q = self._hits[key]
            while q and q[0] <= now - window_seconds:
                q.popleft()
            if len(q) >= limit:
                retry = int(window_seconds - (now - q[0])) + 1
                raise HTTPException(
                    status.HTTP_429_TOO_MANY_REQUESTS,
                    "Trop de requêtes, réessayez plus tard",
                    headers={"Retry-After": str(retry)},
                )
            q.append(now)

    def reset(self) -> None:
        with self._lock:
            self._hits.clear()


limiter = RateLimiter()


def client_ip(request: Request) -> str:
    # Derrière un proxy de confiance, X-Forwarded-For est positionné par le proxy (Next.js / reverse proxy).
    fwd = request.headers.get("x-forwarded-for")
    if fwd:
        return fwd.split(",")[0].strip()[:64]
    return (request.client.host if request.client else "unknown")[:64]


def rate_limit(name: str, limit: int, window_seconds: int):
    async def dep(request: Request) -> None:
        limiter.check(f"{name}:{client_ip(request)}", limit, window_seconds)

    return dep
