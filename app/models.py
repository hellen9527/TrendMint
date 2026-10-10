"""Database models: journal and webhook IDs are the source of truth, not the UI."""
from datetime import datetime, timezone
from sqlalchemy import String, Integer, Float, DateTime, Boolean, Text, ForeignKey, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column
from app.db import Base

def now():
    return datetime.now(timezone.utc)

class User(Base):
    __tablename__ = "users"
    id: Mapped[int] = mapped_column(primary_key=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(512))
    credits: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    is_admin: Mapped[bool] = mapped_column(Boolean, default=False)
    stripe_customer_id: Mapped[str | None] = mapped_column(String(120), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)

class Template(Base):
    __tablename__ = "templates"
    id: Mapped[int] = mapped_column(primary_key=True)
    slug: Mapped[str] = mapped_column(String(100), unique=True)
    title: Mapped[str] = mapped_column(String(100))
    title_en: Mapped[str] = mapped_column(String(120))
    description: Mapped[str] = mapped_column(Text)
    description_en: Mapped[str] = mapped_column(Text)
    prompt: Mapped[str] = mapped_column(Text)
    emoji: Mapped[str] = mapped_column(String(12))
    tag: Mapped[str] = mapped_column(String(30), default="精选")
    credits: Mapped[int] = mapped_column(Integer, default=6)
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)

class Job(Base):
    __tablename__ = "jobs"
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    template_id: Mapped[int] = mapped_column(ForeignKey("templates.id"))
    status: Mapped[str] = mapped_column(String(24), default="queued", index=True)
    input_path: Mapped[str] = mapped_column(Text)
    output_path: Mapped[str | None] = mapped_column(Text, nullable=True)
    output_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    custom_prompt: Mapped[str] = mapped_column(String(300), default="")
    cost_credits: Mapped[int] = mapped_column(Integer, nullable=False)
    estimated_cost_usd: Mapped[float] = mapped_column(Float, default=0)
    provider: Mapped[str] = mapped_column(String(30), default="demo")
    provider_request_id: Mapped[str | None] = mapped_column(String(100), nullable=True)
    error: Mapped[str | None] = mapped_column(String(300), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

class CreditEntry(Base):
    __tablename__ = "credit_entries"
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    delta: Mapped[int] = mapped_column(Integer)
    balance_after: Mapped[int] = mapped_column(Integer)
    reason: Mapped[str] = mapped_column(String(80))
    ref: Mapped[str] = mapped_column(String(160), unique=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)

class Order(Base):
    __tablename__ = "orders"
    id: Mapped[str] = mapped_column(String(40), primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    product_id: Mapped[str] = mapped_column(String(60))
    amount_cents: Mapped[int] = mapped_column(Integer)
    credits: Mapped[int] = mapped_column(Integer)
    kind: Mapped[str] = mapped_column(String(20), default="pack")
    status: Mapped[str] = mapped_column(String(24), default="pending")
    checkout_id: Mapped[str | None] = mapped_column(String(120), unique=True, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    paid_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

class Subscription(Base):
    __tablename__ = "subscriptions"
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    plan_id: Mapped[str] = mapped_column(String(40))
    stripe_id: Mapped[str] = mapped_column(String(120), unique=True, nullable=False)
    status: Mapped[str] = mapped_column(String(24), default="pending")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)

class StripeEvent(Base):
    __tablename__ = "stripe_events"
    id: Mapped[str] = mapped_column(String(150), primary_key=True)
    type: Mapped[str] = mapped_column(String(100))
    processed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)

class Trend(Base):
    __tablename__ = "trends"
    id: Mapped[int] = mapped_column(primary_key=True)
    title: Mapped[str] = mapped_column(String(160))
    keyword: Mapped[str] = mapped_column(String(160), unique=True)
    category: Mapped[str] = mapped_column(String(60), default="AI Video")
    source: Mapped[str] = mapped_column(String(40), default="manual")
    source_url: Mapped[str] = mapped_column(Text, default="")
    stage: Mapped[str] = mapped_column(String(24), default="待验证")
    is_sample: Mapped[bool] = mapped_column(Boolean, default=False)
    sample_count: Mapped[int] = mapped_column(Integer, default=0)
    sample_views: Mapped[int | None] = mapped_column(Integer, nullable=True)
    delta_views: Mapped[int | None] = mapped_column(Integer, nullable=True)
    growth_pct: Mapped[float | None] = mapped_column(Float, nullable=True)
    demand: Mapped[int] = mapped_column(Integer, default=3)
    willingness: Mapped[int] = mapped_column(Integer, default=3)
    opportunity: Mapped[int] = mapped_column(Integer, default=3)
    feasibility: Mapped[int] = mapped_column(Integer, default=3)
    compliance: Mapped[int] = mapped_column(Integer, default=3)
    score: Mapped[int] = mapped_column(Integer, default=0)
    notes: Mapped[str] = mapped_column(Text, default="")
    measured_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)

class VideoEvidence(Base):
    __tablename__ = "video_evidence"
    id: Mapped[int] = mapped_column(primary_key=True)
    trend_id: Mapped[int] = mapped_column(ForeignKey("trends.id"), index=True)
    platform: Mapped[str] = mapped_column(String(40))
    external_id: Mapped[str] = mapped_column(String(130))
    title: Mapped[str] = mapped_column(String(250))
    url: Mapped[str] = mapped_column(Text)
    views: Mapped[int | None] = mapped_column(Integer, nullable=True)
    prev_views: Mapped[int | None] = mapped_column(Integer, nullable=True)
    prev_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    observed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    __table_args__ = (UniqueConstraint("platform", "external_id", "trend_id", name="uq_evidence"),)

class CollectionRun(Base):
    __tablename__ = "collection_runs"
    id: Mapped[int] = mapped_column(primary_key=True)
    source: Mapped[str] = mapped_column(String(40))
    status: Mapped[str] = mapped_column(String(24), default="running")
    detail: Mapped[str] = mapped_column(Text, default="")
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

class MetricEvent(Base):
    __tablename__ = "metric_events"
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    event: Mapped[str] = mapped_column(String(50), index=True)
    source: Mapped[str] = mapped_column(String(70), default="direct")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)

class Discovery(Base):
    __tablename__ = "discoveries"
    id: Mapped[int] = mapped_column(primary_key=True)
    external_id: Mapped[str] = mapped_column(String(130), unique=True)
    title: Mapped[str] = mapped_column(String(250))
    url: Mapped[str] = mapped_column(Text)
    views: Mapped[int] = mapped_column(Integer, default=0)
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    observed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    velocity_per_hour: Mapped[float | None] = mapped_column(Float, nullable=True)
    video_age_hours: Mapped[float | None] = mapped_column(Float, nullable=True)
    promoted: Mapped[bool] = mapped_column(Boolean, default=False)

class RevenueEvent(Base):
    __tablename__ = "revenue_events"
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    cents: Mapped[int] = mapped_column(Integer)
    kind: Mapped[str] = mapped_column(String(24))
    ref: Mapped[str] = mapped_column(String(160), unique=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
