# FloodGuard R2–R3 consolidated stack: security and integration review

**31 October 2026 — draft review only. Not a merge approval or deployment approval.**

## Verified repository checkpoint

- Protected `main`: `42e8d9ab28a75057486cf2a0238e822b05ec036f`, last commit `security(ci): pin immutable actions and least-privilege checkout (#9)`.
- Head reviewed before this audit: draft PR #30 `d0575120a2628753e43e236d2b6a89589233bc58`. Last verified CI run #41196520486 passed 13/13 disk witness tests, 12/12 in-memory witness tests, 401 pass/6 skip application suite, 4/4 RTDB tests and type/lint with 10 warnings.
- GitHub comparison of the above heads (as of this review): migration stack **355 commits ahead and 1 commit behind main**, affecting **206 changed files**. The comparison includes a very large foundation in PR #14. These are independent of the narrower later draft checks.
- Currently open stacked lab drafts in sequence: **#14 → #18 → #20 → #21 → #22 → #23 → #24 → #25 → #26 → #27 → #28 → #29 → #30**. Separate draft **#19** contains runtime/security dependency changes and must be reviewed independently. All were still open/draft/unmerged at review start.

## Confirmed critical review issue and remedy in this draft

**Main security CI drift.** Although protected main already contained pinned immutable action commit references, read-only token permissions, credential-safe checkout, CI timeouts and a pinned CodeQL action, the stacked migration branch still carried an older `.github/workflows/ci.yml` and `codeql.yml` using mutable `@v4` tags, and earlier Firebase phase workflows lacked credential-safe checkout. R2/R3 test workflows also depended on mutable `actions/setup-java@v4`.

This review branch restores **the exact current main content** of CI and CodeQL, pins Phase A/B checkout and Node actions, adds `persist-credentials: false` to those checkout steps, and now upgrades setup-java to upstream-verified immutable **v6.1.0 commit `b843ebf9b913146b38da2eaa7aeddf76074ae1ad`** across the emulator workflows. Upstream release was published 14 October 2026 and uses Node 24 action runtime; its compatibility must be verified in CI. Do not bypass or weaken protected main's release checks.

`tests/migration-stack-security-gate.test.mjs` enforces 40-hex immutable action pins across `.github/workflows`, explicitly permission-minimal top-level tokens, `persist-credentials:false` where checkout is used, rejection of `pull_request_target`, integrity of the main CI/build/CodeQL gate, no import of experimental R2/R3 signing or witness modules by production UI source, and retention of roadmap R8 NO-GO.

`.github/workflows/r3-consolidated-security-review.yml` adds a integrated acceptance gate for R2/R3-targeted **pull requests** and pushes to the review branch. It runs all offline tests, selected actual Firebase RTDB emulator suites for the independent R2 signed evidence, R3 atomic dual-signature evidence and R3 V2 disk-witness recovery, TypeScript, lint and Next build. It is a stronger stack-level regression check, **not** real hardware or production QA.

## Unresolved merge and production blockers

1. **Whole-stack review and integration.** A 355-commit / 206-file branch delta cannot safely be declared releasable from the narrow unit/isolated-emulator checks. Review and consolidate into coherent, reviewable PRs; reconcile current main CI/security changes before merging; inspect all changed provider/layout/auth/rules files, commit provenance, dependencies and ownership.
2. **Current production rules and private data.** A prior documented finding observed unauthenticated access to ESP8266 network metadata. These draft rules are lab-only and **do not remediate live Firebase**. The actual deployed rule tree and deny/allow proof still require independently authorized verification; never infer production safety from emulator tests.
3. **Signing key/credential custody.** Device keys and the issuer are synthetic, and the scoped writer can bypass the gateway because Firebase RTDB Rules cannot verify Ed25519. A deployed authenticated gateway must exclusively own write credentials and private signing operations, with enrollment, rotation, revocation and audit controls.
4. **External rollback-resistant witness.** The fsync witness of PR #30 survives restarts but a privileged restore of an old valid signed log remains possible. The lab explicitly demonstrates both-store rollback. External independent monotonic history, trustworthy CAS, cross-process fencing and approved V2 operator catch-up remain unimplemented.
5. **Cross-system commit ambiguity.** A signed gateway admission is not an independently confirmed Firebase commit timestamp. Firebase write and witness update cannot become atomically committed simply by using sequential API calls.
6. **Build / browser / mobile / physical validation.** The new WebCrypto reader is not mounted in the actual production provider and has not been validated in representative real browsers, Android/iOS Flutter, bot delivery, device identity, calibrated sensors or supervised physical gate tests. Never treat `SAFE`, `NORMAL`, or a passing lab test as reliable public-safety proof.
7. **CI coverage gaps.** Most R2/R3 workflows trigger only on their original feature branch, not automatically across the entire stacked merge. This review adds a consolidated gate **for its own branch**, but branch-protection rules, pull-request target coverage, required checks and deployment protections still require review before merging.
8. **Supply-chain reproducibility.** Some workflow commands install an explicit Firebase CLI version through `npx --yes`, rather than a lockfile-bound local dependency. Version pinning is helpful but not a complete transitive supply-chain lock. Review dependencies and CodeQL findings separately.
9. **No secret scan certification.** No code in this review needs production secrets or external service credentials; do not interpret static token/test scanning as a proven full-history secret audit. Historical leak searches and key rotation remain manual gates.
10. **Action major upgrade in progress.** Java setup was advanced from pinned deprecated v4.9.1 to pinned supported v6.1.0. Confirmation requires exact-head CI on the new runner action, not a source-only assertion.

