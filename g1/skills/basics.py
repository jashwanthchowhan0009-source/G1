"""Everyday skills: time, reminders, notes, contacts."""
from __future__ import annotations

import json
import threading
from datetime import datetime, timedelta, timezone
from typing import Any

from ..config import config
from . import skill

IST = timezone(timedelta(hours=5, minutes=30))
_lock = threading.Lock()


def _store(name: str) -> Any:
    path = config.data_dir / f"{name}.json"
    if not path.exists():
        return [] if name != "contacts" else {}
    return json.loads(path.read_text() or "null") or ([] if name != "contacts" else {})


def _save(name: str, value: Any) -> None:
    (config.data_dir / f"{name}.json").write_text(json.dumps(value, indent=2, ensure_ascii=False))


def now_ist() -> datetime:
    return datetime.now(IST)


@skill("get_time", "Current date and time in India.")
def get_time() -> dict[str, Any]:
    n = now_ist()
    return {"ok": True, "iso": n.isoformat(timespec="minutes"), "spoken": n.strftime("%A, %d %B, %I:%M %p")}


@skill(
    "set_reminder",
    "Remind the owner at a time. Use ISO 8601 with +05:30.",
    {
        "type": "object",
        "properties": {
            "text": {"type": "string", "description": "What to remind about"},
            "at": {"type": "string", "description": "e.g. 2026-11-11T09:00:00+05:30"},
        },
        "required": ["text", "at"],
    },
)
def set_reminder(text: str, at: str) -> dict[str, Any]:
    try:
        when = datetime.fromisoformat(at)
    except ValueError:
        return {"ok": False, "error": "invalid time"}
    if when.tzinfo is None:
        when = when.replace(tzinfo=IST)
    with _lock:
        items = _store("reminders")
        items.append({"text": text, "at": when.isoformat(), "done": False})
        _save("reminders", items)
    return {"ok": True, "at_spoken": when.astimezone(IST).strftime("%d %b, %I:%M %p")}


def due_reminders() -> list[dict[str, Any]]:
    """Pop reminders that are due (the device speaks them)."""
    out = []
    with _lock:
        items = _store("reminders")
        for r in items:
            if not r["done"] and datetime.fromisoformat(r["at"]) <= now_ist():
                r["done"] = True
                out.append(r)
        if out:
            _save("reminders", items)
    return out


@skill(
    "save_contact",
    "Save a person's phone number in G1's address book.",
    {
        "type": "object",
        "properties": {
            "name": {"type": "string"},
            "phone": {"type": "string", "description": "As the owner said it. Never invent."},
        },
        "required": ["name", "phone"],
    },
)
def save_contact(name: str, phone: str) -> dict[str, Any]:
    from .messaging import normalize_phone

    p = normalize_phone(phone)
    if not p:
        return {"ok": False, "error": "invalid phone number"}
    with _lock:
        book = _store("contacts")
        book[name.strip().lower()] = {"name": name.strip(), "phone": p}
        _save("contacts", book)
    return {"ok": True, "name": name, "phone": p}


def find_contact(name: str) -> dict[str, str] | None:
    book = _store("contacts")
    key = name.strip().lower()
    if key in book:
        return book[key]
    for k, v in book.items():
        if key in k or k in key:
            return v
    return None


@skill(
    "take_note",
    "Save a short note for later.",
    {"type": "object", "properties": {"text": {"type": "string"}}, "required": ["text"]},
)
def take_note(text: str) -> dict[str, Any]:
    with _lock:
        notes = _store("notes")
        notes.append({"text": text, "at": now_ist().isoformat(timespec="minutes")})
        _save("notes", notes)
    return {"ok": True, "count": len(notes)}
