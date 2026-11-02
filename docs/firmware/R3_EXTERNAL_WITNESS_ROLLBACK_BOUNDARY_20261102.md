# FloodGuard R3 — External monotonic witness contract (offline only)

**2026-11-02 · successor to PR #77 exact verified head `32d4be129cae1586ac2ac2cf14a42fadf82e1da1`. OPEN DRAFT, UNMERGED, PRODUCTION NO-GO.**

## The actual problem

PR #77 stores device authorization, revocation, a synthetic confirmed database row and signed issuance history inside one real local SQLite transaction. However, a privileged restoration of an older, internally consistent **database + WAL snapshot** can roll back its entire revision and sequence history. SQLite transactional atomicity is **not privileged rollback resistance**.

## Code and precise trust boundary

`experiments/externally-witnessed-sqlite-authority-lab.mjs` adds an OFFLINE wrapper for the PR #77 test authority. An independent host test harness must inject a previously commissioned witness capability with `read()` and `compareAndAdvance(expected,next)`. For both `attest` and `revoke`, the wrapper:

1. Reads the SQLite device cursor (identity, epoch, enabled state, last issued sequence/digest, revision) and externally supplied witness. If either is missing, malformed or **not identical**, fail closed.
2. Invokes the original PR #77 SQLite authority transaction. Its existing `BEGIN IMMEDIATE` still commits synthetic confirmation, signer issuance and revocation atomically **within this one SQLite DB**.
3. Rechecks the DB state for exactly one appropriate transition: an attestation advances sequence and revision by one; revocation disables the device and advances revision without advancing sequence.
4. Invokes witness monotonic compare-and-swap, then re-reads the witness; only returns a synthetic signature after the witness matches the committed SQLite state.
5. **Never** invents lost history, auto-resets the witness, rewinds an already committed issuer cursor or permits production publish, ACK, alerts, real gates or physical safety clearance.

The wrapper offers **no network, Firebase read/write, real keys or actuator API**. It cannot prevent direct bypass calls to the old SQLite authority, but such bypasses create a mismatch for future cooperating wrapper calls.

## Fault semantics

**The DB COMMIT and external witness CAS are two different commits.** They are not atomic across systems. A crash after SQLite COMMIT but before witness advance creates an ambiguous state: the SQLite cursor is ahead, the witness is behind, and all subsequent operations are refused. Do not automatically resolve that discrepancy. A crash after witness CAS but before response loses the reply, but both records are advanced and a retry is rejected by SQLite's issuer ledger.

The test suite uses an **in-memory synthetic witness**, intentionally **not** a trusted independent server or persistence mechanism. It also simulates restoring an older physical SQLite *test-file copy* after an issuance while the witness retains the newer sequence, showing that the mismatch is detected. Neither synthetic CAS nor `Object.freeze` proves independent custody, durability, authentic monotonic state, clock correctness, or recovery from an attacker who controls both domains.

Real production rollback resistance would require an independently administered persistent monotonic authority, protected keys and issuer permissions, durable authenticated CAS, a strict anti-rollback trust boundary, supervised incident recovery, outage/split-brain semantics and proof that the witness cannot be restored with the primary SQLite database. This PR delivers **only the consistency contract and its failure tests**, not a genuine production monotonic witness.

## Unresolved release gates

The real Firebase read-after-commit issuer, physical signed ESP8266 publisher, source calibration, secure key rotation, durable/atomic cross-service revocation, flash/OTA and brownout acceptance, authenticated alert delivery, and supervised Arduino UNO gate/alarm commissioning remain unverified or unimplemented. The original diagnostic `writeNew()` remains disabled.

New host tests and all pinned ESP8266, LittleFS, HTTPS ingress, Python backup evidence, website tests/lint/typecheck/build must pass **exact-head GitHub CI**. No real Firebase data, credentials or hardware are involved.

**DO NOT MERGE, DEPLOY, FLASH, PUBLISH, SEND ALERTS OR OPERATE GATES. PRODUCTION NO-GO.**
