# ✦ TrendMint — 趋势雷达 + AI 视频模板平台

> 可执行的全栈 MVP：热点发现 → 候选评分 → 图片上传 → 异步视频生成 → 积分账本 → Stripe 支付 / 订阅 → 实际经营数据看板。
>
> **状态：本地演示和核心业务自动化可运行。生产模型、YouTube 数据和 Stripe 收款需要你自己的凭证、合规资质与配置。**

## 1. 先体验（不花 AI API 费用）

项目基于 **Python / FastAPI / SQLAlchemy / 原生 JS + CSS**，无需 Node/npm。为了让第一版真正运行，前后端同源部署，随后可平滑将 SPA 替换为 Next.js。

**Windows**：

1. 安装 Python 3.11+ 与 `ffmpeg`（将 ffmpeg 加入系统 PATH）。
2. 解压本项目，双击 `start_windows.bat`。
3. 打开 http://127.0.0.1:8000 。

**Mac / Linux**：

```bash
cd trendmint
cp .env.example .env
python3 -m pip install -r requirements.txt
python3 run.py
```

随后浏览器打开 `http://127.0.0.1:8000`，点击 **「免费体验演示」**，无需账号信息。

**演示账号**：仅限 `DEMO_MODE=true` 时内置 `demo@trendmint.local`，自动授予管理员权限。**这不是生产账号。**

演示版支持上传真实图片，后台使用 ffmpeg 输出有 `DEMO PHOTO MOTION - NOT AI` 水印的 3 秒 MP4，完成积分扣减/失败返还/下载；**这不是 AI 视频推理**，用于零 API 成本验证端到端逻辑。演示充值绝不计入营业收入。

### Docker 一键运行

```bash
cp .env.example .env
docker compose up --build -d
```

访问 `http://127.0.0.1:8000`。Compose 启动 API 和独立任务 Worker，并挂载持久化卷。此 Compose 配置把服务只绑定在本机，远程访问需要反向代理和 HTTPS。

## 2. 三个核心模块

| 模块 | 目前已实现 | 限制与待拓展 |
|---|---|---|
| Trend Hunter | 管理员候选库、100 分评分、YouTube Data API 搜索与视频统计、两次采样增长计算、泛关键词自动发现、新视频晋升候选、人工线索录入、**可下载 Markdown 趋势日报** | TikTok / Instagram 实时指标**没有**未经授权的爬虫；首次采样无增长率；需 YouTube Key |
| Site Factory | 四个初始模板、**管理员免代码发布/上下架新模板**、SEO 模板 Landing、用户登录、图片校验压缩、AI Provider 适配器、异步任务、失败退积分、真实视频下载 | 演示照片动效不是真实 AI；真实 fal.ai 需 Key、成本上限和素材版权审查 |
| Growth & Billing | Stripe Checkout（积分包 + 订阅）、签名校验 Webhook、一次性发积分/月度发积分、客户门户取消订阅、流水、营收、成本估计 | 接入支付前不能收费；计费及模型推理没有第三方在线端到端实付验证，需 Stripe Test Mode / fal Sandbox 测试 |

所有演示候选都标记 `is_sample=true`；**不会把演示数据伪装成实时趋势、真实用户或真实收入**。

## 3. 开启真正的 AI 视频生成

`.env` 中配置：

```dotenv
VIDEO_PROVIDER=fal
FAL_KEY=你的fal_key
FAL_MODEL_ID=fal-ai/kling-video/v2.5-turbo/standard/image-to-video
VIDEO_COST_ESTIMATE_USD=0.50
MAX_DAILY_VIDEO_BUDGET_USD=15
```

