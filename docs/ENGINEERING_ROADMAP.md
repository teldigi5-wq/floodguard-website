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

## 9 November 2026 — AI continuation reference

Existing educational/field-source truth boundaries remain unchanged. The live RTDB rule exposure and signed sensor authority must be operator-verified before any safety claim.

- [Dated recovery handoff](AI_CONTINUATION_2026-11-09.md)
- [Next distinct milestones and recovery phases](AI_ROADMAP_2026-11-09.md)
- [Exact-SHA milestone evidence tracker](AI_MILESTONES_2026-11-09.md)

These links exist on documentation-only draft PR #132, not necessarily on protected `main`. Preserve all previously verified stages, unmerged feature branches and existing security/release acceptance criteria.
