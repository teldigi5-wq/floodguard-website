# R2 — Loopback HTTPS → sealed signed admission (2026-11-01)

**Review-only, synthetic hardware identity and loopback TLS. No Firebase production, public listener, sensor hardware, gate, mobile/WhatsApp, or deployment work. NO-GO.**

## Exact baseline

This development is stacked onto [PR #40](https://github.com/teldigi5-wq/floodguard-website/pull/40), head `b3da7d950c93e97726f26ffe14337a2fc4380d1b`, which has 11/11 new journal tests and exact-head CI pass. Existing Stage 7 localhost HTTPS signed admission was tested earlier but only retained replay sequence/key/epoch — not the complete signed sensor frame. PR #40 created an isolated sealed outbox alternative but did not integrate it into TLS.

## This reviewable change

The existing `experiments/loopback-signed-https-ingress.mjs` now accepts an optional, explicit **`admissionJournal`**. The old `ledger` mode is unchanged by default and retains the existing bootstrap-ledger identity check. **Using both `ledger` and `admissionJournal` is rejected**; no hidden double commit or automatic migration from existing replay history.

In journal mode, the handler still validates actual loopback TLS socket identity, request method/path/media type, bounded payload size and read deadline, canonical Stage 7 envelope, enabled scoped identity/epoch, read-to-commit freshness and Ed25519 device signature. It separately checks operator-provided readiness both **before and after** reading the body.

After this validation, the durable outbox re-reads identity and source freshness under its local lock, verifies the signature again, atomically stores the complete signed frame/signature/sequence/digest and fsyncs the journal and directory before the handler returns **201 LOCAL_DURABLE_ADMISSION_ONLY**. Unlike the old Stage 7 ledger, the new journal can recover the accepted source payload on restart. A duplicate sequence returns 409; missing, corrupt or full history returns 503; an invalid/unauthorized signature returns denied status. **A local HTTP 201 proves neither cloud publication nor human alert delivery.**

## Fail-closed commissioning marker

The original journal could reject missing history on `accept` but permitted a manual `commission()` call after its entire state file was deleted. To prevent accidental recreation of a fresh replay counter in the same local directory, this revision writes a separately HMAC-sealed, owner-only **commission marker first** and fsyncs it before writing the initial state. The journal now refuses to read/admit without the original valid marker, and `commission()` fails if either the marker or journal already exists.

A crash after the marker is durable but before the state is created intentionally leaves an unrecoverable-by-default **fail-closed** partial commission. Journal loss with marker intact cannot recommission. **Limits:** Both files live in the same trust domain. Full filesystem rollback or deletion of *both* marker and journal, together with HMAC key compromise, is not prevented by this prototype; production requires an independently stored commissioning/epoch counter, authorization and recovery policy. Local locking cannot atomically fence a concurrently revoked operator registry.

## Verification evidence and remaining blockers

`tests/loopback-durable-outbox-ingress.test.mjs` exercises ephemeral localhost HTTPS with a validating CA/hostname (never `rejectUnauthorized:false`), correct signed acceptance and reboot, duplicate/revoked/malformed/old messages, readiness loss, journal deletion/seal corruption, bounded queue, invalid route and media type, revocation while a streaming request is incomplete, and invalid dual-mode configuration. Additional PR #40 journal tests now cover missing/corrupted commissioned markers. CI also runs the unmodified legacy TLS tests and full website tests/lint/typecheck/build.

**The exact-head GitHub CI result is required before accepting this stage. No real ESP8266 upload or connected Firebase publication has been performed.** The operator-published Firebase lockdown must remain until authenticated and test-proven replacement and supervised hardware cutover.

## Next work

1. Independently anchor operator commissioning and identity/revocation/epoch state outside the local journal. Real device credentials and certificate-verified firmware are not commissioned.
2. Add a single-authority, crash-safe signed admission to independently persisted DB confirmation and atomic scalar publisher. A confirmed cloud checkpoint must be required before the outbox can be pruned; an unknown commit result is NOT a negative acknowledgment.
3. Exercise crash points between local 201, durable DB confirmation, public-leaf update and client alert delivery in a disposable emulator. Refuse false SAFE/verified physical gate status.
4. Preview website/Flutter/WhatsApp secure read paths and test stale/denied/offline data. Supervise actual alarm, gate, sensor error and manual override acceptance before any live restoration.

**No merge, production rules changes, hardware flash or activation is authorized in this draft.**
