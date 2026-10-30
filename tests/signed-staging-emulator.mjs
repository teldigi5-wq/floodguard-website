// Strict local Firebase RTDB emulator only. Keys, users, frames, IAM claims
// and HMAC-sealed operator state are SYNTHETIC; no real Firebase project used.
import {test,before,after,beforeEach,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {createHash,generateKeyPairSync,randomBytes,sign} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {initializeTestEnvironment,assertFails} from '@firebase/rules-unit-testing';
import {createOperatorDeviceRegistryLab} from '../experiments/operator-device-registry-lab.mjs';
import {createStage7OfflineLedger,canonicalOfflineEnvelope}
  from '../experiments/stage7-durable-ingress.mjs';
import {createSignedStagingEmulatorWriter}
  from '../experiments/signed-staging-emulator-writer.mjs';

if(process.env.FG_SIGNED_STAGING_BRIDGE_TEST!=='1'||
   process.env.FIREBASE_DATABASE_EMULATOR_HOST!=='127.0.0.1:9000')
  throw Error('Signed staging tests only run against local Firebase RTDB emulator');

const uid='device-stage-a',root='/floodguard',now=1700000003500;
const stagePath=root+'/staging/ingestV1/'+uid;
const signer=generateKeyPairSync('ed25519');
const receipts=generateKeyPairSync('ed25519');
const fingerprint=k=>createHash('sha256')
  .update(k.export({format:'der',type:'spki'})).digest('hex');
const frame=sequence=>({
  sequence,distanceCm:16.5,levelCm:8.5,risk:'WARNING'
});
const envelopeFor=sequence=>({
  version:'floodguard-offline-envelope-v1',deviceId:uid,epoch:1,
  observedAtMs:now-400,frame:frame(sequence)
});
function signed(sequence=1){
  const envelope=envelopeFor(sequence);
  const canonical=canonicalOfflineEnvelope(envelope);
  const digest=createHash('sha256').update(canonical).digest('hex');
  const receipt={
    version:'floodguard-offline-receipt-v1',deviceId:uid,epoch:1,
    sequence,digest,acceptedAtMs:now-100
  };
  return {
    envelope,
    deviceSignature:sign(null,Buffer.from(canonical),signer.privateKey)
      .toString('base64url'),
    receipt,
    receiptSignature:sign(null,Buffer.from(JSON.stringify(receipt)),
      receipts.privateKey).toString('base64url')
  };
}
let env,dir,operator,ledger;
const db=(id=uid,claims={fg_ingest_v1:true})=>
  env.authenticatedContext(id,claims).database();
const writer=(database=db(),clock=()=>now,issuer=receipts.publicKey)=>
  createSignedStagingEmulatorWriter({
    database,deviceId:uid,operatorRegistry:operator,replayLedger:ledger,
    receiptIssuerPublicKey:issuer,clock
  });
const admin=async fn=>{
  let value;
  await env.withSecurityRulesDisabled(async ctx=>{value=await fn(ctx.database());});
  return value;
};
const read=path=>admin(async database=>(await database.ref(path).get()).val());
before(async()=>{
  env=await initializeTestEnvironment({
    projectId:'demo-floodguard-strict',
    database:{
      host:'127.0.0.1',port:9000,
      rules:readFileSync('docs/firebase/phase-b-strict-readonly-live.rules.json','utf8')
    }
  });
});
after(async()=>{if(env)await env.cleanup();});
beforeEach(async()=>{
  dir=fs.mkdtempSync(path.join(os.tmpdir(),'fg-signed-staging-'));
  const key=randomBytes(32);
  operator=createOperatorDeviceRegistryLab({directory:dir,integrityKey:key});
  operator.commission();
  operator.enroll(uid,signer.publicKey);
  ledger=createStage7OfflineLedger({directory:dir,integrityKey:randomBytes(32)});
  assert.deepEqual(ledger.commit({
    uid,epoch:1,sequence:1,keyFingerprint:fingerprint(signer.publicKey)
  }),{accepted:true,sequence:1});
  await env.clearDatabase();
  await admin(database=>database.ref(root+'/deviceAuthorization').set({
    [uid]:{enabled:true,scope:'prototype-ingest-v1'},
    'device-stage-b':{enabled:true,scope:'prototype-ingest-v1'}
  }));
});
afterEach(()=>{if(dir)fs.rmSync(dir,{recursive:true,force:true});dir=undefined;});

test('valid signed frame and independent receipt stage exactly four fields via scoped client',async()=>{
  const outcome=await writer()(signed());
  assert.deepEqual(outcome,{
    staged:true,kind:'EMULATOR_CLIENT_WRITE_ACK_ONLY',sequence:1
  });
  assert.deepEqual(await read(stagePath),frame(1));
  await assertFails(db().ref(stagePath).get(),'no device read of staging lane');
  await assertFails(db().ref(root+'/live/water/status').set('SAFE'));
});

test('forged device signature, tampered envelope and invalid schema cannot stage',async()=>{
  const forgeries=[
    {...signed(),deviceSignature:'A'.repeat(86)},
    {...signed(),deviceSignature:null},
    {...signed(),envelope:{...signed().envelope,frame:{...frame(1),risk:'SAFE'}}},
    {...signed(),envelope:{...signed().envelope,frame:{...frame(1),gateCommand:'OPEN'}}},
    {...signed(),envelope:{...signed().envelope,deviceId:'device-stage-b'}}
  ];
  for(const message of forgeries)
    assert.equal((await writer()(message)).staged,false);
  assert.equal(await read(stagePath),null);
});

test('missing, forged, mismatched or stale receipts never authorize staging',async()=>{
  const pair=generateKeyPairSync('ed25519');
  const valid=signed();
  const forged=sign(null,Buffer.from(JSON.stringify(valid.receipt)),pair.privateKey)
    .toString('base64url');
  const bad=[
    {...valid,receiptSignature:null},
    {...valid,receiptSignature:forged},
    {...valid,receipt:{...valid.receipt,digest:'f'.repeat(64)}},
    {...valid,receipt:{...valid.receipt,acceptedAtMs:now-40000}},
    {...valid,receipt:{...valid.receipt,deviceId:'device-stage-b'}}
  ];
  for(const message of bad){
    assert.equal((await writer()(message)).staged,false);
  }
  assert.equal(await read(stagePath),null);
});

test('stale source, unavailable clock and expired proof fail before Firebase mutation',async()=>{
  const msg=signed();
  assert.deepEqual(await writer(db(),()=>now+40000)(msg),{
    staged:false,reason:'observation-not-fresh'
  });
  assert.deepEqual(await writer(db(),()=>Number.NaN)(msg),{
    staged:false,reason:'clock-unavailable'
  });
  assert.equal(await read(stagePath),null);
});

test('missing, revoked or mismatched operator registry denies signed telemetry',async()=>{
  operator.revoke(uid);
  assert.deepEqual(await writer()(signed()),{
    staged:false,reason:'operator-identity-unverified'
  });
  const registryFile=path.join(dir,'operator-device-registry-lab.json');
  const content=fs.readFileSync(registryFile,'utf8');
  fs.writeFileSync(registryFile,content.replace('"enabled":false','"enabled":true'));
  assert.deepEqual(await writer()(signed()),{
    staged:false,reason:'identity-or-evidence-unavailable'
  });
  assert.equal(await read(stagePath),null);
});

test('sealed replay checkpoint mismatch blocks staging; no invented ACK recovery',async()=>{
  const msg=signed();
  ledger.commit({uid,epoch:1,sequence:2,keyFingerprint:fingerprint(signer.publicKey)});
  assert.deepEqual(await writer()(msg),{
    staged:false,reason:'sealed-replay-checkpoint-mismatch'
  });
  assert.equal(await read(stagePath),null);
});

test('Firebase rules independently block missing claim, wrong UID and anonymous clients',async()=>{
  const badClients=[
    db(uid,{}),
    db('device-stage-b',{fg_ingest_v1:true}),
    env.unauthenticatedContext().database()
  ];
  for(const client of badClients){
    assert.deepEqual(await writer(client)(signed()),{
      staged:false,reason:'staging-write-outcome-unverified'
    });
  }
  assert.equal(await read(stagePath),null);
  assert.equal(ledger.last(uid).sequence,1);
});

test('signed next sequence stages, but duplicate delivery remains denied by RTDB rules',async()=>{
  assert.equal((await writer()(signed(1))).staged,true);
  assert.deepEqual(ledger.commit({
    uid,epoch:1,sequence:2,keyFingerprint:fingerprint(signer.publicKey)
  }),{accepted:true,sequence:2});
  assert.equal((await writer()(signed(2))).staged,true);
  assert.deepEqual(await writer()(signed(2)),{
    staged:false,reason:'staging-write-outcome-unverified'
  });
  assert.deepEqual(await read(stagePath),frame(2));
});

test('lost RTDB write acknowledgment returns uncertainty even when server committed',async()=>{
  let writes=0;
  const actual=db();
  const lostAck=Object.freeze({ref(path){
    assert.equal(path,stagePath,'bridge must not touch live or other device paths');
    return {async set(value){
      writes++;
      await actual.ref(path).set(value);
      throw Error('SIMULATED_LOST_ACK');
    }};
  }});
  assert.deepEqual(await writer(lostAck)(signed()),{
    staged:false,reason:'staging-write-outcome-unverified'
  });
  assert.equal(writes,1,'never repeat an uncertain client write');
  assert.deepEqual(await read(stagePath),frame(1),
    'privileged test observer may verify persistence but writer cannot');
});

test('authorization revocation in RTDB independently blocks otherwise valid evidence',async()=>{
  await admin(database=>database.ref(root+'/deviceAuthorization/'+uid+'/enabled')
    .set(false));
  assert.deepEqual(await writer()(signed()),{
    staged:false,reason:'staging-write-outcome-unverified'
  });
  assert.equal(await read(stagePath),null);
});

test('prototype documents that Firebase rules alone do not validate signatures',async()=>{
  // This intentional negative design finding is isolated inside the emulator.
  // An already-authorized mock principal can bypass the optional bridge and
  // write an UNSIGNED syntactically valid frame. Production must not assume
  // possession of the Firebase token proves possession of the device key.
  await db().ref(stagePath).set(frame(1));
  assert.deepEqual(await read(stagePath),frame(1));
  assert.equal((await writer()(signed())).staged,false,
    'bridge cannot override a preexisting monotonic staging record');
});
