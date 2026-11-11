"""Messaging: WhatsApp and SMS.

WhatsApp, three routes (best available is used):
1. G1 phone build (Android): G1 hands the message to the user's own WhatsApp app
   (share intent) — message goes from *their* number, one tap to send.
2. Click-to-chat link (works everywhere today): https://wa.me/<number>?text=<message>
   The device opens it, WhatsApp opens with the text pre-filled.
3. WhatsApp Cloud API (if configured): sent from G1's own business number,
   for reminders/notifications (same setup as Sherr I).

SMS: through the 4G modem on the dev kit (AT commands over serial).
"""
from __future__ import annotations

import re
import urllib.parse
from typing import Any

import httpx

from ..config import config
from . import skill
from .basics import find_contact


def normalize_phone(raw: str) -> str | None:
    d = re.sub(r"\D", "", raw or "")
    if len(d) == 11 and d.startswith("0"):
        d = d[1:]
    if len(d) == 10:
        d = "91" + d
    return d if 11 <= len(d) <= 15 else None


def _resolve(to: str) -> tuple[str | None, str]:
    """Returns (phone, display name) for a contact name or a raw number."""
    c = find_contact(to)
    if c:
        return c["phone"], c["name"]
    p = normalize_phone(to)
    return p, to


def _wa_summary(a: dict[str, Any]) -> str:
    return f"WhatsApp → {a.get('to')}: “{a.get('message')}”"


@skill(
    "send_whatsapp",
    "Send a WhatsApp message to a saved contact (by name) or a phone number.",
    {
        "type": "object",
        "properties": {
            "to": {"type": "string", "description": "Contact name or phone number"},
            "message": {"type": "string", "description": "Exact text to send, in the language the owner wants"},
        },
        "required": ["to", "message"],
    },
    risk="confirm",
    summarize=_wa_summary,
)
def send_whatsapp(to: str, message: str) -> dict[str, Any]:
    phone, name = _resolve(to)
    if not phone:
        return {"ok": False, "error": f"no number for '{to}'. Ask the owner for it and save_contact first."}

    if config.wa_token and config.wa_phone_id:
        try:
            r = httpx.post(
                f"https://graph.facebook.com/v23.0/{config.wa_phone_id}/messages",
                headers={"Authorization": f"Bearer {config.wa_token}"},
                json={"messaging_product": "whatsapp", "to": phone, "type": "text", "text": {"body": message}},
                timeout=20,
            )
            if r.status_code < 300:
                return {"ok": True, "route": "cloud_api", "to": name}
        except httpx.HTTPError:
            pass  # fall back to link

    link = f"https://wa.me/{phone}?text={urllib.parse.quote(message)}"
    return {
        "ok": True,
        "route": "click_to_chat",
        "to": name,
        "open_url": link,
        "note": "WhatsApp is opening with the message ready; tap send.",
    }


@skill(
    "send_sms",
    "Send an SMS through G1's own SIM card.",
    {
        "type": "object",
        "properties": {"to": {"type": "string"}, "message": {"type": "string"}},
        "required": ["to", "message"],
    },
    risk="confirm",
    summarize=lambda a: f"SMS → {a.get('to')}: “{a.get('message')}”",
)
def send_sms(to: str, message: str) -> dict[str, Any]:
    phone, name = _resolve(to)
    if not phone:
        return {"ok": False, "error": f"no number for '{to}'"}
    if not config.modem_port:
        return {"ok": False, "error": "no 4G modem attached (set G1_MODEM_PORT on the dev kit)"}
    try:
        import serial  # pyserial, only needed on the dev kit
    except ImportError:
        return {"ok": False, "error": "pyserial not installed"}

    import time

    with serial.Serial(config.modem_port, 115200, timeout=5) as s:
        def at(cmd: str, wait: float = 0.5) -> str:
            s.write((cmd + "\r").encode())
            time.sleep(wait)
            return s.read(s.in_waiting or 1).decode(errors="ignore")

        at("AT")
        at("AT+CMGF=1")  # text mode
        s.write(f'AT+CMGS="+{phone}"\r'.encode())
        time.sleep(0.5)
        s.write(message.encode() + bytes([26]))  # Ctrl+Z sends
        time.sleep(3)
        resp = s.read(s.in_waiting or 1).decode(errors="ignore")
    return {"ok": "+CMGS" in resp or "OK" in resp, "route": "sim", "to": name}
