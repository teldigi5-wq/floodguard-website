// R3 Auth + RTDB REAL Emulator incident fence; synthetic identities/data only.
// Never run against production Firebase, field devices, hardware or public listeners.
import test,{before,after,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {initializeApp,deleteApp} from 'firebase-admin/app';
import {getAuth} from 'firebase-admin/auth';

const PROJECT='demo-r3-attestor-incident-fence';
const AUTH='http://127.0.0.1:9099';
const DB='http://127.0.0.1:9000';
const NS=PROJECT+'-default-rtdb';
const ROOT='/floodguard',ID='device-stage-a',REC=ROOT+'/confirmedLab/records/'+ID+'/2';
const TOKEN_ROLES={attestor:{uid:'attestor-stage',claim:'fg_attest_ingest_v1'},
 ordinary:{uid:'ordinary-stage',claim:null}};
if(process.env.FG_R3_INCIDENT_FENCE_TEST!=='1'||
 process.env.GCLOUD_PROJECT!==PROJECT||
 process.env.FIREBASE_AUTH_EMULATOR_HOST!=='127.0.0.1:9099'||
 process.env.FIREBASE_DATABASE_EMULATOR_HOST!=='127.0.0.1:9000')
 throw Error('Refusing unpinned demo-project Auth+RTDB Emulator test');

let app,auth,creds,tokens;
function url(path,identity){
 if(typeof path!=='string'||!path.startsWith(ROOT+'/')||/[?#]/.test(path)||
  path.includes('..')||path.includes('//'))throw Error('Unsafe local fixture path');
 const u=new URL(DB+path+'.json');
 u.searchParams.set('ns',NS);
 if(identity==='__EMULATOR_OWNER_ONLY__')u.searchParams.set('access_token','owner');
 else if(identity)u.searchParams.set('auth',tokens[identity]);
 return u;
}
async function req(path,who,method='GET',body){
 const response=await fetch(url(path,who),{
  method,headers:{'content-type':'application/json'},redirect:'manual',
  ...(body===undefined?{}:{body:JSON.stringify(body)}),
  signal:AbortSignal.timeout(7000)});
 let value=null;
 try {value=await response.json();}catch {}
 return {status:response.status,value};
}
const admin=(path,method='GET',body)=>req(path,'__EMULATOR_OWNER_ONLY__',method,body);
async function seed(){
 const fixture={
  serviceWorkerAuthorization:{'service-confirm-stage':{enabled:true,generation:1}},
  deviceAuthorization:{[ID]:{enabled:true,scope:'prototype-ingest-v1'}},
  attestorLabAuthorization:{'attestor-stage':{
   enabled:true,scope:'attestor-ingest-v1',deviceId:ID,epoch:1}},
  confirmerLabAuthorization:{'confirmer-stage':{
   enabled:true,scope:'confirmer-ingest-v1',deviceId:ID,epoch:1}},
  staging:{ingestV1:{[ID]:{
   sequence:2,distanceCm:16.5,levelCm:8.5,risk:'WARNING'}}},
  confirmedLab:{records:{[ID]:{'2':{
   version:'floodguard-confirmed-record-v1',epoch:1,sequence:2,
   digest:'a'.repeat(64),acceptedAtMs:1700000003400,
   observedAtMs:1700000003100,
   frame:{sequence:2,distanceCm:16.5,levelCm:8.5,risk:'WARNING'}
  }}}},
  live:{water:{status:'WARNING'},gate:{status:'CLOSED',angle:0},
   esp8266:{ip:'192.0.2.90',wifi:'SYNTHETIC_PRIVATE'}}
 };
 assert.equal((await admin(ROOT+'/serviceWorkerAuthorization','PUT',
  fixture.serviceWorkerAuthorization)).status,200);
 // root fixture seeding is owner-only and cannot be used by any role token
 const rootUrl=new URL(DB+ROOT+'.json');
 rootUrl.searchParams.set('ns',NS);
 rootUrl.searchParams.set('access_token','owner');
 const res=await fetch(rootUrl,{method:'PUT',
  headers:{'content-type':'application/json'},
  body:JSON.stringify(fixture),signal:AbortSignal.timeout(7000)});
 assert.equal(res.status,200);
}
const denied=(r)=>assert.ok([401,403].includes(r.status),
 'Unexpected authorization decision HTTP '+r.status);
async function login(role){
 const {uid}=TOKEN_ROLES[role],c=creds[role];
 const res=await fetch(AUTH+'/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-only',{
  method:'POST',headers:{'content-type':'application/json'},
  body:JSON.stringify({email:c.email,password:c.password,returnSecureToken:true}),
  signal:AbortSignal.timeout(7000)});
 assert.equal(res.status,200,'Synthetic user sign-in failed');
 const token=(await res.json()).idToken;
 const payload=JSON.parse(Buffer.from(token.split('.')[1],'base64url').toString('utf8'));
 assert.equal(payload.user_id||payload.sub,uid);
 assert.equal(payload.aud,PROJECT);
 if(role==='attestor')assert.equal(payload.fg_attest_ingest_v1,true);
 else assert.ok(!payload.fg_attest_ingest_v1);
 return token;
}
before(async()=>{
 app=initializeApp({projectId:PROJECT},'r3-incident-fence-lab');
 auth=getAuth(app);
 creds={};
 for(const [role,{uid,claim}] of Object.entries(TOKEN_ROLES)){
  const email=uid+'@floodguard-lab.invalid';
  const password=randomBytes(32).toString('base64url');
  await auth.createUser({uid,email,password});
  if(claim)await auth.setCustomUserClaims(uid,{[claim]:true});
  creds[role]={email,password};
 }
});
after(async()=>{if(app)await deleteApp(app);});
beforeEach(async()=>{
 tokens={attestor:await login('attestor'),ordinary:await login('ordinary')};
 await seed();
});
const ACCESS=[
 ROOT+'/attestorLabAuthorization/attestor-stage',
 ROOT+'/deviceAuthorization/'+ID,
 ROOT+'/staging/ingestV1/'+ID,
 REC
];
test('valid independent Auth Emulator attestor can read four exact scoped resources before incident',async()=>{
 for(const path of ACCESS){
  const r=await req(path,'attestor');
  assert.equal(r.status,200,'Attestor scoped read denied: '+path);
  assert.notEqual(r.value,null);
 }
 await denied(await req(ROOT+'/live/esp8266/ip','attestor'));
 await denied(await req(ROOT+'/live/esp8266','attestor'));
});
test('service incident revocation immediately fences future read-only attestation input',async()=>{
 for(const path of ACCESS)assert.equal((await req(path,'attestor')).status,200);
 assert.equal((await admin(ROOT+'/serviceWorkerAuthorization/service-confirm-stage/enabled','PUT',false)).status,200);
 for(const path of ACCESS)denied(await req(path,'attestor'));
 // Immutable historical confirmation remains stored, but cannot be read
 // by the attestor after the current service incident fence is disabled.
 const historical=await admin(REC);
 assert.equal(historical.status,200);
 assert.equal(historical.value.sequence,2);
 await denied(await req(REC,'ordinary'));
});
test('service incident fence cannot be changed by ordinary, attestor or anonymous clients',async()=>{
 for(const actor of ['attestor','ordinary',null]){
  denied(await req(ROOT+'/serviceWorkerAuthorization/service-confirm-stage/enabled',
   actor,'PUT',false));
  denied(await req(REC,actor,'PUT',{sequence:2}));
  denied(await req(ROOT+'/live/gate/angle',actor,'PUT',90));
 }
 assert.equal((await req(REC,'attestor')).status,200);
});
test('operator re-enable can resume historical read: durable quarantine and prior attestations remain open risks',async()=>{
 await admin(ROOT+'/serviceWorkerAuthorization/service-confirm-stage/enabled','PUT',false);
 denied(await req(REC,'attestor'));
 await admin(ROOT+'/serviceWorkerAuthorization/service-confirm-stage/enabled','PUT',true);
 assert.equal((await req(REC,'attestor')).status,200);
 // This intentionally demonstrates a residual incident-policy flaw:
 // the flag is operator-controlled but not an independent monotonic witness.
});
test('unrelated public-read behavior and private ESP protections remain intact',async()=>{
 assert.equal((await req(ROOT+'/live/water',null)).status,200);
 await denied(await req(ROOT+'/live/esp8266/ip',null));
 await denied(await req(ROOT+'/live/esp8266/wifi',null));
 await denied(await req(ROOT+'/live',null));
});
test('exactly four attestor read expressions changed; no write or validation rules changed',()=>{
 const original=JSON.parse(readFileSync(
  'docs/firebase/r3-service-session-fence-lab.rules.json','utf8'));
 const proposal=JSON.parse(readFileSync(
  'docs/firebase/r3-attestor-service-incident-fence-lab.rules.json','utf8'));
 const a=original.rules.floodguard,b=proposal.rules.floodguard;
 const positions=[
  ['attestorAuth',a.attestorLabAuthorization['attestor-stage'],
   b.attestorLabAuthorization['attestor-stage']],
  ['device',a.deviceAuthorization['$deviceId'],b.deviceAuthorization['$deviceId']],
  ['staging',a.staging.ingestV1['$deviceId'],b.staging.ingestV1['$deviceId']],
  ['confirmed',a.confirmedLab.records['$deviceId']['$sequence'],
   b.confirmedLab.records['$deviceId']['$sequence']]
 ];
 const match="auth.uid === 'attestor-stage' && auth.token.fg_attest_ingest_v1 === true";
 const condition=" && root.child('floodguard/serviceWorkerAuthorization/service-confirm-stage/enabled').val() === true";
 for(const [name,prev,next] of positions){
  assert.equal(next['.read'],prev['.read'].replace(match,match+condition),name);
  assert.notEqual(next['.read'],prev['.read']);
  // Remove the scoped modifications to prove the entire remaining RTDB
  // Rules document is EXACTLY unchanged, including all private paths.
  next['.read']=prev['.read'];
 }
 assert.deepEqual(proposal,original);
});
