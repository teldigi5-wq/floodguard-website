// Auth + RTDB EMULATOR integration using actual locally issued ID tokens.
// No real Firebase projects, passwords, credentials, or service endpoints.
// Admin SDK is restricted to Auth emulator user/claim setup. RTDB fixture
// writes use the emulator's documented TEST-ONLY "owner" bypass.
import {before,after,beforeEach,test} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {initializeApp,deleteApp} from 'firebase-admin/app';
import {getAuth} from 'firebase-admin/auth';
import {createOfflineRoleRevocationCoordinator}
  from '../experiments/offline-role-revocation-coordinator.mjs';
import {createOfflineRevocationWitness}
  from '../experiments/offline-revocation-highwater.mjs';

const PROJECT='demo-fg-auth-lifecycle';
const AUTH='http://127.0.0.1:9099';
const RTDB='http://127.0.0.1:9000';
const NS=PROJECT+'-default-rtdb';
const ROOT='/floodguard',DEVICE='device-stage-a';
const V='ingest-verifier-stage-a',W='ingest-authority-stage-a',O='ingest-observer-stage-a';
const ROLES=[[V,'fg_ingest_verifier_v1'],[W,'fg_ingest_authority_v1'],[O,'fg_ingest_observer_v1']];
const APPROVAL=ROOT+'/ingestApprovalLab/'+DEVICE,STAGE=ROOT+'/staging/ingestV1/'+DEVICE;
const SESSION=id=>ROOT+'/sessionRevocationsLab/'+id;
const GENERATION=4;
if(process.env.FG_REAL_AUTH_LIFECYCLE_TEST!=='1'||
   process.env.FIREBASE_AUTH_EMULATOR_HOST!=='127.0.0.1:9099'||
   process.env.FIREBASE_DATABASE_EMULATOR_HOST!=='127.0.0.1:9000'||
   process.env.GCLOUD_PROJECT!==PROJECT)
  throw Error('Refusing any execution outside the two local demo emulators');
