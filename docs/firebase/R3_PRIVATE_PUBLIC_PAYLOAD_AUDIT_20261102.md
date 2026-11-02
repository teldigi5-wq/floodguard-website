# FloodGuard R3 — private public-value audit checkpoint (NO DEPLOY)

**2 Nov 2026. Stacked on draft PR #90. Offline-only, no live Firebase reads/writes, devices, firmware, or production changes. Release NO-GO.**

## Why the check is needed

The owner ran six live `?shallow=true` probes: 27 observed first-level public telemetry fields, zero unexpected names. The exact stored `system.lastUpdate` remained `2026-08-25T14:30:41.226Z` across two later requests. The shallow check **does not inspect types, nested children, values, future mutations, writer provenance or privacy**.

A previously uploaded historical database export (not committed here) was also inspected privately. Its six public monitoring branches contained **27 primitive fields**: water 3, rain 8, gate 4, alarm 2, devices 7, system 3; no nested collections in that *historical snapshot*. The ESP subtree also has 3 intentionally public scalar fields and separate private network metadata. This does **not** prove today's database contents are identical or currently fresh.

## Added local, redacted source auditor

`scripts/r3-private-public-payload-audit.mjs` opens only an explicitly supplied local `.json` file with a 128 KiB upper bound, and rejects symlinks and invalid input. It reads expected child fields from `floodguard.live` in memory, checks primitive types, bounded numeric fields, strict finite timestamps and recognized status enums from the existing mobile model. Unknown field names, missing core fields and nested objects/arrays in readable branches are counted as review failures. ESP `ip` and `wifi` are neither emitted nor validated; these are **private**, not public display fields. The tool prints only static labels, counts and booleans; never paths, raw JSON, credentials, private values, IPs, or unknown key names. It performs **no** network or writes, and has no firmware/gate control.

Run **only on an authorized local computer** with a privately saved, historical/authorized snapshot; keep file out of Git, CI, PRs, cloud logs, and chat:
```bash
node scripts/r3-private-public-payload-audit.mjs \
  "/absolute/path/outside-the-repository/private-floodguard-export.json"
```

Exit status `0` means **snapshot schema/type preflight only**, not production readiness. Exit `2` is review-required/refused. Output includes `releaseDecision=NO_GO` unconditionally and independent false claims for `liveDataSourceVerified`, `liveWriteAuthorizationVerified` and `publicDataPrivacyCertified`, even when the shape looks correct. A local timestamp that appears recent is not proof it came from sensors or was authenticated; only the owner's independent field QA can establish that.

The new CI workflow checks only **synthetic export-like fixtures**. Regression tests must cover known primitive sample, stale timestamp, unexpected field, nested canary, invalid range/type, missing core, path/secret redaction, oversized/malformed/symlink refusal and no-network/no-write implementation. Exact-head CI required before marking those tests executed.

## Remaining issues

- Existing anonymously readable branches are **not a future-proof public projection**. A new private descendant under an allowed read node is automatically readable under current Rules; emulator PR #90 reproduced this. Current live data's deeper nested structure and complete privacy classification remain unverified.
- Historical private ESP8266 sketches used `setInsecure()` and anonymous-style REST writes; actual flashed firmware, device power, authenticated write identity and physical data freshness are not verified.
- The staged signed-ingestion/attestor/service-fencing architecture already exists in earlier draft branches. Continue it; don't build a competing backend or embed a Firebase Admin/service-account private key in ESP8266 firmware.
- Real RTDB Emulator positive and negative writer tests, independent proof of signed physical records, key custody, durable witness, revoked credentials, alarm/gate safety and live incident response are **NO-GO** gates.

Never re-import exported JSON or manually alter `system.lastUpdate` to make the UI appear live. No merge, live Rules change, database writes, hardware flash, physical gate control or messaging action in this stage.
