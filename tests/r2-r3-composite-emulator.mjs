// Disposable, synthetic-only integration of immutable PR #37 signed planning
// and byte-identical PR #34 public scalar rules/projector fixtures.
// NEVER point this file at a real Firebase database or deploy the fixture rules.
import {before,after,beforeEach,test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash,generateKeyPairSync,sign} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {initializeTestEnvironment,assertFails,assertSucceeds} from '@firebase/rules-unit-testing';
import {canonicalOfflineEnvelope} from '../experiments/stage7-durable-ingress.mjs';
import {planSignedWaterLeafBridgeLab,SIGNED_WATER_LEAF_LAB_FIELDS,
  SIGNED_WATER_LEAF_LAB_ROOT} from '../experiments/signed-water-leaf-bridge-lab.mjs';
import {projectPublicTelemetryLabV1,PUBLIC_TELEMETRY_LAB_FIELDS,
  PUBLIC_TELEMETRY_LAB_ROOT} from './fixtures/pr34/public-telemetry-leaf-projection-lab.mjs';

const HOST='127.0.0.1:9000',ID='demo-fg-r2-r3-composite',NOW=1793450000500;
if(process.env.FG_R2_R3_COMPOSITE_LAB!=='1' ||
   process.env.FIREBASE_DATABASE_EMULATOR_HOST!==HOST)
  throw Error('Requires explicit isolated loopback Firebase RTDB Emulator');

const ROOT='/floodguard/publicTelemetryLabV1';
const SECRET='SYNTHETIC_NESTED_NOT_FOR_PRODUCTION';
let env;
const guest=()=>env.unauthenticatedContext().database();
const appUser=()=>env.authenticatedContext('untrusted-app-user',{admin:true}).database();
const privileged=async fn=>{
  let result;
  await env.withSecurityRulesDisabled(async ctx=>{result=await fn(ctx.database());});
  return result;
};

function fixture({risk='WARNING',distance=16.5,level=8.5,seq=1}={}) {
  const pair=generateKeyPairSync('ed25519');
  const envelope={
    version:'floodguard-offline-envelope-v1',
    deviceId:'device-stage-a',epoch:1,observedAtMs:NOW-1000,
    frame:{sequence:seq,distanceCm:distance,levelCm:level,risk},
  };
  const digest=createHash('sha256')
    .update(canonicalOfflineEnvelope(envelope),'utf8').digest('hex');
  const receipt={
    version:'floodguard-offline-receipt-v1',deviceId:envelope.deviceId,
    epoch:1,sequence:seq,digest,acceptedAtMs:NOW-250,
  };
  const signature=sign(null,Buffer.from(JSON.stringify(receipt)),
    pair.privateKey).toString('base64url');
  return {
    envelope,receipt,signature,trustedReceiptKey:pair.publicKey,
    registryBinding:{deviceId:'device-stage-a',epoch:1,enabled:true,scope:'prototype-ingest-v1'},
    databaseRecord:{deviceId:'device-stage-a',epoch:1,sequence:seq,digest,
      acceptedAtMs:NOW-250,status:'DATABASE_CONFIRMED'},
    lastPublished:{initialized:false},nowMs:NOW,
  };
}

function verifiedScalarProjection(plan) {
  if(plan?.planned!==true ||plan.root!==ROOT ||
     Object.keys(plan.proposedLeaves).join('|')!==SIGNED_WATER_LEAF_LAB_FIELDS.join('|'))
    throw Error('Unverified offline planner output');
  const structured=Object.create(null);
  for(const [path,value] of Object.entries(plan.proposedLeaves)) {
    const parts=path.split('/');
    if(parts.length!==2)throw Error('Non-leaf public path');
    const [group,field]=parts;
    if(!PUBLIC_TELEMETRY_LAB_FIELDS[group]?.includes(field))
      throw Error('Unapproved public field');
    if(value===null || !['string','number','boolean'].includes(typeof value))
      throw Error('Non-primitive public value');
    structured[group] ??= Object.create(null);
    structured[group][field]=value;
  }
  const projected=projectPublicTelemetryLabV1(structured);
  // The Firebase SDK serializer requires an own hasOwnProperty method.
  const json=JSON.parse(JSON.stringify(projected));
  const projectedKeys=Object.entries(json).flatMap(([g,fields])=>
    Object.keys(fields).map(f=>g+'/'+f));
  assert.deepEqual(projectedKeys,SIGNED_WATER_LEAF_LAB_FIELDS);
  return json;
}