这里使用 fal 官方队列 REST API，提交图片为 JPEG data URI，然后轮询结果并保存提供商返回的 HTTPS 视频地址。API 输入字段参考 [Kling 2.5 Standard Image-to-Video 文档](https://fal.ai/models/fal-ai/kling-video/v2.5-turbo/standard/image-to-video/api)。**必须在实际开通的模型环境中验证：** 模型型号、费用、数据 URI 支持、音频权益和输出授权。某些模型可能要求先上传到 fal 存储，届时将 `video.py` 的数据 URI 替换为 fal 官方上传流程。

后台 `app.worker` 从数据库认领队列，每个任务扣除 **6 积分**；执行失败使用唯一流水键返还。演示文件不对外公开，任务下载要求用户会话；本地生成视频默认 **7 天后**清除，源图片在生成成功/失败后立即删除。fal 返回的视频托管地址仍受第三方自己的访问策略与保留规则影响。

**上线前请明确告知用户数据会被传输到哪家生成服务**，并建立隐私政策、保留期限以及撤回/删除机制。

## 4. 开启真实趋势采集

1. 在 Google Cloud 创建项目，并启用 **YouTube Data API v3**。
2. 生成允许 `youtube.googleapis.com` 的 API Key。
3. `.env` 设置 `YOUTUBE_API_KEY=...`。
4. 使用管理员账号进入 **「热点雷达」→「立即采集 YouTube」**；后台 Worker 默认每 24 小时检查一次。

- 固定候选关键词：依次调用官方 `search.list`、`videos.list` API。
- 泛搜索词：`AI video trend shorts` / `AI filter trend tutorial` / `AI video challenge 2026`，返回的视频放入「新发现的线索」。
- 点击「加入候选」→ 人工检查是否属于可复用的视频模板，避免“高播放量的视频标题”被直接误当成购买热点。
- 首次运行只有观测值；同一视频在 **至少 4 小时后再次出现**，才有观察到的播放量变化。`growth_pct` 不是 24 小时流量涨幅或搜索词热度。
- 评分 **增长 25 + 需求 25 + 付费 20 + 竞争机会 15 + 技术/合规 15**；除增长外的维度目前需要管理员评估，无法作为客观市场数据。

参考 [YouTube search.list](https://developers.google.com/youtube/v3/docs/search/list) 和 [videos.list](https://developers.google.com/youtube/v3/docs/videos/list)。YouTube API 有调用配额，请适当收紧候选列表、采样频率和查询批次。

## 5. 开启真实支付和自动续费

在 Stripe Dashboard 创建 API Key、Webhook，并设置：

```dotenv
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
WEB_BASE_URL=https://你的域名
```

Webhook URL：`https://你的域名/api/billing/stripe-webhook`。

需要订阅的 Stripe 事件：

- `checkout.session.completed`
- `checkout.session.async_payment_succeeded`（代码兼容此事件，Checkout 默认只开放银行卡）
- `invoice.paid`
- `invoice.payment_failed`
- `customer.subscription.updated`
- `customer.subscription.deleted`

**支付成功跳转页不能加积分。** 每个成功的一次性 Checkout 根据 `order:id` 入账一次；每个有效的订阅 Invoice 根据 `invoice:id` 发放一次积分。Webhooks 按 event id 去重。订阅续费受 Webhook 顺序影响，代码尝试根据 Stripe Subscription 记录恢复用户关系（需在线集成验证）。

提供了 `/api/billing/portal`，供已有 Stripe 客户进入 **Stripe Billing Customer Portal** 取消或管理订阅；需在 Stripe Dashboard 开启取消订阅功能与默认 Portal 配置。为遵守自动续费披露要求，必须在页面和结账流程明确展示续费与取消方式。

**在 Stripe Test Mode 完整验证充值、订阅首月、续费、取消、退款和争议处理，再打开 Live Mode。** 本 MVP 尚未自动处理退款与 chargeback 的积分冲回；上线前补上或配置人工风控与退款流程。Stripe 可用地区及主体资质要自行确认。

## 6. 上线配置：不要照搬演示模式

1. 使用真实独立域名 + HTTPS 反向代理（Caddy / Nginx / Cloudflare）。
2. `.env` 设 `APP_ENV=production`、`DEMO_MODE=false`、`COOKIE_SECURE=true`、`WEB_BASE_URL=https://你的域名`、足够随机的 `SECRET_KEY`。生产启动会校验若干核心安全配置。
3. 用真实邮箱注册普通用户，之后在服务器终端运行：`python -m app.make_admin --email 你的邮箱`。**管理员绝不能通过公开注册自动获得权限。**
4. 启用限流、反滥用、人机验证、邮箱验证与可审计日志；默认生产注册**不赠送可消耗 AI 算力的积分**。
5. 检查视频 7 天保留期限与第三方供应商的存储规则，制定隐私政策、用户条款、退款/争议处理和素材版权说明。
6. 当前 SQLite 适合单节点 MVP；持续运营建议 PostgreSQL + Alembic schema migrations + Redis/Celery。不要把 SQLite 放到多个不同主机共享的网络盘上。修改数据库结构后，应使用迁移方案；`create_all()` 不会修改已有表列。
7. 实际模型计费（包括失败尝试）、退款、Stripe 费用和税费不完全包含在「估算贡献额」中；**不能把它当净利润**。
8. 演示账号和演示充值只能在 `DEMO_MODE=true` 使用，发布前关闭。

## 7. 接口与运行检查

在本地打开 API 参考：`http://127.0.0.1:8000/docs`。

关键 API：

```text
GET    /api/health
POST   /api/auth/register
POST   /api/auth/login
POST   /api/auth/demo                       演示专属
GET    /api/auth/me
POST   /api/auth/logout
GET    /api/public/templates
GET    /api/admin/templates                  管理员查看所有已上架/下架模板
POST   /api/admin/templates                  管理员新建模板
PATCH  /api/admin/templates/{id}             管理员上下架/调整参数
GET    /api/public/plans
POST   /api/jobs                            multipart image + template_id + agree_rights
GET    /api/jobs
GET    /api/jobs/{uuid}/download
GET    /api/wallet
POST   /api/billing/checkout
POST   /api/billing/portal
POST   /api/billing/stripe-webhook
GET    /api/admin/trends
POST   /api/admin/trends
PATCH  /api/admin/trends/{id}
GET    /api/admin/trends/{id}/evidence
GET    /api/admin/discoveries
POST   /api/admin/discoveries/{id}/promote
POST   /api/admin/collect
GET    /api/admin/report                     生成 Markdown 热点日报
GET    /api/admin/overview
```

使用 HttpOnly Cookie 登录。浏览器写请求需回传 Cookie `tm_csrf` 到 `X-CSRF-Token`。服务端保存密码为 Argon2 哈希，JWT 12 小时过期。Stripe 签名校验包含 5 分钟时间窗。

```bash
python -m pytest -q
python -m compileall -q app
node --check static/app.js      # 可选，仅用于前端语法检查
```

详细运营执行表：**[docs/30_DAY_LAUNCH_CN.md](docs/30_DAY_LAUNCH_CN.md)**，上线清单：[docs/RELEASE_CHECKLIST.md](docs/RELEASE_CHECKLIST.md)。

## 8. 下一版本路线（依次）

- **v1.1：海外可收费 Beta** — Google 邮箱验证 / OAuth、真实支付与模型沙盒回归测试、账单退款与取消、用户上传删除、Cloudflare R2、多语言条款。
- **v1.2：趋势系统提升** — Google Trends 搜索序列、授权 TikTok/Instagram 来源、历史观测表与真正时间窗口、LLM 聚类、竞品关键词分析。
- **v1.3：模板工厂增强** — 模板在线新建/下架已支持；后续补在线编辑、多模型选择、A/B Landing、后台流量归因、自动 SEO 草稿人工审校和授权台账。
- **v2：扩容** — PostgreSQL + Celery + R2，部署隔离的 Web/Worker，多站点域名映射，自动成本路由与负载治理。

## 9. 重要商业与版权提示

产品不包含任何未授权明星形象、热门歌曲、原始表演画面或他人社交视频。上传素材需要有使用权。模仿热门玩法和直接复用他人的音乐、版权视频并非同一回事。海外市场需要核查商标、广告与订阅自动续费规定。

本项目实现的是**可验证的工作流和有生产扩展路线的 MVP**，不是已上线、已能盈利的业务。用户数据、订阅和营业收入都必须通过真实使用与支付来取得。

## 10. GitHub 代码管理

本源码包已包含 `.github/workflows/ci.yml`，在 GitHub 提交和 PR 时自动执行 Python 3.12/3.13 的测试与语法检查。**第一次建仓库请选择 Private**。详细步骤见 [docs/GITHUB_PUBLISH_CN.md](docs/GITHUB_PUBLISH_CN.md)。

## Cloudflare 完整部署版

目前另有 `cloudflare/` 目录：面向现有 `fategenie.com` 域名，建议使用独立子域名 `trendmint.fategenie.com`，避免覆盖已有应用。该版本使用 Workers + D1 + R2，**不是把 FastAPI 直接放在 Pages 上**。详见 [Cloudflare 部署说明](cloudflare/README_CN.md)。

⚠ Cloudflare API Token、D1 Database ID、R2 Bucket 和生产密钥由网站所有者在 Cloudflare/GitHub 管理界面配置；在未取得权限前，源码和 CI 准备就绪不等于已经上线。公开仓库切勿存放 `.env` 或第三方密钥。


## 一键 Cloudflare 部署（2026-10-10）

本版本增加 `publish_to_github.py` / `publish_to_github_windows.bat`，以及 GitHub Actions 自动初始化 TrendMint 专用 D1、R2 资源。详见 [`PUSH_TO_GITHUB_CN.md`](PUSH_TO_GITHUB_CN.md)。部署需用户自行将 Cloudflare 凭据安全地存到 GitHub Secrets；不得把 API Token 发送到聊天或公开代码仓库。
