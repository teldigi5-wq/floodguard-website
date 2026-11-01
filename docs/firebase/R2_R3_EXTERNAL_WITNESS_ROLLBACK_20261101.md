# FloodGuard R2/R3 — Operator-pinned external witness rollback laboratory (2026-11-01)

**Synthetic, offline + disposable RTDB Emulator research only.** No deployed witness service, production Firebase read/write, ESP8266 firmware, gate hardware, web/app/bot/WhatsApp release, alert sender, or journal acknowledgment. **Production NO-GO.**

## Reason for this stage

[Draft PR #44](https://github.com/teldigi5-wq/floodguard-website/pull/44), verified head `3efc2f65ebd9b73f2f025da902e5c7aa7133c82e`, can observe a previously retained signed sensor frame against its historical signed receipt, even after newer public water readings. It does **not** prove the history is externally immutable: a privileged administrator could potentially restore a previously valid RTDB root snapshot (including history, issuer record, and high-water).

A single **valid old signed witness alone is still insufficient**: if both the DB snapshot and an old witness are rolled back, they may agree. This experiment therefore requires a separate, independently retained **monotonic latest head** in addition to a distinct pinned Ed25519 witness public key. The current code *does not implement or provision that trusted remote store*. All authorities and external heads are synthetic test inputs and MUST NOT be accepted from any HTTP client.

## New read-only verification

`experiments/pinned-historical-witness-lab.mjs` first calls the existing PR #44 verifier to authenticate the original retained signed device frame, inspect the complete signed private receipt history, require currently enabled source/issuer authorization, and require the newest private confirmation/checkpoint/strict public scalars to agree.

It then requires:

- A trusted, operator-pinned **independent Ed25519 witness key** whose SPKI SHA-256 fingerprint matches an independently supplied expected fingerprint and is **different from** the Stage 8 receipt signer.
- A canonical SHA-256 digest of all bounded historical records with fixed property ordering and numeric sequence sorting, including sequence, source digest, observation time, all reported approved water values, the complete signed server receipt, and its signature.
- A signed fixed-schema external witness containing device, epoch, newest sequence/digest, history digest, receipt-signer fingerprint and witnessed time; the signature must verify under the pinned witness key.
- A *separately obtained latest monotonic head* with the same newest sequence, digest and history hash. Missing or old head, mismatched signed snapshot, stale witness timestamp, tampered history, unknown source or unpinned signer are rejected. An older signed snapshot with a correspondingly old signed witness must fail when the independently held head reflects the later event.
- A read-only result `PINNED_EXTERNAL_WITNESS_MATCH_LAB_ONLY` with **`canAcknowledge:false`**, no deletion/compaction, no notification-delivery evidence, no certified flood clearance or physical gate status.

## Security boundary and limitations

**This is not an independently attested production publication!** A signing key and the remote monotonic store MUST actually be controlled by a separate least-privilege service, distinct from the Firebase Admin publisher and source/device signer. Otherwise a privileged attacker could sign or roll back both history and its alleged witness. This lab creates neither a witness-issuing service nor remote storage/secure counter/TPM, and has **no independent evidence that data was ever read by a human or app**. It cannot prevent fully coordinated rollback of the external monotonic store, cloned keys, signer compromise, or real sensor spoofing.

The current prototype's bounded eight-entry history is only a test backpressure guard, not workable indefinite storage or alert-retention policy. Without independently governed durable publication, restart/rollback evidence and crash-tested queue retirement, **there must be no outbox ACK, dequeue or deletion**. The existing PR #41 journal keeps its buffered readings.

Tests use real PR #41 sealed journal plus PR #43 signed history. The Firebase Emulator test deliberately replaces the synthetic DB root with an older snapshot while the separately held latest head remains new, and expects denial. The workflow also runs the prior suite, full website regression, lint, TypeScript and build. **Verify the exact-head GitHub Actions result before accepting.**

## Remaining production gates

1. Credential-safe ESP8266 verified TLS, authenticated device key custody/provisioning, source revocation/epoch fencing and independently anchored replay high-water.
2. A narrow, audited, independently authenticated Firebase publisher with exact primitive writes, independently persisted per-event confirmation, recoverable cloud commits, issuer keys and backups.
3. Real distinct witness custody and monotonic write-once/anti-rollback medium, offline reconciliation, clock discipline and operator recovery policy, with safe key rotation and no caller-supplied trust roots.
4. Crash-consistent, idempotent per-event ACK and queue compaction only after independent evidence, plus explicit lost-ACK, failed alert delivery, capacity, tampering and outage behavior.
5. Read-only website/Android/WhatsApp preview, fresh/stale/offline status, warning delivery verification, and supervised Arduino sensor-error/buzzer/gate/manual-override tests.

**Keep the user's deployed `/floodguard/live` anonymous deny-read/write lockdown and all draft PRs unmerged. Do not deploy, connect insecure firmware, or operate physical flood hardware.**
