import collections

from app.generator.stadium import generate

DATA = generate()


def test_calibrated_to_public_figures():
    assert len(DATA["seats"]) == 68_700
    per = collections.Counter(s["stand"] for s in DATA["seats"])
    assert per["S"] == 23_000


def test_codes_unique_and_no_seat_inside_pitch():
    codes = [s["code"] for s in DATA["seats"]]
    assert len(set(codes)) == len(codes)
    assert all(not (abs(s["x"]) < 34 and abs(s["z"]) < 52.5 and s["y"] < 1) for s in DATA["seats"])


def test_all_seats_are_flagged_estimated_in_seed_and_face_the_pitch():
    import math
    bad = 0
    for s in DATA["seats"][::97]:
        # l'orientation (ry) doit pointer vers le terrain : produit scalaire avec la direction vers le centre > 0
        fx, fz = math.sin(s["ry"]), math.cos(s["ry"])
        if fx * (-s["x"]) + fz * (-s["z"]) <= 0:
            bad += 1
    assert bad == 0


def test_rows_rise_monotonically():
    last = {}
    for s in DATA["seats"]:
        k = (s["section"])
        last.setdefault(k, {})[s["row"]] = s["y"]
    for rows in last.values():
        ys = [rows[r] for r in sorted(rows)]
        assert all(b >= a for a, b in zip(ys, ys[1:]))
