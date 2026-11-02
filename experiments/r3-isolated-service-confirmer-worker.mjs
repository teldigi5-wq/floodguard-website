// FloodGuard R3 — ISOLATED, DISPOSABLE AUTH+RTDB EMULATOR WORKER ONLY.
// Starts ONLY as a child with an existing IPC channel and pinned localhost
// demo-project environment. Never use with deployed Firebase, Admin RTDB,
// field equipment, WhatsApp/SMS or production device/issuer credentials.
// Important: a stolen service bearer token STILL bypasses optional Ed25519
// application verification; process confinement is defense in depth only.
import {createPublicKey,createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {createVersionedEmulatorConfirmer}
  from './versioned-confirmation-emulator.mjs';

const PROJECT='demo-r3-isolated-service-confirmer';
const AUTH='http://127.0.0.1:9099';
const DB='http://127.0.0.1:9000';
const NS=PROJECT+'-default-rtdb';
const BASE='/floodguard';
const ID='device-stage-a';
const CONFIRM=BASE+'/confirmedLab/records/'+ID+'/2';
const ALLOWED_READ=new Set([
  BASE+'/confirmerLabAuthorization/confirmer-stage',
  BASE+'/deviceAuthorization/'+ID,
  BASE+'/staging/ingestV1/'+ID,
  CONFIRM
]);
const NOW=1700000003500;
if(process.env.FG_R3_ISOLATED_WORKER_TEST!=='1'||
   process.env.FG_VERSIONED_CONFIRMATION_TEST!=='1'||
   process.env.GCLOUD_PROJECT!==PROJECT||
   process.env.FIREBASE_AUTH_EMULATOR_HOST!=='127.0.0.1:9099'||
   process.env.FIREBASE_DATABASE_EMULATOR_HOST!=='127.0.0.1:9000'||
   typeof process.send!=='function'||process.connected!==true){
  throw Error('Refusing execution outside pinned local IPC emulator harness');
}
let initialized=false,processing=false,confirm;
// The service identity MUST be provisioned by a separate trusted operator
// test harness. This process has NO Auth Admin SDK or create-user ability.
// A one-use dedicated fd4 pipe carries only local emulator login material.
let bootstrapConsumed=false;
async function receiveProvisionedIdentity(){
  if(bootstrapConsumed)throw Error('Provisioning may occur only once');
  bootstrapConsumed=true;
  const chunks=[];
  let size=0;
  for await(const part of createReadStream(null,{fd:4,autoClose:true})){
    size+=part.length;
    if(size>1024)throw Error('Bootstrap input too large');
    chunks.push(part);
  }
  if(size===0)throw Error('Missing trusted bootstrap');
  const data=JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if(!exact(data,['email','password'])||
     data.email!=='service-confirm-stage@floodguard-lab.invalid'||
     typeof data.password!=='string'||
     !/^[A-Za-z0-9_-]{32,128}$/.test(data.password))
    throw Error('Invalid operator-provisioned test identity');
  return data;
}
function send(value) {
  if(process.connected)process.send(value);
}
function failure(id,reason){
  send({id,ok:false,reason});
}
function exact(v,ks) {
  return v!==null&&typeof v==='object'&&!Array.isArray(v)&&
    Object.getPrototypeOf(v)===Object.prototype&&
    Object.keys(v).length===ks.length&&ks.every(k=>Object.hasOwn(v,k));
}
function publicKey(spki) {
  if(typeof spki!=='string'||spki.length<40||spki.length>200||
     !/^[A-Za-z0-9+/]+={0,2}$/.test(spki))throw Error('Invalid synthetic trust key');
  const k=createPublicKey({key:Buffer.from(spki,'base64'),format:'der',type:'spki'});
  if(k.asymmetricKeyType!=='ed25519')throw Error('Wrong signer algorithm');
  return k;
}
function tokenUrl(path) {
  if(!ALLOWED_READ.has(path))throw Error('Out-of-scope local DB path');
  const u=new URL(DB+path+'.json');
  u.searchParams.set('ns',NS);
  u.searchParams.set('auth',token);
  return u;
}
let token; // Only held in the isolated worker's memory, never sent over IPC.
async function dbRequest(path,method='GET',value) {
  if(!ALLOWED_READ.has(path)||method!=='GET'&&!(method==='PUT'&&path===CONFIRM))
    throw Error('Database capability denied');
  const response=await fetch(tokenUrl(path),{
    method,headers:{'content-type':'application/json'},
    ...(value===undefined?{}:{body:JSON.stringify(value)}),
    signal:AbortSignal.timeout(5000)
  });
  if(response.status!==200)throw Error('Scoped database request refused');
  if(method==='PUT')return null;
  return response.json();
}
const database=Object.freeze({
  ref(path) {
    if(!ALLOWED_READ.has(path))throw Error('Out-of-scope local DB path');
    return Object.freeze({
      async get(){const value=await dbRequest(path);return {val:()=>value};},
      async set(value){await dbRequest(path,'PUT',value);}
    });
  }
});
async function setup(message){
  if(initialized||!exact(message,['id','type','deviceSpki','receiptSpki'])||
     message.type!=='init')return failure(message?.id??0,'bootstrap-invalid');
  try {
    const deviceKey=publicKey(message.deviceSpki);
    const receiptKey=publicKey(message.receiptSpki);
    const digest=x=>createHash('sha256').update(
      x.export({format:'der',type:'spki'})).digest('hex');
    if(digest(deviceKey)===digest(receiptKey))
      return failure(message.id,'role-key-confusion');
    // The operator test harness has already created the service UID/role.
    // The runtime cannot mint principals, change claims or grant itself scope.
    // Only fd4 carries the ephemeral password once; ordinary IPC cannot ask
    // for credentials, arbitrary URLs or writes.
    const credentials=await receiveProvisionedIdentity();
    const res=await fetch(
      AUTH+'/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-only',
      {
        method:'POST',headers:{'content-type':'application/json'},
        body:JSON.stringify({email:credentials.email,
          password:credentials.password,returnSecureToken:true}),
        signal:AbortSignal.timeout(5000)
      });
    if(!res.ok)throw Error('Local Auth Emulator refused synthetic worker');
    const data=await res.json();
    if(typeof data.idToken!=='string'||data.idToken.length<50)
      throw Error('No local Auth ID token');
    const parts=data.idToken.split('.');
    if(parts.length!==3)throw Error('Invalid emulator session');
    const claim=JSON.parse(Buffer.from(parts[1],'base64url').toString());
    if((claim.user_id||claim.sub)!=='service-confirm-stage'||
       claim.aud!==PROJECT||claim.fg_server_confirm_v1!==true)
      throw Error('Provisioned principal missing expected scoped role');
    token=data.idToken;
    // Do not return the token, password, or any private credential in any
    // response, exception, log or process title.
    confirm=createVersionedEmulatorConfirmer({
      database,deviceId:ID,devicePublicKey:deviceKey,
      receiptPublicKey:receiptKey,clock:()=>NOW
    });
    initialized=true;
    send({id:message.id,ok:true,type:'ready',
      scope:'OFFLINE_SYNTHETIC_CONFIRM_ONLY',
      deviceFingerprint:digest(deviceKey),
      canPublish:false,canOperateGate:false,productionGo:false});
  }catch{
    return failure(message.id,'bootstrap-refused');
  }
}
async function processMessage(message){
  if(!exact(message,['id','type','evidence'])||message.type!=='confirm'||
     !Number.isSafeInteger(message.id)||message.id<1||
     !initialized||typeof confirm!=='function')
    return failure(message?.id??0,'request-invalid');
  try {
    const result=await confirm(message.evidence);
    if(result?.ok===true) {
      // No opaque error data or bearer credential escapes the process.
      send({id:message.id,ok:true,kind:result.kind,
        sequence:result.sequence,
        canPublish:false,canOperateGate:false,productionGo:false});
    }else{
      const reason=typeof result?.reason==='string'&&
        /^[a-z0-9-]{1,64}$/.test(result.reason)?
          result.reason:'verification-denied';
      failure(message.id,reason);
    }
  }catch {
    failure(message.id,'confirmation-unavailable');
  }
}
process.on('message',message=>{
  if(processing)return failure(message?.id??0,'worker-busy-denied');
  processing=true;
  Promise.resolve().then(()=>initialized?processMessage(message):setup(message))
    .catch(()=>failure(message?.id??0,'worker-failed-closed'))
    .finally(()=>{processing=false;});
});
process.on('disconnect',async()=>{
  token=undefined;
  process.exit(0);
});
