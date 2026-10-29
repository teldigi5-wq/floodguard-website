# FloodGuard R2 — direct RTDB partial-restore authorization fence

**Research-only candidate. No production Firebase Rules deployment or auth migration.**

## Distinct protection goal

The independent filesystem HMAC witness detects that the *coordinator* is
looking at a restored/older revocation checkpoint. It cannot participate in
Firebase Realtime Database Rules, so restoring old RTDB role/session values
may allow direct credential holders to bypass the coordinator entirely.

This new **separate RTDB emulator Rules candidate** protects against a
*partial* restore of the `ingestVerifierLab`, `ingestAuthorityLab`,
`ingestObserverLab`, or `sessionRevocationsLab` subtrees. It adds
`/floodguard/restoreFenceLab/{roleUid}`, a read/write-denied operator-owned
test fixture containing `enabled`, `roleGeneration`, and `revokeTime`
for each of the three identity roles.

Every permitted verifier approval write, stager write, and observer-scoped
approval/staging/device-authorization read requires:

- Existing exact UID, custom claim, current Auth session cutoff,
  generation, operator assignment, device scope, signature approval and
  staging monotonicity rules from the prior isolated session-revocation lab
- The corresponding protected restore-fence record is present and enabled
- Its generation and cutoff exactly agree with the protected session
  generation and cutoff
- The stager additionally requires the **verifier's** restored-fence
  agreement, so an earlier approved frame cannot be published after a
  verifier fence is disabled or diverges

All other rules, including direct device write denials, hidden private
IP/Wi-Fi data, and prohibited public/gate commands, remain untouched.
The candidate is stored separately as
`docs/firebase/phase-b-partial-restore-fence.rules.json`, with isolated
`firebase.phase-b-partial-restore-fence.json` config and
`tests/partial-restore-fence-emulator.mjs` tests. Earlier Rules candidates
and production rules are **not modified**.

### Intended operational sequence (not implemented in production)

For a real revocation, a suitably authorized administrator would first
disable the restore fence, then the role, revoke credentials, and commit
the new cutoff/generation. A **separate, explicitly authorized**
recommissioning process would have to verify the independent high-water
authority before committing a matching fence and finally enabling the role.
No such issuer or recommissioning API is built here. The private emulator
fixture can set test fields directly; client credentials cannot.

## What the 12 tests establish

- Ordinary matching, enabled mirror records allow exact-role behavior
- Restoring only an old verifier role and session cannot permit new grants
  or publish already approved staging frames
- Restoring only the writer or observer role/session cannot grant its access
- Missing, disabled, stale-generation, or stale-cutoff fence records deny
- New generation/credential claims work only after explicit alignment
- The fence cannot be read or written by the verifier, stager, observer,
  device mock account or anonymous client
- Other-device writes, parent paths, public telemetry mutations and gate
  commands remain denied

**Explicit negative test:** Restoring **BOTH** the role/session subtrees
**AND** the matching old restore-fence record allows the old authorization
again. The fence lives in the same RTDB project and is therefore **not**
a real independent high-water authority. A compromised privileged operator,
Admin SDK service account, incorrectly scoped backup-restore job, or whole
database rollback may undo it. RTDB Rules cannot compare against the
separately stored filesystem HMAC witness.

## Test-only command

```sh
npx --yes firebase-tools@14.18.0 emulators:exec \
  --only database --project demo-partial-restore-fence \
  --config firebase.phase-b-partial-restore-fence.json \
  "FG_RESTORE_FENCE_TEST=1 node --test tests/partial-restore-fence-emulator.mjs"
```

The tests use `@firebase/rules-unit-testing` mock identities and
`withSecurityRulesDisabled` only for synthetic fixture creation and
post-write observation. This is not proof of real token issuing, cloud IAM,
anti-rollback audit services, or customer data safety.

## Production NO-GO

Before production migration, require an independently managed and durable
authorization authority with separate IAM, immutable/append-only external
revocation history, rehearsed backup restore and rollback detection with
tested production fail-close behavior, and operator-approved rules deployment.
The current production RTDB anonymous-write exposure and actual ESP8266
credential/TLS custody remain unverified. Flutter native CI, bot hosting,
cloud persistence/confirmation, and supervised physical-gate tests are
separate unresolved release gates. No production mutations are authorized.
