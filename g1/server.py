"""G1 Core server: the brain the device (or the browser simulator) talks to.

Run:  python -m g1.server            -> http://127.0.0.1:8700
"""
from __future__ import annotations

import argparse
import hmac
import os
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from . import __version__
from .agent import Agent
from .config import config
from .skills import REGISTRY
from .skills.basics import due_reminders

WEB = Path(__file__).parent / "web"
APP = Path(__file__).resolve().parent.parent / "public"  # the G1 voice app (same one that runs on a phone)
ACCESS_KEY = os.environ.get("G1_ACCESS_KEY", "")

app = FastAPI(title="G1 Core", version=__version__)
agent = Agent()


@app.middleware("http")
async def access_key(request: Request, call_next):
    # When G1 is reachable over the network, every API call needs the device key
    if ACCESS_KEY and request.url.path.startswith("/api/"):
        given = request.headers.get("x-g1-key") or request.query_params.get("key") or ""
        if not hmac.compare_digest(given, ACCESS_KEY):
            return JSONResponse({"error": "unauthorized"}, status_code=401)
    return await call_next(request)


class ChatIn(BaseModel):
    session: str = Field(default="device", max_length=64)
    text: str = Field(max_length=2000)


class ConfirmIn(BaseModel):
    session: str = Field(default="device", max_length=64)
    id: str = Field(max_length=32)
    approve: bool


class SkillIn(BaseModel):
    name: str = Field(max_length=64)
    args: dict = Field(default_factory=dict)
    approved: bool = False


@app.get("/")
def index():
    # The G1 voice app is the main screen; the original simulator stays at /sim
    return FileResponse(APP / "index.html" if (APP / "index.html").exists() else WEB / "index.html")


@app.get("/sim")
def simulator():
    return FileResponse(WEB / "index.html")


@app.get("/api/health")
def health():
    """Tells the G1 voice app that a Core is behind it, and what the Core can do."""
    return {
        "ok": True,
        "core": True,
        "llm": False,
        "tts": False,
        "locked": bool(ACCESS_KEY),
        "sim": bool(config.modem_port),
        "whatsapp_api": bool(config.wa_token and config.wa_phone_id),
        "youtube": bool(config.yt_client_id and config.yt_client_secret and config.yt_refresh_token),
        "skills": sorted(REGISTRY),
    }


@app.post("/api/skill")
def run_skill(body: SkillIn):
    """Run one Core skill for the G1 voice app.

    The app's own brain asks the owner first; a send/pay/post skill still refuses
    here unless the request says the owner approved it.
    """
    sk = REGISTRY.get(body.name)
    if not sk:
        raise HTTPException(404, "unknown skill")
    if sk.risk == "confirm" and not body.approved:
        return {"ok": False, "status": "needs_owner_confirmation", "summary": sk.summary(body.args)}
    return Agent._run(body.name, body.args)


@app.get("/api/status")
def status():
    return {
        "version": __version__,
        "brain": type(agent.llm).__name__,
        "owner": config.owner_name,
        "skills": [{"name": s.name, "risk": s.risk} for s in REGISTRY.values()],
    }


@app.post("/api/chat")
def chat(body: ChatIn):
    return agent.handle(body.session, body.text).to_dict()


@app.post("/api/confirm")
def confirm(body: ConfirmIn):
    return agent.confirm(body.session, body.id, body.approve).to_dict()


@app.get("/api/events")
def events():
    return {"reminders": due_reminders()}


@app.get("/media/{name}")
def media(name: str):
    path = (config.data_dir / "media" / name).resolve()
    if path.parent != (config.data_dir / "media").resolve() or not path.exists():
        raise HTTPException(404)
    return FileResponse(path)


app.mount("/static", StaticFiles(directory=WEB), name="static")
if APP.exists():  # js, css, fonts, icons of the voice app; must be mounted last
    app.mount("/", StaticFiles(directory=APP), name="app")


def main() -> None:
    import uvicorn

    ap = argparse.ArgumentParser()
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=8700)
    a = ap.parse_args()
    if a.host not in ("127.0.0.1", "localhost") and not ACCESS_KEY:
        raise SystemExit("Set G1_ACCESS_KEY before exposing G1 on the network.")
    print(f"🐯 G1 Core {__version__} | brain: {type(agent.llm).__name__} | http://{a.host}:{a.port}")
    uvicorn.run(app, host=a.host, port=a.port, log_level="warning")


if __name__ == "__main__":
    main()
