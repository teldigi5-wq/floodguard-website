# Loopback HTTPS signed-ingress verification — research only

**State:** isolated localhost transport candidate. NOT production ready. NOT approved for real ESP8266, Firebase or user-facing alerts. No hardware, gate, WhatsApp, Firebase production or deployment changes.

This adds an actual HTTPS request handler using the existing Stage 7 durable anti-replay ledger, without claiming its synthetic channel proofs are TLS. The Node test creates an ephemeral localhost certificate, binds a separate test server to 127.0.0.1 on a random port, connects with a correctly trusted CA and hostname, and disposes of all synthetic keys.

## Verified acceptance boundary

A POST to /synthetic/v1/ingest must:
- Use a genuine Node TLS socket, with both ends on loopback; forwarded headers cannot assert TLS.
- Use exact application/json and a maximum 1024-byte request body.
- Carry an exactly canonical Stage 7 envelope with bounded readings and no gate commands or private network metadata.
- Match an enabled, exact-scope and exact-epoch device public-key binding provided separately by the operator. No enrollment API is exposed.
- Pass Ed25519 cryptographic device signature verification, source timestamp age (30 seconds) and future skew (2 seconds).
- Pass an independent ledgerAvailable readiness callback AND a precommissioned HMAC-sealed Stage 7 bootstrap entry for device-stage-bootstrap. A missing/corrupt prior ledger denies a request instead of silently recreating empty replay history. Accepted readings retain strictly increasing sequence and unchanged device/key/epoch binding.

The ONLY success outcome is 201 with status LOCAL_LEDGER_ACCEPTED_ONLY. This is **not** a database receipt, actual Firebase write, proof of physical authenticity, current flood-risk validation, notification delivery, or gate operation. Duplicate messages return 409 and invalid/revoked credentials are denied. The handler does not start a server, provision identities or connect to any cloud.

Run: node --test tests/loopback-signed-https-ingress.test.mjs

## Bounded incomplete request-body handling — 28 October 2026

The test-only handler now accepts a trusted bootstrap setting `bodyReadDeadlineMs` (10 seconds by default; integer range 50–30,000 ms). A real, authenticated loopback TLS client can still send an incomplete chunked POST indefinitely unless the application bounds its body reader. An **absolute** read deadline now destroys an unfinished TLS request instead of relying on an idle timeout that a drip-feeding client could repeatedly reset. The replay ledger is touched only after the complete, size-limited, schema-validated and signed envelope is read. A timed-out request can surface to the client as a connection reset rather than a guaranteed HTTP status; callers must treat this as **unknown**, not retry with a new sequence or claim that it was committed.

The Node regression exercises a genuinely established local TLS connection with a partial body that never ends and asserts a bounded connection reset, unchanged persisted sequence, and that a separate valid signed request continues to receive its normal replay-denial status. It also rejects unbounded deadline configuration. This only bounds reading of the request body in the isolated localhost experiment; it does **not** prove bounded execution of arbitrary operator readiness callbacks, disk I/O, TLS handshakes, Firebase operations, or behavior under a real ESP8266/network. A production ingress still needs independent end-to-end deadline budgets, resource limits, rate limiting, authenticated credential lifecycle and real-cloud durability tests.

## Read-to-commit freshness and operator availability revalidation — 28 October 2026

A request-body deadline alone does not ensure that decisions made **before** receiving the body remain valid. The experimental handler formerly captured its device-observation clock and checked the operator's replay-ledger availability before awaiting the bounded stream. A signed envelope that was fresh when its upload began could become expired before the upload completed; a previously ready ledger could be revoked or disconnected while the client was still streaming.

The handler now performs a *second* explicit readiness check after full body receipt and obtains the clock sample used for the device's 30-second freshness / 2-second future-skew check **only after that final readiness step**. The enrolled public key and current operator-enabled binding are checked after the wait as before. The sealed ledger's separate synchronous `last` and `commit` checks still enforce replay protection, including failures after a ready result. Neither attempt creates Firebase records, physically authenticates an ESP8266, nor advances the public website.

Two real loopback HTTPS regressions use isolated HMAC-sealed replay ledgers: (1) a clock that advances outside the allowed freshness window between the initial check and body completion must return 422 with **no committed sequence**, and (2) ledger readiness revoked after the first check must return 503 with **no committed sequence**. These are deterministic injected-time/operator-callback tests, not cloud consistency or real revocation-latency benchmarks. An external operator registry, secure identity provisioning/rotation, certificate-validating flashed firmware, persistent cloud IAM and authorized field testing remain release blockers.

## Stop conditions before any production use

1. Privately inspect the actual flashed ESP8266 revision, TLS library, upload paths, clock and credential storage. No firmware repo/revision was found among the three FloodGuard repositories; do NOT reflash or reset the currently working unit without owner approval.
2. Design durable operator-managed device enrollment, revocation, key rotation and protected hardware key storage; an in-memory Map in this lab is not a real registry.
3. Use reviewed internet-facing TLS termination and secure DNS/firewall/rate limits as a separate architecture; this localhost test endpoint must NEVER be made public by changing the bind address.
4. Provision the special Stage 7 synthetic replay-marker record **privately before** enabling the ingress handler (device-stage-bootstrap, epoch=1, sequence=1, keyFingerprint=64 lowercase f characters). The handler now checks that HMAC-sealed marker on every request, so deleting/corrupting the ledger fails closed even if ledgerAvailable() falsely returns true. Production operation still requires independent secure recovery of this marker, a persistent protected key, audit, backup/restore, and a genuine readiness check; neither the test marker nor this API implements a safe unattended recovery workflow.
5. Build a **separate** least-privilege authenticated RTDB staging publisher and independently auditable public path projector with confirmed persistence, crash-safe checkpoints and rollback. Firebase Admin SDK bypasses client RTDB Rules.
6. Verify nonproduction TLS/device/token lifecycle, clock synchronization, offline/reconnect and cross-client monitoring; require supervised physical acceptance and explicit owner sign-off.

Do not convert anonymous legacy parent PUT/PATCH into a trusted write without device authentication. Do not place real keys in this public repository, set insecure TLS flags, infer SAFE from missing values, claim Firebase anonymous-write risk closed, or merge/deploy before approval.