let app,admin,secrets,sessions;
const http=async(url,method='GET',payload)=>{
  const res=await fetch(url,{method,headers:{'content-type':'application/json'},
    ...(payload===undefined?{}:{body:JSON.stringify(payload)}),
    signal:AbortSignal.timeout(5000)});
  const raw=await res.text();let value;
  try{value=JSON.parse(raw);}catch{value=raw;}
  return {status:res.status,value};
};
const url=(path,token)=>{
  if(!path.startsWith(ROOT+'/'))throw Error('Outside synthetic database root');
  const u=new URL(RTDB+path+'.json');
  u.searchParams.set('ns',NS);
  // The RTDB emulator's special owner bypass is an OAuth-style
  // access_token query, NOT an ordinary Firebase ID token 'auth' query.
  // Keep this capability out of all client requests.
  if(token==='owner')u.searchParams.set('access_token','owner');
  else u.searchParams.set('auth',token);
  return u;
};
const seed=async(path,value)=>{
  const response=await http(url(path,'owner'),'PUT',value);
  assert.equal(response.status,200,'emulator owner fixture failed');
};
const set=async(path,token,value)=>http(url(path,token),'PUT',value);
const get=async(path,token)=>http(url(path,token));
const denied=async(p)=>assert.ok([401,403].includes(p.status),JSON.stringify(p).slice(0,150));
const claims=(role,gen=GENERATION)=>({[role]:true,fg_role_generation:gen});
const decode=t=>JSON.parse(Buffer.from(t.split('.')[1],'base64url').toString());
async function signin(id){
  const result=await http(AUTH+'/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-only','POST',{
    email:secrets[id].email,password:secrets[id].password,returnSecureToken:true
  });
  assert.equal(result.status,200,'Auth Emulator issued no ID token');
  const token=result.value.idToken,payload=decode(token);
  assert.equal(payload.user_id||payload.sub,id);
  assert.equal(payload.aud,PROJECT);
  assert.ok(Number.isSafeInteger(payload.auth_time)&&payload.auth_time>0);
  return {token,payload};
}
const frame={sequence:1,distanceCm:16.5,levelCm:8.5,risk:'WARNING'};
const approval=(v)=>({
  ...frame,epoch:1,digest:'a'.repeat(64),
  issuedAtMs:Date.now(),expiresAtMs:Date.now()+10000,
  verifierAuthTime:v.payload.auth_time,
  verifierRoleGeneration:v.payload.fg_role_generation
});
before(async()=>{
  app=initializeApp({projectId:PROJECT},'floodguard-isolated-auth');
  admin=getAuth(app);secrets={};
  for(const id of [...ROLES.map(a=>a[0]),DEVICE]){
    const email=id+'@floodguard-lab.invalid',password=randomBytes(24).toString('base64url');
    secrets[id]={email,password};
    await admin.createUser({uid:id,email,password});
  }
});
after(async()=>{if(app)await deleteApp(app);});
beforeEach(async()=>{
  for(const [id,role] of ROLES)
    await admin.setCustomUserClaims(id,claims(role));
  await seed(ROOT+'/deviceAuthorization',{[DEVICE]:{
    enabled:true,scope:'prototype-ingest-v1',epoch:1
  }});
  await seed(ROOT+'/ingestVerifierLab',{[V]:{
    enabled:true,scope:'prototype-signed-approval-verifier-v1',deviceId:DEVICE
  }});
  await seed(ROOT+'/ingestAuthorityLab',{[W]:{
    enabled:true,scope:'prototype-signed-staging-authority-v1',deviceId:DEVICE
  }});
  await seed(ROOT+'/ingestObserverLab',{[O]:{
    enabled:true,scope:'prototype-ingest-observer-v1',deviceId:DEVICE
  }});
  await seed(ROOT+'/sessionRevocationsLab',Object.fromEntries(ROLES.map(([id])=>
    [id,{revokeTime:0,roleGeneration:GENERATION}])));
  await seed(APPROVAL,null);await seed(STAGE,null);
  sessions={};
  for(const [id] of ROLES)sessions[id]=await signin(id);
  sessions[DEVICE]=await signin(DEVICE);
});
test('Auth emulator tokens enforce approval, narrow write and read-only observer',async()=>{
  const v=sessions[V],w=sessions[W],o=sessions[O],d=sessions[DEVICE];
  assert.equal(v.payload.fg_ingest_verifier_v1,true);
  assert.equal(w.payload.fg_ingest_authority_v1,true);
  assert.equal(o.payload.fg_ingest_observer_v1,true);
  await denied(await set(STAGE,d.token,frame));
  await denied(await set(STAGE,w.token,frame));
  await denied(await set(APPROVAL,w.token,approval(v)));
  assert.equal((await set(APPROVAL,v.token,approval(v))).status,200);
  assert.equal((await set(STAGE,w.token,frame)).status,200);
  assert.deepEqual((await get(STAGE,o.token)).value,frame);
  await denied(await get(STAGE,w.token));
  await denied(await get(APPROVAL,v.token));
});
test('verifier cutoff revokes prior Auth token and invalidates its existing grant',async()=>{
  const v=sessions[V],w=sessions[W];
  assert.equal((await set(APPROVAL,v.token,approval(v))).status,200);
  await seed(SESSION(V)+'/revokeTime',v.payload.auth_time);
  await denied(await set(APPROVAL,v.token,approval(v)));
  await denied(await set(STAGE,w.token,frame));
  assert.equal((await get(STAGE,'owner')).value,null);
});
test('role-generation rollover requires newly issued emulator token',async()=>{
  const v=sessions[V],w=sessions[W];
  await seed(SESSION(V)+'/roleGeneration',GENERATION+1);
  await denied(await set(APPROVAL,v.token,approval(v)));
  await admin.setCustomUserClaims(V,claims('fg_ingest_verifier_v1',GENERATION+1));
  const fresh=await signin(V);
  assert.equal(fresh.payload.fg_role_generation,GENERATION+1);
  assert.equal((await set(APPROVAL,fresh.token,approval(fresh))).status,200);
  assert.equal((await set(STAGE,w.token,frame)).status,200);
});
test('staging token can be revoked independently without erasing approval',async()=>{
  const v=sessions[V],w=sessions[W];
  assert.equal((await set(APPROVAL,v.token,approval(v))).status,200);
  await seed(SESSION(W)+'/revokeTime',w.payload.auth_time);
  await denied(await set(STAGE,w.token,frame));
  assert.equal((await get(APPROVAL,'owner')).value.sequence,1);
});
test('observer cutoff removes narrow read privileges only',async()=>{
  const v=sessions[V],w=sessions[W],o=sessions[O];
  assert.equal((await set(APPROVAL,v.token,approval(v))).status,200);
  await seed(SESSION(O)+'/revokeTime',o.payload.auth_time);
  await denied(await get(APPROVAL,o.token));
  await denied(await get(ROOT+'/deviceAuthorization/'+DEVICE+'/enabled',o.token));
  assert.equal((await set(STAGE,w.token,frame)).status,200);
});
test('actual issued principals cannot mutate protected session or gate paths',async()=>{
  for(const [id] of ROLES){
    const t=sessions[id].token;
    await denied(await set(SESSION(id)+'/roleGeneration',t,100));
    await denied(await set(ROOT+'/live/gate/status',t,'OPEN'));
    await denied(await set(ROOT+'/live/water/status',t,'SAFE'));
    await denied(await get(SESSION(id),t));
  }
});
test('claim changes never alter the already issued JWT payload',async()=>{
  const old=sessions[V].token;
  assert.equal(decode(old).fg_role_generation,GENERATION);
  await admin.setCustomUserClaims(V,claims('fg_ingest_verifier_v1',GENERATION+1));
  assert.equal(decode(old).fg_role_generation,GENERATION);
  const next=await signin(V);
  assert.equal(next.payload.fg_role_generation,GENERATION+1);
});

