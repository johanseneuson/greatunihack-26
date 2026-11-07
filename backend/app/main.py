import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse

from .config import settings
from .db import init_db
from .routers import chat, data, insights, users, voice
from .seed import seed_safely

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")


@asynccontextmanager
async def lifespan(_: FastAPI):
    init_db()
    if settings.seed_demo_users:
        seed_safely()
    voice.warm_up()  # first ElevenLabs request is slow; do it now so the first call greeting is quick
    yield


app = FastAPI(
    title="NatEast API",
    version="0.1.0",
    description=(
        "Personalised budgeting and **financial time travel**: upload statements or link a bank, "
        "then see your likely future balance, upcoming spending waves and early warnings for hardship "
        "or unexpected costs - each with a positive, concrete next step."
    ),
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in settings.cors_origins.split(",")],
    allow_methods=["*"],
    allow_headers=["*"],
)

for r in (users.router, data.router, insights.router, chat.router, voice.router):
    app.include_router(r, prefix="/api")


@app.get("/api/health", tags=["meta"])
def health():
    return {"status": "ok"}


@app.get("/", include_in_schema=False)
def root():
    return RedirectResponse("/docs")
