// FloodGuard R2: OFFLINE/EMULATOR-ONLY public proof contract for independent
// water and rain observations. The signature authenticates the *report*
// against a separately configured test trust anchor, NOT physical measurements.
// Not a firmware signer, trusted ingress service, cloud SDK, or browser helper.
import {KeyObject, verify} from 'node:crypto';
import {classifySourceBoundFreshness} from '../lib/telemetry-health.mjs';

const VERSION = 'floodguard-r2-public-proof-lab-v1';
const EARLIEST_MS = Date.UTC(2000, 0, 1);
const PAYLOAD_FIELDS = [
  'version','stream','sourceAlias','epoch','sequence',
  'observedAtMs','receivedAtMs','sample'
];
const WATER_FIELDS = ['distanceCm','levelCm','reportedStatus'];
const RAIN_FIELDS = ['currentMm','dailyMm','reportedStatus'];
const WATER_STATUSES = new Set(['SAFE','WARNING','DANGER','SENSOR_ERROR']);
const RAIN_STATUSES = new Set([
  'NORMAL','HEAVY_RAIN','FLOOD_WARNING','EXTREME',
  'CRITICAL','SENSOR_ERROR','UNKNOWN'
]);
const ownRecord = value => value !== null && typeof value === 'object' &&
  !Array.isArray(value) &&
  (Object.getPrototypeOf(value) === Object.prototype ||
   Object.getPrototypeOf(value) === null);
const exact = (value, fields) => ownRecord(value) &&
  Object.keys(value).length === fields.length &&
  fields.every(field => Object.hasOwn(value, field));
const integer = (value, min, max) =>
  Number.isSafeInteger(value) && value >= min && value <= max;
const measure = (value, min, max) =>
  typeof value === 'number' && Number.isFinite(value) &&
  value >= min && value <= max;
const fail = reason => Object.freeze({accepted:false, reason});

export const R2_PUBLIC_PROOF_VERSION = VERSION;

/**
 * Strict canonical payload representation. Rejects all extra keys, unknown
 * sources, private identifiers, arbitrary text/commands and malformed values.
 * The caller signs the exact UTF-8 bytes returned here using an independently
 * provisioned, test-only Ed25519 signer.
 */
export function canonicalR2PublicEvidence(payload) {
  if (!exact(payload,PAYLOAD_FIELDS) ||
      payload.version !== VERSION ||
      (payload.stream !== 'water' && payload.stream !== 'rain') ||
      payload.sourceAlias !== (payload.stream === 'water'
        ? 'water-primary' : 'rain-primary') ||
      !integer(payload.epoch,1,10000) ||
      !integer(payload.sequence,1,2147483647) ||
      !integer(payload.observedAtMs,EARLIEST_MS,Number.MAX_SAFE_INTEGER) ||
      !integer(payload.receivedAtMs,EARLIEST_MS,Number.MAX_SAFE_INTEGER) ||
      payload.receivedAtMs < payload.observedAtMs)
    throw new TypeError('Invalid R2 public lab proof payload');

  const source=payload.sample;
  if (payload.stream === 'water') {
    if (!exact(source,WATER_FIELDS) ||
        !measure(source.distanceCm,0,25) ||
        !measure(source.levelCm,0,25) ||
        Math.abs(source.distanceCm + source.levelCm - 25) > 0.001 ||
        !WATER_STATUSES.has(source.reportedStatus))
      throw new TypeError('Invalid R2 water report');
  } else if (!exact(source,RAIN_FIELDS) ||
      !measure(source.currentMm,0,10000) ||
      !measure(source.dailyMm,0,10000) ||
      !RAIN_STATUSES.has(source.reportedStatus)) {
    throw new TypeError('Invalid R2 rain report');
  }

  // Canonical ordering is independent of insertion order of user JSON keys.
  const normalized={
    version:VERSION,stream:payload.stream,
    sourceAlias:payload.sourceAlias,epoch:payload.epoch,
    sequence:payload.sequence,observedAtMs:payload.observedAtMs,
    receivedAtMs:payload.receivedAtMs,
    sample:payload.stream==='water'
      ? {distanceCm:source.distanceCm,levelCm:source.levelCm,
        reportedStatus:source.reportedStatus}
      : {currentMm:source.currentMm,dailyMm:source.dailyMm,
        reportedStatus:source.reportedStatus}
  };
  const bytes=JSON.stringify(normalized);
  if (Buffer.byteLength(bytes,'utf8')>512)
    throw new TypeError('Oversized public lab proof payload');
  return bytes;
}

/**
 * "accepted" means the lab report is signed and recent, not that water/rain
 * are physically safe. Verified client keys must be pinned out of band,
 * never read from the same untrusted record. The prior in-memory frame is
 * OPTIONAL and never substitutes for durable server-side replay fencing.
 */
export function verifyR2PublicEvidence({
  stream,record,trustedPublicKey,connected=false,nowMs,prior=null
}={}) {
  if (stream!=='water' && stream!=='rain') return fail('stream-unrecognized');
  if (connected!==true || !integer(nowMs,EARLIEST_MS,Number.MAX_SAFE_INTEGER))
    return fail('observer-unavailable');
  if (!(trustedPublicKey instanceof KeyObject) ||
      trustedPublicKey.type!=='public' ||
      trustedPublicKey.asymmetricKeyType!=='ed25519')
    return fail('trusted-signer-unavailable');
  if (!exact(record,['payload','signature']) ||
      !record.payload || record.payload.stream!==stream ||
      typeof record.signature!=='string' ||
      !/^[A-Za-z0-9_-]{86}$/.test(record.signature))
    return fail('evidence-shape-invalid');
  let bytes;
  try { bytes=canonicalR2PublicEvidence(record.payload); }
  catch { return fail('evidence-shape-invalid'); }

  const signature=Buffer.from(record.signature,'base64url');
  if (signature.length!==64 ||
      !verify(null,Buffer.from(bytes,'utf8'),trustedPublicKey,signature))
    return fail('signature-unverified');

  const p=record.payload;
  const observation={
    stream,sourceId:p.sourceAlias,epoch:p.epoch,sequence:p.sequence,
    observedAt:p.observedAtMs,receivedAt:p.receivedAtMs
  };
  const previous=prior===null ? null : (
    exact(prior,['sourceAlias','epoch','sequence','observedAtMs','receivedAtMs'])
      ? {sourceId:prior.sourceAlias,epoch:prior.epoch,
        sequence:prior.sequence,observedAt:prior.observedAtMs,
        receivedAt:prior.receivedAtMs}
      : {sourceId:'invalid-prior'} // fail closed
  );
  if (classifySourceBoundFreshness({
    stream,observation,prior:previous,
    loading:false,hasData:true,connected:true,error:false,nowMs
  })!=='live')
    return fail('source-not-current');
  return Object.freeze({
    accepted:true,stream,
    evidence:'FRESH_SIGNED_REPORT_NOT_PHYSICAL_PROOF'
  });
}
