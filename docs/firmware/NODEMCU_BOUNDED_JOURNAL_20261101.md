# FloodGuard R2 — Bounded NodeMCU multi-reading journal lab (2026-11-01)

**DRAFT ONLY. NO production data, Wi-Fi, firmware flash, Firebase rules update, alerts, gate action, automatic ACK or deletion. Release NO-GO.**

## Exact predecessor
Stacked on [PR #54](https://github.com/teldigi5-wq/floodguard-website/pull/54), verified commit `07b0a48f9dc13bbd9d5f37b6590e0c700de829fc`. PR #54 compiled for `esp8266:esp8266:nodemcuv2` with Arduino CLI 1.5.1 and ESP8266 core 3.1.2, and demonstrated a dormant **one-reading** LittleFS store and 209 native truncated-record/CRC checks. It could not hold a second pending reading.

## Implemented, still dormant

- `firmware/esp8266_review_diagnostic/BoundedFrameJournal.h`: portable C++11 **eight-slot append-only journal** over the already versioned FGP1 CRC32 record format. A full scan of each occupied slot verifies exact length, CRC and strictly increasing source sequence before appending. Any gap, unreadable file, corrupt record, uncertain probe or missing storage refuses a write. A simulated reboot can scan records without renumbering. Eight slots are a bounded limit, not an indefinitely usable flood-monitoring queue.
- `firmware/esp8266_review_diagnostic/EightSlotLittleFsAdapter.h`: a **compile-only** ESP8266 LittleFS adapter with separate fixed filenames `/fgq2_0.bin` to `/fgq2_7.bin`. It only creates a missing slot, flushes/closes and never removes, formats, truncates, overwrites or ACKs an occupied record. It is only included in the diagnostic sketch, not mounted or invoked by `setup()`/`loop()`. The old one-frame module remains for regression.
- `tests/firmware_bounded_journal.cpp`: real native C++ tests using the **exact same header included by the NodeMCU sketch**. An injected fake filesystem exercises multiple sequential records, capacity eight/full refusal, reboot rescans, replay, unexpected holes, every truncated prefix, bit flips, full write followed by response loss, partial write then interruption and unknown I/O results. No physical flash has been tested.
- `tests/firmware_bounded_journal_policy.test.mjs`: guards dormant/no-network/no-erase/no-secret/no-gate paths and explicitly checks that a filesystem probe cannot prove absence on all device failure modes.
- Dedicated pinned Actions CI cross-compiles for NodeMCU 1.0 and runs native journal, earlier parser/receipt/frame checks, signed TLS host regression, full Next.js tests, lint, typecheck and build.

## Safety and correctness limitations

1. **No source authentication:** already-signed-looking JSON is accepted as opaque bytes. CRC32 is accidental damage detection only, not Ed25519 signature verification, proof of physical sensor origin or anti-rollback authority. A server must validate independently.
2. **No crash-safe ACK:** there is deliberately no erase, queue compaction, acknowledgment, promotion or succession after eight records. Saturation must escalate as a sensor-health/telemetry-unavailable condition. This is **not a continuous operational replacement**.
3. **No real flash durability proof:** native tests simulate bytes and interruptions, not ESP8266 flash power-loss timing, LittleFS metadata atomicity, wear, brownouts or factory reset. In particular `LittleFS.exists()` may conflate I/O errors with nonexistent paths, so real-world absence cannot be trusted without a stronger design and supervised bench tests.
4. **Single-thread only:** no concurrent publisher, power-fail-safe transaction lock, DMA or multi-process safety has been proven. The adapter's no-overwrite check is not a remotely trustworthy commit fence.
5. **No real TLS or signed device provisioning:** earlier BearSSL function compiles but is never called. There is no device private key/entropy evaluation, public authenticated ingress, production receipt/witness or durable cloud confirmation. Neither HTTP 201 nor 409 authorizes a flash record deletion.
6. **No physical alarms:** the archived UNO's sensor-error/buzzer/gate behavior and fresh/stale warning delivery have not been modified or validated. Do not flash any diagnostic sketch as a flood-warning replacement.

**Next meaningful work:** separate verified device signing/provisioning, a robust power-cut-hardened flash journal design with measured mount/write/rename behavior, a receipt/witness-backed idempotent retirement protocol, and supervised UNO fail-safe/gate verification. Protect GitHub main and review stacked PRs before any release. All current production assets unchanged.

**Exact-head GitHub Actions must pass before marking this stage verified. Production NO-GO.**
