// Research-only read-only RTDB emulator attestor. No production endpoint,
// secrets loading, Admin SDK, internet clients, or auto-started service.
// The lab issuer is provisioned out of band. Its private signing key MUST
// never be sent to a device or the narrow publisher.
import {createHash,sign,verify,KeyObject} from 'node:crypto';
import {canonicalOfflineEnvelope} from './stage7-durable-ingress.mjs';
import {verifyStage8OfflineReceipt} from './stage8-ack-reconciliation.mjs';
import {canonicalSyntheticPublicationAttestation}
  from './synthetic-publication-attestation.mjs';

const EMULATOR='127.0.0.1:9000';
const ROOT='/floodguard';
const UID=/^device-stage-[a-z0-9-]{1,32}$/;
const SIG=/^[A-Za-z0-9_-]{86}$/;
const KEYS=['sequence','distanceCm','levelCm','risk'];
const isRecord=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const exact=(x,keys)=>isRecord(x)&&Object.keys(x).length===keys.length&&
  keys.every(k=>Object.hasOwn(x,k));
const ed=x=>x instanceof KeyObject&&x.asymmetricKeyType==='ed25519';
const deny=reason=>Object.freeze({issued:false,reason});

export function createReadOnlyEmulatorAttestor({
  database,deviceId,devicePublicKey,receiptPublicKey,
  attestationPrivateKey,clock
}={}) {
  if(!database||typeof database.ref!=='function'||
     !UID.test(deviceId)||!ed(devicePublicKey)||
     devicePublicKey.type!=='public'||
     !ed(receiptPublicKey)||receiptPublicKey.type!=='public'||
     !ed(attestationPrivateKey)||attestationPrivateKey.type!=='private'||
     typeof clock!=='function')
    throw new TypeError('Read-only lab database, device, keys and clock are required');
  const keyFingerprint=createHash('sha256').update(
    devicePublicKey.export({format:'der',type:'spki'})
  ).digest('hex');

  return async function attest({envelope,deviceSignature,receipt,receiptSignature}={}) {
    if(process.env.FG_READ_ONLY_ATTESTOR_TEST!=='1'||
       process.env.FIREBASE_DATABASE_EMULATOR_HOST!==EMULATOR)
      return deny('strict-emulator-only');
    let canonical;
    try {
      canonical=canonicalOfflineEnvelope(envelope);
      if(envelope.deviceId!==deviceId||envelope.epoch!==1)
        return deny('device-source-mismatch');
      const now=clock();
      if(!Number.isSafeInteger(now)||now<0||
         envelope.observedAtMs<now-30000||
         envelope.observedAtMs>now+2000)
        return deny('observation-clock-invalid');
      if(typeof deviceSignature!=='string'||!SIG.test(deviceSignature)||
         !verify(null,Buffer.from(canonical),devicePublicKey,
           Buffer.from(deviceSignature,'base64url')))
        return deny('device-signature-invalid');
      const digest=createHash('sha256').update(canonical).digest('hex');
      if(!verifyStage8OfflineReceipt({
        receipt,signature:receiptSignature,publicKey:receiptPublicKey,
        expected:{
          deviceId,epoch:envelope.epoch,
          sequence:envelope.frame.sequence,digest
        }
      }))return deny('receipt-signature-invalid');
      if(receipt.acceptedAtMs<envelope.observedAtMs||
         receipt.acceptedAtMs<now-30000||
         receipt.acceptedAtMs>now+2000)
        return deny('receipt-clock-invalid');

      const operatorPath=ROOT+'/attestorLabAuthorization/attestor-stage';
      const authPath=ROOT+'/deviceAuthorization/'+deviceId;
      const stagePath=ROOT+'/staging/ingestV1/'+deviceId;
      // The TEST identity can read only these fixed paths. It cannot write
      // them, inspect contacts/ESP networking, or access publication checkpoint.
      const read=async path=>(await database.ref(path).get()).val();
      const [operator,authorization,staged]=await Promise.all([
        read(operatorPath),read(authPath),read(stagePath)
      ]);
      if(!exact(operator,['enabled','scope','deviceId','epoch','deviceKeyFingerprint'])||
         operator.enabled!==true||operator.scope!=='attestor-ingest-v1'||
         operator.deviceId!==deviceId||operator.epoch!==envelope.epoch||
         operator.deviceKeyFingerprint!==keyFingerprint||
         !exact(authorization,['enabled','scope'])||
         authorization.enabled!==true||
         authorization.scope!=='prototype-ingest-v1')
        return deny('device-authorization-unverified');
      if(!exact(staged,KEYS)||
         KEYS.some(field=>staged[field]!==envelope.frame[field]))
        return deny('staged-frame-not-confirmed');

      // Double-read narrows but DOES NOT eliminate cross-path TOCTOU:
      // production requires a versioned immutable confirmed record and
      // transactionally consistent issuance to resolve post-read races.
      const [stillOperator,stillAuthorized,stillStaged]=await Promise.all([
        read(operatorPath),read(authPath),read(stagePath)
      ]);
      if(JSON.stringify(operator)!==JSON.stringify(stillOperator)||
         JSON.stringify(authorization)!==JSON.stringify(stillAuthorized)||
         JSON.stringify(staged)!==JSON.stringify(stillStaged))
        return deny('confirmation-race-detected');
      const confirmedAtMs=clock();
      if(!Number.isSafeInteger(confirmedAtMs)||
         confirmedAtMs<receipt.acceptedAtMs||
         confirmedAtMs>now+2000)
        return deny('confirmation-clock-invalid');
      const attestation={
        version:'floodguard-synthetic-persisted-attestation-v1',
        deviceId,epoch:envelope.epoch,
        sequence:envelope.frame.sequence,digest,
        acceptedAtMs:receipt.acceptedAtMs,
        confirmedAtMs,scope:authorization.scope,
        deviceEnabled:authorization.enabled,
        databaseState:'DATABASE_CONFIRMED'
      };
      const attestationSignature=sign(null,
        Buffer.from(canonicalSyntheticPublicationAttestation(attestation)),
        attestationPrivateKey).toString('base64url');
      return Object.freeze({
        issued:true,kind:'READ_ONLY_EMULATOR_ATTESTATION_NOT_PRODUCTION',
        attestation:Object.freeze(attestation),attestationSignature
      });
    }catch{
      return deny('attestor-read-or-evidence-unavailable');
    }
  };
}
