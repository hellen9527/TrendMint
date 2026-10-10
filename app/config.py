"""Small environment configuration layer with safe development defaults."""
from __future__ import annotations
import os
from dataclasses import dataclass
from pathlib import Path
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent.parent
load_dotenv(ROOT / ".env")


def flag(key: str, default: bool = False) -> bool:
    return os.getenv(key, str(default)).strip().lower() in {"1", "true", "yes", "on"}


@dataclass(frozen=True)
class Settings:
    env: str = os.getenv("APP_ENV", "development")
    demo_mode: bool = flag("DEMO_MODE", True)
    secret_key: str = os.getenv("SECRET_KEY", "dev-only-local-placeholder-change-this-to-a-long-random-secret")
    admin_email: str = os.getenv("ADMIN_EMAIL", "owner@example.com").lower().strip()
    database_url: str = os.getenv("DATABASE_URL", "sqlite:///./data/trendmint.db")
    base_url: str = os.getenv("WEB_BASE_URL", "http://127.0.0.1:8000").rstrip("/")
    cookie_secure: bool = flag("COOKIE_SECURE", False)
    video_provider: str = os.getenv("VIDEO_PROVIDER", "demo").lower()
    fal_key: str = os.getenv("FAL_KEY", "")
    fal_model_id: str = os.getenv("FAL_MODEL_ID", "fal-ai/kling-video/v2.5-turbo/standard/image-to-video")
    video_cost_estimate: float = float(os.getenv("VIDEO_COST_ESTIMATE_USD", "0.50"))
    max_daily_budget: float = float(os.getenv("MAX_DAILY_VIDEO_BUDGET_USD", "15"))
    youtube_key: str = os.getenv("YOUTUBE_API_KEY", "")
    collection_interval_hours: int = int(os.getenv("COLLECTION_INTERVAL_HOURS", "24"))
    stripe_key: str = os.getenv("STRIPE_SECRET_KEY", "")
    stripe_webhook_secret: str = os.getenv("STRIPE_WEBHOOK_SECRET", "")
    root: Path = ROOT
    data_dir: Path = ROOT / "data"
    output_dir: Path = ROOT / "generated"
    retention_days: int = int(os.getenv("LOCAL_VIDEO_RETENTION_DAYS", "7"))

    @property
    def real_video_enabled(self) -> bool:
        return self.video_provider == "fal" and bool(self.fal_key)

    @property
    def stripe_enabled(self) -> bool:
        return bool(self.stripe_key and self.stripe_webhook_secret)


settings = Settings()
settings.data_dir.mkdir(parents=True, exist_ok=True)
settings.output_dir.mkdir(parents=True, exist_ok=True)


def validate_production() -> None:
    if settings.env == "production":
        errors = []
        if settings.demo_mode:
            errors.append("DEMO_MODE must be false in production")
        if settings.secret_key in {"dev-only-local-placeholder-change-this-to-a-long-random-secret", "change-this-to-a-random-64-character-string-before-going-public"} or len(settings.secret_key) < 32:
            errors.append("SECRET_KEY must be a random string >= 32 characters")
        if not settings.cookie_secure or not settings.base_url.startswith("https://"):
            errors.append("COOKIE_SECURE must be true and WEB_BASE_URL must be HTTPS")
        if settings.video_provider == "fal" and not settings.fal_key:
            errors.append("FAL_KEY is required when VIDEO_PROVIDER=fal")
        if settings.stripe_enabled and not settings.real_video_enabled:
            errors.append("Do not enable live Stripe payment for demo video mode")
        if settings.retention_days < 1:
            errors.append("LOCAL_VIDEO_RETENTION_DAYS must be positive")
        if not settings.admin_email or settings.admin_email == "owner@example.com":
            errors.append("Set ADMIN_EMAIL to your own address")
        if errors:
            raise RuntimeError("Invalid production configuration: " + "; ".join(errors))
