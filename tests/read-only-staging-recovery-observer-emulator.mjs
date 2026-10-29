// Emulator-only, no real Firebase or credentials. The separately scoped
// observer can READ exactly one signed device's approval/staging/auth paths,
// while preserving the independent verifier/writer scopes and all denials.
import {test,before,after,beforeEach,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash,generateKeyPairSync,randomBytes,sign} from 'node:crypto';
import {initializeTestEnvironment,assertFails,assertSucceeds} from '@firebase/rules-unit-testing';
import {canonicalOfflineEnvelope,createStage7OfflineLedger}
  from '../experiments/stage7-durable-ingress.mjs';
import {createOperatorDeviceRegistryLab} from '../experiments/operator-device-registry-lab.mjs';
import {createSignedStagingApprovalEmulator} from '../experiments/signed-staging-approval-emulator.mjs';
import {createSignedStagingEmulatorWriter} from '../experiments/signed-staging-emulator-writer.mjs';
import {createReadOnlyStagingRecoveryObserver}
  from '../experiments/read-only-staging-recovery-observer.mjs';

if(process.env.FG_STAGING_OBSERVER_TEST!=='1'||
   process.env.FG_SIGNED_STAGING_BRIDGE_TEST!=='1'||
   process.env.FG_DUAL_AUTHORITY_TEST!=='1'||
   process.env.FIREBASE_DATABASE_EMULATOR_HOST!=='127.0.0.1:9000')
  throw Error('Read-only recovery tests require isolated RTDB emulator');

const root='/floodguard',id='device-stage-a',other='device-stage-b';
const approver='ingest-verifier-stage-a',writerId='ingest-authority-stage-a';
const observerId='ingest-observer-stage-a';
const approvalPath=root+'/ingestApprovalLab/'+id;
const stagePath=root+'/staging/ingestV1/'+id;
const authPath=root+'/deviceAuthorization/'+id;
const pair=generateKeyPairSync('ed25519'),receiptKey=generateKeyPairSync('ed25519');
const hash=createHash('sha256').update(pair.publicKey.export({format:'der',type:'spki'})).digest('hex');
const frame=(sequence=1,risk='WARNING')=>({
  sequence,distanceCm:16.5,levelCm:8.5,risk
});
let env,dir,operator,ledger,now;
const db=(uid,claims={})=>env.authenticatedContext(uid,claims).database();
const verifier=()=>db(approver,{fg_ingest_verifier_v1:true});
const stager=()=>db(writerId,{fg_ingest_authority_v1:true});
const witness=()=>db(observerId,{fg_ingest_observer_v1:true});
const admin=async fn=>{
  let output;
  await env.withSecurityRulesDisabled(async c=>{output=await fn(c.database());});
  return output;
};
const read=p=>admin(async d=>(await d.ref(p).get()).val());
function signed(sequence=1){
  const envelope={version:'floodguard-offline-envelope-v1',
    deviceId:id,epoch:1,observedAtMs:now-400,frame:frame(sequence)};
  const canonical=canonicalOfflineEnvelope(envelope);
  const receipt={version:'floodguard-offline-receipt-v1',deviceId:id,
    epoch:1,sequence,digest:createHash('sha256').update(canonical).digest('hex'),
    acceptedAtMs:now-100};
  return {envelope,receipt,
    deviceSignature:sign(null,Buffer.from(canonical),pair.privateKey).toString('base64url'),
    receiptSignature:sign(null,Buffer.from(JSON.stringify(receipt)),
      receiptKey.privateKey).toString('base64url')
  };
}
const approve=(database=verifier())=>createSignedStagingApprovalEmulator({
  database,deviceId:id,operatorRegistry:operator,replayLedger:ledger,
  receiptIssuerPublicKey:receiptKey.publicKey,clock:()=>now
});
const stage=(database=stager())=>createSignedStagingEmulatorWriter({
  database,deviceId:id,operatorRegistry:operator,replayLedger:ledger,
  receiptIssuerPublicKey:receiptKey.publicKey,clock:()=>now
});
const observe=(database=witness(),deadline=3000)=>createReadOnlyStagingRecoveryObserver({
  database,deviceId:id,operatorRegistry:operator,replayLedger:ledger,
  receiptIssuerPublicKey:receiptKey.publicKey,clock:()=>now,readDeadlineMs:deadline
});
before(async()=>{
  env=await initializeTestEnvironment({projectId:'demo-recovery-observer-ingest',
    database:{host:'127.0.0.1',port:9000,
      rules:readFileSync('docs/firebase/phase-b-observer-recovery.rules.json','utf8')}});
});
after(async()=>{if(env)await env.cleanup();});
beforeEach(async()=>{
  now=Date.now();
  dir=mkdtempSync(join(tmpdir(),'fg-recovery-observer-'));
  operator=createOperatorDeviceRegistryLab({directory:dir,integrityKey:randomBytes(32)});
  operator.commission();operator.enroll(id,pair.publicKey);
  ledger=createStage7OfflineLedger({directory:dir,integrityKey:randomBytes(32)});
  assert.equal(ledger.commit({uid:id,epoch:1,sequence:1,keyFingerprint:hash}).accepted,true);
  await env.clearDatabase();
  await admin(async d=>{
    await d.ref(root+'/deviceAuthorization').set({
      [id]:{enabled:true,scope:'prototype-ingest-v1',epoch:1},
      [other]:{enabled:true,scope:'prototype-ingest-v1',epoch:1}
    });
    await d.ref(root+'/ingestAuthorityLab').set({
      [writerId]:{enabled:true,scope:'prototype-signed-staging-authority-v1',deviceId:id}
    });
    await d.ref(root+'/ingestVerifierLab').set({
      [approver]:{enabled:true,scope:'prototype-signed-approval-verifier-v1',deviceId:id}
    });
    await d.ref(root+'/ingestObserverLab').set({
      [observerId]:{enabled:true,scope:'prototype-ingest-observer-v1',deviceId:id}
    });
  });
});
afterEach(()=>{if(dir)rmSync(dir,{recursive:true,force:true});dir=undefined;});

