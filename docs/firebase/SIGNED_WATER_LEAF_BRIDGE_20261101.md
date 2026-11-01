# FloodGuard R2/R3 — Signed water receipt → isolated public leaves (OFFLINE LAB ONLY)
Date: 2026-11-01

**Draft research, not an active gateway. Nothing here connects to Firebase, changes production rules, publishes telemetry, sends a warning, or actuates a gate. Production NO-GO.**

## Checkpoint and relationship to other drafts
- This small branch **depends on PR #14 HEAD** `0a93b559170a85228a09bc8d8979d217d8cab51f`, which already includes `planStrictSyntheticPublicProjection`, Stage 7 canonical signed envelopes, Stage 8 signed receipt verification, and a Stage 9 synthetic `DATABASE_CONFIRMED` contract. These components remain lab-only.
- The target layout is the **separate, draft PR #34** `/floodguard/publicTelemetryLabV1` 24-field allowlist, source Git blob `15d07517f2b5fef3fcb10d80a223003935cf48d0`. This lab proposes a strictly bounded *five-field subset* from a water-only frame. It does not import, copy, or replace PR #34 and does not claim that these divergent branches are already integrated.
- Website PR #35 and #36 provide pure monitoring reconciliation and an injected read-side subscription preview. Neither currently consumes this bridge. All remain draft, unmerged, without cross-client acceptance.
- Following operator publication of temporary `/floodguard/live` deny-read/deny-write rules, four anonymous HTTP GET probes returned 401. The legacy clients and saved ESP firmware cannot access that tree. **Never reopen anonymous writes as a way to restore data.**

## Exact non-publishing planner
`experiments/signed-water-leaf-bridge-lab.mjs` delegates to PR #14's existing signed planner first. Only an accepted upstream plan, with exact five fields and an explicit previous-publication checkpoint, is mapped into an immutable proposal for the *new* `/floodguard/publicTelemetryLabV1` root:

- `water/distanceCm` — validated numeric air-gap observation
- `water/levelCm` — validated 25 cm installation-depth derived observation
- `water/status` — reported, source-contract status only; **not an independently certified physical SAFE**
- `system/lastUpdate` — original observation timestamp (not current browser time or a new heartbeat)
- `system/overallRisk` — **always UNKNOWN** because a signed water-only frame cannot establish complete field safety

The bridge rejects schema drift, contradictory water geometry/status, invalid clocks, missing checkpoint and every denial from the upstream planner. It excludes alarm, gate, ESP network metadata, commands, identity/authorization data and private sensor fields. `nextCheckpoint` is merely a proposal, not a persisted or transactionally enforced record.

The upstream prototype currently receives registry state, receipt signing key, and confirmed database record as **caller-supplied parameters**. A production endpoint must not accept these from client input; it needs independently protected authoritative services and a bounded audited publisher. An offline Ed25519 receipt does not by itself prove real-world sensor integrity, installation calibration, physical gate position, human warning delivery, or live availability.

## Test gates
Run `node --test tests/strict-signed-projection-gate.test.mjs tests/signed-water-leaf-bridge-lab.test.mjs` for signature, confirmation, replay, schema drift, and injection negatives; then `npm test && npm run lint && npm run typecheck && npm run build`. Branch-specific SHA-pinned CI must be verified on the latest PR commit. Do not claim a Firebase Emulator read/write integration from these pure offline tests.

## Next deployment-free work
1. Verify receipt signer and operator registry trust roots and their revocation controls from PR #14; trace Stage 9 durability and concurrent source-authority fencing.
2. Integrate both draft branches **in a new disposable composite test workspace** to enforce compatibility with the exact PR #34 projector/rules, without merging drafts into main. Run real Firebase RTDB Emulator tests against scalar public leaves; verify denied parents/secret fields and failure when a privileged writer attempts an object at a public leaf.
3. Design a secured scoped publisher with crash-consistent sequence/epoch checkpoints and a privacy-sensitive field schema; administrative writes bypass Firebase client rules. An operator-controlled server must guarantee exact-field publication and no secret nested-object contamination.
4. Privately review v6 ESP8266 firmware (anonymous legacy parent PATCH, `WiFiClientSecure.setInsecure()`) and v6 Arduino gate/alert safety (calibration bounds and sensor-error buzzer behavior). Build and isolate signed TLS-capable firmware only after approval. The actual flashed image and real gate behavior are not verified.
5. Coordinate optional preview paths across website, Flutter and bot, fault-inject stale/denied reads and alert failures, and separately approve any production rule or firmware release. Keep local physical gate decisions independent from the cloud.

**No production activity authorized or performed by this stage.**
