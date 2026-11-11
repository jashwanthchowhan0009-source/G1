"""Make a short vertical video (script -> voice -> slides -> mp4) and post it.

create_video is safe (it only makes a file). post_video needs the owner's "yes".
Voice: ElevenLabs if a key is set, else offline espeak-ng.
"""
from __future__ import annotations

import json
import shutil
import subprocess
import textwrap
import time
import uuid
from pathlib import Path
from typing import Any

import httpx

from ..config import config
from . import skill

W, H = 1080, 1920
BG = [(16, 16, 20), (34, 20, 12), (12, 24, 30), (24, 14, 30)]
ACCENT = (240, 140, 40)  # tiger orange


def _font(size: int):
    from PIL import ImageFont

    for p in (
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
        "C:/Windows/Fonts/arialbd.ttf",
    ):
        if Path(p).exists():
            return ImageFont.truetype(p, size)
    return ImageFont.load_default()


def _slide(text: str, idx: int, total: int, title: str, out: Path) -> None:
    from PIL import Image, ImageDraw

    img = Image.new("RGB", (W, H), BG[idx % len(BG)])
    d = ImageDraw.Draw(img)
    d.rectangle([0, 0, W, 14], fill=ACCENT)
    d.text((80, 140), title.upper()[:40], font=_font(44), fill=ACCENT)
    lines = textwrap.wrap(text, width=18)[:8]
    f = _font(84)
    y = H // 2 - len(lines) * 55
    for line in lines:
        w = d.textlength(line, font=f)
        d.text(((W - w) / 2, y), line, font=f, fill=(245, 245, 245))
        y += 110
    # progress dots
    for i in range(total):
        x = W // 2 - total * 22 + i * 44
        d.ellipse([x, H - 200, x + 20, H - 180], fill=ACCENT if i == idx else (90, 90, 90))
    d.text((80, H - 120), "made with G1", font=_font(36), fill=(150, 150, 150))
    img.save(out)


