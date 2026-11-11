# From dev kit to the G1 Phone

## Phases
| Phase | What | Time | Rough cost |
|---|---|---|---|
| 0 — Now | G1 OS in the browser (simulator) on any phone/laptop. Real users try it. | weeks | ₹0 – 5k (API usage) |
| 1 — Dev Kit | 3–5 hand-built Pi units (this folder) for demos, investors, early testers | 1–2 months | ₹1.5 – 2.5 lakh |
| 2 — G1 OS on Android | G1 as the launcher + system assistant on existing Android phones (Play Store / sideload). Unlocks real WhatsApp-from-your-number, UPI, contacts, camera. | 3–4 months | software only |
| 3 — G1 Phone EVT/DVT | Custom phone with an ODM on a MediaTek/Qualcomm reference design, running AOSP + G1 OS, dedicated "eye" key | 9–15 months | very rough: ₹50 lakh – 2 crore NRE + tooling + certification, MOQ in thousands |

**Don't design a phone board from scratch.** Every new phone brand starts from an ODM
reference design. Indian ODMs/EMS: Dixon, Lava, Bhagwati, Optiemus; global: Huaqin,
Longcheer, Wingtech. G1's value is the OS and the agent, not the PCB.

## Certifications needed to sell a phone in India
- **BIS** (CRS registration) for the phone, battery and charger
- **TEC MTCTE** for telecom equipment
- **IMEI registration** (ICDR portal) before sale
- **WPC/ETA** for the radios (Wi-Fi/Bluetooth)
- **SAR** testing and labelling

## Lessons from AI gadgets that struggled
Humane's AI Pin was discontinued and Rabbit R1 got heavy criticism: both tried to replace the phone
with a weaker device. G1's path avoids that: Phase 2 puts G1 *on* the phone people already
carry, and the G1 Phone only ships when the software is already loved.
