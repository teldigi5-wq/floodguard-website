# FloodGuard R2 — execute EXACT experimental core method on pinned RAM-backed LittleFS

**2026-11-01 · stacked on PR #62 head `c3e43d4346a799494afcd0c7752af4b4c242355d` · review-only. NO merge, hardware flash, production Firebase, alert delivery, public SAFE claims or gate action. Production NO-GO.**

## Risk exposed in prior checkpoint

PR #62 proved that a version-pinned experimental `FS::createExclusiveLocal` API compiles and links on ESP8266 Arduino core 3.1.2 inside an isolated GitHub Actions runner. **It did not execute the function.** In addition, the initial implementation returned `CommitUncertain` after a read/write/sync error but had **no sticky per-instance error refusal**. Reusing that mount after a storage fault is unsafe: the pinned upstream LittleFS RAM experiment on PR #58 showed a read error can subsequently make an existing file appear missing in the same mounted session.

## Fix in isolated overlay only

The `patch_core.py` implementation now adds `_fgExclusiveQuarantined = false` to the experimental `LittleFSImpl` class instance, and latches it **true** on any unexpected `lfs_file_open` failure, partial or error write, failed `lfs_file_sync`, failed close, read-open error, or mismatched/short/error readback. On a quarantined instance `createExclusiveLocal` returns `CommitUncertain` immediately and may not make new low-level filesystem calls. No reset/retry exists. This is volatile memory-only state; **a reboot clears it**, which remains a hardware and protocol blocker.

The API retains atomic `LFS_O_WRONLY|LFS_O_CREAT|LFS_O_EXCL`, non-destructive `AlreadyExists`, bounded input and root-only paths. A true local byte match is still **NOT** crash durability, authenticated telemetry, public SAFE, delivered alert, or a cloud receipt.

## New evidence type

`tests/firmware_core_overlay_exact_host.template.cpp` contains a synthetic NOR-like RAM device with realistic bit-only programming and explicit fault hooks. `generate_exact_overlay_host.py` reads the **actual `IMPLEMENTATION` Python string** that the ESP8266 core overlay injects. It substitutes that exact source body into the host C++ template, so the two test targets cannot silently diverge at the method-body level.

GitHub Actions fetches source files `lfs.h`, `lfs.c`, `lfs_util.h` and `lfs_util.c` from pinned littlefs commit `6a53d76e90af33f0656333c1db09bd337fa75d23`, verifies each Git blob hash, compiles upstream C with `gcc -std=c99`, and separately compiles the generated host C++ method with `g++ -std=c++11`.

The five host scenarios test: (1) mounted/unmounted and invalid inputs without writes, (2) first write, exact readback, duplicate exclusion and remount preservation, (3) forced programming error and refusal of additional same-mount writes, (4) forced sync error and refusal, (5) forced read error and refusal. Test failures **block CI**. The simulated model does not emulate actual board flash geometry, wear, brownout, concurrency, watchdog, reboot-integrity checks or internet/cloud state.

The existing NodeMCU compiler-positive diagnostic and two protected-API compiler-negative checks remain in CI. In a separate job, the actual isolated core overlay still compiles and links. **These are different kinds of evidence**: host execution of the method is not a physical MCU execution.

## Required next gates

- Independent review of error mapping, synchronization (only one authorized task/owner), watchdog behavior, buffer lifetime, path allowlist, flash wear, boot/remount policy, formatting prohibition and conflict handling
- Additional host injection around partial metadata commits, readback corruption, and simulated power interruption (without claiming actual electrical brownout proof)
- Explicit separately approved **bench-only** hardware inspection, backups/rollback and controlled flash/power tests
- Signed sensor trust, provisioned CA and secure time, authenticated cloud receipt/replay protection, stale/unknown public projection and supervised UNO alarm/gate commissioning

Until those gates are satisfied the diagnostic `EightSlotLittleFsAdapter::writeNew()` remains **false**, and no operational firmware or device is changed. **Production NO-GO.**
