// FloodGuard R3 H5: isolated child-process issuer for DISPOSABLE Auth+RTDB
// Emulators only. NO production support, Admin SDK, real device, alert or gate.
// A stolen active issuer bearer token CAN STILL bypass application signatures
// and mint a schema-valid ticket directly. This is a known open security gap.
import {createPublicKey} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {createH4OfflineAdmissionIssuer} from './r3-h4-signed-admission-issuer.mjs';

const PROJECT='demo-r3-h5-issuer';
const AUTH='http://127.0.0.1:9099';
const DB='http://127.0.0.1:9000';
const NAMESPACE=PROJECT+'-default-rtdb';
const UID='admission-issuer-stage';
const EMAIL=UID+'@floodguard-lab.invalid';
const DEVICE='device-stage-a';
const ROOT='/floodguard';
const PATHS=Object.freeze({
  issuer:ROOT+'/admissionIssuerAuthorization/'+UID,
  publisher:ROOT+'/publisherLabAuthorization/publisher-water-stage',
  incident:ROOT+'/incidentQuarantine/'+DEVICE,
  device:ROOT+'/deviceAuthorization/'+DEVICE,
  checkpoint:ROOT+'/publicationLab/water/checkpoint',
  ticket:ROOT+'/publicationAdmission/'+DEVICE
});
const ALLOWED_READ=new Set(Object.values(PATHS));
const exact=(v,keys)=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&
  Object.getPrototypeOf(v)===Object.prototype&&Object.keys(v).length===keys.length&&
  keys.every(k=>Object.hasOwn(v,k));

if(process.env.FG_R3_H5_ISSUER_TEST!=='1'||
   process.env.GCLOUD_PROJECT!==PROJECT||
   process.env.FIREBASE_AUTH_EMULATOR_HOST!=='127.0.0.1:9099'||
   process.env.FIREBASE_DATABASE_EMULATOR_HOST!=='127.0.0.1:9000'||
   typeof process.send!=='function'||process.connected!==true)
  throw Error('Refusing nonlocal or non-IPC issuer execution');

