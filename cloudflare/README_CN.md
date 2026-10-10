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
- `https://trendmint.fategenie.com/studio`：视频生成界面（未配置百炼时，生成会受限）
- `https://trendmint.fategenie.com/billing`：付费页面（未配置 Stripe 时支付关闭）

**请先确认整个流程健康后再开启支付。** 未配置视频 Key 时生成关闭；配置百炼 Key、业务空间及用户积分后，生成会调用真实 API 并产生模型费用。模拟管理员、虚拟充值默认关闭。

要查看管理员的热点雷达：在网站注册自己的邮箱和密码，再到 Cloudflare → D1 → `trendmint-db` 的 SQL 控制台执行以下更新（换成自己的邮箱）：

```sql
UPDATE users SET is_admin = 1 WHERE email = '你的邮箱@example.com';
```

重新登录后可打开 `/trends`、`/dashboard`。公网注册用户默认**不**拥有管理员权限。

## 4. 配置百炼 Wan 2.6 Flash 视频（初期推荐流程）

主模型为 `wan2.6-i2v-flash`，固定生成 **720P / 5 秒 / 单张首帧图片**，默认**无声**，降低初期成本。模型提交和查询均在 Worker 服务端执行，Key 不进入浏览器、HTML、R2 或 Git 仓库。上传图片通过此模型要求的 `input.img_url` 传入，不能使用 Wan 3.0 的 `input.media` 请求格式。

