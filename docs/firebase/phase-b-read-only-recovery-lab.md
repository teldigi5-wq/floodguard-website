# Read-only uncertain-ACK recovery observer (emulator-only)

**Scope:** Nonproduction synthetic FloodGuard R2 lab. This is **not** a cloud durability receipt, approved automatic retry, public publication proof, authenticated real ESP8266, or a deployment gate.

The preceding two-principal design enforces an exact short-lived verifier approval before a separate staging principal may write. It intentionally does **not** retry an approval or staging write after a lost SDK ACK: the request may have succeeded server-side. To inspect such outcomes without granting either writer more privileges, this experiment introduces a third operator-assigned, **read-only** identity, `ingest-observer-stage-a`, with mock claim `fg_ingest_observer_v1`.

## Least-privilege observer contract

`docs/firebase/phase-b-observer-recovery.rules.json` is a separate cloned **test-only candidate**, preserving the previous dual-authority ruleset. It permits observer reads only for the assigned `device-stage-a` on the specific `ingestApprovalLab/$deviceId`, `staging/ingestV1/$deviceId`, and **three individual authorization leaves** `deviceAuthorization/$deviceId/{enabled,scope,epoch}`. The observer cannot read the full authorization record, ancestor trees, another device, Wi-Fi/IP, bot, or private checkpoints. It cannot write any Firebase path. The verifier/writer retain their original independent scopes. Public telemetry still follows the original read-only live contract; nothing grants writes or modifies physical gate behavior.

`experiments/read-only-staging-recovery-observer.mjs` additionally requires the current operator-enabled HMAC-sealed device identity, canonical signed Stage 7 source envelope, independent signed Stage 8 acceptance receipt and matching sealed historical replay checkpoint **before any reads**. It performs two sequential, identical narrow five-path snapshots with a bounded total read deadline (default three seconds). If permissions fail, the snapshot changes between passes, an authorization flag disagrees or evidence is malformed, it returns an unverified classification and does **not** attempt a write or retry.

Its result vocabulary deliberately avoids promising eventual consistency, Firebase production durability or operator acceptance:

- `matching-stage-and-approval-observed-in-emulator-only`: current simulator readbacks show exactly the signed frame/epoch/digest and four-field staging record, with appropriate device authorization. **Observed only, not independently durable.**
- `approval-only-observed-no-target-stage`: the verifier's signed target is visible, but the target sequence is not staged. Do not infer that a lost write did not commit elsewhere or retry.
- `target-not-observed-unsafe-to-retry`: no target grant or staged frame is visible in two reads. This **does not** authorize automatic replay or recovery.
- `later-stage-observed-unknown-for-target`: the staging row has already advanced past the target, so the older attempt cannot be reconstructed from the latest row alone.
- `conflicting-approval-unverified`, `conflicting-stage-unverified`, `cloud-authorization-unverified`, `concurrent-state-change-unverified`, `observation-unavailable` and other fail-closed reasons: human/operator review required.

The observer does not grant the right to perform old-epoch replay, claim safety, publish live water readings, or send WhatsApp notifications. A two-pass emulator read cannot replace a signed immutable cloud audit checkpoint; an actively changing database may still change **after** observation. A revoked local operator binding or a rotated signing key may invalidate the ability to assess historic evidence and should trigger manual review.

## 29 October 2026 — single-flight protection after an SDK read timeout

The Firebase RTDB `.get()` calls are **not cancelled** when the observer's
`Promise.race` deadline expires. A client could previously invoke this
read-only observer repeatedly while the SDK was unresponsive, causing multiple
unresolved, five-path snapshot batches to accumulate in memory. Even though
these reads cannot modify Firebase, unbounded requests are a reliability and
resource-exhaustion risk.

The observer now tracks the **actual unsettled SDK batch** per constructed
observer instance. One batch at a time may run. A second reconciliation call
while that batch is still unresolved returns `observer-read-in-flight`
without issuing more database reads. A timeout returns
`observation-unavailable` to the original caller but does **not** release
the read budget until the underlying first and second snapshots have really
settled. A settled batch releases its budget in both successful and rejected
paths, including after a prior timeout; no delayed response can retroactively
change the original timeout result. No automatic retries or writes are added.

A permanently hung SDK batch therefore makes that instance **unavailable**
until its outstanding operation settles or the process is explicitly
restarted. This is a deliberate fail-closed reliability tradeoff, not a global
rate limiter, cancellation API, cloud connection budget, or production
service-level guarantee. Additional deployment isolation, request admission
and per-process resource limits would be required before any public use.

Two new synthetic tests cover resource-bounded repeated calls after deadline
expiry, parallel reconciliation attempts, eventual settlement/release, and
preservation of the original unknown outcome. No hardware or real Firebase
service is exercised.

## Test command

```sh
npx --yes firebase-tools@14.18.0 emulators:exec \
  --only database --project demo-recovery-observer-ingest \
  --config firebase.phase-b-observer-recovery.json \
  "FG_SIGNED_STAGING_BRIDGE_TEST=1 FG_DUAL_AUTHORITY_TEST=1 FG_STAGING_OBSERVER_TEST=1 node --test tests/read-only-staging-recovery-observer-emulator.mjs"
```

The 13-case suite checks consistent staged/approval evidence, no-observation caution, lost verifier ACK, lost stager ACK, unauthorized reads/writes, revoked observer permissions, source revocation, incorrect or later staging rows, conflicting approval, forged evidence, bounded hanging reads and racing snapshots. All keys, clock samples, UIDs and paths refer to synthetic emulator data. `withSecurityRulesDisabled` is used **only** in test fixture setup and observation assertions, never by the observer implementation.

**Production remains NO-GO:** no actual Firebase Auth token issuance/revocation or cloud IAM evidence, real secrets custody, independent durable confirmation and rollback proof, live rules migration, ESP8266 TLS/firmware validation, mobile native CI or supervised field trials. No production write, protected-main merge, deployment, gate activation or messaging occurred.
