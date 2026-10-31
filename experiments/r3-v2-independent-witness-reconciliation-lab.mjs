// FloodGuard R3-D2 — independent high-water witness reconciliation LAB.
// This file is a protocol COORDINATOR, not a durable witness, deployed service,
// authenticated network endpoint, hardware control, or trust-key vault.
// An independently provisioned witness must own a nonrollback stateful CAS
// and its own Ed25519 signer; this module has NO access to those private keys.
// Firebase + external witness writes are NOT one atomic transaction.
import {createHash,KeyObject,verify} from 'node:crypto';
import {canonicalR3V2Observation,canonicalR3V2Admission}
  from './r3-v2-admission-contract-lab.mjs';

export const R3_V2_WITNESS_VERSION='floodguard-r3-v2-high-water-witness-lab-v1';
const STREAMS=['water','rain'];
const FIELDS=['version','stream','sourceAlias','epoch','sequence','envelopeDigest'];
const MINT=Date.UTC(2000,0,1);
const HEX=/^[a-f0-9]{64}$/;
const SIG=/^[A-Za-z0-9_-]{86}$/;
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&
  (Object.getPrototypeOf(x)===Object.prototype||
   Object.getPrototypeOf(x)===null);
const exact=(x,fields)=>object(x)&&Object.keys(x).length===fields.length&&
  fields.every(f=>Object.hasOwn(x,f));
const key=k=>k instanceof KeyObject&&k.type==='public'&&k.asymmetricKeyType==='ed25519';
const signature=s=>typeof s==='string'&&SIG.test(s)&&
  Buffer.from(s,'base64url').length===64;
const sha=s=>createHash('sha256').update(s,'utf8').digest('hex');
const fingerprint=k=>createHash('sha256')
  .update(k.export({format:'der',type:'spki'})).digest('hex');
const verified=(bytes,sig,keyObject)=>signature(sig)&&
  verify(null,Buffer.from(bytes,'utf8'),keyObject,
    Buffer.from(sig,'base64url'));
const deny=reason=>Object.freeze({
  reconciled:false,reason,needsIndependentOperatorReview:true
});

export function canonicalR3V2WitnessCheckpoint(value) {
  if(!exact(value,FIELDS)||value.version!==R3_V2_WITNESS_VERSION||
     !STREAMS.includes(value.stream)||value.sourceAlias!==value.stream+'-primary'||
     !Number.isSafeInteger(value.epoch)||value.epoch<1||value.epoch>10000||
     !Number.isSafeInteger(value.sequence)||value.sequence<1||
     value.sequence>2147483647||typeof value.envelopeDigest!=='string'||
     !HEX.test(value.envelopeDigest))
    throw TypeError('Invalid independent high-water witness checkpoint');
  return JSON.stringify({
    version:R3_V2_WITNESS_VERSION,stream:value.stream,
    sourceAlias:value.sourceAlias,epoch:value.epoch,
    sequence:value.sequence,envelopeDigest:value.envelopeDigest
  });
}
export function reviewR3V2PublishedForWitness({
  stream,envelope,trustedReportKey,trustedIssuerKey,epoch
}={}){
  if(!STREAMS.includes(stream)||!key(trustedReportKey)||!key(trustedIssuerKey)||
     fingerprint(trustedReportKey)===fingerprint(trustedIssuerKey)||
     !Number.isSafeInteger(epoch)||epoch<1)
    return Object.freeze({valid:false,reason:'public-trust-unavailable'});
  if(!exact(envelope,['report','admission'])||
     !exact(envelope.report,['payload','signature'])||
     !exact(envelope.admission,['receipt','signature']))
    return Object.freeze({valid:false,reason:'published-envelope-shape-invalid'});
  let reportBytes,receiptBytes;
  try{
    reportBytes=canonicalR3V2Observation(envelope.report.payload);
    receiptBytes=canonicalR3V2Admission(envelope.admission.receipt);
  }catch{return Object.freeze({valid:false,reason:'published-envelope-contract-invalid'});}
  const p=envelope.report.payload,q=envelope.admission.receipt;
  if(p.stream!==stream||q.stream!==stream||p.epoch!==epoch||q.epoch!==epoch||
     q.sourceAlias!==p.sourceAlias||q.sequence!==p.sequence||
     q.reportDigest!==sha(reportBytes)||
     q.admittedAtMs<p.observedAtMs-2000||
     q.admittedAtMs>p.observedAtMs+10000)
    return Object.freeze({valid:false,reason:'published-pair-binding-invalid'});
  if(!verified(reportBytes,envelope.report.signature,trustedReportKey)||
     !verified(receiptBytes,envelope.admission.signature,trustedIssuerKey))
    return Object.freeze({valid:false,reason:'published-signatures-invalid'});
  const envelopeDigest=sha(JSON.stringify({
    report:{payload:p,signature:envelope.report.signature},
    admission:{receipt:q,signature:envelope.admission.signature}
  }));
  return Object.freeze({
    valid:true,stream,sourceAlias:p.sourceAlias,epoch:p.epoch,
    sequence:p.sequence,observedAtMs:p.observedAtMs,
    admittedAtMs:q.admittedAtMs,envelopeDigest
  });
}
export function reviewR3V2WitnessSignedState({
  stream,signed,trustedWitnessKey
}={}){
  if(!STREAMS.includes(stream)||!key(trustedWitnessKey)||
     !exact(signed,['checkpoint','signature'])||
     !signature(signed.signature))
    return Object.freeze({valid:false,reason:'witness-unavailable'});
  try{
    const canonical=canonicalR3V2WitnessCheckpoint(signed.checkpoint);
    if(signed.checkpoint.stream!==stream||
       !verified(canonical,signed.signature,trustedWitnessKey))
      return Object.freeze({valid:false,reason:'witness-signature-unverified'});
    return Object.freeze({valid:true,...signed.checkpoint});
  }catch{return Object.freeze({valid:false,reason:'witness-shape-invalid'});}
}
function reconcile(published,witness){
  if(published.sourceAlias!==witness.sourceAlias||
     published.epoch!==witness.epoch)
    return 'source-or-epoch-requires-enrollment';
  if(published.sequence<witness.sequence)
    return 'database-behind-external-witness';
  if(published.sequence>witness.sequence)
    return 'database-ahead-requires-signed-operator-catchup';
  if(published.envelopeDigest!==witness.envelopeDigest)
    return 'same-sequence-digest-conflict';
  return null;
}

