// R3 atomic dual-evidence CLIENT lab. Not mounted in production.
// Only checks synthetic report and synthetic receipt signatures with
// externally pinned, independent Ed25519 WebCrypto keys. A verified issuer
// signature is NOT proof of a deployed backend, sensor authenticity, durable
// antirollback or physical safety. No Firebase SDK or write access.
import {canonicalR3BrowserPublicEvidence,verifyR3BrowserPublicReport}
  from './r3-browser-readonly-evidence-lab.mjs';

const VERSION='floodguard-r2-publisher-receipt-lab-v1';
const R_FIELDS=['version','stream','sourceAlias','epoch','sequence',
  'payloadDigest','acceptedAtMs'];
const obj=x=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&
  (Object.getPrototypeOf(x)===Object.prototype||Object.getPrototypeOf(x)===null);
const exact=(x,fields)=>obj(x)&&Object.keys(x).length===fields.length&&
  fields.every(k=>Object.hasOwn(x,k));
const integer=(x,min,max)=>Number.isSafeInteger(x)&&x>=min&&x<=max;
const deny=reason=>Object.freeze({verified:false,reason});
const utf8=new TextEncoder();
const PATHS=Object.freeze({
  water:'/floodguard/attestedEvidenceLabV1/water',
  rain:'/floodguard/attestedEvidenceLabV1/rain'
});
const STREAMS=Object.freeze(['water','rain']);
const MAX_TIME=Number.MAX_SAFE_INTEGER;
const MIN_TIME=Date.UTC(2000,0,1);
const HEX=/^[a-f0-9]{64}$/;
const SIG=/^[A-Za-z0-9_-]{86}$/;

