# FloodGuard — Firebase read-boundary audit

**31 October 2026. Main-based draft. No production connection has been made or verified by CI.**

## Why this review exists

The checked-in `firebase.rules.json` is a **template**, not an attestation of the deployed Firebase rules. It permits anonymous reads of the six legacy public telemetry group roots (water/rain/gate/alarm/devices/system) and three public ESP8266 fields, rejects their parents, and explicitly denies `esp8266/ip` and `esp8266/wifi`. There is no verified proof that the deployed project's rules match the template. Previous migration review documented unauthenticated network metadata exposure in a past production configuration; the current deployed condition remains **unknown**.

The template also **denies all writes**, including legitimate hardware ingestion. Do NOT deploy this template directly over an operating Firebase instance: any real publisher requiring RTDB write rules would stop. Production IAM, device identity, gateway paths, authorization and credential custody require separate design and approval.

## What this PR provides

1. `scripts/verify-firebase-read-boundaries.mjs`: only anonymous HTTPS `GET` to a hardcoded list of fixed expected public and private RTDB paths on an operator-supplied **Firebase domain**, no query parameter, authentication token, request bodies, write methods or redirects. It cancels response bodies and logs only HTTP codes and path names; it never parses, prints or stores database values. Network failure, redirect and unexpected code are **NOT** treated as successful access denial.
2. `tests/firebase-read-boundaries.test.mjs`: mocked-transport tests for origin validation, no credentials, no arbitrary paths, read status, network failure and no response-data processing.
3. `tests/firebase-read-boundaries-emulator.mjs`: actual isolated local Firebase Realtime Database Emulator against the exact `firebase.rules.json` template. Tests permitted public leaves, denied parents and private ESP paths, anonymous and ordinary authenticated write denial, and the known **public subtree exposure** risk. Uses synthetic fixtures only.
4. `firebase.read-boundary-lab.json` plus `.github/workflows/firebase-read-boundary-audit.yml` run the emulator on `127.0.0.1:9000` under a `demo-` Firebase project. No production database URL or credentials are used in GitHub Actions.

## Optional read-only check against the actual deployment

Only after an authorized operator confirms the correct RTDB HTTPS origin in Firebase Console, run locally:

```sh
# Replace this example with the exact confirmed Firebase Console RTDB origin.
FG_RTDB_URL="https://YOUR-CONFIRMED-DATABASE.firebaseio.com" \
  node scripts/verify-firebase-read-boundaries.mjs
```

The checker never writes. Do not supply Firebase tokens, admin credentials, service-account JSON or project secrets; this test is anonymous by design. An exit code of `0` means only that the fixed access-status expectations passed for that database origin **at the time of the check**. Exit `1` means any denial/public requirement failed or could not be verified; exit `2` means invalid input or configuration. Keep actual public results under your own access controls; the checker avoids revealing response bodies.

**IMPORTANT:** A passing test does not prove that the public water/rain/gate/alarm/devices/system leaves contain no sensitive fields. RTDB `.read:true` on a parent makes every descendant readable; negative `.read:false` on child cannot revoke the grant. The emulator demonstrates that injecting a synthetic private-looking child into the publicly readable water group exposes it anonymously. A separate authenticated publisher + explicit public schema projection is required before security claims about arbitrary public group contents. Avoid writing IP, Wi-Fi, secrets, personally identifiable information or commands underneath those publicly readable paths.

This read-only probe also cannot verify production write permissions, source authentication, Firebase rules version or provenance, tenant scope, alert delivery, hardware calibration, gate safety, mobile apps, bot integrations or rollback protection.

## Safe next steps

An authorized project owner must independently confirm the *actual* Firebase project URL and deployed rule revision, inspect all ancestor grants and all stored public group contents **in a private console without pasting sensitive values**, compare the current public data projection with approved fields, and only then design a narrow publisher-verified production rules migration with preview emulator tests and rollback. Never install or modify production rules automatically from this audit.

**Status: draft validation, not production remediation. Overall FloodGuard release NO-GO.**