async function simulatePrivilegedProjection(source) {
  const planned=planSignedWaterLeafBridgeLab(source);
  if(planned.planned!==true)return planned; // rejected plans must never write
  const projected=verifiedScalarProjection(planned);
  // This is an explicit, test-only rules-disabled seed, NOT a production
  // privileged publisher or atomic durable acknowledgement.
  await privileged(db=>db.ref(ROOT).set(projected));
  return planned;
}
const read=async path=>(await assertSucceeds(guest().ref(path).get())).val();

before(async()=>{
  env=await initializeTestEnvironment({
    projectId:ID,
    database:{host:'127.0.0.1',port:9000,
      rules:readFileSync('tests/fixtures/pr34/public-telemetry-leaf-lab.rules.json','utf8')}
  });
});
after(async()=>{if(env)await env.cleanup();});
beforeEach(async()=>{await env.clearDatabase();});

test('pinned isolated schema has no broad reads/writes and all paths are approved primitives',()=>{
  assert.equal(PUBLIC_TELEMETRY_LAB_ROOT,ROOT);
  assert.equal(SIGNED_WATER_LEAF_LAB_ROOT,ROOT);
  assert.deepEqual(SIGNED_WATER_LEAF_LAB_FIELDS,[
    'water/distanceCm','water/levelCm','water/status',
    'system/lastUpdate','system/overallRisk']);
  const rules=JSON.parse(readFileSync(
    'tests/fixtures/pr34/public-telemetry-leaf-lab.rules.json','utf8')).rules;
  assert.equal(rules['.read'],false);
  assert.equal(rules['.write'],false);
  assert.equal(rules.floodguard.publicTelemetryLabV1.water['.read'],undefined);
  assert.equal(rules.floodguard.publicTelemetryLabV1.water.status['.read'],true);
  for(const [group,fields] of Object.entries(PUBLIC_TELEMETRY_LAB_FIELDS)){
    assert.equal(rules.floodguard.publicTelemetryLabV1[group]['.read'],undefined);
    for(const field of fields)
      assert.deepEqual(rules.floodguard.publicTelemetryLabV1[group][field],{'.read':true});
  }
});

test('signed+confirmed water WARNING produces exactly five readable public leaves',async()=>{
  const data=fixture();
  const plan=await simulatePrivilegedProjection(data);
  assert.equal(plan.planned,true);
  assert.equal(plan.sourceTrust,'SYNTHETIC_EVIDENCE_ONLY');
  for(const [field,value] of Object.entries(plan.proposedLeaves))
    assert.deepEqual(await read(ROOT+'/'+field),value);
  assert.equal(await read(ROOT+'/water/status'),'WARNING');
  assert.equal(await read(ROOT+'/system/overallRisk'),'UNKNOWN');
  assert.equal(plan.physicalGatePosition,'UNVERIFIED');
  assert.equal(plan.readyForActuation,false);
  const populated=await privileged(db=>db.ref(ROOT).get());
  assert.deepEqual(Object.keys(populated.val()).sort(),['system','water']);
});

test('anonymous reads of parents, private telemetry and legacy live paths remain denied',async()=>{
  await simulatePrivilegedProjection(fixture());
  await privileged(db=>db.ref('/floodguard/live/esp8266').set(
    {ip:'SYNTHETIC_IP',wifi:'SYNTHETIC_WIFI'}));
  await privileged(db=>db.ref('/floodguard/privateIngest').set(
    {receipt:'SYNTHETIC_PRIVATE_RECEIPT'}));
  for(const path of [
    '/', '/floodguard',ROOT,ROOT+'/water',ROOT+'/system',
    ROOT+'/esp8266',ROOT+'/esp8266/ip',ROOT+'/esp8266/wifi',
    ROOT+'/gate',ROOT+'/alarm',
    '/floodguard/live','/floodguard/live/water/status',
    '/floodguard/live/esp8266/ip','/floodguard/privateIngest'
  ])await assertFails(guest().ref(path).get());
  // Approved empty scalar leaves are readable as null; not actual gate proof.
  assert.equal(await read(ROOT+'/gate/status'),null);
  assert.equal(await read(ROOT+'/alarm/active'),null);
});

