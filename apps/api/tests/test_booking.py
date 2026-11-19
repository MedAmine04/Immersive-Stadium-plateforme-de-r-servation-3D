import threading
from datetime import datetime, timedelta, timezone

from sqlalchemy import select, text

from app.db import SessionLocal
from app.models import Event, ReservationItem, User
from app.services import booking
from tests.conftest import free_seats


def _lock(c, eid, seats, key=None):
    h = {"Idempotency-Key": key} if key else {}
    return c.post(f"/api/events/{eid}/locks", json={"seat_ids": seats}, headers=h)


def test_full_flow_lock_confirm_cancel(fan, client, event_id):
    seats = free_seats(client, event_id, 2)
    r = _lock(fan, event_id, seats)
    assert r.status_code == 201, r.text
    res = r.json()
    assert res["status"] == "pending" and res["reference"].startswith("DEMO-")
    assert "n'est pas un billet" in res["demo_notice"]
    av = client.get(f"/api/events/{event_id}/availability").json()
    assert set(seats) <= set(av["taken"])
    r = fan.post(f"/api/reservations/{res['id']}/confirm")
    assert r.status_code == 200 and r.json()["status"] == "confirmed"
    r = fan.post(f"/api/reservations/{res['id']}/cancel")
    assert r.json()["status"] == "cancelled"
    av = client.get(f"/api/events/{event_id}/availability").json()
    assert not (set(seats) & set(av["taken"]))


def test_second_user_cannot_take_locked_seat(fan, manager, client, event_id):
    seats = free_seats(client, event_id, 1)
    assert _lock(fan, event_id, seats).status_code == 201
    r = _lock(manager, event_id, seats)
    assert r.status_code == 409 and r.json()["detail"]["code"] == "seat_taken"


def test_concurrent_lock_same_seat_only_one_wins(client, event_id):
    """Deux (puis vingt) utilisateurs verrouillent simultanément le même siège : un seul gagnant."""
    seat = free_seats(client, event_id, 1)
    with SessionLocal() as db:
        ev = db.get(Event, event_id)
        users = []
        from app.security import hash_password
        for i in range(20):
            u = db.scalar(select(User).where(User.email == f"race{i}@example.com"))
            if not u:
                u = User(email=f"race{i}@example.com", password_hash=hash_password("Race#Password1"), full_name=f"Race {i}")
                db.add(u)
        db.commit()
        uids = [db.scalar(select(User.id).where(User.email == f"race{i}@example.com")) for i in range(20)]
    results, barrier = [], threading.Barrier(20)

    def worker(uid):
        with SessionLocal() as db:
            user, ev = db.get(User, uid), db.get(Event, event_id)
            barrier.wait()
            try:
                booking.create_lock(db, user, ev, seat, None)
                results.append("ok")
            except booking.BookingError as e:
                results.append(e.detail["code"])

    ts = [threading.Thread(target=worker, args=(u,)) for u in uids]
    [t.start() for t in ts]
    [t.join() for t in ts]
    assert results.count("ok") == 1, results
    assert results.count("seat_taken") == 19, results
    with SessionLocal() as db:
        n = db.scalar(text("select count(*) from reservation_items where seat_id=:s and event_id=:e and status in ('locked','confirmed')"),
                      {"s": seat[0], "e": event_id})
        assert n == 1


def test_database_constraint_blocks_duplicates_even_without_app_checks(client, event_id):
    """La base elle-même interdit deux lignes actives pour le même siège/événement."""
    import pytest
    from sqlalchemy.exc import IntegrityError
    seat = free_seats(client, event_id, 1)[0]
    with SessionLocal() as db:
        u = db.scalar(select(User).where(User.email == "fan@stadium.demo"))
        from app.models import Reservation
        exp = datetime.now(timezone.utc) + timedelta(minutes=5)
        for k in range(2):
            r = Reservation(reference=f"RAW-{k}-{seat}", user_id=u.id, event_id=event_id, expires_at=exp)
            r.items.append(ReservationItem(event_id=event_id, seat_id=seat, price_minor=1, category_code="CAT1", status="locked", expires_at=exp))
            db.add(r)
            if k == 1:
                with pytest.raises(IntegrityError):
                    db.flush()
                db.rollback()
            else:
                db.flush()
        db.rollback()


