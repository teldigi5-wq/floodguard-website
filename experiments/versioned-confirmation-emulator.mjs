// Versioned confirmation prototype. ONLY isolated local RTDB Emulator.
// The confirmer writes a write-once path; a distinct read-only attestor
// checks that immutable record and signs a short-lived publication claim.
// No cloud Admin SDK, public listener, device command or production keys.
import {createHash,sign,verify,KeyObject} from 'node:crypto';
import {canonicalOfflineEnvelope} from './stage7-durable-ingress.mjs';
import {verifyStage8OfflineReceipt} from './stage8-ack-reconciliation.mjs';
import {canonicalSyntheticPublicationAttestation} from './synthetic-publication-attestation.mjs';

const EMULATOR='127.0.0.1:9000';
const ROOT='/floodguard';
const SIG=/^[A-Za-z0-9_-]{86}$/;
const DEV=/^device-stage-[a-z0-9-]{1,32}$/;
const FRAME=['sequence','distanceCm','levelCm','risk'];
const KEYS=['version','epoch','sequence','digest','acceptedAtMs','observedAtMs','frame'];
const rec=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const exact=(x,fields)=>rec(x)&&Object.keys(x).length===fields.length&&
  fields.every(k=>Object.hasOwn(x,k));
const isPub=x=>x instanceof KeyObject&&x.type==='public'&&x.asymmetricKeyType==='ed25519';
const isPrivate=x=>x instanceof KeyObject&&x.type==='private'&&x.asymmetricKeyType==='ed25519';
const deny=reason=>Object.freeze({ok:false,reason});
const fixedRead=async(db,p)=>(await db.ref(p).get()).val();

function validateEvidence({envelope,deviceSignature,receipt,receiptSignature},
    deviceId,devicePublicKey,receiptPublicKey,now) {
  let canonical;
  try{
    canonical=canonicalOfflineEnvelope(envelope);
    if(envelope.deviceId!==deviceId||envelope.epoch!==1||
       !Number.isSafeInteger(now)||now<0||
       envelope.observedAtMs<now-30000||envelope.observedAtMs>now+2000||
       typeof deviceSignature!=='string'||!SIG.test(deviceSignature)||
       Buffer.from(deviceSignature,'base64url').length!==64||
       !verify(null,Buffer.from(canonical),devicePublicKey,
          Buffer.from(deviceSignature,'base64url')))return null;
    const digest=createHash('sha256').update(canonical).digest('hex');
    if(!verifyStage8OfflineReceipt({
      receipt,signature:receiptSignature,publicKey:receiptPublicKey,
      expected:{deviceId,epoch:1,sequence:envelope.frame.sequence,digest}
    })||receipt.acceptedAtMs<envelope.observedAtMs||
       receipt.acceptedAtMs<now-30000||receipt.acceptedAtMs>now+2000)
      return null;
    return {digest};
  }catch{return null;}
}
function recordFor(envelope,receipt,digest){
  return {
    version:'floodguard-confirmed-record-v1',epoch:1,
    sequence:envelope.frame.sequence,digest,
    acceptedAtMs:receipt.acceptedAtMs,
    observedAtMs:envelope.observedAtMs,
    frame:{...envelope.frame}
  };
}
const fp=pub=>createHash('sha256')
  .update(pub.export({format:'der',type:'spki'})).digest('hex');
function requireSetup(db,deviceId,devicePublicKey,receiptPublicKey,clock){
  if(!db||typeof db.ref!=='function'||!DEV.test(deviceId)||
     !isPub(devicePublicKey)||!isPub(receiptPublicKey)||
     typeof clock!=='function')throw TypeError('Independent test issuer setup required');
}

