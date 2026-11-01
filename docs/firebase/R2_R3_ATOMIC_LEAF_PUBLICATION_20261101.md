# R2/R3 — Atomic isolated water-state publication rehearsal (2026-11-01)

**Emulator-only review. No production gateway, authenticated real device, Firebase Admin SDK publisher, rule change, website/Flutter/bot deployment or gate actuation. NO-GO.**

## Baseline and dependency ledger

- Starts from draft [PR #38](https://github.com/teldigi5-wq/floodguard-website/pull/38), head `fbbbb39c1cb6f2893fa46749bc97068181a6618f`, stacked on PR #37 and the archived PR #14 signed-source research.
- Reuses exact PR #34 public whitelist fixture pinned in PR #38: projector Git blob `15d07517f2b5fef3fcb10d80a223003935cf48d0`; rules Git blob `e7083e01b136a087ebefd1138932793ac3e357a7`.
- **Do not confuse** the private historical `/floodguard/live` tree with the isolated `/floodguard/publicTelemetryLabV1` draft. The owner's deployed Firebase production lockdown remains the operating baseline.

## New transaction candidate

`experiments/isolated-atomic-water-state-lab.mjs` is a *pure* state transition for a caller-supplied test-only root snapshot. It is NOT a publisher endpoint or a secure source of registry and receipt evidence. It is intended for calls from within a disposable RTDB Emulator transaction; callers MUST NEVER pass untrusted HTTP request bodies as the trusted root, operator registry, signer, or durable DB confirmation.

One candidate may update the public `water/distanceCm`, `water/levelCm`, `water/status`, `system/lastUpdate`, `system/overallRisk` (always `UNKNOWN`) **together with** the device's high-water checkpoint. The candidate is declined unless the same snapshot proves:
1. Exact enabled, scope-bound device authorization and single operator-owned primary-water-source election (device ID and epoch).
2. Exact Ed25519 public receipt key fingerprint pinned in the operator-owned water authority; not simply a requester-provided signing key.
3. Staged device frame equals the signed envelope fields; confirmed record matches receipt and digest; Stage 7/8 planner validates signature, observation clock, geometry, water-status consistency and sequence.
4. Existing checkpoint is explicit, valid and same epoch; missing restart checkpoint cannot silently reset to sequence zero.
5. The existing public tree contains only PR #34's approved schema and **primitive scalar** values; every group and field is reviewed. An existing object under `water/status` or unexpected child blocks a new candidate. This does not retroactively conceal previously leaked nested objects.
6. Signed source timestamp never regresses below the current published timestamp, including explicit source handoff; publish/read failure must not assert a physical SAFE conclusion, real servo position or message delivery.

`tests/isolated-atomic-water-state-emulator.mjs` exercises the reducer in real Firebase RTDB Emulator **transactions at /floodguard** using a test-only privileged context and strict loopback guard. This intentionally broad-root privileged test is NOT an acceptable production service privilege design: Admin SDK writes bypass RTDB client Security Rules. Production must use service isolation, audited and least-privilege write authorization, bounded root size, durable confirmation/reconciliation and independently protected source enrollment.

The test simultaneously proves that ordinary anonymous and arbitrarily authenticated clients still cannot write the public tree or read parent/private data under PR #34's pinned emulator rules.

## Known limitations and blockers

- This is a synthesized receipt and operator state, not authenticated ESP8266 transport. Archived firmware still uses anonymous parent PATCH and disabled TLS certificate verification; do not reconnect expecting secure ingestion.
- A proper production publisher needs real operator key provisioning/revocation, storage durability across crash/restart, atomic confirmed-ingest and publication evidence, rate limits, exhaustion handling, data retention, clock discipline, explicit authority handoff and hardware source identity.
- If another privileged operator writes an object into a readable public leaf, descendants become publicly readable under Firebase inheritance. The strict reducer blocks its own publication but cannot prevent or undo other privileged writes.
- Remote alerts, Flutter/web UI, actual safety-critical alarm behavior and servo feedback have not been integrated or field-tested.
- Gate actuation must remain a locally supervised controller responsibility, not an effect of cloud public-field status.

## Verification

The exact-head CI workflow runs Node 22, Java 17, pinned loopback Firebase Emulator, signed planner regression tests, 10 atomic/read-boundary tests, and the full website Node tests, lint, typecheck and Next.js build. Record the *actual* completed head and CI result before marking the lab accepted. Emulator tests do not establish production uptime, detection accuracy or physical safety.

**Release NO-GO. No merge or deployment approved.**