const etagRead=async path=>{
  const result=await fetch(url(path,'owner'),{
    headers:{'X-Firebase-ETag':'true'},
    signal:AbortSignal.timeout(5000)
  });
  if(result.status!==200)throw Error('emulator ETag read failed');
  const tag=result.headers.get('etag');
  if(!tag)throw Error('missing emulator ETag');
  return {value:await result.json(),etag:tag};
};
const conditionalPut=async(path,etag,value)=>{
  const res=await fetch(url(path,'owner'),{
    method:'PUT',headers:{'if-match':etag,'content-type':'application/json'},
    body:JSON.stringify(value),signal:AbortSignal.timeout(5000)
  });
  if(res.status===412)return false;
  if(res.status!==200)throw Error('conditional emulator write uncertain');
  return true;
};
function verifierRevocationStore(){
  const rolePath=ROOT+'/ingestVerifierLab/'+V;
  const sessionPath=SESSION(V);
  const read=async()=>{
    const [r,m]=await Promise.all([
      get(rolePath,'owner'),get(sessionPath,'owner')
    ]);
    if(r.status!==200||m.status!==200||!r.value||!m.value)
      throw Error('operator role evidence unavailable');
    return {
      enabled:r.value.enabled,roleGeneration:m.value.roleGeneration,
      revokeTime:m.value.revokeTime
    };
  };
  return Object.freeze({
    read,
    async disableRoleCAS(uid,expected){
      if(uid!==V)return false;
      const [s,{value,etag}]=await Promise.all([
        read(),etagRead(rolePath)
      ]);
      if(!s.enabled||s.roleGeneration!==expected||
         value?.enabled!==true||
         value?.scope!=='prototype-signed-approval-verifier-v1'||
         value?.deviceId!==DEVICE)return false;
      return conditionalPut(rolePath,etag,{...value,enabled:false});
    },
    async advanceSessionCAS(uid,{expectedGeneration,cutoffSeconds,nextGeneration}){
      if(uid!==V)return false;
      const [s,{value,etag}]=await Promise.all([
        read(),etagRead(sessionPath)
      ]);
      if(s.enabled||s.roleGeneration!==expectedGeneration||
         value?.roleGeneration!==expectedGeneration||
         !Number.isSafeInteger(cutoffSeconds)||
         cutoffSeconds<value.revokeTime||
         nextGeneration!==expectedGeneration+1)return false;
      return conditionalPut(sessionPath,etag,{
        ...value,revokeTime:cutoffSeconds,roleGeneration:nextGeneration
      });
    }
  });
}
const coordinator=(store=verifierRevocationStore(),gateway=Object.freeze({
  revokeRefreshTokens:uid=>admin.revokeRefreshTokens(uid),
  getUser:uid=>admin.getUser(uid)
}))=>createOfflineRoleRevocationCoordinator({
  uid:V,roleStore:store,auth:gateway,clock:()=>Date.now()
});

