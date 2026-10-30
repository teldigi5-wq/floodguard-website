// R2 isolated Firebase Realtime Database Emulator ONLY.
// Uses synthetic Ed25519 keys and operator test identities. No production data.
import {test,before,after,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {generateKeyPairSync,sign} from 'node:crypto';
import {initializeTestEnvironment,assertFails,assertSucceeds}
  from '@firebase/rules-unit-testing';
import {canonicalR2PublicEvidence,R2_PUBLIC_PROOF_VERSION,
  verifyR2PublicEvidence} from '../experiments/r2-dual-stream-public-evidence.mjs';

if (process.env.FG_R2_DUAL_STREAM_EMULATOR_TEST!=='1' ||
    process.env.FIREBASE_DATABASE_EMULATOR_HOST!=='127.0.0.1:9000')
  throw Error('R2 public proof rules tests require loopback demo emulator');

const root='/floodguard',evidence=root+'/evidenceLabV1';
const now=Date.UTC(2026,9,30,10,0,0);
const signers={water:generateKeyPairSync('ed25519'),
  rain:generateKeyPairSync('ed25519')};
const rules=readFileSync('docs/firebase/r2-dual-stream-public-evidence-lab.rules.json','utf8');
let env;
const payload=(stream,sequence=2,observedAtMs=now-3000)=>({
  version:R2_PUBLIC_PROOF_VERSION,stream,
  sourceAlias:stream==='water'?'water-primary':'rain-primary',
  epoch:1,sequence,observedAtMs,receivedAtMs:observedAtMs+500,
  sample:stream==='water'
    ? {distanceCm:16.5,levelCm:8.5,reportedStatus:'WARNING'}
    : {currentMm:2,dailyMm:12,reportedStatus:'NORMAL'}
});
const signed=p=>({
  payload:p,signature:sign(null,Buffer.from(canonicalR2PublicEvidence(p),'utf8'),
    signers[p.stream].privateKey).toString('base64url')
});
const publisher=stream=>env.authenticatedContext(
  stream==='water'?'r2-water-publisher':'r2-rain-publisher',
  {[stream==='water'?'fg_r2_water_publish':'fg_r2_rain_publish']:true}
).database();
const visitor=()=>env.unauthenticatedContext().database();
async function privileged(action) {
  let output;
  await env.withSecurityRulesDisabled(async ctx=>{
    output=await action(ctx.database());
  });
  return output;
}
const current=path=>privileged(async db=>(await db.ref(path).get()).val());

before(async()=>{
  env=await initializeTestEnvironment({
    projectId:'demo-fg-r2-dual-stream',
    database:{host:'127.0.0.1',port:9000,rules}
  });
});
after(async()=>{if(env)await env.cleanup();});
beforeEach(async()=>{
  await env.clearDatabase();
  await privileged(db=>db.ref(root).set({
    evidenceLabAuthorization:{
      'r2-water-publisher':{enabled:true,scope:'r2-water-publish-v1'},
      'r2-rain-publisher':{enabled:true,scope:'r2-rain-publish-v1'}
    },
    evidenceLabV1:{
      water:signed(payload('water',1,now-5000)),
      rain:signed(payload('rain',1,now-5000))
    },
    confirmedIngest:{'device-stage-a':{privateReceipt:'SECRET-IN-TEST'}},
    staging:{ingestV1:{'device-stage-a':{sequence:1}}},
    projectionControl:{devices:{'device-stage-a':{sequence:1}}},
    bot:{contacts:{'synthetic-1':'PRIVATE-TEST'}},
    live:{esp8266:{ip:'192.0.2.10',wifi:'PRIVATE-TEST'},
      gate:{status:'CLOSED',angle:0},system:{overallRisk:'UNKNOWN'}}
  }));
});

test('anonymous clients can read only the signed evidence leaves',async()=>{
  for(const stream of ['water','rain']){
    const output=(await assertSucceeds(visitor().ref(evidence+'/'+stream).get())).val();
    assert.equal(output.payload.stream,stream);
    assert.equal(verifyR2PublicEvidence({
      stream,record:output,trustedPublicKey:signers[stream].publicKey,
      nowMs:now,connected:true
    }).accepted,true);
    assert.equal(JSON.stringify(output).includes('device-stage-a'),false);
    assert.equal(JSON.stringify(output).includes('PRIVATE'),false);
  }
  for(const path of [root,evidence,root+'/evidenceLabAuthorization',
    root+'/confirmedIngest',root+'/staging',root+'/projectionControl',
    root+'/bot/contacts',root+'/live/esp8266/ip',root+'/live/gate'])
    await assertFails(visitor().ref(path).get());
});

test('only the separately scoped water and rain publisher can advance their own stream',async()=>{
  const before=await current(root);
  await assertSucceeds(publisher('water').ref(evidence+'/water').set(signed(payload('water'))));
  assert.deepEqual(await current(evidence+'/rain'),before.evidenceLabV1.rain);
  await assertSucceeds(publisher('rain').ref(evidence+'/rain').set(signed(payload('rain'))));
  const after=await current(root);
  assert.equal(after.evidenceLabV1.water.payload.sequence,2);
  assert.equal(after.evidenceLabV1.rain.payload.sequence,2);
  assert.deepEqual(after.confirmedIngest,before.confirmedIngest);
  assert.deepEqual(after.staging,before.staging);
  assert.deepEqual(after.live,before.live);

  await assertFails(publisher('water').ref(evidence+'/rain').set(signed(payload('rain',3))));
  await assertFails(publisher('rain').ref(evidence+'/water').set(signed(payload('water',3))));
});

test('anonymous, generic, wrong-UID, wrong-claim and device identities cannot write proof',async()=>{
  const actors=[
    visitor(),
    env.authenticatedContext('ordinary-user').database(),
    env.authenticatedContext('r2-water-publisher',{fg_r2_water_publish:false}).database(),
    env.authenticatedContext('wrong-water',{fg_r2_water_publish:true}).database(),
    env.authenticatedContext('device-stage-a',{fg_ingest_v1:true}).database()
  ];
  const before=await current(root);
  for(const db of actors) {
    await assertFails(db.ref(evidence+'/water').set(signed(payload('water'))));
    await assertFails(db.ref(evidence+'/rain').set(signed(payload('rain'))));
  }
  assert.deepEqual(await current(root),before);
});

test('scoped publishers cannot write root, private receipt, gate, or secrets',async()=>{
  const initial=await current(root);
  for(const db of [publisher('water'),publisher('rain')]){
    for(const path of [root,evidence,root+'/confirmedIngest/device-stage-a',
      root+'/staging',root+'/projectionControl',
      root+'/live/gate/angle',root+'/live/esp8266/ip',
      root+'/bot/contacts',root+'/evidenceLabAuthorization'])
      await assertFails(db.ref(path).set({spoofed:true}));
  }
  assert.deepEqual(await current(root),initial);
});

test('revocation, sequence replay, rollback and unauthorized source rotation fail closed',async()=>{
  for(const stream of ['water','rain']) {
    const db=publisher(stream),path=evidence+'/'+stream;
    await assertFails(db.ref(path).set(signed(payload(stream,1))));
    const malformed=signed(payload(stream,2));
    await assertFails(db.ref(path).set({
      ...malformed,payload:{...malformed.payload,sequence:0}
    }));
    await assertFails(db.ref(path).set(signed(payload(stream,2,now-6000))));
    await assertFails(db.ref(path).set(signed({...payload(stream),epoch:2})));
    await assertFails(db.ref(path).remove());
    await assertSucceeds(db.ref(path).set(signed(payload(stream))));
    await assertFails(db.ref(path+'/payload/sample/reportedStatus').set('SAFE'));
    await privileged(admin=>admin.ref(root+'/evidenceLabAuthorization/'+
      (stream==='water'?'r2-water-publisher':'r2-rain-publisher')+
      '/enabled').set(false));
    await assertFails(db.ref(path).set(signed(payload(stream,3))));
  }
});

test('schema rejects extra fields, malformed data, changed stream and private metadata',async()=>{
  for(const stream of ['water','rain']){
    const db=publisher(stream),path=evidence+'/'+stream;
    const good=signed(payload(stream));
    const rejects=[
      {...good,gateCommand:'OPEN'},
      {...good,payload:{...good.payload,deviceId:'device-stage-a'}},
      {...good,payload:{...good.payload,stream:stream==='water'?'rain':'water'}},
      {...good,payload:{...good.payload,sourceAlias:'impersonator'}},
      {...good,payload:{...good.payload,sample:{...good.payload.sample,ip:'192.0.2.10'}}},
      {...good,payload:{...good.payload,observedAtMs:null}},
      {...good,payload:{...good.payload,receivedAtMs:good.payload.observedAtMs-1}},
      {...good,signature:'not-a-signature'}
    ];
    for(const record of rejects)await assertFails(db.ref(path).set(record));
  }
});

test('rules alone cannot verify a forged signature; independent Ed25519 verification blocks it',async()=>{
  const fake=signed(payload('water'));
  fake.signature='A'.repeat(86);
  // This public writer's token does not prove possession of the signing key.
  // Data-shape rules may accept plausible forged signatures. The reader
  // therefore MUST verify against the pinned Ed25519 public key.
  await assertSucceeds(publisher('water').ref(evidence+'/water').set(fake));
  const visible=(await visitor().ref(evidence+'/water').get()).val();
  assert.equal(verifyR2PublicEvidence({
    stream:'water',record:visible,trustedPublicKey:signers.water.publicKey,
    connected:true,nowMs:now
  }).reason,'signature-unverified');
});

test('inspection and rules harness cannot reach production or run autonomous writes',()=>{
  const source=readFileSync('experiments/r2-dual-stream-public-evidence.mjs','utf8');
  assert.match(source,/FG_R2_DUAL_STREAM_EMULATOR_TEST/);
  assert.doesNotMatch(source,/firebase-admin|serviceAccount|https:\/\/|sendMessage\s*\(/);
});
