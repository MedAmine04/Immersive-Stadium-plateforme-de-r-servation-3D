from __future__ import annotations

import hashlib
import os
import secrets
import struct

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from sqlalchemy import func, select, update
from sqlalchemy.orm import selectinload

from ..config import get_settings
from ..deps import DB, AdminUser, ManagerUser, audit
from ..models import (
    AuditLog, Event, EventPrice, EventSection, EventSeatBlock, MediaAsset, Reservation, ReservationItem,
    ReservationStatus, Seat, Section, TicketCategory, User, Venue,
)
from ..schemas import (
    ActiveIn, AssetPatch, EventIn, EventPatch, RoleIn, SeatBlockIn, SeatServiceIn, SectionCategoryIn,
)
from ..security import rate_limit
from ..services import booking
from ..services.seat_index import invalidate
from .events import event_out

router = APIRouter(prefix="/api/admin", tags=["admin"])
settings = get_settings()

ALLOWED_UPLOADS = {
    "shell_glb": {"model/gltf-binary"},
    "panorama": {"image/jpeg", "image/png", "image/webp"},
    "image": {"image/jpeg", "image/png", "image/webp"},
}


def _sniff(kind: str, head: bytes) -> str | None:
    """Type réel déterminé par les octets magiques (le nom et l'en-tête client ne sont pas fiables)."""
    if kind == "shell_glb":
        if head[:4] == b"glTF" and len(head) >= 12 and struct.unpack("<I", head[4:8])[0] == 2:
            return "model/gltf-binary"
        return None
    if head[:3] == b"\xff\xd8\xff":
        return "image/jpeg"
    if head[:8] == b"\x89PNG\r\n\x1a\n":
        return "image/png"
    if head[:4] == b"RIFF" and head[8:12] == b"WEBP":
        return "image/webp"
    return None


# ----- Tableau de bord ------------------------------------------------------- #
@router.get("/stats")
def stats(db: DB, user: ManagerUser):
    by_status = dict(db.execute(select(Reservation.status, func.count()).group_by(Reservation.status)).all())
    revenue = db.scalar(select(func.coalesce(func.sum(Reservation.total_minor), 0)).where(Reservation.status == "confirmed"))
    per_event = db.execute(
        select(Event.id, Event.title, func.count(ReservationItem.id))
        .join(ReservationItem, ReservationItem.event_id == Event.id)
        .where(ReservationItem.status == "confirmed").group_by(Event.id, Event.title)
    ).all()
    return {
        "reservations": by_status, "demo_total_minor": int(revenue or 0),
        "events": db.scalar(select(func.count()).select_from(Event)),
        "users": db.scalar(select(func.count()).select_from(User)),
        "seats_sold_per_event": [{"event_id": i, "title": t, "seats": n} for i, t, n in per_event],
        "notice": "Montants de démonstration : aucun paiement réel.",
    }


# ----- Événements ------------------------------------------------------------ #
def _apply_prices(db, ev: Event, prices, venue_id: int) -> None:
    cats = {c.code: c for c in db.scalars(select(TicketCategory).where(TicketCategory.venue_id == venue_id))}
    for p in prices:
        cat = cats.get(p.category_code)
        if not cat:
            raise HTTPException(422, f"Catégorie inconnue : {p.category_code}")
        row = db.scalar(select(EventPrice).where(EventPrice.event_id == ev.id, EventPrice.category_id == cat.id))
        if row:
            row.price_minor, row.on_sale = p.price_minor, p.on_sale
        else:
            db.add(EventPrice(event_id=ev.id, category_id=cat.id, price_minor=p.price_minor, on_sale=p.on_sale))


def _apply_closed(db, ev: Event, closed: list[str]) -> None:
    secs = {s.code: s for s in db.scalars(select(Section).where(Section.venue_id == ev.venue_id))}
    unknown = [c for c in closed if c not in secs]
    if unknown:
        raise HTTPException(422, f"Secteurs inconnus : {unknown}")
    db.execute(EventSection.__table__.delete().where(EventSection.event_id == ev.id))
    for code in closed:
        db.add(EventSection(event_id=ev.id, section_id=secs[code].id, on_sale=False))


