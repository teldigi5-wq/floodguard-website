# FloodGuard R3 — Read-only attestor service-incident fence (Emulator ONLY)

**2 November 2026. Draft successor to PR #91. No merge, no Firebase publication, no real credentials, no hardware, gate, or notifications. Production NO-GO.**

## Existing proven security gap

The integrated Auth+RTDB Emulator suite in `tests/r3-isolated-service-confirmer-ipc-emulator.mjs` includes a deliberately failing security property: the test `KNOWN LIMIT: service revocation alone does not revoke pre-existing verified attestor record` expects that the independent read-only attestor can still sign a previously confirmed record after the confirmation service's `enabled` authority is revoked. The attestor's source verification may still be correct, but incident operators lack a simple **stop-new-attestations** fence for all historical records.

The real production concern is a **stolen service writer bearer credential** or another confirmed compromise; merely disabling a service should not be misrepresented as retroactive revocation of already distributed signed attestations. Further: a valid stolen service writer token can still submit a schema-valid but cryptographically forged record to the older confirmation Rules. Independent attestation rejects that forgery only when verified signing keys remain uncompromised.

## Exact minimal unpublished alternative Rules

`docs/firebase/r3-attestor-service-incident-fence-lab.rules.json` is copied from the existing `r3-service-session-fence-lab.rules.json` fixture. **Exactly four** pre-existing `.read` expressions are modified, by adding the same extra condition immediately after the attestor-role match:

`root.child('floodguard/serviceWorkerAuthorization/service-confirm-stage/enabled').val() === true`

The affected capabilities are (1) the attestor's own authorization record, (2) the exact device authorization record, (3) the device's bounded staged frame, and (4) its immutable confirmed-record leaf. The unchanged alternative branches for the device, confirmer service, old confirmer identity, public reads, private ESP network fields, all `.write` expressions, and all `.validate` expressions remain byte-equivalent after removing those four inserted predicates. CI includes a structural deep-equality test of the complete document after reversing exactly those changes.

The design is intentionally **coarse and fail-closed**: disabling the confirmation service pauses all new attestations, even for historically valid records and unaffected devices. It is not a permanent incident-policy decision. A separately approved incident registry and independently durable revocation epoch are still needed.

## Real Auth+RTDB Emulator tests

A dedicated local-only Auth and Realtime Database Emulator fixture uses project `demo-r3-attestor-incident-fence`, Auth `127.0.0.1:9099`, RTDB `127.0.0.1:9000`, and ephemeral synthetic Auth users with claims supplied **only by a local test harness**. The RTDB Emulator owner bypass seeds synthetic records only; it is not an authenticated or proposed field-device publisher.

The test checks:
1. An actual Auth Emulator-issued `fg_attest_ingest_v1` token can read four exact resources while the service is enabled.
2. After the local operator disables the confirmation service, all four reads are denied even though the historical confirmed record stays in the private database.
3. Ordinary, attestor and anonymous client credentials cannot modify service authority, issue gate writes or overwrite a confirmed record.
4. A separate explicit negative: when an operator re-enables the service, reads resume. **Neither existing records nor previously issued attestations are retroactively invalidated.**
5. Prior public water reads and private ESP IP/Wi-Fi read denials are retained.
6. Exactly the four attestor expressions change in the Rules JSON, without adding Firebase grants, public writes, service Admin privileges or bypassing validation.

## Outstanding production gates

This is **not** an authenticated physical device upload, real Firebase IAM isolation, production service credential custody, cloud attestor, independent durable incident receipt, public publisher, gateway or device authority. A stolen currently valid service/attestor token or compromised attestor private key remains an upstream/downstream threat; account and database IAM remain unverified. The revoked service could be re-enabled by a privileged operator, a distributed signed attestation can remain valid until its own freshness window expires, and the new check does not reach offline clients with cached risk or gate values.

The live RTDB remains **read restored but telemetry stale**, with `system.lastUpdate=2026-08-25T14:30:41.226Z` in the owner's repeat observations. The historical ESP8266 firmware uses anonymous-style REST and `setInsecure()`; no flash, power state or authenticated writer acceptance was verified.

Before any real use: independent durable monotonic incident/quarantine epochs; explicit response policy for historical records and cached attestations; key compromise/rotation handling; a publisher that requires unexpired independently verified attestation; real credential custody and network egress restrictions; signed physical hardware samples and a safe retained cloud outbox; supervised UNO gate and alarm acceptance.

**NO-GO.** No Firebase Console modification, live data write, firmware flash, sensor activation, gate actuation, alert delivery, merge or deployment.
