# FloodGuard R2 — synthetic dual-signature publisher acceptance

**Draft / local Firebase Emulator only / not a production ingestion service.**

This experiment is stacked on dual-stream evidence [PR #21](https://github.com/teldigi5-wq/floodguard-website/pull/21), which depends on #20, #18 and #14. All prior research remains unmerged. No live provider, Firebase production rules, hardware firmware, gate, or WhatsApp delivery is touched.

## Purpose

A public report signature alone is not an attested server receipt. The existing lab's scoped RTDB publishers could store a *syntactically valid but forged* signature because Firebase Rules do not perform Ed25519 cryptography. This experiment places an independent check **before a narrowly scoped write**.

Each synthetic water/rain publication attempt must satisfy:

1. **Report signature:** the report envelope matches an independently pinned Ed25519 report key for its exact water/rain stream.
2. **Signed acceptance receipt:** a second, independently pinned Ed25519 server receipt verifies its own canonical signature, stream/source alias, epoch, sequence, SHA-256 of the exact canonical report, and receipt acceptance timestamp equal to the public record.
3. **Operator-controlled trust binding:** a test-only, independently provisioned private registry ties the source alias, epoch, enabled scope, and SHA-256 SPKI fingerprints of **both distinct public keys**. In emulator tests it is obtained through a privileged fixture reader, never a public database reader. **Merely passing a binding object is not a secure production authority.**
4. **Source-specific timestamp freshness** must be plausible and current; independent water and rain status never borrow a system heartbeat.
5. **Persisted previous checkpoint:** before publication the scoped publisher reads the prior stored report and verifies its signature (without requiring it to still be fresh). A missing, forged or malformed historical record requires operator recovery; no implicit initialization/reset.
6. **Atomic Firebase Rules anti-replay at the exact stream leaf:** the existing lab rules enforce increasing sequence, unchanged epoch, nondecreasing observation and receipt clocks, enabled scoped publisher and strict field allowlists. A pre-write read is not a concurrency lock; concurrent duplicates must be decided by server-side rules.

A successful `set(record)` at `/floodguard/evidenceLabV1/water` or `/rain` is a **single-leaf emulator update**, never a root transaction or production write. If a transport error happens around commit, return `publication-outcome-unconfirmed`, do not claim rollback or blindly retry; reconcile from a trusted checkpoint.

## Evidence and deliberate limitations

- Two distinct ephemeral test key pairs are generated **per stream** (report signer and receipt issuer); no private key enters RTDB or production. The code never implements a real source-device signature or server-side issuer.
- Test-only Firebase authentication claims and the private registry record are synthetic. **Authenticated issuance, device certificate enrollment, challenge-response, secure time, key rotation/revocation and least-privilege service deployment are still absent.**
- Emulator data survives separate publisher client instances during the test, but **does not establish durable anti-replay across emulator reset, database restore, cross-region rollback, credential compromise or power loss**. The publisher does not persist an independent durable server log; a real service must implement trusted and reconcilable checkpoints.
- Firebase Rules still cannot validate the original report signature. A compromised scoped publisher can bypass this laboratory helper and write a signed-looking but invalid record. The public verifier must reject it, and production needs a genuinely restricted backend issuer and operational separation.
- A signed fresh report means **report integrity in the laboratory**, not sensor calibration, physical flood safety, or delivery of alarms.

## Reproduce locally with demo project

```sh
npm ci --ignore-scripts
npm install --no-save --package-lock=false --ignore-scripts @firebase/rules-unit-testing@5.0.2
node --test tests/r2-attested-dual-stream-publisher.test.mjs
npx --yes firebase-tools@14.18.0 emulators:exec --only database \
  --project demo-fg-r2-attested --config firebase.r2-dual-stream-lab.json \
  "FG_R2_ATTESTED_PUBLISHER_LAB_TEST=1 node --test tests/r2-attested-dual-stream-publisher-emulator.mjs"
```

The dedicated CI workflow must prove both suites plus full offline regressions and static checks against the **exact PR head** before any green claim.

## Release decision

**R2 PARTIAL; overall FloodGuard NO-GO.** Real device and issuer provisioning, durable anti-rollback, independently verified water and rain timestamps, private/public data boundary auditing, and cross-client Android/bot/website source-specific acceptance remain outstanding. No merge, firmware signing installation, cloud IAM change, production Firebase migration or physical gate actuation is authorized by these tests.
