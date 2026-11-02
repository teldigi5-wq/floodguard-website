// FloodGuard R3: REAL ID tokens issued by localhost Firebase Auth Emulator,
// exercised through ordinary RTDB REST requests evaluated against EXISTING
// versioned-confirmation rules. All identities, secrets and rows SYNTHETIC.
// Admin SDK is used ONLY to create Auth Emulator test users/claims.
// RTDB fixture access_token=owner is test-only setup, NEVER a role request.
// Do not run against any deployed Firebase instance or field device.
import {test,before,after,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,createHash} from 'node:crypto';
import {initializeApp,deleteApp} from 'firebase-admin/app';
import {getAuth} from 'firebase-admin/auth';

const PROJECT='demo-r3-real-token-versioned';
const AUTH='http://127.0.0.1:9099';
const RTDB='http://127.0.0.1:9000';
const NAMESPACE=PROJECT+'-default-rtdb';
const ROOT='/floodguard',UID='device-stage-a';
const STAGE=ROOT+'/staging/ingestV1/'+UID;
const CONFIRMED=ROOT+'/confirmedLab/records/'+UID+'/2';
const WATER=ROOT+'/publicationLab/water';
const ROLES={
  device:['device-stage-a','fg_ingest_v1'],
  confirmer:['confirmer-stage','fg_confirm_ingest_v1'],
  attestor:['attestor-stage','fg_attest_ingest_v1'],
  publisher:['publisher-water-stage','fg_publish_water_v1'],
  ordinary:['ordinary-stage',null],
  impostor:['device-stage-b','fg_ingest_v1']
};
if(process.env.FG_R3_REAL_TOKEN_VERSIONED_TEST!=='1'||
   process.env.FIREBASE_AUTH_EMULATOR_HOST!=='127.0.0.1:9099'||
   process.env.FIREBASE_DATABASE_EMULATOR_HOST!=='127.0.0.1:9000'||
   process.env.GCLOUD_PROJECT!==PROJECT)
  throw Error('Refusing execution without pinned LOCAL demo Auth and RTDB emulators');

const SAMPLE_AT=1700000003500;
const FRAME={sequence:2,distanceCm:16.5,levelCm:8.5,risk:'WARNING'};
const DIGEST=createHash('sha256').update('SYNTHETIC-UNAUTHENTICATED-FRAME')
  .digest('hex');
const RECORD={
  version:'floodguard-confirmed-record-v1',epoch:1,sequence:2,
  digest:DIGEST,acceptedAtMs:SAMPLE_AT-100,observedAtMs:SAMPLE_AT-400,
  frame:FRAME
};
const initial={
  current:{distanceCm:20,levelCm:5,status:'SAFE',
    observedAtMs:SAMPLE_AT-3000,overallRisk:'UNKNOWN'},
  checkpoint:{initialized:true,deviceId:UID,epoch:1,
    sequence:1,digest:'0'.repeat(64),observedAtMs:SAMPLE_AT-3000}
};
const projected={
  current:{distanceCm:16.5,levelCm:8.5,status:'WARNING',
    observedAtMs:SAMPLE_AT-400,overallRisk:'UNKNOWN'},
  checkpoint:{initialized:true,deviceId:UID,epoch:1,
    sequence:2,digest:DIGEST,observedAtMs:SAMPLE_AT-400}
};
let app,auth,users,tokens;

async function jsonRequest(url,method='GET',value){
  const res=await fetch(url,{
    method,headers:{'content-type':'application/json'},
    ...(value===undefined?{}:{body:JSON.stringify(value)}),
    signal:AbortSignal.timeout(7000)
  });
  const text=await res.text();
  let data;
  try{data=JSON.parse(text);}catch{data=null;}
  return {status:res.status,data};
}
function dbUrl(path,identity) {
  if(typeof path!=='string'||!(path===ROOT||path.startsWith(ROOT+'/'))||
     path.includes('..')||path.includes('?')||path.includes('#'))
    throw Error('Attempted to escape synthetic RTDB root');
  const url=new URL(RTDB+path+'.json');
  url.searchParams.set('ns',NAMESPACE);
  // The special RTDB Emulator owner bypass is deliberately only selected
  // by the seed() function, never by a role holder.
  if(identity==='__EMULATOR_TEST_OWNER__')
    url.searchParams.set('access_token','owner');
  else if(identity)url.searchParams.set('auth',tokens[identity]);
  return url;
}
const request=(path,role,method='GET',payload)=>
  jsonRequest(dbUrl(path,role),method,payload);
