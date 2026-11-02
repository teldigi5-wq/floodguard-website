# FloodGuard R3 — public telemetry Rules tested with the REAL local Firebase RTDB Emulator

**2 Nov 2026 — draft review successor to PR #89. No deployment, live database reads, device control, public writer permissions or firmware changes. PRODUCTION NO-GO.**

## Why this stage exists

Following the owner's manual Firebase Console Rules publication:
- 9/9 expected public RTDB child reads returned HTTP 200 from the owner's WSL host.
- 4/4 checked protected ESP private/parent paths returned HTTP 401.
- FloodGuard QA loaded on Android, as reported by its owner.
- Two live read-only `system/lastUpdate` checks approximately 16 seconds apart both returned `2026-08-25T14:30:41.226Z` (about 69 days stale). No evidence of current device upload is available.

The previous PR #89 **static** 11/11 checks covered exact `.validate` preservation and historical-firmware inspection. They did not execute the Firebase Rules engine. This stage runs the reviewed candidate under **a real RTDB Emulator** using a wholly synthetic database.

## Explicit isolation

The new `firebase.r3-public-read-rules-emulator.json` points ONLY to `docs/firebase/R3_PUBLIC_CHILD_READS_MERGED_REVIEW_ONLY_20261102.json`, never to `firebase.rules.json` or any live Firebase instance. Emulator database listener: `127.0.0.1:9000`. Project ID must be exactly `demo-r3-public-read-rules`; app test additionally refuses to run unless `FG_R3_PUBLIC_READ_EMULATOR_TEST=1`, `GCLOUD_PROJECT` exactly matches, and `FIREBASE_DATABASE_EMULATOR_HOST=127.0.0.1:9000`. An emulator-only `access_token=owner` is used exclusively to seed deterministic synthetic fixture records, NEVER as a proposed field-device identity or production credential. CI has `contents: read`, no Firebase production secrets and no deploy action.

## Assertions

1. Exact nine public child paths are readable by an anonymous client (HTTP 200).
2. Root, live and ESP parent, ESP `ip`/`wifi`, bot and test remain unreadable (HTTP 401/403).
3. Anonymous `PUT`, `PATCH`, `POST`, and `DELETE` writes at monitoring, ESP, alarm, private and parent paths are denied.
4. Denied writes leave the synthetic water, gate and timestamp unchanged.
5. **Intentional negative/privacy demonstration:** a synthetic private canary under the readable `devices` branch is also readable, proving that ancestor read grants disclose *every* descendant. This is a known design exposure if private fields are later added. It is NOT a successful privacy-inventory gate.
6. The app guard refuses any unpinned/prod project. Tests do not prove authorization of any genuine ESP8266 uploader, Ed25519 signer, independent witness or physical sensor.

Run only in a local checkout with Node 22 and Java 17:
```bash
npx --yes firebase-tools@14.18.0 emulators:exec \
  --only database \
  --project demo-r3-public-read-rules \
  --config firebase.r3-public-read-rules-emulator.json \
  "FG_R3_PUBLIC_READ_EMULATOR_TEST=1 GCLOUD_PROJECT=demo-r3-public-read-rules node --test tests/r3-public-read-rules-emulator.mjs"
```

## What this does NOT resolve

The published live Rules revision was manually changed in Firebase Console, not deployed from GitHub. We have client-observed statuses, not an authoritative exported effective Rules/IAM provenance record. Historical private ESP8266 v6/real-rain sketches used direct unauthenticated HTTPS REST `PATCH` and disabled certificate verification with `setInsecure()`. Current flashed firmware/power/real upload identity are unknown, and the stored timestamp remains stale.

The existing staged multi-PR signed-ingestion/confirmed-record/attestor research is much more advanced than this narrow read-Rules validation. **Do not build another competing gateway or loosen any production writer Rule.** Continue those isolated cryptographic and real identity gates; validate trustworthy field ingress, source freshness, safe browser/mobile display and independent local UNO gate authority before any release decision.

**NO-GO.** No merges, Rules publication, real Firebase writes, hardware flash, gate actuation, WhatsApp alert, simulated SAFE proof or production release as a consequence of this test.

## Owner-supplied shallow field-name inventory — 2 November 2026

The owner ran a **read-only** `?shallow=true` inventory of the six publicly readable monitoring branches from WSL after Firebase Rules publication. The script printed first-level field counts and unknown-key counts only. Reported output:

| Approved branch | First-level fields | Unexpected names |
| --- | ---: | ---: |
| water | 3 | 0 |
| rain | 8 | 0 |
| gate | 4 | 0 |
| alarm | 2 | 0 |
| devices | 7 | 0 |
| system | 3 | 0 |
| **Total** | **27** | **0** |

The allowlists originated from the previous database export and reviewed mobile model. Absence of optional `rain.weightGrams` explains why the observed rain count is eight although the source allowlist contains nine field names.

**Precise evidence limit:** This was a client-supplied console transcript, not an independently repeated request or a completeness-certified live schema export. `shallow=true` checks first-level names only; it does not verify values, types, nested descendants, private data in known fields, future schema additions, sensor authenticity or absence of bypassing privileged writers. A text-paste artefact appeared inside the command excerpt, but all six printed result lines were coherent; preserve this as reported evidence and avoid promoting the inventory to a privacy certification.

The owner's separate two read-only timestamp GETs stayed at `2026-08-25T14:30:41.226Z`, approximately 69 days stale. Thus **first-level schema preflight: observed pass**; **fresh/authenticated device ingestion: FAIL or unverified**, as no advancing clock was observed. Existing mobile stale warning remains mandatory and local hardware alarms/gate must not be influenced by synthetic or stale cloud status.

**Next gate:** review types and nested descendants privately without logging values; confirm current ESP8266 power/flashed version in an isolated setup, then continue the existing signed-ingestion and independent attestor/witness design with Emulator-positive and negative credentials, no public `.write:true`. No live data import, export upload, change to published Rules, or physical actuation. **NO_GO.**
