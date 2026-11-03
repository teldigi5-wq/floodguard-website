// FloodGuard R3 H4: OFFLINE-ONLY synthetic signed admission candidate.
// Reuses the existing three-signer water gate. Does NOT hold Firebase creds,
// issue real authorizations, send network requests, deploy, alert or actuate.
// The injected authority is a TEST DOUBLE, not a secure service or real IAM.
import {createHash,KeyObject} from 'node:crypto';
import {planThreeSignerWaterProjectionGate}
  from './three-signer-water-projection-gate.mjs';

const ID='device-stage-a';
const EPOCH=1;
const TTL_MS=4000;
const WATER_FIELDS=[
  'water/distanceCm','water/levelCm','water/status',
  'system/lastUpdate','system/overallRisk'
];
const obj=x=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&
  (Object.getPrototypeOf(x)===Object.prototype||
   Object.getPrototypeOf(x)===null);
const exact=(x,names)=>obj(x)&&Object.keys(x).length===names.length&&
  names.every(k=>Object.hasOwn(x,k));
const integer=(v,min,max)=>Number.isSafeInteger(v)&&v>=min&&v<=max;
const fingerprint=key=>{
  if(!(key instanceof KeyObject)||key.type!=='public'||
     key.asymmetricKeyType!=='ed25519')throw Error('untrusted-key');
  return createHash('sha256')
    .update(key.export({format:'der',type:'spki'})).digest('hex');
};
function denied(reason){
  return Object.freeze({issued:false,reason,canWriteFirebase:false,
    canPublish:false,canAcknowledge:false,canSendAlert:false,
    canOperateGate:false,physicalSourceVerified:false,
    releaseDecision:'NO_GO'});
}
function stamp(s){
  if(!exact(s,['revision','issuer','publisher','incident',
    'sourceBinding','trustedReceiptKey','trustedDatabaseIssuerKey','lastPublished'])||
    !integer(s.revision,1,2147483647)||
    !exact(s.issuer,['enabled','generation','scope'])||
    s.issuer.enabled!==true||s.issuer.scope!=='lab-signed-admission-v1'||
    !integer(s.issuer.generation,1,10000)||
    !exact(s.publisher,['enabled','deviceId','epoch','scope'])||
    s.publisher.enabled!==true||s.publisher.deviceId!==ID||
    s.publisher.epoch!==EPOCH||s.publisher.scope!=='publication-lab-water-v1'||
    !exact(s.incident,['blocked','epoch'])||
    s.incident.blocked!==false||s.incident.epoch!==EPOCH||
    !exact(s.sourceBinding,['deviceId','epoch','enabled','scope','publicKey'])||
    s.sourceBinding.deviceId!==ID||s.sourceBinding.epoch!==EPOCH||
    s.sourceBinding.enabled!==true||
    s.sourceBinding.scope!=='prototype-ingest-v1'||
    !exact(s.lastPublished,['initialized','epoch','sequence','digest'])||
    s.lastPublished.initialized!==true||
    s.lastPublished.epoch!==EPOCH||
    !integer(s.lastPublished.sequence,1,2147483646)||
    typeof s.lastPublished.digest!=='string'||
    !/^[0-9a-f]{64}$/.test(s.lastPublished.digest))
    throw Error('issuer-authority-not-valid');
  // A read returning changed values but an unchanged revision still fails.
  return JSON.stringify([
    s.revision,s.issuer.generation,s.publisher.deviceId,
    s.incident.epoch,s.lastPublished.sequence,s.lastPublished.digest,
    fingerprint(s.sourceBinding.publicKey),
    fingerprint(s.trustedReceiptKey),
    fingerprint(s.trustedDatabaseIssuerKey),
  ]);
}

/**
 * Test-only authority is injected at construction, NEVER from signedEvidence.
 * An in-memory double cannot prove independent custody or atomicity with RTDB.
 * No ticket is considered externally usable: a separate privileged emulator
 * harness would have to store it in the private H3 admission subtree.
 */
