from __future__ import annotations

from typing import Annotated

from fastapi import Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from .db import get_db
from .models import AuditLog, Role, User
from .security import AUTH_COOKIE, client_ip, decode_access_token

DB = Annotated[Session, Depends(get_db)]


def _load_user(request: Request, db: Session) -> User | None:
    token = request.cookies.get(AUTH_COOKIE)
    if not token:
        return None
    payload = decode_access_token(token)
    if not payload:
        return None
    user = db.get(User, int(payload["sub"]))
    if not user or not user.is_active or user.token_version != payload["ver"]:
        return None
    return user


def optional_user(request: Request, db: DB) -> User | None:
    return _load_user(request, db)


def current_user(request: Request, db: DB) -> User:
    user = _load_user(request, db)
    if not user:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Authentification requise")
    return user


def require_roles(*roles: Role):
    allowed = {r.value for r in roles}

    def dep(user: Annotated[User, Depends(current_user)]) -> User:
        if user.role not in allowed:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Permissions insuffisantes")
        return user

    return dep


CurrentUser = Annotated[User, Depends(current_user)]
OptionalUser = Annotated[User | None, Depends(optional_user)]
ManagerUser = Annotated[User, Depends(require_roles(Role.manager, Role.admin))]
AdminUser = Annotated[User, Depends(require_roles(Role.admin))]


def audit(
    db: Session,
    action: str,
    request: Request | None = None,
    user: User | None = None,
    entity: str = "",
    entity_id: str | int = "",
    **meta,
) -> None:
    """Journalise une opération sensible (ajoutée à la transaction courante)."""
    db.add(
        AuditLog(
            user_id=user.id if user else None,
            action=action,
            entity=entity,
            entity_id=str(entity_id),
            ip=client_ip(request) if request else "",
            meta=meta,
        )
    )