function decode(text,max=256){
  if(typeof text!=='string'||text.length>max||
     !/^[A-Za-z0-9_-]+$/.test(text)||text.length%4===1)
    throw TypeError('Invalid encoded public key or signature');
  const value=Uint8Array.from(atob(text.replace(/-/g,'+')
    .replace(/_/g,'/')+'='.repeat((4-text.length%4)%4)),
    c=>c.charCodeAt(0));
  const normalized=btoa(String.fromCharCode(...value)).replace(/\+/g,'-')
    .replace(/\//g,'_').replace(/=+$/,'');
  if(normalized!==text)throw TypeError('Noncanonical encoded bytes');
  return value;
}
const equalBytes=(a,b)=>a.length===b.length&&a.every((v,i)=>v===b[i]);
const toHex=bytes=>[...new Uint8Array(bytes)].map(x=>x.toString(16)
  .padStart(2,'0')).join('');

export function canonicalR3BrowserIssuerReceipt(receipt) {
  if(!exact(receipt,R_FIELDS)||receipt.version!==VERSION||
     !STREAMS.includes(receipt.stream)||
     receipt.sourceAlias!==(receipt.stream==='water'
       ?'water-primary':'rain-primary')||
     !integer(receipt.epoch,1,10000)||
     !integer(receipt.sequence,1,2147483647)||
     typeof receipt.payloadDigest!=='string'||
     !HEX.test(receipt.payloadDigest)||
     !integer(receipt.acceptedAtMs,MIN_TIME,MAX_TIME))
    throw TypeError('Invalid synthetic acceptance receipt');
  return JSON.stringify({
    version:VERSION,stream:receipt.stream,
    sourceAlias:receipt.sourceAlias,epoch:receipt.epoch,
    sequence:receipt.sequence,payloadDigest:receipt.payloadDigest,
    acceptedAtMs:receipt.acceptedAtMs
  });
}

/**
 * A single-leaf snapshot prevents torn report-vs-receipt listener views.
 * Trust in keys MUST come from independent verified configuration, never
 * the RTDB report. Neither Firebase Security Rules nor this client establish
 * real issuer identity enrollment or prevent privileged rollback.
 */
export async function verifyR3AtomicDualAttestation({
  stream,envelope,pins,subtle,connected=false,nowMs,prior=null
}={}) {
  if(!STREAMS.includes(stream))return deny('stream-unrecognized');
  if(!exact(envelope,['report','acceptance'])||
     !exact(envelope.acceptance,['receipt','signature']))
    return deny('atomic-envelope-shape-invalid');
  if(!obj(pins)||typeof pins.report!=='string'||
     typeof pins.issuer!=='string')
    return deny('independent-trust-pins-unavailable');
  if(!subtle||typeof subtle.importKey!=='function'||
     typeof subtle.verify!=='function'||
     typeof subtle.digest!=='function')
    return deny('browser-crypto-unavailable');

  let issuerSpki,reportSpki;
  try{
    issuerSpki=decode(pins.issuer);
    reportSpki=decode(pins.report);
    if(issuerSpki.length!==44||reportSpki.length!==44)
      return deny('trusted-pin-shape-invalid');
    if(equalBytes(issuerSpki,reportSpki))
      return deny('issuer-must-be-independent');
  }catch{return deny('trusted-pin-shape-invalid');}
  const report=await verifyR3BrowserPublicReport({
    stream,record:envelope.report,spkiBase64url:pins.report,
    subtle,connected,nowMs,prior
  });
  if(!report.verified)return deny('report-'+report.reason);

  let canonicalReceipt,bytes;
  try {
    canonicalReceipt=canonicalR3BrowserIssuerReceipt(
      envelope.acceptance.receipt
    );
    if(typeof envelope.acceptance.signature!=='string'||
       !SIG.test(envelope.acceptance.signature))
      return deny('issuer-signature-shape-invalid');
    bytes=decode(envelope.acceptance.signature);
    if(bytes.length!==64)return deny('issuer-signature-shape-invalid');
  }catch{return deny('issuer-receipt-invalid');}

  const receipt=envelope.acceptance.receipt;
  const p=envelope.report.payload;
  if(receipt.stream!==stream||receipt.sourceAlias!==p.sourceAlias||
     receipt.epoch!==p.epoch||receipt.sequence!==p.sequence||
     receipt.acceptedAtMs!==p.receivedAtMs)
    return deny('receipt-report-binding-invalid');

  let digest;
  try{
    digest=toHex(await subtle.digest('SHA-256',
      utf8.encode(canonicalR3BrowserPublicEvidence(p))));
  }catch{return deny('browser-crypto-unavailable');}
  if(digest!==receipt.payloadDigest)
    return deny('receipt-payload-digest-mismatch');
  try{
    const key=await subtle.importKey('spki',issuerSpki,
      {name:'Ed25519'},false,['verify']);
    if(!await subtle.verify({name:'Ed25519'},key,bytes,
      utf8.encode(canonicalReceipt)))
      return deny('issuer-signature-unverified');
  }catch{return deny('issuer-cryptography-unavailable');}
  return Object.freeze({
    verified:true,
    kind:'SYNTHETIC_DUAL_SIGNATURES_NOT_BACKEND_OR_PHYSICAL_PROOF',
    report:report.report,
    syntheticIssuerSignatureVerified:true,
    productionBackendVerified:false,
    physicalSafetyVerified:false
  });
}

const empty=()=>({status:'unavailable',reason:'no-proof',report:null});
export function createR3AtomicDualObserver({
  subscribe,pins,subtle,clock,onChange
}={}) {
  if(typeof subscribe!=='function'||typeof clock!=='function'||
     typeof onChange!=='function'||!obj(pins)||
     !STREAMS.every(s=>obj(pins[s])&&
       typeof pins[s].report==='string'&&typeof pins[s].issuer==='string'))
    throw TypeError('Two independently pinned streams and adapter required');
  const state={water:empty(),rain:empty()};
  const previous={water:null,rain:null};
  const versions={water:0,rain:0};
  const unsub=[];
  let connected=false,closed=false,started=false;
  function snapshot(){
    return Object.freeze({
      kind:'R3_LAB_ATOMIC_DUAL_EVIDENCE_NOT_PHYSICAL_PROOF',
      connected,water:Object.freeze({...state.water}),
      rain:Object.freeze({...state.rain}),
      productionBackendVerified:false,
      physicalSafetyVerified:false,
      productionCutoverApproved:false
    });
  }
  function publish(s,status,reason,report=null){
    state[s]={status,reason,report};
    if(!closed)onChange(snapshot());
  }
  async function accept(stream,envelope){
    const revision=++versions[stream];
    if(!connected){
      publish(stream,'stale','database-disconnected');
      return;
    }
    if(envelope===null||envelope===undefined){
      publish(stream,'unavailable','atomic-proof-missing');
      return;
    }
    publish(stream,'checking','two-signatures-pending');
    const result=await verifyR3AtomicDualAttestation({
      stream,envelope,pins:pins[stream],subtle,connected,
      nowMs:clock(),prior:previous[stream]
    });
    if(closed||!connected||versions[stream]!==revision)return;
    if(!result.verified){
      publish(stream,'invalid',result.reason);
      return;
    }
    const next=result.report;
    previous[stream]={
      sourceAlias:next.sourceAlias,epoch:next.epoch,sequence:next.sequence,
      observedAtMs:next.observedAtMs,receivedAtMs:next.receivedAtMs
    };
    publish(stream,'signed-lab-only','synthetic-two-signatures-not-field-proof',
      next);
  }
  function refresh(){
    if(closed)return snapshot();
    const now=clock();
    for(const stream of STREAMS){
      const x=state[stream];
      if(x.status!=='signed-lab-only')continue;
      const p=x.report;
      if(!connected||!p||!integer(now,MIN_TIME,MAX_TIME)||
         now-p.observedAtMs>10000||now<p.observedAtMs-2000)
        publish(stream,'stale','source-expired-or-unavailable');
    }
    return snapshot();
  }
  function close(){
    if(closed)return;
    closed=true;
    for(const s of STREAMS)versions[s]++;
    for(const f of unsub.splice(0))f();
  }
  function start(){
    if(closed||started)throw Error('Cannot restart evidence observer');
    started=true;
    function attach(path,success,failure){
      const stop=subscribe(path,success,failure);
      if(typeof stop!=='function')throw TypeError('Missing unsubscribe');
      unsub.push(stop);
    }
    try{
      attach('.info/connected',value=>{
        if(closed)return;
        connected=value===true;
        if(!connected)for(const s of STREAMS){
          versions[s]++;
          publish(s,'stale','database-disconnected');
        }
        else onChange(snapshot());
      },()=>{
        if(closed)return;
        connected=false;
        for(const s of STREAMS){
          versions[s]++;
          publish(s,'stale','connection-unavailable');
        }
      });
      for(const s of STREAMS)attach(PATHS[s],
        value=>{if(!closed)void accept(s,value);},
        ()=>{if(!closed){
          versions[s]++;
          publish(s,'unavailable','read-denied-or-unavailable');
        }});
    }catch(e){close();throw e;}
    onChange(snapshot());
    return Object.freeze({snapshot,refresh,close});
  }
  return Object.freeze({start,snapshot,refresh,close});
}
