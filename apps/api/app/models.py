"""Modèle de données (PostgreSQL = source de vérité des disponibilités).

Correspondance avec le cahier des charges :
  User, Role -> users.role | Venue | VenueModel -> media_assets (kind = shell_glb) | Stand | Section | Row
  Seat | SeatGeometry | Event | TicketCategory | EventSeat -> event_prices + event_sections + event_seat_blocks
  Reservation | ReservationItem | MediaAsset
"""
from __future__ import annotations

import enum
import uuid
from datetime import datetime, timezone

from sqlalchemy import (
    JSON,
    BigInteger,
    Boolean,
    CheckConstraint,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    SmallInteger,
    String,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Role(str, enum.Enum):
    spectator = "spectator"
    manager = "manager"
    admin = "admin"


class EventStatus(str, enum.Enum):
    draft = "draft"
    published = "published"
    cancelled = "cancelled"


class ReservationStatus(str, enum.Enum):
    pending = "pending"  # sièges verrouillés temporairement
    confirmed = "confirmed"
    cancelled = "cancelled"
    expired = "expired"


class ItemStatus(str, enum.Enum):
    locked = "locked"
    confirmed = "confirmed"
    released = "released"  # annulée avant confirmation
    expired = "expired"
    cancelled = "cancelled"  # annulée après confirmation


ACTIVE_ITEM_STATUSES = (ItemStatus.locked.value, ItemStatus.confirmed.value)


# --------------------------------------------------------------------------- #
# Utilisateurs
# --------------------------------------------------------------------------- #
class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    email: Mapped[str] = mapped_column(String(254), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    full_name: Mapped[str] = mapped_column(String(120))
    role: Mapped[str] = mapped_column(String(20), default=Role.spectator.value, index=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    token_version: Mapped[int] = mapped_column(Integer, default=0)  # invalide les sessions existantes
    failed_logins: Mapped[int] = mapped_column(Integer, default=0)
    locked_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class PasswordResetToken(Base):
    __tablename__ = "password_reset_tokens"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


# --------------------------------------------------------------------------- #
# Infrastructure
# --------------------------------------------------------------------------- #
class Venue(Base):
    __tablename__ = "venues"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    slug: Mapped[str] = mapped_column(String(80), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(200))
    city: Mapped[str] = mapped_column(String(100))
    country: Mapped[str] = mapped_column(String(100))
    description: Mapped[str] = mapped_column(Text, default="")
    declared_capacity: Mapped[int] = mapped_column(Integer)
    # 'estimated' : modèle approximatif calibré sur données publiques ; 'verified' : plans + inventaire officiels
    data_fidelity: Mapped[str] = mapped_column(String(20), default="estimated")
    fidelity_notes: Mapped[str] = mapped_column(Text, default="")
    bowl_spec: Mapped[dict] = mapped_column(JSON, default=dict)
    pitch_length: Mapped[float] = mapped_column(Float, default=105.0)
    pitch_width: Mapped[float] = mapped_column(Float, default=68.0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    stands: Mapped[list["Stand"]] = relationship(back_populates="venue", cascade="all, delete-orphan")
    categories: Mapped[list["TicketCategory"]] = relationship(back_populates="venue", cascade="all, delete-orphan")


class TicketCategory(Base):
    __tablename__ = "ticket_categories"
    __table_args__ = (UniqueConstraint("venue_id", "code"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    venue_id: Mapped[int] = mapped_column(ForeignKey("venues.id", ondelete="CASCADE"), index=True)
    code: Mapped[str] = mapped_column(String(20))
    name: Mapped[str] = mapped_column(String(120))
    color: Mapped[str] = mapped_column(String(9), default="#888888")
    default_price_minor: Mapped[int] = mapped_column(Integer, default=0)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)

    venue: Mapped[Venue] = relationship(back_populates="categories")


class Stand(Base):
    __tablename__ = "stands"
    __table_args__ = (UniqueConstraint("venue_id", "code"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    venue_id: Mapped[int] = mapped_column(ForeignKey("venues.id", ondelete="CASCADE"), index=True)
    code: Mapped[str] = mapped_column(String(10))
    name: Mapped[str] = mapped_column(String(120))
    phi_start: Mapped[float] = mapped_column(Float)
    phi_end: Mapped[float] = mapped_column(Float)

    venue: Mapped[Venue] = relationship(back_populates="stands")
    sections: Mapped[list["Section"]] = relationship(back_populates="stand", cascade="all, delete-orphan")


class Section(Base):
    __tablename__ = "sections"
    __table_args__ = (UniqueConstraint("venue_id", "code"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    venue_id: Mapped[int] = mapped_column(ForeignKey("venues.id", ondelete="CASCADE"), index=True)
    stand_id: Mapped[int] = mapped_column(ForeignKey("stands.id", ondelete="CASCADE"), index=True)
    code: Mapped[str] = mapped_column(String(20))
    name: Mapped[str] = mapped_column(String(200))
    tier: Mapped[str] = mapped_column(String(2))
    block: Mapped[int] = mapped_column(SmallInteger)
    category_id: Mapped[int] = mapped_column(ForeignKey("ticket_categories.id"), index=True)
    phi_start: Mapped[float] = mapped_column(Float)
    phi_end: Mapped[float] = mapped_column(Float)
    seat_count: Mapped[int] = mapped_column(Integer, default=0)

    stand: Mapped[Stand] = relationship(back_populates="sections")
    category: Mapped[TicketCategory] = relationship()


class Row(Base):
    __tablename__ = "rows"
    __table_args__ = (UniqueConstraint("section_id", "number"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    section_id: Mapped[int] = mapped_column(ForeignKey("sections.id", ondelete="CASCADE"), index=True)
    number: Mapped[int] = mapped_column(SmallInteger)
    floor_y: Mapped[float] = mapped_column(Float)
    offset_d: Mapped[float] = mapped_column(Float)


class Seat(Base):
    """Identité métier d'un siège, indépendante de sa représentation graphique."""

    __tablename__ = "seats"
    __table_args__ = (
        UniqueConstraint("venue_id", "code"),
        UniqueConstraint("row_id", "number"),
        Index("ix_seats_section_row_number", "section_id", "row_id", "number"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    venue_id: Mapped[int] = mapped_column(ForeignKey("venues.id", ondelete="CASCADE"), index=True)
    section_id: Mapped[int] = mapped_column(ForeignKey("sections.id", ondelete="CASCADE"))
    row_id: Mapped[int] = mapped_column(ForeignKey("rows.id", ondelete="CASCADE"))
    number: Mapped[int] = mapped_column(SmallInteger)
    code: Mapped[str] = mapped_column(String(40))
    accessible: Mapped[bool] = mapped_column(Boolean, default=False)
    out_of_service: Mapped[bool] = mapped_column(Boolean, default=False)
    estimated: Mapped[bool] = mapped_column(Boolean, default=True)  # position non vérifiée

    geometry: Mapped["SeatGeometry"] = relationship(back_populates="seat", uselist=False, cascade="all, delete-orphan")


class SeatGeometry(Base):
    __tablename__ = "seat_geometry"

    seat_id: Mapped[int] = mapped_column(ForeignKey("seats.id", ondelete="CASCADE"), primary_key=True)
    x: Mapped[float] = mapped_column(Float)
    y: Mapped[float] = mapped_column(Float)
    z: Mapped[float] = mapped_column(Float)
    rot_y: Mapped[float] = mapped_column(Float)
    eye_height: Mapped[float] = mapped_column(Float, default=1.15)
    target_x: Mapped[float] = mapped_column(Float, default=0.0)
    target_y: Mapped[float] = mapped_column(Float, default=0.0)
    target_z: Mapped[float] = mapped_column(Float, default=0.0)
    # métriques de vue calculées (estimées)
    dist_center: Mapped[float] = mapped_column(Float, default=0.0)
    dist_edge: Mapped[float] = mapped_column(Float, default=0.0)
    elevation_deg: Mapped[float] = mapped_column(Float, default=0.0)
    clearance_deg: Mapped[float] = mapped_column(Float, default=90.0)
    cover: Mapped[str] = mapped_column(String(10), default="open")
    c_value: Mapped[float] = mapped_column(Float, default=9.99)
    obstructed: Mapped[bool] = mapped_column(Boolean, default=False)
    view_score: Mapped[float] = mapped_column(Float, default=0.0)

    seat: Mapped[Seat] = relationship(back_populates="geometry")


# --------------------------------------------------------------------------- #
# Ressources (modèles 3D, images, panoramas)
# --------------------------------------------------------------------------- #
class MediaAsset(Base):
    __tablename__ = "media_assets"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    venue_id: Mapped[int] = mapped_column(ForeignKey("venues.id", ondelete="CASCADE"), index=True)
    kind: Mapped[str] = mapped_column(String(20))  # shell_glb | panorama | texture | image
    original_name: Mapped[str] = mapped_column(String(255))
    storage_name: Mapped[str] = mapped_column(String(80), unique=True)
    content_type: Mapped[str] = mapped_column(String(80))
    sha256: Mapped[str] = mapped_column(String(64))
    size_bytes: Mapped[int] = mapped_column(BigInteger)
    version: Mapped[int] = mapped_column(Integer, default=1)
    is_active: Mapped[bool] = mapped_column(Boolean, default=False)
    # provenance : official | captured | original | ai_generated (les données générées par IA sont identifiées)
    source: Mapped[str] = mapped_column(String(20), default="original")
    notes: Mapped[str] = mapped_column(Text, default="")
    uploaded_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


# --------------------------------------------------------------------------- #
# Événements
# --------------------------------------------------------------------------- #
class Event(Base):
    __tablename__ = "events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    venue_id: Mapped[int] = mapped_column(ForeignKey("venues.id", ondelete="CASCADE"), index=True)
    title: Mapped[str] = mapped_column(String(200))
    kind: Mapped[str] = mapped_column(String(30), default="football")  # football | concert | autre
    description: Mapped[str] = mapped_column(Text, default="")
    starts_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    status: Mapped[str] = mapped_column(String(20), default=EventStatus.draft.value, index=True)
    demo_mode: Mapped[bool] = mapped_column(Boolean, default=True)
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    venue: Mapped[Venue] = relationship()


class EventPrice(Base):
    """Tarif d'une catégorie pour un événement."""

    __tablename__ = "event_prices"
    __table_args__ = (UniqueConstraint("event_id", "category_id"), CheckConstraint("price_minor >= 0"))

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    event_id: Mapped[int] = mapped_column(ForeignKey("events.id", ondelete="CASCADE"), index=True)
    category_id: Mapped[int] = mapped_column(ForeignKey("ticket_categories.id"))
    price_minor: Mapped[int] = mapped_column(Integer)
    on_sale: Mapped[bool] = mapped_column(Boolean, default=True)

    category: Mapped[TicketCategory] = relationship()


class EventSection(Base):
    """Configuration d'événement par secteur (ex. concert : certains secteurs fermés)."""

    __tablename__ = "event_sections"
    __table_args__ = (UniqueConstraint("event_id", "section_id"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    event_id: Mapped[int] = mapped_column(ForeignKey("events.id", ondelete="CASCADE"), index=True)
    section_id: Mapped[int] = mapped_column(ForeignKey("sections.id", ondelete="CASCADE"))
    on_sale: Mapped[bool] = mapped_column(Boolean, default=True)
    category_id: Mapped[int | None] = mapped_column(ForeignKey("ticket_categories.id"), nullable=True)


class EventSeatBlock(Base):
    """Siège retiré de la vente pour un événement (quota organisateur, sécurité, etc.)."""

    __tablename__ = "event_seat_blocks"
    __table_args__ = (UniqueConstraint("event_id", "seat_id"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    event_id: Mapped[int] = mapped_column(ForeignKey("events.id", ondelete="CASCADE"), index=True)
    seat_id: Mapped[int] = mapped_column(ForeignKey("seats.id", ondelete="CASCADE"))
    reason: Mapped[str] = mapped_column(String(120), default="")


# --------------------------------------------------------------------------- #
# Réservations
# --------------------------------------------------------------------------- #
class Reservation(Base):
    __tablename__ = "reservations"
    __table_args__ = (UniqueConstraint("user_id", "idempotency_key"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    reference: Mapped[str] = mapped_column(String(20), unique=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    event_id: Mapped[int] = mapped_column(ForeignKey("events.id"), index=True)
    status: Mapped[str] = mapped_column(String(20), default=ReservationStatus.pending.value, index=True)
    is_demo: Mapped[bool] = mapped_column(Boolean, default=True)
    total_minor: Mapped[int] = mapped_column(Integer, default=0)
    currency: Mapped[str] = mapped_column(String(3), default="MAD")
    idempotency_key: Mapped[str | None] = mapped_column(String(80), nullable=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    confirmed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    cancelled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    items: Mapped[list["ReservationItem"]] = relationship(back_populates="reservation", cascade="all, delete-orphan")
    event: Mapped[Event] = relationship()


class ReservationItem(Base):
    __tablename__ = "reservation_items"
    __table_args__ = (
        # Garantie fondamentale : un siège n'a qu'une seule réservation ACTIVE par événement.
        Index(
            "uq_active_seat_per_event",
            "event_id",
            "seat_id",
            unique=True,
            postgresql_where=text("status IN ('locked','confirmed')"),
            sqlite_where=text("status IN ('locked','confirmed')"),
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    reservation_id: Mapped[str] = mapped_column(ForeignKey("reservations.id", ondelete="CASCADE"), index=True)
    event_id: Mapped[int] = mapped_column(ForeignKey("events.id"), index=True)
    seat_id: Mapped[int] = mapped_column(ForeignKey("seats.id"), index=True)
    price_minor: Mapped[int] = mapped_column(Integer)
    category_code: Mapped[str] = mapped_column(String(20))
    status: Mapped[str] = mapped_column(String(20), default=ItemStatus.locked.value)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    reservation: Mapped[Reservation] = relationship(back_populates="items")
    seat: Mapped[Seat] = relationship()


class AuditLog(Base):
    __tablename__ = "audit_logs"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    ts: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)
    user_id: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)
    action: Mapped[str] = mapped_column(String(60), index=True)
    entity: Mapped[str] = mapped_column(String(40), default="")
    entity_id: Mapped[str] = mapped_column(String(60), default="")
    ip: Mapped[str] = mapped_column(String(64), default="")
    meta: Mapped[dict] = mapped_column(JSON, default=dict)
