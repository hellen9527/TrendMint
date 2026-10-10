"""TrendMint app: public site + authenticated API + collector + video jobs + billing."""
from __future__ import annotations
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
import hmac
import logging
import re
import secrets
import uuid
from urllib.parse import urlparse
from typing import Literal
from fastapi import Depends, FastAPI, File, Form, HTTPException, Request, Response, UploadFile
from fastapi.responses import FileResponse, HTMLResponse, RedirectResponse, PlainTextResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from sqlalchemy import select, func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from app.config import settings, validate_production
from app.db import create_tables, get_db
from app.auth import check_password, hash_password, get_current_user, set_login, clear_login, require_admin
from app.models import User, Template, Job, Order, Subscription, CreditEntry, Trend, VideoEvidence, CollectionRun, Discovery, MetricEvent, RevenueEvent, now
from app.wallet import adjust_credits, InsufficientCredits
from app.video import normalize_image, MAX_IMAGE_BYTES
from app.trends import score_trend, valid_source_url, collect_youtube, build_daily_report
from app.payments import PACKS, create_checkout, verify_signature, process_stripe_event, create_portal
from app.seed import seed

log = logging.getLogger("trendmint.api")

@asynccontextmanager
async def lifespan(_app: FastAPI):
    validate_production()
    create_tables()
    from app.db import SessionLocal
    with SessionLocal() as db:
        seed(db)
    yield

app = FastAPI(title="TrendMint", version="1.0.0", lifespan=lifespan)
app.mount("/static", StaticFiles(directory=settings.root / "static"), name="static")

@app.middleware("http")
async def security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
    # Styles are bundled locally. No inline scripts or arbitrary third-party JavaScript.
    response.headers["Content-Security-Policy"] = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; media-src 'self' https: blob:; connect-src 'self'; font-src 'self' data:; object-src 'none'; frame-ancestors 'none'; base-uri 'self'"
    return response

class AuthIn(BaseModel):
    email: str = Field(min_length=5, max_length=254)
    password: str = Field(min_length=8, max_length=128)

class TrendIn(BaseModel):
    title: str = Field(min_length=3, max_length=160)
    keyword: str = Field(min_length=3, max_length=160)
    source_url: str = Field(default="", max_length=1000)
    category: str = Field(default="AI Video", max_length=60)
    notes: str = Field(default="", max_length=1000)

class ReviewIn(BaseModel):
    demand: int = Field(ge=1, le=5)
    willingness: int = Field(ge=1, le=5)
    opportunity: int = Field(ge=1, le=5)
    feasibility: int = Field(ge=1, le=5)
    compliance: int = Field(ge=1, le=5)
    stage: Literal["待验证", "测试中", "已上线", "暂缓"] = "待验证"
    notes: str = Field(default="", max_length=1000)

