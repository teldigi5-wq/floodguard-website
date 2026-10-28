# Authority-only signed staging — isolated RTDB emulator policy candidate

**Status: research / draft only. Not deployed or authorized for any real Firebase project, flashed ESP8266, alert delivery, or public endpoint.**

## Reason for the new boundary

The prior `phase-b-strict-readonly-live.rules.json` grants the device mock UID and `fg_ingest_v1` claim direct write access to its own staging row. The Stage 7 signed-device and Stage 8 signed-receipt checks occur in an optional local application bridge; those checks are **not** enforced by Firebase RTDB Rules. A device-token holder can bypass them.

This candidate **does not mutate the original strict candidate or production rules**. Its new isolated file `phase-b-authority-only-staging.rules.json` instead allows an explicitly assigned `ingest-authority-stage-a` identity to write only a complete, bounded, increasing-sequence record for `device-stage-a`, after all these independent rules checks:

- `auth.uid === 'ingest-authority-stage-a'` and `auth.token.fg_ingest_authority_v1 === true` (mock claims: NOT a proven Firebase Auth issuer).
- `/floodguard/ingestAuthorityLab/ingest-authority-stage-a` is enabled, has exact scope `prototype-signed-staging-authority-v1` and assigns the written `$deviceId`.
- `/floodguard/deviceAuthorization/$deviceId` remains enabled with exact `prototype-ingest-v1` scope.
- Only `/floodguard/staging/ingestV1/$deviceId` may be written; sequence must strictly increase, four expected fields are validated, unknown fields, deletions and partial updates are denied. Parent staging and all public/live writes remain denied. Staging is never client-readable.

The original `signed-staging-emulator-writer.mjs` now runs with this separately restricted authority test client, not a directly authenticated device. It validates canonical Stage 7 device-signed evidence, an independently signed Stage 8 acceptance receipt, current HMAC-sealed operator identity, epoch/key and exact last accepted replay sequence **before** performing the one permitted RTDB client write. The bridge never uses Admin SDK, issues a credential, controls the physical gate, or reads private staging data.

## Explicit negative security boundary

These rules restrict who can directly write from a device account, but **do not cryptographically prove that the authority evaluated the signed evidence**. A stolen authority token—or compromised authority process—can submit a schema-valid, higher-sequence frame directly for its assigned source. An explicit negative emulator test demonstrates this bypass. Accordingly, the candidate is *authority-only*, **not fully unbypassable**. Production still requires protected authority credentials, independent Auth/custom-claim issuance and revocation, verified network isolation, server-side mandatory verification, durable audit/confirmation, token/privilege rotation, and supervised threat modeling. A real privileged Admin SDK authority may bypass RTDB Rules entirely and must instead be constrained by IAM/process isolation. This experiment exercises neither real Admin IAM nor cloud persistence.

## Test isolation and evidence

Test-only configuration: `firebase.phase-b-authority-only.json` with database emulator bound to `127.0.0.1:9000`, synthetic project `demo-authority-only-ingest`.

```sh
npx --yes firebase-tools@14.18.0 emulators:exec \
  --only database --project demo-authority-only-ingest \
  --config firebase.phase-b-authority-only.json \
  "FG_SIGNED_STAGING_BRIDGE_TEST=1 FG_TRUSTED_INGEST_AUTHORITY_TEST=1 node --test tests/authority-only-signed-staging-emulator.mjs"
```

The suite tests denied anonymous/direct device/ordinary/missing-claim credentials, allowed signed authority staging, rejection of forged/stale/mismatched evidence, assignment and cross-path isolation, independent local/cloud revocations, strict sequence monotonicity, no unauthorized reads, uncertain lost ACK, and deliberate privileged-authority bypass demonstration. Privileged `withSecurityRulesDisabled` test contexts are used **only** for deterministic fixture setup and independent post-write observation; they are never used by the trusted writer.

## Release NO-GO

Nothing here closes the reported actual production Firebase anonymous-write exposure. No live RTDB Rules audit, real ESP8266 certificate/credential custody, verified Auth token issuer, cloud durability/reconciliation, native Flutter CI, bot host or hardware validation was performed. Do not deploy/merge without owner authorization and all independent acceptance gates. The next R2 decision is whether the trusted authority runs in a nonproduction separately hosted backend with provable credential boundary (and its recurring cost) or within another equally isolated operator-managed environment; continue preferring zero mandatory spend.
