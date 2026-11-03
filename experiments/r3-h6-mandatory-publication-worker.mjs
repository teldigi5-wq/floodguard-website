// FloodGuard R3 H6: MANDATORY signed publication in disposable Emulators.
// No production Firebase credential/IAM, real firmware, gate, or alerts.
// The literal 'owner' bearer is an Emulator-only TEST bypass, not a secret.
// A compromised privileged worker/Admin token still bypasses Firebase Rules.
import {createPublicKey} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {isDeepStrictEqual} from 'node:util';
import {createH4OfflineAdmissionIssuer}
  from './r3-h4-signed-admission-issuer.mjs';

const PROJECT='demo-r3-h6-publication';
const BASE='http://127.0.0.1:9000';
const NS=PROJECT+'-default-rtdb';
const ID='device-stage-a';
const ROOT='/floodguard';
const PATHS=Object.freeze({
  issuer:ROOT+'/admissionIssuerAuthorization/admission-issuer-stage',
  publisher:ROOT+'/publisherLabAuthorization/publisher-water-stage',
  incident:ROOT+'/incidentQuarantine/'+ID,
  device:ROOT+'/deviceAuthorization/'+ID,
  water:ROOT+'/publicationLab/water',
  checkpoint:ROOT+'/publicationLab/water/checkpoint'
});
const ALLOWED_GET=new Set(Object.values(PATHS));
const keys=['deviceSpki','receiptSpki','attestorSpki'];
const exact=(obj,fields)=>obj!==null&&typeof obj==='object'&&
  !Array.isArray(obj)&&Object.getPrototypeOf(obj)===Object.prototype&&
  Object.keys(obj).length===fields.length&&fields.every(k=>Object.hasOwn(obj,k));

if(process.env.FG_R3_H6_PUBLICATION_TEST!=='1'||
   process.env.GCLOUD_PROJECT!==PROJECT||
   process.env.FIREBASE_DATABASE_EMULATOR_HOST!=='127.0.0.1:9000'||
   process.env.FIREBASE_AUTH_EMULATOR_HOST!=='127.0.0.1:9099'||
   typeof process.send!=='function'||process.connected!==true)
  throw Error('H6 refuses any nonlocal, non-demo or non-IPC execution');

