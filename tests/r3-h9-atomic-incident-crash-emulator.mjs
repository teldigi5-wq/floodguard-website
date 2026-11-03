// H9 — actual localhost Auth+RTDB Emulator single-node CAS and crash gates.
// No production Firebase, no user credentials, no firmware, alerts or gate.
import {test,before,after,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {fork} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {createHash,generateKeyPairSync,randomBytes,sign} from 'node:crypto';
import {initializeApp,deleteApp} from 'firebase-admin/app';
import {getAuth} from 'firebase-admin/auth';
import {canonicalOfflineEnvelope} from '../experiments/stage7-durable-ingress.mjs';
import {canonicalSyntheticPublicationAttestation}
  from '../experiments/synthetic-publication-attestation.mjs';
import {createH4OfflineAdmissionIssuer}
  from '../experiments/r3-h4-signed-admission-issuer.mjs';
import {createH7OfflineWitness,canonicalH7OperatorEvent}
  from '../experiments/r3-h7-external-witness-lab.mjs';
import {createH7OfflineCoordinator}
  from '../experiments/r3-h7-offline-coordinator.mjs';
import {createH8OfflineReadbackObserver}
  from '../experiments/r3-h8-verified-readback-observer.mjs';

const PROJECT='demo-r3-h9-atomic',BASE='http://127.0.0.1:9000';
const AUTH='http://127.0.0.1:9099',NS=PROJECT+'-default-rtdb';
const ROOT='/floodguard',ID='device-stage-a';
const NODE=ROOT+'/atomicPublicationLab/'+ID;
const A='a'.repeat(64);
const DEVICE=generateKeyPairSync('ed25519');
const RECEIPT=generateKeyPairSync('ed25519');
const ATTESTOR=generateKeyPairSync('ed25519');
const SPKI=x=>x.export({format:'der',type:'spki'}).toString('base64');
const SIG=(s,k)=>sign(null,Buffer.from(s),k).toString('base64url');
if(process.env.GCLOUD_PROJECT!==PROJECT||
  process.env.FIREBASE_AUTH_EMULATOR_HOST!=='127.0.0.1:9099'||
  process.env.FIREBASE_DATABASE_EMULATOR_HOST!=='127.0.0.1:9000')
  throw Error('H9 tests refuse nonlocal project or Firebase');

let admin,observerToken;
const spawned=new Set();
function url(path,role){
  if(!(path===ROOT||path.startsWith(ROOT+'/'))||
    path.includes('..')||path.includes('#')||path.includes('?'))
    throw Error('Out of scope test path');
  const u=new URL(BASE+path+'.json');u.searchParams.set('ns',NS);
  if(role==='owner')u.searchParams.set('access_token','owner');
  if(role==='observer')u.searchParams.set('auth',observerToken);
  return u;
}
async function db(path,role,method='GET',value,etag=false){
  const headers={};
  if(etag===true)headers['X-Firebase-ETag']='true';
  if(typeof etag==='string')headers['if-match']=etag;
  if(value!==undefined)headers['content-type']='application/json';
  const res=await fetch(url(path,role),{
    method,headers,signal:AbortSignal.timeout(8000),redirect:'error',
    ...(value===undefined?{}:{body:JSON.stringify(value)})
  });
  const raw=await res.text();
  let data;try{data=JSON.parse(raw);}catch{data=null;}
  return {status:res.status,data,etag:res.headers.get('etag')};
}
async function seed(path,data){
  assert.equal((await db(path,'owner','PUT',data)).status,200);
}
function signed(){
  const now=Date.now();
  const envelope={
    version:'floodguard-offline-envelope-v1',deviceId:ID,epoch:1,
    observedAtMs:now-1000,
    frame:{sequence:2,distanceCm:16.5,levelCm:8.5,risk:'WARNING'}
  };
  const canonical=canonicalOfflineEnvelope(envelope);
  const digest=createHash('sha256').update(canonical).digest('hex');
  const receipt={
    version:'floodguard-offline-receipt-v1',deviceId:ID,epoch:1,
    sequence:2,digest,acceptedAtMs:now-250
  };
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
    attestation,
    attestationSignature:SIG(
      canonicalSyntheticPublicationAttestation(attestation),ATTESTOR.privateKey),
    databaseRecord:{deviceId:ID,epoch:1,sequence:2,digest,
      acceptedAtMs:now-250,status:'DATABASE_CONFIRMED'}
  };
}
function project(e){
  return {
    current:{distanceCm:16.5,levelCm:8.5,status:'WARNING',
      observedAtMs:e.envelope.observedAtMs,overallRisk:'UNKNOWN'},
    checkpoint:{initialized:true,deviceId:ID,epoch:1,
      sequence:2,digest:e.receipt.digest,
      observedAtMs:e.envelope.observedAtMs}
  };
}
async function child(){
  const p=fork(fileURLToPath(new URL(
    '../experiments/r3-h9-single-node-worker.mjs',import.meta.url)),[],{
    cwd:process.cwd(),execArgv:[],
    stdio:['ignore','pipe','pipe','ipc','pipe'],
    env:{
      HOME:process.env.HOME,PATH:process.env.PATH,
      FG_R3_H9_TEST:'1',GCLOUD_PROJECT:PROJECT,
      FIREBASE_AUTH_EMULATOR_HOST:'127.0.0.1:9099',
      FIREBASE_DATABASE_EMULATOR_HOST:'127.0.0.1:9000'
    }
  });
  spawned.add(p);
  p.stdout.on('data',()=>{});p.stderr.on('data',()=>{});
  let serial=0;const replies=new Map(),events=[],watchers=[];
  p.on('message',m=>{
    if(m?.phase){
      events.push(m);
      for(const wait of [...watchers])
        if(wait.id===m.id&&wait.phase===m.phase){
          watchers.splice(watchers.indexOf(wait),1);wait.resolve(m);
        }
      return;
    }
    const r=replies.get(m?.id);
    if(r){replies.delete(m.id);clearTimeout(r.timer);r.resolve(m);}
  });
  p.on('exit',()=>{
    spawned.delete(p);
    for(const r of replies.values()){clearTimeout(r.timer);
      r.resolve({ok:false,reason:'worker-exited'});}
    replies.clear();
    for(const w of watchers.splice(0))w.reject(Error('worker-exited-before-phase'));
  });
  const send=msg=>{
    const id=++serial;
    const promise=new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{
        replies.delete(id);reject(Error('H9 IPC request expired'));
      },12000);
      replies.set(id,{resolve,reject,timer});
      p.send({...msg,id},err=>{
        if(err){clearTimeout(timer);replies.delete(id);reject(err);}
      });
    });
    return {id,promise};
  };
  const phase=(id,label)=>{
    const seen=events.find(x=>x.id===id&&x.phase===label);
    if(seen)return Promise.resolve(seen);
    return new Promise((resolve,reject)=>{
      const t=setTimeout(()=>{
        const at=watchers.findIndex(w=>w.id===id&&w.phase===label);
        if(at>=0)watchers.splice(at,1);
        reject(Error('expected H9 phase did not arrive'));
      },10000);
      watchers.push({id,phase:label,resolve:v=>{
        clearTimeout(t);resolve(v);
      },reject:e=>{clearTimeout(t);reject(e);}});
    });
  };
  p.stdio[4].end(JSON.stringify({
    deviceSpki:SPKI(DEVICE.publicKey),receiptSpki:SPKI(RECEIPT.publicKey),
    attestorSpki:SPKI(ATTESTOR.publicKey)
  }));
  const boot=await send({type:'init'}).promise;
  assert.equal(boot.ok,true,JSON.stringify(boot));
  assert.equal(boot.releaseDecision,'NO_GO');
  return {p,send,phase,kill:async()=>{
    if(p.exitCode!==null||p.signalCode!==null)return;
    const exit=new Promise(resolve=>p.once('exit',resolve));
    p.kill('SIGKILL');
    await exit;
  }};
}
function witnessFixture(){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'floodguard-h9-witness-'));
  let anchor={revision:0,head:'0'.repeat(64)};
  const externalAnchor=Object.freeze({
    read:()=>({...anchor}),
    compareAndAdvance:(old,next)=>{
      if(old.revision!==anchor.revision||old.head!==anchor.head)return false;
      anchor={...next};return true;
    }
  });
  const operator=generateKeyPairSync('ed25519');
  const ack=generateKeyPairSync('ed25519');
  const witness=createH7OfflineWitness({
    directory:dir,integrityKey:randomBytes(32),externalAnchor,
    operatorPublicKey:operator.publicKey,
    confirmationPublicKey:ack.publicKey,clock:()=>Date.now()
  });
  const event={
    kind:'BOOTSTRAP',deviceId:ID,epoch:1,revision:1,
    sequence:1,digest:A,atMs:Date.now()
  };
  assert.equal(witness.operator(event,SIG(
    canonicalH7OperatorEvent(event),operator.privateKey)).ok,true);
  const authority=Object.freeze({read:async()=>({
    revision:1,
    issuer:{enabled:true,generation:1,scope:'lab-signed-admission-v1'},
    publisher:{enabled:true,deviceId:ID,epoch:1,scope:'publication-lab-water-v1'},
    incident:{blocked:false,epoch:1},
    sourceBinding:{deviceId:ID,epoch:1,enabled:true,
      scope:'prototype-ingest-v1',publicKey:DEVICE.publicKey},
    trustedReceiptKey:RECEIPT.publicKey,
    trustedDatabaseIssuerKey:ATTESTOR.publicKey,
    lastPublished:{initialized:true,epoch:1,sequence:1,digest:A}
  })});
  const issuer=createH4OfflineAdmissionIssuer({
    authority,clock:()=>Date.now()
  });
  const coordinator=createH7OfflineCoordinator({issuer,witness});
  const observer=createH8OfflineReadbackObserver({
    witness,acknowledgerPrivateKey:ack.privateKey,
    clock:()=>Date.now(),
    readPublication:async()=>{
      const v=await db(NODE,'observer');
      if(v.status!==200||!v.data||v.data.control.blocked!==false||
        v.data.control.epoch!==1)
        throw Error('Quarantined or unavailable atomic publication');
      return {current:v.data.current,checkpoint:v.data.checkpoint};
    }
  });
  return {witness,coordinator,observer,
    cleanup:()=>fs.rmSync(dir,{recursive:true,force:true})};
}
before(async()=>{
  admin=initializeApp({projectId:PROJECT},'h9-auth-emulator-fixture');
  const auth=getAuth(admin);
  const password=randomBytes(28).toString('base64url');
  const uid='readback-observer-stage';
  const email=uid+'@floodguard-lab.invalid';
  await auth.createUser({uid,email,password});
  await auth.setCustomUserClaims(uid,{
    fg_readback_v1:true,fg_readback_generation:1});
  const r=await fetch(AUTH+
    '/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-only',{
    method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify({email,password,returnSecureToken:true}),
    signal:AbortSignal.timeout(7000)
  });
  assert.equal(r.status,200);
  observerToken=(await r.json()).idToken;
});
after(async()=>{
  for(const p of spawned)if(p.exitCode===null)p.kill('SIGKILL');
  if(admin)await deleteApp(admin);
});
beforeEach(async()=>{
  const now=Date.now();
  await seed(ROOT,{
    admissionIssuerAuthorization:{
      'admission-issuer-stage':{enabled:true,generation:1,revision:1,
        scope:'lab-signed-admission-v1'}
    },
    publicationObserverAuthorization:{
      'readback-observer-stage':{
        enabled:true,generation:1,scope:'publication-readback-v1'
      }
    },
    publisherLabAuthorization:{
      'publisher-water-stage':{
        enabled:true,deviceId:ID,epoch:1,scope:'publication-lab-water-v1'
      }
    },
    deviceAuthorization:{[ID]:{enabled:true,scope:'prototype-ingest-v1'}},
    atomicPublicationLab:{[ID]:{
      control:{epoch:1,blocked:false,revision:1},
      current:{distanceCm:20,levelCm:5,status:'SAFE',
        observedAtMs:now-4500,overallRisk:'UNKNOWN'},
      checkpoint:{initialized:true,deviceId:ID,epoch:1,sequence:1,
        digest:A,observedAtMs:now-4500}
    }},
    live:{gate:{status:'CLOSED',angle:0},esp8266:{
      ip:'192.0.2.13',wifi:'SYNTHETIC_ONLY'
    }}
  });
});

