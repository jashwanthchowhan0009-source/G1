"""End-to-end tests with the offline (mock) brain. Run: pytest -q"""
from __future__ import annotations

import os
import shutil
import subprocess
import tempfile
from pathlib import Path

import pytest

TMP = tempfile.mkdtemp(prefix="g1test_")
os.environ["G1_DATA_DIR"] = TMP
os.environ["G1_LLM"] = "mock"
for k in ("WHATSAPP_ACCESS_TOKEN", "GEMINI_API_KEY", "ANTHROPIC_API_KEY", "ELEVENLABS_API_KEY", "G1_ACCESS_KEY"):
    os.environ.pop(k, None)

from fastapi.testclient import TestClient  # noqa: E402

from g1.agent import Agent  # noqa: E402
from g1.server import app  # noqa: E402
from g1.skills.messaging import normalize_phone  # noqa: E402


@pytest.fixture()
def agent():
    return Agent()


def test_phone_normalize():
    assert normalize_phone("98765 43210") == "919876543210"
    assert normalize_phone("+91-9876543210") == "919876543210"
    assert normalize_phone("123") is None


def test_whatsapp_needs_confirmation_then_opens_whatsapp(agent):
    agent.handle("s1", "Save Papa's number 9876543210")
    r = agent.handle("s1", "WhatsApp Papa that I'll reach home by 8")
    confirm = [c for c in r.cards if c["type"] == "confirm"]
    assert confirm, r
    assert "Papa" in confirm[0]["summary"]
    # Nothing sent yet: the pending action is waiting
    assert agent.sessions["s1"].pending
    done = agent.handle("s1", "haan")
    links = [c for c in done.cards if c["type"] == "link"]
    assert links and links[0]["url"].startswith("https://wa.me/919876543210?text=I%27ll%20reach")
    assert not agent.sessions["s1"].pending


def test_saying_no_cancels(agent):
    agent.handle("s2", "Save Amma's number 9000000001")
    agent.handle("s2", "WhatsApp Amma that hello")
    r = agent.handle("s2", "nahi")
    assert "cancel" in r.say.lower()
    assert not agent.sessions["s2"].pending


def test_unknown_contact_is_not_invented(agent):
    r = agent.handle("s3", "WhatsApp Ravi that hi")
    agent_s = agent.sessions["s3"]
    pid = list(agent_s.pending)[0]
    done = agent.confirm("s3", pid, True)
    assert "no number" in done.say.lower()


def test_hotel_search_and_booking(agent):
    r = agent.handle("s4", "Find a hotel in Goa for 2 nights")
    urls = [c["url"] for c in r.cards if c["type"] == "link"]
    assert any("booking.com" in u and "ss=Goa" in u for u in urls), urls
    r = agent.handle("s4", "Book a hotel in Goa for 2 nights")
    assert any(c["type"] == "confirm" for c in r.cards)
    done = agent.handle("s4", "yes")
    assert "checkout" in done.say.lower()


def test_train_ticket(agent):
    r = agent.handle("s5", "Book a train from Anantapur to Hyderabad")
    assert any(c["type"] == "confirm" and "Anantapur" in c["summary"] for c in r.cards)


@pytest.mark.skipif(not shutil.which("ffmpeg"), reason="ffmpeg missing")
def test_make_video_then_post_needs_confirmation(agent):
    r = agent.handle("s6", "Make a video about morning habits")
    vids = [c for c in r.cards if c["type"] == "video"]
    assert vids, r
    path = Path(TMP) / "media" / Path(vids[0]["url"]).name
    assert path.exists() and path.stat().st_size > 10_000
    probe = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height",
         "-of", "csv=p=0", str(path)], capture_output=True, text=True)
    assert probe.stdout.strip() == "1080,1920"
    r = agent.handle("s6", "post it")
    assert any(c["type"] == "confirm" for c in r.cards)
    done = agent.handle("s6", "haan")
    assert "youtube not connected" in done.say.lower()  # no keys in tests, but flow works


def test_api_and_access_key():
    c = TestClient(app)
    assert c.get("/").status_code == 200
    s = c.get("/api/status").json()
    risky = {x["name"] for x in s["skills"] if x["risk"] == "confirm"}
    assert {"send_whatsapp", "book_hotel", "book_ticket", "post_video", "send_sms"} <= risky
    r = c.post("/api/chat", json={"session": "api", "text": "what time is it"}).json()
    assert "abhi" in r["say"].lower()
    assert c.get("/media/../../etc/passwd").status_code == 404


def test_core_serves_the_voice_app_and_runs_skills_for_it():
    c = TestClient(app)
    assert "G1" in c.get("/").text
    assert c.get("/js/main.js").status_code == 200          # the voice app's files
    assert "Tap the eye" in c.get("/sim").text               # original simulator kept
    h = c.get("/api/health").json()
    assert h["core"] is True and "create_video" in h["skills"]
    assert h["sim"] is False and h["whatsapp_api"] is False
    # safe skill runs straight away
    r = c.post("/api/skill", json={"name": "search_hotels", "args": {"city": "Goa", "checkin": "2026-12-01", "checkout": "2026-12-03"}}).json()
    assert r["ok"] and "booking.com" in r["results"][0]["url"]
    # send/pay/post skills refuse without the owner's approval
    r = c.post("/api/skill", json={"name": "send_sms", "args": {"to": "9876543210", "message": "hi"}}).json()
    assert r["status"] == "needs_owner_confirmation"
    r = c.post("/api/skill", json={"name": "send_sms", "args": {"to": "9876543210", "message": "hi"}, "approved": True}).json()
    assert r["ok"] is False and "modem" in r["error"]
    assert c.post("/api/skill", json={"name": "nope", "args": {}}).status_code == 404