@router.get("/events")
def admin_events(db: DB, user: ManagerUser):
    return [event_out(db, e) for e in db.scalars(select(Event).order_by(Event.starts_at.desc()))]


@router.post("/events", status_code=201)
def create_event(body: EventIn, request: Request, db: DB, user: ManagerUser):
    v = db.scalar(select(Venue).where(Venue.slug == body.venue_slug))
    if not v:
        raise HTTPException(404, "Lieu introuvable")
    ev = Event(venue_id=v.id, title=body.title, kind=body.kind, description=body.description,
               starts_at=body.starts_at, status=body.status, demo_mode=True, created_by=user.id)
    db.add(ev)
    db.flush()
    prices = body.prices
    if prices is None:  # par défaut : tarifs du lieu
        from ..schemas import EventPriceIn
        prices = [EventPriceIn(category_code=c.code, price_minor=c.default_price_minor)
                  for c in db.scalars(select(TicketCategory).where(TicketCategory.venue_id == v.id))]
    _apply_prices(db, ev, prices, v.id)
    _apply_closed(db, ev, body.closed_sections)
    audit(db, "event.create", request, user, "event", ev.id)
    db.commit()
    return event_out(db, ev)


@router.patch("/events/{event_id}")
def patch_event(event_id: int, body: EventPatch, request: Request, db: DB, user: ManagerUser):
    ev = db.get(Event, event_id)
    if not ev:
        raise HTTPException(404, "Événement introuvable")
    data = body.model_dump(exclude_unset=True)
    for k in ("title", "kind", "description", "starts_at", "status"):
        if k in data and data[k] is not None:
            setattr(ev, k, data[k])
    if body.prices is not None:
        _apply_prices(db, ev, body.prices, ev.venue_id)
    if body.closed_sections is not None:
        _apply_closed(db, ev, body.closed_sections)
    audit(db, "event.update", request, user, "event", ev.id, fields=list(data))
    db.commit()
    return event_out(db, ev)


# ----- Réservations ---------------------------------------------------------- #
@router.get("/reservations")
def admin_reservations(db: DB, user: ManagerUser, event_id: int | None = None, status: str | None = None, limit: int = 100):
    q = select(Reservation).options(selectinload(Reservation.items).selectinload(ReservationItem.seat), selectinload(Reservation.event))
    if event_id:
        q = q.where(Reservation.event_id == event_id)
    if status:
        q = q.where(Reservation.status == status)
    rows = db.scalars(q.order_by(Reservation.created_at.desc()).limit(min(max(limit, 1), 500))).all()
    emails = dict(db.execute(select(User.id, User.email).where(User.id.in_({r.user_id for r in rows}))).all()) if rows else {}
    out = []
    for r in rows:
        d = booking.serialize_reservation(r, include_user=True)
        d["user_email"] = emails.get(r.user_id)
        out.append(d)
    return out


@router.post("/reservations/{rid}/cancel")
def admin_cancel(rid: str, request: Request, db: DB, user: ManagerUser):
    res = booking.cancel_reservation(db, user, rid, staff=True)
    audit(db, "booking.admin_cancel", request, user, "reservation", rid)
    db.commit()
    return booking.serialize_reservation(res, include_user=True)


# ----- Infrastructure : secteurs et sièges ----------------------------------- #
@router.patch("/venues/{slug}/sections/{code}/category")
def set_section_category(slug: str, code: str, body: SectionCategoryIn, request: Request, db: DB, user: ManagerUser):
    v = db.scalar(select(Venue).where(Venue.slug == slug))
    sec = db.scalar(select(Section).where(Section.venue_id == v.id, Section.code == code)) if v else None
    cat = db.scalar(select(TicketCategory).where(TicketCategory.venue_id == v.id, TicketCategory.code == body.category_code)) if v else None
    if not sec or not cat:
        raise HTTPException(404, "Secteur ou catégorie introuvable")
    sec.category_id = cat.id
    audit(db, "section.category", request, user, "section", sec.id, category=cat.code)
    db.commit()
    invalidate(v.id)
    return {"section": sec.code, "category": cat.code}


