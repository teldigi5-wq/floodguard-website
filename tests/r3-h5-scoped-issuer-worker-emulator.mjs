// FloodGuard H5: local Auth + RTDB Emulator synthetic security negatives.
// No real Firebase credentials, network target, hardware commands, or alerts.
import {test,before,after,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {fork} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {randomBytes,generateKeyPairSync,createHash,sign} from 'node:crypto';
import {initializeApp,deleteApp} from 'firebase-admin/app';
import {getAuth} from 'firebase-admin/auth';
import {canonicalOfflineEnvelope}
  from '../experiments/stage7-durable-ingress.mjs';
import {canonicalSyntheticPublicationAttestation}
  from '../experiments/synthetic-publication-attestation.mjs';

const PROJECT='demo-r3-h5-issuer';
const AUTH='http://127.0.0.1:9099';
const DB='http://127.0.0.1:9000';
const NS=PROJECT+'-default-rtdb';
const ROOT='/floodguard',ID='device-stage-a';
const ISSUER='admission-issuer-stage';
const TICKET=ROOT+'/publicationAdmission/'+ID;
const WATER=ROOT+'/publicationLab/water';
const OWNER='TEST_EMULATOR_OWNER_ONLY';
const H='a'.repeat(64);
const DEVICE=generateKeyPairSync('ed25519');
const RECEIPT=generateKeyPairSync('ed25519');
const ATTESTOR=generateKeyPairSync('ed25519');
const SPKI=k=>k.export({format:'der',type:'spki'}).toString('base64');
const SIGN=(text,key)=>sign(null,Buffer.from(text),key).toString('base64url');
if(process.env.GCLOUD_PROJECT!==PROJECT||
   process.env.FIREBASE_AUTH_EMULATOR_HOST!=='127.0.0.1:9099'||
   process.env.FIREBASE_DATABASE_EMULATOR_HOST!=='127.0.0.1:9000')
  throw Error('Refusing H5 test outside pinned local demo emulators');

let adminApp,child,serial=0,secretPassword,issuerJwt,publisherJwt;
const pending=new Map();
function url(path,role){
  if(typeof path!=='string'||!(path===ROOT||path.startsWith(ROOT+'/'))||
     path.includes('..')||path.includes('?')||path.includes('#'))
    throw Error('Invalid synthetic path');
  const u=new URL(DB+path+'.json');
  u.searchParams.set('ns',NS);
  if(role===OWNER)u.searchParams.set('access_token','owner');
  if(role==='issuer')u.searchParams.set('auth',issuerJwt);
  if(role==='publisher')u.searchParams.set('auth',publisherJwt);
  if(role&&![OWNER,'issuer','publisher'].includes(role))
    throw Error('Unrecognized synthetic caller');
  return u;
}
async function call(u,method='GET',value){
  const r=await fetch(u,{method,redirect:'error',
    headers:{'content-type':'application/json'},signal:AbortSignal.timeout(7000),
    ...(value===undefined?{}:{body:JSON.stringify(value)})
  });
  const raw=await r.text();
  let data;try{data=JSON.parse(raw);}catch{data=null;}
  return {status:r.status,data};
}
const db=(path,role,method='GET',v)=>call(url(path,role),method,v);
async function seed(path,data){
  const r=await db(path,OWNER,'PUT',data);
  assert.equal(r.status,200,'Only emulator fixture may seed');
}
const denied=async(p)=>{
  const r=await p;
  assert.ok([401,403].includes(r.status),'Expected deny, got '+r.status);
};
async function signIn(email,password){
  const r=await call(new URL(
    AUTH+'/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-only'),
    'POST',{email,password,returnSecureToken:true});
  assert.equal(r.status,200);
  assert.equal(typeof r.data?.idToken,'string');
  return r.data.idToken;
}
function evidence(){
  const now=Date.now();
  const envelope={
    version:'floodguard-offline-envelope-v1',deviceId:ID,epoch:1,
    observedAtMs:now-1000,
    frame:{sequence:2,distanceCm:16.5,levelCm:8.5,risk:'WARNING'}
  };
  const body=canonicalOfflineEnvelope(envelope);
  const digest=createHash('sha256').update(body).digest('hex');
  const receipt={version:'floodguard-offline-receipt-v1',
    deviceId:ID,epoch:1,sequence:2,digest,acceptedAtMs:now-250};
  const attestation={
    version:'floodguard-synthetic-persisted-attestation-v1',
    deviceId:ID,epoch:1,sequence:2,digest,acceptedAtMs:now-250,
    confirmedAtMs:now-100,scope:'prototype-ingest-v1',
    deviceEnabled:true,databaseState:'DATABASE_CONFIRMED'
  };
  return {
    envelope,deviceSignature:SIGN(body,DEVICE.privateKey),
    receipt,receiptSignature:SIGN(JSON.stringify(receipt),RECEIPT.privateKey),
    attestation,attestationSignature:SIGN(
      canonicalSyntheticPublicationAttestation(attestation),ATTESTOR.privateKey),
    databaseRecord:{deviceId:ID,epoch:1,sequence:2,digest,
      acceptedAtMs:now-250,status:'DATABASE_CONFIRMED'}
  };
}
function project(v){
  return {
    current:{distanceCm:v.envelope.frame.distanceCm,
      levelCm:v.envelope.frame.levelCm,status:v.envelope.frame.risk,
      observedAtMs:v.envelope.observedAtMs,overallRisk:'UNKNOWN'},
    checkpoint:{initialized:true,deviceId:ID,epoch:1,
      sequence:v.envelope.frame.sequence,digest:v.receipt.digest,
      observedAtMs:v.envelope.observedAtMs}
  };
}
function ipc(msg,limitMs=8000){
  const id=++serial;
  if(!child?.connected)return Promise.resolve({ok:false,reason:'worker-disconnected'});
  return new Promise((resolve,reject)=>{
    const timeout=setTimeout(()=>{
      pending.delete(id);reject(Error('IPC timeout is not a success'));
    },limitMs);
    pending.set(id,{resolve,reject,timeout});
    child.send({...msg,id},err=>{
      if(err){clearTimeout(timeout);pending.delete(id);
        reject(Error('Synthetic issuer IPC unavailable'));}
    });
  });
}
before(async()=>{
  adminApp=initializeApp({projectId:PROJECT},'h5-owner-auth-only');
  const auth=getAuth(adminApp);
  secretPassword=randomBytes(28).toString('base64url');
  const pubPass=randomBytes(28).toString('base64url');
  await auth.createUser({uid:ISSUER,email:ISSUER+'@floodguard-lab.invalid',
    password:secretPassword});
  await auth.setCustomUserClaims(ISSUER,{
    fg_issue_admission_v1:true,fg_issuer_generation:1});
  await auth.createUser({uid:'publisher-water-stage',
    email:'publisher-water-stage@floodguard-lab.invalid',password:pubPass});
  await auth.setCustomUserClaims('publisher-water-stage',{fg_publish_water_v1:true});
  // This test harness deliberately can obtain a second issuer token to
  // demonstrate direct bearer-theft bypass. The worker cannot mint roles.
  issuerJwt=await signIn(ISSUER+'@floodguard-lab.invalid',secretPassword);
  publisherJwt=await signIn('publisher-water-stage@floodguard-lab.invalid',pubPass);
  const path=fileURLToPath(new URL(
    '../experiments/r3-h5-scoped-issuer-worker.mjs',import.meta.url));
  child=fork(path,[],{
    stdio:['ignore','pipe','pipe','ipc','pipe'],execArgv:[],
    cwd:process.cwd(),
    env:{
      HOME:process.env.HOME,PATH:process.env.PATH,
      FG_R3_H5_ISSUER_TEST:'1',
      GCLOUD_PROJECT:PROJECT,
      FIREBASE_AUTH_EMULATOR_HOST:'127.0.0.1:9099',
      FIREBASE_DATABASE_EMULATOR_HOST:'127.0.0.1:9000'
    }
  });
  child.stdout.on('data',()=>{});
  child.stderr.on('data',()=>{});
  child.on('message',msg=>{
    const task=pending.get(msg?.id);
    if(!task)return;
    clearTimeout(task.timeout);pending.delete(msg.id);
    task.resolve(msg);
  });
  child.on('exit',()=>{
    for(const task of pending.values()){
      clearTimeout(task.timeout);task.resolve({ok:false,reason:'worker-exited'});
    }
    pending.clear();
  });
  child.stdio[4].end(JSON.stringify({
    email:ISSUER+'@floodguard-lab.invalid',password:secretPassword,
    deviceSpki:SPKI(DEVICE.publicKey),
    receiptSpki:SPKI(RECEIPT.publicKey),
    attestorSpki:SPKI(ATTESTOR.publicKey)
  }));
  const ready=await ipc({type:'init'},16000);
  assert.equal(ready.ok,true,JSON.stringify(ready));
  assert.equal(ready.scope,'LAB_TICKET_ONLY');
  assert.equal(ready.productionGo,false);
  assert.equal(ready.canPublish,false);
  assert.equal(JSON.stringify(ready).includes('idToken'),false);
  assert.equal(JSON.stringify(child.spawnargs).includes(secretPassword),false);
});
after(async()=>{
  if(child?.connected)child.disconnect();
  if(child&&!child.killed)child.kill('SIGTERM');
  if(adminApp)await deleteApp(adminApp);
});
beforeEach(async()=>{
  const now=Date.now();
  await seed(ROOT,{
    admissionIssuerAuthorization:{
      [ISSUER]:{enabled:true,generation:1,revision:1,
        scope:'lab-signed-admission-v1'}
    },
    publisherLabAuthorization:{
      'publisher-water-stage':{enabled:true,deviceId:ID,
        epoch:1,scope:'publication-lab-water-v1'}
    },
    deviceAuthorization:{[ID]:{enabled:true,scope:'prototype-ingest-v1'}},
    incidentQuarantine:{[ID]:{blocked:false,epoch:1}},
    publicationLab:{water:{
      current:{distanceCm:20,levelCm:5,status:'SAFE',
        observedAtMs:now-4500,overallRisk:'UNKNOWN'},
      checkpoint:{initialized:true,deviceId:ID,epoch:1,
        sequence:1,digest:H,observedAtMs:now-4500}
    }},
    live:{gate:{status:'CLOSED',angle:0},
      esp8266:{ip:'192.0.2.2',wifi:'SYNTHETIC_TEST_ONLY'}}
  });
});
test('separately provisioned worker authenticates three signatures, writes only its ticket, publisher commits',async()=>{
  const e=evidence();
  const out=await ipc({type:'issue',evidence:e});
  assert.equal(out.ok,true,JSON.stringify(out));
  assert.equal(out.reason,'SYNTHETIC_TICKET_STORED_NOT_PUBLISHED');
  assert.equal(out.releaseDecision,'NO_GO');
  assert.equal(out.productionGo,false);
  assert.equal(out.canPublish,false);
  assert.equal(out.canOperateGate,false);
  assert.equal(out.digest,e.receipt.digest);
  assert.equal(JSON.stringify(out).includes(issuerJwt),false);
  const ticket=(await db(TICKET,OWNER)).data;
  assert.equal(ticket.digest,e.receipt.digest);
  assert.equal(ticket.status,'WARNING');
  assert.equal((await db(WATER,'publisher','PUT',project(e))).status,200);
  assert.deepEqual((await db(WATER+'/current',null)).data,project(e).current);
  await denied(db(WATER,'publisher','PUT',project(e)));
});
test('worker rejects forged device signature without ticket',async()=>{
  const e=evidence();
  const out=await ipc({type:'issue',evidence:{...e,deviceSignature:'A'.repeat(86)}});
  assert.equal(out.ok,false);
  assert.equal((await db(TICKET,OWNER)).data,null);
});
test('worker rejects forged receipt and attestation without ticket',async()=>{
  for(const k of ['receiptSignature','attestationSignature']){
    const e=evidence();
    const out=await ipc({type:'issue',evidence:{...e,[k]:'A'.repeat(86)}});
    assert.equal(out.ok,false,k);
    assert.equal((await db(TICKET,OWNER)).data,null);
  }
});
test('revoked or rotated issuer generation denies old scoped worker token',async()=>{
  await seed(ROOT+'/admissionIssuerAuthorization/'+ISSUER+'/generation',2);
  const out=await ipc({type:'issue',evidence:evidence()});
  assert.equal(out.ok,false);
  assert.equal((await db(TICKET,OWNER)).data,null);
});
test('incident quarantine or device revocation prevents issuance and ticket storage',async()=>{
  await seed(ROOT+'/incidentQuarantine/'+ID+'/blocked',true);
  assert.equal((await ipc({type:'issue',evidence:evidence()})).ok,false);
  await seed(ROOT+'/incidentQuarantine/'+ID+'/blocked',false);
  await seed(ROOT+'/deviceAuthorization/'+ID+'/enabled',false);
  assert.equal((await ipc({type:'issue',evidence:evidence()})).ok,false);
  assert.equal((await db(TICKET,OWNER)).data,null);
});
test('issuer identity can read only exact necessary authority and ticket leaves',async()=>{
  for(const p of [
    ROOT+'/admissionIssuerAuthorization/'+ISSUER,
    ROOT+'/publisherLabAuthorization/publisher-water-stage',
    ROOT+'/incidentQuarantine/'+ID,
    ROOT+'/deviceAuthorization/'+ID,
    ROOT+'/publicationLab/water/checkpoint'
  ])assert.equal((await db(p,'issuer')).status,200,p);
  for(const p of [
    ROOT,ROOT+'/deviceAuthorization',ROOT+'/deviceAuthorization/device-stage-b',
    ROOT+'/live',ROOT+'/live/esp8266/ip',ROOT+'/publicationLab',
    ROOT+'/confirmedLab',ROOT+'/serviceWorkerAuthorization/service-confirm-stage'
  ])await denied(db(p,'issuer'));
});
test('issuer credential cannot write public data, gate, authorization, parent or others',async()=>{
  for(const p of [
    WATER,ROOT+'/publicationLab/water/current',
    ROOT+'/live/gate/angle',
    ROOT+'/admissionIssuerAuthorization/'+ISSUER,
    ROOT+'/publisherLabAuthorization/publisher-water-stage',
    ROOT+'/incidentQuarantine/'+ID+'/blocked',
    ROOT+'/deviceAuthorization/'+ID,
    ROOT+'/publicationAdmission',ROOT+'/publicationAdmission/device-stage-b'
  ])await denied(db(p,'issuer','PUT',{enabled:true}));
  assert.equal((await db(ROOT+'/live/gate/angle',OWNER)).data,0);
});
test('one-time ticket cannot be overwritten or removed by issuer role',async()=>{
  const e=evidence();
  assert.equal((await ipc({type:'issue',evidence:e})).ok,true);
  assert.equal((await ipc({type:'issue',evidence:e})).ok,false);
  await denied(db(TICKET,'issuer','DELETE'));
  await denied(db(TICKET,'issuer','PUT',{enabled:true}));
  assert.equal((await db(TICKET,OWNER)).data.digest,e.receipt.digest);
});
test('EXPECTED OPEN DEFECT: stolen active issuer token can bypass H4 verification and write forged but schema-valid ticket',async()=>{
  const e=evidence();
  const forged={
    enabled:true,deviceId:ID,epoch:1,sequence:2,
    digest:'f'.repeat(64),observedAtMs:e.envelope.observedAtMs,
    distanceCm:20,levelCm:5,status:'SAFE',
    issuedAtMs:Date.now(),expiresAtMs:Date.now()+3500
  };
  // The rules cannot execute Ed25519 checks; the stolen bearer creates a
  // syntactically valid but false SAFE ticket. This is why production is NO-GO.
  const response=await db(TICKET,'issuer','PUT',forged);
  assert.equal(response.status,200,'Known issuer-token theft must stay visible');
  assert.equal((await db(TICKET,OWNER)).data.digest,forged.digest);
  const publication={
    current:{distanceCm:20,levelCm:5,status:'SAFE',
      observedAtMs:forged.observedAtMs,overallRisk:'UNKNOWN'},
    checkpoint:{initialized:true,deviceId:ID,epoch:1,sequence:2,
      digest:forged.digest,observedAtMs:forged.observedAtMs}
  };
  assert.equal((await db(WATER,'publisher','PUT',publication)).status,200,
    'Known vulnerable downstream path must not be misreported as safe');
  // No physical SAFE inference or production deployment can follow this case.
});
