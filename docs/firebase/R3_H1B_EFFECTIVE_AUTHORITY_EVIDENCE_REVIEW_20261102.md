# FloodGuard R3-H1/B — private evidence review for real Firebase authority

**2 November 2026 — review-only local candidate based on PR #87 `ea6b204990c104c06a065549d3fe12dec81a8c2e`. No GitHub merge, live cloud changes, service provisioning, firmware flash, alert or gate actuation. Production NO-GO.**

## Why the evidence boundary matters

The R3-H1/A offline source reviewer now rejects unexpected Firebase RTDB public parent `.read` grants. That confirms only properties of the **checked-in** `firebase.rules.json` and not the deployed rules, actual RTDB descendants, Cloud IAM policies, active server credentials or Firebase Admin bypass. Existing broad `water`, `rain`, `gate`, `alarm`, `devices` and `system` read grants still disclose ALL descendants stored beneath those nodes. Anonymous HTTP 401 on a selected path does not prove the database has secure writes.

R3-H1/B adds an **optional offline utility** `scripts/r3-h1b-authority-evidence-review.mjs` to review two **privately obtained local copies**: a Firebase Console-exported effective RTDB Rules JSON document and the Google Cloud **project-level** IAM allow policy JSON. Nothing is fetched from the cloud by this script. The results are intentionally fixed, redacted booleans. The script refuses a symlink, nonregular file, input over 1 MiB, or group/other-accessible input on POSIX. It never reads from STDIN, uses no network, does not serialize identities or policies, and does not write files.

A passing local check is not proof that a purported export came from the named project, is current, is complete, or incorporates inherited IAM, other resource IAM, service account key custody, Admin SDK behavior, RTDB data descendants, physical device states or deployed hardware. **Every output permanently keeps `releaseDecision: "NO_GO"`.**

## Operator workflow — only when authorized and with private access

1. Confirm the actual Firebase project and RTDB instance in the Firebase Console. The historically reported project is `floodguard-e3215`; do not silently target another project. Do not change effective rules, permissions, accounts, billing or data.
2. Store a **read-only snapshot of the effective deployed Realtime Database Rules** from Firebase Console → Build → Realtime Database → Rules in a user-owned local file `effective-rtdb-rules.json`. Include the outer `{"rules": {...}}` object; keep the original private as the rollback reference. Do not paste the document in a public issue or chat, and do not use rules REST calls with authentication tokens embedded in URLs or shell history.
3. If you already have permission to use the Google Cloud CLI, export only the project-level IAM allow policy to a private file. The official `gcloud projects get-iam-policy` operation is read-only, but the output can contain member identities; do not print it to public logs. Run from an authorized Linux/WSL user shell, not GitHub CI:

   ```bash
   umask 077
   PRIVATE_DIR="$HOME/.local/share/floodguard-private/r3-h1b"
   mkdir -p "$PRIVATE_DIR"
   chmod 700 "$PRIVATE_DIR"
   # Manually save the Firebase Console Rules snapshot to:
   # "$PRIVATE_DIR/effective-rtdb-rules.json"
   # Confirm the project ID and active identity are correct before the next command.
   gcloud projects get-iam-policy floodguard-e3215 --format=json \
     > "$PRIVATE_DIR/project-iam.json"
   chmod 600 "$PRIVATE_DIR/effective-rtdb-rules.json" "$PRIVATE_DIR/project-iam.json"
   ```

   If there is no approved Google Cloud account or CLI, **skip collection and leave the gate blocked**. Never obtain or share a private key just to run this review.