def _target_seat_ids(db, venue_id: int, seat_ids, section_code, row=None) -> list[int]:
    q = select(Seat.id).where(Seat.venue_id == venue_id)
    if seat_ids:
        q = q.where(Seat.id.in_(seat_ids))
    elif section_code:
        q = q.join(Section, Section.id == Seat.section_id).where(Section.code == section_code)
        if row:
            from ..models import Row
            q = q.join(Row, Row.id == Seat.row_id).where(Row.number == row)
    else:
        raise HTTPException(422, "Précisez seat_ids ou section_code")
    return list(db.scalars(q))


@router.post("/venues/{slug}/seats/service")
def seats_service(slug: str, body: SeatServiceIn, request: Request, db: DB, user: ManagerUser):
    v = db.scalar(select(Venue).where(Venue.slug == slug))
    if not v:
        raise HTTPException(404, "Lieu introuvable")
    ids = _target_seat_ids(db, v.id, body.seat_ids, body.section_code, body.row)
    if not ids:
        raise HTTPException(404, "Aucun siège concerné")
    db.execute(update(Seat).where(Seat.id.in_(ids)).values(out_of_service=body.out_of_service))
    audit(db, "seat.service", request, user, "venue", v.id, count=len(ids), out_of_service=body.out_of_service)
    db.commit()
    return {"updated": len(ids), "out_of_service": body.out_of_service}


@router.post("/events/{event_id}/seat-blocks")
def seat_blocks(event_id: int, body: SeatBlockIn, request: Request, db: DB, user: ManagerUser):
    ev = db.get(Event, event_id)
    if not ev:
        raise HTTPException(404, "Événement introuvable")
    ids = _target_seat_ids(db, ev.venue_id, body.seat_ids, body.section_code)
    existing = set(db.scalars(select(EventSeatBlock.seat_id).where(EventSeatBlock.event_id == ev.id, EventSeatBlock.seat_id.in_(ids))))
    if body.blocked:
        for sid in ids:
            if sid not in existing:
                db.add(EventSeatBlock(event_id=ev.id, seat_id=sid, reason=body.reason))
    else:
        db.execute(EventSeatBlock.__table__.delete().where(EventSeatBlock.event_id == ev.id, EventSeatBlock.seat_id.in_(ids)))
    audit(db, "event.seat_blocks", request, user, "event", ev.id, count=len(ids), blocked=body.blocked)
    db.commit()
    return {"updated": len(ids), "blocked": body.blocked}


# ----- Ressources 3D --------------------------------------------------------- #
@router.get("/venues/{slug}/assets")
def list_assets(slug: str, db: DB, user: ManagerUser):
    v = db.scalar(select(Venue).where(Venue.slug == slug))
    if not v:
        raise HTTPException(404, "Lieu introuvable")
    return [
        {"id": a.id, "kind": a.kind, "name": a.original_name, "version": a.version, "source": a.source,
         "is_active": a.is_active, "size": a.size_bytes, "sha256": a.sha256, "notes": a.notes,
         "created_at": a.created_at.isoformat()}
        for a in db.scalars(select(MediaAsset).where(MediaAsset.venue_id == v.id).order_by(MediaAsset.created_at.desc()))
    ]


