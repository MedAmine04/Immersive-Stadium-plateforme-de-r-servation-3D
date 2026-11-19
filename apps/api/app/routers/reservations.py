from __future__ import annotations

from fastapi import APIRouter, Depends, Header, HTTPException, Request, Response
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from ..deps import DB, CurrentUser, audit
from ..models import Reservation, ReservationItem
from ..schemas import LockIn
from ..security import rate_limit
from ..services import booking
from .events import get_published

router = APIRouter(prefix="/api", tags=["reservations"])


@router.post("/events/{event_id}/locks", status_code=201, dependencies=[Depends(rate_limit("lock", 40, 60))])
def lock_seats(event_id: int, body: LockIn, request: Request, response: Response, db: DB, user: CurrentUser,
               idempotency_key: str | None = Header(default=None, alias="Idempotency-Key", max_length=80)):
    ev = get_published(db, event_id)
    res, created = booking.create_lock(db, user, ev, body.seat_ids, idempotency_key)
    if not created:
        response.status_code = 200
    else:
        audit(db, "booking.lock", request, user, "reservation", res.id, seats=len(body.seat_ids))
        db.commit()
    return booking.serialize_reservation(booking.load_reservation(db, res.id))


@router.post("/reservations/{rid}/confirm", dependencies=[Depends(rate_limit("confirm", 20, 60))])
def confirm(rid: str, request: Request, db: DB, user: CurrentUser):
    res = booking.confirm_reservation(db, user, rid)
    audit(db, "booking.confirm", request, user, "reservation", rid)
    db.commit()
    return booking.serialize_reservation(res)


@router.post("/reservations/{rid}/cancel", dependencies=[Depends(rate_limit("cancel", 20, 60))])
def cancel(rid: str, request: Request, db: DB, user: CurrentUser):
    res = booking.cancel_reservation(db, user, rid)
    audit(db, "booking.cancel", request, user, "reservation", rid)
    db.commit()
    return booking.serialize_reservation(res)


@router.get("/reservations")
def my_reservations(db: DB, user: CurrentUser):
    rows = db.scalars(
        select(Reservation).options(selectinload(Reservation.items).selectinload(ReservationItem.seat), selectinload(Reservation.event))
        .where(Reservation.user_id == user.id).order_by(Reservation.created_at.desc()).limit(200)
    ).all()
    return [booking.serialize_reservation(r) for r in rows]


@router.get("/reservations/{rid}")
def get_reservation(rid: str, db: DB, user: CurrentUser):
    res = booking.load_reservation(db, rid)
    if res.user_id != user.id and user.role not in ("manager", "admin"):
        raise HTTPException(404, "Réservation introuvable")
    return booking.serialize_reservation(res)
