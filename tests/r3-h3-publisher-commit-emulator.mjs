// FloodGuard R3 H3: SYNTHETIC Auth+RTDB Emulator only. NEVER production.
// Only localhost, a fixed demo project, no real credentials or device APIs.
import {test,before,after,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {initializeApp,deleteApp} from 'firebase-admin/app';
import {getAuth} from 'firebase-admin/auth';
import {randomBytes} from 'node:crypto';

const PROJECT='demo-r3-h3-publisher';
const RTDB='http://127.0.0.1:9000';
const AUTH='http://127.0.0.1:9099';
const NS=PROJECT+'-default-rtdb';
const ID='device-stage-a';
const ROOT='/floodguard';
const WATER=ROOT+'/publicationLab/water';
const TICKET=ROOT+'/publicationAdmission/'+ID;
const OWNER='OWNER_EMULATOR_ONLY';
const DIGEST_NEW='b'.repeat(64);
const DIGEST_OLD='a'.repeat(64);
const ROLES={
  publisher:{uid:'publisher-water-stage',claims:{fg_publish_water_v1:true}},
  ordinary:{uid:'ordinary-stage',claims:{}},
  device:{uid:ID,claims:{fg_ingest_v1:true}},
  attestor:{uid:'attestor-stage',claims:{fg_attest_ingest_v1:true}}
};
if(process.env.GCLOUD_PROJECT!==PROJECT||
   process.env.FIREBASE_AUTH_EMULATOR_HOST!=='127.0.0.1:9099'||
   process.env.FIREBASE_DATABASE_EMULATOR_HOST!=='127.0.0.1:9000')
  throw Error('H3 refuses non-demo or non-local Firebase targets');

let app,token={},ticket,payload;
function endpoint(path,role){
  if(!(path===ROOT||path.startsWith(ROOT+'/'))||path.includes('..')||
     path.includes('?')||path.includes('#'))throw Error('Disallowed test path');
  const u=new URL(RTDB+path+'.json');
  u.searchParams.set('ns',NS);
  if(role===OWNER)u.searchParams.set('access_token','owner');
  else if(role) {
    if(!Object.hasOwn(token,role))throw Error('Unknown synthetic role');
    u.searchParams.set('auth',token[role]);
  }
  assert.equal(u.origin,RTDB);
  return u;
}
async function call(url,method='GET',value){
  const r=await fetch(url,{
    method,redirect:'error',signal:AbortSignal.timeout(8000),
    headers:{'content-type':'application/json'},
    ...(value===undefined?{}:{body:JSON.stringify(value)})
  });
  const body=await r.text();
  let parsed;try{parsed=JSON.parse(body);}catch{parsed=null;}
  return {status:r.status,data:parsed};
}
const db=(path,role,method='GET',v)=>call(endpoint(path,role),method,v);
async function seed(path,value){
  const r=await db(path,OWNER,'PUT',value);
  assert.equal(r.status,200,'Only emulator fixture should seed');
}
const denied=async op=>{
  const r=await op;
  assert.ok(r.status===401||r.status===403,'Expected deny, got '+r.status);
  return r;
};
function buildFixture(){
  const now=Date.now();
  const observedAtMs=now-1000;
  const current={distanceCm:16.5,levelCm:8.5,status:'WARNING',
    observedAtMs,overallRisk:'UNKNOWN'};
  const next={initialized:true,deviceId:ID,epoch:1,sequence:2,
    digest:DIGEST_NEW,observedAtMs};
  const ticket={enabled:true,deviceId:ID,epoch:1,sequence:2,
    digest:DIGEST_NEW,observedAtMs,distanceCm:16.5,levelCm:8.5,
    status:'WARNING',issuedAtMs:now-1000,expiresAtMs:now+4000};
  return {ticket,payload:{current,checkpoint:next}};
}
before(async()=>{
  app=initializeApp({projectId:PROJECT},'h3-disposable-auth-fixture');
  const auth=getAuth(app);
  for(const [name,role] of Object.entries(ROLES)){
    const email=role.uid+'@floodguard-lab.invalid';
    const password=randomBytes(30).toString('base64url');
    await auth.createUser({uid:role.uid,email,password});
    if(Object.keys(role.claims).length)
      await auth.setCustomUserClaims(role.uid,role.claims);
    const signed=await call(new URL(
      AUTH+'/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-only'),
      'POST',{email,password,returnSecureToken:true});
    assert.equal(signed.status,200,'Synthetic Auth sign-in');
    assert.equal(typeof signed.data?.idToken,'string');
    token[name]=signed.data.idToken; // never print credentials
  }
});
after(async()=>{if(app)await deleteApp(app);});
beforeEach(async()=>{
  const fixture=buildFixture();
  ticket=fixture.ticket;payload=fixture.payload;
  const oldAt=payload.current.observedAtMs-1500;
  await seed(ROOT,{
    deviceAuthorization:{[ID]:{enabled:true,scope:'prototype-ingest-v1'}},
    incidentQuarantine:{[ID]:{blocked:false}},
    publisherLabAuthorization:{
      'publisher-water-stage':{enabled:true,scope:'publication-lab-water-v1',
        deviceId:ID,epoch:1}
    },
    publicationAdmission:{[ID]:ticket},
    publicationLab:{water:{
      current:{distanceCm:20,levelCm:5,status:'SAFE',
        observedAtMs:oldAt,overallRisk:'UNKNOWN'},
      checkpoint:{initialized:true,deviceId:ID,epoch:1,sequence:1,
        digest:DIGEST_OLD,observedAtMs:oldAt}
    }},
    live:{gate:{status:'CLOSED',angle:0},
      esp8266:{ip:'192.0.2.3',wifi:'SYNTHETIC_ONLY'}}
  });
});
test('fixed local project and private operator admission are mandatory',async()=>{
  assert.equal(new URL(RTDB).hostname,'127.0.0.1');
  assert.equal(new URL(AUTH).hostname,'127.0.0.1');
  await denied(db(TICKET,'publisher'));
  await denied(db(TICKET,'ordinary'));
  await denied(db(TICKET,'device','PUT',{enabled:true}));
  await denied(db(TICKET,'publisher','PUT',{enabled:true}));
});
test('publisher can commit one exact ticket-bound water record and checkpoint atomically',async()=>{
  assert.equal((await db(WATER,'publisher','PUT',payload)).status,200);
  assert.deepEqual((await db(WATER+'/current',null)).data,payload.current);
  assert.deepEqual((await db(WATER+'/checkpoint','publisher')).data,payload.checkpoint);
  await denied(db(ROOT+'/live/gate/angle','publisher','PUT',90));
  assert.equal((await db(ROOT+'/live/gate/angle',OWNER)).data,0);
});
test('publisher token alone, disabled admission or missing admission cannot publish',async()=>{
  await seed(TICKET,null);
  await denied(db(WATER,'publisher','PUT',payload));
  await seed(TICKET,{...ticket,enabled:false});
  await denied(db(WATER,'publisher','PUT',payload));
});
test('ordinary, anonymous, sensor and attestor identities cannot publish',async()=>{
  for(const role of [null,'ordinary','device','attestor'])
    await denied(db(WATER,role,'PUT',payload));
  assert.equal((await db(WATER+'/checkpoint',OWNER)).data.sequence,1);
});
test('ticket binds exact status, distance, timestamp, digest, and sequence',async()=>{
  for(const tampered of [
    {...payload,current:{...payload.current,distanceCm:20}},
    {...payload,current:{...payload.current,status:'DANGER'}},
    {...payload,current:{...payload.current,observedAtMs:payload.current.observedAtMs+1}},
    {...payload,checkpoint:{...payload.checkpoint,digest:'c'.repeat(64)}},
    {...payload,checkpoint:{...payload.checkpoint,sequence:3}},
    {...payload,extra:'unapproved-field'}
  ])await denied(db(WATER,'publisher','PUT',tampered));
  assert.equal((await db(WATER+'/checkpoint',OWNER)).data.sequence,1);
});
test('incident quarantine and missing quarantine authority deny the final write',async()=>{
  await seed(ROOT+'/incidentQuarantine/'+ID+'/blocked',true);
  await denied(db(WATER,'publisher','PUT',payload));
  await seed(ROOT+'/incidentQuarantine/'+ID,null);
  await denied(db(WATER,'publisher','PUT',payload));
  assert.equal((await db(WATER+'/checkpoint',OWNER)).data.sequence,1);
});
test('revocation or operator disable denies already issued publisher Auth token',async()=>{
  await seed(ROOT+'/deviceAuthorization/'+ID+'/enabled',false);
  await denied(db(WATER,'publisher','PUT',payload));
  await seed(ROOT+'/deviceAuthorization/'+ID+'/enabled',true);
  await seed(ROOT+'/publisherLabAuthorization/publisher-water-stage/enabled',false);
  await denied(db(WATER,'publisher','PUT',payload));
});
test('ticket must be fresh and bounded; stale or future sensor timestamps fail',async()=>{
  await seed(TICKET,{...ticket,issuedAtMs:Date.now()-10000,
    expiresAtMs:Date.now()-5000});
  await denied(db(WATER,'publisher','PUT',payload));
  const now=Date.now();
  await seed(TICKET,{...ticket,issuedAtMs:now-1000,
    expiresAtMs:now+60000});
  await denied(db(WATER,'publisher','PUT',payload));
  await seed(TICKET,{...ticket,observedAtMs:now-50000,
    issuedAtMs:now-1000,expiresAtMs:now+4000});
  await denied(db(WATER,'publisher','PUT',{
    current:{...payload.current,observedAtMs:now-50000},
    checkpoint:{...payload.checkpoint,observedAtMs:now-50000}
  }));
  await seed(TICKET,{...ticket,observedAtMs:now+10000,
    issuedAtMs:now-1000,expiresAtMs:now+4000});
  await denied(db(WATER,'publisher','PUT',{
    current:{...payload.current,observedAtMs:now+10000},
    checkpoint:{...payload.checkpoint,observedAtMs:now+10000}
  }));
});
test('replay, partial changes and deletion fail without advancing both checkpoint and value',async()=>{
  assert.equal((await db(WATER,'publisher','PUT',payload)).status,200);
  await denied(db(WATER,'publisher','PUT',payload));
  await denied(db(WATER+'/current','publisher','PATCH',{distanceCm:10}));
  await denied(db(WATER+'/checkpoint','publisher','PUT',payload.checkpoint));
  await denied(db(WATER,'publisher','DELETE'));
  assert.deepEqual((await db(WATER+'/current',null)).data,payload.current);
  assert.equal((await db(WATER+'/checkpoint',OWNER)).data.sequence,2);
});
test('admission authorizer cannot be impersonated via publisher credentials',async()=>{
  for(const path of [
    ROOT+'/incidentQuarantine/'+ID+'/blocked',
    ROOT+'/deviceAuthorization/'+ID+'/enabled',
    ROOT+'/publisherLabAuthorization/publisher-water-stage/enabled',
    TICKET,ROOT+'/live',ROOT+'/live/gate',ROOT+'/publicationLab'
  ])await denied(db(path,'publisher','PUT',false));
  assert.equal((await db(TICKET,OWNER)).data.enabled,true);
  assert.equal((await db(ROOT+'/incidentQuarantine/'+ID+'/blocked',OWNER)).data,false);
});
