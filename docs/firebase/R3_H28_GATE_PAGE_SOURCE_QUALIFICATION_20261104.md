# FloodGuard R3 H28 — Gate view uses qualified unsigned observations, including 3D inputs

**4 November 2026 · REVIEW-ONLY DRAFT · UNMERGED · NO PRODUCTION RELEASE.**

Exact parent H27 PR #119: `d1a61730195ee49b27079aa27f2a49128cf83d6f`. Mobile PR #19, WhatsApp PR #72 and all canonical default branches remain unchanged.

## Evidence-based H27 defect

The website's `app/gate/page.tsx` already used `describeGateObservation` to prevent unverified CLOSED/OPEN display, but several adjacent surfaces bypassed the shared H16–H27 observation policy:
- Hero and telemetry cards read raw `water?.levelCm`, including when the sensor had reported SENSOR_ERROR or the database timestamp was old.
- Two network cards directly read `esp8266.status ?? connection` and raw RSSI, ignoring H26 inventory `installed:false` veto and contradictory child state.
- Risk displayed the backend `overallRisk` string without context, including stale/unsupported LOW.
- The 3D scene was passed raw `rain.currentMm` and `water.distanceCm`, so a recently timestamped but faulted rain/water sensor could still influence illustrative visuals.
- A retained controller `reason` was displayed as if current, even when no coherent reported gate state existed.

## Minimal no-authority correction

1. Use the established `describePublicMonitorView({data,freshness})`, `describeWaterObservation` and `describeRiskObservation` for gate page adjunct reports. Existing `describeGateObservation` continues to own position/countdown/angle.
2. Require a *coherent, current, unsigned* gate report before showing an allowlisted reason; otherwise label it UNKNOWN. A controller reason remains merely reported, not a witnessed action.
3. Keep `const releaseActive = false;`. No new button, actuator or alarm delivery. `DamScene` receives only `monitor.rainCurrentMm` and `monitor.waterDistanceCm` while `angle` already comes from `describeGateObservation`.
4. Retain historical risk as `LAST RECORDED ... NOT CURRENT`, never interpret a raw LOW as clearance. Faulted or stale water numeric level becomes Unavailable; ESP uninstall/conflicting children revoke ONLINE and signal.
5. Five pure/source regression tests plus two actual SDK/Chromium scenarios exercise the gate page with uninstalled ESP, rain/water faults, stale reports, historical reason, withheld scene inputs and no unsafe release styling. Original H25–H27 SDK tests and the full Node 22/24, static build, offline Chromium and seven-rule restrictive emulator matrix remain mandatory.

## Boundary and NO-GO

The sole test writer uses a disposable demo Firebase Realtime Database emulator on `127.0.0.1:19001`. Browser web requests are restricted to loopback; no production backend or user records are loaded. These tests prove conservative **display** of unsigned synthetic reports, not authenticated field telemetry, calibrated HC-SR04 and rain hardware, real servo travel, production Rules/IAM, physical warnings or release authority. The six historical permissive Phase A test skips are deliberately excluded.

**Never merge, deploy, alter live Firebase, activate WhatsApp, send real warnings or actuate equipment based on these tests. PRODUCTION NO-GO.**
