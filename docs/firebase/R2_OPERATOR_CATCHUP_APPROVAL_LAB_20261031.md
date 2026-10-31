# FloodGuard R2 — operator-signed catch-up after uncertain acknowledgement

**Scope: synthetic, isolated Firebase Emulator experiment only.** This research is stacked on PR #23 → #22 → #21 → #20 → #18 → #14, all still draft/unmerged. It is not a deployed trusted recovery service.

## Failure mode

A scoped publisher may write a valid signed reading to Firebase and then crash before a separately operated high-water checkpoint is signed and retained. After restart, the database contains sequence N+1 while the independently signed operator anchor still represents N. The previous PR #23 correctly rejected further publications with `published-ahead-of-anchor-reconcile`, but it did not provide a narrowly scoped, auditable reconciliation proof shape.

The new `r2-operator-catchup-lab.mjs` defines an **operator-signed catch-up approval**, covering protocol version, exact stream/source/epoch, previous anchor sequence and SHA-256 anchor digest, new sequence and SHA-256 signed report payload digest, SHA-256 of the independently signed server acceptance receipt, and approval timestamp. Canonical ordering is fixed. Approval is limited to **exactly one sequence advancement**.

### Verification gates

The read-only `reviewR2OperatorCatchup` requires:

- Four distinct out-of-band trusted Ed25519 public keys: **sensor report signer, server receipt issuer, previously signed recovery-anchor issuer, operator catch-up approver**. Keys in RTDB are not trust roots.
- An authenticated signed previous anchor and authenticated signed published report whose sequences explicitly disagree as `published-ahead-of-anchor-reconcile`.
- A valid independently signed server receipt that refers to **the exact published report**, including its hash, source/epoch/sequence and acceptance timestamp.
- An exact one-step increase from anchored sequence N to published sequence N+1; sequence gaps and unauthorized epoch changes remain blocked.
- A separately signed operator approval bound to the exact old anchor, new report, signed receipt and approval time. Swapped signatures, forged digests, reused approvals and altered stream identities fail closed.

A successful review returns `OFFLINE_SIGNED_CATCHUP_PROPOSAL_NOT_PERSISTED` with a **proposed unsigned replacement anchor**, along with `requiresIndependentAnchorSigning:true`. It NEVER signs or writes that anchor, updates an RTDB counter, changes a device identity, or automatically retries a failed publication. The external operator must independently evaluate the evidence, sign and persist the next anchor under a monotonic storage policy. This code has no filesystem/network/admin SDK.

## Lab acceptance

Pure Node unit tests and local Firebase RTDB emulator tests rehearse both water and rain missing-anchor-advance outcomes, forged approvals, forged receipts, unchanged private Firebase fields, and a restored database that is older than its external anchor. Existing recovery, signed receipt and full application regression suites are also run.

Example commands:

```sh
npm ci --ignore-scripts
npm install --no-save --package-lock=false --ignore-scripts @firebase/rules-unit-testing@5.0.2
node --test tests/r2-operator-catchup-lab.test.mjs
npx --yes firebase-tools@14.18.0 emulators:exec --only database \
  --project demo-fg-r2-attested --config firebase.r2-dual-stream-lab.json \
  "FG_R2_ATTESTED_PUBLISHER_LAB_TEST=1 FG_R2_RECOVERY_ANCHOR_LAB_TEST=1 node --test tests/r2-attested-dual-stream-publisher-emulator.mjs"
```

### Explicit unresolved production risks

**Signatures are not durability.** No independent nonrollback store or operator signing application exists. An attacker who restores both RTDB and the independent anchor, compromises the operator approval signer, or controls privileged concurrent writes may bypass these in-memory demonstrations. Receipt signature authenticity does not prove external payment/alert/hardware operation or actual physical sensor accuracy. The preflight read and RTDB publication are not atomic with operator-anchor persistence: an external consistency protocol, approval retention, failover/migration evidence, and an audited identity/key lifecycle are required.

The test fixture generates all signing keys. There are no embedded secrets, and no credentials are enrolled. Production Firebase rules, web/Flutter/bot providers, Vercel releases, physical hardware and WhatsApp delivery are not touched.

**R2 remains PARTIAL and FloodGuard remains NO-GO for production.**
