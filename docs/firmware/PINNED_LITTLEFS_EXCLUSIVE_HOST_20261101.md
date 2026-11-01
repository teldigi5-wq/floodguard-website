# FloodGuard R2 — pinned upstream LittleFS exclusive-create experiment (2026-11-01)

**DRAFT / host-only / stacked on PR #57 at `a88b6c90750f47d8c6acb65098d16d77ede8351a`. Production NO-GO. No device flash, mount, cloud access, public Firebase rules change, firmware writer activation, alert, gate action or merge.**

## Exact upstream source lineage

The pinned ESP8266 Arduino **3.1.2** core refers to `libraries/LittleFS/lib/littlefs` as a Git submodule pointing to LittleFS commit `6a53d76e90af33f0656333c1db09bd337fa75d23` ([core's submodule link](https://github.com/esp8266/Arduino/tree/3.1.2/libraries/LittleFS/lib/littlefs)). This is the source built by the reviewed NodeMCU core, rather than an unrelated latest LittleFS library.

The submodule's [`lfs.h`](https://github.com/littlefs-project/littlefs/blob/6a53d76e90af33f0656333c1db09bd337fa75d23/lfs.h) exposes `LFS_O_EXCL = 0x0200`, `LFS_ERR_EXIST = -17`, and `lfs_file_open()`. This can express **exclusive creation at the underlying LittleFS API** with `LFS_O_WRONLY | LFS_O_CREAT | LFS_O_EXCL`.

**The ESP8266 Arduino `FS::open(path, mode)` wrapper does not expose this flag.** The pinned `cores/esp8266/FS.cpp` parser accepts `r`, `w` and `a` (and their `+` variants); `w` creates/truncates, `a` creates/appends. Pinned `libraries/LittleFS/src/LittleFS.h::_getFlags` does not map `LFS_O_EXCL`. Thus **`LittleFS.open(...,\"wx\")` is not an implementation** and must not be added to the device adapter.

## What this draft actually executes

- A new **host-only C harness** (`tests/firmware_littlefs_pinned_exclusive_host.c`) compiles the **actual pinned upstream** `lfs.c`, `lfs_util.c`, `lfs.h` and `lfs_util.h`, not a fake POSIX-only stand-in.
- The branch CI downloads all four public source files at the **immutable pinned submodule SHA**, verifies their exact **Git blob SHAs** before compilation, and uses a disposable 32-KiB in-memory NOR-like block device.
- The harness tests exclusive first-record creation, byte-for-byte read-back, creation refusal for the same slot without additional program/erase calls, a normal unmount/remount repeat, and a fail-closed read-fault response. These are **host software tests** only.
- The existing Linux `O_EXCL` process-race experiments, firmware static no-write gate, NodeMCU target cross-compile and full website tests remain enabled in branch CI.
- The original `EightSlotLittleFsAdapter.h` retains `writeNew() { return false; }` and uncertain missing-slot classification. The diagnostic sketch still neither mounts flash nor transmits/controls anything.

## What this cannot prove

Even if the pinned C harness passes, a possible future device-side adapter must still have a **reviewed, safe way to obtain a correctly initialized LittleFS instance** with real flash geometry, concurrency exclusion, explicit no-autoformat, and error-aware API results. Reaching into private implementation state or compiling a second flash owner is **not authorized**. This work does not demonstrate MCU-level atomicity under brownouts, physical flash wear or capacity, NOR driver correctness, corrupt metadata recovery, secure device signing, durable cloud receipt, queue ACK/deletion, warning delivery or safe gate actuation.

The host RAM-device simulator uses idealized `sync` and no actual interruption. Its success does not authorize calling a read-only mount harmless or treating missing readings as SAFE.

## Further gates before any physical device write

1. Compare **three options** with failure modes and maintenance cost: a reviewed ESP8266 wrapper extension exposing exclusive creation; a separately isolated tiny storage owner with fully controlled filesystem geometry; or a truly non-overwriting raw-flash record layout. Do not prematurely select a raw-flash implementation based on host results.
2. Produce a code-reviewed build-only adapter contract with error-sensitive absence and no truncate, explicit no-autoformat, no write invocation from the diagnostic sketch, and deterministic fail-closed error-path tests.
3. Obtain explicit owner approval for **separate supervised non-production hardware** tests, flash geometry inventory and pre-test backup plan. Never flash an in-service warning device for storage experiments.
4. Require staged power cuts/brownouts with independent retained-data verification, wear measurements and restart-state acceptance **before** enabling writes in operational firmware.
5. Separately finish authenticated source keys, pinning and rotation, real ESP TLS, receipt-backed retention, read-only public projection and physical UNO alarm/gate release acceptance.

**Only passing exact-head CI permits calling this a tested host research checkpoint; production remains NO-GO.**
