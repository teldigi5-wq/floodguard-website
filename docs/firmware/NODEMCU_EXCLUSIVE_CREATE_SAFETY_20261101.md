# FloodGuard R2 — Eliminate unsafe LittleFS truncation and test exclusive journal creation (2026-11-01)

**DRAFT / safety correction, stacked on [PR #55](https://github.com/teldigi5-wq/floodguard-website/pull/55), verified base `cb4f5d165c22d654bb64500345a7da74dd81b3a0`. No firmware flash, ESP8266 filesystem mount, production Firebase, deployed clients, live alert, gate action, or merge. NO-GO.**

## The flaw corrected

The PR #55 `EightSlotLittleFsAdapter.h` probed a slot with `LittleFS.exists(path)`, then called `LittleFS.open(path,"w")` when `exists()` returned false. On ESP8266 Arduino Core 3.1.2, the published filesystem API documents **"w" as creating OR truncating a file**, while the boolean `exists()` API does not prove every false return was an authoritative ENOENT (missing-file) response. The earlier implementation therefore could not guarantee no overwriting under I/O uncertainty. The previous native fake-store tests proved the abstract `Store` interface only, **not the real LittleFS adapter's atomic create**.

References: [ESP8266 Arduino Core 3.1.2 filesystem documentation](https://arduino-esp8266.readthedocs.io/en/stable/filesystem.html) (open modes, exists behavior). This is a safety defect in a DORMANT REVIEW MODULE, **not evidence that a deployed device lost data**.

## Corrective MCU change — deny unproven writes

- `firmware/esp8266_review_diagnostic/EightSlotLittleFsAdapter.h` is now **read-only / fail-closed**: `probe()` returns `Present` for observed files, but `Uncertain` for a false `exists()`. It NEVER promotes a possibly inaccessible file to an empty slot. `writeNew()` always returns `false`. Its dangerous `LittleFS.open(...,"w")` code has been entirely removed, rather than replaced with another non-atomic check-then-open.
- Reading already existing files remains possible through the dormant interface. The review diagnostic sketch continues to keep Wi-Fi OFF and NEVER mounts this filesystem or starts any journal, HTTPS upload, device key or gate action.
- This intentionally prevents hardware journal append from succeeding. It is the only defensible default without a verified ESP8266 LittleFS **exclusive-create** mechanism or independently proven safe lower-level transactional storage design.

## Actual Linux filesystem reference (not ESP8266)

`experiments/exclusive-device-journal-fs-lab.mjs` is a **HOST-ONLY test reference**, not a firmware implementation or working field service. It uses the real POSIX/Linux `O_WRONLY|O_CREAT|O_EXCL|O_NOFOLLOW` atomic exclusive open to create a new FGP1 file. It restricts to an absolute, private, owner-controlled temporary directory, refuses symlinks/nonregular files, validates all eight records' ordered high-water and CRC before append, writes exactly one new file, calls `fsync` on both the file and parent directory, then rescans/reads back the exact bytes. It NEVER removes or ACKs records, accesses Firebase, operates a physical gate or asserts cloud delivery.

The real disk integration tests cover:
- first record, eight ordered records and full-capacity refusal;
- simulated restart/re-read, duplicate/replayed event refusal and original-file unchanged;
- externally introduced truncated and bit-flipped records, unexpected slot gaps, nonregular/symlink files and unsafe directory modes;
- two **independent Node.js processes** racing for the same slot, ensuring at most one successful exclusive create, without overwriting the accepted bytes;
- invalid/oversized body and no cloud/ACK claims.

A Linux filesystem result does not establish identical flags or crash consistency on the ESP8266: `O_EXCL` is **not** presented as an ESP8266 LittleFS API. Native CRC32 is integrity/damage detection only; signed-looking JSON is not authenticated. The test directory is disposable and safe for delete by the test harness, never a production outbox.

## Release gates

1. **Owner-supervised physical NodeMCU flash test:** identify actual chip/flash layout, gather serial/power measurements, demonstrate safe read/create API behavior in the target core without any truncating open, controlled brownout/power-off during each program/metadata operation, reboot and preserve all unacknowledged frames. Until then the device write path remains disabled.
2. **Secure device identity:** provision a unique signing secret/key off repository, validate actual MCU signature/entropy/key storage, durable epochs/sequence and rotated public-key authority. The current unsigned record shape and CRC are not device authentication.
3. **Real gateway and cloud proof:** cert-verified **on-device** TLS, a protected public ingress, independent durable issuer/witness, idempotent receipt-validated queue retirement and bounded continuous telemetry. A local HTTP 201 or replay 409 is not a cloud confirmation.
4. **Human/physical safety:** address original UNO sensor error/buzzer fail-safe, rain telemetry, verified gate-position/manual override and stale/offline UI and notification tests before field release.
5. **Governance:** main branch protection and reviewed staged PR promotion remain pending. Current PR is unmerged.

**Only exact-head successful NodeMCU compiler and genuine Linux integration tests qualify for lab acceptance. Production NO-GO.**
