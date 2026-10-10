"""All tests run on a throwaway SQLite file, never touch developer data."""
import os
import tempfile
from pathlib import Path

TEST_DIR = Path(tempfile.mkdtemp(prefix="trendmint_tests_"))
os.environ["DATABASE_URL"] = "sqlite:///" + str(TEST_DIR / "test.db")
os.environ["DEMO_MODE"] = "true"
os.environ["APP_ENV"] = "development"
os.environ["SECRET_KEY"] = "test-secret-key-is-long-enough-for-strong-HS256-signing"
os.environ["VIDEO_PROVIDER"] = "demo"
os.environ["YOUTUBE_API_KEY"] = ""
os.environ["STRIPE_SECRET_KEY"] = ""
os.environ["STRIPE_WEBHOOK_SECRET"] = ""

import pytest
from fastapi.testclient import TestClient
from app.main import app

@pytest.fixture
def client():
    with TestClient(app) as c:
        yield c

@pytest.fixture
def demo(client):
    r = client.post("/api/auth/demo")
    assert r.status_code == 200
    token = client.cookies.get("tm_csrf")
    return client, {"X-CSRF-Token": token}

@pytest.fixture
def sample_image():
    from io import BytesIO
    from PIL import Image
    out = BytesIO()
    Image.new("RGB", (360, 420), (155, 91, 220)).save(out, format="JPEG")
    return out.getvalue()
