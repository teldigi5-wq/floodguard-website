# FloodGuard R2 — public recent-data provenance disclosure

**2026-11-01 · review-only successor to draft PR #71 head `a45a624e95a8e0032ee0358b9b054205301fd428`. DRAFT, UNMERGED, NO PRODUCTION DEPLOYMENT.**

## Source finding

The current public browser subscribes to allowlisted Firebase Realtime Database telemetry child paths and classifies a successful RTDB connection plus recent `system/lastUpdate` as internally `freshness='live'`. This is a **recency heuristic**, not cryptographic verification that the ESP8266 actually sent the reading, that sensor calibration is valid, or that the physical Arduino UNO gate and buzzer took an action. The repo already contains **offline-only** cryptographically checked receipt/projection planners; **no production authenticated publisher or verified physical identity is connected**. Promoting recent RTDB data to trusted physical telemetry would be misleading.

## Scoped preview change

- Add pure, immutable, read-only `lib/public-observation-trust.mjs` with separate statements for `live`, `stale`, `loading` and `unavailable`. Even recent database data always returns `authenticatedFieldSource=false`, `physicalConditionsVerified=false`, `canDeclareSafe=false`, `canOperateGate=false`, `canSendAlert=false`.
- Update common `LiveBadge`, `StatePanel`, dashboard overview/risk caption, global alarm/status dock/footer, and animated network copy. These now say **recent database record, source unverified** instead of **field network synchronized/monitoring live/emergency alarm**. Add an accessible informational caution when recent data arrives.
- Use the pre-existing `reconcileDisplayedAlarmState` in the animated network panel, fixing a specific prior case that rendered `CLEAR` for a missing alarm boolean. It now requires an explicitly observed false with freshness before `CLEAR`; otherwise the panel reports `UNAVAILABLE` (or historical `LAST ACTIVE`).
- Use cautious amber styling for *unverified* recent record badges/pulses instead of a green verified-looking live signal. Preserve responsive badge behavior on narrow screens.

The existing Firebase listeners, RTDB read boundaries, water/rain thresholds, freshness classification, source reconciliation, mobile/WhatsApp behavior and all physical controllers are **unchanged**. This is a human-readable disclosure preview, **not** production authorization, data attestation, valid flood-risk certification, or a replacement for a properly authenticated device-to-cloud architecture. No keys, service accounts, production writes, signed receipts or gate commands are introduced.

## Verification and limits

`tests/public-observation-provenance.test.mjs` requires that missing/old observations and arbitrary freshness strings never acquire safety/actuator/alert authority; verifies that public UI uses disclosure and no missing alarm becomes CLEAR; checks unchanged client subscription/reconciliation wiring and no Firebase/control capability in the new pure module. The normal `npm test`, lint, typecheck and Next.js build, pinned NodeMCU cross-compile, version-pinned LittleFS, HTTPS ingress and private-copy host tests must pass on the **exact new head** before claiming verified. No live Firebase data, physical board, network egress or operational gate is tested.

**Blockers unchanged:** secure device principal and provisioning/revocation, signed and replay-safe telemetry, independently verified receipt-to-public projection, trusted device clock/epoch and persistence, safe UNKNOWN/STALE cross-client behavior, physical sensor calibration, OTA/flash/brownout acceptance, and supervised UNO alarm/gate commissioning. Do not reopen anonymous Firebase writes.

**NO MERGE, NO PRODUCTION DEPLOYMENT, NO BOARD FLASHING, NO ACTUATION. PRODUCTION NO-GO.**
