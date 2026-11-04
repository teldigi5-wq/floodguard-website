# FloodGuard R3 H22 — Persistent shell must not bypass unverified source policy

**4 November 2026 · DRAFT · UNMERGED · REVIEW ONLY · PRODUCTION NO-GO.**

Exact parent: website H21 PR #113 `3427f342e65e11900ba5051e10e26bb682244aa1`. H22 affects only website presentation in an isolated draft PR. It does not touch the Android H12i or WhatsApp H14 drafts, Firebase database/rules/IAM, deployed service, sensor, hardware, physical gate or alert recipients.

## Observed gap in H21 source

Despite H19–H21 page-level qualification, the persistent `components/site-chrome.tsx` network dock still rendered raw `water.levelCm`, raw `esp8266.status ?? connection` and `gate.status`. A stale, contradictory or offline report could therefore appear current across **every route** despite H21's consistency tests on selected pages. Its alarm banner also used the raw `alarm.active` flag with unconditional `role=alert` even when the database record was historical. The global skip link pointed to a route wrapper with no explicit programmatic focus target.

## Bounded change

1. The shell delegates all visible water/ESP/gate labels to existing H21 immutable `describePublicMonitorView({data,freshness})`. Missing/current/contradictory values retain UNKNOWN/UNVERIFIED, not a physical clearance. It does not read private RTDB parents or introduce privileged credentials.
2. The existing alarm banner still retains explicit `active===true` as an investigation lead. A recent unverified report has `role=alert`; historical data has `role=status` and "LAST REPORTED ACTIVE · NOT CURRENT." Neither claims a verified physical alarm, delivered warning or siren. No bot-side message or live alert is sent.
3. The existing skip link's target gets `tabIndex={-1}`, preserving normal tab order while allowing programmatic keyboard focus to the route content. The dock status text wraps on narrow screens.
4. Synthetic regression tests validate the actual shell's wiring, missing/stale/contradictory inputs, non-authority, historical alarm role/label, skip-target focusability and injected metadata rejection.

## Read-only infrastructure/browser findings

- Vercel project `floodguard-website` was inspected read-only. Its preview `https://floodguard-website-6q82jfgq6-teldigi5-wq.vercel.app` is **READY** at exact H21 commit `3427f342e65e11900ba5051e10e26bb682244aa1` (not H22, not production). The browser automation attempt **did not run** because the connected TinyFish wallet was out of funds. No wallet charge, production promotion or H22 preview acceptance was claimed.
- Running actual local browser tests within the container was also blocked by lack of network DNS resolution to the Vercel preview. This is a testing-environment limitation, not an app error and not a pass.
- H22 offline CI uses locked Node dependencies without install scripts, full inherited tests, TypeScript, lint and Next non-deploy build on Node 22/24. External emulator skips remain skipped. Browser execution, screen-reader, reduced-motion, no-WebGL runtime and physical field acceptance remain **OPEN**.

**DO NOT MERGE OR DEPLOY. Real-world FloodGuard release: NO-GO.**
