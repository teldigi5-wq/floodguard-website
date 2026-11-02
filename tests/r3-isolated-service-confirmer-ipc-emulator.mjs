// FloodGuard R3: REAL local Auth+RTDB Emulator, child-process IPC demo.
// All users, keys and data are synthetic. A successful test does NOT secure
// a stolen Firebase service credential or prove production source identity.
import {test,before,after,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {fork} from 'node:child_process';
import {randomBytes,generateKeyPairSync,createHash,sign}
  from 'node:crypto';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {initializeApp,deleteApp} from 'firebase-admin/app';
import {getAuth} from 'firebase-admin/auth';
import {canonicalOfflineEnvelope}
  from '../experiments/stage7-durable-ingress.mjs';

const PROJECT='demo-r3-isolated-service-confirmer';
const AUTH='http://127.0.0.1:9099';
const RTDB='http://127.0.0.1:9000';
const NAMESPACE=PROJECT+'-default-rtdb';
const ROOT='/floodguard',ID='device-stage-a';
const STAGE=ROOT+'/staging/ingestV1/'+ID;
const RECORD=ROOT+'/confirmedLab/records/'+ID+'/2';
const PUBLIC=ROOT+'/publicationLab/water';
const NOW=1700000003500;
const FRAME={sequence:2,distanceCm:16.5,levelCm:8.5,risk:'WARNING'};
const DEVICE=generateKeyPairSync('ed25519');
const RECEIPT=generateKeyPairSync('ed25519');
const HASH=createHash('sha256')
  .update(DEVICE.publicKey.export({format:'der',type:'spki'}))
  .digest('hex');
const SPKI=k=>k.export({format:'der',type:'spki'}).toString('base64');
const ROLES={
  device:[ID,'fg_ingest_v1'],
  attestor:['attestor-stage','fg_attest_ingest_v1'],
  ordinary:['ordinary-stage',null]
};
if(process.env.FG_R3_ISOLATED_SERVICE_HARNESS!=='1'||
   process.env.GCLOUD_PROJECT!==PROJECT||
   process.env.FIREBASE_AUTH_EMULATOR_HOST!=='127.0.0.1:9099'||
   process.env.FIREBASE_DATABASE_EMULATOR_HOST!=='127.0.0.1:9000')
  throw Error('Pinned localhost-only isolated service integration required');
let authApp,users,tokens,child,serial=0;
const pending=new Map();
const owner='__TEST_OWNER_ONLY__';
function dbUrl(p,role) {
  if(typeof p!=='string'||!(p===ROOT||p.startsWith(ROOT+'/'))||
     p.includes('..')||p.includes('?')||p.includes('#'))
    throw Error('Invalid synthetic test path');
  const url=new URL(RTDB+p+'.json');
  url.searchParams.set('ns',NAMESPACE);
  if(role===owner)url.searchParams.set('access_token','owner');
  else if(role)url.searchParams.set('auth',tokens[role]);
  return url;
}
async function call(url,method='GET',body){
  const res=await fetch(url,{
    method,headers:{'content-type':'application/json'},
    ...(body===undefined?{}:{body:JSON.stringify(body)}),
    signal:AbortSignal.timeout(7000)
  });
  const raw=await res.text();
  let data;try{data=JSON.parse(raw);}catch{data=null;}
  return {status:res.status,data};
}
const db=(path,role,method='GET',value)=>call(dbUrl(path,role),method,value);
async function seed(path,value){
  const r=await db(path,owner,'PUT',value);
  assert.equal(r.status,200,'Emulator-only fixture setup failed');
}
const granted=async p=>{
  const r=await p;
  assert.equal(r.status,200,'Expected valid scoped emulator operation');
  return r.data;
};
const denied=async p=>{
  const r=await p;
  assert.ok([401,403].includes(r.status),'Unsafe DB operation '+r.status);
};
async function signin(role){
  const [uid,claim]=ROLES[role],credentials=users[role];
  const response=await call(
    AUTH+'/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-only',
    'POST',{email:credentials.email,password:credentials.password,
      returnSecureToken:true});
  assert.equal(response.status,200,'Auth Emulator sign-in failure');
  const token=response.data.idToken;
  const payload=JSON.parse(Buffer.from(token.split('.')[1],'base64url').toString());
  assert.equal(payload.user_id||payload.sub,uid);
  assert.equal(payload.aud,PROJECT);
  if(claim)assert.equal(payload[claim],true);
  return token;
}
function signedEvidence(sequence=2){
  const envelope={
    version:'floodguard-offline-envelope-v1',deviceId:ID,epoch:1,
    observedAtMs:NOW-400,frame:{...FRAME,sequence}
  };
  const digest=createHash('sha256').update(canonicalOfflineEnvelope(envelope))
    .digest('hex');
  const receipt={
    version:'floodguard-offline-receipt-v1',deviceId:ID,epoch:1,
    sequence,digest,acceptedAtMs:NOW-100
  };
  return {
    envelope,receipt,
    deviceSignature:sign(null,Buffer.from(canonicalOfflineEnvelope(envelope)),
      DEVICE.privateKey).toString('base64url'),
    receiptSignature:sign(null,Buffer.from(JSON.stringify(receipt)),
      RECEIPT.privateKey).toString('base64url')
  };
}
function ipc(message,timeoutMs=8000){
  if(!child||child.exitCode!==null||!child.connected)
    return Promise.resolve({ok:false,reason:'child-disconnected'});
  const id=++serial;
  return new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{
      pending.delete(id);
      reject(Error('Test IPC response timeout; no default approval'));
    },timeoutMs);
    pending.set(id,{resolve,reject,timer});
    child.send({...message,id},error=>{
      if(error){
        clearTimeout(timer);pending.delete(id);
        reject(Error('Test IPC channel unavailable'));
      }
    });
  });
}
before(async()=>{
  authApp=initializeApp({projectId:PROJECT},'r3-isolated-host-fixture');
  const auth=getAuth(authApp);
  users={};
  for(const [role,[uid,claim]] of Object.entries(ROLES)){
    const email=uid+'@floodguard-lab.invalid';
    const password=randomBytes(28).toString('base64url');
    await auth.createUser({uid,email,password});
    if(claim)await auth.setCustomUserClaims(uid,{[claim]:true});
    users[role]={email,password};
  }
  // Child has its own address space and generates its own ephemeral password.
  // NEVER pass an Auth service bearer token, password, or Admin credential in
  // argv, env, IPC bootstrap, imported module or response body.
  const entry=fileURLToPath(new URL(
    '../experiments/r3-isolated-service-confirmer-worker.mjs',import.meta.url));
  child=fork(entry,[],{
    cwd:process.cwd(),
    execArgv:[],
    stdio:['ignore','pipe','pipe','ipc'],
    env:{
      PATH:process.env.PATH,
      HOME:process.env.HOME,
      FG_R3_ISOLATED_WORKER_TEST:'1',
      FG_VERSIONED_CONFIRMATION_TEST:'1',
      GCLOUD_PROJECT:PROJECT,
      FIREBASE_AUTH_EMULATOR_HOST:'127.0.0.1:9099',
      FIREBASE_DATABASE_EMULATOR_HOST:'127.0.0.1:9000'
    }
  });
  child.stdout.on('data',()=>{}); // no secret-bearing child stdout forwarded
  child.stderr.on('data',()=>{}); // ignore, do not echo credentials
  child.on('message',reply=>{
    const task=pending.get(reply?.id);
    if(!task)return;
    clearTimeout(task.timer);pending.delete(reply.id);
    task.resolve(reply);
  });
  child.on('exit',()=>{
    for(const task of pending.values()){
      clearTimeout(task.timer);
      task.resolve({ok:false,reason:'worker-exited'});
    }
    pending.clear();
  });
  const ready=await ipc({
    type:'init',deviceSpki:SPKI(DEVICE.publicKey),
    receiptSpki:SPKI(RECEIPT.publicKey)
  },15000);
  assert.equal(ready.ok,true,JSON.stringify(ready));
  assert.equal(ready.type,'ready');
  assert.equal(ready.deviceFingerprint,HASH);
  assert.equal(ready.productionGo,false);
  assert.equal(child.pid!==process.pid,true);
  assert.equal(JSON.stringify(ready).includes('idToken'),false);
});
after(async()=>{
  if(child&&child.connected)child.disconnect();
  if(child&&!child.killed)child.kill('SIGTERM');
  if(authApp)await deleteApp(authApp);
});
beforeEach(async()=>{
  tokens={};
  for(const role of Object.keys(ROLES))tokens[role]=await signin(role);
  await seed(ROOT,{
    deviceAuthorization:{[ID]:{enabled:true,scope:'prototype-ingest-v1'}},
    confirmerLabAuthorization:{
      'confirmer-stage':{enabled:true,scope:'confirmer-ingest-v1',
        deviceId:ID,epoch:1,deviceKeyFingerprint:HASH}
    },
    attestorLabAuthorization:{
      'attestor-stage':{enabled:true,scope:'attestor-ingest-v1',
        deviceId:ID,epoch:1,deviceKeyFingerprint:HASH}
    },
    publisherLabAuthorization:{
      'publisher-water-stage':{enabled:true,
        scope:'publication-lab-water-v1',deviceId:ID,epoch:1}
    },
    publicationLab:{water:{
      current:{distanceCm:20,levelCm:5,status:'SAFE',
        observedAtMs:NOW-3000,overallRisk:'UNKNOWN'},
      checkpoint:{initialized:true,deviceId:ID,epoch:1,sequence:1,
        digest:'0'.repeat(64),observedAtMs:NOW-3000}
    }},
    live:{water:{status:'SAFE'},gate:{status:'CLOSED',angle:0},
      esp8266:{ip:'192.0.2.22',wifi:'PRIVATE-SYNTHETIC'}}
  });
});

