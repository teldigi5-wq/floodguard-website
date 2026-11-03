// R3 H10: test-only CAS with incident AND all three authorizers in ONE node.
// Reuses H4's existing three-Ed25519 signature gate; does NOT replace ingestion.
// Hardcoded Firebase Emulator owner bypass is NOT a production credential.
// Crash-injection IPC phases are available ONLY under the pinned demo project.
import {createPublicKey} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {isDeepStrictEqual} from 'node:util';
import {createH4OfflineAdmissionIssuer} from './r3-h4-signed-admission-issuer.mjs';

const PROJECT='demo-r3-h10-canonical';
const BASE='http://127.0.0.1:9000';
const NS=PROJECT+'-default-rtdb';
const DEVICE='device-stage-a';
const ROOT='/floodguard';
const PATH=Object.freeze({node:ROOT+'/atomicPublicationLab/'+DEVICE});
const ALLOWED=new Set(Object.values(PATH));
const KEYS=['deviceSpki','receiptSpki','attestorSpki'];
const exact=(x,fields)=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&
  Object.getPrototypeOf(x)===Object.prototype&&
  Object.keys(x).length===fields.length&&fields.every(k=>Object.hasOwn(x,k));

if(process.env.FG_R3_H10_TEST!=='1'||process.env.GCLOUD_PROJECT!==PROJECT||
  process.env.FIREBASE_DATABASE_EMULATOR_HOST!=='127.0.0.1:9000'||
  process.env.FIREBASE_AUTH_EMULATOR_HOST!=='127.0.0.1:9099'||
  typeof process.send!=='function'||!process.connected)
  throw Error('Refusing non-demo H10 canonical-authority worker');

