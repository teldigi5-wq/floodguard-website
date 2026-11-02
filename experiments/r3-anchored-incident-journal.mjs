// FloodGuard R3 — offline synthetic incident-journal verification only.
// Read-only, no key generation, signing, persistent writes, network, Firebase,
// messaging, physical device or public-publisher capabilities.
// The externally pinned checkpoint MUST be independently stored/obtained.
import {createHash,verify,KeyObject} from 'node:crypto';

const EVENT_VERSION='floodguard-synthetic-incident-event-v1';
const CHECKPOINT_VERSION='floodguard-synthetic-incident-checkpoint-v1';
const EVENT_FIELDS=['version','deviceId','revision','currentEpoch','quarantined',
  'occurredAtMs','previousHash'];
const CHECK_FIELDS=['version','deviceId','revision','currentEpoch','quarantined',
  'headHash','checkpointAtMs'];
const DEVICE=/^device-stage-[a-z0-9-]{1,32}$/;
const HASH=/^[0-9a-f]{64}$/;
const SIGNATURE=/^[A-Za-z0-9_-]{86}$/;
const ZERO='0'.repeat(64);
const MAX_EVENTS=128,MAX_CHECKPOINT_AGE=15000,FUTURE_MS=2000;
const isObject=v=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&
 (Object.getPrototypeOf(v)===Object.prototype||Object.getPrototypeOf(v)===null);
const exact=(v,fields)=>isObject(v)&&Object.keys(v).length===fields.length&&
 fields.every(f=>Object.hasOwn(v,f));
const integer=(v,min,max)=>Number.isSafeInteger(v)&&v>=min&&v<=max;
const pub=v=>v instanceof KeyObject&&v.type==='public'&&v.asymmetricKeyType==='ed25519';
const differentKeys=(a,b)=>!a.export({type:'spki',format:'der'}).equals(
 b.export({type:'spki',format:'der'}));

export function canonicalSyntheticIncidentEvent(v) {
 if(!exact(v,EVENT_FIELDS)||v.version!==EVENT_VERSION||
   typeof v.deviceId!=='string'||!DEVICE.test(v.deviceId)||
   !integer(v.revision,1,2147483647)||!integer(v.currentEpoch,1,10000)||
   typeof v.quarantined!=='boolean'||
   !integer(v.occurredAtMs,0,Number.MAX_SAFE_INTEGER)||
   typeof v.previousHash!=='string'||!HASH.test(v.previousHash))
   throw TypeError('Invalid offline incident event');
 return JSON.stringify(Object.fromEntries(EVENT_FIELDS.map(f=>[f,v[f]])));
}
export function canonicalSyntheticIncidentCheckpoint(v) {
 if(!exact(v,CHECK_FIELDS)||v.version!==CHECKPOINT_VERSION||
   typeof v.deviceId!=='string'||!DEVICE.test(v.deviceId)||
   !integer(v.revision,1,2147483647)||!integer(v.currentEpoch,1,10000)||
   typeof v.quarantined!=='boolean'||typeof v.headHash!=='string'||
   !HASH.test(v.headHash)||
   !integer(v.checkpointAtMs,0,Number.MAX_SAFE_INTEGER))
   throw TypeError('Invalid offline incident checkpoint');
 return JSON.stringify(Object.fromEntries(CHECK_FIELDS.map(f=>[f,v[f]])));
}
export function syntheticSignedEventHash(event,signature) {
 const canonical=canonicalSyntheticIncidentEvent(event);
 if(typeof signature!=='string'||!SIGNATURE.test(signature))
   throw TypeError('Invalid offline incident event signature encoding');
 return createHash('sha256').update(canonical,'utf8').update('\n')
   .update(signature,'utf8').digest('hex');
}

/**
 * A pinned revision+epoch+hash must originate from a separately trusted,
 * rollback-resistant store/observer; this pure function cannot establish it.
 * The checkpoint signer must also be independently controlled.
 */
