"""All settings come from environment variables (or a .env file next to the repo)."""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def _load_dotenv() -> None:
    env = ROOT / ".env"
    if not env.exists():
        return
    for line in env.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


_load_dotenv()


def _get(name: str, default: str = "") -> str:
    return os.environ.get(name, default).strip()


@dataclass
class Config:
    # Brain: "gemini" (free tier), "claude", or "mock" (offline demo, no keys)
    llm: str = field(default_factory=lambda: _get("G1_LLM", "mock"))
    gemini_key: str = field(default_factory=lambda: _get("GEMINI_API_KEY"))
    gemini_model: str = field(default_factory=lambda: _get("GEMINI_MODEL", "gemini-2.5-flash"))
    anthropic_key: str = field(default_factory=lambda: _get("ANTHROPIC_API_KEY"))
    claude_model: str = field(default_factory=lambda: _get("CLAUDE_MODEL", "claude-sonnet-5-5"))

    owner_name: str = field(default_factory=lambda: _get("G1_OWNER_NAME", "Boss"))
    language: str = field(default_factory=lambda: _get("G1_LANGUAGE", "hinglish"))

    # WhatsApp Cloud API (optional). Without it G1 uses click-to-chat links.
    wa_token: str = field(default_factory=lambda: _get("WHATSAPP_ACCESS_TOKEN"))
    wa_phone_id: str = field(default_factory=lambda: _get("WHATSAPP_PHONE_NUMBER_ID"))

    # 4G modem for SMS (Raspberry Pi dev kit), e.g. /dev/ttyUSB2
    modem_port: str = field(default_factory=lambda: _get("G1_MODEM_PORT"))

    # Voice
    elevenlabs_key: str = field(default_factory=lambda: _get("ELEVENLABS_API_KEY"))
    elevenlabs_voice: str = field(default_factory=lambda: _get("ELEVENLABS_VOICE_ID"))

    # YouTube posting (OAuth refresh token flow)
    yt_client_id: str = field(default_factory=lambda: _get("YOUTUBE_CLIENT_ID"))
    yt_client_secret: str = field(default_factory=lambda: _get("YOUTUBE_CLIENT_SECRET"))
    yt_refresh_token: str = field(default_factory=lambda: _get("YOUTUBE_REFRESH_TOKEN"))

    data_dir: Path = field(default_factory=lambda: Path(_get("G1_DATA_DIR", str(ROOT / "data"))))

    def __post_init__(self) -> None:
        self.data_dir.mkdir(parents=True, exist_ok=True)
        (self.data_dir / "media").mkdir(exist_ok=True)


config = Config()