4. In a *disposable checkout* based on exact PR #87 with the H1/A and H1/B patches applied, run:

   ```bash
   node --test tests/r3-real-authority-preflight.test.mjs \
     tests/r3-h1-read-cascade.test.mjs \
     tests/r3-h1b-authority-evidence-review.test.mjs
   node scripts/r3-h1b-authority-evidence-review.mjs \
     --effective-rules "$PRIVATE_DIR/effective-rtdb-rules.json" \
     --project-iam "$PRIVATE_DIR/project-iam.json"
   ```

   Exit 0 means **only this narrow offline document-review policy** matched its strict conditions. It is **not a release approval**. Exit 2 means missing/rejected evidence or a required manual review. Do not assume an empty, unreadable or incomplete IAM policy establishes least privilege.
5. Use the existing `scripts/verify-firebase-read-boundaries.mjs` only with explicit owner authorization for read-only live status probes. It does not access or print response bodies and cannot establish write authorization, Firebase Rules provenance, service identity, sensor authenticity or data safety.
6. Continue with a **separate private inventory** of the actual public descendants, inherited project/folder/organization IAM, resource-level IAM, service-account keys/impersonation, RTDB privileged Admin SDK callers and runtime service identities. Review only field names/types and effective privileges; never export sensitive values into the public repository. The current checker explicitly marks all these areas unverified.

## Decision after inspection

- A source/production rules mismatch must be investigated, not silently corrected or deployed.
- Any parent-level read grant or unexpected conditional grant requires manual safety review; a child `.read:false` never narrows an already granted parent read.
- Broad write grants or an Admin credential can bypass the proposed verification pipeline. A currently valid stolen confirmer token was demonstrated to create a schema-valid but forged record in the existing localhost lab. A downstream attestor that rejects it is **not** prevention of the untrusted write.
- A production trust boundary requires a separately protected mandatory Ed25519 verifier, scoped confirmation/publisher privileges, operator-controlled compromise epoch/quarantine, independently durable witness, explicit rollback and real end-to-end checks in a disposable nonproduction Firebase environment before any production proposal.
- The Arduino Uno remains sole authority for its independent local alarm and gate safety logic. No remote gate control is created by this review.

## Verification and limits

Offline focused tests cover source rules, IAM role risk indicators, malformed policy rejection, parent-read and unexpected-write red flags, sensitive-identity redaction, symlink/world-readable/oversized input refusals, and no-network/no-write source assertions. They do not execute the Firebase Emulator, Firebase IAM permissions, full Next.js build, pinned ESP8266 firmware tests or physical acceptance.

**R3-H1/B is a private-evidence collection/readiness tool. Real authority integration, 11 mandatory gates and production release remain blocked.**

Official references:
- https://firebase.google.com/docs/database/security/core-syntax
- https://firebase.google.com/docs/database/rest/app-management
- https://cloud.google.com/sdk/gcloud/reference/projects/get-iam-policy

## 2 November 2026 — H1/B2 follow-up: prevent misleading offline CLI success

A subsequent review found that the original CLI success predicate used only the imported
Rules contract and a subset of IAM checks. An unchanged but invalid *source* contract,
a different otherwise-valid imported Rules document, or empty IAM bindings could therefore
receive process exit 0. Exit 0 did **not** authorize release, but was misleading for automated
review consumers.

The H1/B2 revision requires **all** of these conditions before returning process exit 0:
valid source preflight; valid imported Rules preflight; structurally identical source and
imported Rules; structurally well-formed project IAM with at least one populated binding;
no public member, high-privilege, custom, non-viewer or conditional IAM binding flags.
Otherwise the CLI exits 2. The result remains permanently `NO_GO` even on exit 0.

A nonempty IAM binding **does not prove** project completeness, actual deployed authority,
current permissions, inherited IAM, runtime Admin credentials, or database data boundaries.
An empty binding list can be a legitimate policy; it is deliberately **insufficient
for this limited evidence review**, not automatically a vulnerability. No cloud permissions
or effective rules were changed or checked in this revision.

## 4 November 2026 — H31: close the second private-evidence parser and custody gap

