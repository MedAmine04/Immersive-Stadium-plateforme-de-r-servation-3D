"""Générateur procédural d'un stade de football (cuvette en rectangle arrondi).

Ce module produit l'inventaire complet des tribunes, secteurs, rangées et sièges
avec leurs coordonnées 3D, leur orientation et des métriques de vue.

IMPORTANT - fidélité des données
--------------------------------
Les plans officiels du stade ne sont pas disponibles. Le modèle est donc un
**modèle estimé**, calibré sur les seules données publiques :

  * capacité totale            : 68 700 places
  * tribune sud (« Kop »)      : 23 000 places sur deux niveaux
  * porte-à-faux du niveau haut: environ 8 m au-dessus du niveau bas
  * terrain                    : 105 m x 68 m
  * tribune ouest              : VVIP / VIP / loges, centrées sur la loge royale
  * tribune est                : salons et loges sur trois niveaux

Tout le reste (nombre de rangées, découpage en blocs, catégories par bloc,
numérotation) est une **hypothèse** et chaque siège porte le drapeau
``estimated = True``. Remplacer ce module par un import de l'inventaire officiel
(plans + numérotation) suffit à passer en mode « vérifié » : le reste de la
plateforme ne dépend que des données stockées en base.

Repère (mètres, axe Y vertical) : le grand axe du terrain est Z.
    +X = Est, -X = Ouest, +Z = Sud, -Z = Nord. Le terrain est au niveau y = 0.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field

import numpy as np

# --------------------------------------------------------------------------- #
# Constantes
# --------------------------------------------------------------------------- #
PITCH_LENGTH = 105.0  # le long de Z
PITCH_WIDTH = 68.0  # le long de X
HL = PITCH_LENGTH / 2.0
HW = PITCH_WIDTH / 2.0

EYE_HEIGHT = 1.15  # hauteur des yeux d'un spectateur assis au-dessus de la marche
SEAT_PITCH = 0.48  # entraxe entre deux sièges (m)
C_VALUE_TARGET = 0.10  # dégagement visuel cible au-dessus de la tête du rang devant (m)

TARGET_CAPACITY = 68_700
TARGET_SOUTH = 23_000

ROOF_EDGE_D = 20.0  # bord intérieur du toit à 360° : décalage depuis les limites du terrain
ROOF_LIP_Y = 34.0  # hauteur de la sous-face du toit à son bord intérieur
ROOF_SLOPE = 0.30  # pente de la sous-face (m de hauteur par m vers l'extérieur)
SLAB_THICKNESS = 1.5  # épaisseur de la dalle du niveau haut en porte-à-faux

CORNER_R0 = 10.0
CORNER_K = 0.9

# Polar angles (degrés, 0 = Est, 90 = Sud, 180 = Ouest, 270 = Nord)
STAND_RANGES = {
    "E": (-34.0, 34.0),
    "S": (34.0, 146.0),
    "W": (146.0, 214.0),
    "N": (214.0, 326.0),
}
STAND_NAMES = {
    "E": "Tribune Est",
    "S": "Tribune Sud (Kop)",
    "W": "Tribune Ouest (Honneur)",
    "N": "Tribune Nord",
}
TIER_NAMES = {"L": "Niveau bas", "M": "Niveau 2 (premium)", "U": "Niveau haut"}


# --------------------------------------------------------------------------- #
# Géométrie de la cuvette
# --------------------------------------------------------------------------- #
def ring_params(d: float) -> tuple[float, float, float]:
    """Demi-étendues et rayon de coin du rectangle arrondi décalé de ``d`` mètres."""
    a = HW + d
    b = HL + d
    r = min(CORNER_R0 + CORNER_K * d, a - 1.0, b - 1.0)
    return a, b, r


def ring_length(d: float) -> float:
    a, b, r = ring_params(d)
    return 4 * a + 4 * b - 8 * r + 2 * math.pi * r


def ring_at_arclength(d: float, s: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Position (x, z) pour des abscisses curvilignes ``s`` sur l'anneau de décalage ``d``.

    Le tracé commence au milieu du côté Est et tourne vers le Sud (angle polaire croissant).
    """
    a, b, r = ring_params(d)
    seg_lengths = np.array(
        [
            b - r,  # Est, moitié basse (vers +Z)
            math.pi * r / 2,  # coin SE
            2 * (a - r),  # côté Sud
            math.pi * r / 2,  # coin SO
            2 * (b - r),  # côté Ouest
            math.pi * r / 2,  # coin NO
            2 * (a - r),  # côté Nord
            math.pi * r / 2,  # coin NE
            b - r,  # Est, moitié haute
        ]
    )
    bounds = np.concatenate([[0.0], np.cumsum(seg_lengths)])
    total = bounds[-1]
    s = np.mod(s, total)
    idx = np.clip(np.searchsorted(bounds, s, side="right") - 1, 0, 8)
    local = s - bounds[idx]
    x = np.zeros_like(s)
    z = np.zeros_like(s)

    def arc(mask, cx, cz, start_deg):
        theta = math.radians(start_deg) + local[mask] / r
        x[mask] = cx + r * np.cos(theta)
        z[mask] = cz + r * np.sin(theta)

    m = idx == 0
    x[m], z[m] = a, local[m]
    arc(idx == 1, a - r, b - r, 0.0)
    m = idx == 2
    x[m], z[m] = (a - r) - local[m], b
    arc(idx == 3, -(a - r), b - r, 90.0)
    m = idx == 4
    x[m], z[m] = -a, (b - r) - local[m]
    arc(idx == 5, -(a - r), -(b - r), 180.0)
    m = idx == 6
    x[m], z[m] = -(a - r) + local[m], -b
    arc(idx == 7, a - r, -(b - r), 270.0)
    m = idx == 8
    x[m], z[m] = a, -(b - r) + local[m]
    return x, z


