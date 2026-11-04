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

- Bounded input (maximum 128 KiB); regular, single-link file only; symbolic links and hard links refused as operator-export evidence.
- Exact structural comparison to the checked-in Rules candidate; a false parent read, broader private reads, hidden descendant write or missing approved nine child reads is rejected by the inherited source review.
- Rejects supplying the repository candidate itself as evidence of deployed state, malformed JSON, unauthorized extra fields, and Rules drift.
- Output contains only fixed status codes and booleans: never prints input paths, Rules contents, Firebase origin, access tokens, node IDs, hostnames or parse errors.
- No network or local writes in the checker; native synthetic tests use disposable fake Rules exports only.

## H29: fail-closed on duplicate Rules JSON keys

The operator-supplied Rules file is now scanned for duplicate object keys **at every nested level** before any candidate comparison is allowed. Plain `JSON.parse` keeps the last occurrence of a duplicate key, which could make an ambiguous file look exactly like the reviewed candidate despite an earlier conflicting permission. The H29 scanner first requires valid JSON, then decodes property-name escapes (including `\\u002e`) and checks uniqueness *within each individual object scope*. Repeated `.read` keys in separate independent nodes are still valid.

A duplicate top-level `rules`, nested `.read`, escaped-key alias or shadowed `esp8266` object causes the existing **fixed, redacted** `OPERATOR_EXPORT_UNAVAILABLE_OR_MALFORMED` result and CLI exit code **2**. The error does not reveal the conflicting key, Rules content, file path, OAuth token or input bytes. No new cloud access, credentials, Firebase SDK connection or production write is introduced.

Only the file-based checker can examine duplicate raw JSON keys. The existing in-memory `assessOperatorRulesExport(object,...)` API receives an already parsed object; it cannot recover duplicate keys removed by another JSON parser and is **not** an operator evidence-ingestion substitute. Use the CLI with the original privately preserved Rules bytes. A matching result remains `NO_GO`: the checker cannot attest which Firebase project or instance served the JSON or verify effective IAM, stored descendants, device identity or field safety.

## H30: private evidence containment on operator CLI

The operator CLI **now refuses exports outside the direct children of** `.floodguard-private-evidence/`. The containing directory must be a real, non-symlinked directory. Canonical paths are compared, so files in the Git checkout root, arbitrary temporary folders, nested folders, a symlinked evidence directory, and symlinked external paths cannot be accepted as operator snapshots. A hardlink to a repository file remains rejected by the pre-existing unique-inode-link rule. The rejection uses `OPERATOR_EXPORT_OUTSIDE_PRIVATE_DIRECTORY` or an existing fixed malformed-input code without showing local paths or private values. An export directly in the expected private directory can still be structurally compared and **always** results in `NO_GO` even when it matches.

Create the private directory manually on the operator machine. Under Linux/WSL, use `mkdir -p .floodguard-private-evidence && chmod 700 .floodguard-private-evidence`, and use `chmod 600 .floodguard-private-evidence/operator-rtdb-rules.json` for the operator-only export file. On Windows, review the directory/file NTFS permissions with the owner, since this tool does **not** verify Windows ACLs. These steps are operator-side guidance, not operations performed by CI or ChatGPT. Do not put tokens, service-account keys, database data, hardware IPs, or personal records into the Rules file. The ignore rule `/.floodguard-private-evidence/` is already present in the repository, but Git ignore is **not** encryption or access control. Do not commit, publish, attach or paste the contents.

For regression tests, the exported `inspectExportFromFile` library helper accepts an explicit `privateEvidenceDirectory` pointing to a **synthetic owner-private sandbox**. **H32 makes this option mandatory for every file-based call**; omission produces the fixed `OPERATOR_EXPORT_PRIVATE_DIRECTORY_REQUIRED` denial. The actual CLI continues to pin the value to `.floodguard-private-evidence` relative to the working checkout. H32 also requires private directory and file permissions on POSIX (no group/other mode bits). Windows ACLs remain a separate operator review. The in-memory `assessOperatorRulesExport` helper still accepts synthetic objects without opening files. This bounded change neither authenticates cloud provenance nor proves IAM or field safety.

## Scope and limitations

A user-supplied copy could be forged, stale, copied from a different project or an unsaved editor. The checker cannot confirm Google authentication, project or instance provenance, effective IAM, rule expression behavior on the live database, public descendants, or legacy full-Admin bypass. A matching candidate is not proof of operational security. **All 11 R3 real-world production acceptance gates remain open** until separately reviewed real evidence exists.

This is one measurable step toward the real Rules/IAM inventory, not a new trusted publisher, signer or witness. Do not merge/deploy the branch, publish Rules, send WhatsApp messages, use live credentials, operate a gate/alarm or flash firmware on the authority of a passing offline check.

**Production release: NO-GO.**


## H33: pin the reviewed baseline to the invoking script's checkout

Both offline operator CLIs now resolve the checked-in Rules candidate and review manifest **relative to their own script file**, rather than the shell's current working directory. In the Rules-only CLI, the Git-ignored operator evidence folder is likewise resolved relative to the script's checkout. This prevents running `node /some/checkout/scripts/r3-effective-rules-export-review.mjs` from an unrelated directory and accidentally accepting the unrelated directory's candidate as the reviewed baseline.

The H33 regression tests use synthetic duplicate disposable checkouts: one contains the script and the intended reviewed baseline; another has a misleading Rules candidate and manifest. The CLI must compare only with the former, and a snapshot that agrees exclusively with the foreign checkout must be rejected. The **exported in-memory / file API** may still be supplied explicit synthetic baseline paths by the caller; this does not attest those paths, nor does a path pinned to a script prove the script came from a trusted commit. Operator must independently inspect the actual Git checkout/commit and approved review source; the result remains `NO_GO` under all outcomes. No Firebase access occurs.
