# 把 TrendMint 部署到 fategenie.com 的最短操作

原网站不动，TrendMint 使用独立 Worker：`trendmint.fategenie.com`。

## 第 1 步：Cloudflare 权限保存到 GitHub

先阅读 [`cloudflare/README_CN.md`](cloudflare/README_CN.md) 中 **“最少操作部署”**。

到 GitHub 仓库 `Settings → Secrets and variables → Actions` 配置三个 **Repository secrets**：

- `CLOUDFLARE_API_TOKEN`（必须具有 Workers Scripts Edit / D1 Edit / R2 Storage Write 等相应权限）
- `CLOUDFLARE_ACCOUNT_ID`（32 位账户 ID）
- `TRENDMINT_SESSION_SECRET`（32 位以上随机字符串）

**请勿把密钥发到聊天、提交代码或加入 zip。** 如果要让工作流自动绑定子域名，在 **Repository variables** 设置 `TRENDMINT_CUSTOM_DOMAIN=true`，确保该子域名没有已存在的冲突用途。

## 第 2 步：推送代码

1. 下载并解压本次完整源码包。
2. Windows 双击 `publish_to_github_windows.bat`；Mac/Linux 在项目根目录运行 `python3 publish_to_github.py`。
3. 如果 Git 要求登录，请使用你的 GitHub 凭据/凭证管理器进行正常登录。脚本不会接触 Cloudflare 的 API Token。
4. 程序将代码合并到仓库最新 `main`，不会强制覆盖 Git 历史。

查看：<https://github.com/hellen9527/TrendMint>

## 第 3 步：确认部署

访问 GitHub 仓库的 <https://github.com/hellen9527/TrendMint/actions> 页面，查看 **Cloudflare Deploy** 绿色通过；期间会自动创建/复用 D1 和 R2。若 R2 首次启用需要账户级确认，请回到 Cloudflare 控制台完成。

完成后检查：

- <https://trendmint.fategenie.com/>
- <https://trendmint.fategenie.com/api/health>

如果没有设置绑定域名，请先查看 Cloudflare Workers 页面显示的 `workers.dev` 预览 URL。

## 部署边界

不能在没有 Cloudflare 授权时代表你的账号创建资源或改 DNS。默认不启用付费、不启用真实 AI 模型。fal.ai、Stripe 和 YouTube 等需要在安全登录后分阶段配置、联调。
