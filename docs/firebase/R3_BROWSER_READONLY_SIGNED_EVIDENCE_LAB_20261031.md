# FloodGuard R3 — browser-compatible signed evidence reader, read-only acceptance

**Draft research seam, not mounted in the production website.** Stacked on PR #24 → #23 → #22 → #21 → #20 → #18 → #14. No protected-main merge, Firebase production rules change, device command, gate operation, alarm message, bot delivery or live site deployment.

## Goal and scope

This PR adds a browser-safe **read-only** bridge toward integrating the R2 public evidence model into R3 website consumers. The existing production `FloodProvider` continues to use its legacy allowlisted `floodguard/live` fields and shared timestamp. It remains unchanged; the lab observer is **not connected to a real hardware feed or production display**.

The browser verifier `experiments/r3-browser-readonly-evidence-lab.mjs` uses the platform WebCrypto `SubtleCrypto` Ed25519 verify operation against **independently provided/pinned SPKI public keys**. It does not import Node crypto, Firebase SDK, a privileged signer, service credentials, actuator controls or any write API. Missing WebCrypto capability or a malformed pin fails closed. No key embedded in the untrusted RTDB report can establish trust.

The strict browser canonicalizer is tested byte-for-byte against the existing R2 Node canonicalizer for both water and rain, including re-ordered keys. Unknown fields, private device metadata and command fields are rejected. A signed report is accepted only when its own source observation and receipt-clock fields are causally plausible, within the explicit freshness window, monotonic relative to this observer's already accepted source and associated with the pinned signer. Independent stream decisions never borrow `system.lastUpdate` or a sibling sensor.

The `createR3ReadOnlyEvidenceObserver` binds to an **injected subscription interface** whose only accepted event paths are `.info/connected`, `/floodguard/evidenceLabV1/water` and `/floodguard/evidenceLabV1/rain`. It emits only allowlisted scalar fields from cryptographically verified reports, and never returns a physically verified SAFE/LOW/alarm-CLEAR declaration. Its status is `report-only`, never `live hardware verified`. On malformed, unauthorized, replayed or stale events it fails closed. In-flight WebCrypto verification is revision-fenced so an old completion cannot overwrite newer evidence. A disconnect demotes the streams, and a close cleans up all subscriptions.

## Reproducible verification

```sh
npm ci --ignore-scripts
npm install --no-save --package-lock=false --ignore-scripts @firebase/rules-unit-testing@5.0.2
node --test tests/r3-browser-readonly-evidence-lab.test.mjs
npx --yes firebase-tools@14.18.0 emulators:exec --only database \
  --project demo-fg-r3-readonly --config firebase.r2-dual-stream-lab.json \
  "FG_R3_READONLY_EMULATOR_TEST=1 node --test tests/r3-browser-readonly-evidence-emulator.mjs"
```

The isolated localhost Firebase emulator tests seed synthetic, signed water/rain reports and verify that **actual anonymous RTDB leaf subscriptions** can read only the two public leaves. Parent/private reads, anonymous writes, gate mutations and private receipts are denied. Updating one source, forged signatures, and replay/restore attempts must not cause the other source to appear invalid or fabricate a live/physical safety declaration.

The pure browser reader suite verifies WebCrypto Ed25519 verification with ephemeral independently pinned test keys, canonical compatibility with R2, malformed and forged frames, stale and future time, clock rollback, independent water/rain state, listener cleanup, expiry, disconnect and async verification races.

## Explicit unresolved release blockers

- This is a **lab-only code seam**: it is not imported by the production provider or any dashboard route. No real browser/device end-to-end test or mobile native QA is implied by Node's WebCrypto acceptance.
- Browser proof verifies the signature on the public **report only**. PR #22's independently signed server acceptance receipt is **not** published in the current public evidence leaf. Therefore `backendReceiptVerified:false` is an intentional invariant. Real trusted issuer attestation, replay authority, and source enrollment remain pending.
- Per-observer replay protection is in-memory only. A new tab, restored browser storage, Firebase database rollback, or overwritten trusted deployment configuration may evade history-based checks. Publication requires a durable, independently protected and reconcilable authority.
- Hardware measurement calibration, real ESP8266 identity, physical gate state, alarm delivery, incident-handling and cross-client Flutter/WhatsApp signoff remain unverified.
- Avoid using this experimental proof alone as a safety announcement. Stale/invalid source data is **UNKNOWN/UNAVAILABLE**, not an automatic safe state.

**Stage R2 still partial; Stage R3 read-only LAB integration in progress; production NO-GO.**
