// FloodGuard R3: test-only credential containment on local Auth + RTDB
// Emulators. This is an alternate unpublished Rules CANDIDATE.
// No production Firebase, notifications, firmware upload or gate control.
import {test,before,after,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {initializeApp,deleteApp} from 'firebase-admin/app';
import {getAuth} from 'firebase-admin/auth';

const PROJECT='demo-r3-credential-containment';
const AUTH='http://127.0.0.1:9099',RTDB='http://127.0.0.1:9000';
const NS=PROJECT+'-default-rtdb',ROOT='/floodguard',UID='device-stage-a';
const STAGE=ROOT+'/staging/ingestV1/'+UID;
const CONFIRM=ROOT+'/confirmedLab/records/'+UID+'/2';
const PUBLISH=ROOT+'/publicationLab/water';
const ROLES={
  device:[UID,'fg_ingest_v1'],
  confirmer:['confirmer-stage','fg_confirm_ingest_v1'],
  attestor:['attestor-stage','fg_attest_ingest_v1'],
  publisher:['publisher-water-stage','fg_publish_water_v1'],
  ordinary:['ordinary-stage',null]
};
const NOW=1700000003500;
const FRAME={sequence:2,distanceCm:16.5,levelCm:8.5,risk:'WARNING'};
const DIGEST=createHash('sha256').update('UNSIGNED-FAKE-TEST-ONLY').digest('hex');
const RECORD={
  version:'floodguard-confirmed-record-v1',epoch:1,sequence:2,digest:DIGEST,
  acceptedAtMs:NOW-100,observedAtMs:NOW-400,frame:FRAME
};
const PUBLIC={
  current:{distanceCm:20,levelCm:5,status:'SAFE',
    observedAtMs:NOW-3000,overallRisk:'UNKNOWN'},
  checkpoint:{initialized:true,deviceId:UID,epoch:1,sequence:1,
    digest:'0'.repeat(64),observedAtMs:NOW-3000}
};
const NEXT={
  current:{distanceCm:16.5,levelCm:8.5,status:'WARNING',
    observedAtMs:NOW-400,overallRisk:'UNKNOWN'},
  checkpoint:{initialized:true,deviceId:UID,epoch:1,sequence:2,
    digest:DIGEST,observedAtMs:NOW-400}
};
if(process.env.FG_R3_CONTAINED_TOKENS_TEST!=='1'||
   process.env.FIREBASE_AUTH_EMULATOR_HOST!=='127.0.0.1:9099'||
   process.env.FIREBASE_DATABASE_EMULATOR_HOST!=='127.0.0.1:9000'||
   process.env.GCLOUD_PROJECT!==PROJECT)
  throw Error('Local-only Auth and RTDB Emulator required');
let app,admin,users,tokens;
async function http(url,method='GET',data){
  const res=await fetch(url,{
    method,headers:{'content-type':'application/json'},
    ...(data===undefined?{}:{body:JSON.stringify(data)}),
    signal:AbortSignal.timeout(7000)
  });
  const raw=await res.text();
  let value;try{value=JSON.parse(raw);}catch{value=null;}
  return {status:res.status,value};
}
function url(p,role){
  if(!(p===ROOT||p.startsWith(ROOT+'/'))||
     p.includes('..')||p.includes('?')||p.includes('#'))
    throw Error('Unsafe test path');
  const u=new URL(RTDB+p+'.json');
  u.searchParams.set('ns',NS);
  if(role==='__SEED_ONLY__')u.searchParams.set('access_token','owner');
  else if(role)u.searchParams.set('auth',tokens[role]);
  return u;
}
const call=(p,role,verb='GET',data)=>http(url(p,role),verb,data);
async function seed(p,v){
  const r=await call(p,'__SEED_ONLY__','PUT',v);
  assert.equal(r.status,200,'Emulator-only fixture setup failed');
}
const ok=async p=>{
  const r=await p;
  assert.equal(r.status,200,JSON.stringify({httpStatus:r.status}));
  return r.value;
};
const reject=async p=>{
  const r=await p;
  assert.ok([401,403].includes(r.status),'unexpected role permission '+r.status);
};
async function login(role){
  const [uid,claim]=ROLES[role],v=users[role];
  const r=await http(
    AUTH+'/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-only',
    'POST',{email:v.email,password:v.password,returnSecureToken:true});
  assert.equal(r.status,200);
  const jwt=r.value.idToken;
  const claims=JSON.parse(Buffer.from(jwt.split('.')[1],'base64url').toString());
  assert.equal(claims.user_id||claims.sub,uid);
  assert.equal(claims.aud,PROJECT);
  if(claim)assert.equal(claims[claim],true);
  return jwt;
}
before(async()=>{
  app=initializeApp({projectId:PROJECT},'fg-r3-credential-lab');
  admin=getAuth(app);users={};
  for(const [role,[uid,claim]] of Object.entries(ROLES)){
    const email=uid+'@floodguard-lab.invalid';
    const password=randomBytes(32).toString('base64url');
    await admin.createUser({uid,email,password});
    if(claim)await admin.setCustomUserClaims(uid,{[claim]:true});
    users[role]={email,password};
  }
});
after(async()=>{if(app)await deleteApp(app);});
beforeEach(async()=>{
  tokens={};
  for(const role of Object.keys(ROLES))tokens[role]=await login(role);
  await seed(ROOT,{
    deviceAuthorization:{[UID]:{enabled:true,scope:'prototype-ingest-v1'}},
    confirmerLabAuthorization:{'confirmer-stage':{
      enabled:true,scope:'confirmer-ingest-v1',deviceId:UID,epoch:1
    }},
    attestorLabAuthorization:{'attestor-stage':{
      enabled:true,scope:'attestor-ingest-v1',deviceId:UID,epoch:1
    }},
    publisherLabAuthorization:{'publisher-water-stage':{
      enabled:true,scope:'publication-lab-water-v1',deviceId:UID,epoch:1
    }},
    publicationLab:{water:PUBLIC},
    live:{water:{status:'SAFE'},gate:{status:'CLOSED',angle:0},
      system:{overallRisk:'UNKNOWN'},
      esp8266:{ip:'192.0.2.13',wifi:'PRIVATE-SYNTHETIC'}},
    bot:{contacts:'PRIVATE-SYNTHETIC'}
  });
});

test('actual Auth Emulator device token still writes only untrusted staging',async()=>{
  assert.deepEqual(await ok(call(STAGE,'device','PUT',FRAME)),FRAME);
  await reject(call(STAGE,'confirmer','PUT',FRAME));
  await reject(call(STAGE,'publisher','PUT',FRAME));
  await reject(call(STAGE,'ordinary','PUT',FRAME));
  await reject(call(ROOT+'/live/gate/angle','device','PUT',90));
});
test('compromised confirmer real token cannot create a false signed confirmation',async()=>{
  await ok(call(STAGE,'device','PUT',FRAME));
  for(const role of ['confirmer','device','attestor','publisher','ordinary']){
    await reject(call(CONFIRM,role,'PUT',RECORD));
  }
  assert.equal((await ok(call(CONFIRM,'confirmer'))),null);
  assert.equal((await ok(call(CONFIRM,'attestor'))),null);
});
test('compromised publisher real token cannot write unsigned public test telemetry',async()=>{
  for(const role of ['publisher','confirmer','device','attestor','ordinary']){
    await reject(call(PUBLISH,role,'PUT',NEXT));
  }
  assert.deepEqual(await ok(call(PUBLISH+'/current',null)),PUBLIC.current);
  await reject(call(PUBLISH+'/checkpoint',null));
});
test('publisher cannot mutate nested current/checkpoint or ancestor as a bypass',async()=>{
  for(const p of [
    PUBLISH+'/current/status',PUBLISH+'/current',
    PUBLISH+'/checkpoint/sequence',PUBLISH+'/checkpoint',
    ROOT+'/publicationLab',ROOT+'/live/water',ROOT+'/live/gate/angle',
    ROOT+'/deviceAuthorization/'+UID+'/enabled'
  ])await reject(call(p,'publisher','PUT','FORGED'));
  await reject(call(ROOT,'publisher','PATCH',{publicationLab:{water:NEXT}}));
  assert.deepEqual(await ok(call(PUBLISH+'/current',null)),PUBLIC.current);
});
test('confirmer role cannot delete immutable data or escalate parent write',async()=>{
  for(const p of [
    CONFIRM,ROOT+'/confirmedLab/records/'+UID,
    ROOT+'/confirmedLab/records',ROOT+'/confirmedLab',
    ROOT+'/deviceAuthorization/'+UID+'/enabled'
  ])await reject(call(p,'confirmer','PUT',RECORD));
  await reject(call(CONFIRM,'confirmer','DELETE'));
  await reject(call(ROOT+'/confirmedLab','confirmer','PATCH',{
    records:{[UID]:{'2':RECORD}}
  }));
});
test('separate read-only attestor and public reader remain least-privileged',async()=>{
  // The immutable test confirmation is a fixture, not proof of a sensor
  // signature or a deployed signer. Only emulator TEST owner can seed it.
  await seed(CONFIRM,RECORD);
  assert.deepEqual(await ok(call(CONFIRM,'attestor')),RECORD);
  await reject(call(CONFIRM,'publisher'));
  await reject(call(CONFIRM,null));
  await reject(call(CONFIRM,'attestor','PUT',RECORD));
  assert.deepEqual(await ok(call(PUBLISH+'/current',null)),PUBLIC.current);
  await reject(call(PUBLISH+'/checkpoint',null));
  await reject(call(ROOT+'/live/esp8266/ip',null));
  await reject(call(ROOT+'/bot',null));
});
test('removing device authorization does not re-open any direct publisher rights',async()=>{
  await ok(call(STAGE,'device','PUT',FRAME));
  await seed(ROOT+'/deviceAuthorization/'+UID+'/enabled',false);
  await reject(call(STAGE,'device','PUT',{...FRAME,sequence:3}));
  await reject(call(CONFIRM,'confirmer','PUT',RECORD));
  await reject(call(PUBLISH,'publisher','PUT',NEXT));
  assert.deepEqual(await ok(call(PUBLISH+'/current',null)),PUBLIC.current);
});
test('exact candidate differs from historical Rules only at the two targeted writes',()=>{
  const old=JSON.parse(readFileSync(
    'docs/firebase/phase-b-versioned-confirmation-lab.rules.json','utf8'));
  const changed=JSON.parse(readFileSync(
    'docs/firebase/r3-credential-containment-lab.rules.json','utf8'));
  const a=structuredClone(old);
  a.rules.floodguard.confirmedLab.records['$deviceId']['$sequence']['.write']=false;
  a.rules.floodguard.publicationLab.water['.write']=false;
  assert.deepEqual(changed,a);
  assert.equal(changed.rules['.write'],false);
  assert.equal(changed.rules.floodguard.confirmedLab.records['$deviceId']['$sequence']['.write'],false);
  assert.equal(changed.rules.floodguard.publicationLab.water['.write'],false);
});
