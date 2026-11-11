#!/usr/bin/env bash
# Install G1 on a Raspberry Pi 5 (Raspberry Pi OS 64-bit). Run from the repo folder:
#   bash scripts/install_pi.sh
set -euo pipefail
cd "$(dirname "$0")/.."

echo "🐯 Installing G1…"
sudo apt-get update -q
sudo apt-get install -y -q python3-venv python3-dev ffmpeg espeak-ng mpg123 alsa-utils \
  libportaudio2 chromium-browser fonts-dejavu-core

python3 -m venv .venv
. .venv/bin/activate
pip install -q --upgrade pip
pip install -q -r requirements.txt
pip install -q -r requirements-device.txt

[ -f .env ] || cp .env.example .env
KEY=$(python3 -c "import secrets; print(secrets.token_urlsafe(16))")
grep -q '^G1_ACCESS_KEY=' .env || echo "G1_ACCESS_KEY=$KEY" >> .env

# Run G1 Core + the voice loop at boot
sudo tee /etc/systemd/system/g1-core.service >/dev/null <<EOF
[Unit]
Description=G1 Core
After=network-online.target
[Service]
WorkingDirectory=$PWD
ExecStart=$PWD/.venv/bin/python -m g1.server --port 8700
Restart=always
User=$USER
[Install]
WantedBy=multi-user.target
EOF

sudo tee /etc/systemd/system/g1-voice.service >/dev/null <<EOF
[Unit]
Description=G1 voice loop
After=g1-core.service sound.target
[Service]
WorkingDirectory=$PWD
ExecStart=$PWD/.venv/bin/python -m g1.device
Restart=always
User=$USER
[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now g1-core g1-voice

# Show the G1 screen full-screen on the display at login
mkdir -p ~/.config/autostart
cat > ~/.config/autostart/g1-screen.desktop <<EOF
[Desktop Entry]
Type=Application
Name=G1 Screen
Exec=chromium-browser --kiosk --noerrdialogs --disable-infobars http://127.0.0.1:8700/
EOF

echo "✅ Done. Edit .env (API keys), then: sudo systemctl restart g1-core g1-voice"