test('read-only observer sees matching double-checked approval and staged frame, without cloud durability claim',async()=>{
  const m=signed();
  assert.equal((await approve()(m)).approved,true);
  assert.equal((await stage()(m)).staged,true);
  assert.deepEqual(await observe()(m),{
    observed:true,status:'matching-stage-and-approval-observed-in-emulator-only',sequence:1
  });
  assert.deepEqual(await read(stagePath),frame(1));
});

test('missing state is NOT authorization to retry a device request',async()=>{
  assert.deepEqual(await observe()(signed()),{
    observed:false,status:'target-not-observed-unsafe-to-retry'
  });
});

test('lost approval ACK yields approval-only observation with no staged success',async()=>{
  const real=verifier();let writes=0;
  const lost=Object.freeze({ref(path){
    assert.equal(path,approvalPath);
    return {async set(payload){
      writes++;
      await real.ref(path).set(payload);
      throw Error('SYNTHETIC_VERIFIER_ACK_LOST');
    }};
  }});
  const m=signed();
  assert.deepEqual(await approve(lost)(m),{
    approved:false,reason:'approval-write-outcome-unverified'
  });
  assert.equal(writes,1);
  assert.deepEqual(await observe()(m),{
    observed:false,status:'approval-only-observed-no-target-stage'
  });
  assert.equal(await read(stagePath),null);
});

test('lost staging ACK is reconciled by independent read-only principal but not automatically retried',async()=>{
  const m=signed();
  assert.equal((await approve()(m)).approved,true);
  const real=stager();let writes=0;
  const lost=Object.freeze({ref(path){
    assert.equal(path,stagePath);
    return {async set(payload){
      writes++;
      await real.ref(path).set(payload);
      throw Error('SYNTHETIC_STAGE_ACK_LOST');
    }};
  }});
  assert.deepEqual(await stage(lost)(m),{
    staged:false,reason:'staging-write-outcome-unverified'
  });
  assert.equal(writes,1);
  assert.deepEqual(await observe()(m),{
    observed:true,status:'matching-stage-and-approval-observed-in-emulator-only',sequence:1
  });
});

