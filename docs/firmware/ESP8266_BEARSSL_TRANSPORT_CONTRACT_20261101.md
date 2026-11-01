# FloodGuard — ESP8266 BearSSL authenticated transport code review (2026-11-01)

**Review-only / compile-only. This is NOT field-ready firmware and is NOT called by the sketch. No Wi-Fi connection, signing keys, Firebase production writes, alarms, servo commands, flashing or deployment. Release NO-GO.**

## Verified predecessor

Stacked on [draft PR #52](https://github.com/teldigi5-wq/floodguard-website/pull/52), exact verified head `c614b9da6625d73a0199f1089a71294abaf3473a`. PR #52 cross-compiled a secret-free ESP8266 diagnostic sketch using Arduino CLI 1.5.1 and ESP8266 core 3.1.2; the original credential-bearing v6 ESP8266 and UNO sketches remained private. PR #52's BearSSL trust helper was *not* connected to an HTTP request.

## New real MCU request implementation — NOT invoked

`firmware/esp8266_review_diagnostic/SecureIngressTransport.h` adds **compile-checked actual ESP8266 BearSSL code** that would POST an already signed, immutable Stage 7 envelope JSON to an explicitly supplied hostname and port. It is included in the diagnostic sketch's compilation, but **never called from `setup()`, `loop()` or any other running function**.

- Requires a validated DNS hostname, a **caller-injected trusted CA** (`BearSSL::X509List`) and an independently trusted UTC value. No `setInsecure()`, peer-certificate bypass, public hostname, Wi-Fi credential or private key appears in source. It uses `client.setTrustAnchors(...)`, `setX509Time(...)`, and `client.connect(hostname,port)` (not a raw-IP hostname bypass). This does **not** prove verified TLS on a physical ESP8266.
- Accepts *only* a bounded, pre-signed immutable body (≤1024 bytes, without CR/LF controls). It **does not generate a device signature or persist a retry queue**, and it cannot prove the body was correctly signed without the server-side PR #41 verifier.
- Uses one fixed local test route `/synthetic/v1/ingest`, bounded HTTP request/response parsing (≤160-byte body, ≤20 short response-header lines), timeouts, no dynamically allocated JSON parser and no redirect following. Case-insensitive Content-Type/Content-Length headers align with the existing Node loopback-only handler.
- Recognizes HTTP 201 **only when the exact response is `{"accepted":true,"status":"LOCAL_DURABLE_ADMISSION_ONLY"}`**; HTTP 409 is a conflict, HTTP 503 is uncertain, and a forged 201 with a cloud-success label is unverified. No result from any network response sets `cloudConfirmed`, `canAcknowledge`, `canDequeue`, `warningDelivered` or `physicalGateVerified`.
- TCP errors and incomplete or oversized HTTP responses fail closed. There is no fallback to anonymous Firebase, a hardcoded peer fingerprint or unverified TLS.

`LocalAdmissionReceipt.h` contains a portable allocation-free response classifier and release-permission flags. It is compiled both into the ESP8266 transport and into an independent host C++ test. The separate `tests/firmware_bearssl_transport_policy.test.mjs` explicitly checks disabled Wi-Fi, no calls to the transport, certificate/clock/hostname checks, bounded messages, and absence of cloud/actuator/secret paths.

## Reproducibility and validation

New dedicated CI `.github/workflows/esp8266-bearssl-transport-contract.yml` reuses the prior verified SHA256-pinned Arduino CLI 1.5.1 install and Arduino ESP8266 3.1.2 core compile, now including the actual TLS request implementation in the cross-compiled sketch. Separately, native `g++ -std=c++11 -Wall -Wextra -Werror` tests compile **the exact portable receipt header** and verify exact local admission, replay conflicts, forged cloud success and no ACK, plus PR #52's original parser C++ tests. Node static policy/serial and previous genuine **host-side** local HTTPS regression remain required, along with full Next.js tests, lint, TypeScript and build.

Only the **exact-head GitHub Actions** cross-compile and host checks may establish a reviewed compiler milestone. No Emulator-only or host-side evidence should be described as an ESP8266 physical TLS handshake.

## Blocking production work

1. **Actual board identity and power**: verify device variant, flash/RAM, boot pin mapping, 3.3V GPIO level shifting, reset/power cycles and network tolerance on an isolated bench.
2. **Private provisioning and clock**: select/implement a reviewable secure per-device signing primitive and key storage, entropy checks, trusted time bootstrap and CA rotation. The function currently accepts already-signed input from elsewhere and does not connect to anything in the running sketch.
3. **Real public ingress and authorization**: build a scoped, rate-limited server distinct from the current 127.0.0.1-only test handler, with authentic provisioning/revocation, replay protection and separately trusted signed durable cloud receipts.
4. **Durable, bounded offline storage and ACK**: protect events against resets/brownouts before deciding whether to retransmit; neither local 201 nor HTTP 409 permits deletion.
5. **Human and physical safety**: separate rain and water streams, stale/offline warnings, verified alert delivery, HC-SR04 invalid echo and buzzer behavior, independent gate feedback/manual override and supervised acceptance.
6. **Governance**: protect `main`, review and integrate the stacked draft chain only after a tested migration path exists.

**Do not enable real network in this diagnostic sketch or flash it onto a warning system. Original v6 credential-bearing firmware stays private and unchanged; live Firebase lockdown stays intact.**
