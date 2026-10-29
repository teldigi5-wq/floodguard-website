// Local RTDB emulator only. These test-authenticated contexts inject MOCK
// claims and cannot establish real JWT signatures or production cloud IAM.
// This candidate fences PARTIAL subtree restores only; a coordinated backup
// restore of ALL paths including the fence still defeats these rules.
import {before,after,beforeEach,test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  initializeTestEnvironment,assertFails,assertSucceeds
} from '@firebase/rules-unit-testing';

if(process.env.FG_RESTORE_FENCE_TEST!=='1'||
   process.env.FIREBASE_DATABASE_EMULATOR_HOST!=='127.0.0.1:9000')
  throw Error('Refusing nonlocal restored authorization lab');

const ROOT='/floodguard',DEVICE='device-stage-a',OTHER='device-stage-b';
const V='ingest-verifier-stage-a',W='ingest-authority-stage-a',
  O='ingest-observer-stage-a';
const ROLE={
  [V]:['fg_ingest_verifier_v1','ingestVerifierLab',
    'prototype-signed-approval-verifier-v1'],
  [W]:['fg_ingest_authority_v1','ingestAuthorityLab',
    'prototype-signed-staging-authority-v1'],
  [O]:['fg_ingest_observer_v1','ingestObserverLab',
    'prototype-ingest-observer-v1']
};
const APPROVAL=ROOT+'/ingestApprovalLab/'+DEVICE;
const STAGE=ROOT+'/staging/ingestV1/'+DEVICE;
const fence=id=>ROOT+'/restoreFenceLab/'+id;
const session=id=>ROOT+'/sessionRevocationsLab/'+id;
const assignment=id=>ROOT+'/'+ROLE[id][1]+'/'+id;
const FRAME=Object.freeze({
  sequence:1,distanceCm:16.5,levelCm:8.5,risk:'WARNING'
});
const token=(id,{generation=4,authTime=1002}={})=>({
  [ROLE[id][0]]:true,fg_role_generation:generation,auth_time:authTime
});
const grant=({generation=4,authTime=1002}={})=>({
  ...FRAME,epoch:1,digest:'a'.repeat(64),
  issuedAtMs:Date.now(),expiresAtMs:Date.now()+10000,
  verifierAuthTime:authTime,verifierRoleGeneration:generation
});
let env;
const actor=(id,settings)=>env.authenticatedContext(id,token(id,settings)).database();
const fixture=async fn=>env.withSecurityRulesDisabled(async ctx=>fn(ctx.database()));
const elevated=async (path,value)=>fixture(d=>d.ref(path).set(value));
const observed=path=>fixture(async d=>(await d.ref(path).get()).val());
const record=(enabled=true,generation=4,revokeTime=0)=>({
  enabled,roleGeneration:generation,revokeTime
});
const roleMeta=(id,enabled=true)=>({
  enabled,scope:ROLE[id][2],deviceId:DEVICE
});
async function configure(){
  await env.clearDatabase();
  await fixture(async d=>{
    await d.ref(ROOT+'/deviceAuthorization/'+DEVICE).set({
      enabled:true,scope:'prototype-ingest-v1',epoch:1
    });
    for(const id of [V,W,O]){
      await d.ref(assignment(id)).set(roleMeta(id));
      await d.ref(session(id)).set({roleGeneration:4,revokeTime:0});
      await d.ref(fence(id)).set(record());
    }
  });
}
const approve=()=>actor(V).ref(APPROVAL).set(grant());
const stage=()=>actor(W).ref(STAGE).set(FRAME);
before(async()=>{
  env=await initializeTestEnvironment({
    projectId:'demo-partial-restore-fence',
    database:{host:'127.0.0.1',port:9000,
      rules:readFileSync('docs/firebase/phase-b-partial-restore-fence.rules.json','utf8')}
  });
});
after(async()=>{if(env)await env.cleanup();});
beforeEach(configure);

test('matching protected fences permit narrow approval staging and observer reads',async()=>{
  await assertSucceeds(approve());
  await assertSucceeds(stage());
  assert.deepEqual(await observed(STAGE),FRAME);
  assert.deepEqual((await assertSucceeds(actor(O).ref(STAGE).get())).val(),FRAME);
  await assertSucceeds(actor(O).ref(APPROVAL).get());
  for(const leaf of ['enabled','scope','epoch'])
    await assertSucceeds(actor(O).ref(ROOT+'/deviceAuthorization/'+DEVICE+'/'+leaf).get());
});

test('restore old verifier role+session while fence remains newer denies approval',async()=>{
  await elevated(assignment(V),roleMeta(V,false));
  await elevated(session(V),{roleGeneration:5,revokeTime:1002});
  await elevated(fence(V),record(false,5,1002));
  // Privileged test-only restore of just the old subtree.
  await elevated(assignment(V),roleMeta(V,true));
  await elevated(session(V),{roleGeneration:4,revokeTime:0});
  await assertFails(approve());
  assert.equal(await observed(APPROVAL),null);
});

