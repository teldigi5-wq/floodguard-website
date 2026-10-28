// Synthetic two-principal approval/staging lab. Only local RTDB emulator.
// Never uses production Firebase, server/Admin SDK, credentials, or firmware.
import {test,before,after,beforeEach,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash,generateKeyPairSync,randomBytes,sign} from 'node:crypto';
import {initializeTestEnvironment,assertFails} from '@firebase/rules-unit-testing';
import {canonicalOfflineEnvelope,createStage7OfflineLedger}
  from '../experiments/stage7-durable-ingress.mjs';
import {createOperatorDeviceRegistryLab}
  from '../experiments/operator-device-registry-lab.mjs';
import {createSignedStagingApprovalEmulator}
  from '../experiments/signed-staging-approval-emulator.mjs';
import {createSignedStagingEmulatorWriter}
  from '../experiments/signed-staging-emulator-writer.mjs';

if(process.env.FG_DUAL_AUTHORITY_TEST!=='1'||
   process.env.FG_SIGNED_STAGING_BRIDGE_TEST!=='1'||
   process.env.FIREBASE_DATABASE_EMULATOR_HOST!=='127.0.0.1:9000')
  throw Error('Dual-role test requires local RTDB emulator');

const root='/floodguard',uid='device-stage-a',other='device-stage-b';
const verifierId='ingest-verifier-stage-a',writerId='ingest-authority-stage-a';
const approvalPath=root+'/ingestApprovalLab/'+uid;
const stagePath=root+'/staging/ingestV1/'+uid;
const device=generateKeyPairSync('ed25519');
const issuer=generateKeyPairSync('ed25519');
const fp=createHash('sha256').update(
  device.publicKey.export({format:'der',type:'spki'})).digest('hex');
const frame=(seq,risk='WARNING')=>({
  sequence:seq,distanceCm:16.5,levelCm:8.5,risk
});
let env,dir,registry,ledger,time;
const db=(id,claims={})=>env.authenticatedContext(id,claims).database();
const verifier=()=>db(verifierId,{fg_ingest_verifier_v1:true});
const writer=()=>db(writerId,{fg_ingest_authority_v1:true});
const admin=async fn=>{
  let result;
  await env.withSecurityRulesDisabled(async ctx=>{result=await fn(ctx.database());});
  return result;
};
const inspect=p=>admin(async d=>(await d.ref(p).get()).val());
const makeVerifier=(database=verifier())=>createSignedStagingApprovalEmulator({
  database,deviceId:uid,operatorRegistry:registry,replayLedger:ledger,
  receiptIssuerPublicKey:issuer.publicKey,clock:()=>time
});
const makeWriter=(database=writer())=>createSignedStagingEmulatorWriter({
  database,deviceId:uid,operatorRegistry:registry,replayLedger:ledger,
  receiptIssuerPublicKey:issuer.publicKey,clock:()=>time
});
function signed(seq=1,risk='WARNING'){
  const envelope={
    version:'floodguard-offline-envelope-v1',deviceId:uid,epoch:1,
    observedAtMs:time-400,frame:frame(seq,risk)
  };
  const canonical=canonicalOfflineEnvelope(envelope);
  const receipt={
    version:'floodguard-offline-receipt-v1',deviceId:uid,epoch:1,
    sequence:seq,digest:createHash('sha256').update(canonical).digest('hex'),
    acceptedAtMs:time-100
  };
  return {envelope,
    deviceSignature:sign(null,Buffer.from(canonical),device.privateKey).toString('base64url'),
    receipt,receiptSignature:sign(null,Buffer.from(JSON.stringify(receipt)),
      issuer.privateKey).toString('base64url')
  };
}
before(async()=>{
  env=await initializeTestEnvironment({
    projectId:'demo-dual-authority-ingest',
    database:{
      host:'127.0.0.1',port:9000,
      rules:readFileSync('docs/firebase/phase-b-dual-authority-staging.rules.json','utf8')
    }
  });
});
after(async()=>{if(env)await env.cleanup();});
beforeEach(async()=>{
  time=Date.now();
  dir=mkdtempSync(join(tmpdir(),'fg-dual-authority-'));
  registry=createOperatorDeviceRegistryLab({directory:dir,integrityKey:randomBytes(32)});
  registry.commission();registry.enroll(uid,device.publicKey);
  ledger=createStage7OfflineLedger({directory:dir,integrityKey:randomBytes(32)});
  assert.equal(ledger.commit({uid,epoch:1,sequence:1,keyFingerprint:fp}).accepted,true);
  await env.clearDatabase();
  await admin(async d=>{
    await d.ref(root+'/deviceAuthorization').set({
      [uid]:{enabled:true,scope:'prototype-ingest-v1',epoch:1},
      [other]:{enabled:true,scope:'prototype-ingest-v1',epoch:1}
    });
    await d.ref(root+'/ingestAuthorityLab').set({
      [writerId]:{
        enabled:true,scope:'prototype-signed-staging-authority-v1',deviceId:uid
      }
    });
    await d.ref(root+'/ingestVerifierLab').set({
      [verifierId]:{
        enabled:true,scope:'prototype-signed-approval-verifier-v1',deviceId:uid
      }
    });
  });
});
afterEach(()=>{if(dir)rmSync(dir,{recursive:true,force:true});dir=undefined;});

