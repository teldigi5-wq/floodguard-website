# FloodGuard R3 — Revocation and confirmation races at the real emulator write boundary

**2026-11-02 · stacked successor to verified draft PR #85, SHA `9a3405c9d7d81615dcee16bbda8b16f1274f97f1`. OPEN DRAFT, UNMERGED, PRODUCTION NO-GO.**

## Threat and purpose

PR #85 uses actual local Firebase Auth Emulator-issued service tokens plus a separately seeded `serviceWorkerAuthorization` enabled/generation fence in the **unpublished** RTDB Rules candidate. PR #85 proved denial when credentials are already stale *before the application begins*. It did **not** independently prove that the database refuses a write if the worker verified the device and service while authorized, but the operator revoked or rotated authorization **between that read and the final database commit**. An application-only cached authorization check would be vulnerable to this TOCTOU race.

This lab adds a deterministic, **test-only nonce-gated precommit barrier** to `experiments/r3-isolated-service-confirmer-worker.mjs`. It is enabled **only** by `FG_R3_PRECOMMIT_RACE_TEST=1` on the pinned `demo-r3-isolated-service-confirmer` localhost Auth+RTDB Emulator worker, which already cannot run without child IPC and test-only project guards. All other worker runs use the original immediate write path. The barrier:
- Activates only for a single fixed `PUT` of the immutable confirmed-record leaf after Ed25519 signed frame/Stage 8 receipt validation and the existing independent authorization/staging reads.
- Emits a random nonce and a test-paused message to the **trusted local harness**, not over any HTTP listener or cloud interface.
- Allows the test harness to modify a local **operator-owned emulator fixture**, then releases the paused operation with the same request ID and nonce. Bad/unmatched release calls cannot authorize writes. A 6-second watchdog denies a lost permit; the barrier never grants database access itself.
- The actual Realtime Database Emulator evaluates its previously defined Rules **when the write occurs**. The test does not mock the RTDB authorization decision or substitute a JSON rules evaluator.

The expanded tests in `tests/r3-isolated-service-confirmer-ipc-emulator.mjs` use actual Auth Emulator-minted scoped credentials and an independently fixture-seeded operator record. Six new cases:
1. Control: nothing changes during the barrier; a fully signed, authorized immutable confirmation commits.
2. Revoke **service enabled** during the pause: the previously authorized worker cannot create the record.
3. Rotate **service generation** during the pause: the worker's earlier token is rejected.
4. Revoke the **device** during the pause: a previously signed valid frame cannot be confirmed afterward.
5. Advance the **staged frame sequence** during the pause: the older verified frame cannot create a stale confirmed record.
6. Inject an already existing **different immutable record** during the pause using only the privileged emulator fixture: the original write cannot overwrite it and the worker must not misrepresent it as successful signed confirmation.

Only the test worker is modified. The previously audited unpublished Rules candidate, real Firebase configuration, live data, public telemetry, Flutter app and WhatsApp bot remain untouched.

## Interpretation, safety and remaining defects

These tests prove the emulator's **single-write Rules evaluation and write-once behavior** in the tested race interleavings, **not** a global atomic transaction across service credentials, identity revocation, historical signature verification, database and independent witness. No test guarantees all possible real distributed schedules, network partitions, queued writes, clock skew or power-loss behavior. The child and harness still share the CI operating-system identity. A stolen **currently valid** service bearer token may continue to bypass arbitrary Ed25519 verification and create schema-valid forged records; the test-only barrier does not prevent that. A privileged Admin RTDB identity can bypass Rules. A separately protected mandatory cryptographic verifier and write identity, real IAM, credential lifecycle, independently confirmed durable storage and monotonic witness remain unimplemented.

The publisher is still **disabled**; no field ESP8266 signed source, flash/power cut evidence, real alert delivery, safe cloud ACK or supervised UNO gate commissioning has been verified. The existing live flood monitoring/alert paths must not be interrupted by promoting this incomplete candidate.

The dedicated pinned Node 22, Java 17, Auth/RTDB Emulator workflow must pass with **20/20** integration cases, and the full pinned ESP8266 NodeMCU/LittleFS, security, website lint/types/build CI must pass at the **exact PR head**. Note any separate Vercel build-rate-limit status accurately, without triggering paid deployment.

**No merge, deploy, production Firebase/IAM/rules/data changes, hardware flash, alarms, warning/WhatsApp messages or gate movement. PRODUCTION NO-GO.**