H29/H30 hardened the **Rules-only** file comparator but did not automatically protect the separate **Rules + project IAM** review CLI in this document. Before H31 that reader still used `JSON.parse` on both private documents and accepted evidence from arbitrary file paths. This meant a shadowed permissive IAM `bindings` or `role` property could be silently discarded when later duplicate keys resolved to an apparently benign document. A real operator could also accidentally supply a Rules or IAM export from a tracked checkout path or unrelated temporary directory.

H31 moves duplicate-key decoding/validation into the shared **pure, no-I/O** `scripts/r3-private-json-evidence-core.mjs` parser. Both offline CLIs now reject duplicate property names at any depth, including Unicode-escaped aliases, without returning the offending bytes, names, roles, members, paths or secrets. IAM source evaluation remains **review-only** and does not infer effective project or inherited policy.

The Rules + IAM **CLI** now accepts only directly contained regular, single-link, non-symlinked files in the documented operator-owned `$HOME/.local/share/floodguard-private/r3-h1b` directory. On POSIX, require the root to be private (`0700` recommended) and each file `0600`; the existing 1 MiB per-file bound remains. The source repository baseline and manifest are still checked-in review artifacts, **not** fetched from Firebase. This tool does not inspect Windows ACLs, cannot prove custody of user-supplied exports, and does not attest project/instance provenance or the effect of production IAM. **H32 changes the exported file reader to require a caller-provided private evidence root**; omitting it fails closed even in direct library use. The CLI continues to provide the documented fixed owner-home path. Synthetic tests provide a disposable private root. For structured, in-memory synthetic data use `assessPrivateAuthorityEvidence` without opening any files. Never copy live Rules or IAM member names into GitHub Actions, PRs, chat or public logs.

The new targeted tests include shadowed IAM bindings, Unicode aliases, duplicate Rules root keys, outside/nested file paths, symlink and hardlink attempts, group-readable files and a non-private directory. All fixtures are synthetic and reside under a disposable HOME during CI. Both previous CLIs remain hard-coded to `NO_GO`, regardless of offline match.

**This is an evidence-integrity safeguard, not a production security or release attestation.**

## 4 November 2026 — H33: forbid CWD-selected source Rules/manifest in both CLIs

The Rules-plus-IAM CLI now reads the repository's `firebase.rules.json` and `docs/firebase/R3_REAL_AUTHORITY_PREFLIGHT_20261102.json` **relative to its own script checkout**, not the current shell directory. The operator's two private Rules/IAM export paths remain within `$HOME/.local/share/floodguard-private/r3-h1b` and all H31/H32 private-read safeguards stay enforced. Invoking the program from another working directory cannot silently select arbitrary substitute local baseline files. H33's synthetic tests prove a wrong-CWD file cannot falsely produce a matching candidate conclusion, while correct privately scoped inputs still permit only narrow offline review, never release.

This checks *local path selection*, not digital signature or commit authenticity. A maliciously modified script/checkout, forged console export or incomplete Cloud IAM cannot be recognized by the tool as authentic production evidence. An authorized operator must verify checkout origin, exact reviewed commit, Firebase instance and capture custody separately. Every output continues to carry `releaseDecision:NO_GO`, and no cloud credentials or live data are required.

## 4 November 2026 — H34: reject ambiguous local reviewed Rules/authority manifest

H33 anchored the two CLIs to their script checkout, but baseline Rules and manifest were still decoded using plain `JSON.parse` even though the private operator inputs had a duplicate-key guard. H34 applies the shared no-I/O duplicate-key-safe parser to **both** checked-in reviewed files in both offline reviewer CLIs. This prevents shadowed root rules, nested public read grants, manifest `releaseDecision`, or role trust from being silently discarded before the comparison. Existing fixed redacted failures and `NO_GO` results are preserved.

The offline tools do not verify the true Git commit, which Firebase project served an operator snapshot, inherited IAM, privileged Admin identities, public descendants, device authenticity or independent warning delivery. Effective production and physical gates remain blocked until separately verified and approved.
