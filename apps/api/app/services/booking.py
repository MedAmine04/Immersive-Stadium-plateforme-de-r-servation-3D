"""Moteur de réservation.

Garanties :
  * PostgreSQL est la source de vérité : l'index unique partiel ``uq_active_seat_per_event``
    interdit physiquement deux réservations actives pour le même siège et le même événement.
  * Le verrouillage est temporaire (``lock_minutes``) ; les verrous expirés sont libérés par
    un balayeur périodique ET paresseusement à chaque nouvelle tentative de verrouillage.
  * Confirmation / annulation : transaction atomique avec verrou de ligne sur la réservation.
  * Ordre de verrouillage constant (réservation puis lignes) pour éviter les interblocages.
  * Idempotence : l'en-tête ``Idempotency-Key`` rend une requête répétée sans effet.
"""
from __future__ import annotations

import secrets
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException
from sqlalchemy import and_, func, or_, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from ..config import get_settings
from ..models import (
    ACTIVE_ITEM_STATUSES,
    Event,
    EventPrice,
    EventSeatBlock,
    EventSection,
    EventStatus,
    ItemStatus,
    Reservation,
    ReservationItem,
    ReservationStatus,
    Seat,
    Section,
    TicketCategory,
    User,
)

settings = get_settings()
REF_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
DEMO_NOTICE = (
    "CONFIRMATION DE DÉMONSTRATION — ce document n'est pas un billet et ne donne aucun accès au stade. "
    "Aucun paiement n'a été effectué."
)


class BookingError(HTTPException):
    def __init__(self, status_code: int, code: str, message: str, **extra):
        super().__init__(status_code=status_code, detail={"code": code, "message": message, **extra})


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _new_reference() -> str:
    return "DEMO-" + "".join(secrets.choice(REF_ALPHABET) for _ in range(8))


# --------------------------------------------------------------------------- #
# Vendabilité
# --------------------------------------------------------------------------- #
def event_context(db: Session, event: Event) -> dict:
    cats = {c.id: c for c in db.scalars(select(TicketCategory).where(TicketCategory.venue_id == event.venue_id))}
    prices = {p.category_id: p for p in db.scalars(select(EventPrice).where(EventPrice.event_id == event.id))}
    sec_cfg = {s.section_id: s for s in db.scalars(select(EventSection).where(EventSection.event_id == event.id))}
    return {"cats": cats, "prices": prices, "sec_cfg": sec_cfg}


def section_status(ctx: dict, section: Section) -> tuple[bool, int, int | None]:
    """(en vente ?, prix en centimes, id de catégorie effectif) pour un secteur."""
    cfg = ctx["sec_cfg"].get(section.id)
    cat_id = cfg.category_id if cfg and cfg.category_id else section.category_id
    price = ctx["prices"].get(cat_id)
    on_sale = (cfg.on_sale if cfg else True) and price is not None and price.on_sale
    return on_sale, (price.price_minor if price else 0), cat_id


def resolve_sellable(db: Session, event: Event, seat_ids: list[int]) -> dict[int, tuple[int, str]]:
    """Vérifie que chaque siège est vendable pour l'événement ; retourne {seat_id: (prix, code catégorie)}."""
    rows = db.execute(
        select(Seat, Section).join(Section, Section.id == Seat.section_id).where(Seat.id.in_(seat_ids))
    ).all()
    found = {seat.id: (seat, sec) for seat, sec in rows}
    unknown = [i for i in seat_ids if i not in found or found[i][0].venue_id != event.venue_id]
    if unknown:
        raise BookingError(404, "unknown_seat", "Siège inconnu pour ce lieu", seat_ids=unknown)
    ctx = event_context(db, event)
    blocked = set(
        db.scalars(select(EventSeatBlock.seat_id).where(EventSeatBlock.event_id == event.id, EventSeatBlock.seat_id.in_(seat_ids)))
    )
    unavailable: list[int] = []
    out: dict[int, tuple[int, str]] = {}
    for sid in seat_ids:
        seat, sec = found[sid]
        on_sale, price, cat_id = section_status(ctx, sec)
        if seat.out_of_service or sid in blocked or not on_sale:
            unavailable.append(sid)
            continue
        out[sid] = (price, ctx["cats"][cat_id].code)
    if unavailable:
        raise BookingError(409, "not_for_sale", "Siège non disponible à la vente pour cet événement", seat_ids=unavailable)
    return out


