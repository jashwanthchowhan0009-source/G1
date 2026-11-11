"""LLM providers behind one tiny interface.

Internal message format (provider-neutral):
  {"role": "user", "text": "..."}
  {"role": "assistant", "text": "...", "tool_calls": [{"id", "name", "args"}]}
  {"role": "tool", "results": [{"id", "name", "result"}]}
"""
from __future__ import annotations

import json
import re
import uuid
from dataclasses import dataclass, field
from datetime import timedelta
from typing import Any

import httpx

from .config import config


@dataclass
class LLMReply:
    text: str = ""
    tool_calls: list[dict[str, Any]] = field(default_factory=list)


def _merge(items: list[dict[str, Any]], key: str) -> list[dict[str, Any]]:
    """Merge consecutive messages with the same role (APIs want alternation)."""
    out: list[dict[str, Any]] = []
    for it in items:
        if out and out[-1]["role"] == it["role"]:
            out[-1][key] = out[-1][key] + it[key]
        else:
            out.append(it)
    return out


# ---------------------------------------------------------------- Gemini
class Gemini:
    def generate(self, system: str, history: list[dict], tools: list[dict]) -> LLMReply:
        contents = []
        for m in history:
            if m["role"] == "user":
                contents.append({"role": "user", "parts": [{"text": m["text"]}]})
            elif m["role"] == "assistant":
                parts = [{"text": m["text"]}] if m.get("text") else []
                parts += [{"functionCall": {"name": c["name"], "args": c["args"]}} for c in m.get("tool_calls", [])]
                contents.append({"role": "model", "parts": parts or [{"text": ""}]})
            else:
                contents.append({
                    "role": "user",
                    "parts": [{"functionResponse": {"name": r["name"], "response": r["result"]}} for r in m["results"]],
                })
        body = {
            "systemInstruction": {"parts": [{"text": system}]},
            "contents": _merge(contents, "parts"),
            "tools": [{"functionDeclarations": tools}],
            "generationConfig": {"temperature": 0.4, "maxOutputTokens": 1200},
        }
        r = httpx.post(
            f"https://generativelanguage.googleapis.com/v1beta/models/{config.gemini_model}:generateContent",
            headers={"x-goog-api-key": config.gemini_key},
            json=body,
            timeout=60,
        )
        r.raise_for_status()
        parts = (r.json().get("candidates") or [{}])[0].get("content", {}).get("parts", [])
        reply = LLMReply()
        for p in parts:
            if "text" in p:
                reply.text += p["text"]
            if "functionCall" in p:
                fc = p["functionCall"]
                reply.tool_calls.append({"id": uuid.uuid4().hex[:8], "name": fc["name"], "args": fc.get("args", {})})
        return reply


# ---------------------------------------------------------------- Claude
class Claude:
    def generate(self, system: str, history: list[dict], tools: list[dict]) -> LLMReply:
        msgs = []
        for m in history:
            if m["role"] == "user":
                msgs.append({"role": "user", "content": [{"type": "text", "text": m["text"]}]})
            elif m["role"] == "assistant":
                blocks = [{"type": "text", "text": m["text"]}] if m.get("text") else []
                blocks += [{"type": "tool_use", "id": c["id"], "name": c["name"], "input": c["args"]}
                           for c in m.get("tool_calls", [])]
                msgs.append({"role": "assistant", "content": blocks or [{"type": "text", "text": "…"}]})
            else:
                msgs.append({"role": "user", "content": [
                    {"type": "tool_result", "tool_use_id": r["id"], "content": json.dumps(r["result"], ensure_ascii=False)}
                    for r in m["results"]
                ]})
        r = httpx.post(
            "https://api.anthropic.com/v1/messages",
            headers={"x-api-key": config.anthropic_key, "anthropic-version": "2023-06-01"},
            json={
                "model": config.claude_model,
                "max_tokens": 1200,
                "system": system,
                "messages": _merge(msgs, "content"),
                "tools": [{"name": t["name"], "description": t["description"], "input_schema": t["parameters"]}
                          for t in tools],
            },
            timeout=60,
        )
        r.raise_for_status()
        reply = LLMReply()
        for b in r.json().get("content", []):
            if b["type"] == "text":
                reply.text += b["text"]
            elif b["type"] == "tool_use":
                reply.tool_calls.append({"id": b["id"], "name": b["name"], "args": b.get("input", {})})
        return reply


