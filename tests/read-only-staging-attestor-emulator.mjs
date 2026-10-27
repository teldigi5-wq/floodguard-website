// End-to-end LOCAL Firebase RTDB: authenticated test device stages a frame,
// a distinct read-only test issuer validates signed origin and database state,
// then a scoped publisher atomically commits a public-only water snapshot.
import {test,before,after,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash,generateKeyPairSync,sign} from 'node:crypto';
import {initializeTestEnvironment,assertFails,assertSucceeds}
  from '@firebase/rules-unit-testing';
import {canonicalOfflineEnvelope} from '../experiments/stage7-durable-ingress.mjs';
import {createReadOnlyEmulatorAttestor}
  from '../experiments/read-only-staging-attestor-emulator.mjs';
import {createSignedNarrowEmulatorPublisher}
  from '../experiments/signed-narrow-publisher-emulator.mjs';

if(process.env.FG_READ_ONLY_ATTESTOR_TEST!=='1'||
   process.env.FG_NARROW_SIGNED_BRIDGE_TEST!=='1'||
   process.env.FIREBASE_DATABASE_EMULATOR_HOST!=='127.0.0.1:9000')
  throw Error('Read-only attestor tests require the isolated local RTDB emulator');

const now=1700000003500,deviceId='device-stage-a';
const root='/floodguard',publication=root+'/publicationLab/water';
const actor='attestor-stage',publisherUid='publisher-water-stage';
const device=generateKeyPairSync('ed25519');
const receiptIssuer=generateKeyPairSync('ed25519');
const attestationIssuer=generateKeyPairSync('ed25519');
const fingerprint=createHash('sha256')
  .update(device.publicKey.export({format:'der',type:'spki'})).digest('hex');
const frame=(sequence=2,risk='WARNING')=>({
  sequence,distanceCm:16.5,levelCm:8.5,risk
});
const message=(sequence=2,risk='WARNING')=>{
  const envelope={
    version:'floodguard-offline-envelope-v1',deviceId,epoch:1,
    observedAtMs:now-400,frame:frame(sequence,risk)
  };
  const canonical=canonicalOfflineEnvelope(envelope);
  const digest=createHash('sha256').update(canonical).digest('hex');
  const receipt={
    version:'floodguard-offline-receipt-v1',deviceId,epoch:1,
    sequence,digest,acceptedAtMs:now-100
  };
  return {
    envelope,
    deviceSignature:sign(null,Buffer.from(canonical),device.privateKey).toString('base64url'),
    receipt,
    receiptSignature:sign(null,Buffer.from(JSON.stringify(receipt)),
      receiptIssuer.privateKey).toString('base64url')
  };
};
const seededWater={
  current:{distanceCm:20,levelCm:5,status:'SAFE',
    observedAtMs:now-3000,overallRisk:'UNKNOWN'},
  checkpoint:{initialized:true,deviceId,epoch:1,sequence:1,
    digest:'0'.repeat(64),observedAtMs:now-3000}
};
let env;
const authenticated=(id,claims)=>env.authenticatedContext(id,claims).database();
const deviceDb=()=>authenticated(deviceId,{fg_ingest_v1:true});
const attestorDb=()=>authenticated(actor,{fg_attest_ingest_v1:true});
const publisherDb=()=>authenticated(publisherUid,{fg_publish_water_v1:true});
async function admin(fn){
  let result;
  await env.withSecurityRulesDisabled(async ctx=>{result=await fn(ctx.database());});
  return result;
}
const read=path=>admin(async db=>(await db.ref(path).get()).val());
const modify=(path,value)=>admin(db=>db.ref(path).set(value));
const makeAttestor=(db=attestorDb(),clock=()=>now)=>
  createReadOnlyEmulatorAttestor({
    database:db,deviceId,devicePublicKey:device.publicKey,
    receiptPublicKey:receiptIssuer.publicKey,
    attestationPrivateKey:attestationIssuer.privateKey,clock
  });