let initialized=false,busy=false,token,issuer;
let trusted;
function send(id,ok,reason,extra={}){
  if(process.connected)process.send({id,ok,reason,...extra,
    canPublish:false,canOperateGate:false,productionGo:false});
}
function pubKey(encoded){
  if(typeof encoded!=='string'||encoded.length<40||encoded.length>256||
     !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded))throw Error('invalid-trust-root');
  const key=createPublicKey({
    key:Buffer.from(encoded,'base64'),format:'der',type:'spki'
  });
  if(key.type!=='public'||key.asymmetricKeyType!=='ed25519')
    throw Error('invalid-trust-root');
  return key;
}
async function bootstrap(){
  let chunks=[],length=0;
  for await(const chunk of createReadStream(null,{fd:4,autoClose:true})){
    length+=chunk.length;
    if(length>4096)throw Error('bootstrap-size-refused');
    chunks.push(chunk);
  }
  const raw=JSON.parse(Buffer.concat(chunks).toString('utf8'));
  chunks=[];
  if(!exact(raw,['email','password','deviceSpki','receiptSpki','attestorSpki'])||
     raw.email!==EMAIL||
     typeof raw.password!=='string'||
     !/^[A-Za-z0-9_-]{32,128}$/.test(raw.password))
    throw Error('bootstrap-untrusted');
  trusted=Object.freeze({
    device:pubKey(raw.deviceSpki),
    receipt:pubKey(raw.receiptSpki),
    attestor:pubKey(raw.attestorSpki)
  });
  const distinct=[trusted.device,trusted.receipt,trusted.attestor].map(x=>
    x.export({format:'der',type:'spki'}).toString('base64'));
  if(new Set(distinct).size!==3)throw Error('confused-signer-role');
  const response=await fetch(
    AUTH+'/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-only',
    {method:'POST',redirect:'error',headers:{'content-type':'application/json'},
      body:JSON.stringify({email:raw.email,password:raw.password,returnSecureToken:true}),
      signal:AbortSignal.timeout(6000)});
  if(!response.ok)throw Error('issuer-login-denied');
  const data=await response.json();
  if(typeof data.idToken!=='string'||data.idToken.length<50)
    throw Error('missing-issuer-id-token');
  const parts=data.idToken.split('.');
  if(parts.length!==3)throw Error('invalid-issuer-token');
  const claim=JSON.parse(Buffer.from(parts[1],'base64url').toString('utf8'));
  if((claim.user_id||claim.sub)!==UID||claim.aud!==PROJECT||
     claim.fg_issue_admission_v1!==true||
     claim.fg_issuer_generation!==1)
    throw Error('incorrect-provisioned-issuer');
  token=data.idToken; // secret stays in this child, never sent by IPC
}
function localUrl(path){
  if(!ALLOWED_READ.has(path))throw Error('out-of-scope-RTDB-path');
  const url=new URL(DB+path+'.json');
  url.searchParams.set('ns',NAMESPACE);
  url.searchParams.set('auth',token);
  if(url.origin!==DB)throw Error('not-loopback');
  return url;
}
async function request(path,method='GET',payload){
  if(!ALLOWED_READ.has(path) ||
    !(method==='GET'||method==='PUT'&&path===PATHS.ticket))
    throw Error('out-of-scope-RTDB-operation');
  const response=await fetch(localUrl(path),{
    method,redirect:'error',signal:AbortSignal.timeout(6000),
    ...(payload===undefined?{}:{
      headers:{'content-type':'application/json'},
      body:JSON.stringify(payload)
    })
  });
  if(!response.ok)throw Error('scoped-RTDB-rule-denied');
  return response.json();
}
async function readAuthority(){
  const [operator,publisher,incident,device,checkpoint]=await Promise.all([
    request(PATHS.issuer),request(PATHS.publisher),request(PATHS.incident),
    request(PATHS.device),request(PATHS.checkpoint)
  ]);
  if(!exact(operator,['enabled','generation','revision','scope'])||
     !exact(publisher,['enabled','deviceId','epoch','scope'])||
     !exact(incident,['blocked','epoch'])||
     !exact(device,['enabled','scope'])||
     !exact(checkpoint,['initialized','deviceId','epoch',
       'sequence','digest','observedAtMs'])||
     checkpoint.deviceId!==DEVICE)
    throw Error('authority-state-not-verifiable');
  return Object.freeze({
    revision:operator.revision,
    issuer:Object.freeze({
      enabled:operator.enabled,generation:operator.generation,scope:operator.scope}),
    publisher:Object.freeze({...publisher}),
    incident:Object.freeze({...incident}),
    sourceBinding:Object.freeze({
      deviceId:DEVICE,epoch:1,enabled:device.enabled,scope:device.scope,
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
async function initialize(message){
  if(initialized||!exact(message,['id','type'])||message.type!=='init')
    return send(message?.id??0,false,'invalid-init');
  try{
    await bootstrap();
    issuer=createH4OfflineAdmissionIssuer({
      authority:Object.freeze({read:readAuthority}),
      clock:()=>Date.now()
    });
    initialized=true;
    send(message.id,true,'ready',{scope:'LAB_TICKET_ONLY'});
  }catch{
    send(message.id,false,'bootstrap-refused');
  }
}
// RTDB JSON responses can reorder object keys. Compare exact key SET and
// scalar values, never JSON.stringify order. Reject missing/extra keys.
const TICKET_FIELDS=Object.freeze([
  'enabled','deviceId','epoch','sequence','digest','observedAtMs',
  'distanceCm','levelCm','status','issuedAtMs','expiresAtMs'
]);
function sameTicket(actual,expected){
  return actual!==null&&typeof actual==='object'&&
    !Array.isArray(actual)&&
    Object.keys(actual).length===TICKET_FIELDS.length&&
    TICKET_FIELDS.every(k=>Object.hasOwn(actual,k)&&
      Object.hasOwn(expected,k)&&actual[k]===expected[k]);
}
async function issue(message){
  if(!initialized||!exact(message,['id','type','evidence'])||
     message.type!=='issue'||!Number.isSafeInteger(message.id)||
     message.id<1)return send(message?.id??0,false,'invalid-request');
  try{
    const prepared=await issuer.issue(message.evidence);
    if(prepared.issued!==true||prepared.releaseDecision!=='NO_GO'||
       prepared.canPublish!==false||prepared.canWriteFirebase!==false)
      return send(message.id,false,'signed-evidence-or-authority-denied');
    const wrote=await request(PATHS.ticket,'PUT',prepared.ticket);
    if(!sameTicket(wrote,prepared.ticket))
      return send(message.id,false,'write-outcome-unknown');
    const persisted=await request(PATHS.ticket,'GET');
    if(!sameTicket(persisted,prepared.ticket))
      return send(message.id,false,'readback-mismatch');
    // Never export a token, the raw ticket, private key or arbitrary DB data.
    send(message.id,true,'SYNTHETIC_TICKET_STORED_NOT_PUBLISHED',{
      sequence:prepared.ticket.sequence,
      digest:prepared.ticket.digest,
      releaseDecision:'NO_GO'
    });
  }catch{
    // A write can succeed and its ACK can be lost. Never retry automatically.
    send(message.id,false,'issuer-or-commit-refused');
  }
}
process.on('message',message=>{
  if(busy)return send(message?.id??0,false,'issuer-busy-refused');
  busy=true;
  Promise.resolve().then(()=>initialized?issue(message):initialize(message))
    .catch(()=>send(message?.id??0,false,'issuer-failed-closed'))
    .finally(()=>{busy=false;});
});
process.on('disconnect',()=>{
  token=undefined;trusted=undefined;issuer=undefined;process.exit(0);
});
