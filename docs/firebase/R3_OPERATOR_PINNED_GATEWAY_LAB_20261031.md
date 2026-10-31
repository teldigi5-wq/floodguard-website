# FloodGuard R3 — operator-pinned server-side ingestion gate (isolated emulator lab)

**Draft research; NOT a deployed service, hardware driver, API endpoint, or public-safety assurance.** Changes remain stacked on PR #26 → #25 → #24 → #23 → #22 → #21 → #20 → #18 → #14. Protected main, website `FloodProvider`, Firebase production rules and external mobile/bot infrastructure are unchanged.

## Intent

PR #26 verified that a client can reject a forged receipt when the server-facing leaf contains a report and independently signed issuer acceptance. The same PR intentionally demonstrated that a privileged **scoped RTDB writer can bypass the client and insert a structurally valid but cryptographically forged record**, because RTDB Rules cannot verify Ed25519.

This experiment adds `createR3ServerVerifiedIngestLab`, a pure Node-side policy module that publishes only in the isolated loopback RTDB Emulator after validating independent operator-owned trust.

- **External fixed trust:** Both water and rain identities are explicitly pre-enrolled at construction with an enabled epoch, independent Ed25519 report public key, and independent Ed25519 issuer public key. The four public keys must be distinct. The constructor snapshots trust configuration; it never reads root trust from RTDB, and callers cannot enroll identities.
- **Minimal request:** The only permitted input is `{stream,record}` containing a signed report. Request-supplied database paths, Firebase clients, issuer receipts, signing keys, registry updates and gate commands fail closed.
- **Source verification:** Canonical report shape, Ed25519 signature, stream/source alias, enrolled epoch, bounded source timestamp and sequence are verified independently of client-provided metadata.
- **History gate:** The previous atomic RTDB leaf must contain a fully verified **report AND issuer signature** with a matching digest/epoch/sequence/timestamp. A corrupted current record stops publication rather than being overwritten or auto-repaired. Source/epoch cannot change and sequence and event clocks must advance monotonically.
- **Independent signer capability:** Only after the historical checkpoint passes does an injected issuer service sign the deterministic R2 acceptance receipt; the signature is verified against the independently enrolled public key before publishing. The issuer private key is never a parameter to a `publish` request, exposed to the browser or returned.
- **Minimal database access:** An operator-owned `databaseForStream` provides a test-only RTDB authenticated client. The module writes only `/floodguard/attestedEvidenceLabV1/water` or `/rain`. It never writes alarms, live hardware state, authorization registry, gate commands, private contacts or device metadata. Firebase Rules recheck monotonically at the atomic leaf.
- **Uncertain write:** A lost write acknowledgement returns `publication-outcome-unconfirmed`; no blind retry. Independent operator recovery is needed.

All signer identities, test-issued receipts and authentication claims in CI are **ephemeral synthetic fixtures**. The module has no HTTP endpoint, background process, Firebase Admin SDK, production key, service account, actual hardware driver, or real physical-data channel.

## CI acceptance

The focused Node tests cover wrong public-key pins/role collisions, revoked identities, forged input, extra request fields, issuer outages/wrong signatures, stale and reordered reports, current checkpoint corruption, concurrency, no unapproved recovery, and the emulator-only environment gate. The Firebase rules integration uses the **actual loopback Firebase RTDB Emulator** to exercise water/rain publishing with restricted writer claims, wrong-identity and revoked-credential denials, read-only browser verification, and private-node noninterference. It retains a negative test explicitly demonstrating how a stolen test publisher credential could bypass this adapter and write a forged signature directly.

Commands:

```sh
npm ci --ignore-scripts --no-audit --no-fund
node --test tests/r3-server-verified-ingest-gate-lab.test.mjs
npm install --no-save --package-lock=false --ignore-scripts @firebase/rules-unit-testing@5.0.2
npx --yes firebase-tools@14.18.0 emulators:exec --only database \
  --project demo-fg-r3-gated-ingest --config firebase.r3-atomic-dual-lab.json \
  "FG_R3_TRUSTED_INGEST_LAB_TEST=1 node --test tests/r3-server-verified-ingest-gate-emulator.mjs"
```

## Explicit unresolved production security blockers

**No real trusted gateway has been deployed.** `databaseForStream`, the independently trusted signer and the registry are still synthetic test fixtures. In production, a dedicated IAM-scoped service must exclusively own RTDB writer credentials, undergo explicit endpoint authentication and authorization, limit exposure and message size/rate, validate the real device's enrolled key and firmware provenance, and integrate a protected KMS/signing service with rotation, revocation, monitoring and incident response. An attacker with the raw scoped writer credential can bypass this library and force invalid public records; the browser rejects bad cryptography, but availability and antirollback remain vulnerable.

**Timestamp ownership remains a protocol gap.** The current R2 signed report includes `receivedAtMs`, which should be a trusted server-owned reception fact. This lab enforces closeness to a separate injected operator clock but does not convert device-attested time into a trusted receipt timestamp. Before production, the schema must evolve so the server issues its own independently signed acceptance timestamp rather than accepting it as an equality requirement from the source.

**Durable independent high-water authority remains absent.** The local fsync journal from PR #24 does not stop privileged restoration of a previously valid sealed snapshot. A privileged restore can race between preflight read and `.set()`. The gateway's returned `requiresIndependentRecoveryAnchor:true` is a genuine unresolved operational obligation, not proof that it happened.

No changes to Firebase production rules, cloud credentials, native mobile, WhatsApp bot, Vercel production, real sensor data or physical gate. No claims of production-grade safety, real device authentication, nonrollback persistence or fault-tolerant alerts.

**R2 partial, R3 lab-only, all deployment and physical acceptance gates NO-GO.**
