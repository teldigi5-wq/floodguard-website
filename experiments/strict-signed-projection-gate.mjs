// FloodGuard strictly offline signed-to-public projection PLANNER.
// NO Firebase client, service account, network, file IO, real credentials,
// gates, WhatsApp, or actual mutation. Only synthetic unit-test usage.
// A planner output is NEVER proof that data reached a database or a person.
import {createHash} from 'node:crypto';
import {canonicalOfflineEnvelope} from './stage7-durable-ingress.mjs';
import {verifyStage8OfflineReceipt} from './stage8-ack-reconciliation.mjs';

const DEVICE=/^device-stage-[a-z0-9-]{1,32}$/;
const DIGEST=/^[0-9a-f]{64}$/;
const MAX_AGE_MS=30000;
const FUTURE_SKEW_MS=2000;
const isRecord=x=>x!==null&&typeof x==='object'&&!Array.isArray(x)
  && (Object.getPrototypeOf(x)===Object.prototype||Object.getPrototypeOf(x)===null);
const exact=(v,keys)=>isRecord(v)&&Object.keys(v).length===keys.length
  && keys.every(k=>Object.hasOwn(v,k));
const number=(x,lower,upper)=>Number.isSafeInteger(x)&&x>=lower&&x<=upper;
const reject=reason=>Object.freeze({allowed:false,reason});
// The only allowlisted projected paths, and no parent, private, gate or
// actuator path. The system-level OVERALL risk remains UNKNOWN because a
// water-only device frame cannot establish rain or physical flood safety.
export const STRICT_SYNTHETIC_PUBLIC_PATHS=Object.freeze([
  'water/distanceCm','water/levelCm','water/status',
  'system/lastUpdate','system/overallRisk'
]);

export function planStrictSyntheticPublicProjection({
  envelope, receipt, signature, trustedReceiptKey, registryBinding,
  databaseRecord, lastPublished, nowMs
}={}) {
  try {
    // Fail closed when a restart cannot prove the last published sequence.
    if (!exact(lastPublished,['initialized']) && !exact(lastPublished,['initialized','epoch','sequence','digest']))
      return reject('publication-state-unavailable');
    if (lastPublished.initialized !== true && lastPublished.initialized !== false)
      return reject('publication-state-unavailable');
    if (lastPublished.initialized===true &&
      (!number(lastPublished.epoch,1,10000)||
       !number(lastPublished.sequence,1,2147483647)||
       typeof lastPublished.digest!=='string'||!DIGEST.test(lastPublished.digest)))
      return reject('publication-state-unavailable');
    if (lastPublished.initialized===false && Object.keys(lastPublished).length!==1)
      return reject('publication-state-unavailable');

    if (!number(nowMs,0,Number.MAX_SAFE_INTEGER))
      return reject('clock-unavailable');
    const canonical=canonicalOfflineEnvelope(envelope);
    if (!DEVICE.test(envelope.deviceId))
      return reject('identity-invalid');

    // Registry evidence comes from a future trusted operator-controlled
    // source; a caller-supplied object is NOT authentication in production.
    if (!exact(registryBinding,['deviceId','epoch','enabled','scope']) ||
        registryBinding.deviceId!==envelope.deviceId ||
        registryBinding.epoch!==envelope.epoch ||
        registryBinding.enabled!==true ||
        registryBinding.scope!=='prototype-ingest-v1')
      return reject('device-not-authorized');

    const digest=createHash('sha256').update(canonical,'utf8').digest('hex');
    if (!verifyStage8OfflineReceipt({
      receipt,signature,publicKey:trustedReceiptKey,
      expected:{deviceId:envelope.deviceId,epoch:envelope.epoch,
        sequence:envelope.frame.sequence,digest}
    }))return reject('receipt-unverified');

    if (!exact(databaseRecord,['deviceId','epoch','sequence','digest','acceptedAtMs','status'])||
        databaseRecord.status!=='DATABASE_CONFIRMED' ||
        databaseRecord.deviceId!==receipt.deviceId ||
        databaseRecord.epoch!==receipt.epoch ||
        databaseRecord.sequence!==receipt.sequence ||
        databaseRecord.digest!==receipt.digest ||
        databaseRecord.acceptedAtMs!==receipt.acceptedAtMs)
      return reject('database-not-confirmed');

    // Signed receipt proves test-path cryptographic consistency, not
    // physical authenticity; limit the observed/accepted clock and never
    // substitute current time for missing device evidence.
    const observedAt=envelope.observedAtMs,acceptedAt=receipt.acceptedAtMs;
    if (observedAt>nowMs+FUTURE_SKEW_MS ||
        observedAt<nowMs-MAX_AGE_MS ||
        acceptedAt<observedAt ||
        acceptedAt>nowMs+FUTURE_SKEW_MS ||
        acceptedAt<nowMs-MAX_AGE_MS)
      return reject('source-timestamp-unverified');

    if (lastPublished.initialized) {
      if (envelope.epoch!==lastPublished.epoch)
        return reject('epoch-change-needs-operator');
      if (envelope.frame.sequence<=lastPublished.sequence)
        return reject('publication-replay-or-out-of-order');
    }

    const frame=envelope.frame;
    const plan=Object.freeze({
      kind:'OFFLINE_PROJECTION_PLAN_NOT_APPLIED',
      allowed:true,
      sequence:frame.sequence,
      nextCheckpoint:Object.freeze({
        initialized:true,epoch:envelope.epoch,sequence:frame.sequence,digest
      }),
      // These are explicitly proposed child-only changes; NEVER pass the
      // plan to a generic unrestricted Admin SDK multi-path writer.
      proposedPublicChanges:Object.freeze({
        'water/distanceCm':frame.distanceCm,
        'water/levelCm':frame.levelCm,
        'water/status':frame.risk,
        'system/lastUpdate':observedAt,
        'system/overallRisk':'UNKNOWN'
      })
    });
    return plan;
  }catch{
    // Invalid envelope/cryptographic options must not expose payloads,
    // key metadata, filesystem paths or internal errors.
    return reject('invalid-projection-input');
  }
}