test('Auth Emulator coordinator disables role before refresh revoke and cutoff commit',async()=>{
  const old=sessions[V],w=sessions[W];
  assert.equal((await set(APPROVAL,old.token,approval(old))).status,200);
  const output=await coordinator().revoke({expectedGeneration:GENERATION});
  assert.equal(output.completed,true,
    'Auth Emulator must expose a verifiable tokensValidAfterTime after revoke');
  assert.equal(output.roleDisabled,true);
  assert.equal(output.roleGeneration,GENERATION+1);
  const role=(await get(ROOT+'/ingestVerifierLab/'+V,'owner')).value;
  const session=(await get(SESSION(V),'owner')).value;
  assert.equal(role.enabled,false);
  assert.equal(session.revokeTime,output.revokeTime);
  assert.equal(session.roleGeneration,GENERATION+1);
  await denied(await set(APPROVAL,old.token,approval(old)));
  await denied(await set(STAGE,w.token,frame));
  // A fresh sign-in is NOT sufficient; the role is still disabled and
  // needs separately authorized operator re-enablement (not done here).
  const fresh=await signin(V);
  await denied(await set(APPROVAL,fresh.token,approval(fresh)));
});

test('crash after disable leaves real Auth token unable to grant and allows explicit resume',async()=>{
  const old=sessions[V];
  const crashing=Object.freeze({
    async revokeRefreshTokens(){throw Error('SIMULATED_AUTH_TIMEOUT');},
    getUser:uid=>admin.getUser(uid)
  });
  const first=await coordinator(verifierRevocationStore(),crashing)
    .revoke({expectedGeneration:GENERATION});
  assert.equal(first.step,'auth-revocation-uncertain');
  assert.equal(first.completed,false);
  assert.equal((await get(ROOT+'/ingestVerifierLab/'+V,'owner')).value.enabled,false);
  await denied(await set(APPROVAL,old.token,approval(old)));
  const completed=await coordinator().revoke({
    expectedGeneration:GENERATION,resumeDisabled:true
  });
  assert.equal(completed.completed,true);
  assert.equal(completed.roleDisabled,true);
  await denied(await set(APPROVAL,old.token,approval(old)));
});

test('independently sealed checkpoint detects emulator RTDB backup restoring old role',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'fg-db-restore-check-'));
  try{
    const witness=createOfflineRevocationWitness({
      directory:dir,integrityKey:randomBytes(32)
    });
    witness.bootstrap({uid:V,roleGeneration:GENERATION,revokeTime:0});
    const actor=createOfflineRoleRevocationCoordinator({
      uid:V,roleStore:verifierRevocationStore(),
      auth:Object.freeze({
        revokeRefreshTokens:id=>admin.revokeRefreshTokens(id),
        getUser:id=>admin.getUser(id)
      }),
      clock:()=>Date.now(),independentWitness:witness
    });
    const first=await actor.revoke({expectedGeneration:GENERATION});
    assert.equal(first.completed,true);
    assert.equal(witness.snapshot(V).roleGeneration,GENERATION+1);
    // Simulate a privileged emulator-side backup restoration of ONLY
    // the RTDB authorization/session state. The independent filesystem
    // witness remains forward-only, and coordinator refuses to touch Auth.
    await seed(ROOT+'/ingestVerifierLab/'+V,{
      enabled:true,scope:'prototype-signed-approval-verifier-v1',
      deviceId:DEVICE
    });
    await seed(SESSION(V),{revokeTime:0,roleGeneration:GENERATION});
    const blocked=await actor.revoke({expectedGeneration:GENERATION});
    assert.equal(blocked.completed,false);
    assert.equal(blocked.step,'independent-checkpoint-mismatch');
    assert.equal(witness.snapshot(V).roleGeneration,GENERATION+1);
    // CRITICAL: RTDB Rules do NOT consult this separate filesystem file.
    // This test asserts only that the coordinator detects rollback, NOT
    // that restored RTDB permissions automatically reject client tokens.
  }finally{rmSync(dir,{recursive:true,force:true});}
});