def polar_deg(x: np.ndarray, z: np.ndarray) -> np.ndarray:
    return np.mod(np.degrees(np.arctan2(z, x)), 360.0)


def inward_normal(x: np.ndarray, z: np.ndarray, d: float) -> tuple[np.ndarray, np.ndarray]:
    """Normale (unitaire) dirigée vers le terrain, calculée par différences finies sur le profil."""
    a, b, r = ring_params(d)
    cx = np.clip(x, -(a - r), a - r)
    cz = np.clip(z, -(b - r), b - r)
    nx, nz = cx - x, cz - z
    norm = np.hypot(nx, nz)
    # Sur les parties droites, la normale est l'axe ; dans les coins, c'est la direction vers le centre du coin.
    straight = norm < 1e-9
    out_x = np.where(np.abs(x) >= a - 1e-6, -np.sign(x), 0.0)
    out_z = np.where(np.abs(z) >= b - 1e-6, -np.sign(z), 0.0)
    nxu = np.where(straight, out_x, nx / np.where(norm == 0, 1, norm))
    nzu = np.where(straight, out_z, nz / np.where(norm == 0, 1, norm))
    return nxu, nzu


# --------------------------------------------------------------------------- #
# Définition des tribunes / niveaux
# --------------------------------------------------------------------------- #
@dataclass
class TierDef:
    code: str  # L, M, U
    rows: int
    d_start: float
    depth: float
    seat_pitch: float = SEAT_PITCH
    blocks: int = 6
    aisle: float = 1.8  # largeur d'allée entre blocs (m)
    # Pour le porte-à-faux : décalage horizontal par rapport à la dernière rangée du niveau précédent
    overhang_over_previous: float | None = None
    headroom: float = 6.5  # hauteur libre sous le porte-à-faux (m)
    y_start: float | None = None  # si None : calculé par la règle du C-value


@dataclass
class StandDef:
    code: str
    tiers: list[TierDef] = field(default_factory=list)


def default_stands() -> list[StandDef]:
    P = SEAT_PITCH
    return [
        StandDef(
            "S",
            [
                TierDef("L", rows=30, d_start=9.0, depth=0.85, blocks=8, seat_pitch=P),
                TierDef("U", rows=38, d_start=0.0, depth=0.78, blocks=8, seat_pitch=P, overhang_over_previous=8.0),
            ],
        ),
        StandDef(
            "N",
            [
                TierDef("L", rows=28, d_start=9.0, depth=0.85, blocks=8, seat_pitch=P),
                TierDef("U", rows=28, d_start=40.0, depth=0.78, blocks=8, seat_pitch=P),
            ],
        ),
        StandDef(
            "E",
            [
                TierDef("L", rows=32, d_start=8.0, depth=0.85, blocks=6, seat_pitch=P),
                TierDef("M", rows=2, d_start=36.0, depth=1.20, seat_pitch=0.62, blocks=22, aisle=0.8),
                TierDef("U", rows=38, d_start=41.0, depth=0.78, blocks=6, seat_pitch=P),
            ],
        ),
        StandDef(
            "W",
            [
                TierDef("L", rows=32, d_start=8.0, depth=0.85, blocks=6, seat_pitch=P),
                TierDef("M", rows=2, d_start=36.0, depth=1.20, seat_pitch=0.62, blocks=22, aisle=0.8),
                TierDef("U", rows=38, d_start=41.0, depth=0.78, blocks=6, seat_pitch=P),
            ],
        ),
    ]


