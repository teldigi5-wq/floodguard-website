// AUTHORITY-ONLY Firebase emulator experiment. The trusted signer verifier
// runs with a separately authorized TEST principal; real Firebase token
// issuance, IAM isolation, TLS hardware provisioning and cloud are absent.
import {test,before,after,beforeEach,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash,generateKeyPairSync,randomBytes,sign} from 'node:crypto';
import {initializeTestEnvironment,assertFails} from '@firebase/rules-unit-testing';
import {createStage7OfflineLedger,canonicalOfflineEnvelope} from '../experiments/stage7-durable-ingress.mjs';
import {createOperatorDeviceRegistryLab} from '../experiments/operator-device-registry-lab.mjs';
import {createSignedStagingEmulatorWriter} from '../experiments/signed-staging-emulator-writer.mjs';

if(process.env.FG_TRUSTED_INGEST_AUTHORITY_TEST!=='1'||
   process.env.FG_SIGNED_STAGING_BRIDGE_TEST!=='1'||
   process.env.FIREBASE_DATABASE_EMULATOR_HOST!=='127.0.0.1:9000')
  throw Error('Authority lab restricted to isolated RTDB emulator');

const root='/floodguard',uid='device-stage-a',other='device-stage-b';
const authority='ingest-authority-stage-a',now=1700000003500;
const staging=root+'/staging/ingestV1/'+uid;
const device=generateKeyPairSync('ed25519');
const receiptKey=generateKeyPairSync('ed25519');
const deviceFingerprint=createHash('sha256')
  .update(device.publicKey.export({format:'der',type:'spki'})).digest('hex');
const frame=sequence=>({sequence,distanceCm:16.5,levelCm:8.5,risk:'WARNING'});
function signed(sequence=1){
  const envelope={version:'floodguard-offline-envelope-v1',deviceId:uid,
    epoch:1,observedAtMs:now-400,frame:frame(sequence)};
  const canonical=canonicalOfflineEnvelope(envelope);
  const receipt={version:'floodguard-offline-receipt-v1',deviceId:uid,
    epoch:1,sequence,digest:createHash('sha256').update(canonical).digest('hex'),
    acceptedAtMs:now-100};
  return {envelope,
    deviceSignature:sign(null,Buffer.from(canonical),device.privateKey).toString('base64url'),
    receipt,
    receiptSignature:sign(null,Buffer.from(JSON.stringify(receipt)),
      receiptKey.privateKey).toString('base64url')
  };
}
let env,dir,registry,ledger;
const client=(id,claims={})=>env.authenticatedContext(id,claims).database();
const authorityClient=()=>client(authority,{fg_ingest_authority_v1:true});
const deviceClient=()=>client(uid,{fg_ingest_v1:true});
const bridge=(database=authorityClient())=>createSignedStagingEmulatorWriter({
  database,deviceId:uid,operatorRegistry:registry,replayLedger:ledger,
  receiptIssuerPublicKey:receiptKey.publicKey,clock:()=>now
});
const admin=async fn=>{
  let answer;
  await env.withSecurityRulesDisabled(async ctx=>{answer=await fn(ctx.database());});
  return answer;
};
const inspect=path=>admin(async db=>(await db.ref(path).get()).val());
before(async()=>{
  env=await initializeTestEnvironment({projectId:'demo-authority-only-ingest',
    database:{host:'127.0.0.1',port:9000,
      rules:readFileSync('docs/firebase/phase-b-authority-only-staging.rules.json','utf8')}});
});
after(async()=>{if(env)await env.cleanup();});
beforeEach(async()=>{
  dir=mkdtempSync(join(tmpdir(),'fg-authority-staging-'));
  registry=createOperatorDeviceRegistryLab({
    directory:dir,integrityKey:randomBytes(32)
  });
  registry.commission();registry.enroll(uid,device.publicKey);
  ledger=createStage7OfflineLedger({directory:dir,integrityKey:randomBytes(32)});
  assert.deepEqual(ledger.commit({
    uid,epoch:1,sequence:1,keyFingerprint:deviceFingerprint
  }),{accepted:true,sequence:1});
  await env.clearDatabase();
  await admin(async db=>{
    await db.ref(root+'/deviceAuthorization').set({
      [uid]:{enabled:true,scope:'prototype-ingest-v1'},
      [other]:{enabled:true,scope:'prototype-ingest-v1'}
    });
    await db.ref(root+'/ingestAuthorityLab').set({
      [authority]:{enabled:true,scope:'prototype-signed-staging-authority-v1',
        deviceId:uid}
    });
  });
});
afterEach(()=>{if(dir)rmSync(dir,{recursive:true,force:true});dir=undefined;});

test('anonymous, signed devices and ordinary mock users cannot directly bypass trusted authority',async()=>{
  const denied=[
    env.unauthenticatedContext().database(),deviceClient(),
    client(uid,{fg_ingest_authority_v1:true}),
    client('ordinary'),client(authority),
    client('other-authority',{fg_ingest_authority_v1:true}),
    client(authority,{fg_ingest_v1:true})
  ];
  for(const db of denied)
    await assertFails(db.ref(staging).set(frame(1)));
  assert.equal(await inspect(staging),null);
});

