"""Chargement initial : lieu, tribunes, secteurs, rangées, sièges, catégories, comptes, événements de démonstration."""
from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .config import get_settings
from .generator.stadium import generate
from .models import (
    Event,
    EventPrice,
    EventStatus,
    Role,
    Row,
    Seat,
    SeatGeometry,
    Section,
    Stand,
    TicketCategory,
    User,
    Venue,
)
from .security import hash_password

log = logging.getLogger("seed")
settings = get_settings()

VENUE_SLUG = "prince-moulay-abdellah"
FIDELITY_NOTES = (
    "Modèle ESTIMÉ : les plans officiels et l'inventaire des sièges ne sont pas disponibles. La géométrie est générée "
    "de façon procédurale et calibrée sur des données publiques (68 700 places, tribune sud de 23 000 places sur deux "
    "niveaux, porte-à-faux de 8 m, terrain de 105 m x 68 m). Les vues depuis un siège sont INDICATIVES."
)
DESCRIPTION = (
    "Stade national de Rabat, reconstruit et inauguré en septembre 2025 (architecte : Populous). Cuvette de 68 700 "
    "places avec une tribune sud « Kop » à deux niveaux de 23 000 places, des tribunes ouest et est dédiées à "
    "l'hospitalité et un toit brise-vent à 360°."
)


def ensure_user(db: Session, email: str, password: str, name: str, role: Role) -> User:
    user = db.scalar(select(User).where(User.email == email.lower()))
    if user:
        return user
    user = User(email=email.lower(), password_hash=hash_password(password), full_name=name, role=role.value)
    db.add(user)
    db.flush()
    return user


def seed_users(db: Session) -> None:
    ensure_user(db, settings.admin_email, settings.admin_password, "Administrateur", Role.admin)
    if settings.seed_demo_users:
        ensure_user(db, settings.manager_email, settings.manager_password, "Gestionnaire Démo", Role.manager)
        ensure_user(db, settings.demo_user_email, settings.demo_user_password, "Spectateur Démo", Role.spectator)
    db.commit()


def seed_venue(db: Session) -> Venue:
    venue = db.scalar(select(Venue).where(Venue.slug == VENUE_SLUG))
    if venue:
        return venue
    log.info("Génération du stade…")
    data = generate()
    venue = Venue(
        slug=VENUE_SLUG,
        name="Complexe Sportif Prince Moulay Abdellah",
        city="Rabat",
        country="Maroc",
        description=DESCRIPTION,
        declared_capacity=68_700,
        data_fidelity="estimated",
        fidelity_notes=FIDELITY_NOTES,
        bowl_spec=data["bowl"],
        pitch_length=data["bowl"]["pitch"]["length"],
        pitch_width=data["bowl"]["pitch"]["width"],
    )
    db.add(venue)
    db.flush()

    cats: dict[str, TicketCategory] = {}
    for i, (code, name, color, price) in enumerate(data["categories"]):
        c = TicketCategory(venue_id=venue.id, code=code, name=name, color=color, default_price_minor=price, sort_order=i)
        db.add(c)
        cats[code] = c
    db.flush()

    stands: dict[str, Stand] = {}
    for sd in data["stands"]:
        st = Stand(venue_id=venue.id, code=sd["code"], name=sd["name"], phi_start=sd["phi_start"], phi_end=sd["phi_end"])
        db.add(st)
        stands[sd["code"]] = st
    db.flush()

    sections: dict[str, Section] = {}
    for sd in data["sections"]:
        sec = Section(
            venue_id=venue.id,
            stand_id=stands[sd["stand"]].id,
            code=sd["code"],
            name=sd["name"],
            tier=sd["tier"],
            block=sd["block"],
            category_id=cats[sd["category"]].id,
            phi_start=sd["phi_start"],
            phi_end=sd["phi_end"],
            seat_count=sd["seat_count"],
        )
        db.add(sec)
        sections[sd["code"]] = sec
    db.flush()

    # rangées
    row_keys: dict[tuple[str, int], Row] = {}
    row_y: dict[tuple[str, int], tuple[float, float]] = {}
    for s in data["seats"]:
        row_y.setdefault((s["section"], s["row"]), (s["y"], s["d"]))
    for (sec_code, number), (y, d) in sorted(row_y.items()):
        r = Row(section_id=sections[sec_code].id, number=number, floor_y=y, offset_d=d)
        db.add(r)
        row_keys[(sec_code, number)] = r
    db.flush()

    # sièges + géométrie (insertion en masse)
    seat_rows = []
    for s in data["seats"]:
        seat_rows.append(
            {
                "venue_id": venue.id,
                "section_id": sections[s["section"]].id,
                "row_id": row_keys[(s["section"], s["row"])].id,
                "number": s["number"],
                "code": s["code"],
                "accessible": s["accessible"],
                "out_of_service": False,
                "estimated": True,
            }
        )
    db.execute(Seat.__table__.insert(), seat_rows)
    code_to_id = {code: sid for sid, code in db.execute(select(Seat.id, Seat.code).where(Seat.venue_id == venue.id))}
    geo_rows = []
    for s in data["seats"]:
        geo_rows.append(
            {
                "seat_id": code_to_id[s["code"]],
                "x": s["x"],
                "y": s["y"],
                "z": s["z"],
                "rot_y": s["ry"],
                "eye_height": 1.15,
                "target_x": 0.0,
                "target_y": 0.0,
                "target_z": 0.0,
                "dist_center": s["dist_center"],
                "dist_edge": s["dist_edge"],
                "elevation_deg": s["elevation_deg"],
                "clearance_deg": s["clearance_deg"],
                "cover": s["cover"],
                "c_value": s["c_value"],
                "obstructed": s["obstructed"],
                "view_score": s["view_score"],
            }
        )
    db.execute(SeatGeometry.__table__.insert(), geo_rows)
    db.commit()
    log.info("Stade généré : %d sièges", len(seat_rows))
    return venue


def seed_events(db: Session, venue: Venue) -> None:
    if db.scalar(select(func.count()).select_from(Event).where(Event.venue_id == venue.id)):
        return
    cats = {c.code: c for c in db.scalars(select(TicketCategory).where(TicketCategory.venue_id == venue.id))}
    now = datetime.now(timezone.utc)
    demo = [
        ("Maroc – Gabon (match de démonstration)", "football", 45, "Rencontre internationale de démonstration."),
        ("Maroc – Niger (match de démonstration)", "football", 90, "Rencontre internationale de démonstration."),
        ("Concert de démonstration – tribune sud fermée", "concert", 120, "Configuration concert : tribune Nord fermée."),
    ]
    for title, kind, days, desc in demo:
        ev = Event(
            venue_id=venue.id,
            title=title,
            kind=kind,
            description=desc,
            starts_at=(now + timedelta(days=days)).replace(hour=20, minute=0, second=0, microsecond=0),
            status=EventStatus.published.value,
            demo_mode=True,
        )
        db.add(ev)
        db.flush()
        for code, cat in cats.items():
            db.add(EventPrice(event_id=ev.id, category_id=cat.id, price_minor=cat.default_price_minor, on_sale=True))
        if kind == "concert":
            from .models import EventSection

            for sec in db.scalars(select(Section).where(Section.venue_id == venue.id)):
                if sec.code.startswith("N-"):
                    db.add(EventSection(event_id=ev.id, section_id=sec.id, on_sale=False))
    db.commit()


def run_seed() -> None:
    from .db import SessionLocal

    with SessionLocal() as db:
        seed_users(db)
        venue = seed_venue(db)
        seed_events(db, venue)
