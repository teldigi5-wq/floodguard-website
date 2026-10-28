// Actual isolated Realtime Database Emulator. All keys and auth synthetic.
// This tests a device -> immutable confirmed record -> read-only attestor ->
// narrow publisher pipeline; no existing public-live path ever changes.
import {test,before,after,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash,generateKeyPairSync,sign} from 'node:crypto';
import {initializeTestEnvironment,assertFails,assertSucceeds}
  from '@firebase/rules-unit-testing';
import {canonicalOfflineEnvelope} from '../experiments/stage7-durable-ingress.mjs';
import {createVersionedEmulatorConfirmer,createVersionedEmulatorAttestor}
  from '../experiments/versioned-confirmation-emulator.mjs';
import {createSignedNarrowEmulatorPublisher}
  from '../experiments/signed-narrow-publisher-emulator.mjs';

if(process.env.FG_VERSIONED_CONFIRMATION_TEST!=='1'||
   process.env.FG_NARROW_SIGNED_BRIDGE_TEST!=='1'||
   process.env.FIREBASE_DATABASE_EMULATOR_HOST!=='127.0.0.1:9000')
  throw Error('Versioned confirmation lab requires local RTDB emulator');

const now=1700000003500,uid='device-stage-a',root='/floodguard';
const base=root+'/confirmedLab/records/'+uid,water=root+'/publicationLab/water';
const deviceKey=generateKeyPairSync('ed25519');
const receiptKey=generateKeyPairSync('ed25519');
const attestorKey=generateKeyPairSync('ed25519');
const fingerprint=createHash('sha256')
  .update(deviceKey.publicKey.export({format:'der',type:'spki'})).digest('hex');
const frame=(seq=2,risk='WARNING')=>({
  sequence:seq,distanceCm:16.5,levelCm:8.5,risk
});
const evidence=(seq=2,risk='WARNING',when=now-400)=>{
  const envelope={
    version:'floodguard-offline-envelope-v1',deviceId:uid,epoch:1,
    observedAtMs:when,frame:frame(seq,risk)
  };
  const canonical=canonicalOfflineEnvelope(envelope);
  const digest=createHash('sha256').update(canonical).digest('hex');
  const receipt={
    version:'floodguard-offline-receipt-v1',
    deviceId:uid,epoch:1,sequence:seq,digest,acceptedAtMs:now-100
  };
  return {
    envelope,receipt,
    deviceSignature:sign(null,Buffer.from(canonical),deviceKey.privateKey).toString('base64url'),
    receiptSignature:sign(null,Buffer.from(JSON.stringify(receipt)),receiptKey.privateKey)
      .toString('base64url')
  };
};
const initialized={
  current:{distanceCm:20,levelCm:5,status:'SAFE',
    observedAtMs:now-3000,overallRisk:'UNKNOWN'},
  checkpoint:{initialized:true,deviceId:uid,epoch:1,sequence:1,
    digest:'0'.repeat(64),observedAtMs:now-3000}
};
let env;
const as=(name,claims)=>env.authenticatedContext(name,claims).database();
const dev=()=>as(uid,{fg_ingest_v1:true});
const confirmer=()=>as('confirmer-stage',{fg_confirm_ingest_v1:true});
const attestor=()=>as('attestor-stage',{fg_attest_ingest_v1:true});
const publisher=()=>as('publisher-water-stage',{fg_publish_water_v1:true});
async function operator(fn){
  let value;
  await env.withSecurityRulesDisabled(async c=>{value=await fn(c.database());});
  return value;
}
const get=p=>operator(async db=>(await db.ref(p).get()).val());
const set=(p,x)=>operator(db=>db.ref(p).set(x));
const stage=(f=frame())=>assertSucceeds(dev().ref(root+'/staging/ingestV1/'+uid).set(f));
const makeConfirmer=(db=confirmer())=>createVersionedEmulatorConfirmer({
  database:db,deviceId:uid,devicePublicKey:deviceKey.publicKey,
  receiptPublicKey:receiptKey.publicKey,clock:()=>now
});
const makeAttestor=(db=attestor())=>createVersionedEmulatorAttestor({
  database:db,deviceId:uid,devicePublicKey:deviceKey.publicKey,
  receiptPublicKey:receiptKey.publicKey,
  attestationPrivateKey:attestorKey.privateKey,clock:()=>now
});
const makePublisher=(db=publisher())=>createSignedNarrowEmulatorPublisher({
  database:db,trustedReceiptKey:receiptKey.publicKey,
  trustedAttestationKey:attestorKey.publicKey,clock:()=>now
});
async function advance(input=evidence()){
  const confirmed=await makeConfirmer()(input);
  if(!confirmed.ok)return {confirmed,attested:null,published:null};
  const attested=await makeAttestor()(input);
  if(!attested.ok)return {confirmed,attested,published:null};
  const published=await makePublisher()({
    envelope:input.envelope,receipt:input.receipt,
    signature:input.receiptSignature,
    attestation:attested.attestation,
    attestationSignature:attested.attestationSignature
  });
  return {confirmed,attested,published};
}

