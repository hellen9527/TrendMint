"""Public YouTube Data API collection + explicit sample labeling.

`views/hour since publication` is a proxy (not a real 24-hour growth metric).
Only repeated snapshots are eligible for observed view deltas.
"""
from __future__ import annotations
from datetime import datetime, timedelta, timezone
from math import log10
from urllib.parse import urlparse
import httpx
from sqlalchemy import select
from sqlalchemy.orm import Session
from app.config import settings
from app.models import CollectionRun, Discovery, Trend, VideoEvidence, now

DISCOVERY_SEARCHES = ["AI video trend shorts", "AI filter trend tutorial", "AI video challenge 2026"]


def score_trend(trend: Trend) -> int:
    # Total weight: growth 25, demand 25, willingness 20, opportunity 15,
    # feasibility+compliance 15. Unknown growth contributes zero, not fabricated data.
    growth = trend.growth_pct
    growth_points = 0 if growth is None else max(0, min(25, round(float(growth) * 2.0)))
    demand = (trend.demand if trend.demand is not None else 3) * 5
    willingness = (trend.willingness if trend.willingness is not None else 3) * 4
    opportunity = (trend.opportunity if trend.opportunity is not None else 3) * 3
    delivery = round(((trend.feasibility if trend.feasibility is not None else 3) + (trend.compliance if trend.compliance is not None else 3)) / 10 * 15)
    return min(100, max(0, growth_points + demand + willingness + opportunity + delivery))


