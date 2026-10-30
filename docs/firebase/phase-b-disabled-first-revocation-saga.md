# FloodGuard R2 — disabled-first credential revocation saga (LOCAL TEST ONLY)

**Status: experimental, draft PR only. Production remains NO-GO.**

Prior Auth+RTDB emulator tests proved that actual emulator-issued role ID tokens
obey local role revocation cutoffs and role-generation rules, but did not show
what happens when an administrative operation is interrupted *between*
disabling a role, revoking Firebase Auth refresh tokens, and publishing the
verified cutoff. Because these are different services and different security
domains, neither a set of Admin SDK calls nor RTDB multi-location writes
constitutes a distributed transaction.

## Security contract

The new `experiments/offline-role-revocation-coordinator.mjs` requires
injected **frozen** adapters for a trusted operator-role store and Auth
gateway. It refuses to run outside the explicit `demo-fg-auth-lifecycle`
localhost Auth/RTDB emulator environment. It neither owns nor creates
credentials, listens on the network, mutates device firmware, issues
ID tokens, directly accesses live Firebase, nor grants operator rights.

For each *explicit* revocation request with the current expected generation:

1. Read current role state, revocation cutoff and generation, refusing missing
   or conflicting state.
2. **Disable the verifier/stager/observer role first**, using a storage
   adapter's compare-and-swap (CAS). If this write fails, its ACK is lost, or
   another operation changed state, return **manual recovery required**.
   Never call Auth until a fresh read proves the role is disabled.
3. Call the injected Auth gateway's `revokeRefreshTokens(uid)`. A timeout or
   error returns **unknown/manual recovery**. The disabled role still denies
   database access regardless of whether Auth completed.
4. Fetch `getUser(uid).tokensValidAfterTime` from the Auth authority,
   require a valid bounded UTC timestamp, and round **up** to whole seconds
   when generating a protected RTDB `revokeTime`. Existing greater cutoffs
   never move backward.
5. Update protected `sessionRevocationsLab/{uid}` with a separate CAS,
   advancing `roleGeneration` exactly one step. A failure, write conflict,
   lost ACK, or unreadable persisted state returns **unknown/manual
   recovery**. The role stays disabled.
6. Only report local emulator completion after rereading persisted disabled
   role, new generation and cutoff. **Never re-enable automatically.**

A crashed process after step 2 can only continue through a separate,
explicit `resumeDisabled:true` operation with the original generation.
Reapplying the old generation after a confirmed change is rejected. A
resumed operation may call Auth revocation a second time; this can advance
the cutoff, and the role stays disabled until a separately reviewed
recommissioning protocol. No automatic retries, no background jobs, no
remote writes and no eventual-success claim.

## Evidence and test scope

`tests/offline-role-revocation-coordinator.mjs` injects errors into
each boundary: initial/verification reads, disable CAS, Auth revocation,
getUser cutoff evidence, cutoff-generation CAS, recovery from a simulated
crash, stale generation and concurrent calls. It asserts that failure
cannot permit a speculative new token or reenable a disabled role.

The separate Auth+RTDB integration
`tests/auth-emulator-lifecycle.mjs` uses real locally issued emulator
ID tokens and a test adapter with conditional RTDB REST `X-Firebase-ETag`
and `if-match` CAS writes. It verifies that old ID tokens cannot issue
approval **immediately after the role is disabled**, even if Auth revocation
then fails, and that explicit recovery can finish. Admin SDK Auth calls
are configured for the **Auth emulator only**; the RTDB emulator's special
`access_token=owner` fixture is only valid in the isolated demo test.

```sh
npx --yes firebase-tools@14.18.0 emulators:exec \
  --only auth,database --project demo-fg-auth-lifecycle \
  --config firebase.phase-b-auth-lifecycle.json \
  "FG_REAL_AUTH_LIFECYCLE_TEST=1 FG_REVOCATION_SAGA_TEST=1 GCLOUD_PROJECT=demo-fg-auth-lifecycle node --test tests/auth-emulator-lifecycle.mjs tests/offline-role-revocation-coordinator.mjs"
```

## Unresolved production blockers

This is **not** a deployable revocation service or a proof of Cloud IAM
isolation. The default Auth Emulator uses unsigned test tokens and lacks
production identity, abuse and rate-limit guarantees. The test-only
`owner` bypass must **never** appear in production code. A real issuer
must authenticate and authorize the operator, protect all privileged
Firebase secrets, coordinate an independently auditable distributed
lock/transaction protocol, enforce durable cutoff and generation
monotonicity even under backup/restore, and test recovery under real
network failure, active token refresh and concurrent operators. The
separate role assignment may require additional authorization and
re-enrollment; no auto-enable policy is safe without human review.

No production Firebase Rules, live service, domain, ESP8266 firmware,
gate controls, WhatsApp delivery, Flutter mobile binary, or protected
GitHub main branch is changed in this milestone.
