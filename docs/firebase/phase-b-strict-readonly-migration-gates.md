# Strict public read-only Phase B security candidate

**Status: EMULATOR-ONLY / NO-GO FOR DEPLOYMENT.**

This variant starts from `phase-b-authenticated-prototype.rules.json` and removes the six explicitly granted `.write` expressions under the existing public live read contract:

- `water/distanceCm`, `water/levelCm`, `water/status`
- `gate/status`, `gate/angle`, `esp8266/status`

Its intent is to **separate privately accepted device observations from published public telemetry**. Even registered and enabled identities cannot write public live leaves directly. The existing nine public monitoring read paths are retained unchanged, and the private per-device `staging/ingestV1/{deviceUid}` still requires a matching authenticated UID, `fg_ingest_v1` custom claim, enabled operator-owned registry binding, exact staging scope, valid four-field payload, and strictly increasing per-device `sequence`.

## Why this is deliberately not a release implementation

There is **no trustworthy projector** implemented to verify/stamp accepted private staging observations and publish them to the nine existing public monitor leaves. Such a component would use trusted server privileges that bypass client RTDB Rules; it must have strict identity policy, input validation, reconciliation, data freshness, output allowlisting, least-privilege credentials, audit, retries, and a supervised rollback plan. **Do not substitute an anonymous bridge that simply copies old parent PUT/PATCH data.**

The actually flashed ESP8266 firmware has not been verified in this review. Archived variants upload anonymous whole-tree/parent updates and sometimes use unverified TLS. Publishing these stricter rules now would stop those uploads, leaving old displayed data indefinitely and potentially hiding a real hazard. Do not apply to production, reflash without owner permission, auto-merge, or issue real device credentials from this experiment.

## Test contract

- `firebase.phase-b-strict.json` points to the experimental policy, not deployed `firebase.rules.json`.
- Static tests assert that the only differences from the previous Phase B prototype are the six write-grant removals; staging/private authorization remains unchanged.
- RTDB Emulator tests deny six live-leaf PUT/delete operations for anonymous, ordinary, live-scoped, staging-scoped and revoked identities; deny public parent/mixed writes; verify all nine monitoring read paths and private read denial; prove private staging still authorizes matching claimed device and refuses replay and later revocation.
- Both original Phase B and strict variant emulator suites must pass on the exact draft commit. This still does not verify token issuance, official Firebase REST authentication, certificate validation, physical sensor calibration, or production backend behavior.

**Next actual release blocker:** inventory and verify the flashed device transport and plan a trustworthy projection/ingress implementation with physical and operator acceptance, followed by a coordinated authenticated cutover. Until then, Phase A retains its anonymous-write risk and the strict experiment cannot replace deployed rules.