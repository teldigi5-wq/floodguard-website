# FloodGuard — Publisher lease/revocation fence (isolated V3 lab, 2026-11-01)

**Draft only. RTDB Emulator and synthetic Auth context. No Firebase production rules, actual token issuer, real firmware, live client, outgoing warning, ACK/dequeue, or physical gate operation. NO-GO.**

## Exact base and purpose

Based on [PR #47](https://github.com/teldigi5-wq/floodguard-website/pull/47), head `84e4edc8516293b11b433b2d0fc91148a23f6ea1`, which proved that a publisher restricted by RTDB Rules to a separate capsule can transact without Admin bypass, and cannot read/write legacy Wi-Fi/IP/device authorization.

**Remaining gap:** V2 publisher identity and source authorization could be revoked in an external domain while the RTDB publication transaction was in flight. A cached snapshot and previously minted publisher token alone cannot prove current authority.

## Proposed operator-controlled V3 capsule

```text
/floodguardPublicationLabV3/
  authority/                         private, owner-provisioned
    deviceId
    epoch
    enabled                           operator may change true -> false only
    leaseId                           operator-held claim, synthetic
    receiptSignerFingerprint
  public/water|system/                primitive leaf reads only
  checkpoint/                         private source sequence/digest
  history/                            private signed per-sequence receipts
/floodguard/                          remains inaccessible to V3 publisher
```

`experiments/publisher-revocation-fence-lab.mjs` builds on PR #47's signed device/source/receipt and strict scalar publication candidate. It requires current in-capsule enabled authority, the matching device/epoch, a pinned server receipt signer and an exact lease identifier, and **preserves the authority object unchanged** in each proposed transaction. No external network access, private signing key, admin SDK, physical actuation or journal ACK.

**RTDB Rules, independently of the reducer**, grant publisher reads/writes at this capsule only when all token claims match the *current stored authority*: exact synthetic UID, `fgCapsulePublisher=true`, `fgLeaseId` and `fgPublisherEpoch`, with `enabled=true`. The publisher's `.write` condition demands an existing nonempty capsule, requires the new stored authority fields to equal the current values, and rejects missing required children. The separate operator Auth identity `operator-stage-a` with `fgCapsuleOperator=true` has one capability: write `authority/enabled` from `true` to `false`, never back. The operator cannot write public telemetry, publish receipts or change the lease.

The issuer's lease/epoch changes are synthetic fixture operations only; a real issuer, MFA, operator approvals, per-environment secret custody and independent revocation event audit are not implemented.

## Emulator acceptance and truth boundaries

- **A successful authenticated publisher transaction without admin permission**, with unchanged private authority and one retained signed outbox frame.
- **Operator revocation of an already-issued publisher lease**, followed by failed reads and writes from the same signed-in publisher. An already-prepared candidate computed before revocation must not overwrite the operator's new state.
- **Non-reversible revoke**, restricted operator role, old epoch / old lease / impersonated UID / missing claim refusal.
- Publisher cannot remove capsule root, erase/change lease authority, write legacy source/credential records, inject nested object-valued public fields or set invalid ranges/enums.
- Valid published histories remain retained; the outbox is never ACKed or deleted. Full website tests/lint/typecheck/build and previous signed journal/witness suites remain required.

## Important limitations

1. **No independent source revocation fence yet.** The authority only fences the *publisher lease* with an RTDB Rules check at commit. The real device's binding, remote signed-receipt confirmation and operator authority source remain separately provisioned/test-synthetic. This does not guarantee cross-domain source revocation atomicity.
2. **No production issuer/role grants.** Test Auth claims can be forged by the unit-test harness; a real service needs robust token issuance, rotation, audit and out-of-band revocation storage. In production Admin SDK bypasses Rules, so privileged writers must be excluded from this path by architecture and IAM.
3. **No anti-tamper guarantee from a publisher.** Firebase `.write` controls the authority fields and `.validate` rejects nested/unknown public values, but an authorized publisher can still corrupt checkpoint/history unless a separate audited issuer/witness and genuine immutable store is introduced. A malicious privileged Admin can bypass all RTDB client rules.
4. **No real flood safety proof.** Reported `SAFE` does not certify measured water condition, gate position or successful warning delivery. The archived ESP8266 anonymous uploader with insecure TLS remains disconnected.
5. **No sustainable queue operation.** The inherited eight-entry history limit and no ACK/compaction imply the prototype is not production-capable. Physical/sensor/human acceptance, mobile/website/WhatsApp read migration, alert delivery verification and durable retry remain pending.

**Keep all PRs draft/unmerged; do not deploy test rules, reopen `/floodguard/live` anonymous access, connect insecure firmware or actuate a gate. Exact-head CI must be green before accepting the lab checkpoint.**