test('verified device+receipt evidence reaches staging through only the assigned authority client',async()=>{
  assert.deepEqual(await bridge()(signed()),{
    staged:true,kind:'EMULATOR_CLIENT_WRITE_ACK_ONLY',sequence:1
  });
  assert.deepEqual(await inspect(staging),frame(1));
  await assertFails(authorityClient().ref(staging).get());
  await assertFails(authorityClient().ref(root+'/live/water/status').set('SAFE'));
  await assertFails(authorityClient().ref(root+'/staging').set({ingestV1:{[uid]:frame(2)}}));
  await assertFails(authorityClient().ref(root+'/deviceAuthorization/'+uid+'/enabled').set(false));
  await assertFails(authorityClient().ref(root+'/ingestAuthorityLab/'+authority+'/enabled').set(true));
});

test('signed device bypass fails even when the evidence wrapper is invoked with a device-scoped client',async()=>{
  assert.deepEqual(await bridge(deviceClient())(signed()),{
    staged:false,reason:'staging-write-outcome-unverified'
  });
  assert.equal(await inspect(staging),null);
});

test('forged, mutated, stale or replay ledger-mismatched evidence fails before authority write',async()=>{
  const valid=signed();
  const bad=[
    {...valid,deviceSignature:'A'.repeat(86)},
    {...valid,receiptSignature:'A'.repeat(86)},
    {...valid,envelope:{...valid.envelope,frame:{...frame(1),risk:'SAFE'}}},
    {...valid,envelope:{...valid.envelope,observedAtMs:now-31000}},
    {...valid,receipt:{...valid.receipt,sequence:2}},
    {...valid,envelope:{...valid.envelope,deviceId:other}},
    {...valid,envelope:{...valid.envelope,frame:{...frame(1),gateCommand:'OPEN'}}}
  ];
  for(const evidence of bad)assert.equal((await bridge()(evidence)).staged,false);
  assert.equal(await inspect(staging),null);
  ledger.commit({uid,epoch:1,sequence:2,keyFingerprint:deviceFingerprint});
  assert.deepEqual(await bridge()(signed()),{
    staged:false,reason:'sealed-replay-checkpoint-mismatch'
  });
});

test('scope cannot leak to other device, parent, live or private metadata',async()=>{
  const db=authorityClient();
  await assertFails(db.ref(root+'/staging/ingestV1/'+other).set(frame(1)));
  await assertFails(db.ref(root+'/staging/ingestV1').set({[uid]:frame(1)}));
  await assertFails(db.ref(root+'/live/water/levelCm').set(8.5));
  await assertFails(db.ref(root+'/live/esp8266/ip').set('192.0.2.123'));
  await assertFails(db.ref(root+'/bot/state').set({ready:true}));
  await assertFails(db.ref(staging).set({...frame(1),gateCommand:'OPEN'}));
  assert.equal(await inspect(staging),null);
});

test('operator and Firebase authority revocation independently deny signed writes',async()=>{
  registry.revoke(uid);
  assert.deepEqual(await bridge()(signed()),{
    staged:false,reason:'operator-identity-unverified'
  });
  // Reset only the synthetic local fixture through a completely NEW identity
  // would require operator intervention; test cloud authority revocation using
  // raw scoped client since the revoked local registry must stay revoked.
  await admin(db=>db.ref(root+'/ingestAuthorityLab/'+authority+'/enabled').set(false));
  await assertFails(authorityClient().ref(staging).set(frame(1)));
  assert.equal(await inspect(staging),null);
});

test('cloud device revocation blocks authority even when signed local evidence stays valid',async()=>{
  await admin(db=>db.ref(root+'/deviceAuthorization/'+uid+'/enabled').set(false));
  assert.deepEqual(await bridge()(signed()),{
    staged:false,reason:'staging-write-outcome-unverified'
  });
  assert.equal(await inspect(staging),null);
});

test('stage sequence is monotonic and cannot be partially mutated or deleted',async()=>{
  assert.equal((await bridge()(signed(1))).staged,true);
  await assertFails(authorityClient().ref(staging).set(frame(1)));
  await assertFails(authorityClient().ref(staging).update({risk:'SAFE'}));
  await assertFails(authorityClient().ref(staging).remove());
  assert.deepEqual(ledger.commit({
    uid,epoch:1,sequence:2,keyFingerprint:deviceFingerprint
  }),{accepted:true,sequence:2});
  assert.equal((await bridge()(signed(2))).staged,true);
  await assertFails(authorityClient().ref(staging).set(frame(1)));
  assert.deepEqual(await inspect(staging),frame(2));
});

test('lost ACK stays unknown and never retries, even if authority write committed',async()=>{
  const actual=authorityClient();
  let writes=0;
  const simulation=Object.freeze({ref(path){
    assert.equal(path,staging);
    return {async set(payload){
      writes++;
      await actual.ref(path).set(payload);
      throw Error('SIMULATED-LOST-ACK');
    }};
  }});
  assert.deepEqual(await bridge(simulation)(signed()),{
    staged:false,reason:'staging-write-outcome-unverified'
  });
  assert.equal(writes,1);
  assert.deepEqual(await inspect(staging),frame(1));
});

test('authority credential compromise still bypasses optional signature verifier (explicit open risk)',async()=>{
  // Rules CANNOT validate Ed25519 signatures. This is a threat demonstration:
  // a stolen authority token can write any schema-valid higher sequence for
  // its assigned device WITHOUT invoking the verified evidence bridge.
  await authorityClient().ref(staging).set(frame(1));
  assert.deepEqual(await inspect(staging),frame(1));
  assert.deepEqual(await bridge()(signed()),{
    staged:false,reason:'staging-write-outcome-unverified'
  });
});
