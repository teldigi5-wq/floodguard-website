# FloodGuard R3 H18 — Unsigned diagnostic, quick-metric and export provenance

**4 November 2026. Draft / unmerged / non-operational / no deployment.** Stacked on website H17 PR #109 pinned at `93e703e67d2eab30202a369921aba522e1ed5464`.

## Concrete defect

The main H16 dashboard and H15 gate page already qualify unsigned reports. Other real website surfaces retained a misleading gap: the engineering diagnostics page displayed `Reported clear` from `alarm.active=false` regardless of field observation freshness; its risk/gate overview showed raw values without the same uncertainty labels. The shared `QuickMetrics` widget displayed alarm `CLEAR`, water `SAFE` thresholds and bare gate status. The browser's copied plain text and downloaded JSON exposed unqualified `SAFE`, `CLOSED`, `ONLINE` and `CLEAR` terms, potentially being mistaken for actual safety evidence.

## Review-only patch

- `lib/public-observation-export.mjs` is a pure, allowlisted, immutable formatter. It serializes *reported* readings with `sourceAssurance: UNSIGNED_FIREBASE · UNVERIFIED`, `physicalFloodSafety: UNKNOWN · UNVERIFIED`, and immutable `false` capability/verification fields. It retains an explicit raw alarm Boolean for diagnostic provenance but converts an apparent `CLEAR` display into `REPORTED OFF · UNVERIFIED`. It never accepts a caller-supplied `safe`/certificate flag.
- `components/status-snapshot.tsx` uses that formatter for both clipboard and JSON, and labels its export and browser badge as an unsigned observation, not a clearance, signed certificate or gate confirmation. The JSON contains only allowlisted water, rain, gate, alarm, system-risk and three public ESP fields; it never contains subscriber data, IP/Wi-Fi, keys, auth metadata or arbitrary raw subtree records.
- `components/page-kit.tsx` shows source-qualified QuickMetrics; a stale sensor reading is not promoted to the current water gauge and `Alarm CLEAR` is no longer a standalone operational-looking statement. `app/diagnostics/page.tsx` uses H15/H16 observed-risk/water/gate contracts and a freshness-qualified alarm/ESP summary.
- New offline tests cover recent `LOW/SAFE/CLOSED/ONLINE/alarm=false`, stale active alarms and critical readings, malformed/missing data, contradictory ESP fields, private-field exclusion and actual page wiring. The inherited historical source contract has been updated to enforce the stricter output—not disabled.
- Exact-head CI runs the full offline test suite, TypeScript, ESLint and non-deployed Next build on Node 22 and 24. The fixed-host Firebase Rules emulator integration remains a separate explicit environment; skipped emulator tests are **not counted as passed**.

## Limitations

These are **view and reporting transformations only**. The report is not a protected audit artifact; a recipient can modify it, and a credible-looking browser time does not attest source identity. None of the results validate deployed Firebase Rules/IAM, firmware, calibration, physical controller position, alarm status, authenticated device signer, independent durable H11 witness, actual smartphone acceptance or WhatsApp delivery. No production warning channel was interrupted, no secrets were accessed, and no Firebase write, physical actuation, merge or deployment was performed.

**R3 physical and production release: NO-GO.**
