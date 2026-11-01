# FloodGuard R2/R3 — Executable Emulator publication/recovery coordinator (2026-11-01)

**Isolated, executable Firebase RTDB Emulator only. No production Firebase credentials, public service, deployed witness service, real ESP8266 connection, notifications or gate actuation. This is NOT a production publisher. Release NO-GO.**

## Verified predecessor

This draft is stacked on [PR #45](https://github.com/teldigi5-wq/floodguard-website/pull/45), exact passed head `9371c04ee8b20d4835faf62e9d9909e629ff233b`. Earlier checkpoints established separate local signed-ingress journal, pure signed/revocable atomic publication planner, private per-reading signed history, read-back observation, and synthetic externally pinned witness validation. **None of them implemented one orchestrated database transaction and subsequent recovery path.**

## New executable stage

`experiments/emulator-publisher-recovery-lab.mjs` adds a narrow orchestration function `attemptRetainedPublicationLab`, with **explicitly injected** safe-to-use loopback *test* dependencies:

- `outbox.pending(deviceId)`: reads the **oldest** signed retained event from PR #41's existing sealed journal. There is no dequeue, ACK or compaction.
- `database.readRoot()`: independently obtains the current *protected emulator* root. It checks whether the entry was already recorded with a valid source signature, current authorization, complete signed per-record history and latest public scalar checkpoint. If recorded, it returns `ALREADY_RECORDED_NO_ACK` without a second transaction.
- `database.transactionRoot(reducer)`: executes the existing PR #43 candidate in one real RTDB Emulator transaction. The reducer enforces the signed Stage 8 receipt and digest, device scope/revocation, exact staged source, DB confirmation, replay/epoch, strict public scalar types, historical signatures and checkpoint monotonicity. It does not trust an arbitrary unvalidated sensor frame or enable anonymous parent PATCH. **Privileged transactions at /floodguard are NOT a safe final production design.**
- After every transaction response (including a thrown error / lost response), the coordinator calls `readRoot()` again and **independently** verifies signed historical data. A transaction's `committed:true` alone is *never* proof. It returns `AMBIGUOUS_COMMIT_READBACK_MATCH_NO_ACK` only if independently verified; an unconfirmed or unreadable result is `UNCERTAIN` or `UNAVAILABLE`. There is no false delivered or cleared status.
- Existing signed events are never removed; no witness private key, signing endpoint, Firebase SDK/Admin credential, alert, bot, actuator, firmware key or production URL is present in the coordinator.

## Actual Emulator acceptance

`tests/emulator-publisher-recovery-integration.mjs` provisions **only synthetic** device/receipt keys, a fresh local sealed outbox and RTDB Emulator with the exact PR #34 isolated public-read rules. The test adapter uses `withSecurityRulesDisabled` ONLY to reproduce the earlier privileged /floodguard transaction under inspection; that capability is deliberately **not** an appropriate production permission model. The Emulator suite verifies:

1. An actual committed transaction and independent protected snapshot verify the retained source, signed history and publication checkpoint while leaving the outbox untouched.
2. A retry after a successful commit returns read-only already-recorded status without attempting another root write.
3. A lost response **after** the transaction commits is reconciled from an independent protected DB read; no false failure, duplicate transaction or outbox deletion.
4. A failed transaction **before** commit yields `UNCERTAIN` and retains the reading; a fake `committed:true` without matching read-back also remains `UNCERTAIN`.
5. Invalid server signature, revoked source, nested/malformed public data and an independently unreadable DB deny rather than publish.
6. Anonymous web/mobile-like clients can read the approved public status scalar, but cannot read the root, confirmation/history/authority or write the public status.

All tests use a hard-coded `demo-` Firebase Emulator project, host `127.0.0.1:9000`, and required `FG_PUBLISHER_RECOVERY_LAB=1` environment gate. Dedicated CI additionally executes prior signed outbox/history/witness tests, full website tests, lint, TypeScript and build. **Check exact-head GitHub CI before marking accepted.**

## Critical architecture and remaining release blockers

- This stage **does not implement a production account, endpoint, or IAM policy**. A broad root transaction with Admin privilege bypasses Firebase Rules and could expose nested secret data under publicly readable leaves; a real deployment needs an independently authenticated publisher with an audited narrowly scoped schema and privilege separation. Redesign transactional root ownership rather than promoting this test transaction blindly.
- The `confirmedIngest` record and server receipt in the tests are operator-seeded synthetic values. There is still no real independent durable DB confirmation issuer, network admission of deployed ESP8266, secure device provisioning or verified TLS. A service must not issue its own proof solely by trusting device-provided status.
- PR #45's witness verification requires separately governed key storage and independently monotonic head custody. This coordinator **does not issue or persist witnesses**, so its database read-back cannot be interpreted as externally anchored publication evidence.
- There is **no queue ACK, deletion or compaction** and therefore no guarantee of sustainable operation beyond the research-only eight-reading cap. Before production: design idempotent crash-safe per-message retirement *after* independent issuer/witness confirmation, retention and backup, restored-service reconciliation, clear backpressure and outage escalation.
- Real site, Flutter, WhatsApp and local hardware require stale/denied/offline fail-safe UI, tests of warning delivery/acknowledgment, and supervised sensor-error/buzzer/gate/manual override validation. A reported `SAFE` must never be treated as verified physical clearance or gate position.

**The user-published `/floodguard/live` emergency lockdown, original firmware and all production clients remain unchanged. No merge/deploy; release NO-GO.**
