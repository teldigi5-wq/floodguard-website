# FloodGuard R2 — independent revocation high-water checkpoint (isolated lab)

**Review-only, local prototype. No production Firebase, firmware, gate, WhatsApp or deploy.**

## Why an independent checkpoint is needed

The existing disabled-first revocation saga stores the verifier's role enable flag,
role generation, and `revokeTime` in RTDB. If an operator mistakenly restores an
older RTDB backup, the protected role metadata may move backward. The restored
RTDB Rules would then evaluate that older metadata. A correctly signed old ID
token could again satisfy a restored cutoff/role generation in some
circumstances. The application coordinator cannot assume backup restoration
preserves revocation guarantees.

This stage adds `experiments/offline-revocation-highwater.mjs`: a separate
HMAC-SHA-256-sealed filesystem checkpoint, intentionally NOT stored in RTDB.
The file is created only in an explicit private (0700) lab directory, written
with 0600 permissions, and committed through temporary-file fsync, atomic
rename and directory fsync. The HMAC key is supplied independently and is
never committed to GitHub or stored in the witness file.

The record binds one synthetic role UID to its **highest acknowledged**
`roleGeneration` and `revokeTime`. A new generation must be exactly one
higher and the cutoff cannot decrease. Missing, unreadable, tampered,
ill-permissioned or incompatible records fail closed; no silent bootstrap
or reset from RTDB is allowed after the original commissioning.

The existing `offline-role-revocation-coordinator.mjs` now accepts an
**optional, frozen** `independentWitness` adapter in this lab. When supplied,
it requires the independent checkpoint to agree exactly with the RTDB role
generation and cutoff BEFORE it can disable, revoke, or commit anything.
After the disabled-first Auth revoke and RTDB CAS succeed, it advances the
independent witness and checks the persisted result before reporting
completion. If database state has been rolled backward, if the witness is
missing, or if either checkpoint update has an uncertain result, it returns
`manualRecoveryRequired`. It never repairs the mismatch automatically and
never enables a role. Prior lab callers without a witness keep their existing
behavior; **this is not a mandatory production policy or code path**.

## Verification

`tests/offline-revocation-highwater.test.mjs` uses temporary directories,
random independent keys and only synthetic role stores. It verifies:

- Successful monotonic checkpoint recording after disabled-first revocation
- Detection of RTDB generation or cutoff rollback before contacting Auth
- Missing file, HMAC tampering, incorrect key and unsafe permissions
- Rejection of generation jumps, invalid cutoffs and silent recommissioning
- Fail-closed behavior if the independent checkpoint cannot be advanced
- Explicitly demonstrated failure to detect a coordinated rollback of both
  the RTDB record and the local sealed file

`tests/auth-emulator-lifecycle.mjs` additionally uses the two local Firebase
emulators and a real **Auth Emulator-issued test token** to execute a
disabled-first revocation with the independent witness, restore the old role
and session through an explicit **emulator-only fixture**, and check that a
new coordinator refuses it with `independent-checkpoint-mismatch`.

CI runs these tests with all existing Phase B authorization suites in the
`demo-fg-auth-lifecycle` local Auth/RTDB emulators. No hardware, real
Firebase project, real provider token, real customer or messaging service
is accessed.

## Critical limitations / production NO-GO

**This does not stop direct Firebase clients.** RTDB Rules cannot read a
checkpoint stored on another machine's filesystem. A restored RTDB policy
may be insecure until a separate independent privileged authority detects
the rollback and takes an operator-approved fail-closed action. The
coordinator only protects its OWN subsequent administrative operations.

**An HMAC cannot detect an entirely valid older HMAC-signed file.**
Coordinated rollback of the witness and the database, or compromise of the
witness key, defeats this check. The test includes that attack deliberately.
A real solution needs an independent, access-controlled, anti-rollback
authority or append-only external log with durable monotonic guarantees,
separate backup/restore controls, verified deployment isolation and
manual restoration review. This prototype also assumes a single process
owns the private directory; atomic rename is not a cross-host CAS.

Remaining production blockers: real Firebase Auth issuer and Cloud IAM,
independent durable cloud confirmations, current deployed RTDB anonymous
live-write remediation, actual ESP8266 firmware/TLS/key custody, Flutter
native CI, WhatsApp supervised acceptance and physical gate field testing.
No protected main merge, Firebase Rules publication, deploy or device action.
