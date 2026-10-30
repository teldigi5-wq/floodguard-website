// Isolated RTDB rules-unit-testing only. Auth principals and JWT claims
// are SIMULATED: no Firebase Auth token issuance, cryptographic JWT
// signature validation, Admin credentials, or real Firebase project.
import {test,before,after,beforeEach,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash,generateKeyPairSync,randomBytes,sign} from 'node:crypto';
import {initializeTestEnvironment,assertFails,assertSucceeds} from '@firebase/rules-unit-testing';
import {createStage7OfflineLedger,canonicalOfflineEnvelope}
  from '../experiments/stage7-durable-ingress.mjs';
import {createOperatorDeviceRegistryLab} from '../experiments/operator-device-registry-lab.mjs';
import {createSignedStagingApprovalEmulator}
  from '../experiments/signed-staging-approval-emulator.mjs';
import {createSignedStagingEmulatorWriter}
  from '../experiments/signed-staging-emulator-writer.mjs';

if(process.env.FG_SESSION_REVOCATION_TEST!=='1'||
   process.env.FG_DUAL_AUTHORITY_TEST!=='1'||
   process.env.FG_SIGNED_STAGING_BRIDGE_TEST!=='1'||
   process.env.FIREBASE_DATABASE_EMULATOR_HOST!=='127.0.0.1:9000')
  throw Error('Session revocation tests only run with local isolated RTDB emulator');

const root='/floodguard',deviceId='device-stage-a',other='device-stage-b';
const verifierId='ingest-verifier-stage-a';
const stageId='ingest-authority-stage-a';
const observerId='ingest-observer-stage-a';
const grantPath=root+'/ingestApprovalLab/'+deviceId;
const stagePath=root+'/staging/ingestV1/'+deviceId;
const sessionPath=id=>root+'/sessionRevocationsLab/'+id;
const baseAuthTime=1002,initialRevokeTime=1000,roleGeneration=3;
const key=generateKeyPairSync('ed25519');
const issuer=generateKeyPairSync('ed25519');
const keyFingerprint=createHash('sha256')
  .update(key.publicKey.export({format:'der',type:'spki'})).digest('hex');
const frame=sequence=>({
  sequence,distanceCm:16.5,levelCm:8.5,risk:'WARNING'
});
let env,directory,operator,ledger,now;
const admin=async fn=>{
  let answer;
  await env.withSecurityRulesDisabled(async ctx=>{answer=await fn(ctx.database());});
  return answer;
};
const read=path=>admin(async d=>(await d.ref(path).get()).val());
const db=(id,claims={})=>env.authenticatedContext(id,claims).database();
const roleClaims=(role,authTime=baseAuthTime,generation=roleGeneration)=>({
  [role]:true,auth_time:authTime,fg_role_generation:generation
});
const verifier=(authTime=baseAuthTime,generation=roleGeneration)=>
  db(verifierId,roleClaims('fg_ingest_verifier_v1',authTime,generation));
const writer=(authTime=baseAuthTime,generation=roleGeneration)=>
  db(stageId,roleClaims('fg_ingest_authority_v1',authTime,generation));
const observer=(authTime=baseAuthTime,generation=roleGeneration)=>
  db(observerId,roleClaims('fg_ingest_observer_v1',authTime,generation));
const makeVerifier=(database=verifier(),authTime=baseAuthTime,generation=roleGeneration)=>
  createSignedStagingApprovalEmulator({
    database,deviceId,operatorRegistry:operator,replayLedger:ledger,
    receiptIssuerPublicKey:issuer.publicKey,clock:()=>now,
    verifierAuthTime:authTime,verifierRoleGeneration:generation
  });
const makeWriter=(database=writer())=>
  createSignedStagingEmulatorWriter({
    database,deviceId,operatorRegistry:operator,replayLedger:ledger,
    receiptIssuerPublicKey:issuer.publicKey,clock:()=>now
  });
