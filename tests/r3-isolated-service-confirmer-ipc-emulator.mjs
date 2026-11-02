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
let authApp,adminAuth,users,tokens,child,serial=0;
let serviceTestPassword;
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
  adminAuth=auth;
  users={};
  for(const [role,[uid,claim]] of Object.entries(ROLES)){
    const email=uid+'@floodguard-lab.invalid';
    const password=randomBytes(28).toString('base64url');
    await auth.createUser({uid,email,password});
    if(claim)await auth.setCustomUserClaims(uid,{[claim]:true});
    users[role]={email,password};
  }
  // The operator fixture, OUTSIDE the child, exclusively provisions the
  // synthetic service UID and grants its scoped custom claim. The worker
  // must not have the Admin Auth SDK or any user/role-creation capability.
  const serviceEmail='service-confirm-stage@floodguard-lab.invalid';
  const servicePassword=randomBytes(28).toString('base64url');
  serviceTestPassword=servicePassword;
  await auth.createUser({uid:'service-confirm-stage',
    email:serviceEmail,password:servicePassword});
  await auth.setCustomUserClaims('service-confirm-stage',
    {fg_server_confirm_v1:true,fg_service_generation:1});
  // Only a one-time anonymous fd4 pipe delivers the synthetic password;
  // the regular confirmation IPC, process arguments and env remain secretless.
  const entry=fileURLToPath(new URL(
    '../experiments/r3-isolated-service-confirmer-worker.mjs',import.meta.url));
  child=fork(entry,[],{
    cwd:process.cwd(),
    execArgv:[],
    stdio:['ignore','pipe','pipe','ipc','pipe'],
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
  // On-disk credential files are deliberately avoided: the pipe is consumed
  // exactly once and closed. The trusted test harness necessarily knows the
  // password; this is NOT OS-enforced secrecy from that harness.
  child.stdio[4].end(JSON.stringify({email:serviceEmail,
    password:servicePassword}));
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
  assert.equal(JSON.stringify(child.spawnargs).includes(servicePassword),false);
  assert.equal(Object.values(child.spawnargs).some(x=>x.includes('serviceAccount')),false);
  const serviceAccount=await auth.getUser('service-confirm-stage');
  assert.equal(serviceAccount.customClaims.fg_server_confirm_v1,true);
  assert.equal(serviceAccount.customClaims.fg_service_generation,1);
  assert.equal(child.stdio[4].writableEnded,true);
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
    serviceWorkerAuthorization:{
      'service-confirm-stage':{enabled:true,generation:1}
    },
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
  assert.match(source,/createReadStream\(null,\{fd:4,autoClose:true\}\)/);
  assert.doesNotMatch(source,/from 'firebase-admin\/(?:auth|app|database)'/);
  assert.doesNotMatch(source,/\bauth\.createUser\s*\(|\bsetCustomUserClaims\s*\(/);
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

test('worker cannot bootstrap from missing or malformed operator-provisioned credentials',async()=>{
  const entry=fileURLToPath(new URL(
    '../experiments/r3-isolated-service-confirmer-worker.mjs',import.meta.url));
  const badWorker=fork(entry,[],{
    cwd:process.cwd(),execArgv:[],
    stdio:['ignore','pipe','pipe','ipc','pipe'],
    env:{
      PATH:process.env.PATH,HOME:process.env.HOME,
      FG_R3_ISOLATED_WORKER_TEST:'1',
      FG_VERSIONED_CONFIRMATION_TEST:'1',
      GCLOUD_PROJECT:PROJECT,
      FIREBASE_AUTH_EMULATOR_HOST:'127.0.0.1:9099',
      FIREBASE_DATABASE_EMULATOR_HOST:'127.0.0.1:9000'
    }
  });
  badWorker.stdout.on('data',()=>{});
  badWorker.stderr.on('data',()=>{});
  try{
    const answer=new Promise((resolve,reject)=>{
      const timeout=setTimeout(()=>reject(Error('Missing bootstrap denial')),7000);
      badWorker.once('message',x=>{clearTimeout(timeout);resolve(x);});
    });
    badWorker.stdio[4].end('{}'); // does not contain a valid provisioned identity
    badWorker.send({id:1,type:'init',
      deviceSpki:SPKI(DEVICE.publicKey),
      receiptSpki:SPKI(RECEIPT.publicKey)});
    const denied=await answer;
    assert.equal(denied.ok,false);
    assert.equal(denied.reason,'bootstrap-refused');
    assert.equal(denied.id,1);
    assert.equal(JSON.stringify(denied).includes('idToken'),false);
  }finally{
    if(badWorker.connected)badWorker.disconnect();
    badWorker.kill('SIGTERM');
  }
});
test('service credential cannot be re-requested by confirm IPC or used as provisioning API',async()=>{
  for(const request of [
    {type:'init',deviceSpki:SPKI(DEVICE.publicKey),
      receiptSpki:SPKI(RECEIPT.publicKey)},
    {type:'createUser',uid:'attacker',claim:'fg_server_confirm_v1'},
    {type:'setCustomUserClaims',uid:'attacker',admin:true},
    {type:'exportToken'},
    {type:'confirm',evidence:{
      serviceEmail:'service-confirm-stage@floodguard-lab.invalid',
      password:'fake-password'
    }}
  ]){
    const result=await ipc(request);
    assert.equal(result.ok,false,JSON.stringify(result));
    assert.equal(JSON.stringify(result).includes('idToken'),false);
  }
});

async function issuedServiceToken(){
  const r=await call(
    AUTH+'/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-only',
    'POST',{email:'service-confirm-stage@floodguard-lab.invalid',
      password:serviceTestPassword,returnSecureToken:true});
  assert.equal(r.status,200);
  const jwt=r.data.idToken;
  const c=JSON.parse(Buffer.from(jwt.split('.')[1],'base64url').toString());
  assert.equal(c.user_id||c.sub,'service-confirm-stage');
  assert.equal(c.aud,PROJECT);
  assert.equal(c.fg_server_confirm_v1,true);
  assert.ok(Number.isSafeInteger(c.fg_service_generation));
  return {jwt,generation:c.fg_service_generation};
}
async function directServiceRequest(token,path,method='GET',body){
  const u=dbUrl(path,null);
  u.searchParams.set('auth',token);
  return call(u,method,body);
}
function forgedRecord(){
  return {
    version:'floodguard-confirmed-record-v1',
    epoch:1,sequence:2,digest:'c'.repeat(64),
    acceptedAtMs:NOW-100,observedAtMs:NOW-400,frame:FRAME
  };
}
test('active exact-generation service credential still bypasses Ed25519: OPEN security defect',async()=>{
  await granted(db(STAGE,'device','PUT',FRAME));
  const {jwt,generation}=await issuedServiceToken();
  assert.equal(generation,1);
  const forged=forgedRecord();
  assert.deepEqual(await granted(directServiceRequest(jwt,RECORD,'PUT',forged)),forged);
  assert.deepEqual(await granted(db(RECORD,owner)),forged);
  const fromWorker=await ipc({type:'confirm',evidence:signedEvidence()});
  assert.equal(fromWorker.ok,false);
  assert.equal(fromWorker.productionGo,undefined);
});
test('operator disabling service fence denies already-issued token and isolated worker',async()=>{
  await granted(db(STAGE,'device','PUT',FRAME));
  const {jwt}=await issuedServiceToken();
  await seed(ROOT+'/serviceWorkerAuthorization/service-confirm-stage/enabled',false);
  await denied(directServiceRequest(jwt,RECORD,'PUT',forgedRecord()));
  await denied(directServiceRequest(jwt,STAGE));
  const reply=await ipc({type:'confirm',evidence:signedEvidence()});
  assert.equal(reply.ok,false,JSON.stringify(reply));
  assert.equal(await granted(db(RECORD,owner)),null);
  await denied(db(ROOT+'/serviceWorkerAuthorization/service-confirm-stage','device'));
  await denied(db(ROOT+'/serviceWorkerAuthorization/service-confirm-stage','ordinary'));
  await denied(db(ROOT+'/serviceWorkerAuthorization/service-confirm-stage','device','PUT',{
    enabled:true,generation:1
  }));
});
test('raising generation denies old worker token even while service enabled; no auto-refresh',async()=>{
  await granted(db(STAGE,'device','PUT',FRAME));
  const stale=await issuedServiceToken();
  assert.equal(stale.generation,1);
  await seed(ROOT+'/serviceWorkerAuthorization/service-confirm-stage/generation',2);
  await denied(directServiceRequest(stale.jwt,RECORD,'PUT',forgedRecord()));
  const oldWorker=await ipc({type:'confirm',evidence:signedEvidence()});
  assert.equal(oldWorker.ok,false);
  assert.equal(await granted(db(RECORD,owner)),null);
  // The operator can mint a new generation credential in the AUTH EMULATOR.
  // Old worker is NOT given this new token. A compromised freshly rotated
  // token still bypasses Ed25519: generation fencing is not cryptographic proof.
  try {
    await adminAuth.setCustomUserClaims('service-confirm-stage',{
      fg_server_confirm_v1:true,fg_service_generation:2
    });
    const fresh=await issuedServiceToken();
    assert.equal(fresh.generation,2);
    assert.deepEqual(await granted(directServiceRequest(
      fresh.jwt,RECORD,'PUT',forgedRecord())),forgedRecord());
    assert.equal((await ipc({type:'confirm',evidence:signedEvidence()})).ok,false);
  }finally{
    await adminAuth.setCustomUserClaims('service-confirm-stage',{
      fg_server_confirm_v1:true,fg_service_generation:1
    });
  }
});
test('candidate changes only five service expressions and adds owner-only fence',()=>{
  const previous=JSON.parse(readFileSync(
    'docs/firebase/r3-service-confirmation-lab.rules.json','utf8'));
  const candidate=JSON.parse(readFileSync(
    'docs/firebase/r3-service-session-fence-lab.rules.json','utf8'));
  const old="auth != null && auth.uid === 'service-confirm-stage' && auth.token.fg_server_confirm_v1 === true";
  const revised=old+" && auth.token.fg_service_generation === root.child('floodguard/serviceWorkerAuthorization/service-confirm-stage/generation').val() && root.child('floodguard/serviceWorkerAuthorization/service-confirm-stage/enabled').val() === true";
  let changed=0;
  function apply(node){
    for(const [k,v] of Object.entries(node)){
      if(typeof v==='string'&&['.read','.write'].includes(k)&&v.includes(old)){
        node[k]=v.replaceAll(old,revised);changed++;
      }else if(v&&typeof v==='object')apply(v);
    }
  }
  apply(previous.rules.floodguard);
  previous.rules.floodguard.serviceWorkerAuthorization={'.read':false,'.write':false};
  assert.equal(changed,5);
  assert.deepEqual(candidate,previous);
  assert.equal(candidate.rules['.write'],false);
  assert.equal(candidate.rules.floodguard.publicationLab.water['.write'],false);
});

// PR #86: deterministic local RTDB Rules evaluation races, NOT a deployed
// transaction/authorization service. The pause occurs AFTER the independent
// signed evidence and operator/staging checks but BEFORE the final RTDB PUT.
// The database must refuse stale permissions at the actual write boundary.
async function runPrecommitRace({change,expectSuccess=false,
  expectedStored=null}){
  const entry=fileURLToPath(new URL(
    '../experiments/r3-isolated-service-confirmer-worker.mjs',import.meta.url));
  const race=fork(entry,[],{
    cwd:process.cwd(),execArgv:[],
    stdio:['ignore','pipe','pipe','ipc','pipe'],
    env:{
      PATH:process.env.PATH,HOME:process.env.HOME,
      FG_R3_ISOLATED_WORKER_TEST:'1',
      FG_R3_PRECOMMIT_RACE_TEST:'1',
      FG_VERSIONED_CONFIRMATION_TEST:'1',
      GCLOUD_PROJECT:PROJECT,
      FIREBASE_AUTH_EMULATOR_HOST:'127.0.0.1:9099',
      FIREBASE_DATABASE_EMULATOR_HOST:'127.0.0.1:9000'
    }
  });
  race.stdout.on('data',()=>{});
  race.stderr.on('data',()=>{});
  function receive(predicate){
    return new Promise((resolve,reject)=>{
      const timeout=setTimeout(()=>{
        race.off('message',listener);
        reject(Error('Synthetic precommit worker failed closed or timed out'));
      },9000);
      function listener(message){
        if(predicate(message)){
          clearTimeout(timeout);
          race.off('message',listener);
          resolve(message);
        }
      }
      race.on('message',listener);
    });
  }
  try{
    // The separate trusted test harness already created this identity.
    // Only the one-use credential bootstrap pipe has the test password.
    race.stdio[4].end(JSON.stringify({
      email:'service-confirm-stage@floodguard-lab.invalid',
      password:serviceTestPassword
    }));
    const ready=receive(m=>m?.id===701);
    race.send({id:701,type:'init',
      deviceSpki:SPKI(DEVICE.publicKey),
      receiptSpki:SPKI(RECEIPT.publicKey)});
    const init=await ready;
    assert.equal(init.ok,true,JSON.stringify(init));
    assert.equal(init.productionGo,false);
    await granted(db(STAGE,'device','PUT',FRAME));
    const paused=receive(m=>m?.type==='test-precommit-paused'&&m?.id===702);
    race.send({id:702,type:'confirm',evidence:signedEvidence()});
    const pause=await paused;
    assert.match(pause.nonce,/^[0-9a-f]{32}$/);
    assert.equal(pause.productionGo,false);
    assert.equal(JSON.stringify(pause).includes('idToken'),false);
    // This mutation happens only AFTER the verifier's independent reads.
    // Real RTDB Emulator Rules must re-evaluate at the eventual PUT.
    await change();
    const done=receive(m=>m?.id===702&&m?.type!=='test-precommit-paused');
    race.send({id:702,type:'test-resume-precommit',nonce:pause.nonce});
    const final=await done;
    assert.equal(final.ok,expectSuccess,JSON.stringify(final));
    assert.equal(final.canPublish,expectSuccess?false:undefined);
    assert.equal(JSON.stringify(final).includes('idToken'),false);
    assert.equal(JSON.stringify(final).includes('Bearer'),false);
    const stored=await granted(db(RECORD,owner));
    if(expectedStored===null)assert.equal(stored,null);
    else if(expectedStored==='SIGNED'){
      const digest=signedEvidence().receipt.digest;
      assert.equal(stored.digest,digest);
      assert.equal(stored.frame.risk,'WARNING');
    }else assert.deepEqual(stored,expectedStored);
    return final;
  }finally{
    if(race.connected)race.disconnect();
    race.kill('SIGTERM');
  }
}
test('precommit control: unchanged Rules accept signed record after test-only pause',async()=>{
  const done=await runPrecommitRace({
    change:async()=>{},expectSuccess:true,expectedStored:'SIGNED'
  });
  assert.equal(done.kind,'IMMUTABLE_EMULATOR_RECORD_ONLY');
  assert.equal(done.sequence,2);
  assert.equal(done.canOperateGate,false);
});
test('revoking service after signed verification but before commit denies final write',async()=>{
  await runPrecommitRace({
    change:()=>seed(ROOT+'/serviceWorkerAuthorization/service-confirm-stage/enabled',false)
  });
});
test('rotating service generation after verification but before commit denies old token',async()=>{
  await runPrecommitRace({
    change:()=>seed(ROOT+'/serviceWorkerAuthorization/service-confirm-stage/generation',2)
  });
});
test('revoking physical device authorization after verification denies stale commit',async()=>{
  await runPrecommitRace({
    change:()=>seed(ROOT+'/deviceAuthorization/'+ID+'/enabled',false)
  });
});
test('advancing staged frame after verification denies stale sequence-2 commit',async()=>{
  await runPrecommitRace({
    change:()=>seed(STAGE,{...FRAME,sequence:3})
  });
});
test('concurrent immutable record insert cannot be silently overwritten or reconciled',async()=>{
  const other={
    version:'floodguard-confirmed-record-v1',epoch:1,sequence:2,
    digest:'d'.repeat(64),acceptedAtMs:NOW-100,
    observedAtMs:NOW-400,frame:FRAME
  };
  const done=await runPrecommitRace({
    change:()=>seed(RECORD,other),expectedStored:other
  });
  assert.equal(done.reason,'confirmed-record-conflict');
});
