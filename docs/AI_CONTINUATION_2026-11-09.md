# AI continuation + milestone roadmap — teldigi5-wq/floodguard-website

> 9 November 2026 handoff. **Documentation-only draft**, not code certification, production approval, CI attestation or a release. GitHub may have advanced; verify first.

## Source of truth
- Canonical repository: https://github.com/teldigi5-wq/floodguard-website
- Baseline for handoff PR: protected/default `main`; existing implementation branches are not changed.
- Latest relevant open PR at inspection: [#131](https://github.com/teldigi5-wq/floodguard-website/pull/131) — draft/review candidate.
- Observed branch: `security/r3-h38-restore-main-ci-hardening-20261105`; observed head: `cf792dec42d6474d772bc607213327e11eb0d8a3` (inspect again before acting).

## Current stage and reality
FloodGuard educational safety-conscious prototype; R3 NO_GO. Website H38, H37, H36, H35... are stacked OPEN/DRAFT. Real field telemetry authority, deployed RTDB rules and provenance are NOT certified.

**Already worked on:** Existing drafts add fail-closed preview Firebase policy, protected source/CI provenance, rule export parsing, named Firebase app scoping and telemetry truth labels. They are review candidates only.

## Next distinct milestones; acceptance gates
1. **M1:** Trace website H38 stacked parent PRs and check exact-head static build, CodeQL and synthetic Firebase tests.
   - Accept only with current SHA, scoped test/evidence links, actual result and explicit remaining blocker.
2. **M2:** Owner-verify real deployed RTDB rules against the known historical anonymous ESP private-metadata read finding; do not print secrets or claim remediation without live denial proof.
   - Accept only with current SHA, scoped test/evidence links, actual result and explicit remaining blocker.
3. **M3:** Verify genuine independent signed sensor/source authority and freshness states before any emergency or operational claims.
   - Accept only with current SHA, scoped test/evidence links, actual result and explicit remaining blocker.
4. **M4:** Perform real-device performance, accessibility and safe read-only Vercel release review; keep R3 NO_GO pending evidence.
   - Accept only with current SHA, scoped test/evidence links, actual result and explicit remaining blocker.

## Safe resumption guide
1. Inspect README, existing docs/roadmaps, active PR head, stacked bases and issues: `gh repo view teldigi5-wq/floodguard-website`; `gh pr view 131 -R teldigi5-wq/floodguard-website --json state,isDraft,headRefName,headRefOid,baseRefName,statusCheckRollup`; `gh pr list -R teldigi5-wq/floodguard-website --state open --limit 100`.
2. In a clean clone, `git fetch --all --prune` and `git log --graph --oneline --decorate --all -30`. Do not merge every branch: many branches are historical review snapshots.
3. Use evidence levels: proposed → code present → local test → exact-source independent CI → merged → deployed → real-operator accepted. A green run for an older SHA cannot approve a newer one.
4. Do not remove branches, overwrite README history, bypass protected main, disable CodeQL/security gates, leak secrets, alter live accounts or spend money without separate approval.
5. Keep small reviewable changes, all work $0-by-default/local when feasible, and append the next checkpoint with date/SHA/observed test/blocked reasons before leaving.

## Related evidence/documentation
- `docs/ENGINEERING_ROADMAP.md`
- `FIREBASE_SECURITY.md`
- Cross-client mobile QA evidence is in a separately access-controlled repository; do not publish private PR metadata in public docs.

## Remaining risks
- Snapshot not equal to exhaustive branch-by-branch audit; re-fetch the full branch/PR inventory before changes.
- No release/production assurance inferred from a draft PR, doc write or previous assistant assertion.
