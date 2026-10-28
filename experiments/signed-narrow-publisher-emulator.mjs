// REVIEW ONLY: immutable operator-pinned trust roots plus a scoped RTDB
// Emulator transaction. NO production connection, device or server listener.
// The operator must independently verify durability, device authentication,
// revocation and DB confirmation before issuing the separate attestation.
import {KeyObject} from 'node:crypto';
import {planStrictSyntheticPublicProjection} from './strict-signed-projection-gate.mjs';
import {verifySyntheticPublicationAttestation}
  from './synthetic-publication-attestation.mjs';

const PATH='/floodguard/publicationLab/water';
const EMULATOR='127.0.0.1:9000';
const record=x=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&
  (Object.getPrototypeOf(x)===Object.prototype||Object.getPrototypeOf(x)===null);
const exact=(x,keys)=>record(x)&&Object.keys(x).length===keys.length&&
  keys.every(k=>Object.hasOwn(x,k));
const publicEd25519=x=>x instanceof KeyObject&&x.type==='public'&&
  x.asymmetricKeyType==='ed25519';
const deny=reason=>Object.freeze({published:false,reason});
const currentFields=['distanceCm','levelCm','status','observedAtMs','overallRisk'];
const checkpointFields=['initialized','deviceId','epoch','sequence','digest','observedAtMs'];
const requestFields=['envelope','receipt','signature','attestation','attestationSignature'];
const sameSnapshot=(state,plan,envelope)=>{
  // A checkpoint alone is NOT a proof of what public data was committed.
  // Require the complete, exact fixed-schema current leaf AND checkpoint.
  if(!exact(state,['current','checkpoint'])||
     !exact(state.current,currentFields)||
     !exact(state.checkpoint,checkpointFields)||
     state.checkpoint.initialized!==true)return false;
  const c=state.checkpoint,w=state.current,p=plan.proposedPublicChanges;
  return c.deviceId===envelope.deviceId&&c.epoch===envelope.epoch&&
    c.sequence===plan.sequence&&c.digest===plan.nextCheckpoint.digest&&
    c.observedAtMs===p['system/lastUpdate']&&
    w.distanceCm===p['water/distanceCm']&&
    w.levelCm===p['water/levelCm']&&
    w.status===p['water/status']&&
    w.observedAtMs===p['system/lastUpdate']&&
    w.overallRisk===p['system/overallRisk'];
};
const recovered=plan=>Object.freeze({
  published:true,kind:'RECOVERED_SIGNED_NARROW_EMULATOR_ONLY',
  sequence:plan.sequence
});

/**
 * The independent bootstrap supplies the two already-approved issuer keys
 * ONCE. Untrusted messages cannot change trust anchors or provide their own
 * "expected fingerprint". The authenticated database client is constrained
 * by the isolated RTDB Security Rules. No production client is created.
 */
