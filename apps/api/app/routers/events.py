from __future__ import annotations

from fastapi import APIRouter, HTTPException
from sqlalchemy import func, select

from ..deps import DB, OptionalUser
from ..models import Event, EventPrice, EventStatus, ReservationItem, Seat, Section, TicketCategory, Venue
from ..schemas import RecommendIn
from ..services import booking
from ..services.seat_index import get_index

router = APIRouter(prefix="/api/events", tags=["events"])


def event_out(db, ev: Event) -> dict:
    prices = db.execute(
        select(TicketCategory.code, TicketCategory.name, TicketCategory.color, EventPrice.price_minor, EventPrice.on_sale)
        .join(EventPrice, EventPrice.category_id == TicketCategory.id).where(EventPrice.event_id == ev.id)
        .order_by(TicketCategory.sort_order)
    ).all()
    return {
        "id": ev.id, "title": ev.title, "kind": ev.kind, "description": ev.description,
        "starts_at": ev.starts_at.isoformat(), "status": ev.status, "demo_mode": ev.demo_mode,
        "venue_id": ev.venue_id,
        "venue_slug": db.scalar(select(Venue.slug).where(Venue.id == ev.venue_id)),
        "prices": [{"category": c, "name": n, "color": col, "price_minor": p, "on_sale": s} for c, n, col, p, s in prices],
    }


def get_published(db, event_id: int, allow_draft: bool = False) -> Event:
    ev = db.get(Event, event_id)
    if not ev or (ev.status == EventStatus.draft.value and not allow_draft):
        raise HTTPException(404, "Événement introuvable")
    return ev


@router.get("")
def list_events(db: DB):
    evs = db.scalars(select(Event).where(Event.status == EventStatus.published.value).order_by(Event.starts_at)).all()
    return [event_out(db, e) for e in evs]


@router.get("/{event_id}")
def get_event(event_id: int, db: DB):
    return event_out(db, get_published(db, event_id))


@router.get("/{event_id}/availability")
def event_availability(event_id: int, db: DB, user: OptionalUser):
    return booking.availability(db, get_published(db, event_id), user)


@router.post("/{event_id}/recommend")
def recommend(event_id: int, body: RecommendIn, db: DB):
    """Recommandation explicable : filtrage par contraintes + score déterministe (aucun modèle opaque)."""
    ev = get_published(db, event_id)
    av = booking.availability(db, ev, None)
    idx = get_index(db, ev.venue_id)
    import numpy as np

    unavailable = np.isin(idx.ids, np.array(sorted(set(av["taken"]) | set(av["blocked_seats"])), dtype=np.int64))
    closed = set(av["closed_sections"])
    cat_prices = {k: v["price_minor"] for k, v in av["prices"].items() if v["on_sale"]}
    sec_cat = av["section_categories"]
    price = np.zeros(idx.ids.size, dtype=np.int64)
    ok = ~unavailable
    for code, sl in idx.section_slices.items():
        p = cat_prices.get(sec_cat.get(code), None)
        if p is None or code in closed:
            ok[sl] = False
        else:
            price[sl] = p
    if body.max_price_minor is not None:
        ok &= price <= body.max_price_minor
    if body.accessible_only:
        ok &= idx.accessible
    ok &= ~idx.obstructed
    if body.priority == "proximity":
        score = 100 - np.minimum(idx.dist_edge, 100)
    elif body.priority == "value":
        score = idx.view_score * 1.0 - (price / max(price.max(), 1)) * 40
    else:
        score = idx.view_score.astype(float)
    results = []
    # groupes de sièges adjacents (même rangée, numéros consécutifs)
    order = np.argsort(-score)
    used_rows: set[tuple[int, int]] = set()
    pos_ok = np.nonzero(ok)[0]
    ok_set = set(pos_ok.tolist())
    for p in order.tolist():
        if p not in ok_set:
            continue
        if body.count == 1 or not body.adjacent:
            group = [p]
            if body.count > 1:
                continue
        else:
            group = [p]
            q = p
            while len(group) < body.count:
                q += 1
                if q < idx.ids.size and q in ok_set and idx.row_id[q] == idx.row_id[p] and idx.number[q] == idx.number[q - 1] + 1:
                    group.append(q)
                else:
                    break
            if len(group) < body.count:
                continue
        key = (int(idx.row_id[p]), int(idx.number[p]) // 6)
        if key in used_rows:
            continue
        used_rows.add(key)
        code = idx.section_codes[int(idx.section_id[p])]
        results.append({
            "seat_ids": [int(idx.ids[g]) for g in group],
            "section": code, "row": int(idx.row_no[p]), "numbers": [int(idx.number[g]) for g in group],
            "total_minor": int(sum(price[g] for g in group)),
            "score": round(float(np.mean([score[g] for g in group])), 1),
            "why": {
                "view_score": round(float(idx.view_score[p]), 1), "dist_edge_m": round(float(idx.dist_edge[p]), 1),
                "elevation_deg": round(float(idx.elevation[p]), 1),
                "cover": ["open", "partial", "covered"][int(idx.cover[p])],
            },
        })
        if len(results) >= body.limit:
            break
    return {"criteria": body.model_dump(), "results": results, "disclaimer": "Estimations indicatives (modèle non vérifié)."}