# ---------------------------------------------------------------- Mock
class Mock:
    """Offline brain for demos and tests: understands a few fixed phrasings."""

    def generate(self, system: str, history: list[dict], tools: list[dict]) -> LLMReply:
        from .skills.basics import now_ist

        last = history[-1]
        if last["role"] == "tool":
            r = last["results"][0]
            res = r["result"]
            if res.get("status") == "needs_owner_confirmation":
                return LLMReply(f"{res['summary']} — confirm karoon? Bolo 'haan' ya 'nahi'.")
            if not res.get("ok"):
                return LLMReply(f"Ek dikkat aayi: {res.get('error')}")
            return LLMReply({
                "save_contact": f"Saved ✅ {res.get('name')}",
                "set_reminder": f"Done ✅ {res.get('at_spoken')} ko yaad dila dunga.",
                "create_video": f"Video ready 🎬 ({res.get('scenes')} scenes). Post karoon?",
                "search_hotels": "Yeh rahe options, screen pe dekho 👇",
                "search_travel": "Yeh rahe options, screen pe dekho 👇",
                "get_time": f"Abhi {res.get('spoken')} hai.",
                "take_note": "Note save kar liya ✍️",
            }.get(r["name"], "Ho gaya ✅"))

        t = last["text"].strip()
        low = t.lower()
        today = now_ist().date()
        call = lambda _tool, **args: LLMReply(tool_calls=[{"id": uuid.uuid4().hex[:8], "name": _tool, "args": args}])  # noqa: E731

        if m := re.search(r"save (\w+)(?:'s)? (?:number|no\.?)\s*(?:is\s*)?([\d +-]{10,})", low):
            return call("save_contact", name=m.group(1).title(), phone=m.group(2))
        if m := re.search(r"(?:whatsapp|message)\s+(?:to\s+)?(\w+)\s*(?:that|saying|:|ki|-)\s*(.+)", t, re.I):
            return call("send_whatsapp", to=m.group(1), message=m.group(2).strip())
        if m := re.search(r"hotel.*?\bin\s+([a-z ]+?)(?:\s+(?:for|tomorrow|today|from)\b|$)", low):
            start = today + timedelta(days=0 if "today" in low else 1)
            n = int(nm.group(1)) if (nm := re.search(r"(\d+)\s*night", low)) else 1
            name = "book_hotel" if "book" in low else "search_hotels"
            return call(name, city=m.group(1).strip().title(), checkin=start.isoformat(),
                        checkout=(start + timedelta(days=n)).isoformat(), guests=2)
        if m := re.search(r"(flight|train|bus).*?from\s+(\w+)\s+to\s+(\w+)", low):
            d = today + timedelta(days=1)
            name = "book_ticket" if "book" in low else "search_travel"
            return call(name, mode=m.group(1), from_city=m.group(2).title(), to_city=m.group(3).title(), date=d.isoformat())
        if m := re.search(r"video (?:about|on)\s+(.+)", low):
            topic = m.group(1).strip().rstrip(".")
            return call("create_video", title=topic.title(), scenes=[
                f"Let's talk about {topic}.",
                f"Here is the one thing most people miss about {topic}.",
                "Start small, stay consistent, and keep learning.",
                "Follow for more. Made with G1.",
            ])
        if m := re.search(r"post (?:it|the video|video)", low):
            vids = sorted((config.data_dir / "media").glob("g1_*.mp4"), key=lambda p: p.stat().st_mtime)
            if vids:
                return call("post_video", video_id=vids[-1].stem, caption="New video made with G1", visibility="private")
            return LLMReply("Pehle ek video banate hain. Bolo: 'make a video about ...'")
        if m := re.search(r"remind me (?:to\s+)?(.+?)\s+in\s+(\d+)\s*(minute|min|hour)", low):
            mins = int(m.group(2)) * (60 if m.group(3).startswith("hour") else 1)
            return call("set_reminder", text=m.group(1), at=(now_ist() + timedelta(minutes=mins)).isoformat())
        if "time" in low or "samay" in low or "baje" in low:
            return call("get_time")
        if low.startswith(("note", "yaad rakh")):
            return call("take_note", text=t.split(" ", 1)[-1])
        return LLMReply("Main G1 hoon 🐯 Bolo: WhatsApp bhejna, hotel/ticket, video banana, reminder… sab kar sakta hoon.")


def get_llm():
    if config.llm == "gemini" and config.gemini_key:
        return Gemini()
    if config.llm == "claude" and config.anthropic_key:
        return Claude()
    return Mock()
