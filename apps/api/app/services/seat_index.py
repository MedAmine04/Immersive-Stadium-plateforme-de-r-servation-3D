"""Index mémoire de la géométrie des sièges (lecture seule, reconstruit à la demande).

La géométrie est statique ; seule l'affectation des catégories et l'état « hors service »
sont modifiables par l'administration (dans ce cas, ``invalidate`` est appelé).
"""
from __future__ import annotations

import json
import threading
from dataclasses import dataclass, field

import numpy as np
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import Row, Seat, SeatGeometry, Section, Stand, TicketCategory

COVER_CODE = {"open": 0, "partial": 1, "covered": 2}


@dataclass
class SeatIndex:
    venue_id: int
    ids: np.ndarray
    section_id: np.ndarray
    row_id: np.ndarray
    row_no: np.ndarray
    number: np.ndarray
    x: np.ndarray
    y: np.ndarray
    z: np.ndarray
    ry: np.ndarray
    view_score: np.ndarray
    dist_edge: np.ndarray
    elevation: np.ndarray
    c_value: np.ndarray
    clearance: np.ndarray
    cover: np.ndarray
    accessible: np.ndarray
    obstructed: np.ndarray
    section_codes: dict[int, str]
    section_slices: dict[str, np.ndarray]  # code -> indices dans les tableaux
    id_to_pos: dict[int, int] = field(default_factory=dict)
    _section_json: dict[str, bytes] = field(default_factory=dict)

    # ----------------------------------------------------------------- #
    def section_payload(self, code: str) -> bytes | None:
        """JSON columnaire d'un secteur (mis en cache)."""
        if code in self._section_json:
            return self._section_json[code]
        idx = self.section_slices.get(code)
        if idx is None:
            return None
        flags = (
            self.accessible[idx].astype(int)
            + 2 * self.obstructed[idx].astype(int)
            + 4 * self.cover[idx].astype(int)
        )
        payload = {
            "section": code,
            "count": int(idx.size),
            "ids": self.ids[idx].tolist(),
            "rows": self.row_no[idx].tolist(),
            "numbers": self.number[idx].tolist(),
            "x": np.round(self.x[idx], 2).tolist(),
            "y": np.round(self.y[idx], 2).tolist(),
            "z": np.round(self.z[idx], 2).tolist(),
            "ry": np.round(self.ry[idx], 3).tolist(),
            "vs": np.round(self.view_score[idx], 1).tolist(),
            "de": np.round(self.dist_edge[idx], 1).tolist(),
            "el": np.round(self.elevation[idx], 1).tolist(),
            "cv": np.round(np.minimum(self.c_value[idx], 9.0), 2).tolist(),
            "cl": np.round(self.clearance[idx], 0).astype(int).tolist(),
            "fl": flags.tolist(),
        }
        data = json.dumps(payload, separators=(",", ":")).encode()
        self._section_json[code] = data
        return data

    def section_bbox(self, code: str) -> dict | None:
        idx = self.section_slices.get(code)
        if idx is None or idx.size == 0:
            return None
        pts = np.stack([self.x[idx], self.y[idx], self.z[idx]], axis=1)
        return {
            "min": np.round(pts.min(axis=0), 2).tolist(),
            "max": np.round(pts.max(axis=0), 2).tolist(),
            "center": np.round(pts.mean(axis=0), 2).tolist(),
        }


_cache: dict[int, SeatIndex] = {}
_lock = threading.Lock()


def get_index(db: Session, venue_id: int) -> SeatIndex:
    idx = _cache.get(venue_id)
    if idx is not None:
        return idx
    with _lock:
        idx = _cache.get(venue_id)
        if idx is None:
            idx = _build(db, venue_id)
            _cache[venue_id] = idx
    return idx


def invalidate(venue_id: int | None = None) -> None:
    with _lock:
        if venue_id is None:
            _cache.clear()
        else:
            _cache.pop(venue_id, None)


def _build(db: Session, venue_id: int) -> SeatIndex:
    rows = db.execute(
        select(
            Seat.id,
            Seat.section_id,
            Seat.row_id,
            Row.number,
            Seat.number,
            Seat.accessible,
            SeatGeometry.x,
            SeatGeometry.y,
            SeatGeometry.z,
            SeatGeometry.rot_y,
            SeatGeometry.view_score,
            SeatGeometry.dist_edge,
            SeatGeometry.elevation_deg,
            SeatGeometry.c_value,
            SeatGeometry.clearance_deg,
            SeatGeometry.cover,
            SeatGeometry.obstructed,
        )
        .join(SeatGeometry, SeatGeometry.seat_id == Seat.id)
        .join(Row, Row.id == Seat.row_id)
        .where(Seat.venue_id == venue_id)
        .order_by(Seat.section_id, Seat.row_id, Seat.number)
    ).all()
    n = len(rows)
    cols = list(zip(*rows)) if n else [[] for _ in range(17)]
    arr = lambda c, dt: np.asarray(c, dtype=dt)  # noqa: E731
    section_id = arr(cols[1], np.int32)
    sec_codes = {sid: code for sid, code in db.execute(select(Section.id, Section.code).where(Section.venue_id == venue_id))}
    slices: dict[str, np.ndarray] = {}
    for sid, code in sec_codes.items():
        slices[code] = np.nonzero(section_id == sid)[0]
    ids = arr(cols[0], np.int64)
    index = SeatIndex(
        venue_id=venue_id,
        ids=ids,
        section_id=section_id,
        row_id=arr(cols[2], np.int32),
        row_no=arr(cols[3], np.int16),
        number=arr(cols[4], np.int16),
        accessible=arr(cols[5], bool),
        x=arr(cols[6], np.float32),
        y=arr(cols[7], np.float32),
        z=arr(cols[8], np.float32),
        ry=arr(cols[9], np.float32),
        view_score=arr(cols[10], np.float32),
        dist_edge=arr(cols[11], np.float32),
        elevation=arr(cols[12], np.float32),
        c_value=arr(cols[13], np.float32),
        clearance=arr(cols[14], np.float32),
        cover=np.asarray([COVER_CODE.get(c, 0) for c in cols[15]], dtype=np.int8),
        obstructed=arr(cols[16], bool),
        section_codes=sec_codes,
        section_slices=slices,
    )
    index.id_to_pos = {int(i): p for p, i in enumerate(ids.tolist())}
    return index