before(async()=>{
  env=await initializeTestEnvironment({
    projectId:'demo-versioned-confirmation-lab',
    database:{host:'127.0.0.1',port:9000,
      rules:readFileSync('docs/firebase/phase-b-versioned-confirmation-lab.rules.json','utf8')}
  });
});
after(async()=>{if(env)await env.cleanup();});
beforeEach(async()=>{
  await env.clearDatabase();
  await operator(db=>db.ref(root).set({
    deviceAuthorization:{[uid]:{enabled:true,scope:'prototype-ingest-v1'}},
    confirmerLabAuthorization:{'confirmer-stage':{
      enabled:true,scope:'confirmer-ingest-v1',
      deviceId:uid,epoch:1,deviceKeyFingerprint:fingerprint
    }},
    attestorLabAuthorization:{'attestor-stage':{
      enabled:true,scope:'attestor-ingest-v1',
      deviceId:uid,epoch:1,deviceKeyFingerprint:fingerprint
    }},
    publisherLabAuthorization:{'publisher-water-stage':{
      enabled:true,scope:'publication-lab-water-v1',
      deviceId:uid,epoch:1
    }},
    publicationLab:{water:initialized},
    live:{water:{status:'SAFE'},gate:{status:'CLOSED',angle:0},
      system:{overallRisk:'UNKNOWN'},
      esp8266:{ip:'192.0.2.23',wifi:'PRIVATE-TEST'}},
    bot:{recipients:'PRIVATE-TEST'}
  }));
});

test('real emulator: authenticated device staging -> write-once confirmation -> read-only attestor -> scoped publication',async()=>{
  const item=evidence();await stage();
  const before=await get(root);
  const {confirmed,attested,published}=await advance(item);
  assert.equal(confirmed.ok,true);
  assert.equal(attested.ok,true);
  assert.deepEqual(published,{
    published:true,kind:'SIGNED_NARROW_EMULATOR_ONLY',sequence:2
  });
  const after=await get(root);
  assert.equal(after.publicationLab.water.current.status,'WARNING');
  assert.equal(after.publicationLab.water.checkpoint.sequence,2);
  assert.equal(after.confirmedLab.records[uid]['2'].digest,item.receipt.digest);
  for(const key of ['live','bot','deviceAuthorization',
    'attestorLabAuthorization','confirmerLabAuthorization'])
    assert.deepEqual(after[key],before[key]);
  await assertSucceeds(env.unauthenticatedContext().database()
    .ref(water+'/current').get());
  await assertFails(env.unauthenticatedContext().database()
    .ref(base+'/2').get());
});

test('immutable record cannot be overwritten or removed by confirmer after first commit',async()=>{
  await stage();const item=evidence();
  assert.equal((await makeConfirmer()(item)).ok,true);
  const initial=await get(base+'/2');
  assert.deepEqual(await makeConfirmer()(item),{
    ok:false,reason:'confirmed-record-write-denied'
  });
  await assertFails(confirmer().ref(base+'/2').remove());
  await assertFails(confirmer().ref(base+'/2/frame/risk').set('SAFE'));
  await assertFails(confirmer().ref(base+'/2').set({...initial,digest:'0'.repeat(64)}));
  assert.deepEqual(await get(base+'/2'),initial);
});

test('confirmation survives mutation of the mutable latest stage to a new frame',async()=>{
  await stage();const item=evidence();
  assert.equal((await makeConfirmer()(item)).ok,true);
  await stage(frame(3,'DANGER'));
  const attested=await makeAttestor()(item);
  assert.equal(attested.ok,true);
  const published=await makePublisher()({
    envelope:item.envelope,receipt:item.receipt,
    signature:item.receiptSignature,attestation:attested.attestation,
    attestationSignature:attested.attestationSignature
  });
  assert.equal(published.published,true);
  assert.equal((await get(water+'/current')).status,'WARNING');
  assert.equal((await get(base+'/2')).frame.risk,'WARNING');
});

test('record cannot be inserted under a sequence key different from its content',async()=>{
  await stage();const item=evidence();
  assert.equal((await makeConfirmer()(item)).ok,true);
  const record=await get(base+'/2');
  await assertFails(confirmer().ref(base+'/200').set(record));
  assert.equal(await get(base+'/200'),null);
});

test('confirmation is denied if stage changes before commit (rules re-check source)',async()=>{
  await stage(frame(3,'DANGER'));const item=evidence(2,'WARNING');
  const before=await get(water);
  assert.equal((await makeConfirmer()(item)).ok,false);
  assert.equal(await get(base+'/2'),null);
  assert.deepEqual(await get(water),before);
});