/**
 * readPublished(stream), readWitness(stream), witnessCAS({stream,
 * expectedCheckpoint, nextCheckpoint}), and publish({stream,record})
 * are separately injected lab capabilities. The witnessCAS implementation
 * MUST authenticate the caller, enforce atomic one-step expected-value CAS,
 * provide monotonic nonrollback storage and independently sign its result.
 *
 * This lab does NOT implement the durable witness, its signing private key,
 * network authentication, lock fencing or crash-consistent multi-store commit.
 */
export function createR3V2WitnessReconciliationLab({
  enrolled,readPublished,readWitness,witnessCAS,publish
}={}){
  if(process.env.FG_R3_WITNESS_RECONCILIATION_LAB_TEST!=='1'||
     process.env.FIREBASE_DATABASE_EMULATOR_HOST!=='127.0.0.1:9000')
    throw Error('R3 V2 independent witness coordinator is lab-only');
  if(!exact(enrolled,STREAMS)||typeof readPublished!=='function'||
     typeof readWitness!=='function'||typeof witnessCAS!=='function'||
     typeof publish!=='function')
    throw TypeError('Separate published/witness capabilities required');
  const pins={},fingerprints=[];
  for(const s of STREAMS){
    const value=enrolled[s];
    if(!exact(value,['epoch','report','issuer','witness'])||
       !Number.isSafeInteger(value.epoch)||value.epoch<1||value.epoch>10000||
       !key(value.report)||!key(value.issuer)||!key(value.witness))
      throw TypeError('Unverified operator-enrolled roles');
    pins[s]=Object.freeze({...value});
    fingerprints.push(...['report','issuer','witness'].map(x=>fingerprint(value[x])));
  }
  if(new Set(fingerprints).size!==6)
    throw TypeError('Six independent role/public key identities required');
  const busy=new Set();
  let closed=false;
  const readState=async stream=>{
    let published,witness;
    try{
      [published,witness]=await Promise.all([
        readPublished(stream),readWitness(stream)
      ]);
    }catch{return {error:'checkpoint-authorities-unavailable'};}
    const trust=pins[stream];
    const p=reviewR3V2PublishedForWitness({
      stream,envelope:published,
      trustedReportKey:trust.report,trustedIssuerKey:trust.issuer,
      epoch:trust.epoch
    });
    if(!p.valid)return {error:p.reason};
    const w=reviewR3V2WitnessSignedState({
      stream,signed:witness,trustedWitnessKey:trust.witness
    });
    if(!w.valid)return {error:w.reason};
    const mismatch=reconcile(p,w);
    return mismatch?{error:mismatch}:{published:p,witness:w};
  };
  async function inspect(stream){
    if(!STREAMS.includes(stream))return deny('stream-unrecognized');
    if(closed)return deny('coordinator-closed');
    const check=await readState(stream);
    return check.error?deny(check.error):Object.freeze({
      aligned:true,stream,sequence:check.published.sequence,
      kind:'SIGNED_LAB_WITNESS_ALIGNMENT_NOT_DURABILITY_PROOF'
    });
  }
  async function advance(request={}){
    if(!exact(request,['stream','record']))
      return deny('unexpected-recovery-request-fields');
    if(closed)return deny('coordinator-closed');
    if(process.env.FG_R3_WITNESS_RECONCILIATION_LAB_TEST!=='1'||
       process.env.FIREBASE_DATABASE_EMULATOR_HOST!=='127.0.0.1:9000')
      return deny('emulator-only');
    const {stream,record}=request;
    if(!STREAMS.includes(stream))return deny('stream-unrecognized');
    if(busy.has(stream))return deny('same-process-stream-operation-busy');
    busy.add(stream);
    try{
      const checkpoint=await readState(stream);
      if(checkpoint.error)return deny(checkpoint.error);
      if(!exact(record,['payload','signature'])||
         record.payload?.stream!==stream||
         record.payload?.sourceAlias!==stream+'-primary'||
         record.payload?.epoch!==pins[stream].epoch||
         record.payload?.sequence!==checkpoint.published.sequence+1)
        return deny('next-observation-must-be-one-step');
      // Existing V2 gateway enforces report signature, source time and issuer
      // signing. The lab coordinator never sees issuer private keys.
      let result;
      try{result=await publish({stream,record});}
      catch{return deny('publication-outcome-unconfirmed');}
      if(result?.published!==true)
        return deny(result?.reason??'publication-outcome-unconfirmed');
      let updated;
      try{updated=await readPublished(stream);}
      catch{return deny('publication-ack-requires-independent-reconciliation');}
      const next=reviewR3V2PublishedForWitness({
        stream,envelope:updated,
        trustedReportKey:pins[stream].report,
        trustedIssuerKey:pins[stream].issuer,epoch:pins[stream].epoch
      });
      if(!next.valid)return deny('post-publication-'+next.reason);
      if(next.sequence!==checkpoint.published.sequence+1||
         next.sourceAlias!==checkpoint.published.sourceAlias||
         next.observedAtMs<checkpoint.published.observedAtMs||
         next.admittedAtMs<=checkpoint.published.admittedAtMs)
        return deny('post-publication-conflict');
      const proposed={
        version:R3_V2_WITNESS_VERSION,stream,
        sourceAlias:next.sourceAlias,epoch:next.epoch,
        sequence:next.sequence,envelopeDigest:next.envelopeDigest
      };
      let signed;
      try{
        signed=await witnessCAS({
          stream,expectedCheckpoint:{
            version:R3_V2_WITNESS_VERSION,stream,
            sourceAlias:checkpoint.witness.sourceAlias,
            epoch:checkpoint.witness.epoch,
            sequence:checkpoint.witness.sequence,
            envelopeDigest:checkpoint.witness.envelopeDigest
          },nextCheckpoint:proposed
        });
      }catch{return deny('witness-outcome-unconfirmed');}
      const verifiedState=reviewR3V2WitnessSignedState({
        stream,signed,trustedWitnessKey:pins[stream].witness
      });
      if(!verifiedState.valid||
         verifiedState.sequence!==next.sequence||
         verifiedState.envelopeDigest!==next.envelopeDigest||
         verifiedState.epoch!==next.epoch)
        return deny('witness-result-untrusted');
      return Object.freeze({
        reconciled:true,stream,sequence:next.sequence,
        kind:'LAB_ACK_AND_WITNESS_CAS_NOT_PROVEN_DURABLE',
        productionDurabilityVerified:false,physicalSafetyVerified:false
      });
    }finally{busy.delete(stream);}
  }
  return Object.freeze({inspect,advance,close(){closed=true;}});
}
