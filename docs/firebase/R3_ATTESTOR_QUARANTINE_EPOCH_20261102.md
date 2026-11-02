# FloodGuard R3 — attestor quarantine and epoch fencing (Emulator ONLY)

**2 November 2026. Draft successor to PR #92; NOT deployed, merged or operationally approved. Production NO-GO.**

## Verified starting point

Draft PR #92 at `9e53ab83646669c65e25e113525bc3bcb7645cae` passed 6/6 real Auth+RTDB Emulator tests. Disabling the confirmer service stopped the read-only attestor from making *new reads*, but merely re-enabling the service restored access to historical records. Previously issued signed attestations stayed valid until their own expiry and were not revoked. Live Firebase child reads recovered, but the owner's last observed `system.lastUpdate` remained `2026-08-25T14:30:41.226Z`. This stage does **not** address physical uploads or gate actuation.

## Narrow lab-only Rules alternative

The new `docs/firebase/r3-attestor-quarantine-epoch-lab.rules.json` starts from PR #92's **unpublished** service-fenced Rules. It adds a locked private `floodguard/attestationIncidentAuthority` node with `.read: false`, `.write: false` for ordinary Rules-governed clients. For the fixed `device-stage-a` synthetic prototype, it adds **two extra checks** to the same four attestor read predicates: `quarantined === false` and `currentEpoch === 1`. The device-specific predicates resolve `$deviceId`; the authorization-record predicate uses the existing fixed synthetic device ID. All other read expressions, write expressions, validation expressions, paths, private ESP metadata and public read boundaries remain unchanged.

The operator-only Emulator fixture begins with `{quarantined:false,currentEpoch:1}`. A simulated incident atomically *should* disable the confirmer service and quarantine the device while increasing the epoch to 2. The test uses separate fixture owner writes to reproduce this eventual state; it **does not yet demonstrate transactional, atomic or durable incident recording**. When the service is re-enabled, old v1 confirmations remain unreadable. Clearing only the `quarantined` flag also does not reauthorize old epoch-1 records. There is intentionally **no epoch-2 attestation activation path** in this fixed-v1 lab; fail closed until separately authorized migration and independent signed witness evidence.

The private incident node is inaccessible to ordinary authenticated, attestor or anonymous REST clients through RTDB Rules. However, privileged owners and Admin SDK access **bypass Rules**, so they can still alter or roll back this database-local metadata. This work is a controlled **quarantine/epoch policy rehearsal**, NOT independently durable, tamper-evident, monotonic revocation. Do not call the resulting controls production-safe.

## Test contract

The exact project must be `demo-r3-attestor-quarantine-epoch`, with `FG_R3_QUARANTINE_EPOCH_TEST=1`, `GCLOUD_PROJECT` set exactly to that demo ID, Auth Emulator bound to `127.0.0.1:9099`, and RTDB Emulator bound to `127.0.0.1:9000`. The local fixture owner bypass is used for synthetic setup and incident simulation only, never a field-device credential or publishing identity.

The test suite covers: initial scoped attestor access; service-disabled refusal; quarantine denial; epoch-2 denial of old records even after re-enable or quarantine-clear; missing-metadata fail closed; ordinary/attestor/anonymous denial of private incident mutation; unrelated public/private read boundaries; and strict source diff proving only four attestor read guards plus the new private incident node changed.

Run via the dedicated `r3-attestor-quarantine-epoch-emulator.yml` workflow. This is synthetically provisioned, free local testing, not cloud IAM or real hardware verification.

## Important still-open conditions

- **Independent, monotonic incident log:** append-only external witness and signatures from separately controlled principals are missing. A compromised privileged operator can restore an old epoch or delete quarantine. Need durable audit, dual approval and disaster recovery semantics.
- **Already-issued approvals:** the new database Rules do not invalidate signed attestations already held by a caller. Downstream verifier and publisher must require current signed incident epoch, attestation expiry and revocation proof.
- **Privileged service writer compromise:** existing research shows a stolen still-valid service token can create syntactically valid confirmations even when application signature checks would reject them. Do not mistake read-only attestor fencing for a fix at the write boundary.
- **Fresh physical telemetry:** historical ESP8266 source lacks evidenced verified TLS and scoped writer authentication; the live system timestamp is old. No current firmware, physical source identity or gate testing.
- **Production safety:** no open public write permissions, no live cloud Rules/IAM/data changes, no firmware flashing, messaging, gate control, merge or deployment.

**All work remains DRAFT, EMULATOR-ONLY, NO-GO.**
