# R3-D2b prerequisite — fsync-backed local signed witness (research lab)

**Draft only. Local disk durability is not an independent nonrollback witness.** This stage is stacked on PR #29 → #28 → #27 → #26 → #25 → #24 → #23 → #22 → #21 → #20 → #18 → #14. Protected main, production Firebase, live monitoring, Flutter, WhatsApp alerts, ESP8266 firmware and hardware gate remain untouched.

## What changed

The former R3-D2a witness was a separate **in-memory** synthetic authority. This work implements an isolated **local filesystem-backed** signed journal adapter with exactly the `readSigned(stream)` and `compareAndSwap({stream,expectedCheckpoint,nextCheckpoint})` signatures required by the earlier V2 reconciliation coordinator.

- Requires an **absolute, private 0700 existing directory**, explicit lab opt-in, separate pinned Ed25519 public keys for the water and rain witness roles, and an injected test-only signing function. No private keys are accepted in publish/CAS requests; the module has no Firebase SDK or network listener. Production identity, key custody and signer isolation remain unimplemented.
- **Explicit dual-signed bootstrap only.** The operator supplies signed V2 genesis checkpoints for water and rain. Neither missing nor corrupt journal data is automatically treated as empty, and an existing file (including a dangling symlink) cannot be overwritten by initialize.
- Journal contains sequential JSON records with **hash chaining**, verified Ed25519 witness signatures and deterministic one-step monotonic checkpoint sequence checks for each stream. Private 0600 regular files are required; hardlinked files and symlink opens are denied when supported.
- Each CAS checks the exact expected signed checkpoint under a **cross-process OS-exclusive `O_EXCL` lock**, independently signs the new checkpoint, appends one journal record and calls `fsync`. Genesis creation also fsyncs the directory. A crash-left lock is never silently cleared; operator intervention is required.
- A new process can independently reopen and revalidate the file using **public keys only**. No private signer key is transferred to the reader subprocess. No automatic repair, concurrent replay, journal truncation recovery or authorization bypass is performed.
- Fault injection tests distinguish failure **before write** from an exception **after fsync**: after-fsync outcomes are treated as ambiguous, and reconciliation must inspect the saved signed state. A partially appended/torn journal fails closed; it is not silently shortened to the last newline.

## What remains unproven

- This is **single-host local crash persistence**, contingent on filesystem/hardware behavior. It does not ensure storage survives host loss or physical tampering. There is no audited remote object store, quorum, HSM/TPM monotonic counter, independently verified audit anchor or distributed fencing.
- Hash chaining and Ed25519 signing cannot detect **a privileged replacement with an earlier complete valid journal**. A negative test restores a valid earlier journal and proves the read accepts it; combined Firebase and journal rollback remains undetectable.
- An exclusive local lock coordinates writers on one filesystem. It is not a multi-host lease, monotonic fencing token or distributed lock. Stale locks deliberately block all operations until a supervised recovery.
- An append can succeed while its acknowledgement is lost. The caller must inspect the journal before any recovery or retry. There is no transaction atomicity between Firebase and the local journal.
- Witness signer is an injected **same-process test capability**. Real production would require separate service identity and authenticated RPC, least-privilege IAM, external signer protection and revocation, independently monotonic durable storage, rotation, malicious-host and disaster-recovery drills, and independent failure-domain analysis.
- V2 operator-approved recovery is **not yet implemented**. The system deliberately stops when RTDB is ahead, behind or inconsistent with the signed local checkpoint.
- Neither these tests nor the existing R3 lab prove real sensor calibration, flood safety, alarm delivery, browser compatibility, Flutter/native QA, gate operation, or production deployment.

## Reproduction

```sh
npm ci --ignore-scripts --no-audit --no-fund
node --test tests/r3-v2-fsync-disk-witness-lab.test.mjs
npm install --no-save --package-lock=false --ignore-scripts @firebase/rules-unit-testing@5.0.2
npx --yes firebase-tools@14.18.0 emulators:exec --only database \
  --project demo-fg-r3-v2-disk-witness --config firebase.r3-v2-admission-lab.json \
  "FG_R3_DISK_WITNESS_LAB_TEST=1 FG_R3_V2_ADMISSION_LAB_TEST=1 FG_R3_WITNESS_RECONCILIATION_LAB_TEST=1 node --test tests/r3-v2-fsync-disk-witness-emulator.mjs"
```

The isolated emulator suite demonstrates verified water/rain publication plus fsync-backed signed CAS, privileged Firebase restoration behind the witness, witness write failure after Firebase commit, and a deliberate joint restore of the two individually valid older authorities.

**Track: R3-D2b local durability prerequisite only; external rollback-resistant authority NOT IMPLEMENTED; overall production NO-GO.**
