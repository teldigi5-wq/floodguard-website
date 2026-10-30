# Stage R2 — Firebase role-session revocation and approval invalidation (isolated emulator)

**Status:** Review-only synthetic research candidate. This is NOT proof of production Firebase Authentication custom-claim issuance, JWT signature verification, existing ID token invalidation in a real project, or cloud persistence. No live Firebase/firmware/WhatsApp/hardware is accessed, and do not deploy or merge the rules.

## Why the prior grants needed a revision

Revoking Firebase Auth refresh tokens does not automatically invalidate already-issued stateless ID tokens for RTDB Rules. Firebase's documented approach mirrors the account's Auth token-revocation cutoff in a separately protected RTDB node and requires the token's `auth_time` to be strictly later than that cutoff when evaluating sensitive reads or writes. See: https://firebase.google.com/docs/auth/admin/manage-sessions .

We added an additional **operator-assigned monotonic role generation** as a defense-in-depth test. An old token's `fg_role_generation` must agree with the currently enabled role metadata. Neither `auth_time` nor `fg_role_generation` is safely caller-chosen in production; both must be populated by an independently authenticated and appropriately authorized issuer.

This candidate is derived from the previous read-only-recovery ruleset, leaving every previously tested policy intact. New files: `docs/firebase/phase-b-session-revocation.rules.json`, `firebase.phase-b-session-revocation.json`, `tests/session-revocation-staging-emulator.mjs`. No secrets and no test production project IDs.

## Rules and crash/revocation contract

A read-only and write-protected test metadata tree,
`/floodguard/sessionRevocationsLab/{roleUid}`, contains only:
`revokeTime` (integer Unix seconds) and `roleGeneration` (positive integer).
It is provisioned through privileged **test fixture setup only**.
For each sensitive verifier approval write, staging-authority write, and
observer's narrowly scoped read, the Rules require:

- An exact role UID and its original specific role claim, scope, enabled state and device assignment;
- A present, numeric protected `revokeTime` and current `roleGeneration`;
- A nonmissing `auth.token.auth_time` strictly greater than the revocation cutoff;
- `auth.token.fg_role_generation` strictly equal to the current role generation.

Missing metadata fails closed. Each credential can be revoked without changing the others. Clients cannot read/overwrite the metadata or issue new claims. The metadata is **not** automatically synchronized with Firebase Authentication here.

A subtle additional rule prevents a staged write from using an already issued verifier grant AFTER verifier session revocation or generation rollover, even when the ten-second grant TTL is still active:
`verifierAuthTime` and `verifierRoleGeneration` are required in the approved record and bound by RTDB Rules to the verifier token's own `auth_time` and `fg_role_generation` at grant creation. Staging checks both properties again against CURRENT protected verifier revocation/generation metadata. This avoids relying on millisecond timestamp comparisons against a seconds-resolution revocation cutoff. A revoked verifier does not reactivate its old approvals merely by re-enabling a role flag.

`experiments/signed-staging-approval-emulator.mjs` has two **optional** test-only constructor fields for those exact grant values; the unchanged earlier candidates use neither, so the preceding dual-role and observer tests keep their original schema. Values provided to the module are not trusted independently: only the emulator Rules' comparison to actual mock `auth.token` makes them acceptable in this candidate.

## Test-only invocation

```sh
npx --yes firebase-tools@14.18.0 emulators:exec \
  --only database --project demo-fg-session-revocation \
  --config firebase.phase-b-session-revocation.json \
  "FG_SIGNED_STAGING_BRIDGE_TEST=1 FG_DUAL_AUTHORITY_TEST=1 FG_SESSION_REVOCATION_TEST=1 node --test tests/session-revocation-staging-emulator.mjs"
```

The suite includes valid issuer/stager/observer roles, cutoff equality, stale generation, missing metadata, forged grant session fields, already-approved grant revocation, role generation rotation, independent staging and observer revocation, inaccessible protected metadata, safe renewal using a **synthetic later session**, and path isolation. The test's `authenticatedContext` injects mock claims. It does **not** create a Firebase Auth user or validate a signed JWT, and using `auth_time = 1003` in a test must not be confused with a real issuer minting an ID token.

## Still blocking production GO

1. Real Firebase Auth and token issuer authorization, signature/expiry enforcement and verified `revokeRefreshTokens` / `tokensValidAfterTime` synchronization to RTDB metadata, with failure-atomic changes to role generation.
2. Role separation and independent credential/secret custody; admin/service credentials could bypass RTDB Rules and demand additional controls.
3. Cloud IAM verification and independently durable staging/approval/confirmation, crash/lost-ACK reconciliation, rollback-proof audit and rate limiting.
4. Supervised migration of the current deployed anonymous `/floodguard/live` rules without breaking a potentially legacy ESP8266 write protocol; flashed firmware and real TLS/key provisioning must be independently reviewed.
5. Flutter native CI, bot integration, hardware/physical-gate validation and operator-approved production release.

**No production Firebase Rules changes, no real Auth SDK operations, no device command, protected main merge, deployment, or notification occurred.**
