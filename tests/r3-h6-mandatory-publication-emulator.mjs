// FloodGuard H6: demo Auth+RTDB Emulators only, no real credentials or device.
import {test,before,after,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {fork} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createHash,generateKeyPairSync,randomBytes,sign} from 'node:crypto';
import {initializeApp,deleteApp} from 'firebase-admin/app';
import {getAuth} from 'firebase-admin/auth';
import {canonicalOfflineEnvelope}
  from '../experiments/stage7-durable-ingress.mjs';
import {canonicalSyntheticPublicationAttestation}
  from '../experiments/synthetic-publication-attestation.mjs';

const PROJECT='demo-r3-h6-publication';
const AUTH='http://127.0.0.1:9099';
const DB='http://127.0.0.1:9000';
const NS=PROJECT+'-default-rtdb';
const ROOT='/floodguard',ID='device-stage-a';
const WATER=ROOT+'/publicationLab/water';
const TICKET=ROOT+'/publicationAdmission/'+ID;
const OWNER='DISPOSABLE_FIXTURE_OWNER';
const A='a'.repeat(64);
const DEVICE=generateKeyPairSync('ed25519');
const RECEIPT=generateKeyPairSync('ed25519');
const ATTESTOR=generateKeyPairSync('ed25519');
const SPKI=x=>x.export({format:'der',type:'spki'}).toString('base64');
const SIG=(s,key)=>sign(null,Buffer.from(s),key).toString('base64url');
if(process.env.GCLOUD_PROJECT!==PROJECT||
   process.env.FIREBASE_AUTH_EMULATOR_HOST!=='127.0.0.1:9099'||
   process.env.FIREBASE_DATABASE_EMULATOR_HOST!=='127.0.0.1:9000')
  throw Error('Refusing nonlocal or production Firebase');