# --------------------------------------------------------------------------- #
# Expiration
# --------------------------------------------------------------------------- #
def expire_reservations(db: Session, reservation_ids: list[str]) -> int:
    """Marque comme expirées des réservations en attente (ordre : réservations puis lignes)."""
    if not reservation_ids:
        return 0
    locked_ids = list(
        db.scalars(
            select(Reservation.id)
            .where(Reservation.id.in_(reservation_ids), Reservation.status == ReservationStatus.pending.value)
            .order_by(Reservation.id)
            .with_for_update(skip_locked=True)
        )
    )
    if not locked_ids:
        return 0
    db.execute(
        update(ReservationItem)
        .where(ReservationItem.reservation_id.in_(locked_ids), ReservationItem.status == ItemStatus.locked.value)
        .values(status=ItemStatus.expired.value)
    )
    db.execute(update(Reservation).where(Reservation.id.in_(locked_ids)).values(status=ReservationStatus.expired.value))
    return len(locked_ids)


def sweep_expired(db: Session) -> int:
    """Libère tous les verrous dont l'échéance est dépassée (appelé périodiquement)."""
    now = utcnow()
    ids = list(
        db.scalars(
            select(Reservation.id).where(Reservation.status == ReservationStatus.pending.value, Reservation.expires_at <= now)
        )
    )
    n = expire_reservations(db, ids)
    db.commit()
    return n


def _expire_stale_for_seats(db: Session, event_id: int, seat_ids: list[int]) -> None:
    now = utcnow()
    stale = list(
        db.scalars(
            select(ReservationItem.reservation_id)
            .where(
                ReservationItem.event_id == event_id,
                ReservationItem.seat_id.in_(seat_ids),
                ReservationItem.status == ItemStatus.locked.value,
                ReservationItem.expires_at <= now,
            )
            .distinct()
        )
    )
    expire_reservations(db, stale)


# --------------------------------------------------------------------------- #
# Verrouillage
# --------------------------------------------------------------------------- #
def create_lock(db: Session, user: User, event: Event, seat_ids: list[int], idempotency_key: str | None) -> tuple[Reservation, bool]:
    """Crée une réservation en attente. Retourne (réservation, créée ?)."""
    seat_ids = list(dict.fromkeys(seat_ids))  # dédoublonnage en conservant l'ordre
    if len(seat_ids) > settings.max_seats_per_reservation:
        raise BookingError(422, "too_many_seats", f"Maximum {settings.max_seats_per_reservation} sièges par réservation")
    if event.status != EventStatus.published.value:
        raise BookingError(409, "event_not_open", "Cet événement n'est pas ouvert à la réservation")
    if event.starts_at <= utcnow():
        raise BookingError(409, "event_started", "Cet événement a déjà commencé")

    if idempotency_key:
        existing = db.scalar(
            select(Reservation)
            .options(selectinload(Reservation.items))
            .where(Reservation.user_id == user.id, Reservation.idempotency_key == idempotency_key)
        )
        if existing:
            same = {i.seat_id for i in existing.items} == set(seat_ids) and existing.event_id == event.id
            if not same:
                raise BookingError(409, "idempotency_conflict", "Cette clé d'idempotence a déjà servi pour une autre requête")
            return existing, False

    prices = resolve_sellable(db, event, seat_ids)

    # Plafond par utilisateur et par événement (anti-accaparement)
    now = utcnow()
    held = db.scalar(
        select(func.count())
        .select_from(ReservationItem)
        .join(Reservation, Reservation.id == ReservationItem.reservation_id)
        .where(
            Reservation.user_id == user.id,
            ReservationItem.event_id == event.id,
            or_(
                ReservationItem.status == ItemStatus.confirmed.value,
                and_(ReservationItem.status == ItemStatus.locked.value, ReservationItem.expires_at > now),
            ),
        )
    )
    if (held or 0) + len(seat_ids) > settings.max_seats_per_user_event:
        raise BookingError(
            422, "user_limit", f"Limite de {settings.max_seats_per_user_event} sièges par événement et par compte atteinte"
        )

    _expire_stale_for_seats(db, event.id, seat_ids)

    expires = now + timedelta(minutes=settings.lock_minutes)
    res = Reservation(
        reference=_new_reference(),
        user_id=user.id,
        event_id=event.id,
        status=ReservationStatus.pending.value,
        is_demo=True,
        total_minor=sum(p for p, _ in prices.values()),
        idempotency_key=idempotency_key,
        expires_at=expires,
    )
    for sid in seat_ids:
        price, code = prices[sid]
        res.items.append(
            ReservationItem(
                event_id=event.id,
                seat_id=sid,
                price_minor=price,
                category_code=code,
                status=ItemStatus.locked.value,
                expires_at=expires,
            )
        )
    db.add(res)
    try:
        db.flush()
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        if "reservations_reference_key" in str(exc.orig) or "reservations.reference" in str(exc.orig):
            # collision de référence (très improbable) : une nouvelle tentative suffit
            return create_lock(db, user, event, seat_ids, idempotency_key)
        if "idempotency" in str(exc.orig) or "user_id, idempotency_key" in str(exc.orig):
            existing = db.scalar(
                select(Reservation)
                .options(selectinload(Reservation.items))
                .where(Reservation.user_id == user.id, Reservation.idempotency_key == idempotency_key)
            )
            if existing:
                return existing, False
        conflicts = list(
            db.scalars(
                select(ReservationItem.seat_id).where(
                    ReservationItem.event_id == event.id,
                    ReservationItem.seat_id.in_(seat_ids),
                    ReservationItem.status.in_(ACTIVE_ITEM_STATUSES),
                )
            )
        )
        raise BookingError(
            409, "seat_taken", "Un ou plusieurs sièges viennent d'être pris par un autre spectateur", seat_ids=conflicts or seat_ids
        ) from exc
    return res, True