async function seed(path,payload){
  const result=await jsonRequest(
    dbUrl(path,'__EMULATOR_TEST_OWNER__'),'PUT',payload);
  assert.equal(result.status,200,'Test fixture setup failed');
}
const allowed=async promise=>{
  const r=await promise;
  assert.equal(r.status,200,'Scoped real Auth token request not allowed');
  return r.data;
};
const forbidden=async promise=>{
  const r=await promise;
  assert.ok([401,403].includes(r.status),
    'Unsafe request unexpectedly accepted (HTTP '+r.status+')');
};
const payload=token=>JSON.parse(Buffer.from(
  token.split('.')[1],'base64url').toString('utf8'));

async function signin(role) {
  const [id]=ROLES[role],creds=users[role];
  const r=await jsonRequest(
    AUTH+'/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-only',
    'POST',{email:creds.email,password:creds.password,returnSecureToken:true});
  assert.equal(r.status,200,'Local Auth Emulator did not mint an ID token');
  const jwt=r.data.idToken,claims=payload(jwt);
  assert.equal(claims.user_id||claims.sub,id);
  assert.equal(claims.aud,PROJECT);
  assert.ok(Number.isSafeInteger(claims.auth_time));
  const expected=ROLES[role][1];
  if(expected)assert.equal(claims[expected],true);
  else assert.ok(!claims.fg_ingest_v1&&!claims.fg_confirm_ingest_v1&&
    !claims.fg_attest_ingest_v1&&!claims.fg_publish_water_v1);
  return jwt;
}
before(async()=>{
  app=initializeApp({projectId:PROJECT},'fg-r3-token-test-only');
  auth=getAuth(app);users={};
  for(const [role,[uid,claim]] of Object.entries(ROLES)){
    const password=randomBytes(32).toString('base64url');
    const email=uid+'@floodguard-lab.invalid';
    await auth.createUser({uid,email,password});
    if(claim)await auth.setCustomUserClaims(uid,{[claim]:true});
    users[role]={email,password};
  }
});
after(async()=>{if(app)await deleteApp(app);});
beforeEach(async()=>{
  // Real issued emulator ID tokens, NOT authenticatedContext mocked claims.
  tokens={};
  for(const role of Object.keys(ROLES))tokens[role]=await signin(role);
  await seed(ROOT,{
    deviceAuthorization:{
      [UID]:{enabled:true,scope:'prototype-ingest-v1'},
      'device-stage-b':{enabled:true,scope:'prototype-ingest-v1'}
    },
    confirmerLabAuthorization:{
      'confirmer-stage':{enabled:true,scope:'confirmer-ingest-v1',
        deviceId:UID,epoch:1}
    },
    attestorLabAuthorization:{
      'attestor-stage':{enabled:true,scope:'attestor-ingest-v1',
        deviceId:UID,epoch:1}
    },
    publisherLabAuthorization:{
      'publisher-water-stage':{enabled:true,scope:'publication-lab-water-v1',
        deviceId:UID,epoch:1}
    },
    publicationLab:{water:initial},
    live:{water:{status:'SAFE'},gate:{status:'CLOSED',angle:0},
      system:{overallRisk:'UNKNOWN'},
      esp8266:{ip:'192.0.2.15',wifi:'PRIVATE-TEST'}},
    bot:{contacts:'PRIVATE-TEST'}
  });
});
test('real Auth Emulator device token writes one narrow signed-identity staging leaf',async()=>{
  assert.deepEqual(await allowed(request(STAGE,'device','PUT',FRAME)),FRAME);
  await forbidden(request(STAGE,'ordinary','PUT',FRAME));
  await forbidden(request(STAGE,'impostor','PUT',FRAME));
  await forbidden(request(STAGE,null,'PUT',FRAME));
  await forbidden(request(ROOT+'/live/gate/angle','device','PUT',90));
  await forbidden(request(ROOT+'/deviceAuthorization/'+UID+'/enabled','device','PUT',false));
  assert.equal((await allowed(request(STAGE,'confirmer'))).sequence,2);
});
test('real confirmer token can write write-once confirmation but not change it',async()=>{
  await allowed(request(STAGE,'device','PUT',FRAME));
  await forbidden(request(CONFIRMED,'device','PUT',RECORD));
  await forbidden(request(CONFIRMED,'attestor','PUT',RECORD));
  await forbidden(request(CONFIRMED,'publisher','PUT',RECORD));
  assert.deepEqual(await allowed(request(CONFIRMED,'confirmer','PUT',RECORD)),RECORD);
  assert.deepEqual(await allowed(request(CONFIRMED,'attestor')),RECORD);
  await forbidden(request(CONFIRMED,'confirmer','DELETE'));
  await forbidden(request(CONFIRMED,'confirmer','PUT',
    {...RECORD,digest:'f'.repeat(64)}));
  await forbidden(request(ROOT+'/confirmedLab/records/device-stage-b/2',
    'confirmer','PUT',RECORD));
});
test('scoped attestor may read exact confirmed record but may not write it or see private parent',async()=>{
  await allowed(request(STAGE,'device','PUT',FRAME));
  await allowed(request(CONFIRMED,'confirmer','PUT',RECORD));
  await allowed(request(CONFIRMED,'attestor'));
  for(const path of [
    ROOT,ROOT+'/staging',ROOT+'/confirmedLab',
    ROOT+'/confirmedLab/records',
    ROOT+'/live/esp8266/ip',ROOT+'/bot',WATER+'/checkpoint'
  ])await forbidden(request(path,'attestor'));
  await forbidden(request(CONFIRMED,'attestor','DELETE'));
  await forbidden(request(WATER,'attestor','PUT',projected));
});
test('real publisher token may update only the exact narrow publication state',async()=>{
  await allowed(request(STAGE,'device','PUT',FRAME));
  await allowed(request(CONFIRMED,'confirmer','PUT',RECORD));
  for(const role of ['device','confirmer','attestor','ordinary','impostor'])
    await forbidden(request(WATER,role,'PUT',projected));
  const before=await allowed(request(ROOT+'/live/water',null));
  await allowed(request(WATER,'publisher','PUT',projected));
  assert.deepEqual(await allowed(request(WATER+'/current',null)),projected.current);
  await forbidden(request(WATER+'/checkpoint',null));
  await forbidden(request(ROOT,null));
  await forbidden(request(ROOT+'/live/esp8266/ip',null));
  await forbidden(request(ROOT+'/bot',null));
  assert.deepEqual(await allowed(request(ROOT+'/live/water',null)),before);
  await forbidden(request(ROOT+'/live/gate/angle','publisher','PUT',90));
  await forbidden(request(ROOT+'/deviceAuthorization/'+UID+'/enabled',
    'publisher','PUT',false));
  await forbidden(request(ROOT,'publisher','PUT',{}));
});
test('revocation in separately protected test registry prevents subsequently scoped writes',async()=>{
  await allowed(request(STAGE,'device','PUT',FRAME));
  await seed(ROOT+'/deviceAuthorization/'+UID+'/enabled',false);
  await forbidden(request(STAGE,'device','PUT',{...FRAME,sequence:3}));
  await forbidden(request(CONFIRMED,'confirmer','PUT',RECORD));
  await forbidden(request(CONFIRMED,'attestor'));
  await forbidden(request(WATER,'publisher','PUT',projected));
  assert.deepEqual(await allowed(request(WATER+'/current',null)),initial.current);
});
test('real token without custom claim cannot impersonate any fixed role',async()=>{
  await forbidden(request(STAGE,'ordinary','PUT',FRAME));
  await forbidden(request(CONFIRMED,'ordinary','PUT',RECORD));
  await forbidden(request(WATER,'ordinary','PUT',projected));
  await forbidden(request(ROOT+'/confirmedLab','ordinary'));
  // Even a forged string pretending to be an ID token must fail Rules.
  const fake=dbUrl(STAGE,'device');fake.searchParams.set('auth','forged.demo.idtoken');
  const r=await jsonRequest(fake,'PUT',FRAME);
  assert.ok([401,403].includes(r.status),'Forged ID token was accepted');
});
test('EXPECTED NEGATIVE: compromised confirmer token can bypass application signature verification',async()=>{
  await allowed(request(STAGE,'device','PUT',FRAME));
  // This digest is a syntactically valid hash, NOT proof of a signed frame.
  // Rules check paths/schema/staging equality but CANNOT verify Ed25519.
  const untrusted={...RECORD,digest:'b'.repeat(64)};
  assert.deepEqual(await allowed(request(CONFIRMED,'confirmer','PUT',untrusted)),
    untrusted);
  assert.deepEqual(await allowed(request(CONFIRMED,'attestor')),untrusted);
  // This accepted EMULATOR row is a demonstration of risk, not an
  // independently proven real device signature or deployable authority.
});
test('EXPECTED NEGATIVE: publisher credential alone can bypass out-of-band signed attestation logic',async()=>{
  // Do NOT stage or confirm anything: this is intentionally UNSIGNED.
  // The existing scoped Rules gate accepts increasing bounded values and
  // unchanged operator/attestor roles; it cannot verify an Ed25519 attestation.
  await allowed(request(WATER,'publisher','PUT',projected));
  assert.deepEqual(await allowed(request(WATER+'/current',null)),projected.current);
  // Public value is still only simulator data and overallRisk is UNKNOWN.
  assert.equal(projected.current.overallRisk,'UNKNOWN');
});
