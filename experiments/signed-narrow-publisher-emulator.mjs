// REVIEW-ONLY: Signed receipt -> narrow authenticated RTDB emulator publisher.
// Never import this from the production website; does not open a server, use
// cloud credentials, authenticate a real ESP8266, or publish live alerts.
// The real writer identity is supplied by the isolated RTDB rules test context.
// Registry and confirmed-record evidence are INJECTED test fixtures, not
// independently verifiable database reads from the narrow publisher role.
import {createHash,KeyObject} from 'node:crypto';
import {planStrictSyntheticPublicProjection} from './strict-signed-projection-gate.mjs';

const PATH='/floodguard/publicationLab/water';
const EMULATOR='127.0.0.1:9000';
const FINGERPRINT=/^[0-9a-f]{64}$/;
const record=x=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&
  (Object.getPrototypeOf(x)===Object.prototype||Object.getPrototypeOf(x)===null);
const exact=(x,fields)=>record(x)&&Object.keys(x).length===fields.length&&
  fields.every(k=>Object.hasOwn(x,k));
const deny=reason=>Object.freeze({published:false,reason});
const CURRENT=['distanceCm','levelCm','status','observedAtMs','overallRisk'];
const CHECKPOINT=['initialized','deviceId','epoch','sequence','digest','observedAtMs'];

export async function publishSignedToNarrowEmulator({
  database,envelope,receipt,signature,trustedReceiptKey,
  expectedSignerFingerprint,registryBinding,databaseRecord,nowMs
}={}) {
  if(process.env.FG_NARROW_SIGNED_BRIDGE_TEST!=='1'||
     process.env.FIREBASE_DATABASE_EMULATOR_HOST!==EMULATOR)
    return deny('strict-emulator-only');
  if(!database||typeof database.ref!=='function'||
     !Number.isSafeInteger(nowMs)||nowMs<0)
    return deny('invalid-request');
  if(!(trustedReceiptKey instanceof KeyObject)||
     trustedReceiptKey.type!=='public'||
     trustedReceiptKey.asymmetricKeyType!=='ed25519'||
     typeof expectedSignerFingerprint!=='string'||
     !FINGERPRINT.test(expectedSignerFingerprint))
    return deny('trusted-signer-invalid');
  try {
    const fp=createHash('sha256').update(
      trustedReceiptKey.export({format:'der',type:'spki'})
    ).digest('hex');
    if(fp!==expectedSignerFingerprint)return deny('receipt-signer-not-authorized');
  }catch{return deny('trusted-signer-invalid');}
  let detach;
  let reason='transaction-aborted';
  let committedSequence;
  try {
    const ref=database.ref(PATH);
    // Active listener must stay attached during RTDB transaction; otherwise
    // the first callback can see null local cache and abort a valid frame.
    const initial=await new Promise((resolve,reject)=>{
      let received=false;
      const onValue=snap=>{if(!received){received=true;resolve(snap);}};
      detach=()=>ref.off('value',onValue);
      ref.on('value',onValue,reject);
    });
    if(!initial.exists())return deny('publication-state-unavailable');
    const txn=await ref.transaction(state=>{
      if(!exact(state,['current','checkpoint'])||
         !exact(state.current,CURRENT)||
         !exact(state.checkpoint,CHECKPOINT)||
         state.checkpoint.initialized!==true||
         typeof state.checkpoint.deviceId!=='string'){
        reason='publication-state-unavailable';return;
      }
      if(!envelope||envelope.deviceId!==state.checkpoint.deviceId||
         envelope.epoch!==state.checkpoint.epoch){
        reason='device-source-mismatch';return;
      }
      const previousTime=state.current.observedAtMs;
      if(!Number.isSafeInteger(previousTime)||previousTime<0||
         previousTime>nowMs+2000||
         state.checkpoint.observedAtMs!==previousTime){
        reason='public-timestamp-unavailable';return;
      }
      const plan=planStrictSyntheticPublicProjection({
        envelope,receipt,signature,trustedReceiptKey,registryBinding,
        databaseRecord,
        lastPublished:{
          initialized:true,epoch:state.checkpoint.epoch,
          sequence:state.checkpoint.sequence,digest:state.checkpoint.digest
        },nowMs
      });
      if(plan.allowed!==true){reason=plan.reason??'projection-rejected';return;}
      const data=plan.proposedPublicChanges;
      const fields=Object.keys(data);
      if(fields.length!==5||fields.some((v,i)=>v!==[
        'water/distanceCm','water/levelCm','water/status',
        'system/lastUpdate','system/overallRisk'
      ][i])){
        reason='unexpected-public-target';return;
      }
      const stamp=data['system/lastUpdate'];
      if(!Number.isSafeInteger(stamp)||stamp<=previousTime){
        reason='public-timestamp-regression';return;
      }
      committedSequence=plan.sequence;
      return {
        current:{
          distanceCm:data['water/distanceCm'],
          levelCm:data['water/levelCm'],
          status:data['water/status'],
          observedAtMs:stamp,
          overallRisk:'UNKNOWN'
        },
        checkpoint:{
          initialized:true,
          deviceId:envelope.deviceId,
          epoch:envelope.epoch,
          sequence:plan.sequence,
          digest:plan.nextCheckpoint.digest,
          observedAtMs:stamp
        }
      };
    },undefined,false);
    if(!txn.committed)return deny(reason);
    return Object.freeze({
      published:true,kind:'SIGNED_NARROW_EMULATOR_ONLY',
      sequence:committedSequence
    });
  }catch{
    // Post-commit transport loss is indeterminate until a privileged
    // diagnostic compares persisted digest+checkpoint. Never retry blind.
    return deny('publisher-outcome-unknown');
  }finally{
    if(detach)detach();
  }
}