test('both independent approvals and staging succeed only on exact signed four-field frame',async()=>{
  const m=signed();
  assert.deepEqual(await makeVerifier()(m),{
    approved:true,kind:'EMULATOR_APPROVAL_ACK_ONLY',sequence:1
  });
  const grant=await inspect(approvalPath);
  assert.equal(grant.sequence,1);
  assert.equal(grant.epoch,1);
  assert.equal(grant.digest,m.receipt.digest);
  assert.equal(grant.expiresAtMs-grant.issuedAtMs,10000);
  assert.deepEqual(await makeWriter()(m),{
    staged:true,kind:'EMULATOR_CLIENT_WRITE_ACK_ONLY',sequence:1
  });
  assert.deepEqual(await inspect(stagePath),frame(1));
  await assertFails(verifier().ref(stagePath).get());
  await assertFails(writer().ref(approvalPath).get());
});

test('stolen authority mock token cannot stage any unapproved frame or invent a grant',async()=>{
  await assertFails(writer().ref(stagePath).set(frame(1)));
  await assertFails(writer().ref(approvalPath).set({
    ...frame(1),epoch:1,digest:'0'.repeat(64),
    issuedAtMs:time,expiresAtMs:time+10000
  }));
  assert.deepEqual(await makeWriter()(signed()),{
    staged:false,reason:'staging-write-outcome-unverified'
  });
  assert.equal(await inspect(stagePath),null);
  assert.equal(await inspect(approvalPath),null);
});

test('stolen verifier token cannot stage frames and ordinary device cannot grant or write',async()=>{
  await assertFails(verifier().ref(stagePath).set(frame(1)));
  for(const untrusted of [
    env.unauthenticatedContext().database(),
    db(uid,{fg_ingest_v1:true}),
    db(uid,{fg_ingest_verifier_v1:true}),
    db(writerId,{fg_ingest_authority_v1:true}),
    db('ordinary',{fg_ingest_verifier_v1:true})
  ]){
    await assertFails(untrusted.ref(approvalPath).set({
      ...frame(1),epoch:1,digest:'0'.repeat(64),
      issuedAtMs:time,expiresAtMs:time+10000
    }));
  }
  assert.equal(await inspect(approvalPath),null);
});

test('grant binds identical sequence and all water fields, never approves safer substitution',async()=>{
  const message=signed();
  assert.equal((await makeVerifier()(message)).approved,true);
  for(const manipulated of [
    frame(1,'SAFE'),{...frame(1),distanceCm:21},
    {...frame(1),levelCm:9},frame(2),
    {...frame(1),gateCommand:'OPEN'}
  ])await assertFails(writer().ref(stagePath).set(manipulated));
  assert.equal(await inspect(stagePath),null);
  assert.equal((await makeWriter()(message)).staged,true);
});

test('expired or absent grants deny even a well-formed claimed authority frame',async()=>{
  await assertFails(writer().ref(stagePath).set(frame(1)));
  await admin(d=>d.ref(approvalPath).set({
    ...frame(1),epoch:1,digest:'0'.repeat(64),
    issuedAtMs:time-60000,expiresAtMs:time-40000
  }));
  await assertFails(writer().ref(stagePath).set(frame(1)));
  assert.equal(await inspect(stagePath),null);
});

