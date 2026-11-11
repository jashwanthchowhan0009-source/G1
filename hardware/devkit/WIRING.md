# G1 Dev Kit — wiring and assembly

```
              ┌──────────── 5" DSI touch display ────────────┐
              │                                              │  ◉ eye button + LED ring
              └──────────────┬───────────────────────────────┘
                             │ DSI ribbon (DISP port)
 ┌────────────┐   USB    ┌───┴────────────┐   USB    ┌──────────────────┐
 │ USB mic    ├──────────┤ Raspberry Pi 5 ├──────────┤ SIM7600G-H 4G HAT├── 2× SMA antennas
 │ array +amp ├─ speaker │  + active cool │  (stack) │  SIM card slot   │
 └────────────┘          └───┬────────────┘          └──────────────────┘
                             │ 5 V / 5 A (pogo pins / header)
                     ┌───────┴────────┐
                     │ UPS HAT + 2×21700│── USB-C charge in
                     └────────────────┘
```

## GPIO
| Signal | Pi 5 pin | Notes |
|---|---|---|
| Eye button | GPIO17 (pin 11) → button → GND (pin 9) | internal pull-up; `g1.device` button mode |
| Status LED (simple) | GPIO27 (pin 13) → 330 Ω → LED → GND | lights while listening |
| LED ring data (WS2812, optional) | GPIO18 (pin 12) | 5 V (pin 2), GND (pin 14) |
| 4G HAT | stacks on the 40-pin header + USB cable | appears as `/dev/ttyUSB0..4`; AT port is usually `/dev/ttyUSB2` |

## Assembly order
1. Flash **Raspberry Pi OS (64-bit, Bookworm or newer)** to the microSD.
2. Fit the active cooler, then the 4G HAT (insert SIM first, screw on antennas).
3. Connect the display ribbon to the DISP port; mount the display into the front bezel.
4. Press M2.5 heat-set inserts into the back shell standoffs; screw the Pi in.
5. Battery HAT + cells sit in the bay under the Pi (rails in the back shell).
6. Eye button into the front bezel, LED ring around it.
7. Close: 4× M2.5 × 10 screws in the corners.
8. Run `scripts/install_pi.sh` on the Pi.

## Safety
- Use protected 21700 cells from a known brand; never charge unattended while testing.
- Keep the 4G antennas away from the mics (RF buzz) — top edge, as in the case design.
