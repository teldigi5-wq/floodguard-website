# Stage 14 — cross-client telemetry interpretation review

**14 October 2026 · NO-GO · synthetic-only comparison · no client runtime changed**

This cross-repository review compares the inspected source at website draft PR #8,
bot draft PR #12 and **private** mobile draft PR #1. The inspected source revisions
are pinned in `stage14-cross-client-fixtures.json`.

**Important evidence scope:** `experiments/stage14-cross-client-models.mjs`
contains independent JavaScript review models transcribed from the inspected
website provider, bot normalization, and Flutter mapping/model source.
It does **not** execute Flutter/Dart or the bot's actual CommonJS code, and
does **not** run an integrated Firebase Emulator read through all three apps.
These fixtures are hypotheses/regression specifications that still require
direct per-client tests on matching payloads before merging. They are
neither actual sensor observations nor live telemetry.

Run `npm run audit:stage14` to inspect the synthetic comparison; the
ordinary `npm test` also includes its tests. No Firebase, WhatsApp,
network, Android device or Arduino/ESP8266 is accessed.

## What agrees in the review models

All three interpret the agreed **positive** air gap and 25 cm sensor-to-bottom
calibration at SAFE, WARNING (8.5 cm level) and DANGER (11 cm level) thresholds.
They also preserve field-timestamp boundaries with different explicit
freshness windows (website 10 s, bot 15 s, mobile 30 s).

## Open discrepancies — DO NOT auto-fix safety rules

| ID | Synthetic input | Website model | Bot model | Mobile model | Priority |
| --- | --- | --- | --- | --- | --- |
| FG14-01 | Air gap `distanceCm: 0`, separately reported `levelCm: 5` | DANGER (25 cm derived) | SAFE (fallback to 5 cm because bot requires `distanceCm > 0`) | DANGER (25 cm derived) | **P0** ambiguous zero-value/sensor-fault contract |
| FG14-02 | Raw gate `OPEN`, angle `0`, countdown `0` | CLOSED (angle authoritative) | CLOSED (angle authoritative) | OPEN (raw string authoritative) | **P0** conflicting gate presentation |
| FG14-03 | Raw gate `CLOSED`, angle `45` | OPENING (angle intermediate) | CLOSED | CLOSED | P1 disagreeing intermediate state |
| FG14-04 | Water SAFE + rain CRITICAL but backend overallRisk `LOW` | LOW (backend label) | LOW (backend label) | CRITICAL (derived from readings) | **P0** overall-risk conflict |
| FG14-05 | No trustworthy water/rain, backend overallRisk UNKNOWN | UNAVAILABLE | UNKNOWN | LOW (current `FloodRisk.calculate` fallback) | **P0** unknown-to-LOW safety-risk review |
| FG14-06 | Rain `status: ONLINE` with `dailyMm: 120` | HEAVY_RAIN (numeric fallback) | ONLINE (backend string) | HEAVY_RAIN (numeric fallback) | P1 legacy compatibility |
| FG14-07 | Field timestamp 20 s old, Firebase connected | STALE | STALE | Within 30 s window (actual screen state unverified) | P1 clock-age policy divergence |

These are code-inspection findings and **not** evidence that the physical
gate actuated, the Android screen displayed a real LIVE indication or that
the bot sent an alert. They do not establish the currently flashed firmware
behaves like any synthetic scenario. All source clients remain unchanged.

### Suggested future corrective acceptance (requires separate review)

1. Collect only safe **read-only** firmware/field evidence with owner consent
   when the known-working hardware is available. Decide what `distanceCm=0`
   means physically: genuine zero air gap, invalid echo, or sensor error.
   Define sensor-error precedence without falsely classifying SAFE or DANGER.
2. Clarify the authoritative physical gate observation: angle, countdown,
   and raw status can diverge across partial Firebase PATCHes. Avoid issuing
   or simulating real commands to settle a display question.
3. Establish a shared derived-risk policy, with explicit UNKNOWN/UNAVAILABLE
   semantics, independent of a stale backend overallRisk string.
   Do not silently turn missing sensor data into LOW.
4. Align `rain.status=ONLINE` legacy mapping only after verifying which
   firmware variant is actually flashed. Device installation and sensor
   availability should remain distinct from rainfall category.
5. Choose a common freshness/clock-drift contract backed by actual sensor
   cadence and network recovery. Validate website, bot command rendering
   and mobile physical UI **in their own runtime tests** before changing any
   production code or merging draft PRs.
6. Re-verify Firebase privacy separately: public child read consistency
   does not make anonymous parent writes safe. Phase A and Phase B candidate
   rules remain offline research only.

**Release decision: NO-GO** until Stage 11–13 requirements, anonymous-write
remediation, owner-supervised field acceptance, mobile privacy/archive review,
and actual runtime tests are resolved. No PRs are merged or made ready,
no production Rules deployed, no host restored, no WhatsApp pairing, no
firmware change, no gate actuation, no alert delivery.
