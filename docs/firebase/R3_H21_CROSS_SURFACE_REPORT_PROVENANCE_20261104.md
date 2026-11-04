# FloodGuard R3 H21 — Cross-client source-display consistency

**4 November 2026 · DRAFT · UNMERGED · NO DEPLOY · PRODUCTION NO-GO.**

Parent H20 website PR #112: `7ded6107877f81f848cd3271df0ed6a87f43d0f6`. H21 changes ONLY the website draft branch. Android and WhatsApp repositories are independent **read-only review inputs**; no cross-repo changes, native app upgrade, bot activation or field operations occurred.

## Evidence-backed mismatch

- Website H19 homepage/ribbon/network used coherent `esp8266/status` AND `esp8266/connection`, but H20 `QuickMetrics`, `app/dashboard/page.tsx` and `app/devices/page.tsx` still fell back to either raw child. They could display ONLINE and green RSSI from a conflicting or unavailable source even while the same website homepage displayed UNKNOWN.
- The website's `app/rainfall/page.tsx` displayed raw `rain.status`, current/daily measurements and "Sensor reporting" when `devices.rainGauge` or `rain.sensorStatus` indicated a fault or a stale observation.
- Android's native `RainData.fromLiveJson` already treats explicit sensor failure as UNKNOWN and refuses to classify NORMAL without numeric daily evidence. The WhatsApp bot's `normalizeGate` rejects status-angle contradictions and its active `bot.js` entrypoint is blocked by H14's draft NO-GO gate. Cross-client **approaches** are comparable; they do not share a single authenticated field source.

## Exact observed review refs

- Website H20 `7ded6107877f81f848cd3271df0ed6a87f43d0f6`: `lib/public-monitor-view.mjs`, `components/page-kit.tsx`, `app/dashboard/page.tsx`, `app/devices/page.tsx`, `app/rainfall/page.tsx`.
- Private mobile H12i `22beb0a05caa7bb6020ed8df35a88146e3eb532b`: `lib/models/rain_data.dart`, `lib/models/device_status.dart`, `lib/models/gate_data.dart`, `test/invalid_rain_sensor_fail_closed_test.dart`.
- Bot H14 `8f0415b95f60c311f1ba9897fabaa8a304ea2616`: `src/floodguard.js`, `tests/gate-contradictory-state.test.js`, `docs/R3_H14_LIVE_BOT_STARTUP_AUTHORITY_NO_GO_20261104.md`.

## H21 review-only correction

1. `lib/public-health-observation.mjs` has immutable, pure display decisions. ESP requires two coherent public children; `CONNECTED/ONLINE/ACTIVE` normalize to ONLINE and `DISCONNECTED/OFFLINE/INACTIVE` to OFFLINE, consistent with mobile and bot aliases. An optional contradictory `devices.esp8266` record vetoes, never upgrades. RSSI is withheld unless the coherent status is ONLINE and the dBm number is plausible.
2. `describePublicMonitorView` delegates to that shared ESP/rain policy. Home/ribbon remain on the same qualified values. Quick Metrics, dashboard Wi-Fi gauge and device inventory consume `monitor.espLabel/espState/espSignalDbm`, not one raw child.
3. Rain reports reject explicit failed/disconnected/not-installed sensor health and contradictory `devices.rainGauge` before showing numeric current, daily, water-depth or ADC data. Normal is not shown without daily evidence; numerically elevated reports are preserved as **possible** hazards, never as authenticated measurements. Stale values are hidden from the current page; historical high categories remain historically labeled.
4. The rainfall page drops reassuring raw sensor claims. A reported calibration cap is labeled as unsigned, and inactive HX711/load-cell weight is always unavailable. No firmware, Firebase writes, hardware command or real warning is issued.
5. New negative tests cover good aliases, conflicting/missing ESP child reports, invalid RSSI, sensor faults, failed gauge, missing daily, stale hazards, forged source metadata and actual website source wiring.

## Important limitations and unresolved questions

- Source tests do not execute Android Flutter or WhatsApp runtime; the other repos and PRs were inspected read-only. Their source and release-state can change independently after this review.
- Mobile displays its own **30-second** historical-warning policy, whereas the bot's configurable window defaults to **15 seconds** (bounded by 1–60 seconds). Those are distinct client warning policies and are not being silently unified.
- Website `freshness==='live'` indicates only an unsigned Firebase timestamp. It cannot authenticate a device, verify transport or actuator movement, prove a sensor is installed/calibrated, or authorize alerts.
- Untrusted or missing measurement means UNKNOWN, not SAFE/NORMAL. Potential high-risk reports remain investigation leads, **not official flood warnings**.
- Exact-head Node 22/24 CI should run npm lockfile installation without scripts, full offline regression tests, TypeScript, ESLint and a non-deploy Next build. Skipped external emulators remain skipped.
- Real browser reduced-motion/No-WebGL and mobile/phone tests, Firebase emulator/IAM/Ruls effective verification, H11 signer/witness custody, hardware calibration, alternate human warning, real recipient tests and owner release authority remain open.

**NO MERGE / NO DEPLOY / NO ACTIVE BOT ENABLEMENT / NO REAL WARNING TRANSMISSION.**
