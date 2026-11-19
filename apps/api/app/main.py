from __future__ import annotations

import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import text

from .config import get_settings
from .db import Base, SessionLocal, engine
from .routers import admin, auth, events, reservations, venues
from .security import csrf_protect
from .services import booking

settings = get_settings()
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
log = logging.getLogger("app")


async def _sweeper() -> None:
    while True:
        await asyncio.sleep(settings.sweeper_interval_seconds)
        try:
            def run() -> int:
                with SessionLocal() as db:
                    return booking.sweep_expired(db)
            n = await asyncio.to_thread(run)
            if n:
                log.info("Verrous expirés libérés : %d", n)
        except Exception:  # le balayeur ne doit jamais s'arrêter
            log.exception("Erreur du balayeur d'expiration")


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings.assert_safe_for_production()
    Base.metadata.create_all(engine)
    if settings.seed_on_startup:
        from .seed import run_seed
        await asyncio.to_thread(run_seed)
    task = asyncio.create_task(_sweeper())
    yield
    task.cancel()


app = FastAPI(
    title="Immersive Stadium Booking Platform API",
    version="1.0.0",
    lifespan=lifespan,
    docs_url=None if settings.is_production else "/api/docs",
    redoc_url=None,
    openapi_url=None if settings.is_production else "/api/openapi.json",
    dependencies=[Depends(csrf_protect)],
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "DELETE"],
    allow_headers=["Content-Type", "X-CSRF-Token", "Idempotency-Key"],
)


@app.middleware("http")
async def security_headers(request: Request, call_next):
    resp = await call_next(request)
    resp.headers.setdefault("X-Content-Type-Options", "nosniff")
    resp.headers.setdefault("X-Frame-Options", "DENY")
    resp.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
    if request.url.path.startswith("/api/") and "cache-control" not in resp.headers:
        resp.headers["Cache-Control"] = "no-store"
    return resp


@app.exception_handler(Exception)
async def unhandled(request: Request, exc: Exception):
    log.exception("Erreur non gérée sur %s %s", request.method, request.url.path)
    return JSONResponse({"detail": "Erreur interne du serveur"}, status_code=500)


@app.get("/api/health", tags=["system"])
def health():
    with engine.connect() as conn:
        conn.execute(text("select 1"))
    return {"status": "ok"}


for r in (auth.router, venues.router, events.router, reservations.router, admin.router):
    app.include_router(r)