const makePublisher=(db=publisherDb())=>createSignedNarrowEmulatorPublisher({
  database:db,trustedReceiptKey:receiptIssuer.publicKey,
  trustedAttestationKey:attestationIssuer.publicKey,clock:()=>now
});
async function stage(frameValue=frame(2)){
  return assertSucceeds(deviceDb().ref(root+'/staging/ingestV1/'+deviceId)
    .set(frameValue));
}
async function forward(payload,db=publisherDb()){
  const attested=await makeAttestor()(payload);
  if(!attested.issued)return {attested,published:null};
  const published=await makePublisher(db)({
    envelope:payload.envelope,receipt:payload.receipt,
    signature:payload.receiptSignature,
    attestation:attested.attestation,
    attestationSignature:attested.attestationSignature
  });
  return {attested,published};
}

before(async()=>{
  env=await initializeTestEnvironment({
    projectId:'demo-read-only-attestor',database:{
      host:'127.0.0.1',port:9000,
      rules:readFileSync('docs/firebase/phase-b-attestor-lab.rules.json','utf8')
    }
  });
});
after(async()=>{if(env)await env.cleanup();});
beforeEach(async()=>{
  await env.clearDatabase();
  await admin(db=>db.ref(root).set({
    deviceAuthorization:{
      [deviceId]:{enabled:true,scope:'prototype-ingest-v1'},
      'device-stage-b':{enabled:true,scope:'prototype-ingest-v1'}
    },
    attestorLabAuthorization:{
      [actor]:{
        enabled:true,scope:'attestor-ingest-v1',
        deviceId,epoch:1,deviceKeyFingerprint:fingerprint
      }
    },
    publisherLabAuthorization:{
      [publisherUid]:{
        enabled:true,scope:'publication-lab-water-v1',
        deviceId,epoch:1
      }
    },
    publicationLab:{water:seededWater},
    live:{
      water:{status:'SAFE',distanceCm:20,levelCm:5},
      gate:{status:'CLOSED',angle:0},
      system:{overallRisk:'UNKNOWN'},
      esp8266:{ip:'192.0.2.15',wifi:'SECRET-SYNTHETIC'}
    },
    bot:{contacts:'PRIVATE-SYNTHETIC'}
  }));
});

test('real scoped device stage -> independent read-only attestor -> scoped public transaction',async()=>{
  const data=message();
  await stage(data.envelope.frame);
  const before=await read(root);
  const {attested,published}=await forward(data);
  assert.equal(attested.issued,true);
  assert.deepEqual(published,{
    published:true,kind:'SIGNED_NARROW_EMULATOR_ONLY',sequence:2
  });
  const after=await read(root);
  assert.deepEqual(after.publicationLab.water.current,{
    distanceCm:16.5,levelCm:8.5,status:'WARNING',
    observedAtMs:data.envelope.observedAtMs,overallRisk:'UNKNOWN'
  });
  assert.equal(after.publicationLab.water.checkpoint.sequence,2);
  assert.deepEqual(after.live,before.live);
  assert.deepEqual(after.bot,before.bot);
  assert.deepEqual(after.staging,before.staging);
  assert.deepEqual(after.deviceAuthorization,before.deviceAuthorization);
  assert.deepEqual(after.attestorLabAuthorization,before.attestorLabAuthorization);
  const visitor=env.unauthenticatedContext().database();
  await assertSucceeds(visitor.ref(publication+'/current').get());
  await assertFails(visitor.ref(publication+'/checkpoint').get());
});

test('attestor role can read only its one enrolled device and own authorization',async()=>{
  await stage();
  const a=attestorDb();
  for(const path of [
    root+'/attestorLabAuthorization/'+actor,
    root+'/deviceAuthorization/'+deviceId,
    root+'/staging/ingestV1/'+deviceId
  ])await assertSucceeds(a.ref(path).get());
  for(const path of [
    root,root+'/staging',root+'/staging/ingestV1',
    root+'/staging/ingestV1/device-stage-b',
    root+'/deviceAuthorization',root+'/deviceAuthorization/device-stage-b',
    root+'/publisherLabAuthorization',root+'/publicationLab',
    publication+'/checkpoint',root+'/live/esp8266/ip',root+'/bot'
  ])await assertFails(a.ref(path).get());
  for(const path of [
    root+'/deviceAuthorization/'+deviceId+'/enabled',
    root+'/staging/ingestV1/'+deviceId,
    root+'/attestorLabAuthorization/'+actor+'/enabled',
    publication,root+'/live/gate/angle'
  ])await assertFails(a.ref(path).set('MALICIOUS-SYNTHETIC'));
});