class TemplateCreateIn(BaseModel):
    slug: str = Field(min_length=3, max_length=70, pattern=r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
    title: str = Field(min_length=2, max_length=100)
    title_en: str = Field(min_length=3, max_length=120)
    description: str = Field(min_length=6, max_length=600)
    description_en: str = Field(min_length=6, max_length=600)
    prompt: str = Field(min_length=30, max_length=2500)
    emoji: str = Field(default="✨", min_length=1, max_length=8)
    tag: str = Field(default="新模板", min_length=1, max_length=30)
    credits: int = Field(default=6, ge=1, le=100)

class TemplateUpdateIn(BaseModel):
    active: bool | None = None
    prompt: str | None = Field(default=None, min_length=30, max_length=2500)
    credits: int | None = Field(default=None, ge=1, le=100)

class CheckoutIn(BaseModel):
    product_id: str

class EventIn(BaseModel):
    event: Literal["page_view", "template_view", "pricing_view", "generate_click", "checkout_click"]
    source: str = Field(default="direct", max_length=70)


def auth_user(request: Request, db: Session = Depends(get_db)) -> User:
    return get_current_user(request, db)

def admin_user(request: Request, db: Session = Depends(get_db)) -> User:
    user = get_current_user(request, db)
    require_admin(user)
    return user

def csrf(request: Request) -> None:
    cookie = request.cookies.get("tm_csrf", "")
    header = request.headers.get("X-CSRF-Token", "")
    if not cookie or not header or not hmac.compare_digest(cookie, header):
        raise HTTPException(403, "安全校验失败，请刷新页面重新登录")


def as_iso(value):
    return value.isoformat() if value else None

def serialize_user(user: User):
    return {"id": user.id, "email": user.email, "credits": user.credits, "is_admin": user.is_admin, "created_at": as_iso(user.created_at)}

def serialize_template(t: Template):
    return {"id": t.id, "slug": t.slug, "title": t.title, "title_en": t.title_en, "description": t.description,
            "description_en": t.description_en, "emoji": t.emoji, "tag": t.tag, "credits": t.credits}

def serialize_job(j: Job, template_name: str = ""):
    return {"id": j.id, "template_id": j.template_id, "template_name": template_name,
            "status": j.status, "provider": j.provider, "credits": j.cost_credits,
            "estimated_cost_usd": j.estimated_cost_usd, "error": j.error,
            "created_at": as_iso(j.created_at), "completed_at": as_iso(j.completed_at),
            "download_url": "/api/jobs/" + j.id + "/download"
            if (j.status == "completed" and (j.output_path or j.output_url)
                and (not j.completed_at or j.completed_at.replace(tzinfo=timezone.utc) >= now() - timedelta(days=max(1, settings.retention_days)))) else None}

def serialize_trend(t: Trend):
    return {"id": t.id, "title": t.title, "keyword": t.keyword, "source": t.source,
            "source_url": t.source_url, "category": t.category, "stage": t.stage,
            "is_sample": t.is_sample, "sample_count": t.sample_count, "sample_views": t.sample_views,
            "delta_views": t.delta_views, "growth_pct": t.growth_pct, "demand": t.demand,
            "willingness": t.willingness, "opportunity": t.opportunity, "feasibility": t.feasibility,
            "compliance": t.compliance, "score": t.score, "notes": t.notes, "measured_at": as_iso(t.measured_at)}

def set_csrf(response: Response):
    response.set_cookie("tm_csrf", secrets.token_urlsafe(24), httponly=False,
                        secure=settings.cookie_secure, samesite="lax", max_age=43200, path="/")

def validate_email(email: str) -> str:
    email = email.strip().lower()
    if not re.fullmatch(r"[^@\s]{1,64}@[^@\s]+\.[^@\s]{2,}", email):
        raise HTTPException(422, "请输入有效邮箱")
    return email

@app.get("/api/health")
def health():
    return {"status": "ok", "mode": "demo" if settings.video_provider == "demo" else "live",
            "env": settings.env, "youtube_configured": bool(settings.youtube_key),
            "payments_configured": settings.stripe_enabled, "real_video_configured": settings.real_video_enabled}

@app.get("/api/public/templates")
def templates(db: Session = Depends(get_db)):
    return [serialize_template(t) for t in db.scalars(select(Template).where(Template.active == True).order_by(Template.id)).all()]

@app.get("/api/public/templates/{slug}")
def template_detail(slug: str, db: Session = Depends(get_db)):
    template = db.scalar(select(Template).where(Template.slug == slug, Template.active == True))
    if not template:
        raise HTTPException(404, "模板不存在")
    return serialize_template(template)

@app.get("/api/admin/templates")
def admin_templates(_admin: User = Depends(admin_user), db: Session = Depends(get_db)):
    items = db.scalars(select(Template).order_by(Template.id)).all()
    return [{**serialize_template(x), "prompt": x.prompt, "active": x.active} for x in items]

@app.post("/api/admin/templates", dependencies=[Depends(csrf)])
def admin_create_template(body: TemplateCreateIn, _admin: User = Depends(admin_user), db: Session = Depends(get_db)):
    if db.scalar(select(Template.id).where(Template.slug == body.slug)):
        raise HTTPException(409, "该英文 URL 标识已经存在")
    template = Template(**body.model_dump(), active=True)
    db.add(template)
    db.commit()
    return {**serialize_template(template), "active": template.active}

@app.patch("/api/admin/templates/{template_id}", dependencies=[Depends(csrf)])
def admin_update_template(template_id: int, body: TemplateUpdateIn, _admin: User = Depends(admin_user), db: Session = Depends(get_db)):
    template = db.get(Template, template_id)
    if not template:
        raise HTTPException(404, "模板不存在")
    for field, value in body.model_dump(exclude_none=True).items():
        setattr(template, field, value)
    db.commit()
    return {**serialize_template(template), "active": template.active}

@app.get("/api/public/plans")
def plans():
    return {"payment_enabled": settings.stripe_enabled, "demo_mode": settings.demo_mode,
            "items": [{"id": key, **item} for key,item in PACKS.items()]}

@app.post("/api/auth/register")
def register(body: AuthIn, response: Response, db: Session = Depends(get_db)):
    email = validate_email(body.email)
    if db.scalar(select(User.id).where(User.email == email)):
        raise HTTPException(409, "邮箱已注册")
    initial = 12 if settings.demo_mode else 0
    user = User(email=email, password_hash=hash_password(body.password), credits=0, is_admin=False)
    db.add(user)
    db.flush()
    if initial:
        adjust_credits(db, user.id, initial, "演示注册体验金", f"welcome:{user.id}")
    db.commit()
    set_login(response, user)
    set_csrf(response)
    return serialize_user(user)

@app.post("/api/auth/login")
def login(body: AuthIn, response: Response, db: Session = Depends(get_db)):
    email = validate_email(body.email)
    user = db.scalar(select(User).where(User.email == email))
    if not user or not check_password(user.password_hash, body.password):
        raise HTTPException(401, "邮箱或密码不正确")
    set_login(response, user)
    set_csrf(response)
    return serialize_user(user)

@app.post("/api/auth/demo")
def demo_auth(response: Response, db: Session = Depends(get_db)):
    if not settings.demo_mode:
        raise HTTPException(404, "未启用演示模式")
    user = db.scalar(select(User).where(User.email == "demo@trendmint.local"))
    if not user:
        raise HTTPException(503, "演示账号尚未初始化")
    set_login(response, user)
    set_csrf(response)
    return serialize_user(user)

@app.get("/api/auth/me")
def me(user: User = Depends(auth_user)):
    return serialize_user(user)

@app.post("/api/auth/logout", dependencies=[Depends(csrf)])
def logout(response: Response):
    clear_login(response)
    response.delete_cookie("tm_csrf", path="/")
    return {"ok": True}

@app.post("/api/events")
def log_event(body: EventIn, request: Request, db: Session = Depends(get_db)):
    # Anonymous metrics are untrusted; do not record emails, IPs or unbounded input.
    try:
        user = get_current_user(request, db)
    except HTTPException:
        user = None
    db.add(MetricEvent(event=body.event, source=body.source[:70], user_id=user.id if user else None))
    db.commit()
    return {"ok": True}

@app.get("/api/wallet")
def wallet(user: User = Depends(auth_user), db: Session = Depends(get_db)):
    entries = db.scalars(select(CreditEntry).where(CreditEntry.user_id == user.id).order_by(CreditEntry.id.desc()).limit(25)).all()
    orders = db.scalars(select(Order).where(Order.user_id == user.id).order_by(Order.created_at.desc()).limit(10)).all()
    subs = db.scalars(select(Subscription).where(Subscription.user_id == user.id).order_by(Subscription.created_at.desc()).limit(5)).all()
    return {"balance": db.get(User, user.id).credits,
            "ledger": [{"id": x.id, "delta": x.delta, "balance": x.balance_after, "reason": x.reason,
                         "created_at": as_iso(x.created_at)} for x in entries],
            "orders": [{"id": x.id, "product_id": x.product_id, "amount_usd": x.amount_cents/100,
                        "status": x.status, "kind": x.kind, "created_at": as_iso(x.created_at)} for x in orders],
            "subscriptions": [{"plan_id": x.plan_id, "status": x.status} for x in subs]}

@app.post("/api/jobs", dependencies=[Depends(csrf)])
async def create_job(template_id: int = Form(...), image: UploadFile = File(...),
                     agree_rights: bool = Form(False), custom_prompt: str = Form(""),
                     user: User = Depends(auth_user), db: Session = Depends(get_db)):
    if not agree_rights:
        raise HTTPException(422, "请确认你拥有上传图片的使用权限")
    if len(custom_prompt) > 300:
        raise HTTPException(422, "附加描述不能超过 300 字")
    template = db.get(Template, template_id)
    if not template or not template.active:
        raise HTTPException(404, "模板不存在")
    if settings.video_provider not in {"demo", "fal"} or (settings.video_provider == "fal" and not settings.real_video_enabled):
        raise HTTPException(503, "视频服务尚未配置完成")
    recent = now() - timedelta(days=1)
    daily_user = db.scalar(select(func.count()).select_from(Job).where(Job.user_id == user.id, Job.created_at >= recent)) or 0
    if daily_user >= 25:
        raise HTTPException(429, "今日生成次数已达上限")
    if settings.video_provider == "fal":
        today = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
        spent = db.scalar(select(func.coalesce(func.sum(Job.estimated_cost_usd), 0)).where(
            Job.provider == "fal", Job.created_at >= today)) or 0
        if float(spent) + settings.video_cost_estimate > settings.max_daily_budget:
            raise HTTPException(429, "今日 API 成本预算已用完")
    data = await image.read(MAX_IMAGE_BYTES+1)
    if len(data) > MAX_IMAGE_BYTES:
        raise HTTPException(413, "图片不能超过 4MB")
    job_id = str(uuid.uuid4())
    path = settings.data_dir / (job_id + ".jpg")
    try:
        normalize_image(data, path)
    except ValueError as exc:
        raise HTTPException(422, str(exc))
    job = Job(id=job_id, user_id=user.id, template_id=template.id, status="queued", input_path=str(path),
              cost_credits=template.credits, custom_prompt=custom_prompt.strip(),
              provider=settings.video_provider,
              estimated_cost_usd=0 if settings.video_provider == "demo" else settings.video_cost_estimate)
    try:
        adjust_credits(db, user.id, -template.credits, "预扣生成积分", f"job:{job_id}:reserve")
        db.add(job)
        db.commit()
    except InsufficientCredits as exc:
        db.rollback()
        path.unlink(missing_ok=True)
        raise HTTPException(402, str(exc))
    except Exception:
        db.rollback()
        path.unlink(missing_ok=True)
        raise
    return serialize_job(job, template.title)

@app.get("/api/jobs")
def jobs(user: User = Depends(auth_user), db: Session = Depends(get_db)):
    rows = db.execute(select(Job, Template.title).join(Template, Job.template_id == Template.id)
                      .where(Job.user_id == user.id).order_by(Job.created_at.desc()).limit(40)).all()
    return [serialize_job(j, title) for j,title in rows]

@app.get("/api/jobs/{job_id}")
def job_detail(job_id: str, user: User = Depends(auth_user), db: Session = Depends(get_db)):
    job = db.get(Job, job_id)
    if not job or job.user_id != user.id:
        raise HTTPException(404, "任务不存在")
    template = db.get(Template, job.template_id)
    return serialize_job(job, template.title if template else "")

@app.get("/api/jobs/{job_id}/download")
def job_download(job_id: str, user: User = Depends(auth_user), db: Session = Depends(get_db)):
    job = db.get(Job, job_id)
    if not job or job.user_id != user.id or job.status != "completed":
        raise HTTPException(404, "视频尚未完成或无权限")
    if job.completed_at and job.completed_at.replace(tzinfo=timezone.utc) < now() - timedelta(days=max(1, settings.retention_days)):
        raise HTTPException(410, "视频已过保留期限，请重新生成")
    if job.output_path and Path(job.output_path).is_file():
        return FileResponse(job.output_path, media_type="video/mp4", filename=f"trendmint-{job.id[:8]}.mp4")
    if job.output_url and job.output_url.startswith("https://"):
        return RedirectResponse(job.output_url, status_code=302)
    raise HTTPException(404, "视频文件已过期")

@app.post("/api/billing/checkout", dependencies=[Depends(csrf)])
def checkout(body: CheckoutIn, user: User = Depends(auth_user), db: Session = Depends(get_db)):
    return {"checkout_url": create_checkout(db, user, body.product_id)}

@app.post("/api/billing/portal", dependencies=[Depends(csrf)])
def billing_portal(user: User = Depends(auth_user)):
    return {"portal_url": create_portal(user)}

@app.post("/api/billing/demo-topup", dependencies=[Depends(csrf)])
def demo_topup(user: User = Depends(auth_user), db: Session = Depends(get_db)):
    if not settings.demo_mode:
        raise HTTPException(404, "演示充值在真实环境禁用")
    stamp = uuid.uuid4().hex
    adjust_credits(db, user.id, 20, "演示积分（非支付）", f"demo-topup:{stamp}")
    db.commit()
    return {"balance": db.get(User, user.id).credits, "demo_only": True}

@app.post("/api/billing/stripe-webhook")
async def stripe_webhook(request: Request, db: Session = Depends(get_db)):
    if not settings.stripe_webhook_secret:
        raise HTTPException(503, "未启用 Stripe Webhook")
    body = await request.body()
    event = verify_signature(body, request.headers.get("stripe-signature", ""), settings.stripe_webhook_secret)
    try:
        status = process_stripe_event(db, event)
        return {"ok": True, "status": status}
    except Exception:
        db.rollback()
        log.exception("Stripe event processing failed")
        raise HTTPException(500, "Webhook 处理失败，Stripe 可以安全重试")

@app.get("/api/admin/trends")
def trends(_admin: User = Depends(admin_user), db: Session = Depends(get_db)):
    rows = db.scalars(select(Trend).order_by(Trend.score.desc(), Trend.id.desc()).limit(100)).all()
    return [serialize_trend(x) for x in rows]

@app.post("/api/admin/trends", dependencies=[Depends(csrf)])
def add_trend(body: TrendIn, _admin: User = Depends(admin_user), db: Session = Depends(get_db)):
    if not valid_source_url(body.source_url):
        raise HTTPException(422, "线索链接需要是 HTTPS 地址")
    if db.scalar(select(Trend.id).where(Trend.keyword == body.keyword.strip())):
        raise HTTPException(409, "已经跟踪该关键词")
    entry = Trend(title=body.title.strip(), keyword=body.keyword.strip(), category=body.category.strip(),
                  source="manual", source_url=body.source_url, notes=body.notes.strip())
    entry.score = score_trend(entry)
    db.add(entry)
    db.commit()
    return serialize_trend(entry)

@app.patch("/api/admin/trends/{trend_id}", dependencies=[Depends(csrf)])
def review_trend(trend_id: int, body: ReviewIn, _admin: User = Depends(admin_user), db: Session = Depends(get_db)):
    entry = db.get(Trend, trend_id)
    if not entry:
        raise HTTPException(404, "线索不存在")
    for field in ["demand", "willingness", "opportunity", "feasibility", "compliance", "stage", "notes"]:
        setattr(entry, field, getattr(body, field))
    entry.score = score_trend(entry)
    db.commit()
    return serialize_trend(entry)

@app.get("/api/admin/trends/{trend_id}/evidence")
def evidence(trend_id: int, _admin: User = Depends(admin_user), db: Session = Depends(get_db)):
    result = db.scalars(select(VideoEvidence).where(VideoEvidence.trend_id == trend_id)
                        .order_by(VideoEvidence.views.desc()).limit(25)).all()
    return [{"title": v.title, "platform": v.platform, "url": v.url,
             "views": v.views, "prev_views": v.prev_views, "observed_at": as_iso(v.observed_at)} for v in result]

@app.get("/api/admin/discoveries")
def discoveries(_admin: User = Depends(admin_user), db: Session = Depends(get_db)):
    results = db.scalars(select(Discovery).order_by(Discovery.observed_at.desc()).limit(80)).all()
    return [{"id": x.id, "title": x.title, "url": x.url, "views": x.views,
             "velocity_per_hour": x.velocity_per_hour, "video_age_hours": x.video_age_hours,
             "promoted": x.promoted, "observed_at": as_iso(x.observed_at)} for x in results]

@app.post("/api/admin/discoveries/{discovery_id}/promote", dependencies=[Depends(csrf)])
def promote(discovery_id: int, _admin: User = Depends(admin_user), db: Session = Depends(get_db)):
    discovery = db.get(Discovery, discovery_id)
    if not discovery:
        raise HTTPException(404, "视频线索不存在")
    if discovery.promoted:
        raise HTTPException(409, "该线索已经添加")
    keyword = discovery.title[:145]
    if db.scalar(select(Trend.id).where(Trend.keyword == keyword)):
        raise HTTPException(409, "已存在同名跟踪词")
    entry = Trend(title=discovery.title[:160], keyword=keyword, category="AI Video", source="youtube",
                  source_url=discovery.url, notes="来自 YouTube 自动发现，请人工确认是不是可模板化的 AI 玩法。")
    entry.score = score_trend(entry)
    db.add(entry)
    discovery.promoted = True
    db.commit()
    return serialize_trend(entry)

@app.post("/api/admin/collect", dependencies=[Depends(csrf)])
def collect(_admin: User = Depends(admin_user), db: Session = Depends(get_db)):
    if not settings.youtube_key:
        raise HTTPException(503, "请在 .env 配置 YOUTUBE_API_KEY 后再采集")
    try:
        return collect_youtube(db)
    except Exception as exc:
        log.exception("Collection failed")
        raise HTTPException(502, "采集失败："+str(exc)[:150])

@app.get("/api/admin/report")
def report(_admin: User = Depends(admin_user), db: Session = Depends(get_db)):
    # Browser download; no private data in public static directories.
    return PlainTextResponse(
        build_daily_report(db),
        media_type="text/markdown; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="trendmint-report-{now().date().isoformat()}.md"'},
    )

@app.get("/api/admin/overview")
def overview(_admin: User = Depends(admin_user), db: Session = Depends(get_db)):
    total_users = db.scalar(select(func.count()).select_from(User)) or 0
    total_jobs = db.scalar(select(func.count()).select_from(Job)) or 0
    completed = db.scalar(select(func.count()).select_from(Job).where(Job.status == "completed")) or 0
    active = db.scalar(select(func.count()).select_from(Job).where(Job.status.in_(["queued", "processing"]))) or 0
    revenue_cents = db.scalar(select(func.coalesce(func.sum(RevenueEvent.cents), 0))) or 0
    model_estimate = db.scalar(select(func.coalesce(func.sum(Job.estimated_cost_usd), 0)).where(
        Job.provider == "fal", Job.status != "queued")) or 0
    views = db.scalar(select(func.count()).select_from(MetricEvent).where(MetricEvent.event == "page_view")) or 0
    last = db.scalar(select(CollectionRun).order_by(CollectionRun.started_at.desc()).limit(1))
    trends_count = db.scalar(select(func.count()).select_from(Trend)) or 0
    return {"users": total_users, "jobs": total_jobs, "completed": completed,
            "active_jobs": active, "revenue_usd": round(revenue_cents/100, 2),
            "cost_estimate_usd": round(float(model_estimate), 2),
            "contribution_estimate_usd": round(revenue_cents/100 - float(model_estimate), 2),
            "page_views": views, "trends_count": trends_count,
            "last_collection": {"status": last.status, "detail": last.detail, "time": as_iso(last.started_at)} if last else None,
            "disclaimer": "收入来自已验证支付事件，模型成本为估值，尚未扣除支付手续费、退款、税费及固定成本。"}

@app.get("/robots.txt")
def robots():
    return PlainTextResponse("User-agent: *\nAllow: /t/\nDisallow: /api/\nDisallow: /dashboard\nDisallow: /admin\nSitemap: "+settings.base_url+"/sitemap.xml\n")

@app.get("/sitemap.xml")
def sitemap(db: Session = Depends(get_db)):
    slugs = db.scalars(select(Template.slug).where(Template.active == True)).all()
    import html
    urls = [settings.base_url+"/", *[settings.base_url+"/t/"+slug for slug in slugs]]
    body = '<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' + "".join("<url><loc>"+html.escape(url)+"</loc></url>" for url in urls) + "</urlset>"
    return Response(body, media_type="application/xml")

@app.get("/{path:path}", response_class=HTMLResponse, include_in_schema=False)
def spa(path: str, db: Session = Depends(get_db)):
    # SEO metadata for public, canonical per-template landing pages.
    import html
    title, description = "TrendMint — AI Video Trend Studio", "Turn your photos into playful AI videos. Explore templates and trends."
    canonical, robots = settings.base_url + "/", "noindex,nofollow"
    if not path:
        robots = "index,follow"
    elif path.startswith("t/"):
        slug = path[2:]
        template = db.scalar(select(Template).where(Template.slug == slug, Template.active == True))
        if template:
            title, description = template.title_en + " | TrendMint", template.description_en
            canonical = settings.base_url + "/t/" + slug
            robots = "index,follow"
    html_text = (settings.root / "static" / "index.html").read_text(encoding="utf-8")
    for key, value in {"TITLE": title, "DESCRIPTION": description, "CANONICAL": canonical, "ROBOTS": robots}.items():
        html_text = html_text.replace("%%PAGE_" + key + "%%", html.escape(value, quote=True))
    return HTMLResponse(html_text)
