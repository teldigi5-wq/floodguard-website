# FloodGuard R2 — isolated ESP8266 Arduino 3.1.2 single-owner exclusive API overlay

**2026-11-01 · isolated GitHub Actions compiler experiment · STACKED ON PR #61 at `2815f12ad490d131e80a3aa1791d8dea767543ac`. PRODUCTION NO-GO. No merge, deployed firmware/core, flash, production Firebase/public telemetry, human alert, cloud ACK, gate or alarm operation.**

## Exact source and scope

The R2 research stages #58–#61 established a low-level upstream `LFS_O_EXCL` primitive, identified that the stock ESP8266 Arduino `FS::open("wx")` mode is unsupported, found that `FS::getImpl` and `LittleFSImpl::getFS` are protected, quarantined uncertain mount state and tested an **observation-only** local write lifecycle. None of these stages activates firmware storage.

The experimental `experiments/esp8266-core-excl-review/patch_core.py` modifies only the **disposable core installed inside a GitHub Actions runner**, after checking the exact Git object IDs of five source files from the upstream `3.1.2` tag. Any hash mismatch rejects the experiment **before modifying any file**. The patch does not alter the upstream `esp8266/Arduino` repository, firmware deployed to a board or the user's workstation.

The overlay edits the runner's `FS.h`, `FSImpl.h`, `FS.cpp`, `LittleFS.h` and `LittleFS.cpp` to expose a candidate `fs::ExclusiveLocalResult FS::createExclusiveLocal(path, bytes, len)`. Generic FS backends default to **Unsupported**. The only implementation is in the **same existing mounted** `LittleFSImpl` object, with **no protected-object bypass and no second mount**.

## Candidate semantics, not yet approved

For non-null bounded bytes (1–1038) and a root-only path, the overlay calls the pinned `lfs_file_open(LFS_O_WRONLY|LFS_O_CREAT|LFS_O_EXCL)` directly. It rejects `LFS_ERR_EXIST` as `AlreadyExists`, never calls `exists()` followed by `open("w")`, and **never requests `LFS_O_TRUNC` or `LFS_O_APPEND`**.

After an exclusive-created result it performs exact full-length write, explicit sync, close, fresh read-only reopen, file-size verification and chunked byte equality. Any failed/partial write, sync, close, open or mismatched read yields **CommitUncertain**, with **no automatic retry or deletion**. `LocalBytesMatched` means only that the bytes matched in that mounted session. It does **not** prove durable flash after power interruption, secure device identity, cloud receipt or public SAFE status.

**Important limitations requiring review:** the overlay implements a low-level *candidate* write path but **no device-side runtime call is made**. The upstream littlefs may write metadata in `lfs_file_open`; a failed return is treated as uncertain. The method does not implement a cross-task mutex, durable quarantine across reset, root-slot allowlist, full crypto, stable secure clock, authenticated cloud receipt, or power-cut behavior. The generic core method is a research surface that must not be distributed into production before a design/attack review. Its 1038-byte bound is review-specific, not a finalized public SDK API.

## CI controls

- First, the existing stock core 3.1.2 diagnostic **must compile**, and the stock protected `getImpl`/`getFS` negative sketches **must fail** for the intended protected-access reasons.
- Then, and only within the disposable CI runner, the source-pinned overlay is applied. A separate `compile_only_review.ino` is built against the experimental core, enforcing its typed public API and linker-visible symbol while **not calling it from `setup()` or `loop()`**. The original diagnostic is compiled again on the overlay to catch interface regressions.
- Existing host LittleFS `LFS_O_EXCL` tests and `ExclusiveCreateLifecycle` fault matrix, static API guards, firmware, ingress and website tests remain present.
- **Do not call this tested or compile-proven until the *exact-head* GitHub Actions job finishes successfully.**

The script must never run on the user's actual Windows/WSL Arduino package or any deployed warning device. Never flash the isolated sketch. CI's runner package is disposable; normal `main` remains unchanged.

## Future safety gates

Before attempting any physical device-side exclusive writer: review the proposed API's synchronization and file-handle behavior; verify slot allowlisting; track reboots and corrupted metadata; defend against clock/sequence rollback and malicious source bytes; identify actual ESP8266 flash/OTA geometry; preflight backup and power isolation on separately approved bench hardware; inject real brownouts and errors; validate signed TLS and authenticated cloud receipt; and commission private → public SAFE/UNKNOWN/STALE projection, alarm and gate policy with humans in the loop.

**Firmware `EightSlotLittleFsAdapter::writeNew()` remains `false`. Production NO-GO.**
