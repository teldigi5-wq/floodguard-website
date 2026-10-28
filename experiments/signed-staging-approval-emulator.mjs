// TEST ONLY: a separately scoped verifier issues a short-lived, exact-frame
// staging grant in the local RTDB emulator. No Firebase Admin SDK, production
// Auth minting, network listener, cloud account, or live device credentials.
import {createHash,verify,KeyObject} from 'node:crypto';
import {canonicalOfflineEnvelope} from './stage7-durable-ingress.mjs';
import {verifyStage8OfflineReceipt} from './stage8-ack-reconciliation.mjs';

const ID=/^device-stage-[a-z0-9-]{1,32}$/;
const SIG=/^[A-Za-z0-9_-]{86}$/;
const usableKey=k=>k instanceof KeyObject&&k.type==='public'&&k.asymmetricKeyType==='ed25519';
const fingerprint=k=>createHash('sha256').update(
  k.export({type:'spki',format:'der'})
).digest('hex');
const reject=reason=>Object.freeze({approved:false,reason});

export function createSignedStagingApprovalEmulator({
  database,deviceId,operatorRegistry,replayLedger,receiptIssuerPublicKey,clock
}={}){
  if(!ID.test(deviceId)||!database||typeof database.ref!=='function'||
     !operatorRegistry||typeof operatorRegistry.get!=='function'||
     typeof operatorRegistry.status!=='function'||!Object.isFrozen(operatorRegistry)||
     !replayLedger||typeof replayLedger.last!=='function'||!Object.isFrozen(replayLedger)||
     !usableKey(receiptIssuerPublicKey)||typeof clock!=='function')
    throw new TypeError('Explicit read-only trust roots and scoped verifier test client required');
  return async function approve({envelope,deviceSignature,receipt,receiptSignature}={}){
    if(process.env.FG_DUAL_AUTHORITY_TEST!=='1'||
       process.env.FIREBASE_DATABASE_EMULATOR_HOST!=='127.0.0.1:9000')
      return reject('local-emulator-only');
    let grant;
    try{
      const canonical=canonicalOfflineEnvelope(envelope);
      if(envelope.deviceId!==deviceId)return reject('device-path-mismatch');
      const now=clock();
      if(!Number.isSafeInteger(now)||now<0||now>Number.MAX_SAFE_INTEGER-10000)
        return reject('clock-unavailable');
      if(envelope.observedAtMs<now-30000||envelope.observedAtMs>now+2000)
        return reject('observation-not-fresh');
      const identity=operatorRegistry.get(deviceId);
      if(!identity||identity.enabled!==true||
         identity.scope!=='prototype-ingest-v1'||
         identity.epoch!==envelope.epoch||!usableKey(identity.publicKey))
        return reject('operator-identity-unverified');
      if(typeof deviceSignature!=='string'||!SIG.test(deviceSignature))
        return reject('device-signature-invalid');
      const signature=Buffer.from(deviceSignature,'base64url');
      if(signature.length!==64||!verify(
        null,Buffer.from(canonical),identity.publicKey,signature))
        return reject('device-signature-invalid');
      const digest=createHash('sha256').update(canonical).digest('hex');
      if(!verifyStage8OfflineReceipt({
        receipt,signature:receiptSignature,publicKey:receiptIssuerPublicKey,
        expected:{deviceId,epoch:envelope.epoch,
          sequence:envelope.frame.sequence,digest}
      })||receipt.acceptedAtMs<envelope.observedAtMs||
         receipt.acceptedAtMs<now-30000||receipt.acceptedAtMs>now+2000)
        return reject('signed-receipt-unverified');
      const checkpoint=replayLedger.last(deviceId);
      if(!checkpoint||checkpoint.epoch!==envelope.epoch||
         checkpoint.sequence!==envelope.frame.sequence||
         checkpoint.keyFingerprint!==fingerprint(identity.publicKey))
        return reject('sealed-checkpoint-unverified');
      grant={
        sequence:envelope.frame.sequence,
        distanceCm:envelope.frame.distanceCm,
        levelCm:envelope.frame.levelCm,
        risk:envelope.frame.risk,
        epoch:envelope.epoch,digest,
        issuedAtMs:now,expiresAtMs:now+10000
      };
    }catch{
      return reject('identity-or-evidence-unavailable');
    }
    try{
      await database.ref('/floodguard/ingestApprovalLab/'+deviceId).set(grant);
      return Object.freeze({
        approved:true,kind:'EMULATOR_APPROVAL_ACK_ONLY',sequence:grant.sequence
      });
    }catch{
      // An ACK loss may mean the grant exists. Do not replay, publish, or
      // manufacture a confirmation; an independent observer must reconcile.
      return reject('approval-write-outcome-unverified');
    }
  };
}
