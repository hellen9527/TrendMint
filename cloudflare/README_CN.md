# TrendMint Cloudflare 部署版（独立于已有 fategenie.com 应用）

这是专门适配 **Cloudflare Workers + D1 + R2 + Workers Static Assets + Cron Triggers** 的 TypeScript 后端。
原有 FastAPI/SQLite/ffmpeg 版保留在仓库根目录，可继续作为本地开发版；Cloudflare 不运行该 Python 服务。

> **公网默认：** 关闭演示管理员与虚拟积分，视频 AI 和 Stripe 在设置服务端密钥前不会执行。数据库和 R2 均为私有资源。没有进行第三方线上实付验证，请先使用 Stripe 测试模式联调再开放 Live 模式。

## 1. 安全的域名部署结构

- 原站：`https://fategenie.com`（保持不变、不覆盖现有应用）
- 新站：`https://trendmint.fategenie.com`（独立 Worker + D1 + R2）
- API：`https://trendmint.fategenie.com/api/health`
- GitHub：`https://github.com/hellen9527/TrendMint`

## 2. 最少操作部署（Cloudflare + GitHub Actions）

> **2026-10-10 新增：** 现在 GitHub Actions 会自动创建/复用名为 `trendmint-db` 的 D1 数据库及 `trendmint-media` 的 R2 私有存储桶。无需自己在 Cloudflare 中创建或复制 D1 Database ID。部署只操作名称明确的 TrendMint 资源，不修改 fategenie.com 现有应用。

