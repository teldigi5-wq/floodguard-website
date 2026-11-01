// FloodGuard R2/R3 ATOMIC STATE TRANSITION LAB (not a deployed publisher).
// Use ONLY from a disposable RTDB Emulator root transaction with trusted,
// independently provisioned operator-owned identity/receipt controls.
// This pure reducer takes a TEST snapshot; it does no I/O, credential work,
// rules publication, notifications, firmware changes or physical actuation.
import {createHash,KeyObject} from 'node:crypto';
import {planSignedWaterLeafBridgeLab,SIGNED_WATER_LEAF_LAB_FIELDS}
  from './signed-water-leaf-bridge-lab.mjs';
import {projectPublicTelemetryLabV1,PUBLIC_TELEMETRY_LAB_FIELDS}
  from '../tests/fixtures/pr34/public-telemetry-leaf-projection-lab.mjs';

const ROOT='/floodguard/publicTelemetryLabV1';
const DEVICE=/^device-stage-[a-z0-9-]{1,32}$/;
const ERROR=reason=>Object.freeze({allowed:false,reason});
const record=x=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&
  Object.getPrototypeOf(x)===Object.prototype;
const exact=(x,names)=>record(x)&&Object.keys(x).length===names.length&&
  names.every(k=>Object.hasOwn(x,k));
const finiteTime=x=>Number.isSafeInteger(x)&&x>=946684800000;
const highwater=x=>exact(x,['initialized','epoch'])&&
  x.initialized===false&&Number.isSafeInteger(x.epoch)&&x.epoch>0||
  exact(x,['initialized','epoch','sequence','digest'])&&
  x.initialized===true&&Number.isSafeInteger(x.epoch)&&x.epoch>0&&
  Number.isSafeInteger(x.sequence)&&x.sequence>=1&&
  typeof x.digest==='string'&&/^[a-f0-9]{64}$/.test(x.digest);

function validateExistingPublic(pub) {
  if(!record(pub)||!record(pub.water)||!record(pub.system)||
     !finiteTime(pub.system.lastUpdate))return false;
  try {
    const validated=projectPublicTelemetryLabV1(pub);
    for(const [group,fields] of Object.entries(pub)){
      if(!record(fields)||!Object.hasOwn(PUBLIC_TELEMETRY_LAB_FIELDS,group)||
         !validated[group]||
         Object.keys(fields).length!==Object.keys(validated[group]).length)return false;
      for(const key of Object.keys(fields)){
        if(!Object.hasOwn(validated[group],key))return false;
        // The approved public RTDB leaf MUST remain primitive; the projector
        // additionally checks its exact numeric range / enum / length.
        if(!['string','number','boolean'].includes(typeof fields[key]))return false;
      }
    }
    return true;
  }catch{return false;}
}

/**
 * Called inside a single emulator transaction callback, not from device data.
 * MUST NEVER be published as an API accepting caller-supplied root state,
 * receipt trust key, registry, or confirmed record.
 */
export function deriveIsolatedAtomicWaterStateLab({
  current,envelope,receipt,signature,trustedReceiptKey,nowMs
}={}) {
  if(!record(current)||!record(current.projectionControl)||
     !record(current.projectionControl.devices)||!record(current.deviceAuthorization)||
     !record(current.staging)||!record(current.staging.ingestV1)||
     !record(current.confirmedIngest))return ERROR('trusted-root-unavailable');
  const uid=envelope?.deviceId;
  if(typeof uid!=='string'||!DEVICE.test(uid)||
     !(trustedReceiptKey instanceof KeyObject)||
     trustedReceiptKey.type!=='public'||
     trustedReceiptKey.asymmetricKeyType!=='ed25519')
    return ERROR('trusted-identity-invalid');

  const authority=current.projectionControl.waterAuthority;
  if(!exact(authority,['deviceId','epoch','enabled','scope','receiptSignerFingerprint'])||
     authority.deviceId!==uid||authority.epoch!==envelope.epoch||
     authority.enabled!==true||authority.scope!=='water-primary')
    return ERROR('water-source-not-authorized');
  const issuer=createHash('sha256').update(
    trustedReceiptKey.export({format:'der',type:'spki'})).digest('hex');
  if(authority.receiptSignerFingerprint!==issuer)
    return ERROR('receipt-issuer-not-pinned');

  const member=current.deviceAuthorization[uid];
  if(!exact(member,['enabled','scope'])||member.enabled!==true||
     member.scope!=='prototype-ingest-v1')
    return ERROR('device-not-authorized');
  const staged=current.staging.ingestV1[uid];
  const expected=['sequence','distanceCm','levelCm','risk'];
  if(!exact(staged,expected)||!exact(envelope.frame,expected)||
     expected.some(k=>staged[k]!==envelope.frame[k]))
    return ERROR('confirmed-source-not-staged');

  const marker=current.projectionControl.devices[uid];
  if(!highwater(marker)||marker.epoch!==envelope.epoch)
    return ERROR('publication-checkpoint-unavailable');
  const lastPublished=marker.initialized ? {
    initialized:true,epoch:marker.epoch,sequence:marker.sequence,digest:marker.digest
  } : {initialized:false};

  const plan=planSignedWaterLeafBridgeLab({
    envelope,receipt,signature,trustedReceiptKey,
    registryBinding:{deviceId:uid,epoch:marker.epoch,
      enabled:member.enabled,scope:member.scope},
    databaseRecord:current.confirmedIngest[uid],
    lastPublished,nowMs
  });
  if(plan.planned!==true)return ERROR(plan.reason||'signed-plan-rejected');
  if(plan.root!==ROOT ||
     Object.keys(plan.proposedLeaves).join('|')!==SIGNED_WATER_LEAF_LAB_FIELDS.join('|'))
    return ERROR('isolated-leaf-target-invalid');

  const pub=current.publicTelemetryLabV1;
  if(!validateExistingPublic(pub))
    return ERROR('public-scalar-schema-corrupt');
  const currentTime=pub.system.lastUpdate,sourceTime=plan.proposedLeaves['system/lastUpdate'];
  if(!finiteTime(currentTime)||!finiteTime(sourceTime)||
     !Number.isSafeInteger(nowMs)||currentTime>nowMs+2000)
    return ERROR('public-clock-unavailable');
  if(sourceTime<currentTime)
    return ERROR('public-timestamp-regression');

  // The root contains trusted private authority/receipt state alongside
  // the public tree. It is modified as one immutable candidate in a single
  // emulator transaction, never as separately ordered async update calls.
  const nextPublic={
    ...pub,
    water:{...pub.water,
      distanceCm:plan.proposedLeaves['water/distanceCm'],
      levelCm:plan.proposedLeaves['water/levelCm'],
      status:plan.proposedLeaves['water/status']},
    system:{...pub.system,
      lastUpdate:sourceTime,
      overallRisk:'UNKNOWN'}
  };
  if(!validateExistingPublic(nextPublic))
    return ERROR('next-public-scalar-schema-invalid');

  const next={
    ...current,
    publicTelemetryLabV1:nextPublic,
    projectionControl:{
      ...current.projectionControl,
      devices:{...current.projectionControl.devices,
        [uid]:{...plan.nextCheckpoint}}
    }
  };
  return Object.freeze({
    allowed:true,kind:'EMULATOR_ATOMIC_CANDIDATE_NOT_PUBLISHED',
    next,sequence:envelope.frame.sequence
  });
}