test('forged device signature or receipt does not create a record',async()=>{
  await stage();const item=evidence();
  for(const modified of [
    {...item,deviceSignature:'A'.repeat(86)},
    {...item,receiptSignature:'A'.repeat(86)},
    {...item,envelope:{...item.envelope,frame:frame(2,'DANGER')}},
    {...item,receipt:{...item.receipt,digest:'0'.repeat(64)}}
  ]){
    assert.equal((await makeConfirmer()(modified)).ok,false);
    assert.equal(await get(base+'/2'),null);
  }
});

test('read-only attestor cannot write confirmation, modify device or read other private data',async()=>{
  await stage();
  assert.equal((await makeConfirmer()(evidence())).ok,true);
  await assertSucceeds(attestor().ref(base+'/2').get());
  for(const x of [
    root,root+'/confirmedLab',root+'/confirmedLab/records',
    root+'/publisherLabAuthorization',root+'/live/esp8266/ip',
    root+'/bot',root+'/publicationLab/water/checkpoint'
  ])await assertFails(attestor().ref(x).get());
  for(const x of [
    base+'/2',root+'/deviceAuthorization/'+uid+'/enabled',
    root+'/live/gate/angle',water,root+'/attestorLabAuthorization/attestor-stage'
  ])await assertFails(attestor().ref(x).set('FORGED'));
});

test('scoped confirmer may only read one staging path and write its own write-once record',async()=>{
  await stage();
  await assertSucceeds(confirmer().ref(root+'/staging/ingestV1/'+uid).get());
  await assertFails(confirmer().ref(root+'/live/gate/angle').set(90));
  await assertFails(confirmer().ref(root+'/publicationLab/water').set(initialized));
  await assertFails(confirmer().ref(root+'/deviceAuthorization/'+uid+'/enabled').set(false));
  await assertFails(confirmer().ref(root+'/confirmedLab/records/device-stage-b/2').set({
    version:'floodguard-confirmed-record-v1',epoch:1,sequence:2,
    digest:'0'.repeat(64),acceptedAtMs:now-100,observedAtMs:now-400,
    frame:frame()
  }));
});

test('revoked device blocks new confirmations and direct publishing even with signed prior attestation',async()=>{
  await stage();
  const item=evidence();
  assert.equal((await makeConfirmer()(item)).ok,true);
  const attested=await makeAttestor()(item);
  assert.equal(attested.ok,true);
  await set(root+'/deviceAuthorization/'+uid+'/enabled',false);
  const before=await get(water);
  assert.equal((await makeAttestor()(item)).ok,false);
  const denied=await makePublisher()({
    envelope:item.envelope,receipt:item.receipt,
    signature:item.receiptSignature,attestation:attested.attestation,
    attestationSignature:attested.attestationSignature
  });
  assert.equal(denied.published,false);
  assert.deepEqual(await get(water),before);
});

test('revoked confirmer or attestor prevents fresh records or publication',async()=>{
  await stage();
  const item=evidence();
  await set(root+'/confirmerLabAuthorization/confirmer-stage/enabled',false);
  assert.equal((await makeConfirmer()(item)).ok,false);
  await set(root+'/confirmerLabAuthorization/confirmer-stage/enabled',true);
  assert.equal((await makeConfirmer()(item)).ok,true);
  const attested=await makeAttestor()(item);
  assert.equal(attested.ok,true);
  await set(root+'/attestorLabAuthorization/attestor-stage/enabled',false);
  const before=await get(water);
  const pub=await makePublisher()({
    envelope:item.envelope,receipt:item.receipt,
    signature:item.receiptSignature,attestation:attested.attestation,
    attestationSignature:attested.attestationSignature
  });
  assert.equal(pub.published,false);
  assert.deepEqual(await get(water),before);
});

test('missing confirmation is not a publication receipt',async()=>{
  await stage();
  const item=evidence();
  const checked=await makeAttestor()(item);
  assert.equal(checked.ok,false);
  assert.deepEqual(await get(water),initialized);
});

test('isolated record is write-once even with concurrent identical submissions',async()=>{
  await stage();
  const item=evidence();
  const results=await Promise.all([
    makeConfirmer()(item),makeConfirmer()(item)
  ]);
  assert.equal(results.filter(x=>x.ok).length,1);
  assert.equal(results.filter(x=>!x.ok).length,1);
  assert.equal((await get(base+'/2')).digest,item.receipt.digest);
});

test('versioned prototype module cannot mutate unrelated paths or open network services',()=>{
  const c=readFileSync('experiments/versioned-confirmation-emulator.mjs','utf8');
  assert.match(c,/ROOT\+'\/confirmedLab\/records\/'/);
  assert.doesNotMatch(c,/firebase-admin|serviceAccount|node:https|node:http|\.listen\s*\(/);
  assert.doesNotMatch(c,/\.update\s*\(|\.transaction\s*\(/);
  assert.doesNotMatch(c,/\.ref\('\/floodguard'\)/);
});
