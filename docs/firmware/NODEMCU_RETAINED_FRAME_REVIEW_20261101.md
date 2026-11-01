# FloodGuard — NodeMCU 1.0 retained-frame compile and torn-write lab (2026-11-01)

**Review-only. No firmware flashed, live telemetry upload, file write on physical hardware, Firebase production access, cloud acknowledgment, gate actuation, or human warning. This prototype is NOT a sustainable device queue. Production NO-GO.**

## Starting checkpoint and board evidence

Stacked on [PR #53](https://github.com/teldigi5-wq/floodguard-website/pull/53), verified exact head `5ad371ddafe8d7fa98916a256724658a2bd9afee`. PR #53 cross-compiled a dormant BearSSL HTTPS source module for a generic ESP8266 target, while the actual original ESP8266/UNO v6 firmware remained private.

Earlier user-provided hardware notes identify the board as **NodeMCU 1.0 (ESP-12E Module)**, with ESP GPIO14/D5 receiving UNO D3/TX through a 5V-to-3.3V divider and GPIO12/D6 on ESP TX. This stage compiles for the corresponding **`esp8266:esp8266:nodemcuv2` target** using the already pinned Arduino CLI 1.5.1 and ESP8266 Arduino core 3.1.2. The exact installed board/flash capacity, flash partition and supply integrity have **not** been independently measured. Compiler success is not a device test.

## New retention implementation

- `firmware/esp8266_review_diagnostic/RetainedFrameCodec.h`: a portable fixed-buffer versioned `FGP1` record with exact source sequence (1–2,147,483,647), 1024-byte maximum external **pre-signed** body, payload length and CRC32 damage detection. CRC is **not a signature/MAC** and cannot establish device identity. It decodes only exact complete records, denies truncated/torn/modified records, and never re-signs or renumbers a reading.
- `firmware/esp8266_review_diagnostic/OneFrameLittleFsStore.h`: a **dormant** filesystem-backed one-frame proof-of-concept. An explicit caller would have to mount LittleFS. The method refuses to overwrite any existing on-flash record, including a partially written or corrupt one; it writes once, flushes/closes and re-reads the identical encoded bytes. Failures return uncertain/damaged outcomes. There is **no delete, format, reset, rotate, compaction, ACK, retry loop or cloud delivery**.
- `firmware/esp8266_review_diagnostic/esp8266_review_diagnostic.ino` includes both headers in the cross-compiled translation unit, but calls **neither** the LittleFS storage nor the BearSSL submission code. Wi-Fi remains OFF, the sensor parser is diagnostic-only, and original UNO/local gate/buzzer firmware is untouched.
- `tests/firmware_nodemcu_retained_frame.cpp` executes real native C++11 tests against the same codec, including every possible truncated prefix of a representative frame, bit flips, invalid magic/sequence/length, oversized/unsafe data, and non-overwrite policy. `tests/firmware_nodemcu_storage_policy.test.mjs` guards against accidental flash mounting, file cleanup, credentials, network uploads and actuator calls.
- Dedicated pinned CI cross-compiles **NodeMCU 1.0 ESP-12E**, runs the actual native codec and previous serial/receipt tests, and executes full website regression, lint, TypeScript and build. **No binary is uploaded or published.**

## Safety and reliability qualifications

1. **Only one record:** there is intentionally no safe queue retirement. Once an unacknowledged record exists the prototype refuses new records. This prevents silent overwrite but **cannot operate as continuous real-time flood monitoring** and must never be substituted for deployed firmware.
2. **No genuine power-cut proof:** native tests model truncated/corrupted bytes, but do not test real LittleFS atomicity, flash wear, partial program errors, brownouts or filesystem mount failures on the physical NodeMCU. A CRC-negative record is quarantined; the API has no recovery or deletion path.
3. **No device signature provisioning:** the body is assumed previously signed elsewhere. The device does not produce Ed25519 signatures, retain private keys, validate a cloud-signed receipt, issue an epoch or use a trusted time bootstrap. An externally signed body may be staged; this prototype cannot prove its signer.
4. **No MCU-side TLS handshake:** the BearSSL code is cross-compiled but never called. Host localhost HTTPS tests are not on-device tests. No real gateway, secrets, CAs or production device identity are included.
5. **No alarm/gate correctness:** missing sensor, invalid ultrasonic echo and out-of-calibration SAFE behavior remain in the original private physical firmware. This PR contains no changes to the UNO buzzer, local safety response, independent gate-position feedback or manual override.
6. **No production changes:** `/floodguard/live` remains locked down, original firmware and deployed website/mobile/WhatsApp remain untouched, all stacked PRs draft/unmerged. The protected-main governance gap persists.

**Next gates:** exact-head NodeMCU compiler evidence, secure provisioned device identity and durable immutable event origin, RAM/flash and brownout measurements on an isolated bench, a sustainably bounded queue with independently verified receipt/witness and crash-safe ACK, and supervised physical sensor/buzzer/gate fail-safe tests.

**Production NO-GO.**
