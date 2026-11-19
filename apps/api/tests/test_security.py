from fastapi.testclient import TestClient

from app.main import app
from app.security import limiter
from tests.conftest import free_seats, login


def test_csrf_required_on_mutations(fan, client, event_id):
    seat = free_seats(client, event_id, 1)
    bad = TestClient(app)
    bad.cookies.update(fan.cookies)  # cookie de session valide mais pas d'en-tête CSRF
    r = bad.post(f"/api/events/{event_id}/locks", json={"seat_ids": seat})
    assert r.status_code == 403


def test_auth_required_and_roles(fan, client, admin):
    assert client.get("/api/reservations").status_code == 401
    assert fan.get("/api/admin/stats").status_code == 403
    assert fan.get("/api/admin/users").status_code == 403
    assert admin.get("/api/admin/users").status_code == 200


def test_login_does_not_reveal_which_part_is_wrong(client):
    c = TestClient(app)
    t = c.get("/api/auth/csrf").json()["csrf_token"]
    h = {"X-CSRF-Token": t}
    a = c.post("/api/auth/login", json={"email": "nobody@example.com", "password": "Wrong#Pass123"}, headers=h)
    b = c.post("/api/auth/login", json={"email": "fan@stadium.demo", "password": "Wrong#Pass123"}, headers=h)
    assert a.status_code == b.status_code == 401 and a.json() == b.json()


def test_session_cookie_flags(client):
    c = TestClient(app)
    t = c.get("/api/auth/csrf").json()["csrf_token"]
    r = c.post("/api/auth/login", json={"email": "fan@stadium.demo", "password": "Fan#Stadium2026"}, headers={"X-CSRF-Token": t})
    raw = [h for h in r.headers.get_list("set-cookie") if h.startswith("stadium_session")][0].lower()
    assert "httponly" in raw and "samesite=lax" in raw


def test_weak_password_rejected_on_register(client):
    c = TestClient(app)
    t = c.get("/api/auth/csrf").json()["csrf_token"]
    r = c.post("/api/auth/register", json={"email": "weak@example.com", "password": "short", "full_name": "Weak User"}, headers={"X-CSRF-Token": t})
    assert r.status_code == 422


def test_account_lockout_after_repeated_failures(client):
    from app.db import SessionLocal
    from app.models import User
    from sqlalchemy import select
    c = TestClient(app)
    t = c.get("/api/auth/csrf").json()["csrf_token"]
    h = {"X-CSRF-Token": t}
    last = None
    for _ in range(6):
        last = c.post("/api/auth/login", json={"email": "manager@stadium.demo", "password": "Bad#Pass12345"}, headers=h)
    assert last.status_code == 429
    with SessionLocal() as db:  # nettoyage pour les autres tests
        u = db.scalar(select(User).where(User.email == "manager@stadium.demo"))
        u.locked_until, u.failed_logins = None, 0
        db.commit()


def test_rate_limit_triggers(client):
    from app import security
    security.settings.rate_limit_enabled = True
    try:
        c = TestClient(app)
        t = c.get("/api/auth/csrf").json()["csrf_token"]
        codes = [c.post("/api/auth/forgot-password", json={"email": "a@example.com"}, headers={"X-CSRF-Token": t}).status_code for _ in range(7)]
        assert 429 in codes
    finally:
        security.settings.rate_limit_enabled = False
        limiter.reset()


def test_upload_rejects_fake_glb_and_accepts_real(manager):
    fake = manager.post("/api/admin/venues/prince-moulay-abdellah/assets", files={"file": ("x.glb", b"<html>evil</html>", "model/gltf-binary")},
                        data={"kind": "shell_glb"})
    assert fake.status_code == 415
    glb = b"glTF" + (2).to_bytes(4, "little") + (12).to_bytes(4, "little")
    ok = manager.post("/api/admin/venues/prince-moulay-abdellah/assets", files={"file": ("m.glb", glb, "application/octet-stream")},
                      data={"kind": "shell_glb", "source": "original"})
    assert ok.status_code == 201


def test_production_refuses_default_secrets():
    import pytest
    from app.config import Settings
    with pytest.raises(RuntimeError):
        Settings(env="production").assert_safe_for_production()


def test_sql_injection_attempt_is_harmless(client):
    r = client.get("/api/venues/x'; DROP TABLE users;--")
    assert r.status_code == 404
    assert client.get("/api/venues/prince-moulay-abdellah").status_code == 200
