# FloodGuard R2 — externally signed revocation proof (offline lab)

**Draft-only, test-only candidate. No external service has been deployed.**

## Why this differs from prior checkpoints

The existing `restoreFenceLab` lives in the same RTDB as role metadata, so a
whole-database backup rollback can restore both to a mutually agreeing old
state. The separate HMAC file can detect an RTDB rollback but may itself be
restored. Neither mechanism is a genuinely independent authorization
authority capable of enforcing decisions at the Firebase Rules boundary.

`experiments/external-revocation-proof-client.mjs` defines a read-only
**pinned Ed25519 public-key trust boundary** for an independently operated
authority's response. It contains no signer, private key, Firebase Admin
SDK, external URL, or production credentials. Its caller must supply an
explicit frozen transport with `read` and `advanceCAS` operations, a
pinned Ed25519 public key and an expected authority ID.

Every request generates a fresh cryptographically random 128-bit challenge.
A fixed canonical signed record binds the exact authority identity,
device-operator role UID, generation, revocation cutoff, the challenge, and
bounded issue/expiration timestamps. The client rejects malformed fields,
wrong signer, wrong authority/role, altered records, expired/future records,
and replay of a response issued for a previous challenge.

The existing `offline-role-revocation-coordinator.mjs` now accepts an
**optional** `externalWitness`. When configured, it validates an externally
signed snapshot matching local protected RTDB session state **before** any
database or Auth mutation. It completes disabled-first revocation, local
cutoff and optional HMAC witness as before, then requests an externally
signed `advance`, and separately re-reads fresh signed evidence before
reporting success. Any missing, stale, conflicting or unverified external
proof returns manual-recovery-required; it does not enable the role.

The external authority must own its signing private key and its monotonic
persistent history in a different trust/failure domain from Firebase and
the ingestion backend. **An attacker controlling that authority and its
valid signing key can issue false or rolled-back proofs.** A signed record
alone is NOT evidence of append-only storage or WORM durability.

## Synthetic tests

`tests/external-revocation-proof.test.mjs` uses synthetic local Ed25519
keypairs and a separate in-memory fake authority (signing happens only
inside test fixtures). Cases cover:

- Pinned identity and valid signed challenge-bound readback
- Wrong key, forged signature, mutated fields, wrong role/issuer
- Expired/future proof and replay of a previous signed challenge
- External authority read failure (no attempt to disable/auth revoke)
- Successful disabled-first revocation with signed independent readback
- Database-only restore detected before contacting Auth
- Uncertain external CAS leaving the database role disabled
- Tampered remote advance result rejected
- Emulator-only execution gate
- **Deliberate negative:** coordinated rollback of both RTDB and the
  supposedly external authority's state defeats the local simulator

The suite is included in the existing Auth + RTDB emulator Phase B CI
command. No cloud IAM, protected external store, production signer,
network call, Firebase deployment, hardware, physical gate, or WhatsApp
message is used.

## Production NO-GO and next-stage requirements

This is an interface and authenticity test, not a built/deployed external
authority. A production design additionally requires independent operator
identity/authentication, access-controlled CAS writes, key custody/
rotation, audit durability, backup-restore resistance, tested network and
failure isolation, and a recovery approval workflow. Critically,
Firebase Rules cannot directly verify this Ed25519 proof; the untrusted
direct-client write path must be eliminated or constrained by a separately
verified trusted ingestion backend before this authority can govern
actual telemetry publication.

Other existing release blockers remain: current live RTDB anonymous-write
remediation, real ESP8266 firmware/TLS verification, Flutter native CI,
cloud persistence/confirmation, and supervised mobile/bot/hardware acceptance.
Protected `main` and production are untouched.
