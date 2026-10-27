# Narrow authenticated publisher experiment — Firebase RTDB emulator only

**NOT production deployable.** This is a separate review fixture and cannot close current anonymous-write exposure by itself. No production rules, Firebase project, ESP8266, real phone, WhatsApp, or actuator is accessed.

## Why the architecture changes

The earlier projector tests succeeded by disabling security rules and transacting at the entire `/floodguard` root. This grants excessive power to a future cloud publisher: a compromised service could access live gate controls, ESP private networking data, and unrelated ingestion records. Firebase RTDB authorizes reads and writes by path; an allowed parent `.write` cascades to its descendants. Schema `.validate` rules cannot by themselves stop whole-node deletion, so the transaction's parent `.write` must also require an existing, complete replacement state.

The new **emulator-only** alternate data layout is:

```text
/floodguard/publisherLabAuthorization/publisher-water-stage
    enabled, scope, deviceId, epoch      PRIVATE; operator-owned
/floodguard/publicationLab/water
    current/{distanceCm,levelCm,status,observedAtMs,overallRisk}
    checkpoint/{initialized,deviceId,epoch,sequence,digest,observedAtMs}
```

A caller with **both** exact UID `publisher-water-stage` and `fg_publish_water_v1: true` still needs an independently provisioned and enabled authorization record with the correct device and epoch. The writer can transact ONLY at `/floodguard/publicationLab/water`. Anonymous readers can read `.../current`, not its parent or `checkpoint`. The writer cannot write `/floodguard/live`, gate, ESP networking, bot, device authorization, the staging lane or its own authorization record.

The parent write rule denies creating the subtree from nothing; requires both `current` and `checkpoint`, a strictly increasing sequence and observation timestamp, unchanged approved device and epoch, consistent current/checkpoint observation time and `overallRisk=UNKNOWN`. Detailed `.validate` rules bound every remaining leaf and deny unknown extra fields. This prevents deletion and arbitrary schema inflation when the simulated publisher operates inside its narrow subtree.

## Repeatable tests

`firebase.phase-b-narrow-lab.json` runs an isolated database emulator with `docs/firebase/phase-b-narrow-publication-lab.rules.json`. The new CI step executes:

```bash
npx --yes firebase-tools@14.18.0 emulators:exec --only database \
  --project demo-narrow-publisher --config firebase.phase-b-narrow-lab.json \
  "FG_NARROW_PUBLISHER_EMULATOR_TEST=1 node --test tests/narrow-publisher-rules-emulator.mjs"
```

Checks cover authorized client transaction, anonymous current-only reads, checkpoint privacy, anonymous/device/wrong-UID/wrong-claim denial, publisher inability to alter unrelated paths, replay and timestamp rollback, deletion, malformed values and extra fields, revocation, prohibition of bootstrap from missing data, and identity/scope changes. The old Phase B strict rules are copied as the baseline; tests compare all preexisting keys for exact equality to prevent accidental broadening.

## Critical exclusions

- **No independent source proof:** RTDB rules cannot prove Ed25519 signatures or trusted receipt/database confirmation. A compromised authorized writer could still forge a schema-valid water sample. A separately audited backend must verify actual authenticated firmware/TLS, staging, receipt signature, source freshness and device authority *before* this write. The experimental token and authorization fixture are not a secure real-world provisioning solution.
- **New path, no client cutover:** existing website and Flutter public subscriptions still read `/floodguard/live`. This lab writer publishes to `publicationLab/water/current` only. Moving clients, preserving nine read paths, multi-sensor fusion, checkpoint initialization, dual-write, stale data visibility and rollback all need design and supervised migration. Never silently swap routes.
- **Cost and practical limitations:** this is an experimental Firebase client-role security boundary, not a fully built scalable backend, and it does not claim cloud IAM isolation, production performance, device key rotation, durability under crash/network failure, or hardware acceptance.
- **Release prohibition:** never deploy `firebase.phase-b-narrow-lab.json`, change the effective `firebase.rules.json`, merge the draft, enable public HTTP upload endpoints, copy any synthetic secrets to devices, or actuate the gate without explicit owner approval and physical verification.

All existing sensor and dashboard safety caveats remain. Production anonymous-write exposure is STILL UNRESOLVED.
