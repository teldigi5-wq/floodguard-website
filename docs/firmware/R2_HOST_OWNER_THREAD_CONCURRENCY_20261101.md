# FloodGuard R2 — host-only designated read-owner concurrency checkpoint

**1 November 2026 | stacked successor to PR #66 head `b55b9d3f6c9d534d84c75816a0841867fcf24d57` | NO-GO.**

## Why

PR #66 added a bounded read-only queue and demonstrated typed slot observations against a RAM-backed LittleFS volume, but the queue's API **was not thread-safe**. That limitation remains true of the portable queue, and the pinned ESP8266 Arduino core still has no approved, device-level single-owner scheduler or persistent recovery authority.

This checkpoint adds an entirely **HOST-ONLY** reference, `experiments/esp8266-core-excl-review/HostOwnerReadDispatcher.h`, using `std::mutex` and `std::thread::id`. Construction binds the calling *host OS thread* as the designated read-only consumer. Concurrent producer threads may submit bounded tickets while holding a mutex. Only that designated thread can drain a ticket and invoke the supplied read callback. The lock is released during the callback, so new producers may enqueue while one request is active, but only one callback can be dispatched. If nested draining occurs, the underlying queue quarantines and the outer result **cannot** be upgraded to success. Throwing callbacks, CRC/sequence mismatches and absent records also quarantine.

Monotonically increasing positive ticket IDs refuse **within-process replay**, including after a ticket has been completed. IDs are not signed, protected against a process reboot, or bound to an authenticated device principal; neither is this a secure identity system. Full queue returns `Full` and drops no pending work. A wrong-thread drain returns `WrongThread` before any callback invocation and leaves the pending job available to the true owner. Host callback functions are trusted test inputs, not sandboxed untrusted code.

## Tests and evidence boundary

`tests/firmware_host_owner_read_dispatcher.cpp` uses actual concurrent C++11 `std::thread` objects and a real host mutex, not simulated sequential concurrency. Seven grouped scenarios verify wrong-thread rejection, twelve competing producer threads for one ticket ID, submission while a read is in flight, CRC tamper and monotonic-sequence mismatches, missing records, thrown callbacks, nested drain, capacity refusal and stale ID rejection. A host `RetainedFrameCodec::decode` provides byte-level damage detection. **CRC32 only detects accidental damage and is not a cryptographic signature or authenticated sensor identity**; the test's record source is synthetic memory and is not pinned ESP8266 flash. The host owner dispatcher never uploads, writes storage, ACKs a cloud receipt or actuates a gate.

The CI workflow compiles this test under `g++ -std=c++11 -pthread` with warnings as errors, alongside all previous firmware, source-pinned LittleFS RAM tests, ESP8266 3.1.2 compiler, security policy and website regressions. **Do not claim a passing stage until both exact-head GitHub Actions jobs complete.** The core overlay is still disposable CI-only; no additional hardware firmware code is activated by this host model.

## Real device design blockers

This experiment **does not** provide a production ESP8266 scheduler, a FreeRTOS or bare-metal critical-section implementation, an MCU mutex, genuine cross-task safety, real LittleFS read ownership, durable replay counters or a secure device identity. The existing journal's typed `LFS_ERR_NOENT` is still `AbsenceUnverified`, and the real adapter's `writeNew()` remains disabled. Future work must derive an actual device architecture from the deployed board environment, authenticate sources and cloud receipts, verify physical flash/OTA geometry, handle power cuts without formatting or overwriting data, and validate UNKNOWN/STALE web reporting and supervised UNO alarm/gate behavior.

**No merge, physical flashing, Firebase production changes, live alerts, notification, cloud ACK, website deployment or gate actuation. PRODUCTION NO-GO.**
