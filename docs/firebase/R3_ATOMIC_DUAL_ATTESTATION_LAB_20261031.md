# FloodGuard R3 — atomic dual-signature public evidence laboratory

**Status: draft / synthetic / isolated RTDB Emulator only. No production Firebase rules, provider, website, Flutter, bot or gate changes.** Stacked on PR #25 → #24 → #23 → #22 → #21 → #20 → #18 → #14.

## Purpose

The R2 report reader can verify the sensor-report signature, but the old public leaf has **no independently signed server acceptance receipt**. Publishing those separately would permit readers to combine a newer report with a previous receipt. This lab creates a NEW, separate namespace with one atomic object per stream:

```
/floodguard/attestedEvidenceLabV1/water
  report: {payload, signature}
  acceptance: {receipt, signature}
/floodguard/attestedEvidenceLabV1/rain
  report: {payload, signature}
  acceptance: {receipt, signature}
```

No device IDs, private gateway receipt, phone number, network information or command is included. Both parties' signatures are Ed25519, using separate browser **WebCrypto** pinned public keys provided out-of-band. The reader validates R2 canonical report and receipt byte formats, exact source/epoch/sequence, signed acceptance timestamp and SHA-256 digest of the canonical report. It verifies **both** signatures before emitting a display-only advisory object. A missing, swapped, malformed, future, stale, repeated or forged proof fails closed per stream.

The client uses fixed public leaf paths with an injected read-only subscription adapter. Independent water/rain state, stale source expiry, disconnection handling and revision fencing protect against cross-stream contamination and slow verification callbacks. All accepted status is explicitly `signed-lab-only`, not a real hardware or physical safety assertion.

## Emulator security boundary

The separate `r3-atomic-dual-attestation-lab.rules.json` file is NOT production rules. It restricts writes to per-stream test identities/claims, externally seeded private authorization enablement/scope, existing leaves, monotonic observation/receipt/sequence, tight allowlist, complete nested report+receipt and matching stream/source/epoch/sequence/acceptance timestamp. Parent reads, private sibling reads, anonymous writes and cross-stream writes are denied. **No protected Firebase deployment or real credentials** are touched.

**Important: Firebase Realtime Database Rules CANNOT cryptographically verify Ed25519 signatures or the receipt's report digest.** The emulator test intentionally writes a forged but structurally allowed signature with a scoped test credential, and checks that the browser verifier rejects it. Thus broad, compromised or directly accessible publisher credentials remain a fundamental security threat. A real privileged publisher must cryptographically validate authentic device identity and independent issuer receipt *before* writing, with carefully scoped credentials, durable checkpoint reconciliation, audit logs and revocation.

## Reproduction

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm install --no-save --package-lock=false --ignore-scripts @firebase/rules-unit-testing@5.0.2
node --test tests/r3-atomic-dual-attestation-reader-lab.test.mjs
npx --yes firebase-tools@14.18.0 emulators:exec --only database \
 --project demo-fg-r3-atomic --config firebase.r3-atomic-dual-lab.json \
 "FG_R3_ATOMIC_DUAL_EMULATOR_TEST=1 node --test tests/r3-atomic-dual-attestation-emulator.mjs"
```

Unit tests use ephemeral independent signing keys and Node WebCrypto as a **browser-compatible contract test, not a real Chrome/Safari test**. Actual loopback Firebase RTDB emulator tests check atomic public child subscriptions, private-node isolation, strict write scopes, invalid nested metadata, missing receipt, forgery and independent water/rain behavior.

## Unresolved release gates

A synthetic independently signed issuer receipt is **not** evidence that an operational server, physical sensor or hardware time is trusted. The issued signature's root key is a synthetic test fixture. Reader replay checks are in-memory; a fully restored database plus prior signed checkpoint can still fool a fresh session. A real rollback-resistant durable authority, device enrollment, authenticated issuer API, external operator approval, cross-system commit recovery, real browser/device tests and mobile/WhatsApp E2E are not complete.

This code is intentionally **not imported into production FloodProvider** and has no public route or configuration for actual keys. Do not deploy a credential to the browser, imply a real measured water level, treat the signed report as flood safety, merge protected main, or promote a release based on this experiment.

**Stage R2 partial. Stage R3 lab acceptance only. Overall FloodGuard release NO-GO.**
