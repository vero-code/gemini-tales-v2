import logging
import os
from dotenv import load_dotenv
from typing import Optional
from pydantic import BaseModel
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from opentelemetry import trace
from opentelemetry.exporter.cloud_trace import CloudTraceSpanExporter
from opentelemetry.sdk.trace import TracerProvider, export

# Import routers
from app.routers.avatar import router as avatar_router
from app.routers.proxy import router as proxy_router
from app.routers.search import router as search_router

load_dotenv()

class Feedback(BaseModel):
    score: float
    text: str | None = None
    run_id: str | None = None
    user_id: str | None = None

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# OpenTelemetry configuration
provider = TracerProvider()
processor = export.BatchSpanProcessor(
    CloudTraceSpanExporter(),
)
provider.add_span_processor(processor)
trace.set_tracer_provider(provider)

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include routers
app.include_router(avatar_router, prefix="/api/avatar", tags=["avatar"])
app.include_router(proxy_router, prefix="/ws", tags=["proxy"])
app.include_router(search_router, prefix="/ws", tags=["search"])

# MOUNT STATIC FILES
# Mount avatars directory
avatar_dir = os.path.join(os.path.dirname(__file__), "temp_avatars")
os.makedirs(avatar_dir, exist_ok=True)
app.mount("/avatars", StaticFiles(directory=avatar_dir), name="avatars")

# Use 'dist' folder for React production build (built in Docker stage)
frontend_path = os.path.join(os.path.dirname(__file__), "..", "..", "frontend", "dist")
if os.path.exists(frontend_path):
    app.mount("/", StaticFiles(directory=frontend_path, html=True), name="frontend")
else:
    logger.warning(f"Frontend dist directory not found at {frontend_path}")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=int(os.getenv("PORT", 8000)))