export function verifyExternallyPinnedSyntheticIncidentJournal({
  entries,signedCheckpoint,journalPublicKey,checkpointPublicKey,
  trustedPinnedRevision,trustedPinnedEpoch,trustedPinnedHash,nowMs
}={}) {
 if(process.env.FG_R3_ANCHORED_JOURNAL_TEST!=='1'||
   !pub(journalPublicKey)||!pub(checkpointPublicKey)||
   !differentKeys(journalPublicKey,checkpointPublicKey)||
   !integer(nowMs,0,Number.MAX_SAFE_INTEGER)||
   !integer(trustedPinnedRevision,1,2147483647)||
   !integer(trustedPinnedEpoch,1,10000)||
   typeof trustedPinnedHash!=='string'||!HASH.test(trustedPinnedHash)||
   !Array.isArray(entries)||entries.length<1||entries.length>MAX_EVENTS||
   !exact(signedCheckpoint,['checkpoint','signature']))return null;
 try {
   const {checkpoint,signature:checkpointSignature}=signedCheckpoint;
   const canonicalCheckpoint=canonicalSyntheticIncidentCheckpoint(checkpoint);
   if(typeof checkpointSignature!=='string'||!SIGNATURE.test(checkpointSignature)||
      checkpoint.checkpointAtMs>nowMs+FUTURE_MS||
      checkpoint.checkpointAtMs<nowMs-MAX_CHECKPOINT_AGE||
      checkpoint.revision!==entries.length||
      checkpoint.revision<trustedPinnedRevision)return null;
   const rawCheckpointSignature=Buffer.from(checkpointSignature,'base64url');
   if(rawCheckpointSignature.length!==64||
      !verify(null,Buffer.from(canonicalCheckpoint),checkpointPublicKey,
       rawCheckpointSignature))return null;

   let priorHash=ZERO,priorEpoch=null,priorTime=-1,priorQuarantine=false;
   let pinnedMatched=false,finalEvent=null;
   for(let i=0;i<entries.length;i++){
     const entry=entries[i];
     if(!exact(entry,['event','signature']))return null;
     const {event,signature}=entry;
     const canonical=canonicalSyntheticIncidentEvent(event);
     const rawSignature=typeof signature==='string'&&SIGNATURE.test(signature)
       ?Buffer.from(signature,'base64url'):null;
     if(!rawSignature||rawSignature.length!==64||
        !verify(null,Buffer.from(canonical),journalPublicKey,rawSignature)||
        event.revision!==i+1||event.deviceId!==checkpoint.deviceId||
        event.previousHash!==priorHash||
        event.occurredAtMs<=priorTime||
        event.occurredAtMs>checkpoint.checkpointAtMs)return null;
     if(i===0){
       if(event.currentEpoch!==1||event.quarantined!==false||
          event.previousHash!==ZERO)return null;
     }else{
       if(event.currentEpoch<priorEpoch||
          event.currentEpoch>priorEpoch+1||
          (event.currentEpoch>priorEpoch&&!event.quarantined)||
          (priorQuarantine&&!event.quarantined))return null;
     }
     const h=syntheticSignedEventHash(event,signature);
     if(event.revision===trustedPinnedRevision){
       if(h!==trustedPinnedHash||event.currentEpoch!==trustedPinnedEpoch)
         return null;
       pinnedMatched=true;
     }
     priorHash=h;priorEpoch=event.currentEpoch;
     priorTime=event.occurredAtMs;priorQuarantine=event.quarantined;
     finalEvent=event;
   }
   if(!pinnedMatched||!finalEvent||
      checkpoint.headHash!==priorHash||
      checkpoint.currentEpoch!==finalEvent.currentEpoch||
      checkpoint.quarantined!==finalEvent.quarantined)return null;
   // The returned floors are valid only conditional on OUTSIDE trust in the
   // externally pinned checkpoint and the two signers. NOT production authority.
   return Object.freeze({
     verified:true,deviceId:checkpoint.deviceId,
     trustedMinimumEpoch:checkpoint.currentEpoch,
     trustedMinimumRevision:checkpoint.revision,
     quarantined:checkpoint.quarantined,
     operationallyApproved:false,
     releaseDecision:'NO_GO'
   });
 }catch{return null;}
}
