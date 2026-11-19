import os

os.environ.setdefault("DATABASE_URL", "postgresql+psycopg://stadium:stadium@localhost:5433/stadium_test")
os.environ["ENV"] = "test"
os.environ["RATE_LIMIT_ENABLED"] = "false"
os.environ["SWEEPER_INTERVAL_SECONDS"] = "3600"

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.security import limiter


@pytest.fixture(scope="session")
def client():
    with TestClient(app) as c:
        yield c


def login(client_cls_app, email, password):
    c = TestClient(client_cls_app)
    token = c.get("/api/auth/csrf").json()["csrf_token"]
    r = c.post("/api/auth/login", json={"email": email, "password": password}, headers={"X-CSRF-Token": token})
    assert r.status_code == 200, r.text
    c.headers["X-CSRF-Token"] = c.cookies.get("csrf_token")
    return c


@pytest.fixture()
def fan(client):
    return login(app, "fan@stadium.demo", "Fan#Stadium2026")


@pytest.fixture()
def manager(client):
    return login(app, "manager@stadium.demo", "Manager#Stadium2026")


@pytest.fixture()
def admin(client):
    return login(app, "admin@stadium.demo", "Admin#Stadium2026")


@pytest.fixture()
def event_id(client):
    return client.get("/api/events").json()[0]["id"]


@pytest.fixture(autouse=True)
def _reset(client):
    limiter.reset()
    from app.db import SessionLocal
    from sqlalchemy import text

    with SessionLocal() as db:
        db.execute(text("DELETE FROM reservation_items; DELETE FROM reservations; DELETE FROM audit_logs"))
        db.commit()
    yield


def free_seats(client, event_id, n=10, section="S-L-02"):
    av = client.get(f"/api/events/{event_id}/availability").json()
    taken = set(av["taken"]) | set(av["blocked_seats"])
    data = client.get(f"/api/venues/prince-moulay-abdellah/sections/{section}/seats").json()
    return [i for i in data["ids"] if i not in taken][:n]