## Promotion policy

**HOLD** draft stack, protected-main merge and all production deployment. Only when all blockers have independently verified evidence should maintainers propose a small, reviewable release subset and require authorization. Keep all live monitoring read-only, hardware and alert routes unchanged.

Evidence for any changed code must be attached to the **exact latest commit**; a successful run for a superseded SHA is not release evidence. The consolidated initial-head CI passed with all selected checks; the exact evidence is recorded below, and the latest documentation-only head requires its own run.

Initial consolidated review head `7a5fe58cab10db1bd408ceb5ada65676ccc0d3ea` passed [Actions run #41198020160](https://github.com/teldigi5-wq/floodguard-website/actions/runs/41198020160): workflow security 4/4; offline suite 405 pass, 6 skipped; R2 RTDB 8/8, R3 atomic RTDB 6/6, V2 disk witness RTDB 4/4; TypeScript PASS; lint 0 errors and 10 warnings; Next.js build PASS. Subsequent doc-only commit must be verified separately.

## PR-trigger coverage and branch protection verification

- In this review branch, the consolidated workflow now includes `pull_request` events for targets `main`, `test/r2-*`, and `test/r3-*`, without path exclusions. This adds checks to the relevant PR merge candidate rather than relying only on feature-branch push runs.
- On 31 October 2026, GitHub's **repository rulesets endpoint returned an empty collection** for this repository through the connected GitHub account. A separate request to `branches/main/protection` returned **HTTP 403, Resource not accessible by integration**. This does **not** prove `main` lacks branch protection: protection settings could exist but be inaccessible to the app.
- **Required status-check enforcement is NOT VERIFIED.** PR-triggering a workflow only creates a check; it does not make that check a required merge gate. An authorized maintainer must inspect Settings → Branches / Rules → Rulesets for the exact repository, confirm required pull request review + current GitHub Actions checks, require the branch up-to-date, restrict bypasses and prevent force push/deletion.
- This branch remains 355 commits ahead/1 behind the reviewed main checkpoint; restoring workflow file contents does not guarantee a clean git merge-base or safe rollout.
- The upstream `actions/setup-java` **v6.1.0** release ref was resolved to immutable SHA `b843ebf9b913146b38da2eaa7aeddf76074ae1ad`; the current CI proof must verify it against the runner.
- Neither PR-triggered CI nor SHA pins substitute for independent secret history analysis, production Firebase authorization, real device attestations or a rollback-resistant witness.

**Change status: PR and push implementation-head CI PASSED; only this documentation-only final head awaits fresh CI.**

PR/push review proof on implementation head `6ba95ea03dbac2a4d3b54f3f0a0ebe31fce1ca73`: [pull_request run #41201298038](https://github.com/teldigi5-wq/floodguard-website/actions/runs/41201298038) and [push run #41201294385](https://github.com/teldigi5-wq/floodguard-website/actions/runs/41201294385) both COMPLETED SUCCESS. 5/5 security review assertions; 406 pass/6 skipped in 412 offline tests; real R2 RTDB 8/8; R3 atomic 6/6; V2 disk witness 4/4; typecheck PASS; ESLint 0 errors/10 existing warnings; Next.js build PASS (14/14 generated static pages). Post-documentation exact-head CI must be rechecked.

## Integration finding — independent source freshness is not yet active (31 October 2026)

The real website provider receives water, rain, alarm, and system snapshots via independent Firebase child listeners. Its shared `freshness="live"` is calculated from `system.lastUpdate` and database connection, **not independently verified water, rain or alarm timestamps**. The isolated R2 source-bound freshness prototype and V2 signed gateway reader are NOT mounted in the live provider. A new system heartbeat can therefore coexist with old or unverified sensor/alarm flags. Before this corrective draft, `SAFE` + `NORMAL` + shared live state could produce overall `LOW`, and `alarm.active=false` with shared live state could produce `CLEAR`. Those are unjustified current safety-clearance claims.

**Display-only fail-closed correction in this draft:** `reconcileDisplayedFloodRisk` and `reconcileDisplayedAlarmState` now require explicit, *trusted caller-provided* `verifiedClearance:true` in addition to shared freshness before emitting `LOW` or `CLEAR`. Legacy `FloodProvider` does **not** supply that flag. In legacy telemetry, a would-be LOW is displayed as `UNKNOWN`; a fresh but unauthenticated alarm `false` is displayed as `INACTIVE REPORTED`, never a verified CLEAR. Higher reported hazard values remain visible; stale/absent alarms remain unavailable. This does not prove physical conditions or suppress the recorded raw Boolean in user-generated JSON exports.

**Still pending:** a real authenticated per-water, per-rain and per-alarm freshness proof, lifecycle-aware replay and device identity checks, browser-backed WebCrypto integration and verified operator trust roots. Only then can the system safely consider a qualified clearance state. The existing public provider cannot create that evidence from a system timestamp alone.
