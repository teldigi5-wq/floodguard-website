# FloodGuard R3 H23 — real, offline Chromium acceptance gate

4 November 2026. **DRAFT · UNMERGED · NON-PRODUCTION · RELEASE NO-GO**.
Exact parent H22 PR #114, SHA `698d1ca5f4b8e8a102753e07b30090b7b7d7a294`.

## Motivation and scope
H22 and all predecessors had green Node source tests and Next static export but **none executed a browser**. Vercel showed a READY preview at H22, but the connected live browser automation did not start because its wallet was out of funds. Rather than invent visual QA evidence or pay for a provider, this draft adds *independent, reproducible* headless Chromium assertions in the public website's GitHub Actions.

## Synthetic/no-field CI architecture
- Build the exact checked-out website with `npm ci --ignore-scripts`, `npm run build` and **no** `NEXT_PUBLIC_FIREBASE_DATABASE_URL` or secrets.
- Serve the generated `out/` static files only on GitHub runner **127.0.0.1:4173**, using Python's included HTTP server.
- Install Playwright **1.64.1 exactly** in the disposable CI job (`--no-save --no-package-lock --ignore-scripts`); install Chromium with the pinned Playwright CLI. No application runtime dependency or production lockfile edits.
- Browser context blocks service workers and **all external network requests**. No Firebase, IoT, notification, real recipient, WhatsApp, private IP, auth, device command, deployment or production data.
- Real browser assertions cover desktop unknown-source 3D static fallback, keyboard skip-link focus and Escape to close command navigation, mobile menu and rainfall page navigation, stale/unavailable network-dock qualification, horizontal overflow at phone/desktop widths on 5 routes, and `prefers-reduced-motion:reduce` suppression of the scene Canvas.
- Capture browser `pageerror` exceptions as failures and assert no navigation to real field endpoints. Any failures require diagnosis on this **draft**, not bypasses to reach a green check.

## Verification boundaries
- A browser test against **unconfigured** Firebase proves that fail-closed unavailable-data UI is usable, not that actual public data or the H23 release is authentic or safe. Real WebGL fallback with fully qualified mock sensor data, screen reader/TalkBack announcements, iOS Safari, landscape, live Firebase emulator, signed source provenance, real hardware, calibration and independent gate/warning delivery remain untested unless separately verified.
- Source-only Node tests remain separate and include the 13 historically skipped external/emulator cases. Never count skipped tests as passes.
- CI should use no secret-bearing environment, never write RTDB, never trigger deployment, and check the final exact PR commit SHA.
- Do **not** turn browser green into authority to merge/release. Website main currently unprotected. Physical flood warnings and live bot activation remain NO-GO.

## Acceptance evidence
Record the exact GitHub Actions run IDs, outcome of every Node 22/24 source job and Chromium browser job, each browser assertion passed/failed, and all remaining gates in PR body when available. On initial failures, fix actual evidence-backed defects in the same H23 draft with regression preserved.
