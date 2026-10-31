# R2: local fsync-backed operator-anchor journal — recovery laboratory

**Scope: local filesystem only, synthetic keys, NO real database writes or production authorization.** This extends the signed catch-up approval work in draft PR #24. It does not replace the previous Stage 7/8 ledgers, does not publish sensor readings, and does not connect to Firebase or hardware.

## Checkpoint and trust model

The dedicated `r2-local-anchor-journal-lab.mjs` stores the latest **independently signed** operator anchors for water and rain, plus a generation number, in one HMAC-SHA256 sealed local file. It requires an **explicit absolute 0700 test directory**, caller-injected 32-byte or longer test MAC key, and **eight independent pinned Ed25519 public keys** (four report/receipt/anchor/approval roles for each stream). Private keys are never passed to the journal or persisted in it.

An explicit `initialize` requires matching signed public reports and independently signed operator anchors for **both** streams at the same time. There is no implicit reinitialization during normal reads/writes and no empty-state fallback on missing or corrupt files.

`advance` requires the previously stored signed anchor to be exactly one sequence behind a separately authenticated published report, a matching independently signed server receipt, a unique signed operator catch-up approval, **and a replacement operator-signed anchor** bound to the reported next state. It refuses incorrect issuer, mismatched digest, skipped sequence, forged approval, forged receipt, or replayed advance.

## Filesystem durability rehearsal

The module uses an exclusive local lock file (`wx`, mode 0600). A crash-left lock is **never removed automatically**. The journal is read with `O_NOFOLLOW` when supported; only regular private files are allowed. Every read checks HMAC integrity and the stream-specific anchor signatures. A validated update writes a new private temporary file, fsyncs it, renames it over the journal and fsyncs the containing directory. Subsequent independent journal instances can read the same signed persisted checkpoint.

If an IO error occurs after an atomic rename, callers must treat commit outcome as **unknown** and reconcile by reopening the checkpoint; an exception does not prove a rollback. Local locks provide process coordination only on a trusted local filesystem, not distributed fencing.

The test suite deliberately restores a **previous, still valid HMAC-sealed file** after advancing the water anchor. The local journal then sees the earlier generation as valid. This proves a crucial boundary: **disk persistence and an HMAC do not provide nonrollback**. An independent monotonic witness, hardware-backed or externally verifiable history, auditable restore policy and disaster-recovery proof are required before a genuine production claim.

## Explicit test-only recipe

```sh
FG_R2_LOCAL_JOURNAL_LAB_TEST=1 node --test tests/r2-local-anchor-journal-lab.test.mjs
node --test tests/r2-operator-catchup-lab.test.mjs
npm test
```

The new tests use fresh temporary directories and ephemeral signers. They cover bootstrap refusal and permissions, water/rain checkpoint advancement after a new journal instance opens the file, replayed operator approval, forged anchors, wrong signers, HMAC tampering, stale lock rejection, missing file fail-closed, and the **valid old-file rollback weakness**.

## Remaining release blockers

- This is not an independent service, nonrollback store, trusted hardware counter or distributed consensus protocol. Loss of the journal and separately managed backups, privileged restore of earlier valid journal snapshots, or compromise of the signing authorities can defeat the contract.
- This journal is **not atomic with Firebase publication** and has no cross-host lease/fencing or transaction outbox. Reader freshness, real source identity, actual physical sensing, alert delivery and client cutover remain unverified.
- A real publisher must not be given operator signing keys; production key enrollment, key rotation, approval audit logs, access controls, disaster recovery and validation of firmware clocks need separate design and test evidence.
- Do not deploy the experiment, merge protected main, alter existing Firebase rules or declare the release ready based on local CI.

**Stage R2 remains PARTIAL; FloodGuard release remains NO-GO.**