@router.post("/venues/{slug}/assets", status_code=201, dependencies=[Depends(rate_limit("upload", 20, 3600))])
async def upload_asset(slug: str, request: Request, db: DB, user: ManagerUser, file: UploadFile = File(...),
                       kind: str = Form(...), source: str = Form("original"), notes: str = Form("")):
    if kind not in ALLOWED_UPLOADS:
        raise HTTPException(422, "Type de ressource non pris en charge")
    if source not in ("official", "captured", "original", "ai_generated"):
        raise HTTPException(422, "Provenance invalide")
    v = db.scalar(select(Venue).where(Venue.slug == slug))
    if not v:
        raise HTTPException(404, "Lieu introuvable")
    os.makedirs(settings.upload_dir, exist_ok=True)
    limit = settings.max_upload_mb * 1024 * 1024
    storage = secrets.token_hex(16)
    path = os.path.join(settings.upload_dir, storage)
    sha, size, head = hashlib.sha256(), 0, b""
    try:
        with open(path, "wb") as out:
            while chunk := await file.read(1024 * 1024):
                if not head:
                    head = chunk[:16]
                size += len(chunk)
                if size > limit:
                    raise HTTPException(413, f"Fichier trop volumineux (max {settings.max_upload_mb} Mo)")
                sha.update(chunk)
                out.write(chunk)
        ctype = _sniff(kind, head)
        if size == 0 or not ctype:
            raise HTTPException(415, "Contenu du fichier non reconnu ou non conforme au type déclaré")
    except Exception:
        if os.path.exists(path):
            os.remove(path)
        raise
    version = (db.scalar(select(func.max(MediaAsset.version)).where(MediaAsset.venue_id == v.id, MediaAsset.kind == kind)) or 0) + 1
    asset = MediaAsset(venue_id=v.id, kind=kind, original_name=os.path.basename(file.filename or "fichier")[:255],
                       storage_name=storage, content_type=ctype, sha256=sha.hexdigest(), size_bytes=size,
                       version=version, source=source, notes=notes[:1000], uploaded_by=user.id, is_active=False)
    db.add(asset)
    db.flush()
    audit(db, "asset.upload", request, user, "asset", asset.id, kind=kind, size=size)
    db.commit()
    return {"id": asset.id, "version": version, "sha256": asset.sha256, "is_active": False}


@router.patch("/venues/{slug}/assets/{asset_id}")
def patch_asset(slug: str, asset_id: int, body: AssetPatch, request: Request, db: DB, user: ManagerUser):
    v = db.scalar(select(Venue).where(Venue.slug == slug))
    a = db.scalar(select(MediaAsset).where(MediaAsset.id == asset_id, MediaAsset.venue_id == v.id)) if v else None
    if not a:
        raise HTTPException(404, "Ressource introuvable")
    if body.notes is not None:
        a.notes = body.notes
    if body.is_active is not None:
        if body.is_active:  # une seule version active par type
            db.execute(update(MediaAsset).where(MediaAsset.venue_id == v.id, MediaAsset.kind == a.kind).values(is_active=False))
        a.is_active = body.is_active
    audit(db, "asset.update", request, user, "asset", a.id, active=a.is_active)
    db.commit()
    return {"id": a.id, "is_active": a.is_active}


# ----- Administration de la plateforme --------------------------------------- #
@router.get("/users")
def list_users(db: DB, user: AdminUser, limit: int = 200):
    return [{"id": u.id, "email": u.email, "full_name": u.full_name, "role": u.role, "is_active": u.is_active,
             "created_at": u.created_at.isoformat(), "last_login_at": u.last_login_at.isoformat() if u.last_login_at else None}
            for u in db.scalars(select(User).order_by(User.id).limit(min(max(limit, 1), 1000)))]


@router.patch("/users/{uid}/role")
def set_role(uid: int, body: RoleIn, request: Request, db: DB, user: AdminUser):
    target = db.get(User, uid)
    if not target:
        raise HTTPException(404, "Utilisateur introuvable")
    if target.id == user.id:
        raise HTTPException(409, "Vous ne pouvez pas modifier votre propre rôle")
    target.role = body.role
    target.token_version += 1
    audit(db, "user.role", request, user, "user", uid, role=body.role)
    db.commit()
    return {"id": uid, "role": target.role}


@router.patch("/users/{uid}/active")
def set_active(uid: int, body: ActiveIn, request: Request, db: DB, user: AdminUser):
    target = db.get(User, uid)
    if not target:
        raise HTTPException(404, "Utilisateur introuvable")
    if target.id == user.id:
        raise HTTPException(409, "Vous ne pouvez pas désactiver votre propre compte")
    target.is_active = body.is_active
    target.token_version += 1
    audit(db, "user.active", request, user, "user", uid, active=body.is_active)
    db.commit()
    return {"id": uid, "is_active": target.is_active}


@router.get("/audit")
def audit_log(db: DB, user: AdminUser, limit: int = 100):
    rows = db.scalars(select(AuditLog).order_by(AuditLog.id.desc()).limit(min(max(limit, 1), 500))).all()
    return [{"id": r.id, "ts": r.ts.isoformat(), "user_id": r.user_id, "action": r.action, "entity": r.entity,
             "entity_id": r.entity_id, "ip": r.ip, "meta": r.meta} for r in rows]
