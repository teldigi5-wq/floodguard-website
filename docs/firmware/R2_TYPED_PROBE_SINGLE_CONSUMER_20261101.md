# FloodGuard R2 — typed LittleFS slot observation and bounded read-only owner queue

**2026-11-01 · research-only successor to draft PR #65, pinned head `84017e252e4a40fd068c0a2c9a06e33df6582829`. No merge, MCU flashing, production Firebase write/rules, telemetry activation, automated alert, cloud receipt, gate operation or alarm action. PRODUCTION NO-GO.**

## Verified source limitation and conservative response

The ESP8266 Arduino core 3.1.2 `FS::exists()` interface returns only `bool`, collapsing filesystem error states into `false`. That is not authoritative proof that a retained slot is empty. The experimental core patch from PRs #62–#65 already enforced exactly eight allowlisted paths and atomic `LFS_O_EXCL` for research-only creation. It has **not** become a functional device writer.

This research stage adds `JournalSlotObservation FS::probeJournalSlot(path)` to the **same SHA-locked disposable core overlay**. It calls the *source-pinned* upstream `lfs_stat()` on an exact eight-slot path (not the `FS::exists()` bool). It distinguishes **PresentUnverified** (metadata says regular file, with no CRC/signature proof), **AbsenceUnverified** (the C API returns `LFS_ERR_NOENT`, still NOT permission to create), **StorageUncertain**, **InvalidInput** and **Unsupported**.

An apparent absence **latches `_fgExclusiveQuarantined`**, blocks all subsequent create or probe calls in that mounted instance and never returns an actionable `Missing` status. An unexpected I/O error, an invalid type, or a nested call also quarantines. This intentionally sacrifices availability in exchange for non-destructive storage safety. A positive metadata result alone cannot prove retained record integrity or authenticated cloud delivery. No read operation here grants write permission, ACK or public SAFE.

The generator inserts the **exact same `probeJournalSlot` source body** into the RAM-backed host harness as the disposable Arduino core, alongside the existing exact write method. The host scenarios cover unmounted/invalid paths, regular-file metadata, apparent absence refusing all same-mount writes, and probing after an interrupted simulated program. They use a synthetic NOR-like RAM device and do not prove true electrical brownouts or stable flash metadata across restarts.

## Single-consumer audit scheduling policy, not physical locking

`ReadOnlyOwnerQueue.h` is a separate tiny portable C++11 queue for **read-only audit requests**, with a fixed four-request capacity and one in-flight ticket. It rejects duplicate IDs or invalid slots, refuses overflow instead of dropping pending audits, and permanently quarantines the queue on nested take, wrong completion ticket, or reported read failure. It exposes `mayWrite() == false`, `mayAcknowledge() == false` and `mayOperateGate() == false`.

**This is not a mutex or task identity verifier.** It assumes all calls are made sequentially by one future owner event loop. The queue is not thread-safe, does not serialize the underlying LittleFS C API, and is never instantiated or drained in the dormant NodeMCU sketch. A true single-owner application architecture still requires a separately reviewed task scheduler, callback rules, ownership transfer policy, atomic lock/critical-section design as appropriate, and real device tests.

Host tests check queue admission, FIFO order, duplicate/overflow refusal, failed completion and quarantine. The firmware diagnostic only `#include`s and compile-checks the portable policy header. The original `EightSlotLittleFsAdapter::writeNew()` remains **false** and its existing ambiguous-`exists()` safety refusal remains intact.

## CI evidence criteria and blockers

Do not call this stage verified until the exact-head workflow passes both the host/site and pinned NodeMCU compiler jobs. Retain version-locked upstream C source/hashes, compiler-negative core protected-access probes, exact-method RAM tests, native codec/retention/journal tests, localhost ingress tests, website tests, lint and production build. The experimental compiled API is **not called by operational firmware**.

**Hard blockers** remain: (1) true single-task or synchronized filesystem owner; (2) authoritative per-slot error mapping and integrity checks without relying on error-masked `exists()`; (3) durable crash/reboot recovery anchored in actual flash and tamper-evident signed events; (4) independently approved bench-hardware geometry/backup/power-cut tests; (5) signed device identity and trusted TLS; (6) authenticated cloud receipts and queue retirement; (7) conservative public STALE/UNKNOWN state and supervised UNO alarm/gate commissioning.

The earlier closure of public Firebase writes prevented unauthenticated telemetry manipulation. Continuous automatic flood warning remains a product objective, but requires a **secure authenticated sensor-to-cloud pipeline**, not reopening the public database rules.

**PRODUCTION NO-GO.**
