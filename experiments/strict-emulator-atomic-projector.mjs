// REVIEW-ONLY: Atomic Firebase RTDB *Emulator* projection rehearsal.
// This module is not a Firebase publisher for production, has no admin keys,
// no server listener, no run-on-import, no real client or device transport.
// Deliberately transacts at /floodguard in a trusted emulator context only;
// production needs separately audited privileges, resource isolation and
// data-size/rate limits rather than privileged broad-root transactions.
import {planStrictSyntheticPublicProjection} from './strict-signed-projection-gate.mjs';
import {createHash,KeyObject} from 'node:crypto';

const EMULATOR='127.0.0.1:9000';
const UID=/^device-stage-[a-z0-9-]{1,32}$/;
const isRecord=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const exact=(a,b)=>isRecord(a)&&Object.keys(a).length===b.length&&b.every(k=>Object.hasOwn(a,k));
const FRAME_KEYS=['sequence','distanceCm','levelCm','risk'];
const STEP='OFFLINE_EMULATOR_PROJECTED_NOT_PRODUCTION';
const deny=reason=>Object.freeze({published:false,reason});

// Call only with the database instance from a Firebase Emulator test env
// with explicitly disabled security rules for this one supervised operation.
// Production root references and admin service-account keys are forbidden.
export async function publishStrictEmulatorFrame({
  database,envelope,receipt,signature,trustedReceiptKey,nowMs,
  initialSnapshotTimeoutMs=5000
}={}) {
  if(process.env.FG_STRICT_EMULATOR_PROJECTOR_TEST!=='1'||
    process.env.FIREBASE_DATABASE_EMULATOR_HOST!==EMULATOR)
    return deny('strict-emulator-only');
  if(!database||typeof database.ref!=='function'||
     !envelope||typeof envelope.deviceId!=='string'||!UID.test(envelope.deviceId)||
     !Number.isSafeInteger(initialSnapshotTimeoutMs)||
     initialSnapshotTimeoutMs<10||initialSnapshotTimeoutMs>30000)
    return deny('invalid-publisher-request');

  const uid=envelope.deviceId;
  // The receipt issuer is pinned independently in operator-owned emulator
  // state. A caller cannot simply supply their own signing key as trusted.
  if(!(trustedReceiptKey instanceof KeyObject) ||
     trustedReceiptKey.type!=='public' ||
     trustedReceiptKey.asymmetricKeyType!=='ed25519')
    return deny('trusted-signer-invalid');
  let signerFingerprint;
  try{
    signerFingerprint=createHash('sha256').update(
      trustedReceiptKey.export({format:'der',type:'spki'})
    ).digest('hex');
  }catch{return deny('trusted-signer-invalid');}
  let reason='transaction-aborted';
  let lastPlan,detach;
  try{
    // RTDB transactions may initially see a null local cache even if the
    // server root exists. Keep a value listener alive *through commit* so the
    // client holds the authenticated emulator root in its sync tree. A
    // one-shot read detaches and can release that cache before transaction().
    const target=database.ref('/floodguard');
    const initial=await new Promise((resolve,reject)=>{
      let finished=false,timer;
      const finish=(error,snapshot)=>{
        if(finished)return;
        finished=true;
        clearTimeout(timer);
        // Retain the listener after success until the transaction commits,
        // since the Firebase SDK may otherwise release its initial cache.
        // On timeout/denial, detach immediately and never start a transaction.
        if(error){
          try{if(detach)detach();}catch{/* Stop closed. */}
          detach=undefined;
          reject(error);
        }else resolve(snapshot);
      };
      const onValue=snapshot=>finish(null,snapshot);
      detach=()=>target.off('value',onValue);
      timer=setTimeout(()=>finish(new Error('initial-snapshot-timeout')),
        initialSnapshotTimeoutMs);
      try{target.on('value',onValue,error=>finish(
        error||new Error('initial-snapshot-unavailable')
      ));}
      catch(error){finish(error);}
    });
    if(!initial.exists())return deny('root-state-unavailable');
    // Single fixed literal path: staging, operator confirmation, checkpoint and
    // the five public leaves update as ONE RTDB emulator transaction.
    // Never take a database path from client data or output unrestricted update().
    const result=await target.transaction(current=>{
      if(!isRecord(current)){
        reason='transaction-cache-unavailable';return; // never initialize empty root
      }
      const binding=current.deviceAuthorization?.[uid];
      const authority=current.projectionControl?.waterAuthority;
      // Per-device replay protection alone cannot prevent two *different*
      // valid identities from racing to replace a shared public water feed.
      // Operator-provisioned source authority and issuer pin are required
      // inside the SAME atomic transaction as the published checkpoint.
      if(!exact(authority,['deviceId','epoch','enabled','scope','receiptSignerFingerprint'])||
         authority.enabled!==true ||
         authority.scope!=='water-primary' ||
         authority.deviceId!==uid ||
         authority.epoch!==envelope.epoch){
        reason='water-source-not-authorized';return;
      }
      if(authority.receiptSignerFingerprint!==signerFingerprint){
        reason='receipt-signer-not-authorized';return;
      }
      const control=current.projectionControl?.devices?.[uid];
      const staged=current.staging?.ingestV1?.[uid];
      const confirmed=current.confirmedIngest?.[uid];
      if(!exact(binding,['enabled','scope'])||
        binding.enabled!==true||binding.scope!=='prototype-ingest-v1'){
        reason='device-not-authorized';return;
      }
      if(!exact(control,['initialized','epoch']) &&
         !exact(control,['initialized','epoch','sequence','digest'])){
        reason='publication-state-unavailable';return;
      }
      if(control.epoch!==envelope.epoch ||
         typeof control.initialized!=='boolean' ||
         (control.initialized===false&&Object.keys(control).length!==2)){
        reason='epoch-change-needs-operator';return;
      }
      if(!exact(staged,FRAME_KEYS) || !exact(envelope.frame,FRAME_KEYS) ||
         FRAME_KEYS.some(k=>staged[k]!==envelope.frame[k])){
        reason='staging-frame-mismatch';return;
      }
      const lastPublished=control.initialized ? {
        initialized:true,epoch:control.epoch,sequence:control.sequence,
        digest:control.digest
      } : {initialized:false};
      const plan=planStrictSyntheticPublicProjection({
        envelope,receipt,signature,trustedReceiptKey,
        registryBinding:{deviceId:uid,epoch:control.epoch,
          enabled:binding.enabled,scope:binding.scope},
        databaseRecord:confirmed,lastPublished,nowMs
      });
      if(plan.allowed!==true){reason=plan.reason??'projection-rejected';return;}
      // Keep this set in lockstep with the reviewed strict planner. An
      // unexpected field causes DENIAL rather than privileged root write.
      const fields=Object.keys(plan.proposedPublicChanges);
      if(fields.length!==5||fields.some((f,i)=>f!==[
        'water/distanceCm','water/levelCm','water/status',
        'system/lastUpdate','system/overallRisk'
      ][i])){reason='unexpected-public-target';return;}
      const water=current.live?.water,system=current.live?.system;
      if(!isRecord(water)||!isRecord(system)){
        reason='public-schema-unavailable';return;
      }
      // A higher device sequence is NOT proof of a newer observation:
      // clock rollback/reordered buffers or an authorized source handoff
      // could otherwise move the shared public lastUpdate backwards.
      // Check it in the same atomic transaction as the public change and
      // per-device checkpoint, including after an operator source handoff.
      const priorTime=system.lastUpdate;
      const candidateTime=plan.proposedPublicChanges['system/lastUpdate'];
      if(!Number.isSafeInteger(priorTime)||priorTime<0||
         priorTime>nowMs+2000){
        reason='public-timestamp-unavailable';return;
      }
      if(!Number.isSafeInteger(candidateTime)||candidateTime<priorTime){
        reason='public-timestamp-regression';return;
      }
      lastPlan=plan;
      const next={
        ...current,
        live:{
          ...current.live,
          water:{
            ...water,
            distanceCm:plan.proposedPublicChanges['water/distanceCm'],
            levelCm:plan.proposedPublicChanges['water/levelCm'],
            status:plan.proposedPublicChanges['water/status']
          },
          system:{
            ...system,
            lastUpdate:plan.proposedPublicChanges['system/lastUpdate'],
            overallRisk:plan.proposedPublicChanges['system/overallRisk']
          }
        },
        projectionControl:{
          ...current.projectionControl,
          devices:{
            ...current.projectionControl.devices,
            [uid]:{...plan.nextCheckpoint}
          }
        }
      };
      return next;
    },undefined,false);

    if(!result.committed)return deny(reason);
    if(!lastPlan)return deny('publisher-outcome-unknown');
    return Object.freeze({
      published:true,kind:STEP,sequence:lastPlan.sequence
    });
  }catch{
    // A transport interruption might occur after database commit; never
    // report a definitive failure/rollback without rereading the checkpoint.
    return deny('publisher-outcome-unknown');
  }finally{
    if(detach)detach();
  }
}
