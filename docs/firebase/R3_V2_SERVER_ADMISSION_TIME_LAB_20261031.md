# FloodGuard R3 V2 — independent server-owned admission time (31 October 2026)

**Isolated research / loopback Firebase Emulator only. NOT a deployed ingestion service, physical flood alarm, hardware verification or production release.** This draft is stacked on PR #27 → #26 → #25 → #24 → #23 → #22 → #21 → #20 → #18 → #14. Main, original R2/R3 V1 branches, real Firebase rules, Flutter, website and bot remain unchanged.

## Problem

In V1 `receivedAtMs` is inside the report signed by the source. Although a synthetic gateway checks it near an injected independent clock, the source still selects the value that an issuer receipt is forced to echo. Therefore a client cannot conclude that this field was independently chosen by a trusted gateway.

## V2 protocol

A **new versioned V2 namespace**, `/floodguard/attestedEvidenceLabV2/water` or `/rain`, holds ONE atomic leaf:

```text
{
  "report": {
    "payload": {
      "version": "floodguard-r3-observation-v2-lab",
      "stream": "water|rain",
      "sourceAlias": "<fixed allowlisted alias>",
      "epoch": 1,
      "sequence": 2,
      "observedAtMs": 0,
      "sample": "<strict typed water/rain record>"
    },
    "signature": "<source Ed25519 signature>"
  },
  "admission": {
    "receipt": {
      "version": "floodguard-r3-server-admission-v2-lab",
      "stream": "water|rain",
      "sourceAlias": "<same alias>",
      "epoch": 1,
      "sequence": 2,
      "reportDigest": "<SHA-256 of canonical signed observation payload>",
      "admittedAtMs": 0
    },
    "signature": "<separate gateway issuer Ed25519 signature>"
  }
}
```

The numbers above are schema illustrations, **not valid field measurements or live timestamps**.

The source may sign only `observedAtMs`; a source-supplied `receivedAtMs` or `admittedAtMs` is rejected. `admittedAtMs` is chosen by the injected independent operator clock **after** an existing report AND issuer receipt are verified, the new signed report is verified, and sequence/epoch/freshness are checked. The separate issuer signs the exact deterministic V2 receipt and the gateway re-verifies its signature before attempting one atomic RTDB leaf write. The browser verifier checks both signatures, digest, identity, sequence, admitted-versus-observed skew, per-session replay and time expiry.

**Admission time is NOT database commit time.** An issuer can sign a pre-publication receipt but the database write can fail. The receipt states when the gateway admitted the observation for an attempted publication. A successful RTDB `.set()` response is evidence of an acknowledged write in this local test, not an independently durable external commit. On lost acknowledgment the result is `publication-outcome-unconfirmed`; the gateway never blindly retries or signs a synthetic rollback certificate.

### Trust boundaries

- Four independently pinned public keys across water/rain (two source, two issuer), with operator-owned epoch and identity configuration. Test private keys remain in the synthetic fixture, never in the browser or report request.
- Exact `{stream,record}` request: cannot inject a signer, time, registry, database, receipt or actuator command.
- Only fixed, per-stream V2 emulator paths. Scoped writer authorization and private parent/child access denials live in **a new dedicated rules file**; no V1 or production rule mutation.
- Atomic RTDB Security Rules check schema, monotonic sequence, clock order, source/receipt bindings and privileged writer claims. **Rules cannot verify Ed25519 or SHA-256.** A holder of a raw scoped write credential can still publish a cryptographically forged but schema-valid envelope. That credential must remain exclusively inside the eventual trusted gateway.
- No source timestamp is intrinsically truthful simply because it is signed. Device clock calibration/identity provisioning and backfill policy remain unresolved. The lab rejects clock skew outside ±2 seconds future / 10 seconds past.

## Reproduction (localhost-only)

```sh
npm ci --ignore-scripts --no-audit --no-fund
node --test tests/r3-v2-server-admission-lab.test.mjs
npm install --no-save --package-lock=false --ignore-scripts @firebase/rules-unit-testing@5.0.2
npx --yes firebase-tools@14.18.0 emulators:exec --only database \
  --project demo-fg-r3-v2-admission --config firebase.r3-v2-admission-lab.json \
  "FG_R3_V2_ADMISSION_LAB_TEST=1 node --test tests/r3-v2-server-admission-emulator.mjs"
```

Node's WebCrypto contract tests **are not cross-browser real-device tests**. Signer key custody, on-disk monotonic durable authority, atomic external history, cross-host fencing, firmware enrollment, rate controls, log privacy, actual physical calibration, Flutter/WhatsApp acceptance and production device evidence are still absent. No tested client shall display `SAFE` or `LOW` as a certified physical safety conclusion based solely on this experimental protocol.

**R2 partial. R3 V2 admission-time ownership: lab-only. FloodGuard production NO-GO.**
