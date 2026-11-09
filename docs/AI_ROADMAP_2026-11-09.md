# Project continuation roadmap — teldigi5-wq/floodguard-website

> 2026-11-09 review draft [#132](https://github.com/teldigi5-wq/floodguard-website/pull/132); DO NOT interpret as code verification, a merge, field safety certification or owner approval. The [original handoff](AI_CONTINUATION_2026-11-09.md) and pre-existing product roadmap remain authoritative.

## Work preservation and current stage
Read the existing handoff's current stage, verified/blocked facts and PR SHA before use; re-query live GitHub because snapshots can be stale. Do not overwrite historical branches or replay previously completed acceptance. The continuation is carried by a *single* dedicated documentation PR, not pushed into every active branch.

## Next distinct milestones from recorded plan
1. **M1:** Trace website H38 stacked parent PRs and check exact-head static build, CodeQL and synthetic Firebase tests.
   - Acceptance: exact-current source commit; linked reproducible tests and failure cases; risk and rollback; operator sign-off for real-world consequences.
2. **M2:** Owner-verify real deployed RTDB rules against the known historical anonymous ESP private-metadata read finding; do not print secrets or claim remediation without live denial proof.
   - Acceptance: exact-current source commit; linked reproducible tests and failure cases; risk and rollback; operator sign-off for real-world consequences.
3. **M3:** Verify genuine independent signed sensor/source authority and freshness states before any emergency or operational claims.
   - Acceptance: exact-current source commit; linked reproducible tests and failure cases; risk and rollback; operator sign-off for real-world consequences.
4. **M4:** Perform real-device performance, accessibility and safe read-only Vercel release review; keep R3 NO_GO pending evidence.
   - Acceptance: exact-current source commit; linked reproducible tests and failure cases; risk and rollback; operator sign-off for real-world consequences.

## Execution phases
**A. Recon:** branch and PR pagination (especially >100), base/head DAG, issues and README/roadmap, latest Actions and security/advisories; record what has already been done.

**B. Build:** select first unmet M-step only; isolate code changes, add acceptance/security regressions; preserve main, existing PRs and the user’s real state.

**C. Assurance:** unit/integration/E2E, offline and failure tests, accessibility/responsiveness, dependency and source-secret checks. Old CI PASS is only evidence for the exact old commit.

**D. Promote:** identify deployment/owner/device risks; require current CI and review, production authorization and rollback evidence. Keep NO_GO where hardware/source authority/service approval is missing.

## Safe recovery CLI
```bash
gh repo view teldigi5-wq/floodguard-website
gh pr list -R teldigi5-wq/floodguard-website --state open --limit 100
gh issue list -R teldigi5-wq/floodguard-website --state open --limit 100
gh run list -R teldigi5-wq/floodguard-website --limit 20
git fetch --all --prune
git log --all --graph --oneline --decorate -30
```
The handoff archive has a read-only paginated inventory script; these commands are not exhaustive for hundreds of branches. Do not push secrets, synthetic claims about live data, paid services, or real account actions without approval. Track proof in [milestones](AI_MILESTONES_2026-11-09.md).