def parse_date(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


def valid_source_url(url: str) -> bool:
    if not url:
        return True
    try:
        parsed = urlparse(url)
        return parsed.scheme == "https" and bool(parsed.netloc) and len(url) <= 1000
    except Exception:
        return False


def youtube_search(client: httpx.Client, key: str, query: str, after: datetime, limit: int = 10) -> list[dict]:
    result = client.get("https://www.googleapis.com/youtube/v3/search", params={
        "key": key, "part": "snippet", "q": query, "type": "video", "order": "date",
        "publishedAfter": after.strftime("%Y-%m-%dT%H:%M:%SZ"), "maxResults": limit,
        "relevanceLanguage": "en", "safeSearch": "moderate",
    })
    result.raise_for_status()
    items = result.json().get("items", [])
    ids = [item.get("id", {}).get("videoId") for item in items]
    ids = [v for v in ids if v]
    if not ids:
        return []
    stats_res = client.get("https://www.googleapis.com/youtube/v3/videos", params={
        "key": key, "part": "statistics,snippet,contentDetails", "id": ",".join(ids)
    })
    stats_res.raise_for_status()
    final = []
    for item in stats_res.json().get("items", []):
        desc = item.get("snippet", {})
        final.append({
            "id": item["id"], "title": desc.get("title", ""),
            "published_at": parse_date(desc.get("publishedAt")),
            "views": int(item.get("statistics", {}).get("viewCount", 0)),
            "url": f"https://www.youtube.com/watch?v={item['id']}",
        })
    return final


def track_keyword(db: Session, trend: Trend, videos: list[dict], observation_time: datetime | None = None) -> None:
    when = observation_time or now()
    if not videos:
        trend.measured_at = when
        trend.sample_count = 0
        trend.sample_views = 0
        trend.growth_pct = None
        trend.delta_views = None
        trend.score = score_trend(trend)
        return
    current_total = sum(v["views"] for v in videos)
    delta = 0
    previous_total = 0
    repeat_count = 0
    elapsed_weighted = 0
    for v in videos:
        existing = db.scalar(select(VideoEvidence).where(
            VideoEvidence.trend_id == trend.id,
            VideoEvidence.platform == "youtube", VideoEvidence.external_id == v["id"]
        ))
        if existing:
            age_hours = (when - existing.observed_at.replace(tzinfo=timezone.utc) if existing.observed_at.tzinfo is None else when-existing.observed_at).total_seconds()/3600
            if age_hours >= 4 and existing.views is not None:
                previous_total += max(0, existing.views)
                delta += max(0, v["views"] - existing.views)
                repeat_count += 1
                elapsed_weighted += age_hours
            existing.prev_views = existing.views
            existing.prev_at = existing.observed_at
            existing.views = v["views"]
            existing.title = v["title"][:250]
            existing.observed_at = when
        else:
            db.add(VideoEvidence(trend_id=trend.id, platform="youtube", external_id=v["id"],
                                 title=v["title"][:250], url=v["url"], views=v["views"], observed_at=when))
    trend.source = "youtube"
    trend.is_sample = False
    trend.sample_count = len(videos)
    trend.sample_views = current_total
    if repeat_count and previous_total:
        trend.delta_views = delta
        trend.growth_pct = round(delta / previous_total * 100, 2)
    else:
        trend.delta_views = None
        trend.growth_pct = None
    trend.measured_at = when
    trend.score = score_trend(trend)


def discover_video(db: Session, v: dict, when: datetime | None = None) -> None:
    when = when or now()
    age_hours = None
    if v.get("published_at"):
        age_hours = max(1, (when - v["published_at"]).total_seconds()/3600)
    velocity = round(v["views"] / age_hours, 1) if age_hours else None
    existing = db.scalar(select(Discovery).where(Discovery.external_id == v["id"]))
    if existing:
        existing.views = v["views"]
        existing.observed_at = when
        existing.velocity_per_hour = velocity
        existing.video_age_hours = age_hours
    else:
        db.add(Discovery(external_id=v["id"], title=v["title"][:250], url=v["url"], views=v["views"],
                         published_at=v.get("published_at"), observed_at=when, velocity_per_hour=velocity,
                         video_age_hours=age_hours))


def collect_youtube(db: Session) -> dict:
    if not settings.youtube_key:
        raise ValueError("未配置 YOUTUBE_API_KEY，无法获取实时 YouTube 数据")
    run = CollectionRun(source="youtube", status="running")
    db.add(run)
    db.commit()
    tracked = 0
    found = 0
    failures = []
    after = now() - timedelta(days=7)
    try:
        with httpx.Client(timeout=20) as client:
            for trend in db.scalars(select(Trend).order_by(Trend.id).limit(20)).all():
                try:
                    vids = youtube_search(client, settings.youtube_key, trend.keyword, after, 10)
                    track_keyword(db, trend, vids)
                    db.commit()
                    tracked += 1
                except Exception as exc:
                    db.rollback()
                    failures.append(f"{trend.keyword}: {str(exc)[:120]}")
            for query in DISCOVERY_SEARCHES:
                try:
                    for video in youtube_search(client, settings.youtube_key, query, after, 12):
                        discover_video(db, video)
                        found += 1
                    db.commit()
                except Exception as exc:
                    db.rollback()
                    failures.append(f"{query}: {str(exc)[:120]}")
    finally:
        run = db.get(CollectionRun, run.id)
        run.status = "partial" if failures and tracked+found else ("failed" if failures else "completed")
        run.detail = f"跟踪关键词 {tracked} 个，发现视频 {found} 条。" + (" 失败: " + "; ".join(failures)[:1200] if failures else "")
        run.finished_at = now()
        db.commit()
    return {"status": run.status, "tracked": tracked, "discoveries": found, "errors": failures}


def build_daily_report(db: Session) -> str:
    """Safe, data-grounded admin report; never present seeded rows as observed trends."""
    candidates = db.scalars(select(Trend).order_by(Trend.score.desc(), Trend.id.desc()).limit(40)).all()
    discoveries = db.scalars(select(Discovery).order_by(Discovery.observed_at.desc()).limit(15)).all()
    def cell(value):
        return str(value or "—").replace("|", "\\|").replace("\n", " ").replace("\r", " ")
    lines = [f"# TrendMint 机会日报 — {now().date().isoformat()}", "",
             "数据说明：仅来自人工线索、可配置的 YouTube 官方公开采样和显式标记的演示候选。未接入 Instagram/TikTok 实时数据。",
             "", "## 热点候选排序", "",
             "| 排名 | 玩法 | 评分 | 来源 | 采样增长 | 可靠性 | 下一步 |",
             "|---:|---|---:|---|---|---|---|"]
    for n, trend in enumerate(candidates, 1):
        reliability = "演示样例（无真实证据）" if trend.is_sample else ("待重复采样" if trend.growth_pct is None else "重复观测")
        change = "未知" if trend.growth_pct is None else f"{trend.growth_pct:+.2f}%（采样视频）"
        action = "评估生成成本和用户付费动机" if trend.stage == "待验证" else trend.stage
        lines.append(f"| {n} | {cell(trend.title)} | {trend.score} | {cell(trend.source)} | {change} | {reliability} | {cell(action)} |")
    if not candidates:
        lines.append("| — | 暂无候选 | — | — | — | — | 先添加关键词 |")
    lines += ["", "## 最近的视频发现", "",
              "| 标题 | 发布以来均值播放/小时 | 官方链接 |",
              "|---|---:|---|"]
    for video in discoveries:
        lines.append(f"| {cell(video.title)} | {video.velocity_per_hour if video.velocity_per_hour is not None else '未知'} | {cell(video.url)} |")
    if not discoveries:
        lines.append("| 暂无官方发现；配置 YOUTUBE_API_KEY 后采集 | — | — |")
    lines += ["", "## 当天建议工作流", "",
              "1. 从候选中选出一项，并核实官方视频原始素材和版权。",
              "2. 到 Google Trends/搜索引擎检查制作类关键词增长与购买意图。",
              "3. 用实际模型测试三条视频，记录成功率、耗时和实际成本。",
              "4. 上线一个模板 Landing，发布获得授权的示例短视频，记录点击到付费的漏斗。",
              "5. 只有看到实际付款和正向单位贡献利润后，再增加投放预算。",
              "", "注意：该报告不是客观盈利预测，评分包含管理员主观评价；播放增长不代表搜索增长。", ""]
    return "\n".join(lines)
