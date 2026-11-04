# FloodGuard R3 — private RTDB Rules export comparison (offline)

**4 November 2026. REVIEW ONLY. DRAFT / UNMERGED / NO CLOUD OPERATIONS / PRODUCTION NO-GO.**
Stacked on website H11 PR #105 at commit `21daa2034e1312bad1a3de95449bd74093b0d84f`.

## Why this addresses a real acceptance gap

`firebase.rules.json` in Git is a candidate. It does **not** prove what Firebase currently enforces. Existing `scripts/r3-real-authority-preflight.mjs` intentionally sets `effectiveFirebaseRulesVerified:false`. Privileged Firebase Admin credentials can bypass client Security Rules regardless of their content; a static Rules snapshot cannot demonstrate actual IAM or device security.

The new `scripts/r3-effective-rules-export-review.mjs` compares **an operator-supplied private copy** of the currently observed Firebase Realtime Database Rules with the exact checked-in reviewed candidate. It reuses the existing conservative Rules preflight. No cloud connection or credential is implemented.

## Operator-only procedure; not yet performed

1. On an authorized owner PC, sign in to the correct Firebase project in **Firebase Console → Realtime Database → Rules**. Verify which database instance is selected. Confirm the Rules shown correspond to the **published** Rules, not unsaved edits. Do not change or publish any Rules.
2. **Copy only the Rules JSON** to a private local file under `.floodguard-private-evidence/` in the website checkout. Do not include Firebase service-account keys, ID tokens, secrets, subscriber data, network metadata or credentials. The entire directory is Git-ignored. Keep the original snapshot and capture the instance, capture time and operator identity in a separate owner-only evidence record, not in Git.
3. From the website repository root, run:
   ```sh
   node scripts/r3-effective-rules-export-review.mjs .floodguard-private-evidence/operator-rtdb-rules.json
   ```
4. Review the fixed-code JSON result. An exit code **0** with `repoCandidateMatchesExport:true` only indicates the supplied JSON structurally matches the checked-in candidate. It still reports `releaseDecision:NO_GO`, `authenticatedCloudExport:false`, `effectiveFirebaseRulesVerified:false`, `realAuthorizationVerified:false`. Exit code **2** indicates a missing, malformed, unsafe, changed or unexpected snapshot; do not deploy Rules to make the check pass.
5. Store the exported Rules and custody evidence securely, outside Git/CI/chat. Repeat with a separately approved operator witness for provenance; separately inventory descendants under publicly readable ancestors and obtain IAM/role and Auth-token evidence. The verifier does **not** access or review these operational facts.

The Firebase documentation also describes authenticated read-only retrieval via `GET /.settings/rules.json`; do not place OAuth tokens or Firebase secrets in a shell history, terminal command-line URL, CI artifact, PR, or report. Prefer the existing authenticated Console for this initial manual inventory. **Never use `PUT`, `firebase deploy`, or `database:settings:set`** as a "verification" step.

## What the offline test exercises

- Bounded input (maximum 128 KiB); regular file only, symbolic links refused.
- Exact structural comparison to the checked-in Rules candidate; a false parent read, broader private reads, hidden descendant write or missing approved nine child reads is rejected by the inherited source review.
- Rejects supplying the repository candidate itself as evidence of deployed state, malformed JSON, unauthorized extra fields, and Rules drift.
- Output contains only fixed status codes and booleans: never prints input paths, Rules contents, Firebase origin, access tokens, node IDs, hostnames or parse errors.
- No network or local writes in the checker; native synthetic tests use disposable fake Rules exports only.

## Scope and limitations

A user-supplied copy could be forged, stale, copied from a different project or an unsaved editor. The checker cannot confirm Google authentication, project or instance provenance, effective IAM, rule expression behavior on the live database, public descendants, or legacy full-Admin bypass. A matching candidate is not proof of operational security. **All 11 R3 real-world production acceptance gates remain open** until separately reviewed real evidence exists.

This is one measurable step toward the real Rules/IAM inventory, not a new trusted publisher, signer or witness. Do not merge/deploy the branch, publish Rules, send WhatsApp messages, use live credentials, operate a gate/alarm or flash firmware on the authority of a passing offline check.

**Production release: NO-GO.**
