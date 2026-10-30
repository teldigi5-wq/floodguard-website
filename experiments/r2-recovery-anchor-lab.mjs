// FloodGuard R2: INDEPENDENT OPERATOR-SIGNED RECOVERY ANCHOR — LAB ONLY.
// No network, disk, production Firebase, device interface or key generation.
// This checks a caller-provided checkpoint; it does not establish that the
// checkpoint survives a restore, protect against privileged concurrent writes,
// or make arbitrary caller-provided keys into trusted authority.
import {createHash, KeyObject, verify} from 'node:crypto';
import {canonicalR2PublicEvidence} from './r2-dual-stream-public-evidence.mjs';

const VERSION='floodguard-r2-recovery-anchor-lab-v1';
const ALLOWED=['version','stream','sourceAlias','epoch','sequence','payloadDigest'];
const record=v=>v!==null&&typeof v==='object'&&!Array.isArray(v) &&
  (Object.getPrototypeOf(v)===Object.prototype ||
   Object.getPrototypeOf(v)===null);
const exact=(v,fields)=>record(v)&&Object.keys(v).length===fields.length&&
  fields.every(field=>Object.hasOwn(v,field));
const integer=(v,min,max)=>Number.isSafeInteger(v)&&v>=min&&v<=max;
const validKey=v=>v instanceof KeyObject&&v.type==='public'&&
  v.asymmetricKeyType==='ed25519';
const validSig=v=>typeof v==='string'&&/^[A-Za-z0-9_-]{86}$/.test(v)&&
  Buffer.from(v,'base64url').length===64;
const digest=v=>createHash('sha256').update(v,'utf8').digest('hex');
const reject=reason=>Object.freeze({matches:false,reason});

export const R2_RECOVERY_ANCHOR_VERSION=VERSION;

// No private keys here. In the tests, an independent fixture signer explicitly
// signs this canonical message; a production anchor needs independent storage,
// issuer enrollment, nonrollback guarantees and a recovery approval workflow.
export function canonicalR2RecoveryAnchor(value) {
  if(!exact(value,ALLOWED)||value.version!==VERSION||
     (value.stream!=='water'&&value.stream!=='rain')||
     value.sourceAlias!==(value.stream==='water'?'water-primary':'rain-primary')||
     !integer(value.epoch,1,10000)||
     !integer(value.sequence,1,2147483647)||
     typeof value.payloadDigest!=='string'||!/^[a-f0-9]{64}$/.test(value.payloadDigest))
    throw new TypeError('Invalid R2 lab recovery anchor');
  return JSON.stringify({
    version:VERSION,stream:value.stream,sourceAlias:value.sourceAlias,
    epoch:value.epoch,sequence:value.sequence,
    payloadDigest:value.payloadDigest
  });
}

export function draftR2RecoveryAnchor(stream,publicRecord) {
  if((stream!=='water'&&stream!=='rain')||
     !exact(publicRecord,['payload','signature'])||
     publicRecord.payload?.stream!==stream||
     !validSig(publicRecord.signature))
    throw new TypeError('Invalid published record for recovery review');
  const canonical=canonicalR2PublicEvidence(publicRecord.payload);
  const p=publicRecord.payload;
  return Object.freeze({
    version:VERSION,stream,sourceAlias:p.sourceAlias,
    epoch:p.epoch,sequence:p.sequence,
    payloadDigest:digest(canonical)
  });
}

/**
 * Compare an independently pinned, separately retained operator checkpoint
 * against an existing public leaf. A mismatched anchor NEVER auto-heals the
 * public record, resets the replay counter, or approves epoch rotation.
 *
 * Validation of a signed checkpoint is not proof of rollback-resistant
 * storage; restore both checkpoint and database and the gap is undetectable.
 */
