# FloodGuard · Engineering roadmap

This is an engineering plan, not a list of already delivered product claims.

## Current verified baseline

- Public GitHub repository, GitHub Actions source tests, lint, TypeScript and static Next.js production build
- Read-only Firebase RTDB monitoring using allowlisted child listeners, Zod validation and original field timestamps
- A 3D representation of the reported SG90 model gate, rainfall, device, water and alarm views
- Source-truthful `live` / `last recorded` / `unavailable` distinction; pure unit tests for timestamp classification
- Read-only diagnostics of field timestamps, reported group coverage and the Firebase browser connection
- Vercel automatic deployment from `main`
- Dependabot update configuration and CodeQL source analysis workflow (results must be reviewed in Actions/Security)

## Stage 1 · Public-release security gate

**Implemented in repository:** environment template, safe client reads, no web actuator commands, documented trust boundary, reporting policy, a reference RTDB rules template, dependency tooling.

**Remaining external verification:**
- Review Git history with a dedicated secret scanner and rotate any detected credential; simple pattern inspection is not a formal guarantee.
- **Active finding (13 Oct 2026):** Unauthenticated reads of ESP8266 IP/Wi-Fi metadata succeeded against the deployed RTDB. Fix the actual parent/child read grants; verify those reads are denied while safe telemetry and authenticated hardware writes still work.
- Review CodeQL findings and dependency advisories when automated scans complete.
- Decide whether and how to license the repository; public source is not automatically open-source.

## Stage 2 · Monitoring reliability and diagnostic UX

**Implemented:** field freshness model, retained observations, missing-data states, read-only diagnostics page, historical device/gate status correction, unit tests.

**Next:** persistent history/observability. Introduce a bounded append-only history schema with timestamps, units, calibration provenance and retention. Avoid client-authoritative writes to trusted telemetry history. Add trends **only after real data is stored**.

## Stage 3 · Engineering verification

- Firebase Emulator testing for read/write authorization
- Client subscription integration tests, retry/backoff behavior and degraded-network scenarios
- Playwright tests for navigation, small screens, dark mode, reduced motion and scene fallbacks
- Accessibility checks (keyboard navigation, focus, color contrast, live-region announcements)
- Reproducible hardware/ESP test fixtures that clearly identify **test-only** data, never published as real live readings

## Stage 4 · Production-quality operations

- Secure, scoped hardware identity and ingestion pathway
- Diagnostics for field upload success, missing heartbeat, data schema versions, sensor calibration and telemetry health
- Formal documented incident/degradation procedures and runbooks
- Performance budgets for Three.js and mobile, measured on real devices
- Versioned engineering releases with change logs and reproducible deployment evidence

## Non-goals and boundaries

FloodGuard remains an **educational prototype**: no claim of certified prediction, automatic emergency dispatch, public-safety reliability, or real-world dam operating authority.

We prioritize correctness and transparency over visual effects that imply unsupported sensor precision or live activity.

## 1 November 2026 · R2/R3 signed water to isolated primitive-leaf bridge (draft)

A new **offline-only** `experiments/signed-water-leaf-bridge-lab.mjs` adapter and negative tests reuse PR #14's existing Stage 7/8/9 signed, confirmed and replay-fenced projection planner. They *propose* five child scalar fields under PR #34's new `/floodguard/publicTelemetryLabV1` schema, not the legacy `/floodguard/live` tree. No Firebase client, Admin SDK, network access, physical gate, notification or publisher is introduced. Signed source evidence is still operator-supplied test input rather than a production trust anchor.

The upstream planner's `system/overallRisk` remains `UNKNOWN`; a reported `SAFE` is not a certified field-clearance decision. An implied physical gate position is always `UNVERIFIED`. The bridge is on a standalone review branch based on PR #14; PRs #34-36 remain independent draft branches, and **their integrated runtime compatibility is not yet verified**.

Upcoming gates: verify Stage 9 confirmed-database and durable checkpoint atomicity; independently attest trust anchors/revocation; combine branch code in a disposable Firebase Emulator integration workspace; safely handle real ESP8266 TLS/identity migration, and coordinate website/Flutter/WhatsApp previews. Do not restore anonymous RTDB writes, publish rules, actuate/flash hardware or claim a functional real-time service. **Release NO-GO.**

## 1 November 2026 — R2/R3 disposable Firebase Emulator composite

**Review-only test branch**, based on draft PR #37 (head `939d5dd212f110b3f1a7293784bcde8763983638`). It pins **exact original source/rules blob SHAs** from draft PR #34 under `tests/fixtures/pr34/` and exercises the existing signed Stage 7/8/9 → public-leaf planner with real `@firebase/rules-unit-testing` Firebase RTDB Emulator access checks. Dedicated `firebase.r2-r3-composite-lab.json` binds database only to loopback, never production.

Covers signed/confirmed synthetic water WARNING/SAFE, fixed five primitive fields, denial of parents/ESP networking/private and legacy feed reads, anonymous/authenticated write denial, malformed/forged/unconfirmed/replayed evidence and unsafe object-shaped leaf exposure after privileged emulator seeding. **Known unavoidable Firebase rule property:** a public leaf read grant inherits to descendants if a privileged Admin writer accidentally stores a nested object. The future authenticated publisher must independently enforce scalar schema and exact-path writes. No real authenticated transport, admin publisher or cross-client cutover is present; exact-head CI and emulator evidence are still required. All drafts remain unmerged; **NO-GO**, no sensor activation or gate control.

## 2026-11-01 · R2/R3 isolated atomic publication candidate (emulator only)

Review-only branch stacked on [PR #38](https://github.com/teldigi5-wq/floodguard-website/pull/38). Adds `experiments/isolated-atomic-water-state-lab.mjs` (pure guarded RTDB root-state candidate), `tests/isolated-atomic-water-state-emulator.mjs` (real loopback-only `@firebase/rules-unit-testing` transaction and authorization failures), branch-scoped CI, and `docs/firebase/R2_R3_ATOMIC_LEAF_PUBLICATION_20261101.md`.

The state reducer requires source-authority and Ed25519 receipt-signer pinning, exact staged frame and confirmed receipt, approved device scope, explicit durable replay checkpoint, strictly scalar PR #34 public-field schema, and non-regressing public event time. It proposes one all-or-nothing change to five water/system fields plus the sequence/digest checkpoint; does NOT perform actual protected production writes, authenticate hardware, or establish verified sensor freshness or gate safety. Broad emulator-only root transactions **must not** be copied as unrestricted Admin production service privileges. Validate actual exact-head CI before accepting this stage.

The user-published anonymous deny-read/write Firebase lockdown is unchanged. Firmware, client and alert restoration, safe device identity/TLS, durable production publication, public data corruption remediation, hardware gate fail-safe, emergency alert delivery and independently reproducible physical tests remain release blockers. **Production NO-GO; drafts remain unmerged.**
