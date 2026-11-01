# FloodGuard R2 — local exclusive-create lifecycle contract (2026-11-01)

**Review-only, stacked on PR #60 at `52a690eb5e470af5da01daff8859c78331b50779`. No merge, hardware flash, filesystem write, production Firebase, authentication key issuance, public SAFE claim, alert, cloud ACK, website deployment or gate operation. PRODUCTION NO-GO.**

## Why a lower-level `LFS_O_EXCL` flag is insufficient

ESP8266 Arduino core 3.1.2 does not expose exclusive file creation through its supported `FS::open()` API; both its `FS::getImpl()` and `LittleFSImpl::getFS()` methods are protected. The source-pinned upstream LittleFS C API supports `LFS_O_EXCL`, as tested by PR #58, but **a low-level successful open is not proof that the record's bytes were completely written, synchronized, closed, read back, or power-loss durable**. PR #59 also showed why an apparent missing file after a storage fault cannot grant permission to overwrite.

The existing ESP8266 `EightSlotLittleFsAdapter::writeNew()` **still unconditionally returns false**. The diagnostic sketch includes and compile-checks the new review-only lifecycle type but never instantiates or calls it from `setup()` or `loop()`.

## Candidate single-owner backend contract

The portable C++11 `ExclusiveCreateLifecycle.h` defines one **observation-only** sequence that a *future* reviewed core extension would have to report:

`ExclusiveOpen::Created` (true atomic create, never `exists()` then `open("w")`) → exact-byte-count write → successful sync → successful close → distinct read-back of **identical bytes and length** → `LocalBytesMatched`.

Any short/error write, failed sync, failed close, short/mismatched/error read, wrong event ordering or repeated open after an attempted create is **`CommitUncertain`**, and the contract provides no reset/retry operation. `AlreadyExists` is `ExistingUnacknowledged` and is never a cloud ACK. `StorageFault` before a successful new create remains a fault. An unsupported device API remains `Unsupported`.

Even the strongest output is labelled **LocalBytesMatched**, *not durable, authenticated, safely published, acknowledged or flood SAFE*. The class tracks reported operations only: its positive host fixture is simulated and does not verify that any driver really performed them. Calling it a device write test, an authoritative C API patch or a successful cloud delivery would be inaccurate.

The expected-byte pointer must remain valid and **unchanged** until the read-back comparison; a future device backend must own or enforce that lifetime. This class neither reads nor writes a device itself.

## Reproducible tests

- `tests/firmware_exclusive_create_lifecycle.cpp` covers 15 isolated C++11 host scenarios including unsupported API, existing retained data, pre-open fault, local positive path, partial/error write, sync/close failure, corrupt/short/error read-back, out-of-order operations and invalid input after creation.
- `tests/firmware_bounded_journal_policy.test.mjs` checks the disabled device writer, dormant sketch, local-only outcome semantics and absent insecure core-private API calls.
- GitHub Actions builds these exact headers under native C++11 and the pinned **ESP8266 Arduino 3.1.2** NodeMCU cross-compiler; the same workflow retains two compiler-negative protected-access tests, the source-pinned upstream LittleFS C host harness, POSIX races, firmware parser/ingress checks and website regressions.
- **Do not claim CI success until the final exact-head run is completed.**

## Hard gates before implementation

1. Independently review and pin a legitimate **single-owner ESP8266 core extension** exposing exclusive create **and raw typed error codes**, avoiding `FS::open("wx")`, protected-state bypasses and dual mounts. The legacy core's `LittleFSImpl::open` performs extra metadata work on create and discards some sync statuses: an extension needs separate error-sensitive semantics, not just another alias to `w`.
2. Validate path policy, slot sequence, bounded size, file-handle ownership, concurrency, lock scope, flash/OTA layout, no-autoformat and impossible-to-reuse error states.
3. Get explicit approval for separately isolated bench hardware, flash backup, instrumentation and controlled brownout/fault injection. Device durable append/retirement remains unverified.
4. Separately commission device identity/signing, trusted TLS, authenticated cloud receipt, replay protection, stuck/full queue behavior, public UNKNOWN/STALE presentation and supervised Arduino UNO alarm/gate behavior.

**Production remains NO-GO and the real fleet firmware stays untouched.**
