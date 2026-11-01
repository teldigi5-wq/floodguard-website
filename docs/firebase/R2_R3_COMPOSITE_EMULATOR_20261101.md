# FloodGuard — R2/R3 disposable signed-source → public-leaf Emulator (2026-11-01)

**Test-only composite branch. PR #37 + PR #34 integration rehearsal, NOT a live ingress or publisher.** No Firebase production rules, console settings, credentials, deployed website/Flutter/bot, alarms, physical gate or firmware are changed. No real device measurements. **Release NO-GO.**

## Verified upstream baselines
- **Base:** website draft [PR #37](https://github.com/teldigi5-wq/floodguard-website/pull/37), commit `939d5dd212f110b3f1a7293784bcde8763983638`, which stacks on [PR #14](https://github.com/teldigi5-wq/floodguard-website/pull/14) Stage 7 canonical envelopes, Stage 8 receipt verification, and Stage 9 database confirmation / replay gating. The signed bridge proposes five public leaves and preserves risk `UNKNOWN`.
- **Fixture:** byte-for-byte original [PR #34](https://github.com/teldigi5-wq/floodguard-website/pull/34), commit `95871bc28adef28c5fb50b57d320566dc7611a34`:
  - Projector SHA (Git blob): `15d07517f2b5fef3fcb10d80a223003935cf48d0`.
  - Rules SHA (Git blob): `e7083e01b136a087ebefd1138932793ac3e357a7`.
- We stage these files only at `tests/fixtures/pr34/` to avoid prematurely merging two independent draft branches or changing production rules. If the upstream PR #34 files change, the fixture must be reviewed and repinned; no untracked fallback.

## Integration boundary verified in RTDB Emulator
- Synthetic Ed25519-signed Stage 7 envelope, Stage 8 receipt signature and Stage 9 `DATABASE_CONFIRMED` are passed through PR #37's existing offline planner. The caller-supplied operator registry, signer trust root, database confirmation and checkpoint are **NOT** independent authenticated proof, and nothing here could function as a safe remote gateway.
- Only if the planner accepts may the test code serialize its five fixed primitive changes, validate them against PR #34's actual scalar projector, and **seed the loopback-only emulator with security rules disabled**. That seed simulates an administrative publisher under test; it is neither transactional durability nor production authorization.
- Unauthenticated clients must be able to read exactly those five individual fields, but NOT parent paths, group roots, private ESP fields or legacy `/floodguard/live`.
- Anonymous and arbitrarily authenticated users cannot write a field, update a group, modify private ingestion, or send a gate command.
- Forged receipts, signature mismatches, unauthorized/disabled devices, unconfirmed database records and replay never trigger an emulator seed. A reported `SAFE` is NOT a verified hydraulic safety clearance, independent gate position or confirmed human notification. `system/overallRisk` stays `UNKNOWN`.

## Known high-priority gap: public scalar value MUST remain scalar

Firebase RTDB `.read:true` at an individually approved leaf extends to its descendants. If a privileged writer mistakenly stores `{unexpected: "SYNTHETIC_NESTED_NOT_FOR_PRODUCTION"}` at `/floodguard/publicTelemetryLabV1/water/status`, that nested string becomes anonymously readable. One negative emulator test intentionally demonstrates the exposure using synthetic fixture data; the PR #34 projector rejects object-shaped `water/status`. The test's validation **does not** restrict another administrator from writing arbitrary objects in production.

A separately secured publisher must:
- accept source facts only from an independently authenticated, scoped and revocable identity;
- derive a durable independently verified source receipt and replay checkpoint (never from caller-provided JSON);
- enforce exact field paths, schema and scalar types immediately before writing;
- persist publication high-water marks and evidence atomically with the update, including crash/restart and concurrent-authority protection;
- have operational checks to discover and recover from unauthorized or corrupted public leaf values.

**Do not publish PR #34's lab rules, privileged test code, or this composite workspace to production as a ready-made system.**

## Reproducible local run (test project only)

Use a disposable checkout, Node 22, Java 17 and installed development dependencies. No Firebase service account / production tokens.

```bash
npm ci --ignore-scripts --no-audit --no-fund
npm install --no-save --package-lock=false --ignore-scripts @firebase/rules-unit-testing@5.0.2
node --test tests/strict-signed-projection-gate.test.mjs tests/signed-water-leaf-bridge-lab.test.mjs
npx --yes firebase-tools@14.18.0 emulators:exec --only database \
  --project demo-fg-r2-r3-composite \
  --config firebase.r2-r3-composite-lab.json \
  "FG_R2_R3_COMPOSITE_LAB=1 node --test tests/r2-r3-composite-emulator.mjs"
npm test && npm run lint && npm run typecheck && npm run build
```

The runtime test additionally requires `FIREBASE_DATABASE_EMULATOR_HOST=127.0.0.1:9000` as set by the emulator. It fails closed if the opt-in flag or exact loopback host is absent.

## Next prerequisite and release gates

1. Review per-device identity provisioning, certificate validation/clock bootstrap and key custody for ESP8266; the archived v6 firmware uses insecure TLS and anonymous parent PATCH and must not be reused as an authenticated feed.
2. Reconcile and independently verify PR #14's durable receipt/confirmation/high-water state with scope/revocation in a trusted server runtime. Signed sources alone are insufficient for physical safety.
3. Add an emulator-backed actual *read-only* Firebase adapter using PRs #35-36, then independently test client displays for offline/stale/denied values; the current no-source-freshness contract must not assert field clearance or physical servo position.
4. Implement a guarded publisher and transactional read/write evidence with explicit release review, then preview integrated website/Flutter/WhatsApp behavior.
5. Supervised prototype hardware calibration, gate/alarm failure-state and manual override validation; approve any production rule or firmware change separately.

**Verified status must be based on exact-head CI/Emulator results; never claim a real production measurement from these fixtures.**
