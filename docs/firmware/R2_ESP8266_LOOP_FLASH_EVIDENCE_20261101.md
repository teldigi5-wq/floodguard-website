# FloodGuard R2 — ESP8266 cooperative loop and flash-layout evidence gate

**2026-11-01 · isolated successor to verified draft PR #67 `43f8beddc4929b95106ab82355df09e6739afa30`. DRAFT/UNMERGED. Production NO-GO.**

## What the source actually supports

The review-only NodeMCU diagnostic targets ESP8266 Arduino core **3.1.2**, with a single Arduino `setup()`/`loop()` flow polling UNO UART frames, checking staleness and calling `yield()`. It has NO active LittleFS mount, automated publisher, cryptographic device identity, cloud receipt, physical gate controller or validated sensor safety. The original field firmware, actual physical flash chip, flash partition table, OTA slot layout and historical filesystem contents have **not been inspected**.

The pinned core declares `ESP.getFlashChipRealSize()`, `ESP.getFlashChipSize()`, `ESP.getSketchSize()` and `ESP.getFreeSketchSpace()`. New `sizeof(ESP.<method>())` expressions in the dormant diagnostic **cross-compile those API signatures without calling any method or reading any physical flash**. The diagnostic is not flashed or activated.

`ReviewFlashInventory.h` is a platform-independent **measurement classification** for a future supervised operator to feed values into. Missing measurements or contradictory sizes are rejected. Even a numerically plausible set of size values returns `RequiresPhysicalPartitionReview`; it **never** permits mount, storage write, firmware upload or OTA. Host fixtures contain synthetic values, NOT real board measurement. The four coarse SDK numbers alone cannot determine the actual LittleFS start/end, bootloader regions, wear characteristics, correct flash mode or physical power-failure behavior.

## Device execution architecture candidate

`CooperativeReadOnlyAuditPump.h` is a portable C++11 **review-only** pump with explicit `submit()` and `pumpOne(reader)`. A future trusted Arduino `loop()` owner could invoke **at most one** pending read callback per loop iteration; there are no threads, timers, task creation or background callbacks in the pump. It wraps the already-reviewed `ReadOnlyOwnerQueue`, checks monotonically increasing request IDs per process, fails permanently after invalid nested draining or a failed reader, and never grants write, ACK, SAFE or gate authority. It is only `#include`d and `static_assert`-checked in the diagnostic, without an object or callback in `setup()` or `loop()`.

**Critical limitations**: This pump is *not* a real lock or thread-affinity check. Its correctness assumes exactly one verified application loop invokes all methods and no ISR, WiFi/SDK callback, watchdog or competing task touches the filesystem. It limits **callbacks per tick** but does not bound callback execution time or guarantee watchdog health. Failure/sequence counters are RAM-only across reboot. The host tests intentionally use fake trusted read callbacks and no flash. They do NOT demonstrate real ESP8266 scheduling, UART latency, signed water data, power-loss durability or actual gate behavior.

## Evidence still required BEFORE any bench hardware changes

- Establish the exact deployed **ESP8266 module, board revision, SPI flash part, actual capacity, firmware image, bootloader/flash mode**, and current physical UNO alarm/gate policy. Do not assume NodeMCU v2 means a particular flash capacity.
- Compare device readings with approved board package settings and independently verified toolchain/linker/partition definitions. Capture a **read-only full flash backup**, determine LittleFS/OTA/sketch region start/end and check overlaps, integrity and recovery with reviewed tooling. Protect serial/device identifiers and any captured secrets; do not paste them into public CI or commits.
- Obtain explicit approval for an **isolated, supervised bench unit**, with safe power isolation, gate/servo disconnected, rollback, owner sign-off, and no production sensor disablement.
- Measure actual boot, UART, watchdog and read latency; profile memory stack and heap and test corrupted flash metadata and timed power interruption on the approved bench. Do not autoformat or discard retained frames.
- Independently design and verify single-owner filesystem access across every SDK callback/ISR, authenticated sensor signing, durable replay, receipt-driven cloud ACK, and conservative public UNKNOWN/STALE reporting. Only then evaluate whether legitimate automated flood warnings can be safely restored without reopening unauthenticated Firebase writes.

## CI requirements and scope

CI compiles and runs seven portable host scenario groups for the cooperative pump and flash evidence classifier (no device I/O). It also compiles the **actual core SDK flash API declarations** and new headers under the pinned ESP8266 3.1.2 NodeMCU toolchain, retains both negative protected-LittleFS-access probes and the isolated single-owner core experiment, and runs the full prior host, ingress and website regressions. **Do not mark CI success until the new exact-head run completes.**

The diagnostic's `EightSlotLittleFsAdapter::writeNew()` remains **unconditionally false**. No firmware upload, physical flash change, Firebase mutation, alert, mobile/WhatsApp cutover or gate operation is authorized.

**Production NO-GO.**
