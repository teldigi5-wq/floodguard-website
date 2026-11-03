# FloodGuard R3 H11 — Signed read-side containment of privileged record forgery

**3 November 2026 · stacked on verified H10 draft PR #104 at `7129f7147dec24e9cf556535fd1b19dbb798eb47`. DRAFT / UNMERGED / NO DEPLOY / NO LIVE FIREBASE / NO DEVICE OR GATE / PRODUCTION NO-GO.**

## Verified ancestor and the remaining threat

H10's original three-signature verification, canonical device/publisher/issuer/incident authorization, same-node CAS and H7/H8 acknowledgement tests passed 81/81 focused tests. Its known **privileged-owner bypass** remains real: an Admin-like credential bypasses Firebase client Rules and can directly overwrite the database with a false `SAFE` record. The H11 experiment does **not** prevent that write or claim a privileged-token isolation guarantee.

H11 instead moves a separate, fail-closed verification boundary to the *consumer of the stored reading*: a changed Firebase record is not automatically trusted simply because Firebase returned it. This is an **offline research design and Emulator check**, not an implementation of a protected Android/website safety display. Earlier H4/H6/H7/H8/H9/H10 code, Rules and deployed Firebase state are unchanged.

## Modules and trust contracts

`experiments/r3-h11-certified-read-boundary.mjs` is a pure Node.js module with two distinct capabilities:

- **Synthetic certifier:** calls the existing trusted H4 issuer to verify the canonical Ed25519 source envelope, acceptance receipt and independent database confirmation; compares the full, exact H10 publication record to that previously signed candidate; rereads the record to reject concurrent authorization/publication changes; then signs an exact versioned, domain-separated Ed25519 certificate binding device, epoch, control revision, signer generation, sequence, digest, risk status, distance/level, observation time, issue time and expiry. Certificate lifetime is at most four seconds. Untrusted request-supplied public keys, a raw `DATABASE_CONFIRMED` string or a worker success message are insufficient.
- **Synthetic consumer:** pins one *independently injected* Ed25519 public key, verifies the certificate against a fixed canonical schema, reads an *independently injected* H7 acknowledged witness checkpoint and signer-revocation policy, checks no outstanding pending operation/quarantine and exact sequence/digest/epoch/generation, obtains the complete RTDB publication through a read-only observer, compares **every signed field** to the database record and rereads the witness to reject changes during that fetch. Stale (>30-second) observations, expired certificates, missing or changed records, forged signatures, revoked signer state or unacknowledged writes produce `verified:false`.

Every result retains `releaseDecision:'NO_GO'`, `canDeclareSafe:false`, `canSendAlert:false`, `canOperateGate:false`, and `physicalSourceVerified:false`. Even an honestly signed **SAFE label is not a real-world safety certification**; an ESP8266 could be offline, physically wrong, miscalibrated or attacked upstream.

The certifier, signer key, read-only RTDB observer and witness are **separate injected capabilities in code**, but in the current tests they share a disposable CI machine and ephemeral synthetic keys. Separate failure domains, true remote administration, approved key provisioning and independently verified hardware state **have not been demonstrated**.

## Actual local Firebase Emulator integration

H11 adds test cases to the existing H10 Auth + RTDB Emulator harness. It reuses H10's mandatory three-Ed25519 worker, H7 sealed reservation witness and H8 readback attestor. It does not introduce an alternate database writer or loosen any Firebase Rules:

1. H10 signs and commits a warning observation, H8 reads the real record and signs its acknowledgement, and H7 advances to that exact sequence/digest. The H11 certifier calls the existing H4 signed-source proof, checks the full actually committed record, and produces the four-second certificate. H11's consumer verifies the pinned certificate, actual Auth Emulator readback and acknowledged H7 checkpoint. A synthetic privileged owner then overwrites the record to false SAFE; the previously valid certificate **no longer matches and cannot certify SAFE**. The certifier also refuses to sign the altered record as if it matched the originally signed source.
2. A signed H10 publication without the H7 acknowledgement still has a pending witness. Even if H11 can issue a source-bound certificate, **the consumer refuses it** until the independent witness reaches the matching acknowledged checkpoint.
3. A cached certificate becomes unusable immediately after the separately injected signer policy is disabled, even if the Firebase record itself has not changed.

The pure H11 tests cover signed positive warning evidence (no physical safety permission), three-signature certifier contract, forged certificate and status, privileged false-SAFE rewrite, changed digest/sequence, unknown fields, pending/replayed/quarantined independent witness, signer generation change/revocation, stale timestamps and clock errors, authority mutation during readback, and read failure. The inherited H10/H9/H8/H7/H4 suites are rerun on the exact head.

**Explicit expected-negative:** if an attacker obtains the privileged database-writer capability **and** the H11 attestation private key **and** the independent witness authority, they can forge mutually consistent false SAFE material that the prototype cryptographic verifier accepts. The test deliberately demonstrates this remaining compromise and requires `canDeclareSafe:false` even for that synthetic positive cryptographic result. It must never be reported as a security guarantee.

## Blockers and the next meaningful production gate

1. **Privilege and key custody:** Firebase Admin-like credentials still bypass database Rules. H11 does not remove the privileged writer, prevent falsification, or guarantee an independently hosted certifier. A real implementation needs a constrained publication identity, separate attest/observer service, protected key material, auditable operator revocation and a primary unsafe-write incident response.
2. **Independent witness durability:** H7's external monotonic anchor is an in-memory same-host test double; signer state and the H8 readback attestor are also synthetic. Need independently operated trust/rollback-resistant authority and test read-after-commit failure under partitions.
3. **Real application integration:** The actual Flutter/website code has not been modified to require signed certificates before displaying a risk state. Current production read paths remain unchanged, so **a database forgery can still mislead a client that trusts raw values**. Production read-side containment has not been shipped.
4. **Sensor and physical safety:** ESP8266 firmware signature/TLS, authenticated durable upload, fresh observation timestamps, independent local alarm, sensor calibration, power recovery and physical gate interlocks remain unverified. The last user-observed real `system/lastUpdate` was 25 August 2026. Historical SAFE is not a current all-clear.

**Next acceptance should prioritize integrating the *verified, independently held* evidence contract into a fail-closed nonproduction client and authenticating the field ingestion path, rather than multiplying synthetic lab stages. Explicit operator approval required before any production Firebase, Android release or gate deployment.**

CI runs only against `demo-r3-h10-canonical` on loopback Firebase Auth (9099) and RTDB (9000) Emulators and synthetic keys. Exact-head CI is required before a claimed pass.

**Review status: DRAFT / UNMERGED / PRODUCTION NO-GO.**
