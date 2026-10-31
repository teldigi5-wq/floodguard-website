// FloodGuard R3 — server-side policy-bound ingestion LAB.
// No network listener, Admin SDK, live Firebase, real device or credentials.
// Caller submits ONLY {stream,record}; it cannot supply the trust registry,
// issuer signing operation, database client, destination path or receipt.
// The actual receipt signer is an independently injected test-only capability.
// Production requires credential custody, device enrollment, replay-resistant
// authority, time ownership and audited deployment; this is NOT that service.
import {createHash,KeyObject,verify}
  from 'node:crypto';
import {canonicalR2PublicEvidence,verifyR2PublicEvidence}
  from './r2-dual-stream-public-evidence.mjs';
import {canonicalR2PublisherReceipt,R2_ISSUER_RECEIPT_VERSION}
  from './r2-attested-dual-stream-publisher.mjs';

const MIN_MS=Date.UTC(2000,0,1);
const STREAMS=['water','rain'];
const PATHS=Object.freeze({
  water:'/floodguard/attestedEvidenceLabV1/water',
  rain:'/floodguard/attestedEvidenceLabV1/rain'
});
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&
  (Object.getPrototypeOf(v)===Object.prototype||
   Object.getPrototypeOf(v)===null);
const exact=(v,fields)=>object(v)&&
  Object.keys(v).length===fields.length&&fields.every(f=>Object.hasOwn(v,f));
const number=v=>Number.isSafeInteger(v)&&v>=MIN_MS;
const key=k=>k instanceof KeyObject&&k.type==='public'&&
  k.asymmetricKeyType==='ed25519';
const signature=s=>typeof s==='string'&&/^[A-Za-z0-9_-]{86}$/.test(s)&&
  Buffer.from(s,'base64url').length===64;
const hash=v=>createHash('sha256').update(v,'utf8').digest('hex');
const fingerprint=k=>createHash('sha256')
  .update(k.export({type:'spki',format:'der'})).digest('hex');
const deny=reason=>Object.freeze({published:false,reason});

function verifiedSignedRecord(record,stream,trusted) {
  if(!exact(record,['payload','signature'])||!signature(record.signature)||
     record.payload?.stream!==stream)return false;
  try{
    const canonical=canonicalR2PublicEvidence(record.payload);
    return verify(null,Buffer.from(canonical,'utf8'),trusted,
      Buffer.from(record.signature,'base64url'));
  }catch{return false;}
}
function verifiedHistoricalEnvelope(value,stream,reportKey,issuerKey) {
  if(!exact(value,['report','acceptance'])||
     !exact(value.acceptance,['receipt','signature'])||
     !verifiedSignedRecord(value.report,stream,reportKey)||
     !signature(value.acceptance.signature))return false;
  const p=value.report.payload,receipt=value.acceptance.receipt;
  try{
    const canonical=canonicalR2PublisherReceipt(receipt);
    if(receipt.stream!==stream||receipt.sourceAlias!==p.sourceAlias||
       receipt.epoch!==p.epoch||receipt.sequence!==p.sequence||
       receipt.acceptedAtMs!==p.receivedAtMs||
       receipt.payloadDigest!==hash(canonicalR2PublicEvidence(p)))
      return false;
    return verify(null,Buffer.from(canonical,'utf8'),issuerKey,
      Buffer.from(value.acceptance.signature,'base64url'));
  }catch{return false;}
}

/**
 * Operator-owned configuration: pinned report/issuer Ed25519 public keys
 * and the current approved epoch for EACH source. Distinct roles/streams.
 * The issuer callback owns the signing capability outside this module.
 * No private keys, caller-controlled registry or runtime enrollment.
 */
