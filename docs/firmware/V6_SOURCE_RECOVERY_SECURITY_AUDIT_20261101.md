# FloodGuard v6 firmware recovery — source-derived serial / hazard audit (2026-11-01)

**Review-only. Actual original sketches found in the user's private file library, not GitHub; do NOT copy or publish their original unredacted bytes. No firmware flash, production Firebase changes, live deployment, physical gate actuation or altered flood alarms. NO-GO.**

## Newly recovered, exact source files

- `FloodGuard_ESP8266_FIREBASE_FINAL_v6.ino` — 519 lines, original ESP8266 software serial, Wi-Fi/legacy Firebase uploader and rain/FG telemetry parser.
- `FloodGuard_Arduino_UNO_FINAL_v6.ino` — 688 lines, actual Arduino UNO HC-SR04 sampling, A0 rain gauge, buzzer, LEDs, servo countdown and serial FG/RG emission.

These **were found in the user's private file library after PR #50**, not in the inspected three GitHub repositories. This supersedes PR #50's statement that actual firmware source could not be located. Neither sketch has been compiled, sanitized for redistribution, reproduced on target board or flashed. They contain physical controller behavior and the ESP8266 sketch contains hardcoded Wi-Fi configuration. **Never commit that sketch or its credential values to a public repository.** Credentials may need rotation if any copies were previously shared, but exposure to unauthorized persons has not been established.

## Verified source-specific risks — factual, not proof of an attack

| Priority | Source observations | Implication |
|---|---|---|
| CRITICAL | ESP8266 `uploadFirebase()` at lines 375–483 and `publishOfflineState()` at 486–519 both use `WiFiClientSecure.setInsecure()` and direct `PATCH` to the old `/floodguard/live.json` | No authenticated peer-certificate verification and previously anonymous database writes; cannot restore this transport, even for offline status |
| HIGH | ESP8266 sketch lines 21–26 include embedded Wi-Fi configuration and a hardcoded remote Firebase URL | Credentials require external provisioning and confidential build handling; don't copy archived sketch into a public PR |
| HIGH | UNO v6 lines 579–615 emit `FG,seq,distance,water,buzzer,gate,angle,countdown,rtc,checksum`, with XOR of packet body; ESP8266 lines 155–175 verify the same XOR | Useful error detection, **not** cryptographic authentication. An attacker able to inject on local UART can forge a checksum |
| HIGH | UNO v6 lines 227–233 clamp `25 - distance` into `[0,25]`; the ESP8266 v6 lines 247–250 similarly clamp any measured distance above installed depth to a level of 0 | An out-of-calibration or incorrect reading can be represented as apparently safe; do not infer measured flood clearance |
| HIGH | UNO v6 lines 471–478 set all indicators and buzzer off on `WATER_SENSOR_ERROR`, without an independent fault alarm; gate-latched behavior is separate | A failed sensor can silence local warning. Failure response must be reviewed with a supervised hardware safety plan, **not** silently rewritten in production firmware |
| HIGH | UNO `packetSequence++` in RAM and ESP `fgSequence = seq` after serial receipt have no verified durable anti-replay anchor across device power loss | Clock/sequence/epoch commissioning, rollback recovery and persistent identity need actual board tests |
| MEDIUM | ESP v6 lines 229–243 parse numeric CSV using `.toInt()`/`.toFloat()`, and lines 161–175 permit loosely parsed hex checksum | Malformed numerics, noncanonical frames or forged byte strings may be normalized instead of failing strictly. Validate type, range, tuple consistency before signing |
| MEDIUM | ESP v6 outputs private Wi-Fi IP/RSSI status into a multi-field Firebase PATCH; gate status/angle are inferred from commanded state | Avoid public leakage of network identifiers and do not claim the servo's physical position without feedback |
| MEDIUM | UNO emits separate `RG` rainfall frames; backend Stage 7 signed frame is strictly water-only | Preserve rain sensor data in a dedicated validated protocol, don't silently invent it in the water-only capsule |

The original sketch's ability to operate locally is not disproven by these findings. No tests on the physical HC-SR04, rainfall sensor, servo, buzzer, RTC, supply, Wi-Fi or gate have been run in this stage.

## New executable lab — strict legacy FG inspection

`experiments/v6-serial-water-safety-preflight.mjs` reproduces the exact legacy FG **wire shape** without copying firmware secrets or control code. It validates byte length against the ESP's original 128-byte RX buffer, ASCII, one complete line, exactly nine fields plus two-character hex XOR, canonical decimal integer/numeric strings, positive monotonic packet sequence, reported risk thresholds, actuator observation format and the 25-cm installed calibration. The resulting `candidate` is explicitly `UNTRUSTED_V6_SERIAL_CANDIDATE_ONLY`: `authenticated:false`, `canPublish:false`, `canAcknowledge:false`, `floodClearance:'UNKNOWN'`. **Even a valid XOR never authorizes a signed upload.**

The lab refuses to translate readings **above the calibrated 25-cm installation depth** into a SAFE level, refuses `SENSOR_ERROR` as numeric safe-water data, refuses contradictory level/risk labels, replay/rollbacks, oversized packets, malformed CSV/numerics and inconsistent claimed gate values. The rainy `RG` frame remains outside this water-only contract, requiring a separate protocol.

The code has no firmware socket, Firebase writer, TLS bypass, key material, gate actuator or automatic background uploader. The targeted Node tests use only synthetic framed v6 packets, not physical hardware. CI runs real PR #50 signed HTTPS/journal regressions and full website checks.

## Required next real-embedded migration

1. **Private source custody:** keep original v6 sketches in a private/offline workspace, remove hardcoded Wi-Fi credentials from any shareable build, and review previously shared copies without assuming unauthorized disclosure.
2. **Board/build identity:** obtain exact ESP8266 board model, flash size, Arduino ESP8266 core/library versions and Arduino UNO board details; create reproducible, source-clean build and a firmware-specific compiler gate. Do not claim a build has happened.
3. **Safety review first:** write a hazard table for ultrasonic invalid echo, >25 cm uncalibrated range, transient DANGER, stuck servo, no gate-position feedback, no RTC/network, buzzer failure and loss of power. Run supervised, non-destructive acceptance before changing physical alarm/gate logic.
4. **Device authentication:** define secure provisioning of unique keys and pinned server CA/hostname with rotation, embedded cryptography and entropy feasibility. Use PR #50's verified local transport contract as a **host simulation**, not proof of MCU-side TLS or Ed25519 support.
5. **Gateway/cloud:** build a real authenticated, rate-limited public ingest and trustworthy independent receipt/witness service. Do not enable anonymous `/floodguard/live`, `setInsecure` fallback or broad Firebase Admin writes.
6. **Reliable UI/alerting:** add separate sensor-health/stale/offline states, signed water/rain feeds and confirmed warning delivery semantics before cloud/mobile/WhatsApp preview. `SAFE` is never proof the gate physically closed.
7. **Release governance:** keep PR chain draft/unmerged, main unprotected issue open, no production deployment or hardware flash without explicit owner review.

**Release: NO-GO.** The recovered source enables a genuine future ESP8266/UNO firmware audit and port; this PR only establishes a tested strict source-derived serial safety boundary.
