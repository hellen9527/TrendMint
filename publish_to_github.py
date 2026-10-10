#!/usr/bin/env python3
"""Upload TrendMint to the user's existing GitHub repo without force-pushing.

Run once from an extracted release with Python >= 3.9 and Git installed.
GitHub authentication is handled only by the user's own Git credential manager.
"""
from pathlib import Path
import subprocess
import shutil
import tempfile
import sys

REPOSITORY = "https://github.com/hellen9527/TrendMint.git"
SOURCE = Path(__file__).resolve().parent
IGNORED_DIRS = {".git", "node_modules", "__pycache__", ".pytest_cache", ".wrangler", ".test-build", ".venv", "venv", ".next"}
IGNORED_NAMES = {".env", ".dev.vars", "wrangler.generated.json", ".DS_Store"}
IGNORED_SUFFIXES = {".pyc", ".db", ".db-shm", ".db-wal", ".mp4", ".zip", ".bundle"}


def cmd(*args, cwd=None):
    print("$", " ".join(args[:3]), "..." if len(args)>3 else "")
    subprocess.run(args, cwd=cwd, check=True)


def allowed(rel: Path) -> bool:
    if any(p in IGNORED_DIRS for p in rel.parts):
        return False
    if rel.name in IGNORED_NAMES or rel.suffix in IGNORED_SUFFIXES:
        return False
    if rel.parts[0] in {"data", "generated"} and rel.name != ".gitkeep":
        return False
    if rel.parts[0] == "cloudflare" and (rel.name.startswith(".dev.vars") and rel.name != ".dev.vars.example" or rel.parts[-1]=="wrangler.generated.json"):
        return False
    return True


def main():
    if not shutil.which("git"):
        sys.exit("Git 未安装，请先安装 https://git-scm.com/downloads")
    with tempfile.TemporaryDirectory(prefix="trendmint-publish-") as directory:
        target = Path(directory)/"repo"
        cmd("git", "clone", "--branch", "main", "--single-branch", REPOSITORY, str(target))
        count=0
        for file in SOURCE.rglob("*"):
            if not file.is_file():
                continue
            rel=file.relative_to(SOURCE)
            if not allowed(rel):
                continue
            dest=target/rel
            dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(file, dest)
            count+=1
        cmd("git", "add", "-A", cwd=target)
        changes=subprocess.run(["git","diff","--cached","--quiet"],cwd=target)
        if changes.returncode==0:
            print("没有代码变化，仓库已经是最新版本。")
            return
        if changes.returncode!=1:
            raise RuntimeError("Unable to examine Git staged changes")
        print(f"即将提交 {count} 个项目文件到 {REPOSITORY}，保留现有提交历史。")
        cmd("git", "commit", "-m", "Deploy TrendMint Cloudflare app and automation", cwd=target)
        cmd("git", "push", "origin", "main", cwd=target)
        print("已推送到 https://github.com/hellen9527/TrendMint")
        print("请在 GitHub Actions → Cloudflare Deploy 查看部署状态。")


if __name__=="__main__":
    try: main()
    except subprocess.CalledProcessError as e:
        sys.exit(f"Git 操作失败（{e.returncode}），请检查登录与仓库写权限。")
