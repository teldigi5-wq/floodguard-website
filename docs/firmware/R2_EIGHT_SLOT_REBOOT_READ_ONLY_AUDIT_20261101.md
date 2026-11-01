# FloodGuard R2 — bounded path allowlist and fail-closed reboot audit

**2026-11-01 · proposed research stage stacked on PR #64 `3d558ce131caf024f440bad1ee1a0c376dd58146`. NO merge, board flash, production Firebase/rules, cloud ACK, automated alerts or gate operation. Production NO-GO.**

## Source findings and exact change

PRs #62–#64 extended an **experimental** single-owner ESP8266 Arduino 3.1.2 LittleFS core API, source-pinned to five Git blobs. Its actual `createExclusiveLocal` body executes only in a disposable RAM-backed LittleFS host fixture; the NodeMCU CI run compiles but never calls that API. It used a root-only filename check but could create unrelated `/anything.bin` files. This draft now permits **only eight exact paths**: `/fgq2_0.bin` through `/fgq2_7.bin`. All other names, suffixes, spelling variants and path forms return `InvalidInput` *before* low-level file open. The existing exact-method host test executes these negative checks and confirms zero extra block-device reads, programs or erases.

**This is not an application-wide authorization boundary.** The experimental core method is public to other code in the disposable core, and the reentrancy bool from #64 is not atomic or a mutex. The single-owner scheduling/lock design requires separate review. A later controlled implementation needs an authenticated owner boundary and independent device tests, not only path validation.

## Restart policy is deliberately READ-ONLY

The new `JournalBootAudit.h` is a portable, one-pass, no-write policy. On a new instance the state is `BlockedBeforeAudit`. It inspects `BoundedFrameJournal::inspectJournal(store)` exactly once; a well-formed Available/Full inventory becomes `ReadOnlyInventory`, never write authority. Any unclear probe, failed read, bad CRC, sequence regression, hole, unmounted store, second audit attempt or explicit quarantine transitions to irreversible `Quarantined` for that instance. The audit exposes no permission to append, retire retained frames, send ACKs or claim public flood SAFE, even after a clean inventory.

The new host test `tests/firmware_journal_boot_audit.cpp` covers **12 synthetic cases**. This tests policy logic, not flash. The dormant NodeMCU diagnostic only includes and `static_assert`-checks the type: it does **not** instantiate it, mount a filesystem, write frames, publish telemetry or touch a gate. The operational-adjacent `EightSlotLittleFsAdapter::writeNew()` remains unconditionally `false`.

**Critical SDK limitation:** the Arduino 3.1.2 `LittleFS.exists()` wrapper returns only `bool`; `false` can mean a missing file **or an I/O error**. The existing dormant adapter quarantines an apparent absence instead of claiming a free slot. Host tests use an explicitly typed fake store with `Missing` versus `Uncertain`; this does not make the stock device adapter capable of an authoritative empty/partially occupied inventory. It may be able to read an already-full, intact volume; otherwise its safe outcome is uncertain. No write permission follows either outcome.

**Reboot limitation:** the core overlay's `_fgExclusiveQuarantined` flag is volatile. Reinitializing a C++ instance clears it. A clean remount does not establish that a prior interrupted write was safe, that a file is durable, or that an earlier event reached the cloud. The new audit is a conservative independent *read-only* policy, **not a real persistent quarantine journal or reviewed replay recovery mechanism**.

## Verification gates

- Actual patched core method compiled from the SHA-pinned ESP8266 3.1.2 core and executed against source-pinned upstream C LittleFS on a disposable RAM-backed block device; new allowlist failure does not touch simulated storage.
- C++11 test of the **exact portable boot-audit header** on 12 synthetic journal snapshots, including empty, partial, full, unreadable, torn CRC, sequence replay, holes, second inspection and pre-existing quarantine; every disposition denies writes and ACK.
- Actual NodeMCU compiles the additional header in a dormant sketch. Firmware static safety checks, current native fault matrix, HTTP ingress and website regressions remain enforced.
- **Do not claim passing verification before exact-head GitHub Actions completes and logs are inspected.**

## Still blocked

A production-quality, strictly single-owner writer needs a rigorously specified scheduler/mutex and resource boundary, typed error-aware existence checks, a non-forgeable reboot recovery/authoritative epoch strategy, actual device/OTA flash geometry, crash/erase/program power interruption tests on separately approved hardware, signed telemetry and authenticated cloud receipts, public UNKNOWN/STALE behavior and supervised Arduino UNO alarm/gate commissioning.

The purpose of closing unauthenticated Firebase paths was to prevent unauthorized telemetry manipulation, **not** to disable flood safety monitoring permanently. Restoring legitimate automatic warnings requires an authenticated device-to-cloud publishing path and verified replay/receipt handling, not reopening public writes.

**Production NO-GO.** No device writer, automatic clean-up or physical actuator is enabled.
