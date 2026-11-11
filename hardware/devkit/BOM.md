# G1 Dev Kit v0 — Bill of Materials (India)

A working, hand-built G1 you can carry, demo and give to testers. Everything is
off-the-shelf from Indian sellers (Robocraze, Robu, ThinkRobotics, Amazon).

> Prices are rough and move a lot (memory prices pushed Raspberry Pi costs up in 2026).
> Only the 4G HAT price was checked live (Robocraze, Nov 2026). Check before ordering.

| # | Part | Why | Qty | Approx ₹ |
|---|------|-----|----:|---------:|
| 1 | Raspberry Pi 5 (4 GB is enough; 8 GB if you want offline models) | Main computer, runs G1 OS | 1 | 7,000 – 20,000 |
| 2 | Raspberry Pi Active Cooler | Pi 5 throttles without it | 1 | 500 |
| 3 | Waveshare SIM7600G-H 4G HAT (B) + 2 antennas | Own SIM: 4G data, SMS, calls, GPS | 1 | 10,215 |
| 4 | 5" DSI touch display (Raspberry Pi Touch Display 2 5" or Waveshare 5" DSI) | Screen for cards, checkout, video | 1 | 5,000 – 7,000 |
| 5 | USB 2-mic array (ReSpeaker Lite or similar, with echo cancellation) | Far-field voice + talks while speaking | 1 | 2,500 – 4,000 |
| 6 | 3 W 4 Ω mini speaker + small USB/I2S amp | Voice out | 1 | 400 – 800 |
| 7 | UPS / battery HAT that supports Pi 5 + 2× 21700 Li-ion cells | 2–3 h portable runtime | 1 | 3,000 – 4,500 |
| 8 | Camera Module 3 (optional) | "What am I looking at?", scan bills | 1 | 2,500 – 3,500 |
| 9 | 24 mm arcade-style push button + WS2812 8-LED ring | The "eye": push-to-talk + status light | 1 | 300 |
| 10 | 64 GB microSD (A2) or NVMe via HAT later | Storage | 1 | 600 |
| 11 | M2.5 heat-set inserts + screws, DSI/USB cables | Assembly | 1 set | 400 |
| 12 | 3D-printed case (PETG, `enclosure/`) | Body | 1 | 800 – 1,500 (local print shop) |
| 13 | Prepaid SIM (Jio/Airtel) | Data + SMS | 1 | 300 |
| | **Total** | | | **≈ ₹33,000 – 55,000** |

**Cheaper build (~₹20k):** Pi 5 4 GB, skip camera, use a cheaper A7670 4G module, Waveshare
WM8960 audio HAT instead of the USB mic array.

## What the dev kit proves
- Voice → AI agent → real actions, on its own SIM, in your hand
- Battery powered, no laptop needed
- Same G1 OS software that later runs on the G1 Phone