let ready=false,busy=false,trusted,gate;
function send(id,ok,reason,extra={}){
  if(process.connected)process.send({
    id,ok,reason,...extra,productionGo:false,canOperateGate:false,
    canSendAlert:false,releaseDecision:'NO_GO'
  });
}
function publicEd25519(encoded){
  if(typeof encoded!=='string'||encoded.length<40||encoded.length>256||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded))
    throw Error('untrusted-key-source');
  const k=createPublicKey({key:Buffer.from(encoded,'base64'),
    format:'der',type:'spki'});
  if(k.type!=='public'||k.asymmetricKeyType!=='ed25519')
    throw Error('wrong-key-type');
  return k;
}
async function bootstrap(){
  const chunks=[];let size=0;
  for await(const chunk of createReadStream(null,{fd:4,autoClose:true})){
    size+=chunk.length;
    if(size>2048)throw Error('bootstrap-too-large');
    chunks.push(chunk);
  }
  const input=JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if(!exact(input,keys))throw Error('untrusted-bootstrap');
  const device=publicEd25519(input.deviceSpki);
  const receipt=publicEd25519(input.receiptSpki);
  const attestor=publicEd25519(input.attestorSpki);
  const fingerprints=[device,receipt,attestor].map(k=>
    k.export({format:'der',type:'spki'}).toString('base64'));
  if(new Set(fingerprints).size!==3)throw Error('signer-role-collision');
  trusted=Object.freeze({device,receipt,attestor});
}
function endpoint(path){
  if(!ALLOWED_GET.has(path))throw Error('out-of-scope-path');
  const u=new URL(BASE+path+'.json');
  u.searchParams.set('ns',NS);
  u.searchParams.set('access_token','owner'); // localhost demo-only bypass
  if(u.origin!==BASE||u.hostname!=='127.0.0.1')
    throw Error('non-local-endpoint');
  return u;
}
async function request(path,method='GET',payload,etag){
  if(!ALLOWED_GET.has(path)||
     !(method==='GET'||method==='PUT'&&path===PATHS.water))
    throw Error('out-of-scope-database-operation');
  const headers={};
  if(method==='GET'&&etag===true)headers['X-Firebase-ETag']='true';
  if(method==='PUT'){
    if(typeof etag!=='string'||etag.length<1||etag.length>256)
      throw Error('missing-compare-and-swap-tag');
    headers['if-match']=etag;
    headers['content-type']='application/json';
  }
  const response=await fetch(endpoint(path),{
    method,headers,redirect:'error',signal:AbortSignal.timeout(6000),
    ...(payload===undefined?{}:{body:JSON.stringify(payload)})
  });
  // No automatic retry on ANY transport/HTTP/unknown-commit response.
  if(response.status!==200)throw Error('emulator-scope-or-cas-denied');
  const value=await response.json();
  return {value,etag:response.headers.get('etag')};
}
async function readAuthority(){
  // Separate reads are NOT a distributed atomic snapshot. Before the final
  // CAS we re-read all authority values and refuse changes. Operator incident
  // changes between this final read and the CAS remain an OPEN race.
  const [i,p,q,d,c]=await Promise.all([
    request(PATHS.issuer),request(PATHS.publisher),
    request(PATHS.incident),request(PATHS.device),
    request(PATHS.checkpoint)
  ]);
  const issuer=i.value,publisher=p.value,incident=q.value,
    device=d.value,checkpoint=c.value;
  if(!exact(issuer,['enabled','generation','revision','scope'])||
     !exact(publisher,['enabled','deviceId','epoch','scope'])||
     !exact(incident,['blocked','epoch'])||
     !exact(device,['enabled','scope'])||
     !exact(checkpoint,['initialized','deviceId','epoch',
       'sequence','digest','observedAtMs'])||
     checkpoint.deviceId!==ID)
    throw Error('authority-shape-unverified');
  return Object.freeze({
    revision:issuer.revision,
    issuer:Object.freeze({
      enabled:issuer.enabled,generation:issuer.generation,scope:issuer.scope
    }),
    publisher:Object.freeze({...publisher}),
    incident:Object.freeze({...incident}),
    sourceBinding:Object.freeze({
      deviceId:ID,epoch:1,enabled:device.enabled,scope:device.scope,
      publicKey:trusted.device
    }),
    trustedReceiptKey:trusted.receipt,
    trustedDatabaseIssuerKey:trusted.attestor,
    lastPublished:Object.freeze({
      initialized:checkpoint.initialized,epoch:checkpoint.epoch,
      sequence:checkpoint.sequence,digest:checkpoint.digest
    })
  });
}
function stateStamp(s){
  return JSON.stringify([
    s.revision,s.issuer.enabled,s.issuer.generation,s.issuer.scope,
    s.publisher.enabled,s.publisher.deviceId,s.publisher.epoch,s.publisher.scope,
    s.incident.blocked,s.incident.epoch,s.sourceBinding.enabled,
    s.sourceBinding.scope,s.lastPublished.initialized,s.lastPublished.epoch,
    s.lastPublished.sequence,s.lastPublished.digest
  ]);
}
async function init(msg){
  if(ready||!exact(msg,['type','id'])||msg.type!=='init')
    return send(msg?.id??0,false,'invalid-init');
  try{
    await bootstrap();
    gate=createH4OfflineAdmissionIssuer({
      authority:Object.freeze({read:readAuthority}),
      clock:()=>Date.now()
    });
    ready=true;
    send(msg.id,true,'ready',{scope:'MANDATORY_SIGNED_WATER_DEMO_ONLY'});
  }catch{send(msg?.id??0,false,'bootstrap-refused');}
}
async function commit(msg){
  if(!ready||!exact(msg,['type','id','evidence'])||
     msg.type!=='commit'||!Number.isSafeInteger(msg.id)||msg.id<1)
    return send(msg?.id??0,false,'invalid-request');
  try{
    const firstState=await readAuthority();
    const beforeStamp=stateStamp(firstState);
    const prepared=await gate.issue(msg.evidence); // mandatory 3 Ed25519
    if(prepared.issued!==true||prepared.releaseDecision!=='NO_GO'||
      prepared.canWriteFirebase!==false||prepared.canPublish!==false)
      return send(msg.id,false,'signed-evidence-refused');
    const previous=await request(PATHS.water,'GET',undefined,true);
    if(!previous.etag||!exact(previous.value,['current','checkpoint'])||
      !exact(previous.value.checkpoint,['initialized','deviceId','epoch',
        'sequence','digest','observedAtMs'])||
      previous.value.checkpoint.initialized!==true||
      previous.value.checkpoint.deviceId!==ID||
      previous.value.checkpoint.epoch!==1||
      previous.value.checkpoint.sequence!==prepared.candidate.checkpoint.sequence-1||
      previous.value.checkpoint.digest===prepared.candidate.checkpoint.digest)
      return send(msg.id,false,'publication-cas-history-unverified');
    const state=await readAuthority();
    if(stateStamp(state)!==beforeStamp||
       state.lastPublished.sequence!==previous.value.checkpoint.sequence||
       state.lastPublished.digest!==previous.value.checkpoint.digest)
      return send(msg.id,false,'authority-changed-before-commit');
    if(prepared.ticket.expiresAtMs<Date.now())
      return send(msg.id,false,'prepared-evidence-expired');
    // The only worker write, fixed URL. RTDB ETag CAS prevents a concurrent
    // overwrite of THIS node. It cannot atomically fence incident other nodes.
    await request(PATHS.water,'PUT',prepared.candidate,previous.etag);
    const after=await request(PATHS.water);
    if(!isDeepStrictEqual(after.value,prepared.candidate))
      return send(msg.id,false,'commit-readback-mismatch');
    send(msg.id,true,'SYNTHETIC_SIGNED_PUBLICATION_ONLY',{
      sequence:prepared.ticket.sequence,digest:prepared.ticket.digest
    });
  }catch{
    // Network failure or lost write ACK is UNCERTAIN, never retried.
    send(msg?.id??0,false,'signed-publication-denied-or-uncertain');
  }
}
process.on('message',msg=>{
  if(busy)return send(msg?.id??0,false,'busy-failed-closed');
  busy=true;
  Promise.resolve().then(()=>ready?commit(msg):init(msg))
    .catch(()=>send(msg?.id??0,false,'worker-failed-closed'))
    .finally(()=>{busy=false;});
});
process.on('disconnect',()=>{trusted=undefined;gate=undefined;process.exit(0);});
