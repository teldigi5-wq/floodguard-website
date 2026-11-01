# FloodGuard R2 — per-mount LittleFS storage uncertainty quarantine

**2026-11-01 · OPEN DRAFT research only · stacked on PR #58 head `dd6a7c86515e2064b57c7db4a467e20d0e301f78`. No merge, device firmware flash, mount invocation, Firebase changes, public telemetry activation, alert or gate operation. Production NO-GO.**

## Why this control is necessary

The exact upstream LittleFS host experiment in [PR #58](https://github.com/teldigi5-wq/floodguard-website/pull/58) injected a transient block-device read failure and demonstrated that subsequent lookup on the same mounted instance could report `LFS_ERR_NOENT` for an existing file. The original `LittleFS.exists()` wrapper also collapses underlying error codes to a boolean, preventing it from proving genuine absence.

There is **no safe automatic retry or permission to create** based on any such uncertain result. A low-level `LFS_O_EXCL` flag alone cannot fix a poisoned mount, recover from power loss or establish device durability.

## Narrow containment on the dormant diagnostic adapter

The new portable `JournalMountHealth.h` tracks a single mount attempt and states: initially blocked, ready only after one successful result, or **permanently quarantined** for the instance. `finishMount(false)`, ambiguous `exists()` false, read-open failure, invalid file length and short read all quarantine it. After quarantine:

- `ready()` is false; `probe()` returns `Uncertain` and `read()` refuses future I/O.
- `mountExplicitly()` refuses another attempt on the same instance.
- No reset/recovery API is provided; no automatic unmount/remount, format, deletion, journal append or cloud ACK is attempted.
- The previous `LittleFSConfig(false)` no-auto-format configuration is still mandatory; an inability to apply it is an irreversible rejection of that adapter instance.
- The actual `writeNew()` remains disabled (always false). Nothing is wired into the diagnostic sketch's `setup()` or `loop()` runtime.

This is **in-memory, per-instance quarantine** only. It does not persist across reboots or prove a fresh mount is safe. Any eventual operational deployment needs independently verified persistent integrity, a recovery operator, correct flash geometry and physical interruption evidence.

## Tests / acceptance

- `tests/firmware_littlefs_mount_health.cpp` compiles the same lightweight state-machine header as the ESP8266 diagnostic with C++11 and six deterministic positive/negative scenarios: unmounted state, successful attempt, failed mount, read-fault quarantine after success, unpaired/duplicate mount result and repeated faults.
- `tests/firmware_bounded_journal_policy.test.mjs` asserts that the ESP8266 adapter calls the gate before mounting and latches ambiguous probes/reads while the device writer remains disabled and the diagnostic sketch never mounts.
- The exact-head GitHub CI includes both tests, previous pinned LittleFS source-verified host tests, POSIX race tests, original firmware regressions, real NodeMCU `esp8266:esp8266:nodemcuv2` cross-compilation, and website checks. **A green result is required before accepting this host/compile-only checkpoint.**

## Outstanding hard boundaries

An actual ESP8266 exclusive-create implementation would require a reviewed public interface or single-owner core extension—*not* unreviewed access to private `LittleFSImpl` internals or a second filesystem owner. A truthful continual flood-warning system also requires secure device signing/TLS, replay-proof authenticated cloud receipt, power-loss-safe retention/ACK, fresh public monitoring, human warning verification, and supervised Arduino UNO gate/alarm tests.

No write-capable hardware prototype or field-safety claim has been made by this change.
