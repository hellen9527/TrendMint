"""Image normalization, small *genuine* demo MP4, and fal queued video generation.

Demo output is photo motion, NOT AI video. Real mode calls the configured fal model.
"""
from __future__ import annotations
import base64
from io import BytesIO
import shutil
import subprocess
import time
from pathlib import Path
import httpx
from PIL import Image, ImageOps, UnidentifiedImageError
from app.config import settings

MAX_IMAGE_BYTES = 4 * 1024 * 1024


def normalize_image(data: bytes, path: Path) -> None:
    if len(data) > MAX_IMAGE_BYTES or len(data) < 64:
        raise ValueError("图片大小需在 64B～4MB 之间")
    try:
        with Image.open(BytesIO(data)) as image:
            if image.format not in {"JPEG", "PNG", "WEBP"}:
                raise ValueError("仅支持 JPG、PNG、WEBP 图片")
            if image.width < 160 or image.height < 160:
                raise ValueError("图片长宽应至少 160 像素")
            if image.width * image.height > 22_000_000:
                raise ValueError("图片像素过大")
            img = ImageOps.exif_transpose(image)
            img.thumbnail((1024, 1024))
            if img.mode in {"RGBA", "P"}:
                background = Image.new("RGB", img.size, (245, 244, 250))
                rgba = img.convert("RGBA")
                background.paste(rgba, mask=rgba.getchannel("A"))
                img = background
            else:
                img = img.convert("RGB")
            img.save(path, "JPEG", quality=85, optimize=True)
    except (UnidentifiedImageError, OSError) as exc:
        raise ValueError("图片文件无法识别") from exc


def render_demo_video(source: Path, destination: Path) -> None:
    """Deliberately non-AI demo: a genuine short animated MP4 with a watermark."""
    if not shutil.which("ffmpeg"):
        raise RuntimeError("演示视频需要安装 ffmpeg。可使用 Docker 运行，或系统中安装 ffmpeg")
    vf = ("scale=480:854:force_original_aspect_ratio=increase,"
          "crop=480:854,zoompan=z='min(zoom+0.0015,1.14)':d=1:s=480x854:fps=15,"
          "drawbox=x=0:y=0:w=iw:h=46:color=black@0.58:t=fill,"
          "drawtext=text='DEMO PHOTO MOTION - NOT AI':fontsize=17:fontcolor=white:x=(w-text_w)/2:y=13,"
          "format=yuv420p")
    command = ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
               "-loop", "1", "-framerate", "15", "-i", str(source),
               "-t", "3", "-vf", vf, "-c:v", "libx264", "-preset", "ultrafast",
               "-pix_fmt", "yuv420p", "-movflags", "+faststart", str(destination)]
    try:
        subprocess.run(command, capture_output=True, text=True, check=True, timeout=60)
    except subprocess.CalledProcessError as exc:
        raise RuntimeError("演示视频转换失败: " + (exc.stderr or "")[-240:]) from exc


def fal_generate_video(source: Path, prompt: str, model: str | None = None) -> tuple[str, str]:
    """Fal queue REST: submit -> poll -> fetch. Source JPEG as data URI to avoid public photo URLs.

    Model defaults to Kling 2.5 standard i2v 5-second endpoint. Some providers can
    reject inline data URIs; if so, use fal's supported storage upload API.
    """
    if not settings.fal_key:
        raise RuntimeError("未配置 FAL_KEY")
    model = model or settings.fal_model_id
    if not model.startswith("fal-ai/") or ".." in model:
        raise RuntimeError("模型路径不合法")
    source_b64 = base64.b64encode(source.read_bytes()).decode("ascii")
    image_url = "data:image/jpeg;base64," + source_b64
    headers = {"Authorization": f"Key {settings.fal_key}", "Content-Type": "application/json"}
    base = "https://queue.fal.run/" + model
    with httpx.Client(timeout=45, follow_redirects=False) as client:
        submitted = client.post(base, headers=headers, json={"prompt": prompt, "image_url": image_url, "duration": "5"})
        submitted.raise_for_status()
        request_id = submitted.json().get("request_id")
        if not request_id or not isinstance(request_id, str):
            raise RuntimeError("fal 没有返回 request_id")
        status_url = submitted.json().get("status_url") or f"{base}/requests/{request_id}/status"
        response_url = submitted.json().get("response_url") or f"{base}/requests/{request_id}"
        if not status_url.startswith(base) or not response_url.startswith(base):
            raise RuntimeError("fal 返回了不可信的任务地址")
        for _ in range(120):
            time.sleep(5)
            response = client.get(status_url, headers=headers)
            response.raise_for_status()
            status = response.json().get("status")
            if status == "COMPLETED":
                result = client.get(response_url, headers=headers)
                result.raise_for_status()
                data = result.json()
                url = (data.get("video") or {}).get("url", "")
                if not url.startswith("https://"):
                    raise RuntimeError("fal 未返回有效视频地址")
                return url, request_id
            if status in {"FAILED", "CANCELLED"}:
                raise RuntimeError(f"视频生成失败: {status}")
        raise RuntimeError("视频生成超过 10 分钟，请检查 fal 控制台和任务状态")
