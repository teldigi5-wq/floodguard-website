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

## Secure telemetry migration track · R0–R8 (updated 31 Oct 2026)

This staged research track is **additional** to the earlier website stages above. These statuses distinguish committed/tested laboratory work from actual deployment:

| Stage | Scope | Status |
| --- | --- | --- |
| R0 | Recover and inspect real website/bot/mobile baseline and protected main | Read-only baseline verified; no production promotion |
| R1 | Offline signed ingestion, local replay/receipt persistence and failure rehearsal | Synthetic tests; operational durability and antirollback unverified |
| R2 | Independent water/rain signatures, server receipts, monotonic restricted emulator publication, external operator checkpoints and signed catch-up | **LAB VERIFIED IN DRAFT STACK; PARTIAL** — no independent nonrollback authority or real trust service |
| R3-A | Browser WebCrypto signed-report reader and restricted public RTDB subscription | **LAB VERIFIED, draft PR #25, not mounted** |
| R3-B | Atomic combined report and independently signed issuer receipt verified by browser and RTDB rules | **LAB VERIFIED, draft PR #26, not mounted** |
| R3-C | Operator-pinned, server-side gated ingestion with independently controlled issuer signer | **LAB VERIFIED in draft PR #27**: 11/11 unit, 9/9 RTDB emulator; service deployment absent |
| R3-D1 | Gateway-owned V2 admission timestamp and separately signed source observation, with browser verifier and restricted isolated RTDB namespace | **LAB VERIFIED in draft PR #28**: 10/10 unit, 6/6 actual RTDB emulator; no real issuer or durable commit |
| R3-D2a | Independent signed witness-alignment contract, one-step CAS and crash/rollback rehearsal | **LAB VERIFIED in draft PR #29** — in-memory witness ONLY, actual external nonrollback durability absent |
| R3-D2b-local | Private fsync-backed, signed, append-only witness journal and restart/fault/reconciliation rehearsal | **IMPLEMENTED IN DRAFT, CI PENDING** — local disk only; privileged valid-journal rollback remains possible |
| R3-D2b | Externally durable nonrollback witness, authenticated operator recovery, distributed fencing, real browsers, preview/cutover | **NOT IMPLEMENTED** |
| R4 | Native Flutter verification and consistent stale/unknown UI | Pending and gated |
| R5 | WhatsApp bot signed-alert integration and delivery QA | Pending and gated |
| R6 | Realistic cross-client, network-failure and restore E2E | Pending and gated |
| R7 | Supervised real sensors, calibration and physical gate acceptance | Pending; safety approval required |
| R8 | Security signoff, rollback rehearsal and controlled production release | **NO-GO** |

### Active security and release gates

- Draft pull requests are stacked and **not merged**; protected `main` is not a substitute for a trusted sensor-ingestion system.
- Source and issuer signing keys must be independently enrolled, rotated, revoked and held by distinct trusted identities. RTDB Rules cannot verify Ed25519.
- The V1 signed report still includes source-supplied `receivedAtMs`. The isolated V2 lab removes it and uses a gateway clock-owned signed `admittedAtMs` (gateway admission, NOT RTDB commit); production rollout and real signer custody are still required.
- Local fsync/HMAC-sealed checkpoints do **not** prevent restoration of an older valid snapshot. A separate monotonic, rollback-resistant authority and recovery protocol remain unresolved.
- No lab's successful WebCrypto, Firebase Emulator or regression CI may be described as real hardware, actual browser/mobile acceptance, production deployment, verified alarms or physically proven gate state.
- Before any merging or deployment: review the entire stacked diff, resolve dependency/security warnings, run exact-head CI, verify read-only preview with actual browsers and obtain explicit release authorization.

Verification: GitHub Actions run #41193680165 PASSED on implementation head `863ae4c31861d05f98ac7a48efc4b2f0ea57e3e9` (before this roadmap-only update), including 372 offline tests (366 pass, 6 skip), typecheck, and ESLint 0 errors/9 warnings. Acceptance on the updated head was subsequently rechecked in successful run #41193827264.\n\nReference: `docs/firebase/R3_OPERATOR_PINNED_GATEWAY_LAB_20261031.md`. The original website roadmap above remains the historical baseline; this section tracks the newer evidence-first telemetry migration.

R3-D1 reference (draft only): `docs/firebase/R3_V2_SERVER_ADMISSION_TIME_LAB_20261031.md`. Implementation head `c8509a9e4368d0fe143ea2ad6422a93b7ac5ca33` passed GitHub Actions run #41194508075: V2 10/10, RTDB emulator 6/6, offline regressions 376 pass / 6 skip, 0 TS/lint errors. Revalidate this updated roadmap commit before claiming final exact-head success. No production cutover or physical safety claim.

R3-D2a reference (draft only): `docs/firebase/R3_V2_INDEPENDENT_WITNESS_PROTOCOL_LAB_20261031.md`. Implementation commit `4788ea2953a6189ffb16a3f8072cb0e6a928a5ef` passed Actions run #41195399569 (12/12 focused witness tests, 4/4 RTDB emulator tests, 388 pass/6 skipped offline, 0 type/lint errors). Updated-head validation is required after this documentation and lint-only change. The witness is synthetic in-memory test state: CI cannot prove external durability, nonrollback security or production trust.

R3-D2b-local reference (draft only): `docs/firebase/R3_V2_FSYNC_DISK_WITNESS_LAB_20261031.md`. This is only local fsync-backed signed history. Independent nonrollback storage, production operator credentials and cross-host fencing are still not implemented. CI verification is pending.
