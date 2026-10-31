# Isolated legacy telemetry display-safety correction

**Draft change directly based on protected `main`. No deployment, Firebase rule write, sensor command, WhatsApp or physical gate activity.**

This small reviewable extraction contains **only fail-closed browser display changes**, brought over from the tested R3 security review (PR #31). It does **not** merge the 397-commit telemetry migration, import experimental signing services or activate R2/R3 source attestation.

## Why the current website needs this

The existing website subscribes independently to Firebase water, rain, gate, alarm and system children. A fresh `system.lastUpdate` and browser connection are not cryptographic proof that those specific sensor/alarm readings are fresh or genuine. The original dashboard can display `LOW` and alarm `CLEAR` using this shared heartbeat; malformed water distances above the 25 cm installation assumption can be clamped to a displayed zero-level `SAFE` reading; incompatible gate status and reported servo angle can be silently coerced to `CLOSED`.

## Precisely scoped mitigation

- `lib/telemetry-safety.mjs`: pure display-only water, rain, risk, gate and alarm reconciliation. No Firebase SDK, network, secrets, hardware or writes. Out-of-range air gaps and missing water observations fail closed; reported WARNING/DANGER are not silently lowered. Inconsistent reported status/angle/countdown fails to UNKNOWN, never inventing a physical gate position.
- Legacy system-heartbeat-based `freshness=live` **cannot display `LOW` or alarm `CLEAR`**. An otherwise LOW risk becomes `UNKNOWN`; a current but unsigned alarm Boolean false becomes `INACTIVE REPORTED`. An explicitly independently verified clearance is supported at the pure helper boundary, but the legacy provider does not set `verifiedClearance:true`. Higher reported hazards remain visible. This is conservative communication, **not a real sensor integrity guarantee**.
- Invalid/denied individual critical child payloads remove cached safe-looking evidence; independently tracked critical listener failures cannot be cleared by unrelated healthy callbacks. Public Firebase reads remain restricted to the pre-existing child paths; network metadata is never subscribed to.
- Shared dashboard, compact metrics and observation snapshot apply the same alarm interpretation while preserving the raw Boolean in downloaded JSON for provenance.

## Evidence required before any merge

The branch must pass **`main`'s native `pull_request` CI**: locked install, full offline Node test suite, ESLint, TypeScript and Next.js build. Focused regressions cover malformed sensor measurements, reported gate conflict, invalid sibling events, status snapshot and unsigned LOW/CLEAR suppression. Real device/sensor field tests and physical gate behavior are not covered.

This change deliberately does not implement device enrollment, signed ingestion, independent per-source freshness, durable antirollback, production Firebase privacy verification or cross-application alert guarantees. Those remain separate release blockers in draft PR #31 and the larger migration stack.

**Release decision: DRAFT REVIEW ONLY — production NO-GO.**

## Cross-page safety-claims review (31 October 2026)

A follow-up inspection found the separate gate page **recomputed OPEN and CLOSED from the servo angle** even though the provider's reconciler had already rejected contradictory gate status/angle reports. The page also described the prototype as a trusted live physical gate, asserted a physically closed gate during its countdown and described a synthetic 3D water animation as live release. The reusable 3D model derived hydraulic flow entirely from the last reported angle, not measured discharge.

This main-based draft now uses the provider-reconciled gate status as the gate-page authority: a rejected `UNKNOWN` state cannot be overridden by the angle. It labels countdown values as **recorded, not running**, renders gate position as **reported, not physically verified**, and marks the 3D flow model and gate lift as **illustrative**. The simulated hydraulic animation is intentionally retained for demonstration but is never evidence of actual flow; no gate commands or Firebase writes are introduced.

Shared heartbeat language is also qualified: the navbar status badge, dashboard, diagnostics, home hero and footer distinguish a recent **system timestamp** from authenticated, independently fresh field-sensor data. An unverified Boolean alarm `false` is described as a reported inactive flag rather than a verified `CLEAR`.

Automated guard: `tests/gate-illustration-claims.test.mjs` checks the key pure gate-contract disagreements and critical cross-page display wording/absence of angle-derived override. These are source-contract regressions, **not browser visual/E2E or hardware tests**. Actual browser layout and 3D motion still require device QA.

**No change to physical hardware, firmware, real Firebase security rules, mobile, WhatsApp, production hosting, or the main branch. Production remains NO-GO.**
