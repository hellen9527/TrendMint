"""Seed deterministic examples; never mix sample trends into observed results."""
from sqlalchemy import select
from sqlalchemy.orm import Session
from app.config import settings
from app.models import Template, Trend, User, CreditEntry
from app.auth import hash_password
from app.trends import score_trend

TEMPLATES = [
    dict(slug="pet-popstar", title="宠物明星舞台", title_en="AI Pet Popstar", description="让猫咪或狗狗登上霓虹舞台，轻摇身体、对镜头互动。", description_en="Turn your pet photo into a playful, neon-lit stage performance.", prompt="A cute pet becomes a charming pop star, on a luminous neon stage with soft spotlights, playful expressive movements, cinematic framing, high quality, natural face, wholesome, original performance, vertical framing.", emoji="🐈", tag="人气玩法", credits=6),
    dict(slug="memory-alive", title="老照片轻动", title_en="Bring a Photo to Life", description="给珍贵照片加入自然的微笑、呼吸与温柔运镜。", description_en="Make a cherished portrait move naturally, with subtle motion and a warm atmosphere.", prompt="Animate this portrait delicately: subtle natural breathing, realistic eye blink and warm, gentle smile, very slow smooth camera push-in. Preserve the identity and composition. No new people, no distortion, cinematic realistic.", emoji="📷", tag="情感向", credits=6),
    dict(slug="birthday-magic", title="生日魔法", title_en="Magical Birthday Greeting", description="把人物或宠物的照片变成充满彩带与光点的生日祝福。", description_en="Create a delightful birthday greeting with confetti and glowing lights.", prompt="A magical birthday celebration around the subject, tasteful balloons and fluttering colorful confetti, golden sparkles, warm joyful mood, elegant camera motion, preserve character appearance, vertical composition.", emoji="🎂", tag="转化潜力", credits=6),
    dict(slug="mini-adventure", title="微缩冒险世界", title_en="Tiny World Adventure", description="把主体带进袖珍景观，创造超现实的奇妙画面。", description_en="Place your subject inside a whimsical miniature-world adventure.", prompt="A whimsical miniature world, the main character exploring a lush tiny garden amongst oversized flowers, dreamy shallow depth of field, lovely cinematic camera travel, retain identity and original subject, vertical format.", emoji="✨", tag="创意场景", credits=6),
]

SAMPLES = [
    dict(title="AI Pet Performance", keyword="AI pet dance trend", category="宠物", notes="演示候选；尚未接入真实平台增长数据。先测试 3 条演示素材和 API 生成一致性。", demand=4, willingness=4, opportunity=4, feasibility=4, compliance=4),
    dict(title="Old Photo Animation", keyword="AI old photo animation", category="情感", notes="演示候选；长期需求假设，需用关键词数据和购买行为验证。", demand=4, willingness=4, opportunity=3, feasibility=4, compliance=4),
    dict(title="AI Birthday Greeting", keyword="AI birthday video personalized", category="祝福", notes="演示候选；关注节日前搜索需求和首次付费转化。", demand=4, willingness=4, opportunity=3, feasibility=4, compliance=4),
    dict(title="AI Rap Duo", keyword="AI rap duo video trend", category="音乐", notes="演示候选；建议避开未获得授权的歌曲和表演素材。", demand=4, willingness=4, opportunity=2, feasibility=4, compliance=2),
    dict(title="Tiny World AI", keyword="AI miniaturized world video", category="创意", notes="演示候选；需验证视频质量和模板分享意愿。", demand=3, willingness=3, opportunity=4, feasibility=3, compliance=4),
]

def seed(db: Session) -> None:
    if not db.scalar(select(Template.id).limit(1)):
        db.add_all(Template(**t) for t in TEMPLATES)
        db.commit()
    if settings.demo_mode and not db.scalar(select(Trend.id).limit(1)):
        for data in SAMPLES:
            trend = Trend(source="sample", is_sample=True, **data)
            trend.score = score_trend(trend)
            db.add(trend)
        db.commit()
    if settings.demo_mode and not db.scalar(select(User.id).where(User.email == "demo@trendmint.local")):
        user = User(email="demo@trendmint.local", password_hash=hash_password("demo-only"), credits=24, is_admin=True)
        db.add(user)
        db.flush()
        db.add(CreditEntry(user_id=user.id, delta=24, balance_after=24, reason="演示账号赠送", ref=f"demo:{user.id}:initial"))
        db.commit()