# Catégories tarifaires (code, nom, couleur, prix MAD par défaut). Prix repris des grilles publiques
# de billetterie des matchs de l'équipe nationale (valeurs de démonstration, modifiables).
CATEGORIES = [
    ("CAT3", "Catégorie 3", "#7aa2c8", 10_000),
    ("CAT2", "Catégorie 2", "#4f9d83", 20_000),
    ("CAT1", "Catégorie 1", "#d9a441", 30_000),
    ("HOSP", "Salon d'hospitalité", "#b06ab3", 100_000),
    ("VIP", "Tribune d'honneur (VIP)", "#c8553d", 150_000),
    ("VVIP", "Tribune d'honneur supérieure (VVIP)", "#8c2f39", 200_000),
    ("SKY", "Loge (Skybox)", "#3a4a63", 170_000),
]


def category_for(stand: str, tier: str, block: int, blocks: int) -> str:
    """Affectation HYPOTHÉTIQUE des catégories (modifiable depuis l'administration)."""
    center = (blocks - 1) / 2.0
    dist = abs(block - center)
    rel = dist / max(center, 1.0)  # 0 = centre, 1 = extrémité
    if stand in ("E", "W"):
        if tier == "M":
            if stand == "W":
                return "VVIP" if dist <= 1.5 else "SKY"
            return "SKY"
        if tier == "L":
            if stand == "W" and dist <= 0.5:
                return "VIP"
            if stand == "E" and dist <= 0.5:
                return "HOSP"
            return "CAT1" if rel <= 0.7 else "CAT2"
        return "CAT2" if rel <= 0.5 else "CAT3"
    # tribunes d'extrémité (supporters)
    if tier == "L":
        return "CAT3" if rel <= 0.55 else "CAT2"
    return "CAT3" if rel <= 0.45 else "CAT2"


# --------------------------------------------------------------------------- #
# Profils de rangées (dégagement visuel / C-value)
# --------------------------------------------------------------------------- #
def tier_profile(t: TierDef, prev_last: tuple[float, float] | None, prev_profile: list[tuple[float, float]] | None):
    """Retourne la liste [(d, y)] des rangées du niveau (y = niveau de la marche)."""
    ds = [t.d_start + i * t.depth for i in range(t.rows)]
    if t.overhang_over_previous is not None and prev_profile:
        d_last = prev_profile[-1][0]
        d0 = d_last - t.overhang_over_previous
        ds = [d0 + i * t.depth for i in range(t.rows)]
        # hauteur de départ = niveau du gradin inférieur au droit + garde au sol
        pd = np.array([p[0] for p in prev_profile])
        py = np.array([p[1] for p in prev_profile])
        y0 = float(np.interp(d0, pd, py)) + t.headroom
    elif t.y_start is not None:
        y0 = t.y_start
    elif prev_last is not None:
        d_prev, eye_prev = prev_last
        eye0 = (eye_prev + C_VALUE_TARGET) * ds[0] / d_prev
        y0 = eye0 - EYE_HEIGHT
        y0 = max(y0, prev_last[1] - EYE_HEIGHT + 2.8)
    else:
        y0 = 1.2
    prof = []
    eye_prev = y0 + EYE_HEIGHT
    prof.append((ds[0], y0))
    for i in range(1, t.rows):
        eye = (eye_prev + C_VALUE_TARGET) * ds[i] / ds[i - 1]
        eye = max(eye, eye_prev + 0.28)
        prof.append((ds[i], eye - EYE_HEIGHT))
        eye_prev = eye
    return prof


# --------------------------------------------------------------------------- #
# Génération
# --------------------------------------------------------------------------- #
def _block_edges(lo: float, hi: float, n: int) -> np.ndarray:
    return np.linspace(lo, hi, n + 1)


