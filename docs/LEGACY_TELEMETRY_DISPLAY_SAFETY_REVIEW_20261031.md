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
