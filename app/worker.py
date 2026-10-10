"""Database-backed single-claim job worker, and periodic YouTube collection."""
from __future__ import annotations
import logging
import time
from datetime import timedelta, timezone
from pathlib import Path
from sqlalchemy import select, update, func
from app.db import SessionLocal, create_tables
from app.config import settings
from app.models import Job, CollectionRun, now
from app.wallet import adjust_credits
from app.video import render_demo_video, fal_generate_video
from app.trends import collect_youtube

logger = logging.getLogger("trendmint.worker")


def mark_failed(db, job: Job, explanation: str):
    job.status = "failed"
    job.completed_at = now()
    job.error = explanation[:300]
    adjust_credits(db, job.user_id, job.cost_credits, "生成失败，返还积分", f"job:{job.id}:refund")
    db.commit()
    Path(job.input_path).unlink(missing_ok=True)


def process_one() -> bool:
    with SessionLocal() as db:
        # Atomic claim protects against two workers processing the same queued job.
        job_id = db.scalar(select(Job.id).where(Job.status == "queued").order_by(Job.created_at).limit(1))
        if not job_id:
            return False
        claim = db.execute(update(Job).where(Job.id == job_id, Job.status == "queued").values(status="processing", started_at=now()))
        db.commit()
        if claim.rowcount != 1:
            return True
        job = db.get(Job, job_id)
        from app.models import Template
        template = db.get(Template, job.template_id)
        try:
            prompt = template.prompt + (" Extra user instructions: " + job.custom_prompt if job.custom_prompt else "")
            if job.provider == "demo":
                out = settings.output_dir / f"{job.id}.mp4"
                render_demo_video(Path(job.input_path), out)
                job.output_path = str(out)
            elif job.provider == "fal":
                url, request_id = fal_generate_video(Path(job.input_path), prompt)
                job.output_url = url
                job.provider_request_id = request_id
            else:
                raise RuntimeError("未知生成服务")
            job.status = "completed"
            job.completed_at = now()
            db.commit()
            Path(job.input_path).unlink(missing_ok=True)
            logger.info("Job %s completed", job.id)
        except Exception as exc:
            logger.exception("Job %s failed", job.id)
            mark_failed(db, job, str(exc))
        return True


def fail_stale_jobs(max_minutes: int = 25):
    # Do not auto-resubmit stale fal requests: duplicate generation could incur costs.
    cutoff = now() - timedelta(minutes=max_minutes)
    with SessionLocal() as db:
        stale = db.scalars(select(Job).where(Job.status == "processing", Job.started_at < cutoff)).all()
        for job in stale:
            mark_failed(db, job, "任务处理超时，已自动返还积分；请核查提供商是否已计费")


def purge_expired_local_files():
    """Permanently remove local generated videos past retention; DB rows remain for history."""
    cutoff = now() - timedelta(days=max(1, settings.retention_days))
    with SessionLocal() as db:
        old_jobs = db.scalars(select(Job).where(Job.completed_at < cutoff)).all()
        for job in old_jobs:
            if job.input_path:
                Path(job.input_path).unlink(missing_ok=True)
            if job.output_path:
                Path(job.output_path).unlink(missing_ok=True)
                job.output_path = None
        db.commit()


def collect_if_due():
    if not settings.youtube_key:
        return
    with SessionLocal() as db:
        last = db.scalar(select(func.max(CollectionRun.started_at)).where(CollectionRun.source == "youtube"))
        if last:
            last_aware = last.replace(tzinfo=timezone.utc) if last.tzinfo is None else last
            if now() - last_aware < timedelta(hours=settings.collection_interval_hours):
                return
        try:
            collect_youtube(db)
        except Exception:
            logger.exception("YouTube collection failed")


def loop():
    create_tables()
    logger.info("Background worker running")
    count = 0
    while True:
        try:
            busy = process_one()
            if count % 60 == 0:
                fail_stale_jobs()
                purge_expired_local_files()
                collect_if_due()
            count += 1
            time.sleep(1 if busy else 3)
        except Exception:
            logger.exception("Worker loop error")
            time.sleep(5)

if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    loop()