export function createH4OfflineAdmissionIssuer({authority,clock}={}){
  if(!authority||!Object.isFrozen(authority)||
     typeof authority.read!=='function'||typeof clock!=='function')
    throw TypeError('Immutable test-only authority reader and clock required');
  return Object.freeze({
    async issue(signedEvidence){
      try{
        if(!exact(signedEvidence,[
          'envelope','deviceSignature','receipt','receiptSignature',
          'attestation','attestationSignature','databaseRecord']))
          return denied('invalid-evidence-shape');
        const before=await authority.read();
        const firstStamp=stamp(before);
        const now=clock();
        if(!integer(now,946684800000,Number.MAX_SAFE_INTEGER))
          return denied('clock-unavailable');
        const e=signedEvidence.envelope;
        if(e?.deviceId!==ID||e?.epoch!==EPOCH||
           e?.frame?.sequence!==before.lastPublished.sequence+1)
          return denied('device-or-monotonic-sequence-mismatch');
        const check=state=>planThreeSignerWaterProjectionGate({
          ...signedEvidence,sourceBinding:state.sourceBinding,
          trustedReceiptKey:state.trustedReceiptKey,
          trustedDatabaseIssuerKey:state.trustedDatabaseIssuerKey,
          lastPublished:state.lastPublished,nowMs:clockValue
        });
        let clockValue=now;
        const first=check(before);
        if(first?.planned!==true)return denied('three-signer-evidence-refused');

        // Re-read external authority AFTER signing/verification work, never
        // accept earlier status when incident, issuer or checkpoint changed.
        const after=await authority.read();
        if(stamp(after)!==firstStamp)
          return denied('authority-or-checkpoint-changed');
        const later=clock();
        if(!integer(later,now,now+2000))
          return denied('clock-moved-or-unavailable');
        clockValue=later;
        const plan=check(after); // Recheck evidence freshness at issuance.
        if(plan?.planned!==true)return denied('signed-evidence-now-untrusted');
        if(plan.root!=='/floodguard/publicTelemetryLabV1'||
           !exact(plan.proposedLeaves,WATER_FIELDS)||
           !exact(plan.nextCheckpoint,['initialized','epoch','sequence','digest'])||
           plan.nextCheckpoint.initialized!==true||
           plan.nextCheckpoint.epoch!==EPOCH||
           plan.nextCheckpoint.sequence!==e.frame.sequence||
           plan.nextCheckpoint.digest===after.lastPublished.digest)
          return denied('strict-projection-contract-mismatch');
        const v=plan.proposedLeaves;
        if(v['system/lastUpdate']!==e.observedAtMs||
           v['system/overallRisk']!=='UNKNOWN'||
           v['water/distanceCm']!==e.frame.distanceCm||
           v['water/levelCm']!==e.frame.levelCm||
           v['water/status']!==e.frame.risk||
           plan.nextCheckpoint.digest!==signedEvidence.receipt.digest)
          return denied('ticket-fields-do-not-bind-evidence');
        const ticket=Object.freeze({
          enabled:true,deviceId:ID,epoch:EPOCH,
          sequence:e.frame.sequence,digest:plan.nextCheckpoint.digest,
          observedAtMs:e.observedAtMs,
          distanceCm:e.frame.distanceCm,levelCm:e.frame.levelCm,
          status:e.frame.risk,issuedAtMs:later,expiresAtMs:later+TTL_MS,
        });
        const candidate=Object.freeze({
          current:Object.freeze({
            distanceCm:ticket.distanceCm,levelCm:ticket.levelCm,
            status:ticket.status,observedAtMs:ticket.observedAtMs,
            overallRisk:'UNKNOWN'
          }),
          checkpoint:Object.freeze({
            initialized:true,deviceId:ID,epoch:EPOCH,
            sequence:ticket.sequence,digest:ticket.digest,
            observedAtMs:ticket.observedAtMs
          })
        });
        return Object.freeze({issued:true,
          kind:'SYNTHETIC_SIGNED_ADMISSION_CANDIDATE_NOT_STORED',
          ticket,candidate,
          canWriteFirebase:false,canPublish:false,canAcknowledge:false,
          canSendAlert:false,canOperateGate:false,
          physicalSourceVerified:false,releaseDecision:'NO_GO'});
      }catch{
        return denied('authority-or-evidence-unavailable');
      }
    }
  });
}
