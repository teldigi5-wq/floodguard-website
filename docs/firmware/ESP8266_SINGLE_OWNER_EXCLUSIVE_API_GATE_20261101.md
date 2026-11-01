# FloodGuard R2 — pinned ESP8266 single-owner exclusive-create API boundary

**2026-11-01 · draft research / compile-only gate · stacked on PR #59 commit `df68ebf4f27184d29e12fcd2b5d63f606a19c600`. NO device writer, production Firebase/website/mobile/bot change, merge, flashing or physical gate action. Production NO-GO.**

## Source-verified SDK facts (ESP8266 Arduino 3.1.2)

1. The upstream [`cores/esp8266/FS.h`](https://github.com/esp8266/Arduino/blob/3.1.2/cores/esp8266/FS.h) declares `FS::getImpl()` under `protected:`; applications cannot call it on the `LittleFS` singleton through normal public code.
2. Upstream [`libraries/LittleFS/src/LittleFS.h`](https://github.com/esp8266/Arduino/blob/3.1.2/libraries/LittleFS/src/LittleFS.h) declares `littlefs_impl::LittleFSImpl::getFS()` under `protected:` (friend only to its internal file/directory wrappers). This blocks direct access to the **already mounted** `lfs_t` from ordinary application code without a core change or bypass.
3. Upstream [`cores/esp8266/FS.cpp`](https://github.com/esp8266/Arduino/blob/3.1.2/cores/esp8266/FS.cpp) parses `r`, `w`, `a` and optional `+`; `w` implies truncate. Neither `"wx"` nor `"ax"` is supported by its parser.
4. Core [`libraries/LittleFS/src/LittleFS.h::_getFlags`](https://github.com/esp8266/Arduino/blob/3.1.2/libraries/LittleFS/src/LittleFS.h) has no `LFS_O_EXCL` mapping.
5. Pinned upstream LittleFS [commit `6a53d76e90af33f0656333c1db09bd337fa75d23`](https://github.com/littlefs-project/littlefs/tree/6a53d76e90af33f0656333c1db09bd337fa75d23) **does** support `LFS_O_EXCL` and `LFS_ERR_EXIST`, as host-tested by PR #58. Support in the C library does **not** mean support in the Arduino application API.
6. Default `LittleFSConfig(true)` permits implicit format after mount failure; the dormant adapter in PR #57 explicitly requests `LittleFSConfig(false)`, and PR #59 quarantines uncertain filesystem errors. Neither proves that a real flash mount is read-only under every recovery condition.

## New compiler-enforced negative checkpoint

`tests/firmware_negative_core_abi/firmware_negative_core_abi.ino` is an intentionally *non-compiling* Arduino sketch, guarded by `FG_CORE_ABI_NEGATIVE_TEST`; it contains no runtime device operation. The same exact pinned Arduino CLI and ESP8266 core 3.1.2 used for the successful dormant diagnostic build now compile two separate variants:

- `FG_NEGATIVE_GET_IMPL`: attempted `LittleFS.getImpl()` **must fail compilation with a protected-access diagnostic naming `getImpl`**.
- `FG_NEGATIVE_GET_FS`: attempted `littlefs_impl::LittleFSImpl::getFS()` **must fail compilation with a protected-access diagnostic naming `getFS`**.

CI **fails if either negative sketch compiles successfully** or fails for an unrelated reason. This detects accidental changes in the pinned core surface that would invalidate the design assumptions. A normal successful NodeMCU build still checks the original diagnostic. The negative sketch is never flashed or deployed.

The existing static firmware test also rejects calls to `getImpl`, `getFS`, direct `lfs_file_open`, or a fake `LittleFS.open(...,"wx")` in the dormant production-adjacent adapter.

## Integration options and decision

| Option | Benefits | Safety / maintenance cost | Current decision |
|---|---|---|---|
| Reviewed **single-owner core API extension** exposing explicit exclusive-create and typed storage errors | Reuses one mounted LittleFS instance and permits atomic `LFS_O_EXCL` calls without pre-checks | Requires a version-locked core fork/patch, ABI tests, concurrency ownership, driver/power-cut validation and update maintenance | **Preferred research direction**, not implemented |
| Independent low-level LittleFS instance | Access to raw C flags without modifying core | Risks double mounting the same flash geometry, metadata corruption and inconsistent locking; cannot assume safety even with different instances | **Reject for the operational device without proof and redesign** |
| Raw-flash append / alternate file backend | Potentially explicit record semantics | Wear-leveling, erase sizes, journal rebuild, flash layout, OTA and crash atomicity all need new validation | Research only, not selected |
| Existence precheck followed by `open("w")`, `open("a")` or `open("wx")` | Minimal code | Race/unknown `exists` error, truncation/append, or unsupported flag; irreversible loss of retained warning data | **Prohibited** |

The **next actual firmware design** must declare an error-aware `createExclusive(path, bytes)` contract under the *same configured filesystem owner*, guarantee no truncation or overwrite, support no implicit format, and distinguish `AlreadyExists`, `IOFault`, `CommitUncertain` and `Committed` after persistent read-back. No public cloud `SAFE` claim or acknowledgement may result from a mere local commit.

## Release and physical gates

A successful negative API test **proves only that the pinned compiler rejects unsupported access**. It does not prove any storage implementation correct or justify exposing secrets, initiating Wi-Fi, flashing, touching in-service Uno hardware, changing Firebase rules, ACKing a message, or deploying the warning website/bot. Before any hardware write stage: independent owner approval, a bench-only ESP8266, complete flash/OTA geometry inventory, backup/rollback, real transient I/O fault and power-cut matrix, file-level integrity/sequence checks, signing/TLS and authenticated cloud receipts.

**Production remains NO-GO** until those gates and physical alarm/gate commissioning are independently accepted.