function signed(sequence=1){
  const envelope={
    version:'floodguard-offline-envelope-v1',deviceId,epoch:1,
    observedAtMs:now-400,frame:frame(sequence)
  };
  const canonical=canonicalOfflineEnvelope(envelope);
  const receipt={
    version:'floodguard-offline-receipt-v1',deviceId,epoch:1,sequence,
    digest:createHash('sha256').update(canonical).digest('hex'),
    acceptedAtMs:now-100
  };
  return {
    envelope,receipt,
    deviceSignature:sign(null,Buffer.from(canonical),key.privateKey).toString('base64url'),
    receiptSignature:sign(null,Buffer.from(JSON.stringify(receipt)),
      issuer.privateKey).toString('base64url')
  };
}
const grant=({authTime=baseAuthTime,generation=roleGeneration,sequence=1}={})=>({
  ...frame(sequence),epoch:1,digest:signed(sequence).receipt.digest,
  issuedAtMs:now,expiresAtMs:now+10000,
  verifierAuthTime:authTime,verifierRoleGeneration:generation
});
before(async()=>{
  env=await initializeTestEnvironment({
    projectId:'demo-fg-session-revocation',
    database:{
      host:'127.0.0.1',port:9000,
      rules:readFileSync('docs/firebase/phase-b-session-revocation.rules.json','utf8')
    }
  });
});
after(async()=>{if(env)await env.cleanup();});
beforeEach(async()=>{
  now=Date.now();
  directory=mkdtempSync(join(tmpdir(),'fg-role-sessions-'));
  operator=createOperatorDeviceRegistryLab({
    directory,integrityKey:randomBytes(32)
  });
  operator.commission();operator.enroll(deviceId,key.publicKey);
  ledger=createStage7OfflineLedger({directory,integrityKey:randomBytes(32)});
  assert.equal(ledger.commit({
    uid:deviceId,epoch:1,sequence:1,keyFingerprint
  }).accepted,true);
  await env.clearDatabase();
  await admin(async d=>{
    await d.ref(root+'/deviceAuthorization').set({
      [deviceId]:{enabled:true,scope:'prototype-ingest-v1',epoch:1},
      [other]:{enabled:true,scope:'prototype-ingest-v1',epoch:1}
    });
    await d.ref(root+'/ingestVerifierLab').set({
      [verifierId]:{enabled:true,scope:'prototype-signed-approval-verifier-v1',
        deviceId}
    });
    await d.ref(root+'/ingestAuthorityLab').set({
      [stageId]:{enabled:true,scope:'prototype-signed-staging-authority-v1',
        deviceId}
    });
    await d.ref(root+'/ingestObserverLab').set({
      [observerId]:{enabled:true,scope:'prototype-ingest-observer-v1',
        deviceId}
    });
    await d.ref(root+'/sessionRevocationsLab').set(
      Object.fromEntries([verifierId,stageId,observerId].map(id=>[
        id,{revokeTime:initialRevokeTime,roleGeneration}
      ]))
    );
  });
});
afterEach(()=>{if(directory)rmSync(directory,{recursive:true,force:true});directory=undefined;});

test('valid mock role sessions permit an evidence-bound approval followed by exact staging',async()=>{
  const item=signed();
  assert.deepEqual(await makeVerifier()(item),{
    approved:true,kind:'EMULATOR_APPROVAL_ACK_ONLY',sequence:1
  });
  const stored=await read(grantPath);
  assert.equal(stored.verifierAuthTime,baseAuthTime);
  assert.equal(stored.verifierRoleGeneration,roleGeneration);
  assert.deepEqual(await makeWriter()(item),{
    staged:true,kind:'EMULATOR_CLIENT_WRITE_ACK_ONLY',sequence:1
  });
  assert.deepEqual(await read(stagePath),frame(1));
  for(const field of ['enabled','scope','epoch'])
    await assertSucceeds(observer().ref(root+'/deviceAuthorization/'+deviceId+'/'+field).get());
  await assertSucceeds(observer().ref(grantPath).get());
  await assertSucceeds(observer().ref(stagePath).get());
});

test('session revoked at auth_time boundary denies verifier despite valid role claim',async()=>{
  await admin(d=>d.ref(sessionPath(verifierId)+'/revokeTime').set(baseAuthTime));
  assert.deepEqual(await makeVerifier()(signed()),{
    approved:false,reason:'approval-write-outcome-unverified'
  });
  assert.equal(await read(grantPath),null);
  const freshSession=verifier(baseAuthTime+1,roleGeneration);
  assert.deepEqual(await makeVerifier(freshSession,baseAuthTime+1)(signed()),{
    approved:true,kind:'EMULATOR_APPROVAL_ACK_ONLY',sequence:1
  });
});

test('stale generation and missing session metadata reject approval with no fallback',async()=>{
  await assertFails(verifier(baseAuthTime,roleGeneration-1).ref(grantPath).set(grant()));
  await assertFails(db(verifierId,{fg_ingest_verifier_v1:true,
    fg_role_generation:roleGeneration}).ref(grantPath).set(grant()));
  await admin(d=>d.ref(sessionPath(verifierId)).remove());
  await assertFails(verifier().ref(grantPath).set(grant()));
  assert.equal(await read(grantPath),null);
});

test('client-supplied grant session metadata must match authenticated verifier claim',async()=>{
  await assertFails(verifier().ref(grantPath).set(grant({authTime:baseAuthTime+1})));
  await assertFails(verifier().ref(grantPath).set(grant({generation:roleGeneration+1})));
  assert.equal(await read(grantPath),null);
});

