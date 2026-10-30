// R2: read-only reconciliation of ONE synthetic, already-published water frame.
// Never import into a browser or production runtime. Does not read or write RTDB,
// authenticate hardware, grant client access to private receipt records, or
// establish durable provenance of an externally supplied root snapshot.
import {createHash, KeyObject} from 'node:crypto';
import {canonicalOfflineEnvelope} from './stage7-durable-ingress.mjs';
import {verifyStage8OfflineReceipt} from './stage8-ack-reconciliation.mjs';
import {classifySourceBoundFreshness} from '../lib/telemetry-health.mjs';

const isRecord = value => value !== null && typeof value === 'object' &&
  !Array.isArray(value) && (Object.getPrototypeOf(value) === Object.prototype ||
    Object.getPrototypeOf(value) === null);
const exact = (value, keys) => isRecord(value) &&
  Object.keys(value).length === keys.length &&
  keys.every(key => Object.hasOwn(value, key));
const deny = reason => Object.freeze({
  accepted: false, freshness: 'stale', reason
});
const FRAME_FIELDS = ['sequence', 'distanceCm', 'levelCm', 'risk'];
const CONFIRMATION_FIELDS = [
  'deviceId', 'epoch', 'sequence', 'digest', 'acceptedAtMs', 'status'
];
const AUTHORITY_FIELDS = [
  'deviceId', 'epoch', 'enabled', 'scope', 'receiptSignerFingerprint'
];
const CONTROL_FIELDS = ['initialized', 'epoch', 'sequence', 'digest'];

/**
 * Inspect a snapshot acquired ONLY by an independently authorized, trusted,
 * emulator-only observer. All arguments are test inputs, not an API credential
 * or a production attestation. The returned "live" describes lab freshness
 * of matched evidence, NOT independently verified physical sensor health.
 */
export function inspectSyntheticWaterReceipt({
  snapshot, envelope, receipt, signature, trustedReceiptKey,
  nowMs, connected = false
} = {}) {
  try {
    if (!Number.isSafeInteger(nowMs) || nowMs < 0 ||
        !isRecord(snapshot) || !isRecord(envelope) ||
        !isRecord(receipt) || connected !== true)
      return deny('trusted-snapshot-unavailable');
    if (!(trustedReceiptKey instanceof KeyObject) ||
        trustedReceiptKey.type !== 'public' ||
        trustedReceiptKey.asymmetricKeyType !== 'ed25519')
      return deny('receipt-signer-unavailable');

    const bytes = canonicalOfflineEnvelope(envelope);
    const digest = createHash('sha256').update(bytes, 'utf8').digest('hex');
    const deviceId = envelope.deviceId;
    const authority = snapshot.projectionControl?.waterAuthority;
    const binding = snapshot.deviceAuthorization?.[deviceId];
    const checkpoint = snapshot.projectionControl?.devices?.[deviceId];
    const staged = snapshot.staging?.ingestV1?.[deviceId];
    const confirmed = snapshot.confirmedIngest?.[deviceId];

    const signerFingerprint = createHash('sha256').update(
      trustedReceiptKey.export({format: 'der', type: 'spki'})
    ).digest('hex');
    if (!exact(authority, AUTHORITY_FIELDS) ||
        authority.deviceId !== deviceId ||
        authority.epoch !== envelope.epoch ||
        authority.enabled !== true ||
        authority.scope !== 'water-primary' ||
        authority.receiptSignerFingerprint !== signerFingerprint ||
        !exact(binding, ['enabled', 'scope']) ||
        binding.enabled !== true ||
        binding.scope !== 'prototype-ingest-v1')
      return deny('source-authority-unverified');

    if (!verifyStage8OfflineReceipt({
      receipt, signature, publicKey: trustedReceiptKey,
      expected: {
        deviceId, epoch: envelope.epoch,
        sequence: envelope.frame.sequence, digest
      }
    }))
      return deny('receipt-signature-unverified');

    // A signed server receipt cannot causally predate the observed frame.
    // The generic display helper allows small transport clock skew, but
    // privileged publisher evidence already requires stricter ordering.
    if (receipt.acceptedAtMs < envelope.observedAtMs)
      return deny('receipt-time-order-invalid');

    if (!exact(confirmed, CONFIRMATION_FIELDS) ||
        confirmed.deviceId !== deviceId ||
        confirmed.epoch !== envelope.epoch ||
        confirmed.sequence !== envelope.frame.sequence ||
        confirmed.digest !== digest ||
        confirmed.acceptedAtMs !== receipt.acceptedAtMs ||
        confirmed.status !== 'DATABASE_CONFIRMED' ||
        !exact(staged, FRAME_FIELDS) ||
        FRAME_FIELDS.some(key => staged[key] !== envelope.frame[key]))
      return deny('source-confirmation-unverified');

    if (!exact(checkpoint, CONTROL_FIELDS) ||
        checkpoint.initialized !== true ||
        checkpoint.epoch !== envelope.epoch ||
        checkpoint.sequence !== envelope.frame.sequence ||
        checkpoint.digest !== digest)
      return deny('publication-checkpoint-mismatch');

    const water = snapshot.live?.water;
    const system = snapshot.live?.system;
    if (!isRecord(water) || !isRecord(system) ||
        water.distanceCm !== envelope.frame.distanceCm ||
        water.levelCm !== envelope.frame.levelCm ||
        water.status !== envelope.frame.risk ||
        system.lastUpdate !== envelope.observedAtMs ||
        system.overallRisk !== 'UNKNOWN')
      return deny('public-observation-mismatch');

    // A newer unrelated system heartbeat invalidates, never freshens, this
    // matched water frame. A separate authenticated per-source public schema
    // is still required before real client integration.
    const freshness = classifySourceBoundFreshness({
      loading: false, hasData: true, connected: true, error: false,
      stream: 'water',
      observation: {
        stream: 'water', sourceId: deviceId,
        epoch: envelope.epoch, sequence: envelope.frame.sequence,
        observedAt: envelope.observedAtMs, receivedAt: receipt.acceptedAtMs
      },
      nowMs
    });
    if (freshness !== 'live') return deny('signed-observation-not-current');
    return Object.freeze({
      accepted: true, freshness: 'live',
      kind: 'OFFLINE_SIGNED_WATER_EVIDENCE_NOT_PRODUCTION'
    });
  } catch {
    return deny('invalid-receipt-evidence');
  }
}
