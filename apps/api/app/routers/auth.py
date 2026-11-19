from __future__ import annotations

import logging
import secrets
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy import select

from ..config import get_settings
from ..deps import DB, CurrentUser, audit
from ..models import PasswordResetToken, Role, User
from ..schemas import ForgotIn, LoginIn, RegisterIn, ResetIn, UserOut
from ..security import (
    AUTH_COOKIE,
    CSRF_COOKIE,
    burn_password_check,
    create_access_token,
    hash_password,
    hash_token,
    new_csrf_token,
    rate_limit,
    validate_password_strength,
    verify_password,
)

router = APIRouter(prefix="/api/auth", tags=["auth"])
settings = get_settings()
log = logging.getLogger("auth")

MAX_FAILED = 5
LOCK_MINUTES = 15


def _set_session(response: Response, user: User) -> None:
    response.set_cookie(
        AUTH_COOKIE,
        create_access_token(user.id, user.token_version),
        max_age=settings.access_token_minutes * 60,
        httponly=True,
        secure=settings.cookie_secure,
        samesite=settings.cookie_samesite,
        path="/",
    )
    response.set_cookie(
        CSRF_COOKIE,
        new_csrf_token(),
        max_age=settings.access_token_minutes * 60,
        httponly=False,  # lisible par le JS pour l'envoyer en en-tête (double-submit)
        secure=settings.cookie_secure,
        samesite=settings.cookie_samesite,
        path="/",
    )


@router.get("/csrf")
def csrf(response: Response) -> dict:
    """Pose un jeton CSRF pour les visiteurs non connectés (formulaires de connexion/inscription)."""
    token = new_csrf_token()
    response.set_cookie(
        CSRF_COOKIE, token, httponly=False, secure=settings.cookie_secure, samesite=settings.cookie_samesite, path="/"
    )
    return {"csrf_token": token}


@router.post("/register", response_model=UserOut, status_code=201, dependencies=[Depends(rate_limit("register", 10, 3600))])
def register(body: RegisterIn, request: Request, response: Response, db: DB):
    validate_password_strength(body.password)
    email = body.email.lower()
    if db.scalar(select(User.id).where(User.email == email)):
        # message volontairement générique côté client ; le conflit reste détectable seulement à l'inscription
        raise HTTPException(status.HTTP_409_CONFLICT, "Impossible de créer ce compte avec ces informations")
    user = User(email=email, password_hash=hash_password(body.password), full_name=body.full_name, role=Role.spectator.value)
    db.add(user)
    db.flush()
    audit(db, "auth.register", request, user, "user", user.id)
    db.commit()
    _set_session(response, user)
    return user


@router.post("/login", response_model=UserOut, dependencies=[Depends(rate_limit("login", 20, 300))])
def login(body: LoginIn, request: Request, response: Response, db: DB):
    now = datetime.now(timezone.utc)
    user = db.scalar(select(User).where(User.email == body.email.lower()))
    generic = HTTPException(status.HTTP_401_UNAUTHORIZED, "Identifiants invalides")
    if not user:
        burn_password_check()
        raise generic
    if user.locked_until and user.locked_until > now:
        burn_password_check()
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "Compte temporairement verrouillé, réessayez plus tard")
    if not user.is_active or not verify_password(body.password, user.password_hash):
        if user.is_active:
            user.failed_logins += 1
            if user.failed_logins >= MAX_FAILED:
                user.locked_until = now + timedelta(minutes=LOCK_MINUTES)
                user.failed_logins = 0
                audit(db, "auth.lockout", request, user, "user", user.id)
            db.commit()
        raise generic
    user.failed_logins = 0
    user.locked_until = None
    user.last_login_at = now
    audit(db, "auth.login", request, user, "user", user.id)
    db.commit()
    _set_session(response, user)
    return user


@router.post("/logout", status_code=204)
def logout(response: Response):
    response.delete_cookie(AUTH_COOKIE, path="/")
    response.delete_cookie(CSRF_COOKIE, path="/")
    return Response(status_code=204)


@router.get("/me", response_model=UserOut)
def me(user: CurrentUser):
    return user


@router.post("/forgot-password", status_code=202, dependencies=[Depends(rate_limit("forgot", 5, 3600))])
def forgot_password(body: ForgotIn, request: Request, db: DB):
    """Réponse identique que le compte existe ou non. En développement, le lien est journalisé."""
    user = db.scalar(select(User).where(User.email == body.email.lower()))
    if user and user.is_active:
        raw = secrets.token_urlsafe(32)
        db.add(
            PasswordResetToken(
                user_id=user.id, token_hash=hash_token(raw), expires_at=datetime.now(timezone.utc) + timedelta(minutes=30)
            )
        )
        audit(db, "auth.forgot", request, user, "user", user.id)
        db.commit()
        if not settings.is_production:
            log.warning("[DEV] Lien de réinitialisation pour %s : /reset-password?token=%s", user.email, raw)
        # En production : envoyer le lien par e-mail via le fournisseur SMTP configuré.
    return {"message": "Si un compte existe pour cette adresse, un lien de réinitialisation a été envoyé."}


@router.post("/reset-password", status_code=204, dependencies=[Depends(rate_limit("reset", 10, 3600))])
def reset_password(body: ResetIn, request: Request, db: DB):
    validate_password_strength(body.password)
    now = datetime.now(timezone.utc)
    tok = db.scalar(select(PasswordResetToken).where(PasswordResetToken.token_hash == hash_token(body.token)).with_for_update())
    if not tok or tok.used_at or tok.expires_at <= now:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Lien invalide ou expiré")
    user = db.get(User, tok.user_id)
    user.password_hash = hash_password(body.password)
    user.token_version += 1  # invalide toutes les sessions existantes
    user.failed_logins = 0
    user.locked_until = None
    tok.used_at = now
    audit(db, "auth.reset", request, user, "user", user.id)
    db.commit()
    return Response(status_code=204)
