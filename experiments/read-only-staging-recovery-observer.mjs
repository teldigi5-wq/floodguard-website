// Local RTDB emulator-only, independently scoped READ-ONLY reconciliation.
// NOT a production cloud-durability receipt, ACK replay, publishing gate,
// Firebase Admin client or automatically invoked recovery process.
import {createHash,verify,KeyObject} from 'node:crypto';
import {canonicalOfflineEnvelope} from './stage7-durable-ingress.mjs';
import {verifyStage8OfflineReceipt} from './stage8-ack-reconciliation.mjs';

const EMULATOR='127.0.0.1:9000';
const ID=/^device-stage-[a-z0-9-]{1,32}$/;
const SIG=/^[A-Za-z0-9_-]{86}$/;
const exact=(data,keys)=>data!==null&&typeof data==='object'&&
  !Array.isArray(data)&&Object.keys(data).length===keys.length&&
  keys.every(k=>Object.hasOwn(data,k));
const pub=k=>k instanceof KeyObject&&k.type==='public'&&k.asymmetricKeyType==='ed25519';
const sha=k=>createHash('sha256').update(
  k.export({type:'spki',format:'der'})).digest('hex');
const reply=(status)=>Object.freeze({observed:false,status});
const approvedFields=['sequence','distanceCm','levelCm','risk','epoch',
  'digest','issuedAtMs','expiresAtMs'];
const stageFields=['sequence','distanceCm','levelCm','risk'];

export function createReadOnlyStagingRecoveryObserver({
  database,deviceId,operatorRegistry,replayLedger,receiptIssuerPublicKey,
  clock,readDeadlineMs=3000
}={}){
  if(!ID.test(deviceId)||!database||typeof database.ref!=='function'||
     !operatorRegistry||typeof operatorRegistry.get!=='function'||
     typeof operatorRegistry.status!=='function'||!Object.isFrozen(operatorRegistry)||
     !replayLedger||typeof replayLedger.last!=='function'||!Object.isFrozen(replayLedger)||
     !pub(receiptIssuerPublicKey)||typeof clock!=='function'||
     !Number.isSafeInteger(readDeadlineMs)||readDeadlineMs<50||readDeadlineMs>10000)
    throw new TypeError('Explicit scoped read-only observer, sealed trust, bounded deadline required');

  const root='/floodguard';
  const paths=[root+'/ingestApprovalLab/'+deviceId,
    root+'/staging/ingestV1/'+deviceId,
    root+'/deviceAuthorization/'+deviceId];
  const snapshot=async()=>{
    const read=async path=>(await database.ref(path).get()).val();
    return Promise.all(paths.map(read));
  };
  return async function reconcile({envelope,deviceSignature,receipt,receiptSignature}={}){
    if(process.env.FG_STAGING_OBSERVER_TEST!=='1'||
       process.env.FIREBASE_DATABASE_EMULATOR_HOST!==EMULATOR)
      return reply('local-emulator-only');
    let digest;
    try{
      const canonical=canonicalOfflineEnvelope(envelope);
      if(envelope.deviceId!==deviceId)return reply('device-path-mismatch');
      const current=clock();
      if(!Number.isSafeInteger(current)||current<0||current>Number.MAX_SAFE_INTEGER-2000||
         envelope.observedAtMs>current+2000)
        return reply('observer-clock-or-source-invalid');
      const binding=operatorRegistry.get(deviceId);
      if(!binding||!binding.enabled||binding.scope!=='prototype-ingest-v1'||
         binding.epoch!==envelope.epoch||!pub(binding.publicKey))
        return reply('operator-binding-unverified');
      if(typeof deviceSignature!=='string'||!SIG.test(deviceSignature)||
         Buffer.from(deviceSignature,'base64url').length!==64||
         !verify(null,Buffer.from(canonical),binding.publicKey,
           Buffer.from(deviceSignature,'base64url')))
        return reply('device-signature-invalid');
      digest=createHash('sha256').update(canonical).digest('hex');
      if(!verifyStage8OfflineReceipt({
        receipt,signature:receiptSignature,publicKey:receiptIssuerPublicKey,
        expected:{deviceId,epoch:envelope.epoch,
          sequence:envelope.frame.sequence,digest}
      })||receipt.acceptedAtMs<envelope.observedAtMs||
         receipt.acceptedAtMs>current+2000)
        return reply('receipt-unverified');
      const checkpoint=replayLedger.last(deviceId);
      if(!checkpoint||checkpoint.epoch!==envelope.epoch||
         checkpoint.sequence<envelope.frame.sequence||
         checkpoint.keyFingerprint!==sha(binding.publicKey))
        return reply('sealed-history-unverified');
    }catch{
      return reply('signed-evidence-unavailable');
    }

    // Limit the total duration of BOTH reads. Promise.race does not cancel
    // SDK reads, but no mutating side effect can occur in this observer.
    let timeout;
    let first,second;
    try{
      [first,second]=await Promise.race([
        (async()=>[await snapshot(),await snapshot()])(),
        new Promise((_,reject)=>{
          timeout=setTimeout(()=>reject(Error('observer-timeout')),readDeadlineMs);
        })
      ]);
    }catch{
      return reply('observation-unavailable');
    }finally{
      clearTimeout(timeout);
    }

    if(JSON.stringify(first)!==JSON.stringify(second))
      return reply('concurrent-state-change-unverified');
    const [approval,staged,auth]=second;
    if(!exact(auth,['enabled','scope','epoch'])||
       auth.enabled!==true||auth.scope!=='prototype-ingest-v1'||
       auth.epoch!==envelope.epoch)
      return reply('cloud-authorization-unverified');

    const matches=(data,keys)=>keys.every(k=>data[k]===envelope.frame[k]);
    if(approval!==null){
      if(!exact(approval,approvedFields)||
         !matches(approval,stageFields)||approval.epoch!==envelope.epoch||
         approval.digest!==digest||
         !Number.isSafeInteger(approval.issuedAtMs)||
         !Number.isSafeInteger(approval.expiresAtMs)||
         approval.expiresAtMs<=approval.issuedAtMs||
         approval.expiresAtMs>approval.issuedAtMs+30000)
        return reply('conflicting-approval-unverified');
    }
    if(staged!==null){
      if(!exact(staged,stageFields)||
         !Number.isSafeInteger(staged.sequence)||staged.sequence<1)
        return reply('conflicting-stage-unverified');
      if(staged.sequence>envelope.frame.sequence)
        return reply('later-stage-observed-unknown-for-target');
      if(staged.sequence===envelope.frame.sequence){
        if(!matches(staged,stageFields)||approval===null)
          return reply('conflicting-stage-unverified');
        return Object.freeze({
          observed:true,status:'matching-stage-and-approval-observed-in-emulator-only',
          sequence:staged.sequence
        });
      }
    }
    if(approval!==null)
      return reply('approval-only-observed-no-target-stage');
    return reply('target-not-observed-unsafe-to-retry');
  };
}
