# FloodGuard R3 H15 — Gate-page physical-safety display containment

**4 November 2026. REVIEW-ONLY / DRAFT / UNMERGED / NO DEPLOY / PRODUCTION NO-GO.**
Stacked on the effective-rules export research PR #106 at `f27b8da9e5a8755070efd7e3450763529207bc54`.

## Reproducible problem in actual website UI

The published website source previously recomputed gate state from **servo angle alone**, so a contradictory controller status `OPEN` at `0°` could appear `CLOSED`. A field timestamp could also make a gate countdown appear physically active; other labels asserted a `trusted live state`, `center spillway sealed`, `Gates sealed` and `Water retained behind closed gates`. None of this is independently verified by the unsigned Firebase RTDB children. The H11 independent signed consumer remains a synthetic research verifier, not deployed to the website.

## Targeted changes

- New pure `lib/gate-observation-view.mjs` requires a coherent gate status, angle and countdown through the repository's existing `reconcileReportedGateStatus` before **displaying a recent controller report**. Missing or contradictory fields become `UNKNOWN`; stale records never assert a current gate position or running countdown.
- The actual `app/gate/page.tsx` consumes this policy. Reported states visibly say **UNVERIFIED**; controller countdown is a report, not a real-world timer. There is no `CLEAR` gate warning or physical-closure assertion from missing readings, and the primary risk card identifies its values as unsigned reports.
- The `components/dam-scene.tsx` 3D scene stays navigable but is explicitly **illustrative**. When no coherent, timestamp-recent gate angle exists, the HUD says UNKNOWN rather than converting the model's neutral rendering pose (0°) into a claim that a real gate is CLOSED. Flow intensity is only modeled, not a measured discharge.
- A synthetic offline negative-test suite covers mismatched status/angle, missing angle, stale/unknown, coherent reported states, malformed countdown, and source checks preventing the strongest physical-safety claims from returning. No Firebase, API keys, hardware, alerts or live WhatsApp services are involved.

## Not evidence of field safety

A consistent report can be forged; a green CI build is not actuator verification. This stage does not authenticate a device or validate gate firmware, speed, calibration, interlocks, flood conditions, alarm/warning delivery, independent witness or Firebase Rules actually deployed. The site's other risk/water pages and all mobile/WhatsApp release acceptance remain separate review tasks.

**Do not merge or deploy to a safety-relied-on system without supervised owner acceptance, the authenticated independent sensor/witness path and a manual-warning fallback. No changes to Firebase Rules/IAM, credentials, field devices, gate commands, or WhatsApp messages. Production NO-GO.**
