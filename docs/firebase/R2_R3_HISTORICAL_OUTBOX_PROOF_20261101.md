# FloodGuard R2/R3 — Historical signed outbox read-back (2026-11-01)

**Isolated offline + Firebase RTDB Emulator review only. No production database, issuer, live hardware or firmware, client releases, WhatsApp, notifications, gate actuation or deployed Firebase rules. Release NO-GO.**

## Checkpoint and reason

Base is [PR #43](https://github.com/teldigi5-wq/floodguard-website/pull/43) at exact verified head `81d221b30d1a1d078aa44162e96a4b4326ca6eb7`, stacked on PRs #42 and #41. That work:
- accepts a canonical Ed25519 device-signed source frame into a local sealed journal (loopback TLS and no cloud ACK);
- proposes an atomic synthetic database change for the water primitives + private high-water;
- stores each signed Stage 8 receipt under a private `publicationHistoryV1/entries/s_<sequence>` field, rather than keeping only the latest receipt.

**PR #42's initial read-back reconciler checks only the *latest* sequence.** That is intentional: the latest snapshot alone cannot prove an older record. The next limited step is comparing **an earlier retained local signed frame** against PR #43's privately retained per-sequence signed publication history.

## New read-only observer

`experiments/historical-outbox-observer-lab.mjs` accepts operator-supplied synthetic inputs (a retained outbox record, protected root snapshot, independently authorized source binding, pinned server receipt key and comparison clock). It deliberately **has no Firebase SDK, HTTP listener, database writer, journal deletion/ACK method, alert or actuator command**.

It rejects unless:
1. The complete local canonical Stage 7 source frame, digest and Ed25519 device signature match the approved currently enabled source identity, epoch and scope.
2. The independently protected root retains enabled water authority, same epoch, scoped membership and exact pinned Stage 8 receipt signer fingerprint.
3. The *entire* bounded historical map uses PR #43's nonnumeric `s_<sequence>` keys and contains only exact signed receipt/scalar schema, valid geometry and reported status, monotonic event/receipt times, and matching digest/sequence/issuer for every stored entry. Unexpected, corrupt, deleted or unparseable entries fail.
4. The newest historical signed receipt matches the high-water checkpoint **and** the independently confirmed latest database receipt. The latest publicly visible PR #34 scalar leaves match the newest historical reported measurements; no injected nested objects or unexpected public fields are accepted.
5. The requested older outbox sequence has an actual own historical record with exactly matching digest, original observed time, measured water values, reported water status and an accepted time not preceding local admission.

An observed older record returns `HISTORIC_SIGNED_EVIDENCE_OBSERVED_NOT_ACKNOWLEDGED`, `canAcknowledge:false`, `sourceFreshness:NOT_CERTIFIED`, `floodClearance:UNKNOWN`, `physicalGatePosition:UNVERIFIED`, and `notificationDelivery:NOT_VERIFIED`.

**A signed historical receipt does NOT prove that a human received a notification, a real sensor was accurate, or the gate physically opened.** A privileged Admin SDK writer still bypasses RTDB Rules and could rewrite history and all the protected root records. This prototype cannot provide independently anchored immutability or a real-world proof of publication. The historical entries are *code-append-only*, not externally tamper-proof.

## Test plan and evidence gate

- Offline test suite uses the **actual PR #41 HMAC-sealed journal**, actual PR #43 publication candidate, independently generated Ed25519 device and receipt signers, two retained source frames, and later publication supersession. Invalid/missing earlier history, old receipt tampering, wrong keys, source revocation, latest checkpoint divergence, scalar object injection, absent pending records and apparently SAFE readings must fail safely or remain non-ACK observations.
- Real RTDB Emulator suite uses pinned PR #34 rules to publish two synthetic readings in separate privileged test transactions, retrieves the whole protected root as an operator, compares the original older retained signed reading, verifies unauthenticated reads/writes of private history are denied, and confirms old-record corruption / privileged nested-public-leaf exposure are denied as reliable evidence.
- Branch-specific CI runs both suites, prior signed/outbox tests, full website regression, ESLint, TypeScript and Next.js build. **Do not call this stage passed until exact-head CI completes successfully.**

## Remaining requirements for meaningful live FloodGuard restoration

1. A real authenticated, least-privilege durable publisher and independent externally verifiable receipt authority; avoid hardcoded tokens or credentials in public firmware or repositories.
2. Certificate-verified ESP8266 TLS, safe device key provisioning/rotation and an independently protected revocation/high-water anchor; production firmware still uses insecure TLS and the closed anonymous legacy tree.
3. Bounded durable outbox retention, replay recovery under lost/ambiguous ACK, an *independent* and crash-tested per-record proof-gated acknowledgment/compaction design and recovery from privilege/root rollback. **Do not turn on deletion from this observer.**
4. Safe and accurate offline hardware response to invalid sensor data, battery/network loss, buzzer and gate failure, physical gate-position verification, manual override and actual human alert delivery tests.
5. Coordinated preview of website, Flutter and WhatsApp via scoped primitive leaves with fail-closed stale/offline presentation. No live cutover before owner approvals and test evidence.

**Keep production Firebase emergency lockdown, current `main`, deployed apps and physical hardware unchanged. No merge or deployment authorized.**
