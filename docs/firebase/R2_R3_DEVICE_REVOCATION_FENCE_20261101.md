# FloodGuard R2/R3 — Same-root device-source revocation fence (1 November 2026)

**Research-only, isolated Firebase RTDB Emulator rules and synthetic Auth roles. NO PRODUCTION DEPLOYMENT, NO REAL ESP8266 KEY, NO FIRMWARE FLASH, NO GATE ACTION, NO QUEUE ACK. Release NO-GO.**

## Why this stage exists

[PR #48](https://github.com/teldigi5-wq/floodguard-website/pull/48), exact verified commit `f2dd551a9e91099c9047034c8881b7050ab27046`, proved that the test publisher's own token lease can be revoked within the same publication transaction. However, the signing *sensor* was still authenticated using an externally injected source binding that could be disabled outside the transaction, allowing an authorization race.

This stage creates a separate `/floodguardPublicationLabV4` capsule containing the existing private publisher authority, a new **owner-provisioned device authority**, public scalar telemetry, private signed receipt history, and publication checkpoint:

```text
/floodguardPublicationLabV4/
  authority/                     existing publisher lease and enabled flag
  device/
    deviceId                     device-stage-a (synthetic)
    epoch                        1 (synthetic)
    enabled                      independently revocable by operator
    sourceKeyFingerprint         SHA-256 of Ed25519 SPKI public key
  public/water/                  distanceCm, levelCm, status — approved primitives
  public/system/                 lastUpdate, overallRisk UNKNOWN — approved primitives
  checkpoint/                    source epoch + high-water sequence and digest
  history/                       signed server receipt for each bounded reading
/floodguard/                     old credential/IP/network tree: denied to publisher
```

## Code and database enforcement

- `experiments/device-revocation-fence-lab.mjs` wraps PR #48's signed source/issuer verifier and reducer. It checks **the current device.enabled, device ID, epoch and fingerprint of the actual verified Ed25519 source key** before proposing publication. The resulting candidate preserves the device record unchanged. Its read-only observer refuses positive proof after device revocation, and never allows outbox acknowledgment, deletion or physical flood clearance.
- `tests/fixtures/device-revocation-fence-lab.rules.json` uses **real authenticated RTDB Emulator client Rules**. The publisher's transaction `.write` requires the *old* same-root device.enabled=true and an unchanged device record in `newData`, along with the existing publisher lease/epoch. A separate test operator can change `device/enabled` from true to false, never back, but cannot change source key, epoch, telemetry, receipt history or publisher lease. The publisher cannot delete the device/root, un-revoke, or rewrite pinned key. A prepared stale snapshot cannot override the revoked value.
- Individual anonymous public telemetry reads now also require device.enabled=true. After revocation a fresh API read fails rather than returning a historical SAFE as current. **This does not clear client caches, push an offline alert, or prevent previously displayed SAFE from remaining visible**. UI and notification stale/offline fail-safe handling is still required.
- With the current one-device capsule the operator's revocation is monotonic and one-way. Device rotation/recommission must be an independently approved migration, not a hidden toggle. Source/issuer keys are test-generated; no real key material is placed in firmware or GitHub.

## Test and review gates

The new Emulator tests build on PR #48's operator/publisher isolation and verify signed publication, cached publisher-token denial after operator publisher revocation, operator irreversibility, private legacy tree denial, invalid claims/leases/epochs, signed record retention, strict public primitive validation and zero outbox ACK. Additional tests verify:

- independently revoking a device **while the publisher lease stays enabled**, preserving historical readings but denying a new publisher write;
- a precomputed signed transaction candidate being rejected after committed device revocation;
- publisher unable to mutate device epoch, ID, fingerprint, enabled flag or remove the root;
- operator unable to mutate source binding/key or publish, with one-way device disable;
- guest reads of `SAFE` being blocked once the device is revoked;
- wrong source Ed25519 key / epoch against an otherwise current publisher lease;
- a previously signed/recorded reading no longer being presented as currently authorized after device revocation.

CI additionally runs the prior 32 signed-outbox/history/witness tests, the new real RTDB Rules tests and full site tests/lint/typecheck/build. **Only exact-head CI evidence qualifies as a verified lab checkpoint.**

## Explicit production blockers

This architecture makes *only the test capsule's recorded device enabled/epoch/key fingerprint* atomic with its publication under Firebase Rules. It **does not** guarantee consistency with any external source registry or actual ESP device provisioning. A privileged Firebase Admin writer can still bypass client Rules, and a compromised publisher with an active lease can corrupt other private capsule values despite pinned device fields. This is *not* independent durable receipt issuance, immutable audit evidence, safe notification delivery or proof of physical sensor/gate safety. The eight-record research queue cannot run indefinitely.

Before any release: owner-approved device identity provisioning, cert-verified ESP8266 TLS, controlled key rotation, independent receipt/witness custody, sustainable signed event retention and crash-consistent ACK, stale/offline warning UI and supervised Arduino/buzzer/servo/manual override tests. Keep user-deployed anonymous `/floodguard/live` lockdown in place.

**All stacked PRs remain draft and unmerged. No merge, production rules change, deployment, SMS/WhatsApp message, firmware flash, or gate action.**
