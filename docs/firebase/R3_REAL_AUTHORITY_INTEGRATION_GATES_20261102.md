# FloodGuard R3 — Real authority integration: architecture and evidence gates

**2 November 2026 · stacked on verified draft PR #78 at `190840ddf53c8893ec257a6aa8c9e3d18b5c3fd3`. Review/design only. NO-GO.**

## Verified source and API facts

- PR #77 has one local SQLite transaction for **synthetic** authorization, confirmed rows, issued signatures and revocations. PR #78 adds a **synthetic** in-memory independent witness contract that notices a restored old local DB file. Neither runs as a protected service.
- The existing repository already contains extensive Firebase **emulator-only** Phase B rules, role simulation, dual verifier/authority approval, signed staging, confirmers, publisher and revocation labs. Do **not** replace or promote these into production. A client with a mock authority token can bypass application signature validation unless signatures are forced at a separate trusted backend.
- The repository's `firebase.rules.json` is **not evidence of effective deployed Firebase Rules**. It explicitly blocks writes at the root, but its public reads apply to entire `water`, `rain`, `gate`, `alarm`, `devices` and `system` subtrees; inventory all actual descendants privately before any rules rollout. The live rules observed in October returned 401 for unauthenticated reads, which does not prove current live-write authorization.
- Firebase's official **Admin Realtime Database SDK documentation** distinguishes full administrative access (which can bypass Security Rules) from limited rule-scoped identities and describes `databaseAuthVariableOverride`. A service-account credential with broad project editor/admin access remains a high-risk writer regardless of any application-side allowlist. Merely setting an override without a verified effective IAM/rules configuration is **not enough**.

## Candidate responsibility separation, not a deployed stack

| Identity | Intended capability | Explicitly forbidden |
| --- | --- | --- |
| Sensor ESP8266 | Authenticated, bounded HTTPS signed ingress request to a server | Firebase Admin credential, direct public live write, gate command, unsafe TLS |
| Verifier | Verify canonical signed source frame and operator-bound authorization | Issue DB confirmation, write public leaves, alter signer keys |
| Confirmer | Read independently persisted, exact-sequence private confirmation and verify durable authorization fence | Caller-supplied `DATABASE_CONFIRMED`, public writes, ACL edits |
| Publisher | Write **only** reviewed five scalar experimental water paths following signed receipt and externally verified confirmation | Parent/root PATCH, arbitrary subtree write, gate/actuator command, private network fields |
| Witness | Authenticated monotonic CAS in distinct failure/credential/restore domain | Sharing Firebase DB snapshot, same deployment key custody, public telemetry write |
| Web / Flutter / WhatsApp reader | Read only reviewed public telemetry children, present UNKNOWN/STALE conservatively | Privileged backend credentials, declaring physical SAFE from RTDB timestamp |

These are distinct logical **responsibilities**, not evidence of six live processes or six separately provisioned Firebase roles. At least the signer and independently durable witness must have separately controlled key custody and failure domains; whether Firebase can enforce the proposed per-role permissions must be verified against a concrete **non-production deployment design**.

## Explicit configuration and trust constraints

1. **No generic Admin credential** in the web, device, mobile or bot. For a backend, decide whether to use an authenticated limited RTDB identity whose operations are evaluated by Rules, or a tightly restricted IAM service account plus separately enforced server-side path policy and runtime sandbox. Verify the exact Firebase SDK behavior and effective permissions with real integration tests. Full Admin and Rules evaluation are not interchangeable.
2. **No runtime secrets in Git, CI artifacts or client bundles**. Prefer workload identity or short-lived credentials where supported; allow service-account files only in private provisioned infrastructure after security review. Independent signer/witness keys should not be co-located.
3. **No implicit database authority from a successful client write callback**. The confirmer must have a separately authenticated read-after-commit capability and a durable, scoped transaction/receipt protocol. Re-read exact content/digest/epoch/sequence and enforce replay, clock and revocation fences.
4. **Atomicity:** an external witness CAS and a Firebase/SQLite transaction are not one atomic operation. A DB-ahead-witness mismatch is NO-GO and requires human-reviewed recovery; never auto-promote or clear the ledger.
5. **Physical safety:** Arduino UNO owns actual alarm/gate behavior. Website, app, bot and cloud may display/notify only; no remote actuator path is authorized by any role. Preserve fail-closed public UNKNOWN/STALE when identity or receipt is unavailable.
6. **Continuity:** the actual deployed ESP8266 binary, upload shape, flash/OTA geometry, independent private backups and brownout behavior are unknown. No migration may remove functioning field warnings without approved parallel validation, backout plan and owner-controlled maintenance window.

## This PR's concrete, executable deliverable

`docs/firebase/R3_REAL_AUTHORITY_PREFLIGHT_20261102.json` records six **proposed** role boundaries and eleven explicitly unresolved real-world gates. `scripts/r3-real-authority-preflight.mjs` checks the exact allowlist and compares the checked-in `firebase.rules.json` *candidate* against root/descendant write-denial and nine public child-read surfaces, including ESP private network paths. It emits only a fixed, nonsecret decision object:

- Passing source review: `reviewValid: true` and **releaseDecision: NO_GO**, with effective cloud rules/hardware/independent witness explicitly **unverified**.
- Any enlarged role, hypothetical production/admin approval, missing evidence gate, accidental direct Firebase write grant, broad private read, or malformed input: fail-closed **NO_GO**, CI failure.
- The output **cannot** grant deployment, merge, firmware flashing, public cloud publishing, alert delivery, acknowledgment, or physical gate operations. It cannot validate remote Firebase IAM or certify a future production deployment through manifest edits alone.

The test suite includes deliberate attempts to transform an offline manifest into a production authorization, widen publisher scope, add privileged Admin permissions, skip real acceptance evidence, or hide a descendant write beneath a root deny. CI runs the tests and pinned NodeMCU, LittleFS, ingress and website regressions. This is a **pre-deployment code-quality control**, not a substitute for the future signed operator release process.

## Remaining acceptance plan (separate approvals and environments)

1. **Private inventory:** operator-approved read-only capture of effective Firebase Rules, IAM principals, public descendants and current firmware/upload behavior. Keep private values and credentials out of public PRs.
2. **Independent service design review:** define physical hosting and cost budget (free/open-source where feasible), service-account/IAM scope, pinned role identities, mutual auth, key rotation, durable monotonic witness, threat model, logging and incident recovery. No trust in an HTTP-supplied role.
3. **Emulator then disposable nonproduction project:** prove negative cross-role and parent-write tests, direct Admin bypass threat checks, verified actual Auth token behavior, signed ingest and revoked-device denial, exact private confirmation readback, stale/lost ACK, independent witness consistency and secret isolation.
4. **Cross-client acceptance:** mobile native CI, website accessibility/browser tests, WhatsApp host/session recovery and honest UNKNOWN/STALE behavior. No public safety clearance from synthetic SAFE.
5. **Hardware acceptance:** authorized isolated ESP8266 flash/OTA backup and brownout/power-cut recovery, UNO manual override/interlocks and alarm operation under supervision; protect live warnings.
6. **Human-controlled release decision:** only after all real evidence is independently reviewed, repeat latest branch/PR/CI security checks, approve a private rollback window, and separately authorize any hosting, Firebase Rules publication, firmware flash or deployment. This review-only preflight is not a release button.

**No merge, deploy, production Firebase changes, token provisioning, firmware flashing, alert sending or physical gate commands. PRODUCTION NO-GO.**