let trusted,issuer,ready=false,busy=false,resume=null,resumeId=null;
function reply(id,ok,reason,more={}){
  if(process.connected)process.send({id,ok,reason,...more,
    releaseDecision:'NO_GO',productionGo:false,canOperateGate:false,
    canSendAlert:false});
}
function ed25519(s){
  if(typeof s!=='string'||s.length<40||s.length>256||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(s))throw Error('bad-public-key');
  const k=createPublicKey({key:Buffer.from(s,'base64'),type:'spki',format:'der'});
  if(k.type!=='public'||k.asymmetricKeyType!=='ed25519')
    throw Error('untrusted-public-key');
  return k;
}
async function bootstrap(){
  const parts=[];let n=0;
  for await(const chunk of createReadStream(null,{fd:4,autoClose:true})){
    n+=chunk.length;if(n>2048)throw Error('invalid-trust-bootstrap');
    parts.push(chunk);
  }
  const keys=JSON.parse(Buffer.concat(parts).toString('utf8'));
  if(!exact(keys,KEYS))throw Error('wrong-bootstrap');
  const all=KEYS.map(x=>ed25519(keys[x]));
  if(new Set(all.map(k=>k.export({format:'der',type:'spki'}).toString('base64'))).size!==3)
    throw Error('key-role-collision');
  trusted=Object.freeze({device:all[0],receipt:all[1],attestor:all[2]});
}
function endpoint(path){
  if(!ALLOWED.has(path))throw Error('out-of-scope-path');
  const u=new URL(BASE+path+'.json');
  u.searchParams.set('ns',NS);
  u.searchParams.set('access_token','owner'); // Emulator only
  if(u.hostname!=='127.0.0.1'||u.origin!==BASE)throw Error('not-local');
  return u;
}
async function request(path,method='GET',payload,etag){
  if(!ALLOWED.has(path)||!(method==='GET'||method==='PUT'&&path===PATH.node))
    throw Error('operation-not-scoped');
  const headers={};
  if(method==='GET'&&etag===true)headers['X-Firebase-ETag']='true';
  if(method==='PUT'){
    if(typeof etag!=='string'||etag.length<1||etag.length>256)
      throw Error('missing-atomic-node-etag');
    headers['if-match']=etag;
    headers['content-type']='application/json';
  }
  const r=await fetch(endpoint(path),{
    method,headers,redirect:'error',signal:AbortSignal.timeout(6000),
    ...(payload===undefined?{}:{body:JSON.stringify(payload)})
  });
  if(r.status!==200)throw Error('atomic-cas-or-read-denied');
  return {value:await r.json(),etag:r.headers.get('etag')};
}
async function authority(){
  // ALL revocation, quarantine and checkpoint state comes from ONE atomic
  // node. No fallback reads of legacy issuer/publisher/device permission rows.
  const {value:node}=await request(PATH.node);
  if(!exact(node,['control','current','checkpoint'])||
     !exact(node.control,['epoch','blocked','revision','device','publisher','issuer'])||
     !exact(node.control.device,['enabled','scope'])||
     !exact(node.control.publisher,['enabled','deviceId','epoch','scope'])||
     !exact(node.control.issuer,['enabled','generation','scope'])||
     !exact(node.checkpoint,['initialized','deviceId','epoch','sequence','digest','observedAtMs'])||
     node.checkpoint.deviceId!==DEVICE)
    throw Error('canonical-authority-shape-invalid');
  return {
    revision:node.control.revision,
    issuer:{...node.control.issuer},
    publisher:{...node.control.publisher},
    incident:{blocked:node.control.blocked,epoch:node.control.epoch},
    sourceBinding:{deviceId:DEVICE,epoch:node.control.epoch,
      enabled:node.control.device.enabled,scope:node.control.device.scope,
      publicKey:trusted.device},
    trustedReceiptKey:trusted.receipt,
    trustedDatabaseIssuerKey:trusted.attestor,
    lastPublished:{initialized:node.checkpoint.initialized,
      epoch:node.checkpoint.epoch,sequence:node.checkpoint.sequence,
      digest:node.checkpoint.digest}
  };
}
async function init(msg){
  if(ready||!exact(msg,['id','type'])||msg.type!=='init')
    return reply(msg?.id??0,false,'invalid-init');
  try{
    await bootstrap();
    issuer=createH4OfflineAdmissionIssuer({
      authority:Object.freeze({read:authority}),clock:()=>Date.now()
    });
    ready=true;
    reply(msg.id,true,'ready',{scope:'CANONICAL_AUTHORITY_ATOMIC_DEMO_ONLY'});
  }catch{reply(msg?.id??0,false,'bootstrap-refused');}
}
async function pauseUntilResume(id,phase){
  if(!process.connected)throw Error('disconnected-before-phase');
  process.send({id,phase,releaseDecision:'NO_GO'});
  await new Promise((resolve)=>{resume=resolve;resumeId=id;});
  resume=null;resumeId=null;
}
async function commit(msg){
  if(!ready||!exact(msg,['id','type','evidence','mode'])||
    msg.type!=='commit'||!Number.isSafeInteger(msg.id)||msg.id<1||
    !['normal','pauseBefore','pauseAfter'].includes(msg.mode))
    return reply(msg?.id??0,false,'invalid-request');
  try{
    const before=await request(PATH.node,'GET',undefined,true);
    if(!before.etag||!exact(before.value,['control','current','checkpoint'])||
      !exact(before.value.control,['epoch','blocked','revision','device','publisher','issuer'])||
      before.value.control.epoch!==1||before.value.control.blocked!==false||
      !exact(before.value.checkpoint,['initialized','deviceId','epoch',
        'sequence','digest','observedAtMs'])||
      before.value.checkpoint.initialized!==true||
      before.value.checkpoint.epoch!==1||
      before.value.checkpoint.deviceId!==DEVICE)
      return reply(msg.id,false,'atomic-authority-unverified');
    const prepared=await issuer.issue(msg.evidence); // mandatory three signatures
    if(prepared.issued!==true||prepared.releaseDecision!=='NO_GO'||
       prepared.canPublish!==false||prepared.canWriteFirebase!==false||
       prepared.candidate.checkpoint.sequence!==before.value.checkpoint.sequence+1||
       prepared.candidate.checkpoint.digest===before.value.checkpoint.digest)
      return reply(msg.id,false,'signed-evidence-denied');
    const again=await request(PATH.node,'GET',undefined,true);
    if(again.etag!==before.etag||!isDeepStrictEqual(again.value,before.value))
      return reply(msg.id,false,'atomic-node-changed-during-validation');
    if(prepared.ticket.expiresAtMs<Date.now())
      return reply(msg.id,false,'signed-candidate-expired');
    if(msg.mode==='pauseBefore')await pauseUntilResume(msg.id,'pre-cas');
    const next={
      control:before.value.control,
      current:prepared.candidate.current,
      checkpoint:prepared.candidate.checkpoint
    };
    await request(PATH.node,'PUT',next,before.etag);
    if(msg.mode==='pauseAfter'){
      // Deterministic evidence: RTDB returned HTTP 200 for the CAS, but the
      // caller has not yet received the normal success acknowledgement.
      if(process.connected)process.send({
        id:msg.id,phase:'post-cas-before-ack',releaseDecision:'NO_GO'});
      await new Promise(()=>{}); // test harness kills child intentionally
    }
    const after=await request(PATH.node);
    if(!isDeepStrictEqual(after.value,next))
      return reply(msg.id,false,'commit-readback-unverified');
    reply(msg.id,true,'SYNTHETIC_CANONICAL_AUTHORITY_CAS_COMMITTED',{
      sequence:prepared.candidate.checkpoint.sequence,
      digest:prepared.candidate.checkpoint.digest
    });
  }catch{
    // An unknown POST/PUT outcome is never retried here.
    reply(msg?.id??0,false,'cas-or-commit-outcome-uncertain');
  }
}
process.on('message',msg=>{
  if(msg?.type==='resume'){
    if(busy&&resume&&msg.id===resumeId)resume();
    return;
  }
  if(busy)return reply(msg?.id??0,false,'busy-refused');
  busy=true;
  Promise.resolve().then(()=>ready?commit(msg):init(msg))
    .catch(()=>reply(msg?.id??0,false,'worker-failed-closed'))
    .finally(()=>{busy=false;});
});
process.on('disconnect',()=>{trusted=undefined;issuer=undefined;process.exit(0);});