test('signed verifier denies forged or stale evidence, and signer replay checkpoint mismatch',async()=>{
  for(const msg of [
    {...signed(),deviceSignature:'A'.repeat(86)},
    {...signed(),receiptSignature:'A'.repeat(86)},
    {...signed(),envelope:{...signed().envelope,frame:frame(1,'SAFE')}},
    {...signed(),envelope:{...signed().envelope,observedAtMs:time-31000}},
    {...signed(),envelope:{...signed().envelope,frame:{...frame(1),gateCommand:'OPEN'}}}
  ])assert.equal((await makeVerifier()(msg)).approved,false);
  assert.equal(await inspect(approvalPath),null);
  assert.equal(ledger.commit({
    uid,epoch:1,sequence:2,keyFingerprint:fp
  }).accepted,true);
  assert.deepEqual(await makeVerifier()(signed()),{
    approved:false,reason:'sealed-checkpoint-unverified'
  });
});

test('independent verifier revocation blocks grant creation and any existing grant use',async()=>{
  const msg=signed();
  assert.equal((await makeVerifier()(msg)).approved,true);
  await admin(d=>d.ref(root+'/ingestVerifierLab/'+verifierId+'/enabled').set(false));
  await assertFails(writer().ref(stagePath).set(frame(1)));
  assert.deepEqual(await makeVerifier()(msg),{
    approved:false,reason:'approval-write-outcome-unverified'
  });
  assert.equal(await inspect(stagePath),null);
});

test('revoking staging authority or source device denies valid prior approval',async()=>{
  const msg=signed();
  assert.equal((await makeVerifier()(msg)).approved,true);
  await admin(d=>d.ref(root+'/ingestAuthorityLab/'+writerId+'/enabled').set(false));
  await assertFails(writer().ref(stagePath).set(frame(1)));
  await admin(async d=>{
    await d.ref(root+'/ingestAuthorityLab/'+writerId+'/enabled').set(true);
    await d.ref(root+'/deviceAuthorization/'+uid+'/enabled').set(false);
  });
  await assertFails(writer().ref(stagePath).set(frame(1)));
  assert.equal(await inspect(stagePath),null);
});

test('grant cannot be partially edited, deleted, scoped to other device or replayed at same sequence',async()=>{
  const msg=signed();
  assert.equal((await makeVerifier()(msg)).approved,true);
  await assertFails(verifier().ref(approvalPath).update({risk:'SAFE'}));
  await assertFails(verifier().ref(approvalPath).remove());
  await assertFails(verifier().ref(root+'/ingestApprovalLab/'+other).set(await inspect(approvalPath)));
  await assertFails(verifier().ref(root+'/ingestApprovalLab').set({[uid]:await inspect(approvalPath)}));
  await assertFails(verifier().ref(approvalPath).set(await inspect(approvalPath)));
  assert.equal((await makeWriter()(msg)).staged,true);
  await assertFails(writer().ref(stagePath).set(frame(1)));
});

test('lost verifier ACK remains uncertain without retry or invented permission',async()=>{
  const actual=verifier();let attempts=0;
  const lossy=Object.freeze({ref(path){
    assert.equal(path,approvalPath);
    return {async set(payload){
      attempts++;
      await actual.ref(path).set(payload);
      throw Error('SIMULATED_APPROVAL_ACK_LOSS');
    }};
  }});
  assert.deepEqual(await makeVerifier(lossy)(signed()),{
    approved:false,reason:'approval-write-outcome-unverified'
  });
  assert.equal(attempts,1);
  assert.equal((await inspect(approvalPath)).sequence,1);
  assert.equal(await inspect(stagePath),null);
});

test('approver token compromise can forge grants but cannot stage alone; two-role compromise is out of scope',async()=>{
  const forged={
    ...frame(1,'SAFE'),epoch:1,digest:'0'.repeat(64),
    issuedAtMs:Date.now(),expiresAtMs:Date.now()+10000
  };
  // Deliberate negative boundary: RTDB Rules do not cryptographically
  // validate signatures. A compromised verifier can create an arbitrary
  // syntactically valid grant, but does not have staging permission.
  await verifier().ref(approvalPath).set(forged);
  await assertFails(verifier().ref(stagePath).set(frame(1,'SAFE')));
  assert.equal(await inspect(stagePath),null);
});

test('public live, private WiFi, bot and gate commands remain unwritable by both roles',async()=>{
  for(const actor of [writer(),verifier()]){
    await assertFails(actor.ref(root+'/live/water/levelCm').set(8));
    await assertFails(actor.ref(root+'/live/gate/status').set('OPEN'));
    await assertFails(actor.ref(root+'/live/esp8266/ip').set('192.0.2.1'));
    await assertFails(actor.ref(root+'/bot/state').set({running:true}));
    await assertFails(actor.ref(root+'/deviceAuthorization/'+uid+'/enabled').set(true));
  }
});