def _tts(text: str, lang: str, out: Path) -> None:
    if config.elevenlabs_key and config.elevenlabs_voice:
        r = httpx.post(
            f"https://api.elevenlabs.io/v1/text-to-speech/{config.elevenlabs_voice}?output_format=mp3_44100_128",
            headers={"xi-api-key": config.elevenlabs_key},
            json={"text": text, "model_id": "eleven_multilingual_v2"},
            timeout=60,
        )
        if r.status_code < 300:
            mp3 = out.with_suffix(".mp3")
            mp3.write_bytes(r.content)
            subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(mp3), str(out)], check=True)
            return
    voice = {"hindi": "hi", "telugu": "te", "tamil": "ta"}.get(lang, "en-in")
    if shutil.which("espeak-ng"):
        subprocess.run(["espeak-ng", "-v", voice, "-s", "155", "-w", str(out), text], check=True)
    else:  # silent fallback so video still renders
        secs = max(2.0, len(text.split()) / 2.5)
        subprocess.run(
            ["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "anullsrc=r=22050:cl=mono", "-t", str(secs), str(out)],
            check=True,
        )


@skill(
    "create_video",
    "Make a short vertical video (Reels/Shorts) from a script. Write 3-6 short scenes yourself.",
    {
        "type": "object",
        "properties": {
            "title": {"type": "string"},
            "scenes": {"type": "array", "items": {"type": "string"}, "description": "One short sentence per scene"},
            "language": {"type": "string", "enum": ["english", "hindi", "telugu", "tamil"]},
        },
        "required": ["title", "scenes"],
    },
)
def create_video(title: str, scenes: list[str], language: str = "english") -> dict[str, Any]:
    scenes = [s.strip() for s in scenes if s and s.strip()][:8]
    if not scenes:
        return {"ok": False, "error": "no scenes"}
    vid = uuid.uuid4().hex[:8]
    work = config.data_dir / "media" / f"work_{vid}"
    work.mkdir(parents=True)
    parts = []
    for i, text in enumerate(scenes):
        png, wav, mp4 = work / f"{i}.png", work / f"{i}.wav", work / f"{i}.mp4"
        _slide(text, i, len(scenes), title, png)
        _tts(text, language, wav)
        subprocess.run(
            ["ffmpeg", "-v", "error", "-y", "-loop", "1", "-i", str(png), "-i", str(wav),
             "-af", "apad=pad_dur=0.6", "-shortest", "-c:v", "libx264", "-preset", "veryfast",
             "-tune", "stillimage", "-pix_fmt", "yuv420p", "-r", "30", "-c:a", "aac", "-ar", "44100", "-ac", "2",
             str(mp4)],
            check=True,
        )
        parts.append(mp4)
    listing = work / "list.txt"
    listing.write_text("".join(f"file '{p.name}'\n" for p in parts))
    final = config.data_dir / "media" / f"g1_{vid}.mp4"
    subprocess.run(
        ["ffmpeg", "-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", str(listing), "-c", "copy",
         "-movflags", "+faststart", str(final)],
        check=True,
    )
    shutil.rmtree(work, ignore_errors=True)
    meta = {"title": title, "scenes": scenes, "created": time.time()}
    final.with_suffix(".json").write_text(json.dumps(meta, ensure_ascii=False))
    return {"ok": True, "video_id": final.stem, "file": f"/media/{final.name}", "scenes": len(scenes)}


def _yt_access_token() -> str | None:
    if not (config.yt_client_id and config.yt_client_secret and config.yt_refresh_token):
        return None
    r = httpx.post(
        "https://oauth2.googleapis.com/token",
        data={
            "client_id": config.yt_client_id,
            "client_secret": config.yt_client_secret,
            "refresh_token": config.yt_refresh_token,
            "grant_type": "refresh_token",
        },
        timeout=20,
    )
    return r.json().get("access_token") if r.status_code < 300 else None


@skill(
    "post_video",
    "Publish a video G1 made to the owner's YouTube (Shorts). Needs confirmation.",
    {
        "type": "object",
        "properties": {
            "video_id": {"type": "string", "description": "From create_video"},
            "caption": {"type": "string"},
            "visibility": {"type": "string", "enum": ["public", "unlisted", "private"]},
        },
        "required": ["video_id", "caption"],
    },
    risk="confirm",
    summarize=lambda a: f"Post video {a.get('video_id')} to YouTube ({a.get('visibility', 'private')}): “{a.get('caption')}”",
)
def post_video(video_id: str, caption: str, visibility: str = "private") -> dict[str, Any]:
    path = config.data_dir / "media" / f"{video_id}.mp4"
    if not path.exists():
        return {"ok": False, "error": "video not found"}
    token = _yt_access_token()
    if not token:
        return {
            "ok": False,
            "error": "YouTube not connected yet (set YOUTUBE_CLIENT_ID/SECRET/REFRESH_TOKEN)",
            "file": f"/media/{path.name}",
        }
    meta = {
        "snippet": {"title": caption[:95] + " #Shorts", "description": caption, "categoryId": "22"},
        "status": {"privacyStatus": visibility, "selfDeclaredMadeForKids": False},
    }
    init = httpx.post(
        "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status",
        headers={"Authorization": f"Bearer {token}", "X-Upload-Content-Type": "video/mp4"},
        json=meta,
        timeout=30,
    )
    upload_url = init.headers.get("location")
    if not upload_url:
        return {"ok": False, "error": f"YouTube init failed: {init.status_code}"}
    up = httpx.put(upload_url, content=path.read_bytes(), headers={"Content-Type": "video/mp4"}, timeout=300)
    if up.status_code >= 300:
        return {"ok": False, "error": f"upload failed: {up.status_code}"}
    yid = up.json().get("id")
    return {"ok": True, "url": f"https://youtube.com/shorts/{yid}", "visibility": visibility}
