# Read-only staged telemetry attestor — isolated Firebase Emulator verification

**Draft security experiment — NOT FOR PRODUCTION DEPLOYMENT.**

This stage tests a previously missing trust boundary: an independent issuer reads *actual emulator-stored* private sensor readings with **read-only, device-scoped RTDB rules**, verifies a signed device envelope and a separately signed receipt, checks current operator enrollment, and issues a short-lived Ed25519 attestation. A distinct authenticated publisher then validates the attestation and updates only the narrow `/floodguard/publicationLab/water` snapshot and checkpoint.

## Roles and permissions

Three synthetic identities are independent:

- `device-stage-a` with `fg_ingest_v1`: writes only its own staged four-field frame, under the existing experimental rules; cannot read staging or publish.
- `attestor-stage` with `fg_attest_ingest_v1`: reads its **single bound device's** `deviceAuthorization/<deviceId>`, `staging/ingestV1/<deviceId>`, and its own operator-owned attestor authorization record. It **cannot write** staging, authorization, gate, live feed, bot, private ESP metadata or publisher state. It cannot read another device or the staging parent.
- `publisher-water-stage` with `fg_publish_water_v1`: writes only the narrow water publication subtree atomically and cannot read staging/device authorizations or issuer private keys.

The distinct rules are in `docs/firebase/phase-b-attestor-lab.rules.json`, loaded **only** by `firebase.phase-b-attestor-lab.json`. Preexisting nested rules come from the narrow publisher experiment; the actual effective production `firebase.rules.json` is not changed.

## Evidence chain exercised

1. A synthetic device Ed25519 key signs the canonical Stage 7 frame; the scoped test device writes its four-field sensor frame through the actual database emulator.
2. The independent read-only issuer verifies that device signature, a separate Stage 8 receipt signature and digest, bounded source/receipt times, the operator-pinned device public-key fingerprint, enabled source authorization and **the exact stored frame read through rules-constrained Firebase**.
3. The issuer reads operator state and frame a second time to detect some concurrent changes, then signs a five-second attestation with a distinct ephemeral private key. All real credentials and trusted configuration are absent.
4. The narrow publisher uses its independently pinned *public* verification keys, validates both issuer signatures and short-lived evidence, then performs a scoped Firebase RTDB transaction that atomically advances the observed snapshot and replay checkpoint. `overallRisk` remains `UNKNOWN`.
5. Denied requests do not change publication state; the old `/floodguard/live` web/mobile feed is never mutated.

Run locally with Node 22, Java 17 and Firebase Emulator:

```bash
npx --yes firebase-tools@14.18.0 emulators:exec --only database \
  --project demo-read-only-attestor --config firebase.phase-b-attestor-lab.json \
  "FG_READ_ONLY_ATTESTOR_TEST=1 FG_NARROW_SIGNED_BRIDGE_TEST=1 node --test tests/read-only-staging-attestor-emulator.mjs"
```

## Unresolved release blockers

- **No real firmware source identity or credential provisioning:** Keys and auth claims are ephemeral, and this test has no flashed ESP8266, secure element, verified on-device TLS, nonproduction cloud issuer, key rotation, or real hardware session.
- **Not fully atomic across staging and authorization reads:** The attestor's double-read reduces race exposure, but an operator can revoke a device or a new staged frame may overwrite the old one immediately after its second read. Production requires an append-only, versioned, immutable confirmed-ingest record with durable commit acknowledgment and issuer guarantees that remain valid through publication. **Do not claim this stage provides race-free production provenance.**
- **"DATABASE_CONFIRMED" means only that the current staged frame was read successfully from the local Firebase Emulator:** It does not establish a durable distributed database commit, physical measurement correctness, or a real production backend. A real issuer must couple receipt creation, stored frame identity and authorization to the same verifiable durable record.
- **Unchanged client paths:** Website/mobile still subscribe to `/floodguard/live`, rather than the new experiment's `/floodguard/publicationLab/water/current`. No cutover, parallel publication contract or physical alarm acceptance is implemented.
- **No production deployment or merge:** The existing production anonymous-write integrity issue remains unclosed. The explicit owner-controlled migration, mobile CI, backups, supervised field tests and rollback plan remain required.

The tests themselves are not a safety certification. Never deploy this experimental rules file, issue real keys, reflash devices, merge drafts, expose ingestion publicly or operate the gate from this work.
