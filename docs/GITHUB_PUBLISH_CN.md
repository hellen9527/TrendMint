# 将 TrendMint 发布到 GitHub 私有仓库

连接 GitHub 插件并不自动创建代码仓库。首次发布时建议使用私人仓库，避免公开内部尚未完成的支付与模型集成。

## 方法 A：创建空仓库后交由 ChatGPT 提交

1. 打开 https://github.com/new 。
2. Repository name 输入 `trendmint`（如果被占用，用 `trendmint-mvp`）。
3. Repository visibility 选择 **Private**。
4. **不要**勾选自动添加 README、.gitignore、License（本项目已有 README 和 .gitignore）。
5. 点击 **Create repository**。
6. 回到 ChatGPT，发送刚刚创建的仓库链接，并说明“把 TrendMint 项目提交到这个私有仓库”。

ChatGPT 的 GitHub 连接支持向有写权限的现有仓库创建文件/树/提交，但连接本身目前不提供新建仓库的接口，因此这个步骤需要你自己在 GitHub 创建。

## 方法 B：在本机用 git 推送

如果你使用 ZIP 源码包：

```bash
cd trendmint
git init -b main
git add .
git commit -m "feat: initial TrendMint MVP"
git remote add origin https://github.com/<你的用户名>/trendmint.git
git push -u origin main
```

如果你使用随项目交付的 `trendmint-initial.bundle`：

```bash
git clone trendmint-initial.bundle trendmint
cd trendmint
git remote remove origin 2>/dev/null || true
git remote add origin https://github.com/<你的用户名>/trendmint.git
git push -u origin main
```

**确认安全**：项目忽略 `.env`、数据库、生成的视频和上传照片。API 密钥只放 `.env` 或部署平台的机密变量，不应复制到 GitHub Issues 或聊天中。

## 后续 CI

代码提交后，GitHub Actions 中的 `TrendMint CI` 会自动运行 Python 3.12/3.13 测试、前端 JS 语法检查及文件泄露检查。是否运行取决于仓库 Actions 的启用状态及账户权限。

## 下一步发布前的审查

查看 `docs/RELEASE_CHECKLIST.md`。支付和真实 AI 接口必须用你自己的测试密钥联调成功后，才能开始接收客户付款。