export function createSignedNarrowEmulatorPublisher({
  database,trustedReceiptKey,trustedAttestationKey,clock,
  initialSnapshotTimeoutMs=5000
}={}) {
  if(!database||typeof database.ref!=='function'||
     !publicEd25519(trustedReceiptKey)||
     !publicEd25519(trustedAttestationKey)||
     typeof clock!=='function'||
     !Number.isSafeInteger(initialSnapshotTimeoutMs)||
     initialSnapshotTimeoutMs<10||initialSnapshotTimeoutMs>30000)
    throw new TypeError('Explicit scoped emulator client, keys, clock and bounded initial-snapshot timeout required');
  return async function publish(message) {
    if(process.env.FG_NARROW_SIGNED_BRIDGE_TEST!=='1'||
       process.env.FIREBASE_DATABASE_EMULATOR_HOST!==EMULATOR)
      return deny('strict-emulator-only');
    if(!exact(message,requestFields))
      return deny('invalid-request');
    const {envelope,receipt,signature,attestation,attestationSignature}=message;
    let detach,reason='transaction-aborted',committedSequence,ref,verifiedPlan;
    let transactionAttempted=false;
    const recoverRead=async()=>{
      // Server/cache availability and post-commit ordering cannot be assumed.
      // Never retry the transaction and never infer success from exceptions.
      try{
        const value=(await ref.get()).val();
        return sameSnapshot(value,verifiedPlan,envelope)
          ? recovered(verifiedPlan)
          : deny('publisher-outcome-unknown');
      }catch{return deny('publisher-outcome-unknown');}
    };
    try{
      // Trust is verified without looking at the caller's claimed registry
      // or confirmation record. No per-message key/issuer overrides exist.
      if(!verifySyntheticPublicationAttestation({
        attestation,signature:attestationSignature,
        publicKey:trustedAttestationKey,receipt,nowMs:clock()
      }))return deny('confirmed-attestation-unverified');

      // Verify the real receipt signature, envelope digest, freshness and
      // independently attested database claim before ANY recovery result.
      // This is a pure synthetic validation plan, NOT a database write.
      const registryBinding={
        deviceId:attestation.deviceId,epoch:attestation.epoch,
        enabled:attestation.deviceEnabled,scope:attestation.scope
      };
      const databaseRecord={
        deviceId:attestation.deviceId,epoch:attestation.epoch,
        sequence:attestation.sequence,digest:attestation.digest,
        acceptedAtMs:attestation.acceptedAtMs,status:attestation.databaseState
      };
      verifiedPlan=planStrictSyntheticPublicProjection({
        envelope,receipt,signature,trustedReceiptKey,registryBinding,
        databaseRecord,lastPublished:{initialized:false},nowMs:clock()
      });
      if(verifiedPlan.allowed!==true)
        return deny(verifiedPlan.reason??'publication-evidence-unverified');

      ref=database.ref(PATH);
      const initial=await new Promise((resolve,reject)=>{
        let finished=false,timer;
        const finish=(error,snapshot)=>{
          if(finished)return;
          finished=true;
          clearTimeout(timer);
          // A disconnected emulator may never deliver either callback.
          // Detach promptly, even on timeout or registration failure.
          try{if(detach)detach();}catch{/* Fail closed below. */}
          detach=undefined;
          if(error)reject(error);
          else resolve(snapshot);
        };
        const onValue=snap=>finish(null,snap);
        detach=()=>ref.off('value',onValue);
        timer=setTimeout(()=>finish(new Error('initial-snapshot-timeout')),
          initialSnapshotTimeoutMs);
        try{ref.on('value',onValue,error=>finish(
          error||new Error('initial-snapshot-unavailable')
        ));}
        catch(error){finish(error);}
      });
      if(!initial.exists())return deny('publication-state-unavailable');
      // A restarted worker recognizes its *exact* previously published
      // snapshot without attempting a duplicate write or resetting replay.
      if(sameSnapshot(initial.val(),verifiedPlan,envelope))
        return recovered(verifiedPlan);
      transactionAttempted=true;
      const txn=await ref.transaction(state=>{
        if(!exact(state,['current','checkpoint'])||
           !exact(state.current,currentFields)||
           !exact(state.checkpoint,checkpointFields)||
           state.checkpoint.initialized!==true||
           typeof state.checkpoint.deviceId!=='string'){
          reason='publication-state-unavailable';return;
        }
        if(!envelope||envelope.deviceId!==state.checkpoint.deviceId||
           envelope.epoch!==state.checkpoint.epoch){
          reason='device-source-mismatch';return;
        }
        const nowMs=clock();
        // A slow/racing retry must not extend a signed attestation's expiry.
        if(!verifySyntheticPublicationAttestation({
          attestation,signature:attestationSignature,
          publicKey:trustedAttestationKey,receipt,nowMs
        })){reason='confirmed-attestation-unverified';return;}
        const previousTime=state.current.observedAtMs;
        if(!Number.isSafeInteger(previousTime)||previousTime<0||
           previousTime>nowMs+2000||
           state.checkpoint.observedAtMs!==previousTime){
          reason='public-timestamp-unavailable';return;
        }
        // Registry and confirmed records are reconstructed ONLY from the
        // separately signed operator attestation, not from caller objects.
        const registryBinding={
          deviceId:attestation.deviceId,epoch:attestation.epoch,
          enabled:attestation.deviceEnabled,scope:attestation.scope
        };
        const databaseRecord={
          deviceId:attestation.deviceId,epoch:attestation.epoch,
          sequence:attestation.sequence,digest:attestation.digest,
          acceptedAtMs:attestation.acceptedAtMs,
          status:attestation.databaseState
        };
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
        if(Object.keys(data).join('|')!==[
          'water/distanceCm','water/levelCm','water/status',
          'system/lastUpdate','system/overallRisk'
        ].join('|')){
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
            observedAtMs:stamp,overallRisk:'UNKNOWN'
          },
          checkpoint:{
            initialized:true,deviceId:envelope.deviceId,
            epoch:envelope.epoch,sequence:plan.sequence,
            digest:plan.nextCheckpoint.digest,observedAtMs:stamp
          }
        };
      },undefined,false);
      if(!txn.committed)return deny(reason);
      return Object.freeze({
        published:true,kind:'SIGNED_NARROW_EMULATOR_ONLY',
        sequence:committedSequence
      });
    }catch{
      // A transport failure may occur after RTDB COMMITTED the update but
      // before the SDK reports success. Read only our already scoped
      // publication subtree; exact checkpoint AND visible values must match.
      // A missing/advanced/conflicting/unreadable record is UNKNOWN.
      // A failed INITIAL read is not a lost transaction acknowledgment.
      // Reconcile only after a transaction was actually attempted.
      return transactionAttempted&&ref&&verifiedPlan?.allowed===true
        ?await recoverRead():deny('publisher-outcome-unknown');
    }finally{
      if(detach)detach();
    }
  };
}