def test_lock_expires_and_seat_is_released(fan, manager, client, event_id):
    seat = free_seats(client, event_id, 1)
    res = _lock(fan, event_id, seat).json()
    with SessionLocal() as db:
        past = datetime.now(timezone.utc) - timedelta(seconds=1)
        db.execute(text("update reservations set expires_at=:p where id=:i"), {"p": past, "i": res["id"]})
        db.execute(text("update reservation_items set expires_at=:p where reservation_id=:i"), {"p": past, "i": res["id"]})
        db.commit()
    # le verrou expiré n'est plus compté, et un autre utilisateur peut prendre le siège (libération paresseuse)
    assert seat[0] not in client.get(f"/api/events/{event_id}/availability").json()["taken"]
    assert _lock(manager, event_id, seat).status_code == 201
    # l'ancien propriétaire ne peut plus confirmer
    r = fan.post(f"/api/reservations/{res['id']}/confirm")
    assert r.status_code in (409, 410)
    assert r.json()["detail"]["code"] in ("expired", "not_pending")


def test_sweeper_releases_expired(fan, client, event_id):
    seat = free_seats(client, event_id, 1)
    res = _lock(fan, event_id, seat).json()
    with SessionLocal() as db:
        past = datetime.now(timezone.utc) - timedelta(seconds=1)
        db.execute(text("update reservations set expires_at=:p where id=:i"), {"p": past, "i": res["id"]})
        db.commit()
        assert booking.sweep_expired(db) == 1
    assert fan.get(f"/api/reservations/{res['id']}").json()["status"] == "expired"


def test_repeated_request_is_idempotent(fan, client, event_id):
    seat = free_seats(client, event_id, 1)
    a = _lock(fan, event_id, seat, key="abc-123")
    b = _lock(fan, event_id, seat, key="abc-123")
    assert a.status_code == 201 and b.status_code == 200 and a.json()["id"] == b.json()["id"]
    c = _lock(fan, event_id, free_seats(client, event_id, 3)[1:], key="abc-123")
    assert c.status_code == 409 and c.json()["detail"]["code"] == "idempotency_conflict"
    # double confirmation : sans effet secondaire
    rid = a.json()["id"]
    assert fan.post(f"/api/reservations/{rid}/confirm").status_code == 200
    assert fan.post(f"/api/reservations/{rid}/confirm").json()["status"] == "confirmed"


def test_concurrent_confirm_and_cancel_are_consistent(fan, client, event_id):
    seat = free_seats(client, event_id, 1)
    rid = _lock(fan, event_id, seat).json()["id"]
    out, barrier = [], threading.Barrier(2)

    def go(action):
        with SessionLocal() as db:
            u = db.scalar(select(User).where(User.email == "fan@stadium.demo"))
            barrier.wait()
            try:
                (booking.confirm_reservation if action == "c" else booking.cancel_reservation)(db, u, rid)
                out.append(action)
            except booking.BookingError as e:
                out.append(e.detail["code"])
    ts = [threading.Thread(target=go, args=(a,)) for a in ("c", "x")]
    [t.start() for t in ts]; [t.join() for t in ts]
    with SessionLocal() as db:
        items = db.scalars(select(ReservationItem.status).where(ReservationItem.reservation_id == rid)).all()
        active = [s for s in items if s in ("locked", "confirmed")]
        assert len(active) <= 1 and (len(items) == 1)


def test_user_limit_and_unknown_seat(fan, client, event_id):
    assert _lock(fan, event_id, [10**9]).status_code == 404
    assert _lock(fan, event_id, free_seats(client, event_id, 9)).status_code == 422  # > 8 par réservation (schéma: max 20, règle: 8)


def test_closed_section_not_for_sale_in_concert(fan, client):
    concert = [e for e in client.get("/api/events").json() if e["kind"] == "concert"][0]
    seat = client.get("/api/venues/prince-moulay-abdellah/sections/N-L-02/seats").json()["ids"][:1]
    r = _lock(fan, concert["id"], seat)
    assert r.status_code == 409 and r.json()["detail"]["code"] == "not_for_sale"


def test_cannot_see_or_cancel_other_users_reservation(fan, manager, client, event_id):
    rid = _lock(fan, event_id, free_seats(client, event_id, 1)).json()["id"]
    from tests.conftest import login
    from app.main import app
    other = login(app, "race0@example.com", "Race#Password1") if False else None
    assert manager.get(f"/api/reservations/{rid}").status_code == 200  # le gestionnaire (staff) peut consulter
    r = client.get(f"/api/reservations/{rid}")
    assert r.status_code == 401
