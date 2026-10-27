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

/**
 * The independent bootstrap supplies the two already-approved issuer keys
 * ONCE. Untrusted messages cannot change trust anchors or provide their own
 * "expected fingerprint". The authenticated database client is constrained
 * by the isolated RTDB Security Rules. No production client is created.
 */
export function createSignedNarrowEmulatorPublisher({
  database,trustedReceiptKey,trustedAttestationKey,clock
}={}) {
  if(!database||typeof database.ref!=='function'||
     !publicEd25519(trustedReceiptKey)||
     !publicEd25519(trustedAttestationKey)||
     typeof clock!=='function')
    throw new TypeError('Explicit scoped emulator client, two trusted issuer keys and clock required');
  return async function publish(message) {
    if(process.env.FG_NARROW_SIGNED_BRIDGE_TEST!=='1'||
       process.env.FIREBASE_DATABASE_EMULATOR_HOST!==EMULATOR)
      return deny('strict-emulator-only');
    if(!exact(message,requestFields))
      return deny('invalid-request');
    const {envelope,receipt,signature,attestation,attestationSignature}=message;
    let detach,reason='transaction-aborted',committedSequence;
    try{
      // Trust is verified without looking at the caller's claimed registry
      // or confirmation record. No per-message key/issuer overrides exist.
      if(!verifySyntheticPublicationAttestation({
        attestation,signature:attestationSignature,
        publicKey:trustedAttestationKey,receipt,nowMs:clock()
      }))return deny('confirmed-attestation-unverified');

      const ref=database.ref(PATH);
      const initial=await new Promise((resolve,reject)=>{
        let received=false;
        const onValue=snap=>{if(!received){received=true;resolve(snap);}};
        detach=()=>ref.off('value',onValue);
        ref.on('value',onValue,reject);
      });
      if(!initial.exists())return deny('publication-state-unavailable');
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
      // Transport loss after commit means UNKNOWN outcome. A separate,
      // authorized durable checkpoint reconciliation is required.
      return deny('publisher-outcome-unknown');
    }finally{
      if(detach)detach();
    }
  };
}
