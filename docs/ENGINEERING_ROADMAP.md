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

## 1 November 2026 — R2 durable signed admission payload journal (draft)

**Crash-recovery gap identified:** The existing localhost TLS handler in PR #14 commits only device `epoch/sequence/public-key fingerprint` to the Stage 7 sealed replay ledger before returning `LOCAL_LEDGER_ACCEPTED_ONLY`. It does not retain the complete signed sensor payload. A process loss between acceptance and durable cloud publication may therefore consume the frame's sequence while making the content unrecoverable.

**Isolated candidate branch:** `test/r2-durable-admission-outbox-20261101`, stacked on PR #39's passed atomic RTDB Emulator base. The new `experiments/durable-admission-outbox-lab.mjs` is an **alternative research-only journal**, not yet used by the HTTPS handler or production service. It persists validated canonical signed envelopes and per-device replay high-water together with HMAC integrity, owner-only files, durable local rename/fsync, bounded queues, and fail-closed restart/tamper/missing-history handling. The 11 focused synthetic tests are in `tests/durable-admission-outbox-lab.test.mjs`; final exact-head CI result must be checked before acceptance.

**Remaining hard gates:** Independent server-controlled identity and receipt verification, real ESP8266 TLS+key custody, durable end-to-end admission/publisher transaction/ACK with crash ambiguity and revocation fencing, cloud rollback recovery, operational capacity, signed event freshness, offline physical safety and human notifications. Do not confuse a local sealed outbox with guaranteed cloud delivery. All production rules, devices and deployments unchanged; **NO-GO**.

## 2026-11-01 · R2 — opt-in local TLS admission with complete-frame recovery

**Review-only, staged after PR #40.** The existing localhost HTTPS signer/clock/identity validator now supports an optional commissioned, sealed `admissionJournal` instead of the older `ledger`; using both fails configuration validation. Legacy ledger mode remains unchanged. A valid local TLS signed admission journals the full canonical frame/signature/digest and high-water under the same local locked durable write before sending **201 LOCAL_DURABLE_ADMISSION_ONLY**. Duplicate replay denies. Readiness is independently checked before and after the bounded TLS body, and the journal revalidates identity/clock/signature during its own commit.

**Security correction:** an independently HMAC-sealed, marker-first commissioning record prevents accidental replay-history reset through deletion of only the journal file. Both files or the HMAC key can still be rolled back by a privileged adversary; this is not an external monotonic anchor. Marker-only partial initialization fails closed. There is still no verified cloud publication, device firmware migration or end-to-end alarm delivery.

New real loopback HTTPS regression tests and branch-scoped CI run alongside legacy transport tests, Stage 7 and complete website checks. **Verify exact-head CI before accepting.** No production Firebase rules, main branch, actual sensor hardware, websites/apps or gate operations changed. **Release NO-GO.**

## 2026-11-01 — R2/R3 read-only signed outbox to publication evidence reconciliation

**Review-only follow-up to PR #41**: `experiments/confirmed-outbox-reconciliation-lab.mjs` checks an original sealed signed entry and pinned device key against an independent signed Stage 8 receipt, protected `confirmedIngest` record, exact atomic publication checkpoint, and strict PR #34 scalar public telemetry snapshot. Requires exact sequence/digest/source authority/receipt issuer and detects superseded, revoked, malformed or nested public state. Returns `SYNTHETIC_DB_SNAPSHOT_MATCH_NO_ACK` **with `canAcknowledge:false`**; there is intentionally no journal deletion or queue compaction.

New offline signed-journal tests, live-loopback RTDB Emulator snapshot/read authorization negatives, exact-branch CI and `docs/firebase/R2_R3_CONFIRMED_OUTBOX_RECONCILIATION_20261101.md`. **Exact-head CI must pass before acceptance**. The test obtains authoritative-looking data by synthetic privileged emulator seeding, not an authenticated production publisher; this does not establish independent cloud authority, real alert delivery, source freshness or physical gate safety. Next gates: independent signed durable publication authority, stable per-record confirmation history and atomic crash-safe ACK, external anti-rollback, secure real-device TLS/provisioning, UI/bot cutover and supervised hardware release. Production Firebase lockdown maintained; no main merge/deployment; **NO-GO**.

## 2026-11-01 — R2/R3 signed per-reading publication history (emulator-only)

