# AI recovery checkpoint — 9 November 2026

**Canonical repo:** `teldigi5-wq/floodguard-website`  
**Recorded protected main SHA:** `42e8d9ab28a75057486cf2a0238e822b05ec036f`  
**Source PR:** [#131](https://github.com/teldigi5-wq/floodguard-website/pull/131), OPEN/DRAFT/UNMERGED at inventory  
**Frozen source HEAD:** `cf792dec42d6474d772bc607213327e11eb0d8a3`  
**Source branch:** `security/r3-h38-restore-main-ci-hardening-20261105`  
**Docs-only branch:** `docs/ai-continuity-20261109` — child of the source branch, NOT main or a release.

## Verified status and constraints

Public Next.js FloodGuard UI. H38 #131 is draft, stacked on Firebase named-app/preview-bundle isolation changes; older H29–H37 reviews are not automatically in protected main. No real hardware data provenance, live gate actuation safety or Firebase Rules/IAM acceptance inferred. Public site may be deployed but current deployment commit needs verification.

## Next distinct milestone

Verify H38 CI exact head, named Firebase app isolation, preview-only unverified telemetry, public bundle leak checks, private RTDB Rules/IAM evidence, accessible warning states and live deployment SHA. Keep operator gate controls disabled.

## Safe continuation by any AI

1. Confirm current main, parent PR, SHA, checks, issue history, roadmap and real code. Never trust an old model's statement without comparing live GitHub and tested commit.
2. Distinguish coded, tested, draft, merged, deployed and owner/device verified. Do not repeat completed milestones or merge stacked drafts automatically.
3. Never expose secrets, personal/private data, unverified physical safety, production credentials, unapproved releases or unrelated projects. Perform small preview changes and reproducible test runs.
4. Update this handoff and relevant roadmap at each new checkpoint with exact branch, PR, CI/run logs, blockers, and the **next different** stage.

**Owner preferences:** high security, no mandatory paid services, actual functionality, honest evidence, WCAG accessibility, rollback, protected main and least privilege.