export function createR3ServerVerifiedIngestLab({
  registry,issueSignedReceipt,databaseForStream,clock
}={}) {
  if(process.env.FG_R3_TRUSTED_INGEST_LAB_TEST!=='1'||
     process.env.FIREBASE_DATABASE_EMULATOR_HOST!=='127.0.0.1:9000')
    throw new Error('R3 ingestion gateway disabled outside loopback emulator');
  if(!exact(registry,STREAMS)||typeof issueSignedReceipt!=='function'||
     typeof databaseForStream!=='function'||typeof clock!=='function')
    throw new TypeError('Operator registry and isolated capabilities required');

  // Snapshot the configuration into closure-owned values so a caller cannot
  // toggle an enabled field after the gate was provisioned.
  const pins={},allFingerprints=[];
  for(const stream of STREAMS){
    const r=registry[stream];
    if(!exact(r,['enabled','epoch','reportPublicKey','issuerPublicKey'])||
       r.enabled!==true||!Number.isSafeInteger(r.epoch)||r.epoch<1||
       r.epoch>10000||!key(r.reportPublicKey)||!key(r.issuerPublicKey))
      throw new TypeError('Both operator-enrolled stream identities required');
    pins[stream]=Object.freeze({
      epoch:r.epoch,reportPublicKey:r.reportPublicKey,
      issuerPublicKey:r.issuerPublicKey
    });
    allFingerprints.push(fingerprint(r.reportPublicKey));
    allFingerprints.push(fingerprint(r.issuerPublicKey));
  }
  if(new Set(allFingerprints).size!==4)
    throw new TypeError('All source and issuer public keys must be distinct');

  let closed=false;
  async function publish({stream,record}={}) {
    if(closed)return deny('gateway-closed');
    if(process.env.FG_R3_TRUSTED_INGEST_LAB_TEST!=='1'||
       process.env.FIREBASE_DATABASE_EMULATOR_HOST!=='127.0.0.1:9000')
      return deny('emulator-only');
    if(!STREAMS.includes(stream))return deny('stream-unrecognized');
    const trusted=pins[stream];
    if(!exact(record,['payload','signature']))
      return deny('untrusted-report-shape');
    if(record.payload?.epoch!==trusted.epoch)
      return deny('operator-epoch-unrecognized');
    const nowMs=clock();
    if(!number(nowMs))return deny('operator-clock-unavailable');
    const verified=verifyR2PublicEvidence({
      stream,record,trustedPublicKey:trusted.reportPublicKey,
      connected:true,nowMs
    });
    if(verified.accepted!==true)
      return deny('report-'+verified.reason);

    const p=record.payload;
    // The legacy R2 wire shape makes receivedAtMs part of the *source*
    // signature. Requiring it close to an independently injected operator
    // clock is only a lab time-bound check, NOT trusted server timestamp
    // semantics. Real protocol MUST move receipt time ownership server-side.
    if(Math.abs(p.receivedAtMs-nowMs)>2000)
      return deny('reported-receipt-time-not-operator-confirmed');

    const receipt=Object.freeze({
      version:R2_ISSUER_RECEIPT_VERSION,stream,
      sourceAlias:p.sourceAlias,epoch:p.epoch,sequence:p.sequence,
      payloadDigest:hash(canonicalR2PublicEvidence(p)),
      acceptedAtMs:p.receivedAtMs
    });
    const canonical=canonicalR2PublisherReceipt(receipt);
    let receiptSignature;
    try{
      receiptSignature=await issueSignedReceipt(stream,canonical);
      if(!signature(receiptSignature)||!verify(null,
        Buffer.from(canonical,'utf8'),trusted.issuerPublicKey,
        Buffer.from(receiptSignature,'base64url')))
        return deny('issuer-capability-invalid');
    }catch{return deny('issuer-capability-unavailable');}
    if(closed)return deny('gateway-closed');

    const candidate={
      report:record,
      acceptance:{receipt,signature:receiptSignature}
    };
    let db;
    try{
      db=databaseForStream(stream);
      if(!db||typeof db.ref!=='function')
        return deny('scoped-writer-unavailable');
      const ref=db.ref(PATHS[stream]);
      const current=(await ref.get()).val();
      if(!verifiedHistoricalEnvelope(current,stream,
        trusted.reportPublicKey,trusted.issuerPublicKey))
        return deny('published-checkpoint-unverified');
      const old=current.report.payload;
      if(old.sourceAlias!==p.sourceAlias||old.epoch!==p.epoch||
         p.sequence<=old.sequence||
         p.observedAtMs<old.observedAtMs||
         p.receivedAtMs<old.receivedAtMs)
        return deny('publication-replay-or-rollback');
      // Atomic single-leaf replacement; RTDB rules re-check monotonicity,
      // but cannot verify cryptography. Privileged restores may race.
      if(closed)return deny('gateway-closed');
      await ref.set(candidate);
      return Object.freeze({
        published:true,
        kind:'EMULATOR_SCOPED_SIGNED_GATE_ONLY_NOT_PRODUCTION',
        requiresIndependentRecoveryAnchor:true
      });
    }catch{
      // An interrupted .set may have committed. Never report guaranteed
      // rollback or retry automatically; a trusted operator must reconcile.
      return deny('publication-outcome-unconfirmed');
    }
  }
  return Object.freeze({
    publish,
    close(){closed=true;}
  });
}