def generate(target: int = TARGET_CAPACITY, trim_to_target: bool = True) -> dict:
    stands = default_stands()
    sections: list[dict] = []
    seats: list[dict] = []
    stand_defs: list[dict] = []
    tier_profiles: dict[tuple[str, str], list[tuple[float, float]]] = {}
    tier_specs: list[dict] = []

    for sd in stands:
        lo, hi = STAND_RANGES[sd.code]
        stand_defs.append(
            {"code": sd.code, "name": STAND_NAMES[sd.code], "phi_start": lo % 360.0, "phi_end": hi % 360.0}
        )
        prev_profile: list[tuple[float, float]] | None = None
        prev_last: tuple[float, float] | None = None
        for t in sd.tiers:
            prof = tier_profile(t, prev_last, prev_profile)
            tier_profiles[(sd.code, t.code)] = prof
            prev_profile = prof
            d_last, y_last = prof[-1]
            prev_last = (d_last, y_last + EYE_HEIGHT)
            tier_specs.append(
                {
                    "stand": sd.code,
                    "tier": t.code,
                    "phi_start": lo % 360.0,
                    "phi_end": hi % 360.0,
                    "rows": [{"d": round(d, 3), "y": round(y, 3)} for d, y in prof],
                    "blocks": t.blocks,
                }
            )
            _gen_tier(sd.code, t, prof, lo, hi, sections, seats)

    if trim_to_target:
        _calibrate(seats, sections, target)

    _compute_metrics(seats, sections, tier_profiles)

    bowl = {
        "pitch": {"length": PITCH_LENGTH, "width": PITCH_WIDTH},
        "corner": {"r0": CORNER_R0, "k": CORNER_K},
        "eye_height": EYE_HEIGHT,
        "roof": {"edge_d": ROOF_EDGE_D, "lip_y": ROOF_LIP_Y, "slope": ROOF_SLOPE},
        "slab_thickness": SLAB_THICKNESS,
        "tiers": tier_specs,
    }
    return {"stands": stand_defs, "sections": sections, "seats": seats, "bowl": bowl, "categories": CATEGORIES}


def _gen_tier(stand: str, t: TierDef, prof, lo: float, hi: float, sections: list, seats: list) -> None:
    blocks = t.blocks
    edges = _block_edges(lo, hi, blocks)
    # sections
    first_section_index = len(sections)
    for b in range(blocks):
        code = f"{stand}-{t.code}-{b + 1:02d}"
        cat = category_for(stand, t.code, b, blocks)
        sections.append(
            {
                "code": code,
                "stand": stand,
                "tier": t.code,
                "block": b + 1,
                "name": f"{STAND_NAMES[stand]} · {TIER_NAMES[t.code]} · Bloc {b + 1:02d}",
                "category": cat,
                "phi_start": float(edges[b] % 360.0),
                "phi_end": float(edges[b + 1] % 360.0),
                "seat_count": 0,
            }
        )
    for r_idx, (d, y) in enumerate(prof):
        row_no = r_idx + 1
        total = ring_length(d)
        n = int(total / t.seat_pitch)
        s = (np.arange(n) + 0.5) * (total / n)
        x, z = ring_at_arclength(d, s)
        phi = polar_deg(x, z)
        # angle relatif à la tribune, dans l'intervalle [lo, hi]
        phi_rel = np.where(phi > 180.0, phi - 360.0, phi) if lo < 0 else phi
        in_stand = (phi_rel >= lo) & (phi_rel < hi)
        idx = np.nonzero(in_stand)[0]
        if idx.size == 0:
            continue
        # tri par angle croissant
        order = np.argsort(phi_rel[idx])
        idx = idx[order]
        xs, zs, ph = x[idx], z[idx], phi_rel[idx]
        nx, nz = inward_normal(xs, zs, d)
        rho = np.hypot(xs, zs)
        gap_deg = np.degrees((t.aisle / 2.0) / np.maximum(rho, 1.0))
        block_of = np.clip(np.searchsorted(edges, ph, side="right") - 1, 0, blocks - 1)
        # distance angulaire au bord de bloc le plus proche
        left = ph - edges[block_of]
        right = edges[block_of + 1] - ph
        keep = (left >= gap_deg) & (right >= gap_deg)
        counters = np.zeros(blocks, dtype=int)
        for k in range(idx.size):
            if not keep[k]:
                continue
            b = int(block_of[k])
            counters[b] += 1
            seats.append(
                {
                    "section": f"{stand}-{t.code}-{b + 1:02d}",
                    "stand": stand,
                    "tier": t.code,
                    "row": row_no,
                    "number": int(counters[b]),
                    "x": float(xs[k]),
                    "y": float(y),
                    "z": float(zs[k]),
                    "ry": float(math.atan2(nx[k], nz[k])),
                    "d": float(d),
                    "phi": float(ph[k]),
                }
            )
    # le numéro de siège repart de 1 à chaque rangée/bloc : déjà géré (compteurs par rangée)


