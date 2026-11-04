# FloodGuard R3 H27 — Diagnostics cannot bypass unsigned source qualification

**4 November 2026 · DRAFT · UNMERGED · REVIEW ONLY · PRODUCTION AND PHYSICAL RELEASE NO-GO.**

Exact parent is website H26 PR #118 head `c14c674561faea2ebaf7e3044c0f20363d76be78`. Android H12i PR #19 and WhatsApp H14 PR #72 remain untouched.

## Evidence-backed defect in H26

`app/diagnostics/page.tsx` did not yet consume the source-qualification functions verified in H21–H26. Instead:
- `ESP8266 telemetry` used `data?.esp8266?.status ?? data?.esp8266?.connection` directly; if the provider preserved an `esp8266` child pair reporting ONLINE while `devices.esp8266` explicitly reported NOT_INSTALLED, Diagnostics could still label ESP **REPORTED ONLINE · UNVERIFIED** even though the Devices page correctly returned **UNKNOWN · SOURCE UNVERIFIED**.
- `Collector rainfall` displayed `data?.rain?.currentMm` whenever the shared timestamp was fresh. H26 intentionally preserved raw rain numbers in source state while its presentation policy hid them on rain-gauge failure. Diagnostics bypassed that policy and could still display **REPORTED 0.0 mm · UNVERIFIED** despite `devices.rainGauge=NOT_INSTALLED` or `rain.sensorStatus=OFFLINE`.
- The page was explicitly a diagnostic/engineering console, not an authoritative field signal; the raw values contradicted its own cautions. This could mislead operators even though the underlying data is unsigned and unverified.

## Minimal H27 patch

1. Keep the existing read-only and allowlisted Firebase subscriptions unchanged. In Diagnostics compute `monitor=describePublicMonitorView({data,freshness})` and `rainView=describePublicRainObservation({rain:data?.rain,device:data?.devices?.rainGauge,freshness})`. Render `monitor.espLabel` and qualified `rainView.currentMm/rainView.categoryLabel` rather than raw ESP and rainfall values.
2. Continue showing retained group coverage separately from source validity, with an explicit note that an inventory conflict and uninstalled rain gauge suppress apparent measurements. This does **not** grant identity or field authority, or delete historical evidence.
3. Add five source/pure regression cases in `tests/r3-h27-diagnostics-source-consistency.test.mjs` and two genuine real Firebase JavaScript SDK + Chromium tests exercising the Diagnostics route under synthetic RTDB `installed:false`, `installed:true` without status, repaired independent ONLINE reports, later contradicting ESP child, rain sensor failure and stale timestamp.
4. Inherit every H26 no-deploy CI job, with Node 22/24 regression and build, offline Chromium, seven restrictive RTDB Rules emulator cases, and H25–H27 real SDK emulator browser transitions. The existing six historical Phase A permissive cases remain intentionally isolated.

## Security and release boundaries

The **only** writer in these tests is a local Node fixture using privileged **demo emulator-only** REST seed on `127.0.0.1:19001`. The running website under test uses the actual Firebase JS SDK configured to loopback, has no secret, and cannot access cloud infrastructure. No live database, production Rules/IAM, signed source, firmware, physical sensor, hydraulic gate, real WhatsApp recipient, Android app or deployment is touched.

CI test passes only mean the website treats synthetic unsigned telemetry conservatively. They do not verify production effective Firebase permissions, field controller identity, authenticated per-observation timestamps, actual installation, physical calibration/actuation, real warning delivery, screen-reader/mobile-device acceptance, independent fallback, or release authorization. **PRODUCTION / PHYSICAL SAFETY: NO-GO.**
