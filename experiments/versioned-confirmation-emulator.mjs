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
// Verify every field against the independently signed candidate. Never
// accept a record merely because its device ID, sequence or digest matches.
// An existing record cannot be rewritten, including after a lost ACK.
function sameConfirmedRecord(stored,expected){
  return exact(stored,KEYS) &&
    KEYS.filter(k=>k!=='frame').every(k=>stored[k]===expected[k]) &&
    exact(stored.frame,FRAME) &&
    FRAME.every(k=>stored.frame[k]===expected.frame[k]);
}
const restored=(envelope,digest)=>Object.freeze({
  ok:true,kind:'RECOVERED_IMMUTABLE_EMULATOR_RECORD_ONLY',
  deviceId:envelope.deviceId,sequence:envelope.frame.sequence,digest
});
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
    const candidate=recordFor(envelope,receipt,evidence.digest);
    try{
      // Recheck the independent operator binding and active device before
      // using historical data; an old confirmation must not defeat revocation.
      const [operator,auth,existing]=await Promise.all([
        fixedRead(database,ROOT+'/confirmerLabAuthorization/confirmer-stage'),
        fixedRead(database,ROOT+'/deviceAuthorization/'+deviceId),
        fixedRead(database,base)
      ]);
      if(!exact(operator,['enabled','scope','deviceId','epoch','deviceKeyFingerprint'])||
         operator.enabled!==true||operator.scope!=='confirmer-ingest-v1'||
         operator.deviceId!==deviceId||operator.epoch!==1||
         operator.deviceKeyFingerprint!==fp(devicePublicKey)||
         !exact(auth,['enabled','scope'])||auth.enabled!==true||
         auth.scope!=='prototype-ingest-v1')return deny('operator-not-authorized');

      // Allows restart after a lost response, including when staging has
      // already advanced. Conflicting or malformed records are never treated
      // as success. A live database read is required, not a caller claim.
      if(existing!==null){
        return sameConfirmedRecord(existing,candidate)
          ?restored(envelope,evidence.digest)
          :deny('confirmed-record-conflict');
      }
      const staged=await fixedRead(database,ROOT+'/staging/ingestV1/'+deviceId);
      if(!exact(staged,FRAME)||FRAME.some(k=>staged[k]!==envelope.frame[k]))
        return deny('staged-frame-mismatch');
      try{
        // Rules compare the current staged frame at write time and forbid
        // rewriting even in a race with another confirmer.
        await database.ref(base).set(candidate);
        return Object.freeze({ok:true,kind:'IMMUTABLE_EMULATOR_RECORD_ONLY',
          deviceId,sequence:envelope.frame.sequence,digest:evidence.digest});
      }catch{
        // A dropped ACK can occur AFTER a successful commit. Re-read the
        // single allowlisted sequence path; never assume a failed request
        // means data did not persist. Do not retry the write blindly.
        try{
          const persisted=await fixedRead(database,base);
          if(persisted===null)return deny('confirmed-record-write-denied');
          return sameConfirmedRecord(persisted,candidate)
            ?restored(envelope,evidence.digest)
            :deny('confirmed-record-conflict');
        }catch{
          return deny('confirmed-record-outcome-unknown');
        }
      }
    }catch{return deny('confirmed-record-outcome-unknown');}
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
