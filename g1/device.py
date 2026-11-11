"""G1 device loop (runs on the Raspberry Pi dev kit).

  button press / wake word -> record -> speech-to-text -> agent -> speak + show on screen

Modes:
  python -m g1.device            # real device: mic + speaker + push-to-talk button (GPIO17)
  python -m g1.device --wake     # hands-free with wake word (openWakeWord)
  python -m g1.device --text     # keyboard REPL, works on any laptop (no audio needed)
"""
from __future__ import annotations

import argparse
import base64
import io
import shutil
import subprocess
import sys
import tempfile
import time
import wave
import webbrowser

import httpx

from .agent import Agent
from .config import config

RATE = 16000
SESSION = "device"


# ------------------------------------------------------------------ audio in
def record(max_secs: float = 12.0, silence_secs: float = 1.2, threshold: int = 500) -> bytes:
    """Record from the mic until the speaker stops talking. Returns WAV bytes."""
    import numpy as np
    import sounddevice as sd

    frames, silent, started = [], 0.0, False
    block = int(RATE * 0.1)
    with sd.InputStream(samplerate=RATE, channels=1, dtype="int16", blocksize=block) as stream:
        t0 = time.time()
        while time.time() - t0 < max_secs:
            data, _ = stream.read(block)
            frames.append(data.copy())
            level = int(np.abs(data).mean())
            if level > threshold:
                started, silent = True, 0.0
            elif started:
                silent += 0.1
                if silent >= silence_secs:
                    break
    pcm = b"".join(f.tobytes() for f in frames)
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(RATE)
        w.writeframes(pcm)
    return buf.getvalue()


def transcribe(wav: bytes) -> str:
    """Gemini (understands Hinglish/Telugu well) if a key is set, else offline Whisper."""
    if config.gemini_key:
        r = httpx.post(
            f"https://generativelanguage.googleapis.com/v1beta/models/{config.gemini_model}:generateContent",
            headers={"x-goog-api-key": config.gemini_key},
            json={"contents": [{"role": "user", "parts": [
                {"inlineData": {"mimeType": "audio/wav", "data": base64.b64encode(wav).decode()}},
                {"text": "Transcribe exactly what was said (any Indian language or mix). Output only the words."},
            ]}]},
            timeout=40,
        )
        if r.status_code < 300:
            parts = (r.json().get("candidates") or [{}])[0].get("content", {}).get("parts", [])
            return "".join(p.get("text", "") for p in parts).strip()
    from faster_whisper import WhisperModel  # offline fallback

    model = WhisperModel("base", device="cpu", compute_type="int8")
    with tempfile.NamedTemporaryFile(suffix=".wav") as f:
        f.write(wav)
        f.flush()
        segs, _ = model.transcribe(f.name)
        return " ".join(s.text for s in segs).strip()


# ----------------------------------------------------------------- audio out
def speak(text: str) -> None:
    if not text:
        return
    clean = "".join(ch for ch in text if ch.isprintable() and ord(ch) < 0x1F000)
    if config.elevenlabs_key and config.elevenlabs_voice:
        r = httpx.post(
            f"https://api.elevenlabs.io/v1/text-to-speech/{config.elevenlabs_voice}?output_format=mp3_44100_128",
            headers={"xi-api-key": config.elevenlabs_key},
            json={"text": clean, "model_id": "eleven_multilingual_v2"},
            timeout=40,
        )
        if r.status_code < 300 and shutil.which("mpg123"):
            subprocess.run(["mpg123", "-q", "-"], input=r.content)
            return
    if shutil.which("piper") and shutil.which("aplay"):
        p = subprocess.Popen(["piper", "--model", "en_IN-voice.onnx", "--output-raw"], stdin=subprocess.PIPE,
                             stdout=subprocess.PIPE)
        out, _ = p.communicate(clean.encode())
        subprocess.run(["aplay", "-q", "-r", "22050", "-f", "S16_LE", "-t", "raw", "-"], input=out)
        return
    if shutil.which("espeak-ng"):
        subprocess.run(["espeak-ng", "-v", "en-in", "-s", "160", clean])


def show(cards: list[dict]) -> None:
    """Open links/videos on the device screen (Chromium kiosk on the Pi)."""
    for c in cards:
        if c["type"] == "confirm":
            print(f"   ⚠️  Needs your OK: {c['summary']}  (say 'haan' or 'nahi')")
        elif c["type"] in ("link", "video"):
            url = c["url"] if c["url"].startswith("http") else f"http://127.0.0.1:8700{c['url']}"
            print(f"   🔗 {c.get('label', 'open')}: {url}")
            if not sys.stdin.isatty() or "--no-open" not in sys.argv:
                try:
                    webbrowser.open(url)
                except Exception:  # noqa: BLE001
                    pass


def handle(agent: Agent, text: str, voice: bool) -> None:
    print(f"🗣  {text}")
    reply = agent.handle(SESSION, text)
    print(f"🐯 {reply.say}")
    show(reply.cards)
    if voice:
        speak(reply.say)


# ---------------------------------------------------------------------- modes
def text_mode(agent: Agent) -> None:
    print("G1 text mode. Type, Enter. Ctrl+C to quit.")
    while True:
        try:
            line = input("> ").strip()
        except (EOFError, KeyboardInterrupt):
            print()
            return
        if line:
            handle(agent, line, voice=False)


def button_mode(agent: Agent, pin: int = 17) -> None:
    from gpiozero import Button, LED

    btn, led = Button(pin, hold_time=0.05), LED(27)
    speak("G1 ready.")
    while True:
        btn.wait_for_press()
        led.on()
        wav = record()
        led.off()
        text = transcribe(wav)
        if text:
            handle(agent, text, voice=True)


def wake_mode(agent: Agent) -> None:
    import numpy as np
    import sounddevice as sd
    from openwakeword.model import Model

    # "hey_jarvis" ships pre-trained; train a custom "hey G1" model with openWakeWord's notebook.
    ww = Model(wakeword_models=["hey_jarvis"], inference_framework="onnx")
    speak("G1 ready.")
    block = 1280
    while True:
        with sd.InputStream(samplerate=RATE, channels=1, dtype="int16", blocksize=block) as stream:
            while True:
                data, _ = stream.read(block)
                if max(ww.predict(np.squeeze(data)).values()) > 0.5:
                    break
        ww.reset()
        subprocess.run(["aplay", "-q", "/usr/share/sounds/alsa/Front_Center.wav"], check=False)
        text = transcribe(record())
        if text:
            handle(agent, text, voice=True)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--text", action="store_true")
    ap.add_argument("--wake", action="store_true")
    ap.add_argument("--no-open", action="store_true")
    a = ap.parse_args()
    agent = Agent()
    print(f"🐯 G1 | brain: {type(agent.llm).__name__}")
    if a.text:
        text_mode(agent)
    elif a.wake:
        wake_mode(agent)
    else:
        button_mode(agent)


if __name__ == "__main__":
    main()