test('revoking verifier invalidates its ALREADY APPROVED frame for unrevoked writer',async()=>{
  const message=signed();
  assert.equal((await makeVerifier()(message)).approved,true);
  await admin(d=>d.ref(sessionPath(verifierId)+'/revokeTime').set(baseAuthTime));
  assert.deepEqual(await makeWriter()(message),{
    staged:false,reason:'staging-write-outcome-unverified'
  });
  await assertFails(writer().ref(stagePath).set(frame(1)));
  assert.equal(await read(stagePath),null);
});

test('verifier role-generation rotation invalidates existing grant even within expiry window',async()=>{
  const message=signed();
  assert.equal((await makeVerifier()(message)).approved,true);
  await admin(d=>d.ref(sessionPath(verifierId)+'/roleGeneration').set(roleGeneration+1));
  await assertFails(writer().ref(stagePath).set(frame(1)));
  assert.equal(await read(stagePath),null);
  assert.equal((await read(grantPath)).verifierRoleGeneration,roleGeneration);
});

test('staging writer token and generation revocations block independent signed approval',async()=>{
  const message=signed();
  assert.equal((await makeVerifier()(message)).approved,true);
  await admin(d=>d.ref(sessionPath(stageId)+'/revokeTime').set(baseAuthTime));
  await assertFails(writer().ref(stagePath).set(frame(1)));
  await admin(d=>d.ref(sessionPath(stageId)).set({
    revokeTime:initialRevokeTime,roleGeneration:roleGeneration+1
  }));
  await assertFails(writer().ref(stagePath).set(frame(1)));
  assert.equal(await read(stagePath),null);
});

test('observer credentials are independently revoked without affecting verifier or writer',async()=>{
  const msg=signed();
  assert.equal((await makeVerifier()(msg)).approved,true);
  await admin(d=>d.ref(sessionPath(observerId)+'/revokeTime').set(baseAuthTime));
  await assertFails(observer().ref(grantPath).get());
  await assertFails(observer().ref(stagePath).get());
  await assertFails(observer().ref(root+'/deviceAuthorization/'+deviceId+'/enabled').get());
  assert.equal((await makeWriter()(msg)).staged,true);
  assert.deepEqual(await read(stagePath),frame(1));
});

test('revocation timestamps are never writable or readable by mock role principals',async()=>{
  for(const actor of [verifier(),writer(),observer(),
    db(deviceId,{fg_ingest_v1:true}),env.unauthenticatedContext().database()]){
    for(const id of [verifierId,stageId,observerId]){
      await assertFails(actor.ref(sessionPath(id)).get());
      await assertFails(actor.ref(sessionPath(id)+'/revokeTime').set(0));
      await assertFails(actor.ref(sessionPath(id)+'/roleGeneration').set(1));
    }
  }
});

test('rotated role session alone cannot resurrect a verifier grant after revocation',async()=>{
  const first=signed();
  assert.equal((await makeVerifier()(first)).approved,true);
  await admin(d=>d.ref(sessionPath(verifierId)).set({
    revokeTime:baseAuthTime,roleGeneration:roleGeneration+1
  }));
  await assertFails(writer().ref(stagePath).set(frame(1)));
  // First advance the INDEPENDENT sealed replay checkpoint to make a
  // sequence-2 request otherwise admissible. The old role session must
  // then be rejected by RTDB Rules, not by an earlier signature/ledger guard.
  assert.equal(ledger.commit({
    uid:deviceId,epoch:1,sequence:2,keyFingerprint
  }).accepted,true);
  assert.deepEqual(await makeVerifier()(signed(2)),{
    approved:false,reason:'approval-write-outcome-unverified'
  });
  const newTime=baseAuthTime+1,newGeneration=roleGeneration+1;
  assert.equal((await makeVerifier(verifier(newTime,newGeneration),newTime,newGeneration)(
    signed(2)
  )).approved,true);
  assert.equal((await makeWriter()(signed(2))).staged,true);
  assert.deepEqual(await read(stagePath),frame(2));
});

test('roles cannot gain parent, other-device, public-live or private-metadata writes',async()=>{
  for(const actor of [verifier(),writer(),observer()]){
    await assertFails(actor.ref(root+'/staging/ingestV1/'+other).set(frame(2)));
    await assertFails(actor.ref(root+'/live/water/status').set('SAFE'));
    await assertFails(actor.ref(root+'/live/gate/status').set('OPEN'));
    await assertFails(actor.ref(root+'/live/esp8266/ip').set('192.0.2.9'));
    await assertFails(actor.ref(root+'/bot').set({state:'RUNNING'}));
  }
});

test('mock custom claims are not evidence of real Firebase Auth issuer or JWT revocation',()=>{
  const rules=readFileSync('docs/firebase/phase-b-session-revocation.rules.json','utf8');
  assert.match(rules,/auth\.token\.auth_time/);
  assert.match(rules,/fg_role_generation/);
  assert.match(rules,/verifierAuthTime/);
  assert.match(rules,/verifierRoleGeneration/);
  assert.doesNotMatch(rules,/serviceAccount|private_key/);
});
