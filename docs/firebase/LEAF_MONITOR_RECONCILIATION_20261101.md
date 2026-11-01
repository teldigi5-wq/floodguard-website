# FloodGuard R3 — Fail-closed public leaf monitoring reconciliation (lab only)

**2026-11-01. Review-only incremental follow-up to website PR #34 (`95871bc28adef28c5fb50b57d320566dc7611a34`). Not merged, not deployed, no Firebase changes. Production NO-GO.**

## Why this is necessary

The actual production RTDB rules formerly allowed `".read": true, ".write": true` on `/floodguard/live`. Operator-supplied anonymous GET-only checks returned HTTP 200 for `/floodguard/live`, `/floodguard/live/esp8266`, `/floodguard/live/esp8266/ip` and `/floodguard/live/esp8266/wifi`. The operator subsequently published a temporary `.read:false`/`.write:false` lockdown for `/floodguard/live` while physical sensor hardware is off. Four operator-run anonymous GET probes returned HTTP 401. This confirms the four read denials at the time of the check, not an independently tested production write denial or security of the whole database.

The deliberate lockdown also removes legacy website/mobile/bot real-time telemetry access and old firmware upload permissions. Never revert to anonymous `.write:true` to restore service. No unverified values may be shown as a certified physical SAFE/CLEAR condition; the gate and alarm require independently supervised real-device acceptance.

## This exact review step

`experiments/public-leaf-monitor-lab.mjs` depends on PR #34's strict 24-leaf projector and computes only the exact allowlisted primitive RTDB read paths. It is a **pure reducer** accepting synthetic, already observed leaf events; it contains **no RTDB SDK/network listener** and does not read, publish, change rules, or operate actuators. It enforces:

- exact allowlisted field paths, never parent-group or ESP Wi-Fi/IP paths;
- reuse of PR #34's scalar schema validation and immediate eviction on null, denied or malformed values;
- no stale callback resurrection across disconnected subscription generations;
- receipt-time degradation without mistaking browser reception for real sensor freshness;
- hazard/fault observation preservation; a subsequent unsigned `SAFE` does not clear recorded hazards;
- no asserted flood clearance, verified gate position or automated safety readiness.

`tests/public-leaf-monitor-lab.test.mjs` exercises those boundaries using Node's offline test runner. No physical hardware or credentials are required.

## Review and planned integration

1. Confirm immutable dependency on PR #34 and validate the `PUBLIC_TELEMETRY_LAB_FIELDS` whitelist independently.
2. Add an optional, non-production Firebase RTDB emulator listener adapter that subscribes to each **primitive leaf** and passes the reducer events with subscription generation. Validate denied parent reads and authentic network failures locally.
3. Build a proper authenticated gateway and private durable receipt/sequence store, never trust arbitrary client timestamps. A public receiver must distinguish `OBSERVED` from `AUTHENTICATED_SENSOR_FRESH`; a source-less `SAFE` or `CLOSED` remains unverified.
4. Update website, Flutter and WhatsApp clients behind separate preview/compatibility switches. Coordinate changes; do not migrate production rules until ingestion, all downstream readers and rollback are accepted.
5. Identify and inspect the actual Arduino/ESP8266 firmware (not present in the three inspected GitHub repo trees). Confirm local alarm/gate decision paths still function during loss of internet, with manual override, bounded sensor failure response and separately verified physical gate feedback. No cloud report alone actuates or certifies a gate.
6. Run a supervised end-to-end fault-recovery test and obtain owner approval before any real data or physical device changes.

**Status:** Pure reducer design lab tested locally, not a live read adapter, not deployed, not firmware validation. Runtime CI and review remain independent release gates.

## Recovered controller source evidence (private project files)

The 2026-08-25 original files `FloodGuard_Arduino_UNO_FINAL_v6.ino` and `FloodGuard_ESP8266_FIREBASE_FINAL_v6.ino` were subsequently located in the owner's separate file library, not in the three current GitHub repository trees. Do not copy private firmware source, credentials, or hardware details into a public repository without review.

- Arduino Uno has locally evaluated water statuses: sensor-to-bottom reference **25.0 cm**, `SAFE <8.5 cm`, `WARNING >=8.5 and <11 cm`, `DANGER >=11 cm` calculated water level. It issues a local buzzer and red LED on danger, with a 10-second countdown before writing the 90-degree servo target. This is source evidence, not real hardware testing or safe hydraulic actuation proof.
- In the recovered source, impossible readings greater than the 25 cm installation reference may be clamped to level 0 despite being outside the trusted geometry, and the sensor-error branch disables the buzzer. These are candidate **hardware-safety failure modes** for independent testing and explicit operator policy. Do not blindly change the actuator failure policy without actual mechanical/water-flow safety assessment.
- ESP8266 v6 directly sends anonymous multi-path HTTPS PATCH requests to legacy `/floodguard/live.json`. It contains `WiFiClientSecure.setInsecure()` in regular and offline-publishing paths: host certificate verification is disabled. That firmware is incompatible with the published deny-read/deny-write lockdown and must not be reenabled by opening anonymous writes.
- Water thresholds, gate response and alarm must remain **local physical controller responsibilities**; authenticated cloud telemetry is observational and cannot authenticate the actual servo position without independent feedback.
- Resolve the clock, TLS, device identity, replay, calibration, disconnect, and manual override acceptance before any firmware flash or hardware test. Confirm the firmware actually flashed before asserting this exact library copy is installed.

**Revised checkpoint:** Recovered archived v6 source for architecture review. Firmware still not compiled, flashed, device-tested or source-of-truth-verified on physical hardware.