1. 打开 [百炼 API Key 页面](https://bailian.console.aliyun.com/cn-beijing/model/settings/api-key)，选择 **华北2（北京）**。同地域、同业务空间且允许调用该模型的已有 Key 可以复用；若之前 Key 的模型白名单只有 Wan 3.0，请将 `wan2.6-i2v-flash` 加入可调用模型范围。
2. 在百炼同一业务空间中复制 **业务空间 ID（Workspace ID）**：点击右上角业务空间信息，或在「业务空间管理」中查看。它不是 App ID，也不是阿里云账号 ID。获取方法见[官方说明](https://help.aliyun.com/zh/model-studio/obtain-the-app-id-and-workspace-id)。
3. 在 [GitHub Secrets](https://github.com/hellen9527/TrendMint/settings/secrets/actions) 新建 Repository secret：

| Name | Value |
|---|---|
| `DASHSCOPE_API_KEY` | 直接粘贴百炼 Key（不要发到聊天） |

4. 同一设置中的 [Variables 标签](https://github.com/hellen9527/TrendMint/settings/variables/actions) 新建 Repository variable：

| Name | Value |
|---|---|
| `DASHSCOPE_WORKSPACE_ID` | 与 Key 对应的业务空间 ID，必填 |
| `DASHSCOPE_REGION` | 默认 `cn-beijing`，北京用户无需添加；Flash 也支持 `ap-southeast-1`，需使用该地域 Key/业务空间 |
| `WAN_AUDIO` | 默认 `false`（无声）；设为 `true` 生成有声视频，模型费用翻倍 |
| `VIDEO_COST_ESTIMATE_USD` | 北京默认无声 `0.12`、有声 `0.24`；新加坡默认无声 `0.14`、有声 `0.28`。每条 5 秒视频保守预算估算，覆盖此变量时需按地域/单价/汇率更新 |
| `MAX_DAILY_VIDEO_BUDGET_USD` | 默认 `5`，每天 UTC 零点重置的预计费用上限 |

5. 在 GitHub Actions → **Cloudflare Deploy → Run workflow** 重新部署。三个 Cloudflare 部署 Secrets 仍需按第 2 节配置。工作流检测到百炼 Key 后启用 `VIDEO_PROVIDER=dashscope`，校验业务空间/地域，并通过标准输入将 Key 写入 `trendmint` Worker 的 **Secret**。未添加 Key 时继续部署网页，但关闭生成。以后修改 Key 或 Variables 后需重新运行工作流；生产配置以 GitHub Actions 为准，手工改 Dashboard 的普通 Variables 会在下一次部署时被覆盖。

视频接口使用业务空间专用 endpoint：`https://{WorkspaceId}.{Region}.maas.aliyuncs.com/api/v1`，不是 Qwen 文本聊天的 OpenAI 兼容 endpoint。Key、业务空间和 endpoint 必须属于同一地域。已充值的百炼账户仍需确认模型调用权限和余额；聊天会员与 API 余额是不同产品。

### 成本与试用策略

百炼北京当前公示原价：720P 无声 0.15 元/秒，有声 0.30 元/秒，因此 **5 秒无声 0.75 元，有声 1.50 元**（不包含活动折扣、存储、带宽等费用）。Flash 最低支持 720P，不能用 `480P` 请求；生成 720P 后压缩到 480P 也不会减少模型账单。[官方模型价格](https://help.aliyun.com/zh/model-studio/wan2-6-i2v-flash)。

当前**注册仍为 0 积分，不开放每日免费生成**。用户不足积分时返回 402，不会发起付费模型请求。免费真实生成属于获客支出：每人赠送一次 5 秒无声视频，1000 人试用约花 750 元；若 5% 付费，单个付费客户承担的试用成本为 15 元，需用其后续毛利覆盖。初期可先展示样例、确认付费需求；若以后启用新人试用，可考虑一次 2 秒无声预览（模型约 0.30 元）、账号验证及全站总预算。该 2 秒试用方案尚未启用，当前所有生成仍为 5 秒。

朋友网站 [Hotel Lobby AI](https://hotellobbyai.co/) 的当前公开规则为：免费账户每天 1 条 480p、6 秒、无声 Fast Preview，高规格使用积分。生成页明确说明免费预览用轻量模型、付费生成用更好的模型；没有公开具体供应商和模型费用，不能据此确定其每次免费试用的成本。

任务提交后只查询同一个 task ID，不反复创建。Cron 每 5 分钟轮询，所以生成完成在网站上显示可能额外等待几分钟。成功结果立即私有存到 R2，下载校验登录及任务归属，保存 7 天；失败返还站内积分。预算计入排队任务与失败任务（保守计费），防止并发超额。预算是应用估算，不能代替百炼账单或账户级限额。

验证：`/api/health` 的 `real_video_configured=true` 表示本地配置完整，**不代表已验证 Key 权限**。首次真实验证需要在网站注册测试账号，由管理员在独立 D1 中给予少量测试积分，再上传有权使用的照片生成。注册不赠送积分、Stripe 未启用时不会出现虚拟充值。

已覆盖模拟 API 的提交、状态轮询、R2 保存、私有下载、权限校验和失败退款；真实付费生成仍需配置 Key 后联调。[Wan 2.1–2.6 首帧图生视频 API 官方文档](https://help.aliyun.com/zh/model-studio/legacy-image-to-video-api-reference/)。

原有 fal 提供商仍可在本地或手工部署中设置 `VIDEO_PROVIDER=fal` 与服务端 `FAL_KEY` 使用；当前 GitHub 自动部署按百炼配置执行。

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
| AI 后台任务 | Python Worker | Cron + 百炼 Wan 异步任务（保留 fal 支持） |
| 模拟视频 | ffmpeg 本地生成 | 关闭（防止误导付费用户） |
| 支付 | Stripe REST Webhook | Stripe REST + WebCrypto 签名校验 |
| SEO | FastAPI 返回页面 | Worker 静态资源 + 注入 metadata |

**不能将旧 SQLite 文件自动当成 D1 数据库使用**。目前 Cloudflare 版通过 migration 初始化 4 个原创模板。独立运行，生产扩张前要完善数据库并发、退款处理、登录验证码和真实第三方集成测试。

Cloudflare 官方文档：[Worker Assets](https://developers.cloudflare.com/workers/static-assets/)、[D1](https://developers.cloudflare.com/d1/get-started/)、[R2](https://developers.cloudflare.com/r2/get-started/)。