# --------------------------------------------------------------------------- #
# Lecture / confirmation / annulation
# --------------------------------------------------------------------------- #
def _get_locked(db: Session, reservation_id: str, user: User, allow_staff: bool = False) -> Reservation:
    res = db.scalar(select(Reservation).where(Reservation.id == reservation_id).with_for_update())
    if not res or (res.user_id != user.id and not (allow_staff and user.role in ("manager", "admin"))):
        raise BookingError(404, "not_found", "Réservation introuvable")
    return res


def confirm_reservation(db: Session, user: User, reservation_id: str) -> Reservation:
    res = _get_locked(db, reservation_id, user)
    now = utcnow()
    if res.status == ReservationStatus.confirmed.value:
        db.rollback()
        return load_reservation(db, reservation_id)
    if res.status != ReservationStatus.pending.value:
        db.rollback()
        raise BookingError(409, "not_pending", f"Réservation {res.status}", status=res.status)
    items = list(db.scalars(select(ReservationItem).where(ReservationItem.reservation_id == res.id).with_for_update()))
    if res.expires_at <= now or any(i.status != ItemStatus.locked.value for i in items):
        res.status = ReservationStatus.expired.value
        for i in items:
            if i.status == ItemStatus.locked.value:
                i.status = ItemStatus.expired.value
        db.commit()
        raise BookingError(410, "expired", "Le verrouillage a expiré, veuillez sélectionner de nouveau vos places")
    event = db.get(Event, res.event_id)
    if event.status != EventStatus.published.value or event.starts_at <= now:
        db.rollback()
        raise BookingError(409, "event_not_open", "Cet événement n'est plus ouvert à la réservation")
    for i in items:
        i.status = ItemStatus.confirmed.value
        i.expires_at = None
    res.status = ReservationStatus.confirmed.value
    res.confirmed_at = now
    db.commit()
    return load_reservation(db, reservation_id)


def cancel_reservation(db: Session, user: User, reservation_id: str, staff: bool = False) -> Reservation:
    res = _get_locked(db, reservation_id, user, allow_staff=staff)
    now = utcnow()
    if res.status in (ReservationStatus.cancelled.value, ReservationStatus.expired.value):
        db.rollback()
        return load_reservation(db, reservation_id)
    items = list(db.scalars(select(ReservationItem).where(ReservationItem.reservation_id == res.id).with_for_update()))
    if res.status == ReservationStatus.confirmed.value:
        event = db.get(Event, res.event_id)
        if event.starts_at <= now and not staff:
            db.rollback()
            raise BookingError(409, "event_started", "Annulation impossible : l'événement a commencé")
        new_status = ItemStatus.cancelled.value
    else:
        new_status = ItemStatus.released.value
    for i in items:
        if i.status in ACTIVE_ITEM_STATUSES:
            i.status = new_status
            i.expires_at = None
    res.status = ReservationStatus.cancelled.value
    res.cancelled_at = now
    db.commit()
    return load_reservation(db, reservation_id)


def load_reservation(db: Session, reservation_id: str) -> Reservation:
    res = db.scalar(
        select(Reservation)
        .options(selectinload(Reservation.items).selectinload(ReservationItem.seat), selectinload(Reservation.event))
        .where(Reservation.id == reservation_id)
    )
    if not res:
        raise BookingError(404, "not_found", "Réservation introuvable")
    return res


