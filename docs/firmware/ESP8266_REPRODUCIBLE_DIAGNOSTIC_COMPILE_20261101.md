# FloodGuard — ESP8266 reproducible compile-only diagnostic candidate (2026-11-01)

**NOT production firmware. NOT the recovered v6 firmware. NOT a safe replacement for the Arduino/ESP8266 flood-warning installation. NO HARDWARE FLASH. RELEASE NO-GO.**

## Exact predecessor

Stacked only on [PR #51](https://github.com/teldigi5-wq/floodguard-website/pull/51), verified `2488beca18f5abcb9c301f3a3a05bf5c2da5fffb`, with the original private `FloodGuard_ESP8266_FIREBASE_FINAL_v6.ino` (519 lines) and `FloodGuard_Arduino_UNO_FINAL_v6.ino` (688 lines) recovered from the owner's private Library. Both originals remain **outside GitHub**. The recovered ESP v6 code includes Wi-Fi secrets and insecure anonymous-style Firebase PATCH. Neither is recopied, recompiled, flashed, or modified by this PR.

This stage is the **first independent, source-compatible, secret-free firmware candidate** prepared for an actual ESP8266 Arduino cross-compiler acceptance gate. It does not imply the owner has identified the exact ESP8266 board/flash size or that the archived full-featured sketch builds.

## Strict diagnostic-only firmware target

`firmware/esp8266_review_diagnostic/esp8266_review_diagnostic.ino` and `V6SerialParser.h`:

- Uses GPIO14 (nominal D5 RX), GPIO12 (nominal D6 TX) and 9600-baud SoftwareSerial for the **original UNO v6** `FG,seq,distance,water,buzzer,gate,angle,countdown,rtc,XOR` wire packet. Bench wiring must be checked (UNO 5 V TX level-shifted to ESP8266 3.3 V; common ground), and no live device has been connected.
- The exact portable header parses complete bounded, printable ASCII frames (≤127 chars as in the 128-byte original ESP receive buffer), strict two-digit XOR, nine original data fields, monotonic **RAM-only** sequence, numeric canonicality and status/risk consistency for the installed 25 cm reservoir depth and 8.5/11 cm thresholds.
- Unknown, bad-XOR, malformed, replayed, impossible gate observation, out-of-calibration `distance > 25cm`, contradictory `SAFE` and `SENSOR_ERROR` numeric water data do **not** become cloud-eligible readings. `SENSOR_ERROR` is separately reported in diagnostics as untrusted fault. Even a correctly checksummed packet is **NOT authenticated**. Reported gate angle/status has no independent hardware position sensor.
- No heap-allocated serial strings; bounded fixed-size buffer and overflow discard-until-newline. Original serial input is never printed verbatim. There is **no device key, token, password, public gateway hostname, Firebase SDK, certificate file, local cloud queue, actuator signal or signed uplink**.
- `setup()` calls `WiFi.mode(WIFI_OFF)` and disables persisted Wi-Fi settings. It only reads diagnostic UART and reports generic acceptance/fault/stale conditions on a separate debug UART. It will **NOT send warnings to people or operate a servo**. Flashing it as a replacement could disable flood alerts and is explicitly prohibited.
- Sketch **refuses compilation** without `-DFG_DIAGNOSTIC_BUILD_ONLY`, and rejects compile-time flags attempting to enable Firebase, upload or gate control.
- The ESP8266 BearSSL interface is compiled against versioned headers in an **unused** trust-anchor helper requiring a CA pointer and sane UTC clock. This is *not* actual HTTPS handshake evidence or network transport implementation. Peer validation and device-side Ed25519 key/signing feasibility are still unverified.

## Reproducible CI

`.github/workflows/esp8266-reproducible-diagnostic-compile.yml` installs:

- Arduino CLI **1.5.1**, downloading the exact release tarball and checking the pinned official SHA-256 `28a8e119c498a25607821c36cb2dc49e8463941b261a0d99091baa7bc692dd2b`; never pipes an unverified install script into a shell.
- ESP8266 Arduino core **3.1.2**, from its official HTTPS Boards Manager index.
- Compiles `firmware/esp8266_review_diagnostic` for `esp8266:esp8266:generic` using `-DFG_DIAGNOSTIC_BUILD_ONLY`, with **no upload, signing, binary artifact publication, production secret or network connection in the firmware**. Official upstream Arduino platforms may change downloaded transitive artifacts: core version is pinned, but full offline bit-reproducible toolchain hash/attestation is not yet established.
- A **separate native g++ C++11 -Wall -Wextra -Werror -pedantic** test compiles and executes the exact `V6SerialParser.h` included in the MCU sketch, against original source-derived packet thresholds and hostile/invalid inputs. A Node.js policy test rejects accidental cloud, credential, insecure TLS or actuator code. CI also runs PR #51's exact native serial/Node HTTPS regression and full website checks/lint/typecheck/build.

**Mark the Arduino compile verified only after an exact-head successful job reports the actual cross-compilation. A successful Node test alone is not evidence of ESP8266 firmware compilation.**

## Blockers and next real migration

1. Determine actual board model, flash layout/Arduino core target, pin mapping and power/level-shifter behavior. Generic-board compile does **not** establish compatibility or sufficient RAM/flash on the user's physical ESP8266.
2. Private provisioning: per-device authentication/signing key and transport trust anchors via out-of-repo process; choose audited ESP8266-compatible Ed25519 or alternative secure protocol, measure cryptography RAM/entropy and key extraction threat.
3. Implement a real authenticated ingestion gateway and durable per-event receipt issuance with network timeout, TLS CA + hostname/clock checks, replay-resistant nonvolatile sequences/epochs, power-fail-safe outbox retention, rate limits and operator revocation. Never restore `setInsecure()` or anonymous Firebase writes.
4. Design separate validated rain telemetry and safe failure reporting; do not falsely equate a missing sensor reading with SAFE. Restore cloud monitoring only after independent real-world alert delivery and supervised UNO buzzer/gate/manual-override safety acceptance.
5. Protect `main` and require code review and CI before any future merge.

All previous draft PRs remain unmerged; no deployed Firebase, production web/mobile/WhatsApp, device firmware, sensor or gate has been changed.

**Production NO-GO.**