let admin,worker,serial=0,tokens={};
const pending=new Map();
function dbUrl(path,role){
  if(!(path===ROOT||path.startsWith(ROOT+'/'))||
     path.includes('..')||path.includes('?')||path.includes('#'))
    throw Error('Invalid RTDB test path');
  const url=new URL(DB+path+'.json');
  url.searchParams.set('ns',NS);
  if(role===OWNER)url.searchParams.set('access_token','owner');
  else if(role){
    if(!Object.hasOwn(tokens,role))throw Error('Unknown test caller');
    url.searchParams.set('auth',tokens[role]);
  }
  return url;
}
async function req(path,role,method='GET',payload){
  const res=await fetch(dbUrl(path,role),{
    method,redirect:'error',signal:AbortSignal.timeout(8000),
    ...(payload===undefined?{}:{
      headers:{'content-type':'application/json'},body:JSON.stringify(payload)})
  });
  const value=await res.json();
  return {status:res.status,value};
}
async function seed(path,value){
  const r=await req(path,OWNER,'PUT',value);
  assert.equal(r.status,200,'Only disposable owner fixture may seed');
}
async function denied(promise){
  const r=await promise;
  assert.ok(r.status===401||r.status===403,'Unexpected RTDB status '+r.status);
}
function evidence(){
  const now=Date.now();
  const envelope={
    version:'floodguard-offline-envelope-v1',deviceId:ID,epoch:1,
    observedAtMs:now-1000,
    frame:{sequence:2,distanceCm:16.5,levelCm:8.5,risk:'WARNING'}
  };
  const canonical=canonicalOfflineEnvelope(envelope);
  const digest=createHash('sha256').update(canonical).digest('hex');
  const receipt={version:'floodguard-offline-receipt-v1',
    deviceId:ID,epoch:1,sequence:2,digest,acceptedAtMs:now-250};
  const attestation={
    version:'floodguard-synthetic-persisted-attestation-v1',
    deviceId:ID,epoch:1,sequence:2,digest,
    acceptedAtMs:now-250,confirmedAtMs:now-100,
    scope:'prototype-ingest-v1',deviceEnabled:true,
    databaseState:'DATABASE_CONFIRMED'
  };
  return {
    envelope,deviceSignature:SIG(canonical,DEVICE.privateKey),
    receipt,receiptSignature:SIG(JSON.stringify(receipt),RECEIPT.privateKey),
    attestation,attestationSignature:SIG(
      canonicalSyntheticPublicationAttestation(attestation),ATTESTOR.privateKey),
    databaseRecord:{deviceId:ID,epoch:1,sequence:2,digest,
      acceptedAtMs:now-250,status:'DATABASE_CONFIRMED'}
  };
}
function project(e){
  return {
    current:{distanceCm:e.envelope.frame.distanceCm,
      levelCm:e.envelope.frame.levelCm,status:e.envelope.frame.risk,
      observedAtMs:e.envelope.observedAtMs,overallRisk:'UNKNOWN'},
    checkpoint:{initialized:true,deviceId:ID,epoch:1,
      sequence:e.envelope.frame.sequence,digest:e.receipt.digest,
      observedAtMs:e.envelope.observedAtMs}
  };
}
function ipc(message,timeoutMs=9000){
  if(!worker?.connected)return Promise.resolve({ok:false,reason:'not-connected'});
  const id=++serial;
  return new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{
      pending.delete(id);reject(Error('H6 worker IPC timed out; no approval'));
    },timeoutMs);
    pending.set(id,{resolve,reject,timer});
    worker.send({...message,id},err=>{
      if(err){clearTimeout(timer);pending.delete(id);
        reject(Error('H6 worker IPC unavailable'));}
    });
  });
}
before(async()=>{
  admin=initializeApp({projectId:PROJECT},'h6-synthetic-operator-only');
  const auth=getAuth(admin);
  for(const role of ['publisher','issuer','ordinary']){
    const uid=role==='publisher'?'publisher-water-stage':
      role==='issuer'?'admission-issuer-stage':'ordinary-stage';
    const password=randomBytes(28).toString('base64url');
    const email=uid+'@floodguard-lab.invalid';
    await auth.createUser({uid,email,password});
    if(role==='publisher')
      await auth.setCustomUserClaims(uid,{fg_publish_water_v1:true});
    if(role==='issuer')
      await auth.setCustomUserClaims(uid,{
        fg_issue_admission_v1:true,fg_issuer_generation:1});
    const res=await fetch(AUTH+
      '/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-only',{
        method:'POST',headers:{'content-type':'application/json'},
        body:JSON.stringify({email,password,returnSecureToken:true}),
        redirect:'error',signal:AbortSignal.timeout(8000)});
    assert.equal(res.status,200);
    tokens[role]=(await res.json()).idToken;
    assert.equal(typeof tokens[role],'string');
  }
  worker=fork(fileURLToPath(new URL(
    '../experiments/r3-h6-mandatory-publication-worker.mjs',import.meta.url)),[],{
    cwd:process.cwd(),execArgv:[],stdio:['ignore','pipe','pipe','ipc','pipe'],
    env:{
      HOME:process.env.HOME,PATH:process.env.PATH,
      GCLOUD_PROJECT:PROJECT,
      FG_R3_H6_PUBLICATION_TEST:'1',
      FIREBASE_DATABASE_EMULATOR_HOST:'127.0.0.1:9000',
      FIREBASE_AUTH_EMULATOR_HOST:'127.0.0.1:9099'
    }
  });
  worker.stdout.on('data',()=>{});
  worker.stderr.on('data',()=>{});
  worker.on('message',msg=>{
    const task=pending.get(msg?.id);
    if(!task)return;
    clearTimeout(task.timer);pending.delete(msg.id);
    task.resolve(msg);
  });
  worker.on('exit',()=>{
    for(const task of pending.values()){
      clearTimeout(task.timer);task.resolve({ok:false,reason:'worker-exited'});
    }
    pending.clear();
  });
  worker.stdio[4].end(JSON.stringify({
    deviceSpki:SPKI(DEVICE.publicKey),
    receiptSpki:SPKI(RECEIPT.publicKey),
    attestorSpki:SPKI(ATTESTOR.publicKey)
  }));
  const result=await ipc({type:'init'},16000);
  assert.equal(result.ok,true,JSON.stringify(result));
  assert.equal(result.productionGo,false);
  assert.equal(result.scope,'MANDATORY_SIGNED_WATER_DEMO_ONLY');
});
after(async()=>{
  if(worker?.connected)worker.disconnect();
  if(worker&&!worker.killed)worker.kill('SIGTERM');
  if(admin)await deleteApp(admin);
});
beforeEach(async()=>{
  const now=Date.now();
  await seed(ROOT,{
    admissionIssuerAuthorization:{
      'admission-issuer-stage':{enabled:true,generation:1,revision:1,
        scope:'lab-signed-admission-v1'}
    },
    publisherLabAuthorization:{
      'publisher-water-stage':{enabled:true,deviceId:ID,epoch:1,
        scope:'publication-lab-water-v1'}
    },
    incidentQuarantine:{[ID]:{blocked:false,epoch:1}},
    deviceAuthorization:{[ID]:{enabled:true,scope:'prototype-ingest-v1'}},
    publicationLab:{water:{
      current:{distanceCm:20,levelCm:5,status:'SAFE',
        observedAtMs:now-4500,overallRisk:'UNKNOWN'},
      checkpoint:{initialized:true,deviceId:ID,epoch:1,
        sequence:1,digest:A,observedAtMs:now-4500}
    }},
    live:{gate:{status:'CLOSED',angle:0},
      esp8266:{ip:'192.0.2.44',wifi:'SYNTHETIC_TEST_ONLY'}}
  });
});
test('stolen or ordinary issuer/publisher Auth tokens cannot write admission or water',async()=>{
  const e=evidence();
  for(const role of ['issuer','publisher','ordinary']){
    await denied(req(TICKET,role,'PUT',{
      enabled:true,deviceId:ID,epoch:1,sequence:2,
      digest:'f'.repeat(64),observedAtMs:e.envelope.observedAtMs,
      distanceCm:20,levelCm:5,status:'SAFE',
      issuedAtMs:Date.now(),expiresAtMs:Date.now()+4000
    }));
    await denied(req(WATER,role,'PUT',project(e)));
    await denied(req(ROOT+'/live/gate/angle',role,'PUT',90));
  }
  await denied(req(WATER,null,'PUT',project(e)));
  assert.equal((await req(TICKET,OWNER)).value,null);
  assert.equal((await req(WATER+'/checkpoint',OWNER)).value.sequence,1);
});
test('mandatory worker verifies three signatures and commits once via conditional write',async()=>{
  const e=evidence();
  const result=await ipc({type:'commit',evidence:e});
  assert.equal(result.ok,true,JSON.stringify(result));
  assert.equal(result.reason,'SYNTHETIC_SIGNED_PUBLICATION_ONLY');
  assert.equal(result.releaseDecision,'NO_GO');
  assert.equal(result.canOperateGate,false);
  assert.equal(result.canSendAlert,false);
  assert.equal(result.productionGo,false);
  assert.equal(result.digest,e.receipt.digest);
  assert.deepEqual((await req(WATER,OWNER)).value,project(e));
  assert.equal((await req(TICKET,OWNER)).value,null);
  const replay=await ipc({type:'commit',evidence:e});
  assert.equal(replay.ok,false);
  assert.deepEqual((await req(WATER,OWNER)).value,project(e));
});
test('forged source, receipt, attestation and DB claims cannot trigger a privileged commit',async()=>{
  for(const patch of [
    {deviceSignature:'A'.repeat(86)},
    {receiptSignature:'A'.repeat(86)},
    {attestationSignature:'A'.repeat(86)},
    {attestation:undefined},
    {databaseRecord:{...evidence().databaseRecord,status:'PENDING'}},
  ]){
    const base=evidence();
    const altered=patch.databaseRecord?{...base,databaseRecord:{
      ...base.databaseRecord,status:'PENDING'}}:{...base,...patch};
    const result=await ipc({type:'commit',evidence:altered});
    assert.equal(result.ok,false,JSON.stringify(result));
    assert.equal((await req(WATER+'/checkpoint',OWNER)).value.sequence,1);
  }
});
test('incident quarantine, device, issuer and publisher revocation block worker publication',async()=>{
  for(const [path,value] of [
    [ROOT+'/incidentQuarantine/'+ID+'/blocked',true],
    [ROOT+'/deviceAuthorization/'+ID+'/enabled',false],
    [ROOT+'/admissionIssuerAuthorization/admission-issuer-stage/enabled',false],
    [ROOT+'/publisherLabAuthorization/publisher-water-stage/enabled',false]
  ]){
    // Reset the entire demo fixture between cases through trusted setup? 
    // Use the current value and restore via owner after each refusal.
    const original=(await req(path,OWNER)).value;
    await seed(path,value);
    const result=await ipc({type:'commit',evidence:evidence()});
    assert.equal(result.ok,false,path);
    assert.equal((await req(WATER+'/checkpoint',OWNER)).value.sequence,1);
    await seed(path,original);
  }
});
test('client direct partial update, DELETE and gate/parent writes remain refused',async()=>{
  for(const role of ['publisher','issuer']){
    await denied(req(WATER+'/current',role,'PATCH',{status:'SAFE'}));
    await denied(req(WATER,role,'DELETE'));
    await denied(req(ROOT+'/publicationLab',role,'PUT',{}));
    await denied(req(ROOT+'/live/gate',role,'PUT',{angle:90}));
    await denied(req(ROOT+'/live/esp8266/ip',role,'PUT','192.0.2.1'));
  }
});
test('malformed IPC commands and request-supplied authority cannot invoke a privileged write',async()=>{
  for(const message of [
    {type:'commit',evidence:{role:'owner'}},
    {type:'commit',evidence:{...evidence(),scope:'admin'}},
    {type:'publish',evidence:evidence()},
    {type:'commit',path:ROOT+'/live/gate',evidence:evidence()}
  ]){
    assert.equal((await ipc(message)).ok,false);
  }
  assert.equal((await req(WATER+'/checkpoint',OWNER)).value.sequence,1);
});
test('KNOWN LIMIT: compromised privileged Emulator owner can bypass mandatory worker',async()=>{
  const e=evidence();
  const altered={current:{
    distanceCm:20,levelCm:5,status:'SAFE',
    observedAtMs:e.envelope.observedAtMs,overallRisk:'UNKNOWN'},
    checkpoint:{initialized:true,deviceId:ID,epoch:1,sequence:2,
      digest:'f'.repeat(64),observedAtMs:e.envelope.observedAtMs}};
  const direct=await req(WATER,OWNER,'PUT',altered);
  assert.equal(direct.status,200,'Known privileged bypass must be explicit');
  assert.equal((await req(WATER+'/current',null)).value.status,'SAFE');
  const result=await ipc({type:'commit',evidence:e});
  assert.equal(result.ok,false,'Worker refuses pre-replayed checkpoint');
  assert.deepEqual((await req(WATER,OWNER)).value,altered);
  // This is NOT evidence that production privileged credentials are secured.
});
