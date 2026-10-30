# FloodGuard R2 — independent public water/rain signed evidence (local emulator research)

**Status: DRAFT / EMULATOR ONLY / NO PRODUCTION AUTHENTICATION.** This is the continuation of PR #20's signed-water receipt reconciliation. It is stacked on that PR, not on protected main.

## Reason for the separate design

The existing shared `system.lastUpdate` cannot prove freshness of a particular water or rain sensor. An unrelated heartbeat or a newly delivered sibling sensor frame must never revive a stale observation. The current live website, Flutter and bot clients have no authenticated, per-source public proof envelope. A water-only signing path does not prove rain provenance.

## Test-only data model

Exactly two reader-visible leaf paths are supported in the dedicated **demo** Firebase RTDB emulator:

- `/floodguard/evidenceLabV1/water`
- `/floodguard/evidenceLabV1/rain`

Each stores `{ payload, signature }`, where the signed payload has only:

`version, stream, sourceAlias, epoch, sequence, observedAtMs, receivedAtMs, sample`.

The only public aliases are `water-primary` and `rain-primary`, not hardware identifiers. Water's sample contains `distanceCm, levelCm, reportedStatus`; rain contains `currentMm, dailyMm, reportedStatus`. No device ID, private IP/Wi-Fi, contact, command, key, or gate state is published. All reported statuses remain **reported values**, not proof of physical safety.

The payload is canonicalized in a fixed field order, capped at 512 UTF-8 bytes and verified with Ed25519 against a **separately pinned, out-of-band trusted public key**. The record cannot choose its own trust anchor. The test suite uses separate, ephemeral water/rain keys. It never stores a private signing key in RTDB or source code.

## Least-privilege experimental RTDB rules

- Parent evidence collection, private ingest/identity/contacts and old `live` paths are all inaccessible to anonymous readers under the isolated rules.
- Anonymous readers may read each public leaf and cannot write.
- Two distinct synthetic publisher identities/claims and operator-controlled enabled/scope records authorize each stream separately. Each writer cannot write the sibling, parent, private data, or gate/actuator subtree.
- The publisher may advance an existing record only, with **strictly increasing sequence**, same epoch, and nonregressing observation/receipt clocks. Initial record creation is operator-only; missing record blocks an ordinary publisher. No unapproved extra fields.
- Firebase Rules cannot verify the Ed25519 signature. A compromised authorized scoped writer could publish an invalid (but structurally plausible) signature, which readers must reject cryptographically. The tests explicitly demonstrate this gap rather than claiming the rules provide signature authentication.
- Clients cannot infer that a positive reported water status or low rain amount proves flood safety. The verifier returns `FRESH_SIGNED_REPORT_NOT_PHYSICAL_PROOF`, not `SAFE`, `LOW`, or verified hardware-online.

## Clock and replay limits

A valid signature is insufficient: observed and received clocks must be plausible and recent under the 10-second **prototype** window and receipt cannot predate observation. A caller-provided prior frame provides an **in-memory** monotonic check only. Durability across restart/restore, authorized rotation, clock skew and offline buffer management remain unsupported. A signed record can be replayed within the allowed window if the authoritative checkpoint is missing or overwritten; production requires durable nonrollback and properly scoped receipts.

## Run exact emulator laboratory

```bash
npm ci --ignore-scripts
npm install --no-save --package-lock=false --ignore-scripts @firebase/rules-unit-testing@5.0.2
node --test tests/r2-dual-stream-public-evidence.test.mjs
npx --yes firebase-tools@14.18.0 emulators:exec --only database \
 --project demo-fg-r2-dual-stream --config firebase.r2-dual-stream-lab.json \
 "FG_R2_DUAL_STREAM_EMULATOR_TEST=1 node --test tests/r2-dual-stream-public-evidence-emulator.mjs"
```

All test root paths use the isolated demo project and loopback port 9000. No real Firebase URL, hardware, WhatsApp session, service-account key, live rules, gate controls, protected branch or Vercel production deployment is involved.

## Release blockers

Production ingestion must independently verify device credentials, sensor clocks/calibration and signed server receipts, and atomically write a durable per-source publication checkpoint. The public proof-key pins and key rotation need a secure trust-distribution mechanism and precise revocation policy. A server-side publisher that operates on limited dedicated paths—not privileged root transactions—must be audited. The Flutter app, bot and Next.js website need verified source-specific stale/unknown UI and controlled fallbacks. Physical commissioning and alert/consent delivery evidence are still absent.

**Result of this laboratory, even if all tests pass: R2 remains PARTIAL. Overall FloodGuard release remains NO-GO.**