test('restored verifier session cannot authorize staging from earlier grant',async()=>{
  await assertSucceeds(approve());
  await elevated(assignment(V),roleMeta(V,false));
  await elevated(session(V),{roleGeneration:5,revokeTime:1002});
  await elevated(fence(V),record(false,5,1002));
  await elevated(assignment(V),roleMeta(V,true));
  await elevated(session(V),{roleGeneration:4,revokeTime:0});
  await assertFails(stage());
  assert.equal(await observed(STAGE),null);
});

test('stager role and session rollback cannot bypass independent local fence',async()=>{
  await assertSucceeds(approve());
  await elevated(fence(W),record(false,5,1002));
  await elevated(session(W),{roleGeneration:5,revokeTime:1002});
  await elevated(assignment(W),roleMeta(W,false));
  await elevated(assignment(W),roleMeta(W,true));
  await elevated(session(W),{roleGeneration:4,revokeTime:0});
  await assertFails(stage());
});

test('observer rollback cannot regain narrow read permissions',async()=>{
  await assertSucceeds(approve());
  await elevated(fence(O),record(false,5,1002));
  await elevated(session(O),{roleGeneration:5,revokeTime:1002});
  await elevated(assignment(O),roleMeta(O,false));
  await elevated(assignment(O),roleMeta(O,true));
  await elevated(session(O),{roleGeneration:4,revokeTime:0});
  await assertFails(actor(O).ref(APPROVAL).get());
  await assertFails(actor(O).ref(ROOT+'/deviceAuthorization/'+DEVICE+'/enabled').get());
});

test('fence fails closed when absent or when cutoff differs despite matching generation',async()=>{
  await elevated(fence(V),null);
  await assertFails(approve());
  await elevated(fence(V),record(true,4,2));
  await assertFails(approve());
  await elevated(fence(V),record(true,5,0));
  await assertFails(approve());
});

test('disabled fence refuses permissions even if Auth mock token is valid',async()=>{
  await elevated(fence(V),record(false,4,0));
  await assertFails(approve());
  await elevated(fence(V),record());
  await assertSucceeds(approve());
  await elevated(fence(W),record(false,4,0));
  await assertFails(stage());
});

test('fresh role generation only works after explicit aligned authorization fixture',async()=>{
  await elevated(fence(V),record(true,5,1002));
  await elevated(session(V),{roleGeneration:5,revokeTime:1002});
  await assertFails(approve());
  await assertSucceeds(actor(V,{generation:5,authTime:1003})
    .ref(APPROVAL).set(grant({generation:5,authTime:1003})));
  await assertSucceeds(stage());
  assert.deepEqual(await observed(STAGE),FRAME);
});

test('session generation and cutoff must BOTH exactly match fence',async()=>{
  await elevated(fence(V),record(true,5,1002));
  await elevated(session(V),{roleGeneration:5,revokeTime:1001});
  await assertFails(actor(V,{generation:5,authTime:1003})
    .ref(APPROVAL).set(grant({generation:5,authTime:1003})));
  await elevated(session(V),{roleGeneration:4,revokeTime:1002});
  await assertFails(approve());
});

test('all three roles and ordinary device cannot read or modify protected fence',async()=>{
  for(const d of [
    actor(V),actor(W),actor(O),env.authenticatedContext(DEVICE,{fg_ingest_v1:true}).database(),
    env.unauthenticatedContext().database()
  ]){
    for(const id of [V,W,O]){
      await assertFails(d.ref(fence(id)).get());
      await assertFails(d.ref(fence(id)+'/roleGeneration').set(4));
      await assertFails(d.ref(fence(id)+'/enabled').set(true));
    }
  }
});

test('other-device parent paths and public telemetry remain unwritable',async()=>{
  for(const d of [actor(V),actor(W),actor(O)]){
    await assertFails(d.ref(ROOT+'/ingestApprovalLab/'+OTHER).set(grant()));
    await assertFails(d.ref(ROOT+'/staging/ingestV1/'+OTHER).set(FRAME));
    await assertFails(d.ref(ROOT+'/live/water/levelCm').set(2));
    await assertFails(d.ref(ROOT+'/live/gate/status').set('OPEN'));
  }
});

test('coordinated full restore of fence AND role/session can revive old authorization: OPEN THREAT',async()=>{
  // Deliberate negative test. Protected mirror is in SAME RTDB; an operator
  // restoring the full database to a valid old snapshot can defeat it.
  await elevated(fence(V),record(false,5,1002));
  await elevated(session(V),{roleGeneration:5,revokeTime:1002});
  await elevated(assignment(V),roleMeta(V,false));
  await assertFails(approve());
  await elevated(fence(V),record(true,4,0));
  await elevated(session(V),{roleGeneration:4,revokeTime:0});
  await elevated(assignment(V),roleMeta(V,true));
  await assertSucceeds(approve());
  assert.equal((await observed(APPROVAL)).sequence,1);
});
