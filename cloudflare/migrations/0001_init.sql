-- TrendMint Workers: D1 schema v1. All timestamps are ISO UTC strings.
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS users (
 id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL,
 credits INTEGER NOT NULL DEFAULT 0 CHECK (credits >= 0), is_admin INTEGER NOT NULL DEFAULT 0,
 stripe_customer_id TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS templates (
 id INTEGER PRIMARY KEY AUTOINCREMENT, slug TEXT NOT NULL UNIQUE, title TEXT NOT NULL,
 title_en TEXT NOT NULL, description TEXT NOT NULL, description_en TEXT NOT NULL, prompt TEXT NOT NULL,
 emoji TEXT NOT NULL DEFAULT '✨', tag TEXT NOT NULL DEFAULT '精选', credits INTEGER NOT NULL DEFAULT 6,
 active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS jobs (
 id TEXT PRIMARY KEY, user_id INTEGER NOT NULL, template_id INTEGER NOT NULL,
 status TEXT NOT NULL DEFAULT 'queued', input_key TEXT, output_key TEXT, custom_prompt TEXT NOT NULL DEFAULT '',
 cost_credits INTEGER NOT NULL, estimated_cost_usd REAL NOT NULL DEFAULT 0,
 provider TEXT NOT NULL DEFAULT 'fal', provider_request_id TEXT, provider_status_url TEXT,
 provider_response_url TEXT, error TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')),
 started_at TEXT, completed_at TEXT, FOREIGN KEY(user_id) REFERENCES users(id),
 FOREIGN KEY(template_id) REFERENCES templates(id)
);
CREATE INDEX IF NOT EXISTS idx_jobs_user ON jobs(user_id,created_at);
CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status,created_at);
CREATE TABLE IF NOT EXISTS credit_entries (
 id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, delta INTEGER NOT NULL,
 balance_after INTEGER NOT NULL, reason TEXT NOT NULL, ref TEXT NOT NULL UNIQUE,
 created_at TEXT NOT NULL DEFAULT (datetime('now')), FOREIGN KEY(user_id) REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS orders (
 id TEXT PRIMARY KEY, user_id INTEGER NOT NULL, product_id TEXT NOT NULL, amount_cents INTEGER NOT NULL,
 credits INTEGER NOT NULL, kind TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending',
 checkout_id TEXT UNIQUE, created_at TEXT NOT NULL DEFAULT (datetime('now')), paid_at TEXT,
 FOREIGN KEY(user_id) REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS subscriptions (
 id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, plan_id TEXT NOT NULL,
 stripe_id TEXT NOT NULL UNIQUE, status TEXT NOT NULL DEFAULT 'pending',
 created_at TEXT NOT NULL DEFAULT (datetime('now')), FOREIGN KEY(user_id) REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS stripe_events (
 id TEXT PRIMARY KEY, type TEXT NOT NULL, processed_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS revenue_events (
 id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, cents INTEGER NOT NULL,
 kind TEXT NOT NULL, ref TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL DEFAULT (datetime('now')),
 FOREIGN KEY(user_id) REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS trends (
 id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, keyword TEXT NOT NULL UNIQUE,
 category TEXT NOT NULL DEFAULT 'AI Video', source TEXT NOT NULL DEFAULT 'manual',source_url TEXT NOT NULL DEFAULT '',
 stage TEXT NOT NULL DEFAULT '待验证', is_sample INTEGER NOT NULL DEFAULT 0,
 sample_count INTEGER NOT NULL DEFAULT 0,sample_views INTEGER,delta_views INTEGER,growth_pct REAL,
 demand INTEGER NOT NULL DEFAULT 3,willingness INTEGER NOT NULL DEFAULT 3,opportunity INTEGER NOT NULL DEFAULT 3,
 feasibility INTEGER NOT NULL DEFAULT 3,compliance INTEGER NOT NULL DEFAULT 3,score INTEGER NOT NULL DEFAULT 0,
 notes TEXT NOT NULL DEFAULT '',measured_at TEXT,created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS video_evidence (
 id INTEGER PRIMARY KEY AUTOINCREMENT,trend_id INTEGER NOT NULL,platform TEXT NOT NULL,
 external_id TEXT NOT NULL,title TEXT NOT NULL,url TEXT NOT NULL, views INTEGER,
 prev_views INTEGER,prev_at TEXT,observed_at TEXT NOT NULL DEFAULT (datetime('now')),
 UNIQUE(trend_id,platform,external_id), FOREIGN KEY(trend_id) REFERENCES trends(id)
);
CREATE TABLE IF NOT EXISTS discoveries (
 id INTEGER PRIMARY KEY AUTOINCREMENT,external_id TEXT NOT NULL UNIQUE,title TEXT NOT NULL,
 url TEXT NOT NULL,views INTEGER NOT NULL DEFAULT 0,published_at TEXT,observed_at TEXT NOT NULL DEFAULT (datetime('now')),
 velocity_per_hour REAL,video_age_hours REAL,promoted INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS collection_runs (
 id INTEGER PRIMARY KEY AUTOINCREMENT,source TEXT NOT NULL,status TEXT NOT NULL,
 detail TEXT NOT NULL DEFAULT '',started_at TEXT NOT NULL DEFAULT (datetime('now')),finished_at TEXT
);
CREATE TABLE IF NOT EXISTS metric_events (
 id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER,event TEXT NOT NULL,source TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS rate_limits (
 key TEXT PRIMARY KEY,n INTEGER NOT NULL,window_start INTEGER NOT NULL
);
-- Default creatives are ORIGINAL, not copies of copyrighted music or famous performances.
INSERT OR IGNORE INTO templates (slug,title,title_en,description,description_en,prompt,emoji,tag,credits) VALUES
('pet-popstar','宠物小明星','AI Pet Popstar','上传宠物照片，生成原创舞台表演。','Give your pet a fun original performance on a colorful stage.','Cute pet singing on a cheerful original concert stage, vibrant lighting, joyful facial movement, dramatic cinematic push-in, portrait 9:16 composition, no logos, no artist imitation.','🐈','热门创意',6),
('memory-alive','回忆重现','AI Memory Alive','让家庭照片拥有温柔的电影镜头运动。','Animate a treasured photo with soft, warm and respectful movement.','Gently animate a personal photo, subtle natural facial expressions, delicate cinematic slow camera motion, warm filmic light, preserve identity accurately, avoid age changes.','📷','经典',6),
('birthday-magic','生日魔法','AI Birthday Magic','把个人照片变成节日生日短片。','Create a personalized original birthday surprise video.','Personalized birthday moment with a graceful celebration, sparkling light, delicate festive confetti, cinematic lighting, smooth 9:16 vertical framing, no trademark.','🎂','适合送礼',6),
('mini-adventure','迷你冒险','AI Mini Adventure','轻松实现超现实小世界冒险。','Transform yourself into an original miniature adventure.','Miniature scale fantasy with imaginative original tiny scenery, shallow depth of field, delightful motion, professional cinema look, vertical framing 9:16.','🚀','新玩法',6);