1. 到 [Cloudflare API Tokens](https://dash.cloudflare.com/profile/api-tokens) 新建一个**限制到你的 Cloudflare 账户及 fategenie.com Zone**的 API Token。账户权限需要 Workers Scripts Edit、D1 Edit、Workers R2 Storage Write；如果需要自动绑定子域名，还要相应的 Workers Routes / Zone 权限。不要使用 Global API Key，也不要把 token 发到聊天或提交到 Git。
2. 从 Cloudflare 账户页面获取 **Account ID**（32 位十六进制）。
3. GitHub `hellen9527/TrendMint` → **Settings → Secrets and variables → Actions → Repository secrets** 新建三个 Secrets：

| Secret | 用途 |
|---|---|
| `CLOUDFLARE_API_TOKEN` | 只授权 TrendMint 的 Workers/D1/R2 部署 |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare Account ID |
| `TRENDMINT_SESSION_SECRET` | 生成并保存一个**至少 32 位的随机字符串**，用于保持登录会话签名稳定 |

生成会话密钥（在本机运行，只复制输出到 GitHub Secret，不要发到聊天）：

```bash
python -c "import secrets; print(secrets.token_urlsafe(48))"
```

4. 如希望部署时**自动绑定独立子域名**，在 GitHub 的 **Actions → Variables** 新建 `TRENDMINT_CUSTOM_DOMAIN`，值为 `true`。这只会绑定 `trendmint.fategenie.com`，不会触碰根域名。如该子域名已有记录或绑定，先检查后再开启，防止冲突。若不设置，默认仅部署到 Cloudflare `*.workers.dev` 地址。
5. 运行源码压缩包根目录的 `publish_to_github_windows.bat`（Windows，需要 Git 和 Python）或 `python3 publish_to_github.py`（Mac/Linux）。会克隆现有仓库、提交项目代码并推送到 `main`，**不会 force push 或抹掉历史**。如果仓库已有代码变更，请先确认后提交。
6. 到 [GitHub Actions](https://github.com/hellen9527/TrendMint/actions) → **Cloudflare Deploy** 查看自动执行结果。部署会依次执行：测试 → 自动建 D1/R2 → D1 migrations → Worker 发布 → 配置 Session Secret。

首次启用 R2 时 Cloudflare 可能要求在账户中开启 R2 服务或绑定账单；这种账户级操作无法由工作流代做。若你没设置 `TRENDMINT_CUSTOM_DOMAIN=true`，部署成功后可在 Cloudflare → Workers & Pages → `trendmint` 里查看 Worker 的 `workers.dev` 地址。

## 3. 验证上线和设置第一个管理员

如果已经绑定子域名：

- `https://trendmint.fategenie.com/`：网站首页
- `https://trendmint.fategenie.com/api/health`：后端是否正常（应返回 `status: ok`）
- `https://trendmint.fategenie.com/studio`：视频生成界面（未配置 fal.ai 时，生成会受限）
- `https://trendmint.fategenie.com/billing`：付费页面（未配置 Stripe 时支付关闭）

**请先确认整个流程健康后再开启真金白银支付。** 目前默认禁止模拟管理员、虚拟充值及真实支付/视频推理，不会产生模型账单。

要查看管理员的热点雷达：在网站注册自己的邮箱和密码，再到 Cloudflare → D1 → `trendmint-db` 的 SQL 控制台执行以下更新（换成自己的邮箱）：

```sql
UPDATE users SET is_admin = 1 WHERE email = '你的邮箱@example.com';
```

重新登录后可打开 `/trends`、`/dashboard`。公网注册用户默认**不**拥有管理员权限。

## 4. 开启真实模型（可稍后做）

Cloudflare Worker Secrets：

- `FAL_KEY`：fal.ai 提供的 API Key

Worker Variables：

- `VIDEO_PROVIDER=fal`
- `FAL_MODEL_ID=fal-ai/kling-video/v2.5-turbo/standard/image-to-video`
- `VIDEO_COST_ESTIMATE_USD=0.50`（这里只是预计费用，务必核对模型单价）
- `MAX_DAILY_VIDEO_BUDGET_USD=10`

模型请求走队列，Cloudflare Cron 每 5 分钟轮询。模型结果私有存到 R2，下载时校验归属，超过 7 天清理。模型、数据 URL 兼容性和成功率还需要真实密钥联调。

**上线前请确认**用户上传照片、供应商模型训练/存储政策及版权和肖像授权；不同模型有不同输入字段。

## 5. 开启 YouTube 趋势雷达

Cloudflare Worker Secret：`YOUTUBE_API_KEY`。管理员点击「立即采集 YouTube」，或每日 03:00 UTC 定时采集。首次采样无法计算增长率，四小时以后重复采样才可比较。可人工录入 Instagram、TikTok 公开线索。

## 6. 启用 Stripe 测试支付

Cloudflare Worker Secrets：

- `STRIPE_SECRET_KEY=sk_test_...`
- `STRIPE_WEBHOOK_SECRET=whsec_...`

Cloudflare Worker Variable：`PAYMENTS_ENABLED=true`（**仅在测试环境已验证时设置**）。

Stripe Test Mode Webhook 地址：

`https://trendmint.fategenie.com/api/billing/stripe-webhook`

建议订阅事件：`checkout.session.completed`、`checkout.session.async_payment_succeeded`、`invoice.paid`、`invoice.payment_failed`、`customer.subscription.updated`、`customer.subscription.deleted`。

生产支付前仍需要补退款/争议自动冲回、财务报表对账、税费及账单披露；现在不要启用 Live 收款。

## 7. 本地运行 Worker

需要 Node 20+，且登录自己的 Cloudflare 账户（`npx wrangler login`）：

```bash
cd cloudflare
npm install
cp .dev.vars.example .dev.vars
# 在 .dev.vars 中填入足够随机的 SESSION_SECRET
npm run migrate:local
npm run dev
```

本地访问 `http://127.0.0.1:8787`。由于 `Secure` Cookie，只能通过 HTTPS 使用完整登录流程；对于 localhost 的本地调试，可在本地专用模式允许非 Secure Cookie，切勿将此配置用于线上。

## 8. 已知差异

| 功能 | 本地 FastAPI 版 | Cloudflare 版 |
|---|---|---|
| 用户/模板/热门线索 | SQLite | D1 |
| 上传和视频下载 | 本机文件目录 | R2 私有桶 |
| AI 后台任务 | Python Worker | Cron + fal Queue |
| 模拟视频 | ffmpeg 本地生成 | 关闭（防止误导付费用户） |
| 支付 | Stripe REST Webhook | Stripe REST + WebCrypto 签名校验 |
| SEO | FastAPI 返回页面 | Worker 静态资源 + 注入 metadata |

**不能将旧 SQLite 文件自动当成 D1 数据库使用**。目前 Cloudflare 版通过 migration 初始化 4 个原创模板。独立运行，生产扩张前要完善数据库并发、退款处理、登录验证码和真实第三方集成测试。

Cloudflare 官方文档：[Worker Assets](https://developers.cloudflare.com/workers/static-assets/)、[D1](https://developers.cloudflare.com/d1/get-started/)、[R2](https://developers.cloudflare.com/r2/get-started/)。