test('attestor denies a signed payload when actual persisted sensor frame differs',async()=>{
  const data=message();
  await stage(frame(2,'DANGER'));
  const before=await read(publication);
  const out=await forward(data);
  assert.deepEqual(out.attested,{
    issued:false,reason:'staged-frame-not-confirmed'
  });
  assert.equal(out.published,null);
  assert.deepEqual(await read(publication),before);
});

test('no persisted staged frame means no database-confirmed attestation',async()=>{
  const result=await forward(message());
  assert.equal(result.attested.issued,false);
  assert.equal(result.published,null);
  assert.deepEqual(await read(publication),seededWater);
});

test('device and receipt signatures are separately verified before issuing evidence',async()=>{
  await stage();
  const original=message(),rootBefore=await read(root);
  for(const bad of [
    {...original,deviceSignature:'A'.repeat(86)},
    {...original,receiptSignature:'A'.repeat(86)},
    {...original,envelope:{...original.envelope,observedAtMs:now-600}},
    {...original,receipt:{...original.receipt,digest:'f'.repeat(64)}}
  ]){
    const result=await forward(bad);
    assert.equal(result.attested.issued,false);
  }
  assert.deepEqual(await read(root),rootBefore);
});

test('revoked device or revoked attestor cannot issue confirmation or publish',async()=>{
  await stage();
  const before=await read(publication);
  await modify(root+'/deviceAuthorization/'+deviceId+'/enabled',false);
  let res=await forward(message());
  assert.equal(res.attested.issued,false);
  assert.equal(res.published,null);
  await modify(root+'/deviceAuthorization/'+deviceId+'/enabled',true);
  await modify(root+'/attestorLabAuthorization/'+actor+'/enabled',false);
  res=await forward(message());
  assert.equal(res.attested.issued,false);
  assert.deepEqual(await read(publication),before);
});

test('wrong claim or wrong identity cannot retrieve private staging or produce attestation',async()=>{
  await stage();
  const wrongClaim=authenticated(actor,{fg_attest_ingest_v1:false});
  const wrongUid=authenticated('other-attestor',{fg_attest_ingest_v1:true});
  for(const db of [wrongClaim,wrongUid,env.unauthenticatedContext().database()]){
    await assertFails(db.ref(root+'/staging/ingestV1/'+deviceId).get());
    const result=await makeAttestor(db)(message());
    assert.equal(result.issued,false);
  }
});

test('operator-pinned device public key mismatch makes confirmation impossible',async()=>{
  await stage();
  await modify(root+'/attestorLabAuthorization/'+actor+'/deviceKeyFingerprint',
    'f'.repeat(64));
  const result=await forward(message());
  assert.deepEqual(result.attested,{
    issued:false,reason:'device-authorization-unverified'
  });
});

test('publisher cannot bypass its own role even with authentic read-only attestation',async()=>{
  await stage();
  const before=await read(publication);
  const {attested,published}=await forward(
    message(),authenticated(publisherUid,{fg_publish_water_v1:false}));
  assert.equal(attested.issued,true);
  assert.equal(published.published,false);
  assert.deepEqual(await read(publication),before);
});

test('replayed signed and persisted frame does not advance the checkpoint twice',async()=>{
  await stage();
  const data=message();
  assert.equal((await forward(data)).published.published,true);
  const afterFirst=await read(publication);
  const second=await forward(data);
  assert.equal(second.published.published,false);
  assert.deepEqual(await read(publication),afterFirst);
});

test('issuer module cannot write Firebase, issue network listeners or use Admin SDK',()=>{
  const s=readFileSync('experiments/read-only-staging-attestor-emulator.mjs','utf8');
  assert.doesNotMatch(s,/firebase-admin|serviceAccount|node:https|node:http/);
  // Node crypto hash.update is required to pin enrolled public keys.
  // Deny only Firebase mutation, transaction and listener methods.
  assert.doesNotMatch(s,/\b(?:database|db|ref)\.(?:set|update|transaction)\s*\(/);
  assert.doesNotMatch(s,/\.ref\([^)]*\)\.(?:set|update|transaction)\s*\(/);
  assert.doesNotMatch(s,/\b(?:writeFileSync|spawnSync|execSync)\s*\(/);
  assert.doesNotMatch(s,/\.listen\s*\(/);
  assert.match(s,/database\.ref\(path\)\.get\(\)/);
});
