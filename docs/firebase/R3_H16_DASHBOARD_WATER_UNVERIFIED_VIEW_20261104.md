# FloodGuard R3 H16 — primary dashboard and water safety-display boundary

**4 November 2026 · DRAFT / NOT DEPLOYED / NO-GO.** Stacked on website H15 draft PR #107, pinned HEAD `417ca470844d42beb92cfc9fa6e4f26f3e75e051`.

## Actual UI defect addressed

The `app/dashboard/page.tsx` main heading and risk card displayed a bare `LOW` risk; the source provenance warning appeared only elsewhere. The `app/water/page.tsx` hero called the reading the "Actual dam water level" and highlighted an active `SAFE` threshold from an unsigned Firebase value. Fresh RTDB timestamps, sensor labels and matching numeric values cannot establish the physical sensor or the controller's calibration, current water conditions, or field safety.

These pages already consumed some normalized source values, but were not using a fail-closed **presentation** contract for the primary safety-facing indicators. The actual shared RTDB provider still lacks operational H11 signed evidence.

## Review-only correction

- `lib/dashboard-water-observation.mjs` separates **current physical risk: UNKNOWN · UNVERIFIED** from **reported** risk labels. A recent `LOW` report is visible as `REPORTED LOW · UNVERIFIED` and does not highlight a green LOW all-clear. Reports of potential MODERATE/HIGH/SEVERE/CRITICAL remain visible as unverified leads.
- The current numeric water level/air gap only appears when the database observation is timestamp-recent and normalized; stale values are shown only as last-recorded context. Prototype LOW/SAFE band is **never highlighted as proof of physical safety**. Reported WARNING/DANGER conditions remain flagged for investigation.
- Dashboard gate and countdown readouts reuse H15's `describeGateObservation` instead of raw gate status/angle. Alarm `CLEAR` appears as **REPORTED OFF · UNVERIFIED**, not as independently attested physical silence.
- Water page explains prototype thresholds as **design assumptions**, not firmware certification. No claim that the Arduino genuinely executed a countdown or opened the gate has been added.
- Synthetic negative tests verify fresh LOW, stale CRITICAL, missing sensors, recent SAFE, high risk, invalid readings and actual page wiring. The new helper is purely synchronous and read-only, without network, Firebase Admin, signing keys, WhatsApp or physical I/O.

## What remains unverified

Actual deployed Firebase Rules/privileged IAM, authenticated field ingestion, separate H11 certifier and witness custody, device firmware/calibration, brownout/flash recovery, real phone acceptance and supervised alarm/gate/recipient delivery are still outside this branch and have **not** passed. This is user-interface truthfulness, **not** physical flood-safety verification.

Do not merge, publish, connect new hosts, send messages, modify real Firebase or operate hardware on the authority of this preview. An existing warning channel must never be interrupted without a tested alternative and owner approval. **Production NO-GO.**
