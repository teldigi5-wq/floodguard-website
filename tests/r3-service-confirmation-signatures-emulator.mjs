// FloodGuard R3 — real local Auth-issued service token and MANDATORY
// application Ed25519 verifier under a narrow synthetic RTDB rule candidate.
// This is NOT a production trust boundary: a stolen SERVICE token can still
// directly write without running the verifier (expected-negative test).
import {test,before,after,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash,generateKeyPairSync,randomBytes,sign} from 'node:crypto';
import {initializeApp,deleteApp} from 'firebase-admin/app';
import {getAuth} from 'firebase-admin/auth';
import {canonicalOfflineEnvelope}
  from '../experiments/stage7-durable-ingress.mjs';
import {createVersionedEmulatorConfirmer}
  from '../experiments/versioned-confirmation-emulator.mjs';

const PROJECT='demo-r3-service-confirmation';
const AUTH='http://127.0.0.1:9099';
const RTDB='http://127.0.0.1:9000';
const NS=PROJECT+'-default-rtdb';
const ROOT='/floodguard',ID='device-stage-a';
const STAGE=ROOT+'/staging/ingestV1/'+ID;
const CONFIRM=ROOT+'/confirmedLab/records/'+ID+'/2';
const PUB=ROOT+'/publicationLab/water';
const NOW=1700000003500;
const FRAME={sequence:2,distanceCm:16.5,levelCm:8.5,risk:'WARNING'};
const DEVICE_KEY=generateKeyPairSync('ed25519');
const RECEIPT_KEY=generateKeyPairSync('ed25519');
const FP=createHash('sha256').update(DEVICE_KEY.publicKey.export({
  type:'spki',format:'der'
})).digest('hex');
const USERS={
  device:[ID,'fg_ingest_v1'],
  clientConfirmer:['confirmer-stage','fg_confirm_ingest_v1'],
  service:['service-confirm-stage','fg_server_confirm_v1'],
  attestor:['attestor-stage','fg_attest_ingest_v1'],
  publisher:['publisher-water-stage','fg_publish_water_v1'],
  ordinary:['ordinary-stage',null]
};
if(process.env.FG_R3_SERVICE_CONFIRM_TEST!=='1'||
   process.env.FG_VERSIONED_CONFIRMATION_TEST!=='1'||
   process.env.GCLOUD_PROJECT!==PROJECT||
   process.env.FIREBASE_AUTH_EMULATOR_HOST!=='127.0.0.1:9099'||
   process.env.FIREBASE_DATABASE_EMULATOR_HOST!=='127.0.0.1:9000')
  throw Error('Refusing non-local Firebase test');