def _trim(seats: list[dict], stands: set[str], count: int) -> int:
    """Retire ``count`` sièges en bout de dernière rangée des niveaux hauts des tribunes données."""
    if count <= 0:
        return 0
    max_row: dict[str, int] = {}
    for s in seats:
        if s["tier"] == "U" and s["stand"] in stands:
            max_row[s["section"]] = max(max_row.get(s["section"], 0), s["row"])
    by_section: dict[str, list[int]] = {}
    for i, s in enumerate(seats):
        if s["tier"] == "U" and s["stand"] in stands and s["row"] == max_row.get(s["section"]):
            by_section.setdefault(s["section"], []).append(i)
    keys = sorted(by_section)
    ptr = {k: 0 for k in keys}
    remove: set[int] = set()
    while len(remove) < count and keys:
        progressed = False
        for k in keys:
            lst = by_section[k]
            if ptr[k] < len(lst) // 2:  # jamais plus de la moitié de la dernière rangée
                remove.add(lst[len(lst) - 1 - ptr[k]])
                ptr[k] += 1
                progressed = True
                if len(remove) >= count:
                    break
        if not progressed:
            break
    seats[:] = [s for i, s in enumerate(seats) if i not in remove]
    return len(remove)


def _calibrate(seats: list[dict], sections: list[dict], target: int) -> None:
    """Ajuste les effectifs aux chiffres publics : Kop sud = 23 000, total = capacité officielle."""
    south = sum(1 for s in seats if s["stand"] == "S")
    _trim(seats, {"S"}, south - TARGET_SOUTH)
    excess = len(seats) - target
    _trim(seats, {"N", "E", "W"}, excess)


