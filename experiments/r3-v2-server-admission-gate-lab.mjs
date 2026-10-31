// FloodGuard R3 V2 server-owned admission timestamp *laboratory*.
// No actual server, HTTP route, Admin SDK, live credentials or device control.
// An admission signature proves an operator-pinned test signer signed at the
// injected clock time, NOT that the leaf was durably stored in Firebase.
// A caller may submit ONLY {stream,record}; it cannot choose keys, signer,
// clock, receipt timestamp, database or destination.
import {createHash,KeyObject,verify} from 'node:crypto';
import {V2_ADMISSION,canonicalR3V2Observation,canonicalR3V2Admission}
  from './r3-v2-admission-contract-lab.mjs';

const streams=['water','rain'];
const paths=Object.freeze({
  water:'/floodguard/attestedEvidenceLabV2/water',
  rain:'/floodguard/attestedEvidenceLabV2/rain'
});
const MIN=Date.UTC(2000,0,1);
const obj=x=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&
  (Object.getPrototypeOf(x)===Object.prototype||
   Object.getPrototypeOf(x)===null);
const exact=(x,fields)=>obj(x)&&Object.keys(x).length===fields.length&&
  fields.every(k=>Object.hasOwn(x,k));
const goodKey=x=>x instanceof KeyObject&&x.type==='public'&&
  x.asymmetricKeyType==='ed25519';
const sig=x=>typeof x==='string'&&/^[A-Za-z0-9_-]{86}$/.test(x)&&
  Buffer.from(x,'base64url').length===64;
const goodTime=x=>Number.isSafeInteger(x)&&x>=MIN;
const fingerprint=x=>createHash('sha256')
  .update(x.export({type:'spki',format:'der'})).digest('hex');
const digest=s=>createHash('sha256').update(s,'utf8').digest('hex');
const deny=reason=>Object.freeze({published:false,reason});
const verifySig=(text,signature,key)=>sig(signature)&&
  verify(null,Buffer.from(text,'utf8'),key,
    Buffer.from(signature,'base64url'));

function trustPrevious(existing,stream,pins) {
  if(!exact(existing,['report','admission'])||
     !exact(existing.report,['payload','signature'])||
     !exact(existing.admission,['receipt','signature']))
    return null;
  try{
    const p=existing.report.payload,q=existing.admission.receipt;
    if(p.stream!==stream||q.stream!==stream||p.epoch!==pins.epoch||
       q.epoch!==pins.epoch||p.sequence!==q.sequence||
       p.sourceAlias!==q.sourceAlias||
       q.admittedAtMs<p.observedAtMs-2000||
       q.admittedAtMs>p.observedAtMs+10000||
       q.reportDigest!==digest(canonicalR3V2Observation(p))||
       !verifySig(canonicalR3V2Observation(p),
         existing.report.signature,pins.report)||
       !verifySig(canonicalR3V2Admission(q),
         existing.admission.signature,pins.issuer))return null;
    return {observedAtMs:p.observedAtMs,admittedAtMs:q.admittedAtMs,
      sequence:p.sequence,epoch:p.epoch,sourceAlias:p.sourceAlias};
  }catch{return null;}
}
export function createR3V2AdmissionGatewayLab({
  registry,clock,signAdmission,databaseForStream
}={}){
  if(process.env.FG_R3_V2_ADMISSION_LAB_TEST!=='1'||
     process.env.FIREBASE_DATABASE_EMULATOR_HOST!=='127.0.0.1:9000')
    throw Error('V2 admission disabled outside isolated loopback lab');
  if(!exact(registry,streams)||typeof clock!=='function'||
     typeof signAdmission!=='function'||
     typeof databaseForStream!=='function')
    throw TypeError('Operator-owned trust, clock, signing and RTDB required');
  const pins={},ids=new Set();
  for(const s of streams){
    const v=registry[s];
    if(!exact(v,['epoch','enabled','report','issuer'])||
       v.enabled!==true||!Number.isSafeInteger(v.epoch)||
       v.epoch<1||v.epoch>10000||
       !goodKey(v.report)||!goodKey(v.issuer))
      throw TypeError('Invalid enrolled V2 source');
    pins[s]=Object.freeze({...v});
    for(const k of [v.report,v.issuer]){
      const id=fingerprint(k);
      if(ids.has(id))throw TypeError('Signing roles must be distinct');
      ids.add(id);
    }
  }
  let closed=false;
  async function publish(request={}){
    if(closed)return deny('gateway-closed');
    if(process.env.FG_R3_V2_ADMISSION_LAB_TEST!=='1'||
      process.env.FIREBASE_DATABASE_EMULATOR_HOST!=='127.0.0.1:9000')
      return deny('emulator-only');
    if(!exact(request,['stream','record']))
      return deny('request-shape-invalid');
    const {stream,record}=request;
    if(!streams.includes(stream))return deny('stream-unrecognized');
    if(!exact(record,['payload','signature']))
      return deny('report-shape-invalid');
    let observed;
    try{
      observed=canonicalR3V2Observation(record.payload);
      if(record.payload.stream!==stream||
        record.payload.epoch!==pins[stream].epoch||
        !verifySig(observed,record.signature,pins[stream].report))
        return deny('report-signature-or-epoch-untrusted');
    }catch{return deny('report-contract-invalid');}
    let ref,previous;
    try{
      const db=databaseForStream(stream);
      if(!db||typeof db.ref!=='function')
        return deny('scoped-client-unavailable');
      ref=db.ref(paths[stream]);
      previous=(await ref.get()).val();
    }catch{return deny('checkpoint-read-unavailable');}
    const old=trustPrevious(previous,stream,pins[stream]);
    if(!old)return deny('historical-dual-proof-unverified');
    const p=record.payload;
    if(old.sourceAlias!==p.sourceAlias||old.epoch!==p.epoch||
       p.sequence<=old.sequence||p.observedAtMs<old.observedAtMs)
      return deny('replay-or-observation-rollback');

    // Only the independent ingress clock determines admission time.
    // Read it AFTER the prior signed checkpoint has been authenticated.
    let admissionMs;
    try{admissionMs=clock();}
    catch{return deny('server-clock-unavailable');}
    if(!goodTime(admissionMs)||
       admissionMs<=old.admittedAtMs||
       p.observedAtMs>admissionMs+2000||
       admissionMs-p.observedAtMs>10000)
      return deny('server-time-or-source-skew-invalid');
    const receipt=Object.freeze({
      version:V2_ADMISSION,stream,sourceAlias:p.sourceAlias,
      epoch:p.epoch,sequence:p.sequence,
      reportDigest:digest(observed),admittedAtMs:admissionMs
    });
    const canonical=canonicalR3V2Admission(receipt);
    let signed;
    try{
      signed=await signAdmission(stream,canonical);
      if(!verifySig(canonical,signed,pins[stream].issuer))
        return deny('issuer-signature-invalid');
    }catch{return deny('issuer-unavailable');}
    if(closed)return deny('gateway-closed');
    const envelope={
      report:record,admission:{receipt,signature:signed}
    };
    try{
      await ref.set(envelope); // Emulator RTDB rules arbitrate concurrent writes.
      return Object.freeze({
        published:true,
        kind:'V2_GATEWAY_ADMISSION_LAB_NOT_DURABLE_OR_PHYSICAL_PROOF',
        requiresIndependentRecoveryAnchor:true
      });
    }catch{
      // Firebase may have committed before the response was lost.
      return deny('publication-outcome-unconfirmed');
    }
  }
  return Object.freeze({publish,close(){closed=true;}});
}