export function reviewR2RecoveryAnchor({
  stream,publicRecord,signedAnchor,trustedAnchorKey,trustedReportKey
}={}) {
  if(stream!=='water'&&stream!=='rain')return reject('stream-unrecognized');
  if(!validKey(trustedAnchorKey)||!validKey(trustedReportKey))
    return reject('trusted-keys-unavailable');
  if(!exact(signedAnchor,['anchor','signature'])||
     !validSig(signedAnchor.signature))
    return reject('anchor-unavailable');
  let canonical;
  try{canonical=canonicalR2RecoveryAnchor(signedAnchor.anchor);}
  catch{return reject('anchor-invalid');}
  if(signedAnchor.anchor.stream!==stream)
    return reject('anchor-stream-mismatch');
  if(!verify(null,Buffer.from(canonical,'utf8'),trustedAnchorKey,
      Buffer.from(signedAnchor.signature,'base64url')))
    return reject('anchor-signature-unverified');

  if(!exact(publicRecord,['payload','signature'])||
     !validSig(publicRecord.signature))
    return reject('published-record-invalid');
  let serialized;
  try{serialized=canonicalR2PublicEvidence(publicRecord.payload);}
  catch{return reject('published-record-invalid');}
  if(publicRecord.payload.stream!==stream||
     !verify(null,Buffer.from(serialized,'utf8'),trustedReportKey,
       Buffer.from(publicRecord.signature,'base64url')))
    return reject('published-signature-unverified');

  const expected=signedAnchor.anchor;
  const observed=publicRecord.payload;
  if(expected.sourceAlias!==observed.sourceAlias||
     expected.epoch!==observed.epoch)
    return reject('authority-or-epoch-diverged');

  if(observed.sequence<expected.sequence)
    return reject('database-behind-independent-anchor');
  if(observed.sequence>expected.sequence)
    return reject('published-ahead-of-anchor-reconcile');
  if(digest(serialized)!==expected.payloadDigest)
    return reject('same-sequence-digest-conflict');
  return Object.freeze({
    matches:true,kind:'OFFLINE_OPERATOR_ANCHOR_MATCH_NOT_DURABILITY_PROOF'
  });
}

/**
 * This wrapper is a lab preflight: it performs a fresh scoped emulator read
 * and checks the external anchor before reusing PR22's scoped publisher.
 * It is NOT linearizable with privileged database restores or checkpoint
 * signing; a production deployment requires atomic coordination with an
 * independently durable high-water authority.
 */
export async function publishR2WithRecoveryAnchorLab({
  signedAnchor,trustedAnchorKey,...publisher
}={}) {
  const deny=reason=>Object.freeze({published:false,reason});
  if(process.env.FG_R2_RECOVERY_ANCHOR_LAB_TEST!=='1' ||
     process.env.FIREBASE_DATABASE_EMULATOR_HOST!=='127.0.0.1:9000')
    return deny('emulator-only');
  if(!publisher.database||typeof publisher.database.ref!=='function'||
     !validKey(trustedAnchorKey))
    return deny('trusted-recovery-preflight-unavailable');
  const stream=publisher.stream;
  if(stream!=='water'&&stream!=='rain')return deny('stream-unrecognized');
  const path=stream==='water'
    ? '/floodguard/evidenceLabV1/water'
    : '/floodguard/evidenceLabV1/rain';
  let current;
  try{current=(await publisher.database.ref(path).get()).val();}
  catch{return deny('published-record-unavailable');}
  const state=reviewR2RecoveryAnchor({
    stream,publicRecord:current,signedAnchor,
    trustedAnchorKey,trustedReportKey:publisher.trustedReportKey
  });
  if(!state.matches)return deny(state.reason);
  const {publishR2AttestedLabReport}=await import(
    './r2-attested-dual-stream-publisher.mjs'
  );
  const result=await publishR2AttestedLabReport(publisher);
  // On success, a trusted operator MUST independently verify/persist a new
  // signed anchor before attempting another publication. This function does
  // not possess the operator key and cannot issue or advance that checkpoint.
  if(result.published===true)
    return Object.freeze({
      published:true,kind:'OFFLINE_ANCHOR_PREFLIGHT_PUBLISHED_NOT_DURABLE',
      requiresIndependentAnchorAdvance:true
    });
  return result;
}