test('isolated child verifies both Ed25519 signatures and persists exact immutable confirmation',async()=>{
  const x=signedEvidence();
  await granted(db(STAGE,'device','PUT',x.envelope.frame));
  const result=await ipc({type:'confirm',evidence:x});
  assert.equal(result.ok,true,JSON.stringify(result));
  assert.equal(result.kind,'IMMUTABLE_EMULATOR_RECORD_ONLY');
  assert.equal(result.sequence,2);
  assert.equal(result.productionGo,false);
  assert.equal(result.canPublish,false);
  assert.equal(result.canOperateGate,false);
  const confirmed=await granted(db(RECORD,'attestor'));
  assert.equal(confirmed.digest,x.receipt.digest);
  assert.equal(confirmed.frame.risk,'WARNING');
  assert.equal(JSON.stringify(result).includes('idToken'),false);
  await denied(db(PUBLIC,'device','PUT',{}));
});
test('invalid sensor or receipt signatures never cross child write boundary',async()=>{
  const x=signedEvidence();
  await granted(db(STAGE,'device','PUT',FRAME));
  for(const bad of [
    {...x,deviceSignature:'A'.repeat(86)},
    {...x,receiptSignature:'B'.repeat(86)},
    {...x,receipt:{...x.receipt,digest:'f'.repeat(64)}},
    {...x,envelope:{...x.envelope,deviceId:'device-stage-b'}}
  ]){
    const result=await ipc({type:'confirm',evidence:bad});
    assert.equal(result.ok,false,JSON.stringify(result));
    assert.equal((await granted(db(RECORD,owner))),null);
  }
});
test('untrusted ordinary and device credentials cannot write immutable record',async()=>{
  const x=signedEvidence();
  await granted(db(STAGE,'device','PUT',FRAME));
  for(const role of ['device','ordinary',null])
    await denied(db(RECORD,role,'PUT',{
      version:'floodguard-confirmed-record-v1',epoch:1,
      sequence:2,digest:x.receipt.digest,acceptedAtMs:NOW-100,
      observedAtMs:NOW-400,frame:FRAME
    }));
  await denied(db(PUBLIC,'ordinary','PUT',{}));
  await denied(db(ROOT+'/live/gate/angle','device','PUT',90));
});
test('worker IPC rejects token export, arbitrary DB path and arbitrary command',async()=>{
  const denied1=await ipc({type:'exportToken'});
  assert.equal(denied1.ok,false);
  assert.equal(denied1.reason,'request-invalid');
  const denied2=await ipc({type:'write',path:ROOT+'/live/gate/angle',value:90});
  assert.equal(denied2.ok,false);
  assert.equal(denied2.reason,'request-invalid');
  const denied3=await ipc({type:'confirm',evidence:null});
  assert.equal(denied3.ok,false);
  assert.equal(denied3.productionGo,undefined);
  assert.equal(JSON.stringify(denied3).includes('Bearer'),false);
  assert.equal(JSON.stringify(denied3).includes('idToken'),false);
});
test('source permits only exact four read paths and one immutable DB write target',()=>{
  const source=readFileSync(
    'experiments/r3-isolated-service-confirmer-worker.mjs','utf8');
  assert.match(source,/ALLOWED_READ=new Set/);
  assert.match(source,/method==='PUT'&&path===CONFIRM/);
  assert.match(source,/createVersionedEmulatorConfirmer/);
  assert.doesNotMatch(source,/firebase-admin\/database|serviceAccount|\.listen\s*\(/);
  assert.doesNotMatch(source,/process\.argv\[[0-9]+\]|process\.title\s*=/);
  assert.match(source,/process\.send/);
});
test('an untrusted caller cannot impersonate child synthetic service identity with its own ID token',async()=>{
  const x=signedEvidence();
  await granted(db(STAGE,'device','PUT',FRAME));
  await denied(db(RECORD,'ordinary','PUT',{
    version:'floodguard-confirmed-record-v1',
    epoch:1,sequence:2,digest:'f'.repeat(64),
    acceptedAtMs:NOW-100,observedAtMs:NOW-400,frame:FRAME
  }));
  assert.equal((await granted(db(RECORD,owner))),null);
  assert.equal(child.spawnargs.some(x=>x.includes('idToken')),false);
  assert.equal(child.spawnargs.some(x=>x.includes('serviceAccount')),false);
});
test('revoked device or disabled operator fails closed through child verifier',async()=>{
  const x=signedEvidence();
  await granted(db(STAGE,'device','PUT',FRAME));
  await seed(ROOT+'/deviceAuthorization/'+ID+'/enabled',false);
  const result=await ipc({type:'confirm',evidence:x});
  assert.equal(result.ok,false);
  await seed(ROOT+'/deviceAuthorization/'+ID+'/enabled',true);
  await seed(ROOT+'/confirmerLabAuthorization/confirmer-stage/enabled',false);
  assert.equal((await ipc({type:'confirm',evidence:x})).ok,false);
  assert.equal((await granted(db(RECORD,owner))),null);
});
test('replayed signed evidence does not silently modify immutable confirmed row',async()=>{
  const x=signedEvidence();
  await granted(db(STAGE,'device','PUT',FRAME));
  const first=await ipc({type:'confirm',evidence:x});
  assert.equal(first.ok,true);
  const next=await ipc({type:'confirm',evidence:x});
  assert.equal(next.ok,true); // exact readback is reconciliation, not a new write
  assert.equal(next.kind,'RECOVERED_IMMUTABLE_EMULATOR_RECORD_ONLY');
  const record=await granted(db(RECORD,owner));
  assert.equal(record.sequence,2);
  assert.equal(record.digest,x.receipt.digest);
  assert.equal(record.frame.risk,'WARNING');
});
