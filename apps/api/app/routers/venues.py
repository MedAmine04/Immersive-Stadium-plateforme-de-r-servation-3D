from __future__ import annotations

import hashlib

from fastapi import APIRouter, HTTPException, Request, Response
from fastapi.responses import FileResponse
from sqlalchemy import select

from ..config import get_settings
from ..deps import DB
from ..models import MediaAsset, Section, Stand, TicketCategory, Venue
from ..services.seat_index import get_index

router = APIRouter(prefix="/api/venues", tags=["venues"])
settings = get_settings()


def _venue(db, slug: str) -> Venue:
    v = db.scalar(select(Venue).where(Venue.slug == slug))
    if not v:
        raise HTTPException(404, "Lieu introuvable")
    return v


@router.get("")
def list_venues(db: DB):
    return [
        {"slug": v.slug, "name": v.name, "city": v.city, "country": v.country, "capacity": v.declared_capacity,
         "data_fidelity": v.data_fidelity}
        for v in db.scalars(select(Venue).order_by(Venue.name))
    ]


@router.get("/{slug}")
def venue_detail(slug: str, db: DB):
    v = _venue(db, slug)
    stands = db.scalars(select(Stand).where(Stand.venue_id == v.id).order_by(Stand.code)).all()
    secs = db.scalars(select(Section).where(Section.venue_id == v.id).order_by(Section.code)).all()
    cats = db.scalars(select(TicketCategory).where(TicketCategory.venue_id == v.id).order_by(TicketCategory.sort_order)).all()
    cat_by_id = {c.id: c.code for c in cats}
    return {
        "slug": v.slug, "name": v.name, "city": v.city, "country": v.country, "description": v.description,
        "capacity": v.declared_capacity, "data_fidelity": v.data_fidelity, "fidelity_notes": v.fidelity_notes,
        "pitch": {"length": v.pitch_length, "width": v.pitch_width},
        "bowl": v.bowl_spec,
        "stands": [{"code": s.code, "name": s.name, "phi_start": s.phi_start, "phi_end": s.phi_end} for s in stands],
        "sections": [
            {"code": s.code, "name": s.name, "stand": next(st.code for st in stands if st.id == s.stand_id),
             "tier": s.tier, "block": s.block, "category": cat_by_id[s.category_id], "seat_count": s.seat_count,
             "phi_start": s.phi_start, "phi_end": s.phi_end}
            for s in secs
        ],
        "categories": [{"code": c.code, "name": c.name, "color": c.color, "default_price_minor": c.default_price_minor}
                       for c in cats],
    }


@router.get("/{slug}/sections/{code}/seats")
def section_seats(slug: str, code: str, request: Request, db: DB):
    """Géométrie et métriques d'un secteur (JSON columnaire, mis en cache et protégé par ETag)."""
    v = _venue(db, slug)
    idx = get_index(db, v.id)
    payload = idx.section_payload(code)
    if payload is None:
        raise HTTPException(404, "Secteur introuvable")
    etag = '"' + hashlib.sha1(payload).hexdigest()[:16] + '"'
    if request.headers.get("if-none-match") == etag:
        return Response(status_code=304, headers={"ETag": etag})
    return Response(payload, media_type="application/json", headers={"ETag": etag, "Cache-Control": "private, max-age=0, must-revalidate"})


@router.get("/{slug}/seats/{seat_id}")
def seat_detail(slug: str, seat_id: int, db: DB):
    from ..models import Row, Seat, SeatGeometry

    v = _venue(db, slug)
    row = db.execute(
        select(Seat, Section, Row, SeatGeometry, TicketCategory)
        .join(Section, Section.id == Seat.section_id).join(Row, Row.id == Seat.row_id)
        .join(SeatGeometry, SeatGeometry.seat_id == Seat.id).join(TicketCategory, TicketCategory.id == Section.category_id)
        .where(Seat.id == seat_id, Seat.venue_id == v.id)
    ).first()
    if not row:
        raise HTTPException(404, "Siège introuvable")
    seat, sec, r, g, cat = row
    return {
        "id": seat.id, "code": seat.code, "section": sec.code, "section_name": sec.name, "tier": sec.tier,
        "row": r.number, "number": seat.number, "category": cat.code, "accessible": seat.accessible,
        "out_of_service": seat.out_of_service,
        "fidelity": "estimated" if seat.estimated else "verified",
        "position": {"x": g.x, "y": g.y, "z": g.z}, "rotation_y": g.rot_y,
        "viewpoint": {"height": g.eye_height, "target": [g.target_x, g.target_y, g.target_z]},
        "metrics": {"dist_center": g.dist_center, "dist_edge": g.dist_edge, "elevation_deg": g.elevation_deg,
                    "clearance_deg": g.clearance_deg, "cover": g.cover, "c_value": g.c_value,
                    "obstructed": g.obstructed, "view_score": g.view_score},
    }


@router.get("/{slug}/assets")
def public_assets(slug: str, db: DB):
    v = _venue(db, slug)
    return [
        {"id": a.id, "kind": a.kind, "version": a.version, "source": a.source, "sha256": a.sha256, "size": a.size_bytes}
        for a in db.scalars(select(MediaAsset).where(MediaAsset.venue_id == v.id, MediaAsset.is_active.is_(True)))
    ]


@router.get("/{slug}/assets/{asset_id}/file")
def asset_file(slug: str, asset_id: int, db: DB):
    import os

    v = _venue(db, slug)
    a = db.scalar(select(MediaAsset).where(MediaAsset.id == asset_id, MediaAsset.venue_id == v.id, MediaAsset.is_active.is_(True)))
    if not a:
        raise HTTPException(404, "Ressource introuvable")
    path = os.path.join(settings.upload_dir, a.storage_name)
    if not os.path.isfile(path):
        raise HTTPException(404, "Fichier introuvable")
    return FileResponse(path, media_type=a.content_type, headers={"X-Content-Type-Options": "nosniff", "Cache-Control": "public, max-age=3600"})
