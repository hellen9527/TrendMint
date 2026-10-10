# TrendMint — 五分钟启动

**第一版已经可以本地运行，演示模式不需要购买模型额度。**

## Windows

1. 安装 Python 3.11 及以上版本、ffmpeg，并把两者加到环境变量 PATH（如果不想安装 ffmpeg，可使用下方 Docker 方式）。
2. 解压项目到不包含特殊权限限制的目录。
3. 双击 `start_windows.bat`。第一次运行会安装 Python 依赖。
4. 打开浏览器：`http://127.0.0.1:8000`。
5. 点击「免费体验演示」进入管理员工作台。

## Mac / Linux

```bash
cp .env.example .env
python3 -m pip install -r requirements.txt
python3 run.py
```

访问 `http://127.0.0.1:8000`。

## Docker（可选）

```bash
cp .env.example .env
docker compose up --build -d
```

浏览器打开 `http://127.0.0.1:8000`。

## 建议第一个操作顺序

1. **热点雷达**：查看示例候选；点「添加关键词」创建自己的机会；点「下载日报」导出 Markdown。
2. **创作工坊**：点「发布新模板」，输入名称、英文 URL 标识、英文/中文介绍、AI Prompt 和积分价格。
3. **创作工坊**：选模板，上传一张你拥有使用权的图片，确认授权并生成。
4. **我的任务**：等待 3 秒演示 MP4 完成，下载、核对结果；积分从 24 减为 18。
5. **积分与支付**：点击「演示充值」，验证积分流水与余额，不发生真实收款。
6. **系统设置**：可以上架/下架刚发布的模板。

### 说明

- 演示视频是 ffmpeg 照片轻动，**不是**真正的 AI 视频，视频有明确 `DEMO ... NOT AI` 水印。
- 接入真视频请配置 `.env` 的 `FAL_KEY` 和 `VIDEO_PROVIDER=fal`。
- YouTube 数据采集需要 `YOUTUBE_API_KEY`；未接入时看到的演示候选均清楚标记「示例」。
- Stripe 需要商户主体、Secret Key、Webhook Secret，并走 Stripe 测试模式验证。没有密钥，定价页按钮不会收钱。
- 对外正式发布前，请按照 `docs/RELEASE_CHECKLIST.md` 完成支付、反滥用、内容授权、隐私、邮箱验证、海外英文界面和模型真实计费测试。

完整架构与所有配置：`README.md`；商业工作流：`docs/30_DAY_LAUNCH_CN.md`。
