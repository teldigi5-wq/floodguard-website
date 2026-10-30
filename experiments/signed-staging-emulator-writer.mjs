// Isolated LOCAL RTDB Emulator only. Not a device gateway, cloud publisher,
// Firebase Auth token issuer or production service. Never use Admin privileges.
// A caller must explicitly inject a narrowly authenticated emulator client.
// This bridge verifies both an Ed25519 device signature and an independent
// signed acceptance receipt before attempting the ONLY permitted staging path.
import {createHash,verify,KeyObject} from 'node:crypto';
import {canonicalOfflineEnvelope} from './stage7-durable-ingress.mjs';
import {verifyStage8OfflineReceipt} from './stage8-ack-reconciliation.mjs';

const EMULATOR='127.0.0.1:9000';
const UID=/^device-stage-[a-z0-9-]{1,32}$/;
const SIGNATURE=/^[A-Za-z0-9_-]{86}$/;
const MAX_AGE_MS=30000,MAX_FUTURE_MS=2000;
const accepted=({sequence})=>Object.freeze({
  staged:true,kind:'EMULATOR_CLIENT_WRITE_ACK_ONLY',sequence
});
const denied=reason=>Object.freeze({staged:false,reason});
const publicEd25519=k=>k instanceof KeyObject&&
  k.type==='public'&&k.asymmetricKeyType==='ed25519';
const fingerprint=k=>createHash('sha256')
  .update(k.export({format:'der',type:'spki'})).digest('hex');
const verifySignature=(text,signature,key)=>{
  if(typeof signature!=='string'||!SIGNATURE.test(signature))return false;
  const bytes=Buffer.from(signature,'base64url');
  return bytes.length===64&&verify(null,Buffer.from(text,'utf8'),key,bytes);
};
/**
 * operatorRegistry: immutable, operator-owned HMAC-sealed LOCAL identity
 * registry, never mutable client-provided auth metadata.
 * replayLedger: separate HMAC-sealed LOCAL receipt of last accepted sequence.
 * database: RTDB emulator rules-unit-testing CLIENT, not service account.
 * No fallback or automatic retry if the client loses the write ACK.
 */
export function createSignedStagingEmulatorWriter({
  database,deviceId,operatorRegistry,replayLedger,receiptIssuerPublicKey,clock
}={}){
  if(!UID.test(deviceId)||!database||typeof database.ref!=='function'||
     !operatorRegistry||typeof operatorRegistry.get!=='function'||
     typeof operatorRegistry.status!=='function'||!Object.isFrozen(operatorRegistry)||
     !replayLedger||typeof replayLedger.last!=='function'||
     !Object.isFrozen(replayLedger)||!publicEd25519(receiptIssuerPublicKey)||
     typeof clock!=='function')
    throw new TypeError('Explicit scoped emulator client, trusted keys, sealed ledgers and clock required');

  const stagingPath='/floodguard/staging/ingestV1/'+deviceId;
  return async function stage({envelope,deviceSignature,receipt,receiptSignature}={}){
    if(process.env.FG_SIGNED_STAGING_BRIDGE_TEST!=='1'||
       process.env.FIREBASE_DATABASE_EMULATOR_HOST!==EMULATOR)
      return denied('local-emulator-only');
    let text,now,binding,checkpoint;
    try{
      text=canonicalOfflineEnvelope(envelope);
      now=clock();
      if(!Number.isSafeInteger(now)||now<0)return denied('clock-unavailable');
      if(envelope.deviceId!==deviceId)return denied('device-path-mismatch');
      if(envelope.observedAtMs<now-MAX_AGE_MS||
         envelope.observedAtMs>now+MAX_FUTURE_MS)
        return denied('observation-not-fresh');

      // The registry and replay ledger are reread for EACH invocation. Their
      // absence, corruption or inconsistent epoch/key is a hard stop.
      binding=operatorRegistry.get(deviceId);
      if(!binding||binding.enabled!==true||
         binding.scope!=='prototype-ingest-v1'||
         binding.epoch!==envelope.epoch||
         !publicEd25519(binding.publicKey))
        return denied('operator-identity-unverified');
      if(!verifySignature(text,deviceSignature,binding.publicKey))
        return denied('device-signature-invalid');

      const digest=createHash('sha256').update(text).digest('hex');
      if(!verifyStage8OfflineReceipt({
        receipt,signature:receiptSignature,publicKey:receiptIssuerPublicKey,
        expected:{deviceId,epoch:envelope.epoch,
          sequence:envelope.frame.sequence,digest}
      })||receipt.acceptedAtMs<envelope.observedAtMs||
         receipt.acceptedAtMs<now-MAX_AGE_MS||
         receipt.acceptedAtMs>now+MAX_FUTURE_MS)
        return denied('signed-receipt-unverified');

      checkpoint=replayLedger.last(deviceId);
      if(!checkpoint||checkpoint.epoch!==envelope.epoch||
         checkpoint.keyFingerprint!==fingerprint(binding.publicKey)||
         checkpoint.sequence!==envelope.frame.sequence)
        return denied('sealed-replay-checkpoint-mismatch');
    }catch{
      // Avoid revealing keys, read paths or any raw signed sensor frame.
      return denied('identity-or-evidence-unavailable');
    }

    // IMPORTANT: The actual emulator RTDB rules independently authorize
    // this device UID and signed-in claim. No privileged bypass is used.
    // The accepted payload contains exactly the four public safe fields.
    const frame={
      sequence:envelope.frame.sequence,
      distanceCm:envelope.frame.distanceCm,
      levelCm:envelope.frame.levelCm,
      risk:envelope.frame.risk
    };
    try{
      await database.ref(stagingPath).set(frame);
      // The SDK reported completion, NOT independently confirmed durability.
      return accepted({sequence:frame.sequence});
    }catch{
      // A transaction may have committed before ACK was lost. Never retry or
      // infer a published/safe state without separate trusted attestation.
      return denied('staging-write-outcome-unverified');
    }
  };
}