def serialize_reservation(res: Reservation, include_user: bool = False) -> dict:
    now = utcnow()
    expires_in = None
    if res.status == ReservationStatus.pending.value:
        expires_in = max(int((res.expires_at - now).total_seconds()), 0)
    data = {
        "id": res.id,
        "reference": res.reference,
        "status": res.status,
        "is_demo": res.is_demo,
        "demo_notice": DEMO_NOTICE if res.is_demo else None,
        "event": {
            "id": res.event.id,
            "title": res.event.title,
            "starts_at": res.event.starts_at.isoformat(),
        },
        "total_minor": res.total_minor,
        "currency": res.currency,
        "created_at": res.created_at.isoformat(),
        "expires_at": res.expires_at.isoformat() if res.status == ReservationStatus.pending.value else None,
        "expires_in_seconds": expires_in,
        "confirmed_at": res.confirmed_at.isoformat() if res.confirmed_at else None,
        "cancelled_at": res.cancelled_at.isoformat() if res.cancelled_at else None,
        "items": [
            {
                "seat_id": i.seat_id,
                "seat_code": i.seat.code,
                "category": i.category_code,
                "price_minor": i.price_minor,
                "status": i.status,
            }
            for i in sorted(res.items, key=lambda i: i.seat.code)
        ],
    }
    if include_user:
        data["user_id"] = res.user_id
    return data


# --------------------------------------------------------------------------- #
# Disponibilités
# --------------------------------------------------------------------------- #
def availability(db: Session, event: Event, user: User | None) -> dict:
    now = utcnow()
    taken_rows = db.execute(
        select(ReservationItem.seat_id, ReservationItem.status, Reservation.user_id)
        .join(Reservation, Reservation.id == ReservationItem.reservation_id)
        .where(
            ReservationItem.event_id == event.id,
            or_(
                ReservationItem.status == ItemStatus.confirmed.value,
                and_(ReservationItem.status == ItemStatus.locked.value, ReservationItem.expires_at > now),
            ),
        )
    ).all()
    taken, mine_held, mine_confirmed = [], [], []
    sold = held = 0
    for seat_id, status, uid in taken_rows:
        if status == ItemStatus.confirmed.value:
            sold += 1
            if user and uid == user.id:
                mine_confirmed.append(seat_id)
        else:
            held += 1
            if user and uid == user.id:
                mine_held.append(seat_id)
        if not (user and uid == user.id and status == ItemStatus.locked.value):
            taken.append(seat_id)  # mes propres verrous ne comptent pas comme « pris » pour moi
    ctx = event_context(db, event)
    section_taken = dict(
        db.execute(
            select(Section.code, func.count())
            .select_from(ReservationItem)
            .join(Seat, Seat.id == ReservationItem.seat_id)
            .join(Section, Section.id == Seat.section_id)
            .where(
                ReservationItem.event_id == event.id,
                or_(
                    ReservationItem.status == ItemStatus.confirmed.value,
                    and_(ReservationItem.status == ItemStatus.locked.value, ReservationItem.expires_at > now),
                ),
            )
            .group_by(Section.code)
        ).all()
    )
    closed_sections = _closed_sections(db, event, ctx)
    blocked = list(db.scalars(select(Seat.id).where(Seat.venue_id == event.venue_id, Seat.out_of_service.is_(True))))
    blocked += list(db.scalars(select(EventSeatBlock.seat_id).where(EventSeatBlock.event_id == event.id)))
    prices = {
        ctx["cats"][cid].code: {"price_minor": p.price_minor, "on_sale": p.on_sale}
        for cid, p in ctx["prices"].items()
        if cid in ctx["cats"]
    }
    return {
        "event_id": event.id,
        "server_time": now.isoformat(),
        "hold_minutes": settings.lock_minutes,
        "taken": sorted(taken),
        "held_by_me": sorted(mine_held),
        "confirmed_by_me": sorted(mine_confirmed),
        "blocked_seats": sorted(set(blocked)),
        "closed_sections": closed_sections,
        "section_categories": _section_categories(db, event, ctx),
        "prices": prices,
        "counts": {"sold": sold, "held": held},
        "section_taken": section_taken,
        "demo_mode": event.demo_mode,
    }


def _closed_sections(db: Session, event: Event, ctx: dict) -> list[str]:
    out = []
    for sec in db.scalars(select(Section).where(Section.venue_id == event.venue_id)):
        if not section_status(ctx, sec)[0]:
            out.append(sec.code)
    return sorted(out)


def _section_categories(db: Session, event: Event, ctx: dict) -> dict[str, str]:
    """Catégorie effective par secteur pour cet événement (tient compte des surcharges)."""
    out = {}
    for sec in db.scalars(select(Section).where(Section.venue_id == event.venue_id)):
        _, _, cat_id = section_status(ctx, sec)
        out[sec.code] = ctx["cats"][cat_id].code
    return out
