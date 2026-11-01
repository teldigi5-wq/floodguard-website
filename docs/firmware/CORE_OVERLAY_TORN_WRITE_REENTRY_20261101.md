# FloodGuard R2 — torn NOR-program and recursive-call fault rehearsal

**2026-11-01 · review-only · stacked on PR #63 head `dc9c5fb045d5ca268427d17c071e2ad5b980b8a9`. No firmware flash, production Firebase changes, cloud ACKs, physical gates or live alerts. Production NO-GO.**

## Source and motivation

PR #63 executed the same `LittleFSImpl::createExclusiveLocal` method body from the pinned ESP8266 3.1.2 core overlay against the exact upstream LittleFS submodule on a RAM-backed NOR-like block device. Its prior fault cases simulated full read/program/sync failures. They did not yet exercise **partial in-flight programming**, recursive invocation of the same mounted filesystem owner, or the risk that an uncertain write is falsely reported as successful.

A real electrical brownout is not implemented by this host-only experiment. Its purpose is to strengthen negative tests and document remaining architecture risks before any supervised hardware stage.

## New negative scenarios

- **Partial programming:** the synthetic NOR driver programs only half of one aligned program operation, then returns `LFS_ERR_IO`. The patched core's real method must return `CommitUncertain` and latch per-instance quarantine. Repeated same-instance calls must fail without additional reads, erases or program operations. After unmount the simulated disk may or may not mount cleanly; no automatic format, overwrite or continuation is authorized. If fresh mount succeeds, the old record's exact bytes must be preserved. This host callback is not a reproducible electrical interruption or full crash-replay model.
- **Reentrant call from inside a program callback:** the host driver invokes a second attempted `createExclusiveLocal` on the **same owner** during a first write. The nested call must fail, quarantine the instance and force the outer method to avoid claiming `LocalBytesMatched` even if it can finish some I/O. Subsequent same-instance writes must be refused without I/O. This is *single-thread recursion testing*, not multi-task parallelism or a thread-safety proof.

The experimental overlay adds `_fgExclusiveBusy`, scoped automatic cleanup and a sticky quarantine decision on detected reentry. Its `bool` fields are not atomic, do not serialize independent FreeRTOS/ESP tasks, and do not survive reboot; they are therefore **not an accepted concurrency control for field deployment**. The physical firmware remains read/write-disabled in the diagnostic; the experimental overlay is installed only inside ephemeral CI and never flashed.

## Reproducibility and limitations

The test generator continues to inject the *exact core-overlay method source* into the RAM harness and links the SHA-verified upstream `lfs.c` and `lfs_util.c` files. The CI workflow must pass the expanded seven-scenario harness and existing firmware/security/website regressions. The new scenarios are host-only and synthetic. A passing result proves limited contract behavior for the tested execution schedule, not arbitrary interruption durability, power-fail-safe metadata, ownership safety across tasks, signed sensor identity, cloud receipt, public flood-awareness operation or gate/alarm commissioning.

## Next gates

A hardware candidate requires an independently reviewed single-owner application scheduler or mutex (not a non-atomic flag), explicit memory ownership, fixed path allowlist for eight slots, bounded flash/OTA geometry, no reformat, persistent reboot-safe recovery policy, a matrix of power interruptions at program/erase boundaries on separately approved bench hardware, verified signed/TLS receipts, public stale/unknown display and supervised Arduino UNO alarm/gate acceptance.

**Do not merge, enable storage writes, upload device firmware or deploy safety controls based on these host tests. Production NO-GO.**