let app,users,tokens;
function pathUrl(p,role){
  if(typeof p!=='string'||!(p===ROOT||p.startsWith(ROOT+'/'))||
     p.includes('..')||p.includes('?')||p.includes('#'))
    throw Error('Unsafe test-only path');
  const url=new URL(RTDB+p+'.json');
  url.searchParams.set('ns',NS);
  if(role==='__SEED_TEST_ONLY__')url.searchParams.set('access_token','owner');
  else if(role)url.searchParams.set('auth',tokens[role]);
  return url;
}
async function http(url,method='GET',body){
  const response=await fetch(url,{
    method,headers:{'content-type':'application/json'},
    ...(body===undefined?{}:{body:JSON.stringify(body)}),
    signal:AbortSignal.timeout(7000)
  });
  const text=await response.text();
  let data=null;try{data=JSON.parse(text);}catch{}
  return {status:response.status,data};
}
const req=(p,role,method='GET',body)=>http(pathUrl(p,role),method,body);
const ok=async promise=>{
  const response=await promise;
  assert.equal(response.status,200,'Test RTDB request was denied');
  return response.data;
};
const denied=async promise=>{
  const result=await promise;
  assert.ok([401,403].includes(result.status),
    'Test credential unexpectedly authorized HTTP '+result.status);
};
async function seed(p,data){await ok(req(p,'__SEED_TEST_ONLY__','PUT',data));}
async function login(role){
  const [uid,claim]=USERS[role],creds=users[role];
  const result=await http(
    AUTH+'/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-only',
    'POST',{email:creds.email,password:creds.password,returnSecureToken:true});
  assert.equal(result.status,200,'Auth Emulator sign-in failed');
  const token=result.data.idToken;
  const parsed=JSON.parse(Buffer.from(token.split('.')[1],'base64url').toString());
  assert.equal(parsed.user_id||parsed.sub,uid);
  assert.equal(parsed.aud,PROJECT);
  if(claim)assert.equal(parsed[claim],true);
  return token;
}
const evidence=(sequence=2)=>{
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
      DEVICE_KEY.privateKey).toString('base64url'),
    receiptSignature:sign(null,Buffer.from(JSON.stringify(receipt)),
      RECEIPT_KEY.privateKey).toString('base64url')
  };
};
const recordFor=x=>({
  version:'floodguard-confirmed-record-v1',epoch:1,
  sequence:x.envelope.frame.sequence,digest:x.receipt.digest,
  acceptedAtMs:x.receipt.acceptedAtMs,
  observedAtMs:x.envelope.observedAtMs,frame:x.envelope.frame
});
const serviceDatabase=()=>Object.freeze({
  ref(p) {
    // The service adapter deliberately exposes ONLY get and set of the
    // approved versioned operator/auth/staging/confirmation paths.
    if(![
      ROOT+'/confirmerLabAuthorization/confirmer-stage',
      ROOT+'/deviceAuthorization/'+ID,STAGE,
      ROOT+'/confirmedLab/records/'+ID+'/2'
    ].includes(p))throw Error('Out-of-scope service database access');
    return Object.freeze({
      async get(){
        const r=await req(p,'service');
        if(r.status!==200)throw Error('Scoped service read denied');
        return {val:()=>r.data};
      },
      async set(value){
        if(p!==CONFIRM)throw Error('Service write path denied');
        const r=await req(p,'service','PUT',value);
        if(r.status!==200)throw Error('Scoped service write refused');
      }
    });
  }
});
const confirmer=(clock=()=>NOW)=>createVersionedEmulatorConfirmer({
  database:serviceDatabase(),deviceId:ID,
  devicePublicKey:DEVICE_KEY.publicKey,
  receiptPublicKey:RECEIPT_KEY.publicKey,clock
});
before(async()=>{
  app=initializeApp({projectId:PROJECT},'floodguard-r3-service-token-demo');
  users={};
  const auth=getAuth(app);
  for(const [role,[uid,claim]] of Object.entries(USERS)){
    const email=uid+'@floodguard-lab.invalid',
      password=randomBytes(24).toString('base64url');
    await auth.createUser({uid,email,password});
    if(claim)await auth.setCustomUserClaims(uid,{[claim]:true});
    users[role]={email,password};
  }
});
after(async()=>{if(app)await deleteApp(app);});
beforeEach(async()=>{
  tokens={};
  for(const role of Object.keys(USERS))tokens[role]=await login(role);
  await seed(ROOT,{
    deviceAuthorization:{[ID]:{enabled:true,scope:'prototype-ingest-v1'}},
    confirmerLabAuthorization:{
      'confirmer-stage':{enabled:true,scope:'confirmer-ingest-v1',
        deviceId:ID,epoch:1,deviceKeyFingerprint:FP}
    },
    attestorLabAuthorization:{
      'attestor-stage':{enabled:true,scope:'attestor-ingest-v1',
        deviceId:ID,epoch:1,deviceKeyFingerprint:FP}
    },
    publisherLabAuthorization:{
      'publisher-water-stage':{enabled:true,
        scope:'publication-lab-water-v1',deviceId:ID,epoch:1}
    },
    publicationLab:{water:{
      current:{distanceCm:20,levelCm:5,status:'SAFE',
        observedAtMs:NOW-3000,overallRisk:'UNKNOWN'},
      checkpoint:{initialized:true,deviceId:ID,epoch:1,
        sequence:1,digest:'0'.repeat(64),observedAtMs:NOW-3000}
    }},
    live:{water:{status:'SAFE'},gate:{status:'CLOSED',angle:0},
      esp8266:{ip:'192.0.2.22',wifi:'PRIVATE-SYNTHETIC'}}
  });
});
test('actual signed device frame + receipt passes scoped service verifier and immutable confirmation',async()=>{
  const x=evidence();
  await ok(req(STAGE,'device','PUT',x.envelope.frame));
  const result=await confirmer()(x);
  assert.equal(result.ok,true,JSON.stringify(result));
  assert.equal(result.kind,'IMMUTABLE_EMULATOR_RECORD_ONLY');
  assert.deepEqual(await ok(req(CONFIRM,'attestor')),recordFor(x));
  assert.deepEqual(await ok(req(CONFIRM,'service')),recordFor(x));
  await denied(req(PUB+'/checkpoint',null));
  await denied(req(PUB,'service','PUT',{}));
  await denied(req(CONFIRM,'clientConfirmer','PUT',recordFor(x)));
});
test('forged device signature and forged receipt cannot invoke service DB writer',async()=>{
  const x=evidence();await ok(req(STAGE,'device','PUT',x.envelope.frame));
  for(const invalid of [
    {...x,deviceSignature:'A'.repeat(86)},
    {...x,receiptSignature:'B'.repeat(86)},
    {...x,receipt:{...x.receipt,digest:'f'.repeat(64)}},
    {...x,envelope:{...x.envelope,deviceId:'device-stage-b'}}
  ]){
    const result=await confirmer()(invalid);
    assert.equal(result.ok,false,JSON.stringify(result));
    assert.equal(await ok(req(CONFIRM,'service')),null);
  }
});
test('staged-frame mismatch, missing signer approval, or device revocation refuses confirmation',async()=>{
  const x=evidence();
  assert.equal((await confirmer()(x)).ok,false);
  await ok(req(STAGE,'device','PUT',{...FRAME,distanceCm:99}));
  assert.equal((await confirmer()(x)).ok,false);
  // A real device cannot overwrite a same-sequence frame; simulate a new
  // validated staged observation using operator-only test fixture setup.
  await seed(STAGE,FRAME);
  await seed(ROOT+'/confirmerLabAuthorization/confirmer-stage/enabled',false);
  assert.equal((await confirmer()(x)).ok,false);
  await seed(ROOT+'/confirmerLabAuthorization/confirmer-stage/enabled',true);
  await seed(ROOT+'/deviceAuthorization/'+ID+'/enabled',false);
  assert.equal((await confirmer()(x)).ok,false);
  assert.equal(await ok(req(CONFIRM,'__SEED_TEST_ONLY__')),null);
});
test('client confirmer, publisher, ordinary and anonymous tokens cannot create confirmations',async()=>{
  const x=evidence();
  await ok(req(STAGE,'device','PUT',FRAME));
  for(const role of ['clientConfirmer','publisher','ordinary','device',null])
    await denied(req(CONFIRM,role,'PUT',recordFor(x)));
  await denied(req(CONFIRM,'clientConfirmer','DELETE'));
  await denied(req(ROOT+'/confirmedLab','service','PATCH',{
    records:{[ID]:{'2':recordFor(x)}}
  }));
});
test('service token is confined to one confirmation record; publisher remains completely closed',async()=>{
  const x=evidence();
  await ok(req(STAGE,'device','PUT',FRAME));
  for(const p of [
    ROOT+'/live/gate/angle',
    ROOT+'/deviceAuthorization/'+ID+'/enabled',
    ROOT+'/publicationLab/water',
    ROOT+'/confirmedLab/records/device-stage-b/2'
  ])await denied(req(p,'service','PUT',recordFor(x)));
  for(const role of ['service','publisher','clientConfirmer'])
    await denied(req(PUB,role,'PUT',{
      current:{distanceCm:9,levelCm:2,status:'DANGER',
        observedAtMs:NOW,overallRisk:'UNKNOWN'},
      checkpoint:{initialized:true,deviceId:ID,epoch:1,sequence:2,
        digest:x.receipt.digest,observedAtMs:NOW}
    }));
});
test('EXPECTED NEGATIVE: stolen service token can bypass signing function entirely',async()=>{
  const x=evidence();
  await ok(req(STAGE,'device','PUT',FRAME));
  const forged={...recordFor(x),digest:'c'.repeat(64)};
  // The same token is accepted by RTDB Rules without calling confirmer().
  // This is a major production blocker; do NOT call this a solved boundary.
  assert.deepEqual(await ok(req(CONFIRM,'service','PUT',forged)),forged);
  assert.equal((await confirmer()(x)).ok,false);
  await denied(req(CONFIRM,'service','DELETE'));
});
test('unpublished Rules candidate changes only service confirmer read/write grants',()=>{
  const containment=JSON.parse(readFileSync(
    'docs/firebase/r3-credential-containment-lab.rules.json','utf8'));
  const candidate=JSON.parse(readFileSync(
    'docs/firebase/r3-service-confirmation-lab.rules.json','utf8'));
  const f=candidate.rules.floodguard;
  assert.equal(containment.rules.floodguard.publicationLab.water['.write'],false);
  assert.equal(f.publicationLab.water['.write'],false);
  assert.equal(f.confirmedLab.records['$deviceId']['$sequence']['.write']
    .includes("auth.uid === 'service-confirm-stage'"),true);
  assert.equal(f.confirmedLab.records['$deviceId']['$sequence']['.write']
    .includes('auth.token.fg_server_confirm_v1 === true'),true);
  assert.equal(f.confirmedLab.records['$deviceId']['$sequence']['.write']
    .includes('auth.token.fg_confirm_ingest_v1 === true'),false);
  assert.equal(containment.rules['.write'],false);
  assert.equal(f['.write'],false);
});
