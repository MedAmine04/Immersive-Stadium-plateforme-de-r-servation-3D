from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator


class ORM(BaseModel):
    model_config = ConfigDict(from_attributes=True)


# ----- Auth ----------------------------------------------------------------- #
class RegisterIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=128)
    full_name: str = Field(min_length=2, max_length=120)

    @field_validator("full_name")
    @classmethod
    def _strip(cls, v: str) -> str:
        return " ".join(v.split())


class LoginIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=128)


class ForgotIn(BaseModel):
    email: EmailStr


class ResetIn(BaseModel):
    token: str = Field(min_length=20, max_length=200)
    password: str = Field(min_length=1, max_length=128)


class UserOut(ORM):
    id: int
    email: str
    full_name: str
    role: str
    is_active: bool
    created_at: datetime


# ----- Événements ------------------------------------------------------------ #
class EventPriceIn(BaseModel):
    category_code: str = Field(min_length=1, max_length=20)
    price_minor: int = Field(ge=0, le=10_000_000)
    on_sale: bool = True


class EventIn(BaseModel):
    venue_slug: str
    title: str = Field(min_length=3, max_length=200)
    kind: Literal["football", "concert", "autre"] = "football"
    description: str = Field(default="", max_length=4000)
    starts_at: datetime
    status: Literal["draft", "published", "cancelled"] = "draft"
    prices: list[EventPriceIn] | None = None
    closed_sections: list[str] = []


class EventPatch(BaseModel):
    title: str | None = Field(default=None, min_length=3, max_length=200)
    kind: Literal["football", "concert", "autre"] | None = None
    description: str | None = Field(default=None, max_length=4000)
    starts_at: datetime | None = None
    status: Literal["draft", "published", "cancelled"] | None = None
    prices: list[EventPriceIn] | None = None
    closed_sections: list[str] | None = None


# ----- Réservations ---------------------------------------------------------- #
class LockIn(BaseModel):
    seat_ids: list[int] = Field(min_length=1, max_length=20)

    @field_validator("seat_ids")
    @classmethod
    def _ids(cls, v: list[int]) -> list[int]:
        if any(i <= 0 for i in v):
            raise ValueError("identifiants de sièges invalides")
        return v


class RecommendIn(BaseModel):
    count: int = Field(default=2, ge=1, le=8)
    max_price_minor: int | None = Field(default=None, ge=0, le=10_000_000)
    priority: Literal["view", "proximity", "value"] = "view"
    adjacent: bool = True
    accessible_only: bool = False
    limit: int = Field(default=5, ge=1, le=10)


# ----- Administration -------------------------------------------------------- #
class SectionCategoryIn(BaseModel):
    category_code: str = Field(min_length=1, max_length=20)


class SeatServiceIn(BaseModel):
    out_of_service: bool
    seat_ids: list[int] | None = Field(default=None, max_length=5000)
    section_code: str | None = None
    row: int | None = Field(default=None, ge=1, le=200)


class SeatBlockIn(BaseModel):
    seat_ids: list[int] | None = Field(default=None, max_length=5000)
    section_code: str | None = None
    blocked: bool = True
    reason: str = Field(default="Quota organisateur", max_length=120)


class RoleIn(BaseModel):
    role: Literal["spectator", "manager", "admin"]


class ActiveIn(BaseModel):
    is_active: bool


class AssetPatch(BaseModel):
    is_active: bool | None = None
    notes: str | None = Field(default=None, max_length=1000)