test('anonymous and ordinary clients cannot access atomic publication, observer is read-only',async()=>{
  assert.equal((await db(NODE,null)).status,401);
  assert.equal((await db(NODE,'observer')).status,200);
  for(const p of [NODE,ROOT+'/live/gate/angle',ROOT+'/deviceAuthorization/'+ID])
    assert.ok([401,403].includes((await db(p,'observer','PUT',{})).status));
  assert.equal((await db(ROOT+'/live/esp8266/ip','observer')).status,401);
  await seed(ROOT+'/publicationObserverAuthorization/readback-observer-stage/generation',2);
  assert.equal((await db(NODE,'observer')).status,401);
});
test('H9 signed evidence commits exactly once with incident control unchanged',async()=>{
  const w=await child();try{
    const e=signed(),r=await w.send({
      type:'commit',mode:'normal',evidence:e
    }).promise;
    assert.equal(r.ok,true,JSON.stringify(r));
    assert.equal(r.releaseDecision,'NO_GO');
    const v=(await db(NODE,'owner')).data;
    assert.deepEqual(v.control,{epoch:1,blocked:false,revision:1});
    assert.deepEqual({current:v.current,checkpoint:v.checkpoint},project(e));
    assert.equal((await w.send({type:'commit',mode:'normal',evidence:e}).promise).ok,false);
  }finally{await w.kill();}
});
test('tampered attestor signature cannot cause CAS, even if database evidence claims confirmed',async()=>{
  const w=await child();try{
    const e=signed();
    assert.equal((await w.send({type:'commit',mode:'normal',
      evidence:{...e,attestationSignature:'A'.repeat(86)}
    }).promise).ok,false);
    assert.equal((await db(NODE,'owner')).data.checkpoint.sequence,1);
  }finally{await w.kill();}
});
test('deterministic QUARANTINE at pre-CAS pause invalidates stale publication ETag',async()=>{
  const w=await child();try{
    const e=signed();
    const command=w.send({type:'commit',mode:'pauseBefore',evidence:e});
    await w.phase(command.id,'pre-cas');
    const state=await db(NODE,'owner','GET',undefined,true);
    assert.equal(state.status,200);
    const changed={...state.data,
      control:{epoch:2,blocked:true,revision:2}};
    assert.equal((await db(NODE,'owner','PUT',changed,state.etag)).status,200);
    w.p.send({type:'resume',id:command.id});
    const failed=await command.promise;
    assert.equal(failed.ok,false,JSON.stringify(failed));
    const after=(await db(NODE,'owner')).data;
    assert.deepEqual(after.control,changed.control);
    assert.equal(after.checkpoint.sequence,1);
  }finally{await w.kill();}
});
test('deterministic crash BEFORE CAS cannot publish; H7 witness remains pending',async()=>{
  const w=await child();const f=witnessFixture();
  try{
    const e=signed();
    const reservation=await f.coordinator.prepare(e);
    assert.equal(reservation.ok,true);
    const command=w.send({type:'commit',mode:'pauseBefore',evidence:e});
    await w.phase(command.id,'pre-cas');
    await w.kill(); // deterministic pre-write crash injection
    const result=await command.promise;
    assert.equal(result.ok,false);
    assert.equal((await db(NODE,'owner')).data.checkpoint.sequence,1);
    const observation=await f.observer.inspect({
      reservation,candidate:project(e)});
    assert.equal(observation.attested,false);
    assert.equal(f.witness.snapshot().pending.reservationId,reservation.reservationId);
  }finally{await w.kill();f.cleanup();}
});
test('deterministic crash AFTER successful CAS but BEFORE ACK is reconciled by H8 readback and H7',async()=>{
  const w=await child();const f=witnessFixture();
  try{
    const e=signed();
    const reservation=await f.coordinator.prepare(e);
    assert.equal(reservation.ok,true);
    const command=w.send({type:'commit',mode:'pauseAfter',evidence:e});
    await w.phase(command.id,'post-cas-before-ack');
    await w.kill(); // after HTTP 200, before normal IPC success
    assert.equal((await command.promise).ok,false);
    const observed=await db(NODE,'observer');
    assert.equal(observed.status,200);
    assert.deepEqual({current:observed.data.current,
      checkpoint:observed.data.checkpoint},project(e));
    const proof=await f.observer.inspect({
      reservation,candidate:project(e)});
    assert.equal(proof.attested,true,JSON.stringify(proof));
    const advanced=f.witness.acknowledge(
      proof.acknowledgement,proof.signature);
    assert.equal(advanced.ok,true,JSON.stringify(advanced));
    assert.equal(f.witness.snapshot().sequence,2);
    assert.equal(f.witness.snapshot().pending,null);
  }finally{await w.kill();f.cleanup();}
});
test('quarantine after CAS blocks H8 acknowledgement even though data was committed',async()=>{
  const w=await child();const f=witnessFixture();
  try{
    const e=signed(),reservation=await f.coordinator.prepare(e);
    assert.equal(reservation.ok,true);
    assert.equal((await w.send({type:'commit',mode:'normal',evidence:e}).promise).ok,true);
    const prior=await db(NODE,'owner','GET',undefined,true);
    assert.equal((await db(NODE,'owner','PUT',{
      ...prior.data,control:{epoch:2,blocked:true,revision:2}
    },prior.etag)).status,200);
    const attested=await f.observer.inspect({reservation,candidate:project(e)});
    assert.equal(attested.attested,false);
    assert.equal(f.witness.snapshot().sequence,1);
    assert.ok(f.witness.snapshot().pending);
  }finally{await w.kill();f.cleanup();}
});
test('EXPECTED OPEN DEFECT: compromised privileged Emulator owner can directly forge entire atomic node',async()=>{
  const forged={
    control:{epoch:1,blocked:false,revision:1},
    current:{distanceCm:20,levelCm:5,status:'SAFE',
      observedAtMs:Date.now(),overallRisk:'UNKNOWN'},
    checkpoint:{initialized:true,deviceId:ID,epoch:1,sequence:2,
      digest:'f'.repeat(64),observedAtMs:Date.now()}
  };
  assert.equal((await db(NODE,'owner','PUT',forged)).status,200);
  assert.equal((await db(NODE,'observer')).data.current.status,'SAFE');
  // The signer/observer and operator custody are NOT independent in this lab.
});
