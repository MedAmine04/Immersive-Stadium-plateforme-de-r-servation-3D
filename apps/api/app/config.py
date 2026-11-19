from __future__ import annotations

from functools import lru_cache

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

INSECURE_SECRETS = {"", "change-me", "changeme", "dev-secret-change-me", "secret"}


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    env: str = "development"  # development | test | production
    database_url: str = "postgresql+psycopg://stadium:stadium@localhost:5432/stadium"
    secret_key: str = "dev-secret-change-me"
    access_token_minutes: int = 60 * 8
    cookie_secure: bool = False
    cookie_samesite: str = "lax"
    allowed_origins: str = "http://localhost:3000"

    # Réservation
    lock_minutes: int = 10
    max_seats_per_reservation: int = 8
    max_seats_per_user_event: int = 8
    sweeper_interval_seconds: int = 30

    # Limitation de débit (désactivable pour les tests)
    rate_limit_enabled: bool = True

    # Téléversement des modèles 3D
    upload_dir: str = "./uploads"
    max_upload_mb: int = 60

    # Comptes initiaux
    seed_on_startup: bool = True
    seed_demo_users: bool = True
    admin_email: str = "admin@stadium.demo"
    admin_password: str = "Admin#Stadium2026"
    manager_email: str = "manager@stadium.demo"
    manager_password: str = "Manager#Stadium2026"
    demo_user_email: str = "fan@stadium.demo"
    demo_user_password: str = "Fan#Stadium2026"

    @field_validator("env")
    @classmethod
    def _env(cls, v: str) -> str:
        return v.lower()

    @property
    def is_production(self) -> bool:
        return self.env == "production"

    @property
    def origins(self) -> list[str]:
        return [o.strip() for o in self.allowed_origins.split(",") if o.strip()]

    def assert_safe_for_production(self) -> None:
        """Refuse de démarrer en production avec des secrets ou comptes par défaut."""
        if not self.is_production:
            return
        problems = []
        if self.secret_key in INSECURE_SECRETS or len(self.secret_key) < 32:
            problems.append("SECRET_KEY doit être défini (32 caractères minimum)")
        if not self.cookie_secure:
            problems.append("COOKIE_SECURE doit valoir true en production (HTTPS)")
        if self.seed_demo_users:
            problems.append("SEED_DEMO_USERS doit valoir false en production")
        if self.admin_password == "Admin#Stadium2026":
            problems.append("ADMIN_PASSWORD doit être défini (mot de passe par défaut interdit)")
        if "stadium:stadium@" in self.database_url:
            problems.append("DATABASE_URL utilise les identifiants par défaut")
        if problems:
            raise RuntimeError("Configuration de production dangereuse : " + " ; ".join(problems))


@lru_cache
def get_settings() -> Settings:
    return Settings()
