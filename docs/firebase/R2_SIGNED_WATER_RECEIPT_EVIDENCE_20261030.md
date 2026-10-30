# Stage R2 — signed water-observation evidence bridge (Firebase emulator only)

**Status: research / draft / NO-GO for production.** The implementation in `experiments/r2-signed-water-receipt-evidence.mjs` is a read-only evaluator for **one synthetic water-source publication** following the already reviewed atomic projector. It is **not** a public metadata API, device identity service, firmware attestation, durable storage ledger, or live web feature.

## Evidence binding

A trusted emulator-only observer reads an isolated root snapshot after `publishStrictEmulatorFrame` commits. The evaluator requires all of the following to match:

1. Exact device-source authority (UID, epoch, enabled `water-primary` scope) and an operator-pinned Ed25519 receipt signer fingerprint.
2. Enabled device identity with the permitted `prototype-ingest-v1` scope.
3. Canonical, well-formed synthetic device frame with matching SHA-256 digest and valid signed Stage 8 receipt; signed server acceptance time must not precede the device observation time.
4. Independent `DATABASE_CONFIRMED` record and byte-for-byte corresponding staged frame.
5. Privately persisted projector checkpoint (device, epoch, sequence, digest) matching the signed and confirmed frame.
6. Public `live/water` distance, level and status equal to the signed frame, and `system/lastUpdate` exactly equal to that frame's observation time; publication must still carry `overallRisk = UNKNOWN`.
7. Source-bound observation freshness computed against the receipt's accepted-at clock, **not** a newer unrelated system or Firebase connectivity heartbeat. The existing ten-second lab freshness window applies.

When any proof fails, the API returns an explicit stale/failure result without secret-bearing content. It never returns a device identifier, private key or raw frame. All live observations remain **unverified physical reports**, even if cryptographically consistent in the lab.

## Acceptance cases

The actual local RTDB emulator integration suite tests successful signed publication and inspection, failed/expired freshness, newer unrelated system heartbeats, forged payloads, copied old receipts after new publication, issuer replacement, revoked authority, private confirmation tampering, checkpoint rollback and public payload divergence. A pre-existing rules test proves public clients cannot read the privileged root or private records.

**Crucial boundary:** a caller-supplied snapshot is not independently authenticated. This function assumes the trusted test observer obtained it from the local Firebase emulator. It must NOT be exported to browser code or treated as a trusted production endpoint. The proof is point-in-time; it is not an authenticated client-consumable receipt and does not prove firmware-clock integrity. The existing emitter has no rain-source signed evidence, so rain remains unresolved.

## Exact-head offline verification

```sh
npm ci
npm install --no-save --package-lock=false --ignore-scripts @firebase/rules-unit-testing@5.0.2
npx --yes firebase-tools@14.18.0 emulators:exec --only database \
  --project demo-strict-projector --config firebase.phase-b-strict.json \
  "FG_STRICT_EMULATOR_PROJECTOR_TEST=1 node --test tests/strict-emulator-atomic-projector.mjs"
```

Only fixture keys and the `demo-strict-projector` emulator project are used. New CI checks this command on the exact branch head.

## Required before a real-source release

- Establish **separately verified** device firmware signing, trust provisioning, clock synchronization or safe monotonic event time, and true server-side receipt issuance.
- Design an authenticated public per-sensor evidence projection with least-privilege rules; a root privileged transaction is only an emulator experiment.
- Add equally trusted rain-source provenance; define multi-source arbitration and avoid moving `system.lastUpdate` on unrelated observations.
- Persist replay/freshness checkpoints across restarts, crashes, recovery and source rotation.
- Validate all three consumers (Next.js, Flutter, WhatsApp) and negative cases with release evidence and rollback.

No protected `main` merge, production Firebase deployment, web runtime change, bot send, gate command or physical hardware operation.
