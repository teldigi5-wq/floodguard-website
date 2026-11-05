# FloodGuard H38 — Restore main-branch CI hardening in stacked release drafts

**5 November 2026 · DRAFT / UNMERGED / NO PRODUCTION DEPLOYMENT / PHYSICAL FLOODGUARD NO-GO**

**Exact parent:** H37 PR #129 at `31099231b6710601ae0316205aac5b61cfa8460e`.

## Evidence

- Current website `main` is `42e8d9ab28a75057486cf2a0238e822b05ec036f`, commit message `security(ci): pin immutable actions and least-privilege checkout (#9)`, authored on 22 October 2026. It changes only `.github/workflows/ci.yml` and `.github/workflows/codeql.yml`.
- GitHub comparison of H37 against `main`: **diverged, 899 commits ahead and 1 behind**. The one missing `main` commit is #9. This is **not** evidence of a safe 899-commit merge. Do not merge/rebase the entire lineage without a separate review.
- H37's inherited `ci.yml` used mutable `@v4` action tags, `ubuntu-latest`, persisted checkout credentials by default and no explicit minimum permissions. Its `codeql.yml` used mutable `@v4` references and `ubuntu-latest`. The deployed `main` already had immutable action hashes, fixed Ubuntu 24.04, no persisted checkout token, restricted job permissions, and a weekly CodeQL scan.
- The stage-specific H37 CI tested source quality but did **not** automatically compare these two baseline GitHub Actions workflows against the current main commit. A naive future promotion might silently reintroduce weaker workflow versions. This is a repository governance/supply-chain issue, **not** evidence that malicious Actions ran or production was compromised.

## Narrow correction

The H38 branch copies **exactly** the two hardened workflow files already in verified `main` (same bytes as `42e8d9ab...`). No new workflows are enabled on `main`, and H38 is never an authorization to merge ancestors. The contents preserve:
- `on: push/pull_request` targeting `main` and scheduled CodeQL analysis;
- immutable SHA-pinned checkout, setup-node and CodeQL actions;
- `actions/checkout` with `persist-credentials: false`;
- `permissions: contents: read` in website CI; CodeQL restricted to `contents: read`, `security-events: write`, `actions: read`;
- `runs-on: ubuntu-24.04`, timeouts, Node 22 lint/test/typecheck/nondeploy build.

Six new static guard tests prove the workflow invariants, and a separate no-cloud Node22/24 workflow runs them together with the inherited source tests, TypeScript, lint and a nondeploy build. No Firebase URL, secrets, deploy token, Vercel configuration, user record or device is needed.

## What remains blocked

- Branch protections are **not enabled** on website or private Android. A separate owner-approved ruleset/branch protection plan must explicitly select required stable checks. The stage-specific H37/H38 workflows run only on their stacked draft branches and **must not be named as permanent required checks for direct PRs to main**, otherwise merges could deadlock. The existing `FloodGuard website checks / verify` main PR workflow can form a stable baseline, subject to verifying available check names and owner review; CodeQL security analysis can be added after its exact run behavior is confirmed.
- Preview and Production target assignments for public Firebase URL/live-path variables in Vercel are still shared. H35/H36 control new preview **client behavior** but don't change project settings or revoke old previews. Preview SSO remains on; owner must decide environment separation.
- Effective production Firebase RTDB Rules/inherited IAM/Admin privileges, cryptographically authentic device frames, the independently durable signer/witness, field calibration, UNO gate/alarm interlocks, real backup warnings, Android accessibility/physical acceptance and a signed owner-controlled rollback/GO remain unverified.

Detailed owner-gated criteria are tracked in [release issue #130](https://github.com/teldigi5-wq/floodguard-website/issues/130). No unchecked real-world acceptance gate is automatically cleared by a passing H38 test.

**NO MERGE, NO DEPLOY, NO RULES PUBLISH, NO LIVE ALERT, NO HARDWARE OPERATION. PRODUCTION RELEASE: NO-GO.**
