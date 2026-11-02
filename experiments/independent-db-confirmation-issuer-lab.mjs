// FloodGuard R3 local database-confirmation issuer LAB. NEVER production.
// Reads a separate, HMAC-sealed Stage9 *synthetic* DB through an injected
// read-only capability. Does NOT trust an incoming DATABASE_CONFIRMED claim.
// Operator registry is a separately commissioned, sealed offline fixture.
// No listener, HTTP, Firebase, environment key loader, cloud ACK, or actuator.
// Simulated issuer keys do not authenticate an actual sensor or real DB.
import {createHash,createPublicKey,KeyObject,sign} from 'node:crypto';
import {verifyStage8OfflineReceipt}
  from './stage8-ack-reconciliation.mjs';
import {canonicalSyntheticPublicationAttestation,
  verifySyntheticPublicationAttestation}
  from './synthetic-publication-attestation.mjs';

const UID=/^device-stage-[a-z0-9-]{1,32}$/;
const HEX=/^[0-9a-f]{64}$/;
const exact=(x,fields)=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&
  (Object.getPrototypeOf(x)===Object.prototype||
   Object.getPrototypeOf(x)===null)&&
  Object.keys(x).length===fields.length&&fields.every(k=>Object.hasOwn(x,k));
const publicKey=x=>x instanceof KeyObject&&x.type==='public'&&x.asymmetricKeyType==='ed25519';
const privateKey=x=>x instanceof KeyObject&&x.type==='private'&&x.asymmetricKeyType==='ed25519';
const fingerprint=x=>createHash('sha256').update(
  x.export({type:'spki',format:'der'})).digest('hex');
const reject=reason=>Object.freeze({
  issued:false,reason,canPublish:false,canAcknowledge:false,
  canSendAlert:false,canOperateGate:false
});
const same=(a,b)=>a.deviceId===b.deviceId&&a.epoch===b.epoch&&
  a.sequence===b.sequence&&a.digest===b.digest&&
  a.acceptedAtMs===b.acceptedAtMs;
const RECORD=['deviceId','epoch','sequence','digest','acceptedAtMs','status'];
const usableTime=x=>Number.isSafeInteger(x)&&x>=946684800000;

/**
 * Constructor dependencies MUST be installed by an independent offline test
 * operator, never supplied by a public HTTP request. Frozen objects reduce
 * accidental mutation but are NOT a security boundary against a malicious
 * injected .get() function. Real issuer needs separately scoped DB identity.
 */
export function createIndependentDbConfirmationIssuerLab({
  databaseReader,operatorRegistry,receiptIssuerPublicKey,
  databaseIssuerPrivateKey,databaseIssuerPublicKey,clock
}={}) {
  if(!databaseReader||!Object.isFrozen(databaseReader)||
     typeof databaseReader.get!=='function'||
     Object.keys(databaseReader).some(k=>k!=='get')||
     !operatorRegistry||!Object.isFrozen(operatorRegistry)||
     typeof operatorRegistry.get!=='function'||
     typeof operatorRegistry.status!=='function'||
     !publicKey(receiptIssuerPublicKey)||
     !privateKey(databaseIssuerPrivateKey)||
     !publicKey(databaseIssuerPublicKey)||
     typeof clock!=='function')
    throw new TypeError('Explicit offline-only read capability, sealed registry, issuer keys and clock required');
  // Reject a swapped issuer-public key and signing-key reuse.
  if(fingerprint(createPublicKey(databaseIssuerPrivateKey))!==fingerprint(databaseIssuerPublicKey)||
     fingerprint(databaseIssuerPublicKey)===fingerprint(receiptIssuerPublicKey))
    throw new TypeError('Distinct pinned Ed25519 issuer signing role required');

  return Object.freeze({
    attest(request={}) {
      try {
        if(!exact(request,['receipt','receiptSignature']))
          return reject('request-shape-invalid');
        const {receipt,receiptSignature}=request;
        // No user-provided registry binding, DB status, signer or claimed
        // confirmedAtMs is accepted by this method.
        if(!exact(receipt,['version','deviceId','epoch','sequence','digest','acceptedAtMs'])||
           !UID.test(receipt.deviceId)||receipt.version!=='floodguard-offline-receipt-v1'||
           !Number.isSafeInteger(receipt.epoch)||receipt.epoch<1||
           receipt.epoch>10000||!Number.isSafeInteger(receipt.sequence)||
           receipt.sequence<1||receipt.sequence>2147483647||
           typeof receipt.digest!=='string'||!HEX.test(receipt.digest))
          return reject('receipt-invalid');
        const now=clock();
        if(!usableTime(now)||!usableTime(receipt.acceptedAtMs)||
           receipt.acceptedAtMs>now||now-receipt.acceptedAtMs>5000)
          return reject('confirmation-window-invalid');
        if(!verifyStage8OfflineReceipt({
          receipt,signature:receiptSignature,publicKey:receiptIssuerPublicKey
        }))return reject('acceptance-signature-invalid');
        const before=operatorRegistry.status();
        const binding=operatorRegistry.get(receipt.deviceId);
        if(!Number.isSafeInteger(before?.revision)||before.revision<1||
           !binding?.enabled||binding.scope!=='prototype-ingest-v1'||
           binding.epoch!==receipt.epoch||!publicKey(binding.publicKey)||
           new Set([fingerprint(binding.publicKey),
             fingerprint(receiptIssuerPublicKey),
             fingerprint(databaseIssuerPublicKey)]).size!==3)
          return reject('operator-authorization-unverified');
        // This is the only database confirmation source. It reads the
        // separately stored Stage9 record; no client-supplied record allowed.
        const stored=databaseReader.get(receipt.deviceId);
        if(!exact(stored,RECORD)||stored.status!=='DATABASE_CONFIRMED'||
           !same(stored,receipt))
          return reject('independent-database-read-unconfirmed');
        const after=operatorRegistry.status();
        const latest=operatorRegistry.get(receipt.deviceId);
        if(after?.revision!==before.revision||
           !latest?.enabled||latest.epoch!==binding.epoch||
           latest.scope!=='prototype-ingest-v1'||
           !publicKey(latest.publicKey)||
           fingerprint(latest.publicKey)!==fingerprint(binding.publicKey))
          return reject('operator-authorization-changed');
        const attestation=Object.freeze({
          version:'floodguard-synthetic-persisted-attestation-v1',
          deviceId:stored.deviceId,epoch:stored.epoch,sequence:stored.sequence,
          digest:stored.digest,acceptedAtMs:stored.acceptedAtMs,
          confirmedAtMs:now,scope:'prototype-ingest-v1',
          deviceEnabled:true,databaseState:'DATABASE_CONFIRMED'
        });
        const signature=sign(null,Buffer.from(
          canonicalSyntheticPublicationAttestation(attestation)),
          databaseIssuerPrivateKey).toString('base64url');
        if(!verifySyntheticPublicationAttestation({
          attestation,signature,publicKey:databaseIssuerPublicKey,receipt,nowMs:now
        }))return reject('issuer-self-verification-failed');
        return Object.freeze({
          issued:true,kind:'LOCAL_SYNTHETIC_DB_READ_ATTESTATION_NOT_PUBLISHED',
          attestation,signature,
          // A LOCAL confirmed record, not independently authenticated cloud.
          databaseRecord:Object.freeze({...stored}),
          canPublish:false,canAcknowledge:false,
          canSendAlert:false,canOperateGate:false
        });
      }catch{
        // Never expose internal file paths, public keys, signer errors,
        // raw input data, or mutate an inaccessible test store.
        return reject('offline-authority-or-db-unavailable');
      }
    }
  });
}