def _compute_metrics(seats: list[dict], sections: list[dict], profiles) -> None:
    n = len(seats)
    x = np.array([s["x"] for s in seats])
    y = np.array([s["y"] for s in seats])
    z = np.array([s["z"] for s in seats])
    d = np.array([s["d"] for s in seats])
    eye = y + EYE_HEIGHT
    # distance horizontale au centre et au bord du terrain le plus proche
    dist_center = np.hypot(x, z)
    dx = np.maximum(np.abs(x) - HW, 0.0)
    dz = np.maximum(np.abs(z) - HL, 0.0)
    dist_edge = np.hypot(dx, dz)
    elev = np.degrees(np.arctan2(eye, dist_center))  # angle de plongée vers le centre
    # coefficient de dégagement : angle libre au-dessus de l'horizon vers le centre du terrain
    clearance = np.full(n, 90.0)
    cover = np.empty(n, dtype=object)
    cover[:] = "open"
    # toit à 360° : sous-face en pente (plus haute vers l'extérieur). On cherche l'angle libre minimal
    # au-dessus de l'horizon, en direction du centre du terrain, avant de rencontrer la sous-face.
    under_roof = d > ROOF_EDGE_D
    hs = np.linspace(0.5, 1.0, 12)[None, :] * np.maximum(d - ROOF_EDGE_D, 0.5)[:, None]
    y_roof = ROOF_LIP_Y + ROOF_SLOPE * np.maximum(d[:, None] - hs - ROOF_EDGE_D, 0.0)
    roof_ang = np.degrees(np.arctan2(y_roof - eye[:, None], hs)).min(axis=1)
    roof_clear = np.maximum(roof_ang, 0.0)
    clearance = np.where(under_roof, np.minimum(clearance, roof_clear), clearance)
    horiz_to_roof = np.maximum(d - ROOF_EDGE_D, 0.0)
    cover = np.where(under_roof & (horiz_to_roof > 6.0), "covered", np.where(under_roof, "partial", "open"))
    # porte-à-faux du Kop : le niveau haut recouvre le niveau bas sur ~8 m
    ov_edge_d = profiles[("S", "U")][0][0]
    ov_y = profiles[("S", "U")][0][1] - SLAB_THICKNESS
    is_s_low = np.array([s["stand"] == "S" and s["tier"] == "L" for s in seats])
    under_ov = is_s_low & (d > ov_edge_d)
    ov_clear = np.degrees(np.arctan2(np.maximum(ov_y - eye, 0.1), np.maximum(d - ov_edge_d, 0.001)))
    clearance = np.where(under_ov, np.minimum(clearance, ov_clear), clearance)
    cover = np.where(under_ov, np.where((d - ov_edge_d) > 3.0, "covered", "partial"), cover)

    # C-value par rangée (dégagement au-dessus de la tête du rang devant)
    c_val = np.zeros(n)
    prof_by_tier = {k: np.array(v) for k, v in profiles.items()}
    for i, s in enumerate(seats):
        prof = prof_by_tier[(s["stand"], s["tier"])]
        r = s["row"] - 1
        if r == 0:
            c_val[i] = 9.99
            continue
        d_r, y_r = prof[r]
        d_p, y_p = prof[r - 1]
        line_y = (y_r + EYE_HEIGHT) * d_p / d_r
        c_val[i] = line_y - (y_p + EYE_HEIGHT)

    # score de vue (0-100), explicable : proximité, hauteur d'observation, centralité
    prox = np.clip(1.0 - (dist_edge - 8.0) / 70.0, 0.0, 1.0)
    angle = np.clip(1.0 - np.abs(elev - 24.0) / 30.0, 0.0, 1.0)
    # centralité : écart angulaire par rapport à l'axe médian de la tribune
    lateral = np.where(
        np.array([s["stand"] in ("E", "W") for s in seats]),
        np.abs(z) / (HL + 40.0),
        np.abs(x) / (HW + 40.0),
    )
    central = np.clip(1.0 - lateral, 0.0, 1.0)
    clear_pen = np.where(c_val < 0.05, 0.15, 0.0)
    score = 100.0 * np.clip(0.45 * prox + 0.30 * angle + 0.25 * central - clear_pen, 0.0, 1.0)

    for i, s in enumerate(seats):
        s["dist_center"] = round(float(dist_center[i]), 2)
        s["dist_edge"] = round(float(dist_edge[i]), 2)
        s["elevation_deg"] = round(float(elev[i]), 2)
        s["clearance_deg"] = round(float(min(clearance[i], 90.0)), 1)
        s["cover"] = str(cover[i])
        s["c_value"] = round(float(c_val[i]), 3)
        s["obstructed"] = bool(c_val[i] < 0.05)
        s["view_score"] = round(float(score[i]), 1)
        s["x"] = round(s["x"], 3)
        s["y"] = round(s["y"], 3)
        s["z"] = round(s["z"], 3)
        s["ry"] = round(s["ry"], 4)

    # accessibilité (PMR) : emplacements en bord d'allée de la 1re rangée des niveaux bas
    first_by_section: dict[str, list[dict]] = {}
    for s in seats:
        s["accessible"] = False
        if s["tier"] == "L" and s["row"] == 1:
            first_by_section.setdefault(s["section"], []).append(s)
    for lst in first_by_section.values():
        lst.sort(key=lambda s: s["number"])
        for s in lst[:3] + lst[-3:]:
            s["accessible"] = True

    # recomptage par section
    counts: dict[str, int] = {}
    for s in seats:
        counts[s["section"]] = counts.get(s["section"], 0) + 1
    for sec in sections:
        sec["seat_count"] = counts.get(sec["code"], 0)
    sections[:] = [sec for sec in sections if sec["seat_count"] > 0]

    # numérotation stable : tri par (section, rangée, numéro)
    seats.sort(key=lambda s: (s["section"], s["row"], s["number"]))
    for s in seats:
        s["code"] = f"{s['section']}-R{s['row']:02d}-N{s['number']:03d}"


if __name__ == "__main__":  # petit contrôle manuel
    data = generate()
    per_stand: dict[str, int] = {}
    for s in data["seats"]:
        per_stand[s["stand"]] = per_stand.get(s["stand"], 0) + 1
    print("total", len(data["seats"]), per_stand, "sections", len(data["sections"]))