test('untrusted anonymous and ordinary authenticated clients cannot publish or operate gate',async()=>{
  await simulatePrivilegedProjection(fixture());
  for(const db of [guest(),appUser()]){
    for(const path of [ROOT,ROOT+'/water',ROOT+'/water/status',
      ROOT+'/system/overallRisk',ROOT+'/gate/status',
      '/floodguard/live','/floodguard/confirmedIngest']){
      await assertFails(db.ref(path).set('FORGED'));
    }
    await assertFails(db.ref(ROOT).update({'water/status':'SAFE'}));
    await assertFails(db.ref('/floodguard/live/gate/status').set('OPEN'));
  }
  assert.equal(await read(ROOT+'/water/status'),'WARNING');
});

test('invalid signed receipts and unconfirmed frames cannot alter emulator state',async()=>{
  const data=fixture();
  const good=await simulatePrivilegedProjection(data);
  assert.equal(good.planned,true);
  const stranger=generateKeyPairSync('ed25519');
  const negatives=[
    {...data,trustedReceiptKey:stranger.publicKey},
    {...data,databaseRecord:{...data.databaseRecord,status:'PENDING'}},
    {...data,registryBinding:{...data.registryBinding,enabled:false}},
    {...data,signature:'A'.repeat(86)},
    {...data,envelope:{...data.envelope,frame:{...data.envelope.frame,risk:'SAFE'}}},
    {...data,lastPublished:{initialized:true,epoch:1,sequence:1,digest:data.receipt.digest}},
  ];
  for(const bad of negatives)assert.equal(
    (await simulatePrivilegedProjection(bad)).planned,false);
  assert.equal(await read(ROOT+'/water/status'),'WARNING');
});

test('synthetic signed SAFE report is not a claim of physical safety, gate or human alert',async()=>{
  const plan=await simulatePrivilegedProjection(fixture({
    risk:'SAFE',distance:18.5,level:6.5
  }));
  assert.equal(plan.planned,true);
  assert.equal(await read(ROOT+'/water/status'),'SAFE');
  assert.equal(await read(ROOT+'/system/overallRisk'),'UNKNOWN');
  assert.equal(plan.floodClearance,'UNKNOWN');
  assert.equal(plan.physicalGatePosition,'UNVERIFIED');
  assert.equal(plan.notificationDelivery,'NOT_VERIFIED');
});

test('privileged writes are dangerous: nested data under a public leaf is readable',async()=>{
  // Demonstrate a KNOWN authorization limitation: .read:true on a leaf is
  // inherited by the leaf's children if an Admin accidentally writes an
  // object. Never publish these rules without schema-gated writer controls.
  await privileged(db=>db.ref(ROOT+'/water/status').set(
    {unexpected:SECRET}));
  assert.equal(await read(ROOT+'/water/status/unexpected'),SECRET);
  assert.throws(()=>projectPublicTelemetryLabV1({
    water:{status:{unexpected:SECRET}}
  }),/Invalid public field/);
  assert.equal((await simulatePrivilegedProjection({
    ...fixture(),registryBinding:{enabled:false}
  })).planned,false);
});

test('pure test harness contains no production database hostname or credentials',()=>{
  const src=readFileSync('tests/r2-r3-composite-emulator.mjs','utf8');
  // Build disallowed markers without including those exact strings in source.
  const disallowed=[
    'firebaseio'+'.com','firebasedatabase'+'.app',
    'service'+'Account','process.env.'+'FIREBASE_TOKEN'
  ];
  assert.ok(disallowed.every(marker=>!src.includes(marker)));
});
