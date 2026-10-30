# Versioned, write-once confirmation lab — Firebase Emulator only

**Draft security experiment. NO production deployment, credentials, reflash, merge or device control.**

## The gap this addresses

The previous read-only attestor checked a mutable latest-frame record twice. A later device write could replace the frame after the checks; source authorization could also change before the publication. This alternate lab introduces a **write-once confirmation per sequence**, and enforces the device's current authorization **again at the final restricted publication transaction**.

Under `firebase.phase-b-versioned-confirmation-lab.json`, the isolated rules are in `docs/firebase/phase-b-versioned-confirmation-lab.rules.json`. The primary `firebase.rules.json` and deployed Firebase are not modified.

## Distinct roles

- **Device** `device-stage-a` with `fg_ingest_v1`: writes only its latest four-field test frame, governed by existing prototype rules. It cannot write a confirmed record.
- **Confirmer** `confirmer-stage` with `fg_confirm_ingest_v1`: checks canonical Ed25519 device signature, independent signed receipt/digest, operator key pin, enabled device authorization, and the currently staged four-field frame. It then writes one record under `/floodguard/confirmedLab/records/device-stage-a/<sequence>`. Rules re-check authorization and exact staged values at **write time**; `!data.exists()` makes each record write-once, denying overwrites, deletions and duplicate commits. It cannot write unrelated fields or its own authorization.
- **Attestor** `attestor-stage` with `fg_attest_ingest_v1`: reads the specific immutable confirmed record and operator enrollment, verifies it against the device frame, signatures and receipt, and signs a short-lived confirmation. It does not rely on the mutable latest frame or write to Firebase.
- **Publisher** `publisher-water-stage` with `fg_publish_water_v1`: verifies pinned receipt and attestation keys; atomically updates only `/floodguard/publicationLab/water`. Its write rule now checks *current* enrolled-device, confirmer and attestor enablement, protecting against publication using an earlier signed attestation after revocation.

## Lost-acknowledgment and restart reconciliation

A write-once confirmation can commit in Firebase even if the network response is lost. A blind retry would get `permission_denied` because the sequence record already exists, incorrectly signaling that the confirmed frame was never stored.

The lab confirmer now has **read access to its own exact device/sequence confirmation record only**. Parent paths, other devices' records, and all confirmed-record mutations remain prohibited. After validating both signed source and receipt and current operator/device authorization, it can:
- Find an existing record and **verify every expected field**, including the complete four-field frame, digest, timestamps, version, epoch and sequence.
- Return `RECOVERED_IMMUTABLE_EMULATOR_RECORD_ONLY` when it matches, even after the device's mutable latest-stage pointer advances.
- When an attempted write throws, reread that one immutable record. A matching persisted record permits an idempotent recovery; a contradictory record is `confirmed-record-conflict`.
- Refuse success if it cannot establish an authentic matching record. Unreadable history returns `confirmed-record-outcome-unknown`, requiring human/operator reconciliation instead of declaring a non-existent or safe sensor reading.

The recovery result is only a **local confirmation state**, not proof that downstream publication or WhatsApp delivery occurred. Recovered confirmation still requires a separate authorized attestor and a successful publisher transaction. Current revocation must not be bypassed by historical evidence.

Emulator tests simulate a real database write followed by a thrown acknowledgment, a cold logical restart, concurrent duplicate confirmations, staged-frame advancement, fabricated record corruption, revocation and unavailable reads. The lab cannot prove outage semantics of real production Firebase without external fault-injection and authenticated device acceptance.

## Emulator coverage

```bash
npx --yes firebase-tools@14.18.0 emulators:exec --only database \
  --project demo-versioned-confirmation-lab \
  --config firebase.phase-b-versioned-confirmation-lab.json \
  "FG_VERSIONED_CONFIRMATION_TEST=1 FG_NARROW_SIGNED_BRIDGE_TEST=1 node --test tests/versioned-confirmation-emulator.mjs"
```

Tests include complete scoped pipeline, immutable write-once records, later staging updates, rejecting mismatched record keys and fields, forged signatures, role isolation and forbidden access, revocation after attestation, absent confirmed record, and duplicate submission concurrency. The older lab suites remain separate and unchanged.

## What this does NOT establish

This is a **local test with synthetic keys and claims**, not a deployed independent persistence verifier or proof that the flashed ESP8266 has a secure private key, verified TLS/clock or genuine sensor measurement. RTDB client security rules cannot independently verify the Ed25519 signature: a compromised confirmer that possesses authorized credentials could still issue a schema-valid but false digest/record. Its upstream signature checks are application logic, not enforced within RTDB Rules.

The record is *write-once for ordinary rules-constrained clients*, **not cryptographically immutable against database administrators, backups, privileged cloud credentials, or operator mistakes**. Test writes through the privileged setup context can bypass client rules. Independent cloud IAM, audits, credential rotation, disaster recovery, trust-anchored durable receipts and physical acceptance are not implemented.

Staging writes and record confirmation are separate operations, but the rules check current staging and authorization atomically at the confirmation record's write. Publisher rules check revocation at publication write. They do not prevent every possible real-world authorization epoch race or guarantee long-term archive durability; operator versioning and key rotation would need a production-proof design. The narrowly published result uses a new path, **not** existing website/mobile `/floodguard/live` subscriptions.

The project remains **PRODUCTION NO-GO**: actual anonymous-write exposure, device migration, web/mobile cutover, Flutter CI and supervised hardware/WhatsApp tests remain open. Preserve main, production RTDB, and hardware unchanged.