export function createVersionedEmulatorConfirmer({
  database,deviceId,devicePublicKey,receiptPublicKey,clock
}={}){
  requireSetup(database,deviceId,devicePublicKey,receiptPublicKey,clock);
  return async function confirm(message){
    if(process.env.FG_VERSIONED_CONFIRMATION_TEST!=='1'||
       process.env.FIREBASE_DATABASE_EMULATOR_HOST!==EMULATOR)
      return deny('strict-emulator-only');
    const evidence=validateEvidence(message,deviceId,devicePublicKey,receiptPublicKey,clock());
    if(!evidence)return deny('source-or-receipt-unverified');
    const {envelope,receipt}=message;
    const base=ROOT+'/confirmedLab/records/'+deviceId+'/'+envelope.frame.sequence;
    try{
      const [operator,auth,staged]=await Promise.all([
        fixedRead(database,ROOT+'/confirmerLabAuthorization/confirmer-stage'),
        fixedRead(database,ROOT+'/deviceAuthorization/'+deviceId),
        fixedRead(database,ROOT+'/staging/ingestV1/'+deviceId)
      ]);
      if(!exact(operator,['enabled','scope','deviceId','epoch','deviceKeyFingerprint'])||
         operator.enabled!==true||operator.scope!=='confirmer-ingest-v1'||
         operator.deviceId!==deviceId||operator.epoch!==1||
         operator.deviceKeyFingerprint!==fp(devicePublicKey)||
         !exact(auth,['enabled','scope'])||auth.enabled!==true||
         auth.scope!=='prototype-ingest-v1')return deny('operator-not-authorized');
      if(!exact(staged,FRAME)||FRAME.some(k=>staged[k]!==envelope.frame[k]))
        return deny('staged-frame-mismatch');
      const candidate=recordFor(envelope,receipt,evidence.digest);
      // The Firebase rule atomically checks that the staged frame is
      // STILL identical, device enabled, record absent and writer bound.
      // A normal set fails if a second concurrent confirmer won.
      await database.ref(base).set(candidate);
      return Object.freeze({ok:true,kind:'IMMUTABLE_EMULATOR_RECORD_ONLY',
        deviceId,sequence:envelope.frame.sequence,digest:evidence.digest});
    }catch{return deny('confirmed-record-write-denied');}
  };
}

export function createVersionedEmulatorAttestor({
  database,deviceId,devicePublicKey,receiptPublicKey,
  attestationPrivateKey,clock
}={}){
  requireSetup(database,deviceId,devicePublicKey,receiptPublicKey,clock);
  if(!isPrivate(attestationPrivateKey))throw TypeError('Private attestor key required');
  return async function attest(message){
    if(process.env.FG_VERSIONED_CONFIRMATION_TEST!=='1'||
       process.env.FIREBASE_DATABASE_EMULATOR_HOST!==EMULATOR)
      return deny('strict-emulator-only');
    const now=clock();
    const evidence=validateEvidence(message,deviceId,devicePublicKey,receiptPublicKey,now);
    if(!evidence)return deny('source-or-receipt-unverified');
    const {envelope,receipt}=message;
    const recordPath=ROOT+'/confirmedLab/records/'+deviceId+'/'+envelope.frame.sequence;
    try{
      const [operator,auth,confirmed]=await Promise.all([
        fixedRead(database,ROOT+'/attestorLabAuthorization/attestor-stage'),
        fixedRead(database,ROOT+'/deviceAuthorization/'+deviceId),
        fixedRead(database,recordPath)
      ]);
      if(!exact(operator,['enabled','scope','deviceId','epoch','deviceKeyFingerprint'])||
         operator.enabled!==true||operator.scope!=='attestor-ingest-v1'||
         operator.deviceId!==deviceId||operator.epoch!==1||
         operator.deviceKeyFingerprint!==fp(devicePublicKey)||
         !exact(auth,['enabled','scope'])||auth.enabled!==true||
         auth.scope!=='prototype-ingest-v1')return deny('operator-not-authorized');
      if(!exact(confirmed,KEYS)||confirmed.version!=='floodguard-confirmed-record-v1'||
         confirmed.epoch!==envelope.epoch||
         confirmed.sequence!==envelope.frame.sequence||
         confirmed.digest!==evidence.digest||
         confirmed.acceptedAtMs!==receipt.acceptedAtMs||
         confirmed.observedAtMs!==envelope.observedAtMs||
         !exact(confirmed.frame,FRAME)||
         FRAME.some(k=>confirmed.frame[k]!==envelope.frame[k]))
        return deny('immutable-confirmation-unverified');
      // No mutable staging read: this object cannot be deleted/overwritten
      // by any normal client, even after new staged sequence arrives.
      const confirmedAtMs=clock();
      if(!Number.isSafeInteger(confirmedAtMs)||
         confirmedAtMs<receipt.acceptedAtMs||confirmedAtMs>now+2000)
        return deny('issuer-clock-unavailable');
      const attestation={
        version:'floodguard-synthetic-persisted-attestation-v1',
        deviceId,epoch:1,sequence:envelope.frame.sequence,
        digest:evidence.digest,acceptedAtMs:receipt.acceptedAtMs,
        confirmedAtMs,scope:auth.scope,deviceEnabled:auth.enabled,
        databaseState:'DATABASE_CONFIRMED'
      };
      return Object.freeze({
        ok:true,kind:'VERSIONED_EMULATOR_ATTESTATION_ONLY',
        attestation:Object.freeze(attestation),
        attestationSignature:sign(null,Buffer.from(
          canonicalSyntheticPublicationAttestation(attestation)),
          attestationPrivateKey).toString('base64url')
      });
    }catch{return deny('immutable-record-read-unavailable');}
  };
}
