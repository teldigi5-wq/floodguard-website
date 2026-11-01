# FloodGuard · Engineering roadmap

This is an engineering plan, not a list of already delivered product claims.

## Current verified baseline

- Public GitHub repository, GitHub Actions source tests, lint, TypeScript and static Next.js production build
- Read-only Firebase RTDB monitoring using allowlisted child listeners, Zod validation and original field timestamps
- A 3D representation of the reported SG90 model gate, rainfall, device, water and alarm views
- Source-truthful `live` / `last recorded` / `unavailable` distinction; pure unit tests for timestamp classification
- Read-only diagnostics of field timestamps, reported group coverage and the Firebase browser connection
- Vercel automatic deployment from `main`
- Dependabot update configuration and CodeQL source analysis workflow (results must be reviewed in Actions/Security)

## Stage 1 · Public-release security gate

**Implemented in repository:** environment template, safe client reads, no web actuator commands, documented trust boundary, reporting policy, a reference RTDB rules template, dependency tooling.

**Remaining external verification:**
- Review Git history with a dedicated secret scanner and rotate any detected credential; simple pattern inspection is not a formal guarantee.
- **Active finding (13 Oct 2026):** Unauthenticated reads of ESP8266 IP/Wi-Fi metadata succeeded against the deployed RTDB. Fix the actual parent/child read grants; verify those reads are denied while safe telemetry and authenticated hardware writes still work.
- Review CodeQL findings and dependency advisories when automated scans complete.
- Decide whether and how to license the repository; public source is not automatically open-source.

## Stage 2 · Monitoring reliability and diagnostic UX

**Implemented:** field freshness model, retained observations, missing-data states, read-only diagnostics page, historical device/gate status correction, unit tests.

**Next:** persistent history/observability. Introduce a bounded append-only history schema with timestamps, units, calibration provenance and retention. Avoid client-authoritative writes to trusted telemetry history. Add trends **only after real data is stored**.

## Stage 3 · Engineering verification

- Firebase Emulator testing for read/write authorization
- Client subscription integration tests, retry/backoff behavior and degraded-network scenarios
- Playwright tests for navigation, small screens, dark mode, reduced motion and scene fallbacks
- Accessibility checks (keyboard navigation, focus, color contrast, live-region announcements)
- Reproducible hardware/ESP test fixtures that clearly identify **test-only** data, never published as real live readings

## Stage 4 · Production-quality operations

- Secure, scoped hardware identity and ingestion pathway
- Diagnostics for field upload success, missing heartbeat, data schema versions, sensor calibration and telemetry health
- Formal documented incident/degradation procedures and runbooks
- Performance budgets for Three.js and mobile, measured on real devices
- Versioned engineering releases with change logs and reproducible deployment evidence

## Non-goals and boundaries

FloodGuard remains an **educational prototype**: no claim of certified prediction, automatic emergency dispatch, public-safety reliability, or real-world dam operating authority.

We prioritize correctness and transparency over visual effects that imply unsupported sensor precision or live activity.

## 1 November 2026 · R2/R3 emergency containment and safe live-restore checkpoint

- **Deployed incident (operator evidence):** the then-current production RTDB rules granted anonymous `.read:true` and `.write:true` under `/floodguard/live`. Fixed-path anonymous GET checks confirmed the public read boundary, including `/floodguard/live/esp8266/ip` and `wifi`. An emergency production lockdown with `.read:false` and `.write:false` was operator-published while hardware was disconnected. Four post-change anonymous GETs returned HTTP 401. This is evidence for those four read denials; live write-denial, historical data integrity, other rules, actual alert delivery and hardware safety were not independently verified. **Do not revert anonymous writes.**
- **Operational state:** legacy website, Flutter and WhatsApp telemetry read access is deliberately blocked; ESP8266 v6 legacy anonymous PATCH would be blocked when restarted. The UI should show `UNAVAILABLE` rather than `SAFE`. No life-safety reliability is claimed.
- **Review candidates:** website [PR #32](https://github.com/teldigi5-wq/floodguard-website/pull/32) (conservative legacy displays), [PR #33](https://github.com/teldigi5-wq/floodguard-website/pull/33) (anonymous read auditor), [PR #34](https://github.com/teldigi5-wq/floodguard-website/pull/34) (primitive public leaf projection emulator), and **stacked [PR #35](https://github.com/teldigi5-wq/floodguard-website/pull/35)** (test-only field-event reconciliation). Each remains **DRAFT/UNMERGED**, including this roadmap update.
- **Recovered original firmware:** archived Arduino Uno v6 makes water/gate decisions locally with 25 cm reference, WARNING at 8.5 cm, DANGER at 11 cm, local buzzer and 10-second gate countdown. Its out-of-range distance clamping and sensor-error buzzer-off branch require hardware safety review. Archived ESP8266 v6 makes anonymous PATCH requests to `/floodguard/live.json` using `WiFiClientSecure.setInsecure()` — certificate validation is not enabled. The actual flashed firmware and physical response have not been confirmed; do not auto-flash, actuate or test gate hardware. Firmware files are in the owner's private historical materials, not these GitHub repo trees.
- **Next acceptance sequence:** validate original flashed firmware/hardware, design validated TLS and device authentication, enforce bounded source-bound timestamp/sequence and revocation in a scoped gateway, publish independently verified sanitized leaves with a write-isolated private store, add emulator-backed read-only leaf adapters, coordinate website/mobile/bot preview cutover, then supervised real-device alarm/gate and end-to-end recovery acceptance. Maintain a separate rollback plan and owner approval before publishing new rules or activating sensors.
- **Release gates:** 0/10 independently accepted at production level. **NO-GO** until actual evidence exists.
