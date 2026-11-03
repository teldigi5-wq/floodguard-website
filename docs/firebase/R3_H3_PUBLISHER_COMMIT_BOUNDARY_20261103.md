# FloodGuard R3 H3 — ticket-bound water-publication commit fence (Emulator only)

**3 November 2026. Stacked strictly on draft PR #96 at 8fa68c298fc8382536a8c5a6212baf9b612ac2f4. Unpublished experiment. PRODUCTION NO-GO.**

## Context and reused security work

R3 H2 (PR #96) established per-device quarantine of new attestor reads; it did not revoke already issued attestation signatures. PRs #73–#87 already cover three independent Ed25519 signatures, durable local confirmation/replay research, scoped signed confirmer worker, service revocation, and an independent read-only attestor. H3 does not replace these or introduce a new field protocol.

The historical live ESP8266 uploader was anonymous and its timestamp on the actual Firebase instance was around 69 days old at the last observed check. Android anonymous read permission was restored, not authenticated ingestion. The existing unpublished H2 Rules candidate denies publication. It is kept unchanged.

## Narrow, alternative H3 candidate

The new file `docs/firebase/r3-h3-publisher-commit-fence-lab.rules.json` starts from H2 and changes **only** the whole-record `/floodguard/publicationLab/water` write condition, plus adds private `/floodguard/publicationAdmission/device-stage-a`. This is NOT `/floodguard/live` and has no connection to a deployed Firebase project. It is a disposable local Auth+RTDB Emulator experiment.

The proposed whole-record write requires ALL of the following, with the actual RTDB Rules engine evaluating the live database state **at commit**:

1. An Auth Emulator ID token for fixed `publisher-water-stage` with the `fg_publish_water_v1` claim, plus a separately seeded enabled publisher authorization with the expected water-publication scope, fixed device and epoch.
2. The device remains enabled and scoped as prototype ingest, and an independently controlled per-device quarantine marker is exactly the boolean **false**. Missing or true blocks publication.
3. A private, enabled, privileged-fixture-issued `publicationAdmission` ticket binds the exact device, epoch, next sequence, SHA-256 digest, observed timestamp, water distance, water level and status. It also carries a bounded creation and expiry interval. Ordinary clients cannot read or write the ticket.
4. The old publication checkpoint exists and is initialized. The new whole-record write must advance the checkpoint by **exactly one sequence**, keep the device/epoch bound, change the digest, and set the next checkpoint and public observation to precisely the ticket's approved fields. Public `system/overallRisk` remains `UNKNOWN`; no physical SAFE or gate clearance is derived.
5. The emulator server's `now` must fall inside the ticket lifetime (at most 5 seconds from issue), and the observation must fall within the established 30-second past/2-second future acceptance window. Existing schema validations reject unexpected descendants.

The publisher can only submit the exact pre-authorized bundle. A valid publisher token **alone** cannot mint its own ticket or publish arbitrary water observations. Ticket seeding currently uses ONLY the privileged disposable Emulator fixture; it is not a real independent, signed approval process.

## Threat model and deliberate limitations

- **Known stolen-confirmer-token weakness remains open:** a currently valid stolen confirmer service token may forge a schema-valid immutable record. H3 does not prevent that. The real authority issuing a publication ticket must cryptographically verify the device, receipt and independent attestation, and require separately protected keys and independent witnessed history before granting any ticket. This is not yet built or tested here.
- A compromised privileged admission issuer (or Admin SDK role bypass) can mint forged tickets. Firebase Rules cannot verify arbitrary Ed25519 signatures; this candidate only enforces admission provenance through a private, operator-controlled database row. Admin bypass, service IAM, key custody, and real nonproduction roles must be examined separately.
- An already-issued ticket may remain usable until its short expiry **if it was not consumed**; quarantine and revocation block it on each attempted commit. Once published, identical replay is blocked by the checkpoint sequence. Simultaneous distributed authority updates are not an atomic transaction with independent external witnesses.
- The public snapshot is an observation, not verified sensor truth. A synthetic status of `SAFE` or `WARNING` cannot establish real flood safety, hardware device identity or gate position. The mobile/dashboard/bot remain bound to their existing live paths, not this isolated lab.
- This is a one-device, one-epoch lab. No real token provisioning, observer clock accuracy attestation, publisher deployment, network endpoint, field device, alert sending, or gate actuation is authorized.

## Acceptance tests

The isolated `demo-r3-h3-publisher` Auth+RTDB Emulators use fixed loopback ports 9099 and 9000, existing CLI 14.18.0 and Java 17. Synthetic owner-only fixture seeding never contacts production. Ten integration tests cover positive exact whole-record publication, denied credentials, absent/disabled ticket, altered payload, revoked device and publisher, missing/quarantined incident control, expired/overlong tickets, replay and partial update denial, and out-of-scope physical/parent writes. Four independent source tests prove the exact H2-to-H3 permissions delta and host confinement.

Workflow: `.github/workflows/r3-h3-publisher-commit.yml`. Exact-head CI result is required before this stage is called verified.

## Still required before any real release

Mandatory cryptographic device/receipt/attestor verification by a separately protected ticket issuer, atomic/external-monotonic evidence and revocation recovery, single-use/replay-safe publication across failures, independently inventoried real Firebase IAM/data descendants and existing Rules, fail-closed cross-client freshness behavior, verified signed ESP8266 TLS and device backup, isolated UNO gate interlocks and flood alert supervision, human-controlled deployment/rollback.

**No merge, no deploy, no live Firebase writes/Rules/IAM changes, no firmware flash, no alerts, no gate commands. DRAFT / NO-GO.**