New isolated branch based on [PR #42](https://github.com/teldigi5-wq/floodguard-website/pull/42) verifies the missing **historical record retention** prerequisite for eventual outbox reconciliation. `experiments/immutable-publication-history-lab.mjs` wraps PR #39's existing atomic signed/revocable water publisher candidate and proposes retaining each signed Stage 8 receipt and approved scalar projection under **private** `publicationHistoryV1` in the *same test transaction* as the current public telemetry leaves and publication high-water. It checks old history, issuer pin, source timestamp monotonicity, current checkpoint/public state coherence, replay and private schema. The lab caps history at 8 entries and fails closed when full. It never acknowledges, deletes, publishes to production, or operates physical hardware.

Offline and real RTDB Emulator tests cover two signed frames, preservation of previous receipt, denied anonymous read/write of private history, replay, forged/revoked signer, missing/tampered evidence, nested public scalar injection and capacity. Verify exact-head CI before marking accepted. This history is only append-only **by code convention**: a privileged Admin writer can forge or roll back both history and public state. Independent trust anchoring, real ESP8266 cert-verified TLS and source identity, durable service-issued DB confirmations, bounded operational retention and crash-safe per-reading ACK/backup remain required. Production **NO-GO**. Existing user-published `/floodguard/live` lockdown, firmware, website/mobile/bot production, gate/alert hardware and `main` unchanged.

## 2026-11-01 — R2/R3 older retained reading to signed historical record read-back

New **read-only test-only** `experiments/historical-outbox-observer-lab.mjs` is stacked on verified PR #43. It verifies an actual signed retained local outbox entry against **its own** private `publicationHistoryV1/entries/s_<sequence>` record even after the latest high-water and public water values have advanced. It checks the complete bounded history's Stage 8 Ed25519 receipt signatures, current issuer pin/source authority and revocation, the latest protected DB confirmation/checkpoint/public primitive schema, and exactly matched older source digest/time/measurements. It never allows ACK, dequeue, compaction or gate/alert activity, and an observed match does not prove real-world sensor accuracy or delivery to humans. The test fixture uses real RTDB Emulator read-back and existing signed journal; check exact-head CI before accepting. A privileged administrator can still rewrite the protected database, so this evidence is NOT externally immutable; independent authenticated publisher, anti-rollback authority, verified ESP TLS, crash-safe ACK and hardware safety remain **NO-GO** release gates. No Firebase production rules changes, merge or deployment.

## 2026-11-01 — R2/R3 independently pinned witness + external monotonic head rollback experiment

**Draft stacked on PR #44**. The `experiments/pinned-historical-witness-lab.mjs` read-only verifier extends existing source-signed journal/history reconciliation by checking a separately pinned Ed25519 witness signature over a canonical full private history hash and the newest protected publication checkpoint. Crucially, it also requires a separate operator-held latest monotonic head (sequence, digest, history hash), because a matching *old* signed witness and reverted Firebase snapshot are **not** proof that the data is current. Tests include a real Firebase RTDB Emulator rollback of the private root while retaining newer external-head evidence, distinct-key pinning, invalid signatures, bad public scalars, stale timestamp, missing external head, and no outbox acknowledgment.

**Limit:** There is currently NO real independently secured witness issuer or monotonic external store! The lab accepts synthetic operator-provided keys and heads and therefore cannot establish production-grade anti-rollback or independently signed delivery. Signature checks alone cannot prevent privileged rollback if the witness keys or external head are also compromised. No ACK, dequeue, deletion, Firebase production writing, website/Flutter/bot rollout, firmware flash, or gate control. Verify exact-head CI before acceptance. Real source TLS, least-privilege publisher, trusted remote witness and crash-recovered per-reading delivery remain release gates. **Production NO-GO.**

## 2026-11-01 · R2/R3 executable emulator publisher recovery coordinator

New draft stacked on verified PR #45 introduces `experiments/emulator-publisher-recovery-lab.mjs` to **actually orchestrate** retained signed journal reading, one RTDB Emulator atomic publication candidate, independent database read-back and recovery from lost/ambiguous commit response. A valid already-published older record is observed without a second transaction. The result is **always `canAcknowledge:false`**, never a queue delete, witness issuance, notification, gate action or production release. Dedicated real Emulator tests verify successful commit, already-recorded retry, lost after-commit response, pre-commit failure, fake committed flag, forged receipt, revoked source, corrupted public scalar, DB read failure and anonymous access separation. CI runs previous signed outbox/history/witness plus full website regression. **Check exact-head CI before acceptance.**

Critical: The Emulator's rules-disabled `/floodguard` parent transaction has broad privileged access; it is **NOT a reviewed least-privilege production publisher**. Device and DB confirmation/receipt identities are synthetic; there is no independently durable issuer, deployed witness monotonic store, ESP8266 verified TLS/provisioning, safe queue ACK/retention or real alert/gate acceptance. The deployed user `/floodguard/live` lockdown, `main`, firmware and apps remain untouched. **Production NO-GO.**

## 2026-11-01 — Scoped authenticated publisher capsule V2 (review-only)

Following verified PR #46 (real Emulator transaction/readback with a broad privileged `/floodguard` parent), a new disposable RTDB root `/floodguardPublicationLabV2` is proposed for **public water/system primitive fields + private high-water + signed receipt history only**. New lab Rules permit **only** one synthetic issuer-provisioned authenticated publisher UID + custom claim to transact the capsule; deny that publisher any access to the old `/floodguard` private device-authorization, IP/Wi-Fi, and legacy paths. Anonymous readers can access approved individual public leaves but not ancestor trees, checkpoint/history or writes. Server-side signed Stage7 source and Stage8 receipt checks, schema/range validation, replay and per-sequence history remain required. Real RTDB Emulator tests must demonstrate denial of privileged publisher attempts to inject object-valued public leaves or modify unrelated private state; exact-head GitHub CI is the acceptance gate.

**Unsolved:** synthetic Auth claim is not real provisioning; source authorization and external receipt confirmation remain separate domains, so revocation races are not fenced by the capsule transaction. No independent witness storage, crash-safe queue ACK/retention, verified ESP8266 TLS, live website/Flutter/WhatsApp monitoring or supervised physical gate acceptance. Emulator fixture Rules are **NOT** production rules. Keep the owner's deployed emergency lockdown and `main` unchanged; all PRs draft/unmerged. **Production NO-GO.**

## 2026-11-01 — R2/R3 operator-fenced publisher lease (isolated RTDB Emulator)

Draft stacked on verified PR #47. New `experiments/publisher-revocation-fence-lab.mjs` and `floodguardPublicationLabV3` Rules fixture add an **operator-controlled, in-capsule enabled/epoch/lease authority record**, which the publisher must retain unchanged during each signed water/receipt/history transaction. The authenticated publisher's exact UID/lease/epoch token claims are checked against *current* authority by Firebase Rules; a separate, synthetic operator role can irreversibly revoke `authority/enabled` without gaining publication rights. Emulator tests must demonstrate that an old publisher token or prepared write is rejected after durable operator revocation, private parent Wi-Fi/auth trees are inaccessible, public scalar validation remains strict, malicious authority mutation/root deletion fails, and all sensor readings remain buffered with **no ACK**.

**Residual production blockers:** claims, device keys and receipt signers synthetic; this fences publisher lease only, *not atomically external device revocation*. No independent issuer, audited key custody/anti-rollback witness, real ESP verified TLS, cloud-confirmed delivery, safe queue retirement or supervised alarm/gate validation. Strict live `/floodguard/live` lockdown, main and deployed clients/hardware unchanged. Verify latest exact-head CI before accepting; NO-GO.

## 2026-11-01 — In-transaction device-source revocation / source key pin (V4 lab)

Draft stacked on verified PR #48. A new isolated capsule `/floodguardPublicationLabV4` adds private owner-provisioned `device/{deviceId,epoch,enabled,sourceKeyFingerprint}` alongside the existing publisher lease, signed water history and replay high-water. The new pure reducer checks the Ed25519 SPKI fingerprint, device epoch and current enabled status, while **actual RTDB Emulator Rules** ensure the device record is unchanged in publisher transactions and allow a distinct operator only one-way `enabled:true → false` revocation. A publisher token and a prepared signed transaction cannot publish after committed device revocation, even if the publisher lease remains valid. Public telemetry leaf reads are also denied after device revocation to prevent new reads of stale SAFE; cached client displays still need explicit offline fail-safes. No outbox ACK/dequeue, silent re-enable, real key material or firmware actions. Verify exact-head CI before marking complete.

**Not equivalent to real physical-device authorization:** device/source binding and receipt key provisioning are synthetic; Admin privilege bypass, compromised publisher damage, separate external registry reconciliation, real ESP8266 TLS/key custody, independent durable receipt/witness, sustainable queue and physical water/gate safety remain release NO-GO blockers. All branches draft/unmerged; live lockdown remains intact.
