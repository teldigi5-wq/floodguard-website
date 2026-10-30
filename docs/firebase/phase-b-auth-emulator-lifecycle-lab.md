# FloodGuard R2 — Auth Emulator-issued credential lifecycle integration

**Research-only, local Firebase Auth + RTDB Emulator experiment. Not production.**

This stage goes beyond the earlier `@firebase/rules-unit-testing` mock
`authenticatedContext` by creating synthetic Auth Emulator users and scoped
custom claims via the Firebase Admin SDK directed exclusively to the
Authentication emulator, then signing in with email/password to obtain
**actual Auth Emulator-issued ID tokens**. The test sends those tokens over
localhost to a separate RTDB Emulator with the existing isolated
`phase-b-session-revocation.rules.json` candidate installed.

No actual user accounts, production Firebase resources, service-account JSON,
cloud network calls, API keys, device credentials, or live telemetry are used.
Only the `demo-fg-auth-lifecycle` demo project is accepted. The experiment
requires both `FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099` and
`FIREBASE_DATABASE_EMULATOR_HOST=127.0.0.1:9000`, an explicit feature gate,
and matching `GCLOUD_PROJECT`. Private test passwords are randomly generated
in memory. Admin SDK operations are **only Auth Emulator user/claim fixtures**;
normal RTDB operations use the Auth-issued client ID token. Seed data uses
the RTDB Emulator's special **test-only** `owner` bypass and cannot be
transferred to production.

## Coverage

- Real emulator sign-in produces a token with the expected UID,
  project audience, `auth_time`, role-specific custom claim and generation.
- A signed-in verifier may issue a correctly session-bound staging approval;
  an independently signed-in staging principal may then write that exact
  four-field frame; a third signed-in observer can read only its assigned
  narrow staging and approval fields.
- Direct device and wrong-role writes are rejected by actual RTDB rules.
- A revocation cutoff equal to a verifier token's real `auth_time`
  immediately denies future verifier writes, **and invalidates a previously
  issued grant** even when the grant has not expired.
- A role generation increment causes the existing ID token to fail while an
  independently issued new token carrying the updated custom claim can
  be accepted. Updating custom claims does not mutate an existing token.
- Stager and observer revocations remain independent; existing clients cannot
  read/write protected revocation metadata, `live`, or physical gate paths.

Run only in a temporary local demo environment:

```sh
npx --yes firebase-tools@14.18.0 emulators:exec \
  --only auth,database --project demo-fg-auth-lifecycle \
  --config firebase.phase-b-auth-lifecycle.json \
  "FG_REAL_AUTH_LIFECYCLE_TEST=1 GCLOUD_PROJECT=demo-fg-auth-lifecycle node --test tests/auth-emulator-lifecycle.mjs"
```

The Phase B GitHub workflow temporarily installs
`firebase-admin@14.5.0` **test-only with no lockfile mutation** and runs
this step separately from all preexisting RTDB emulator regression suites.

## Explicit noncoverage

The Auth Emulator intentionally issues unsigned tokens and does not
validate the signature or expiration of custom auth tokens, nor reproduce
Cloud IAM or production anti-abuse/rate limits. An Admin SDK configured for
the Auth Emulator accepts these simulator tokens; production Admin SDK
validation is a different security boundary. These tests do **not** prove
that `revokeRefreshTokens`, real Auth's `tokensValidAfterTime`, the
protected RTDB revocation cutoff, and claim generation are securely
synchronized across a production failure. An operator-authorized,
failure-tested real issuer would still need to enforce the cutoff, rotate
claims and roll back safely. A stolen verifier and staging credential pair
could still fabricate schema-valid readings.

Production remains **NO-GO**: live anonymous-write RTDB rule exposure has
not been verified remediated; ESP8266 flashed firmware, certificate-pinned
TLS and key custody, hardware gate, cloud durability/rollback, Flutter
Android native CI and WhatsApp supervised acceptance are still pending.
No repository protected main, real Firebase Rules, live services, firmware
or physical controls were changed.

References:
- https://firebase.google.com/docs/emulator-suite/connect_auth
- https://firebase.google.com/docs/auth/admin/custom-claims
- https://firebase.google.com/docs/auth/admin/manage-sessions
