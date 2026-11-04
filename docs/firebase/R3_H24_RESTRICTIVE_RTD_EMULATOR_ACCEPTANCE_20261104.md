# FloodGuard R3 H24 — Explicit restrictive Firebase RTDB Emulator gate

4 November 2026 · **DRAFT, UNMERGED, NON-PRODUCTION, RELEASE NO-GO**.

Exact parent H23 PR #115: `3eec479054f3c6acb639a90db13f58eb1fe8a34a`.

## Evidence-driven issue
In the H23 standard `npm test` report, **13 tests are skipped** intentionally: 6 Phase A emulator cases run only with `FG_EMULATOR=1`, and 7 R3 restrictive candidate tests run only with `FIREBASE_DATABASE_EMULATOR_HOST`/ `GCLOUD_PROJECT` supplied. Those seven prove real emulator Rules behavior and never exercise a production project. Existing review-only workflows contain an R3 emulator integration step, but H23's actual exact-head Node and browser acceptance did not execute it.

**Do not enable the six older Phase A tests in the restrictive release gate.** They intentionally validate prototype-level anonymous writes and are a separate historical compatibility policy, not a production target.

## H24 exact-branch CI
- Retain the **H23** full inherited source tests on Node 22 and 24, TypeScript, ESLint, Next static build, and real isolated Chromium navigation/fallback tests. Browser external requests and service workers are blocked. This gives immediate regression coverage of the same parent behavior.
- Add a dedicated **non-production RTDB emulator job** on Ubuntu. It uses pinned GitHub Actions, Node 22, Temurin Java 21, and the disposable Firebase CLI `firebase-tools@15.34.2`, with `--only database`, `--project demo-floodguard-r3` and `--config r3-firebase-emulator.json`.
- Verify the exact emulator bind `127.0.0.1:19001`, local-only namespace, candidate rules `docs/firebase/R3_PUBLIC_CHILD_READS_MERGED_REVIEW_ONLY_20261102.json`, private ESP subtree denial, no ancestor grants and no anonymous RTDB writes.
- Explicitly blank the CI environment's cloud credentials `FIREBASE_TOKEN` and `GOOGLE_APPLICATION_CREDENTIALS`. No GitHub secrets or service accounts. Real field Firebase `floodguard-e3215` is never a permitted host or project in test code.
- Run the preexisting **seven** actual emulator protocol tests: local-project guard, privileged *synthetic emulator-only* seed, nine publicly readable child paths, blocked private ESP and ancestors, anonymous PUT denial, anonymous PATCH/DELETE denial, and seed survival after unauthorized changes.
- Additional static guard tests lock the config and project isolation. The real emulator test result must be **seven passed, zero skipped** to claim that gate verified.

## Scope boundaries
- These tests validate a **review-only local candidate Rules file**, not the live production Firebase project's effective Rules/IAM. No Firebase production publish, credential changes, device interaction, gate movement, recipient, WhatsApp activation, releases, merges or main branch edits.
- Real deployment authority, signed sensor provenance, field calibration, firmware TLS, physical gate travel, independent alerting, device/browser real-world test, recovery and owner approval remain open.
- The six skipped Phase A cases remain historical and unverified under this H24 workflow by design. Never add seven emulator passes to the standard `npm test` pass count or pretend they remove all skips from it.
- CI requires exact final commit and run IDs; initial failures must be diagnosed without suppressing security assertions.

**Physical FloodGuard / deployment: NO-GO.**