test('observer cannot write anything or read another source, parent, WiFi, bot or gate',async()=>{
  const ob=witness();
  for(const path of [root+'/ingestApprovalLab/'+other,
    root+'/staging/ingestV1/'+other,root+'/deviceAuthorization/'+other,
    root+'/live/esp8266/ip',root+'/live/gate/status',
    root+'/bot',root+'/ingestObserverLab',root+'/ingestApprovalLab']){
    await assertFails(ob.ref(path).get());
  }
  for(const path of [approvalPath,stagePath,authPath,
    root+'/ingestObserverLab/'+observerId,root+'/live/water/levelCm']){
    await assertFails(ob.ref(path).set(null));
  }
  for(const p of [approvalPath,stagePath,authPath])
    await assertSucceeds(ob.ref(p).get());
  await assertFails(db(id,{fg_ingest_v1:true}).ref(approvalPath).get());
  await assertFails(verifier().ref(stagePath).get());
  await assertFails(stager().ref(approvalPath).get());
});

test('missing or revoked observer role fails closed without privileged fallback',async()=>{
  const m=signed();
  await admin(d=>d.ref(root+'/ingestObserverLab/'+observerId+'/enabled').set(false));
  assert.deepEqual(await observe()(m),{
    observed:false,status:'observation-unavailable'
  });
});

test('revoking device authorization returns unavailable confidence, not a safe or confirmed state',async()=>{
  const m=signed();
  await admin(d=>d.ref(authPath+'/enabled').set(false));
  assert.deepEqual(await observe()(m),{
    observed:false,status:'cloud-authorization-unverified'
  });
});

test('conflicting same-sequence stage and signed expectation is never accepted',async()=>{
  const m=signed();
  assert.equal((await approve()(m)).approved,true);
  await admin(d=>d.ref(stagePath).set(frame(1,'SAFE')));
  assert.deepEqual(await observe()(m),{
    observed:false,status:'conflicting-stage-unverified'
  });
});

test('approval content mismatch with authentic signature never counts as matching',async()=>{
  const m=signed();
  await admin(d=>d.ref(approvalPath).set({
    ...frame(1,'SAFE'),epoch:1,digest:m.receipt.digest,
    issuedAtMs:now,expiresAtMs:now+10000
  }));
  assert.deepEqual(await observe()(m),{
    observed:false,status:'conflicting-approval-unverified'
  });
});

test('newer frame does not retroactively confirm earlier lost ACK',async()=>{
  const m=signed();
  assert.equal((await approve()(m)).approved,true);
  await admin(d=>d.ref(stagePath).set(frame(2)));
  assert.deepEqual(await observe()(m),{
    observed:false,status:'later-stage-observed-unknown-for-target'
  });
});

test('forged signature and altered receipt are refused before observer database access',async()=>{
  const m=signed();
  const inaccessible=Object.freeze({ref(){throw Error('MUST_NOT_READ');}});
  const ob=observe(inaccessible);
  assert.deepEqual(await ob({...m,deviceSignature:'A'.repeat(86)}),{
    observed:false,status:'device-signature-invalid'
  });
  assert.deepEqual(await ob({...m,receiptSignature:'A'.repeat(86)}),{
    observed:false,status:'receipt-unverified'
  });
});

test('nonresponsive SDK read is bounded and remains non-mutating',async()=>{
  const hanging=Object.freeze({ref(){return {get:()=>new Promise(()=>{})};}});
  const m=signed();
  assert.deepEqual(await observe(hanging,60)(m),{
    observed:false,status:'observation-unavailable'
  });
});

test('inconsistent two-pass data cannot yield an observed result',async()=>{
  const m=signed(),a={...frame(1),epoch:1,digest:m.receipt.digest,
    issuedAtMs:now,expiresAtMs:now+10000};
  let n=0;
  const unstable=Object.freeze({ref(p){
    return {async get(){
      n++;
      if(p===approvalPath)return {val:()=>a};
      if(p===authPath)return {val:()=>({enabled:true,scope:'prototype-ingest-v1',epoch:1})};
      if(p===stagePath)return {val:()=>n<=3?null:frame(1)};
      throw Error('wrong observer path');
    }};
  }});
  assert.deepEqual(await observe(unstable)(m),{
    observed:false,status:'concurrent-state-change-unverified'
  });
});
