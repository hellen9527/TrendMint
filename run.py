"""Single-command local development: HTTP server and worker in one process."""
import logging
import os
from threading import Thread
import uvicorn
from app.worker import loop

if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    Thread(target=loop, daemon=True, name="trendmint-worker").start()
    uvicorn.run("app.main:app", host="127.0.0.1", port=int(os.getenv("PORT", "8000")), log_level="info")
