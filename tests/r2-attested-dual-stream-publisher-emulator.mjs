// Synthetic-only attested publisher on actual loopback Firebase RTDB Emulator.
// Identity and issuer keys are test fixtures. No real service or device data.
import {test,before,after,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign,createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {initializeTestEnvironment,assertFails}
  from '@firebase/rules-unit-testing';
import {canonicalR2PublicEvidence,R2_PUBLIC_PROOF_VERSION,
  verifyR2PublicEvidence} from '../experiments/r2-dual-stream-public-evidence.mjs';
import {canonicalR2PublisherReceipt,R2_ISSUER_RECEIPT_VERSION,
  publishR2AttestedLabReport}
  from '../experiments/r2-attested-dual-stream-publisher.mjs';

if (process.env.FG_R2_ATTESTED_PUBLISHER_LAB_TEST!=='1' ||
    process.env.FIREBASE_DATABASE_EMULATOR_HOST!=='127.0.0.1:9000')
  throw Error('Attested publisher requires isolated loopback RTDB Emulator');

const root='/floodguard',publicRoot=root+'/evidenceLabV1';
const now=Date.UTC(2026,9,30,13,0,0);
const keys={
  water:{report:generateKeyPairSync('ed25519'),
    issuer:generateKeyPairSync('ed25519')},
  rain:{report:generateKeyPairSync('ed25519'),
    issuer:generateKeyPairSync('ed25519')}
};
const rules=readFileSync('docs/firebase/r2-dual-stream-public-evidence-lab.rules.json','utf8');
const hash=s=>createHash('sha256').update(s,'utf8').digest('hex');
const fingerprint=k=>createHash('sha256')
  .update(k.export({type:'spki',format:'der'})).digest('hex');
const publisherId=s=>s==='water'?'r2-water-publisher':'r2-rain-publisher';
const scope=s=>s==='water'?'r2-water-publish-v1':'r2-rain-publish-v1';
const claim=s=>s==='water'?'fg_r2_water_publish':'fg_r2_rain_publish';
const alias=s=>s==='water'?'water-primary':'rain-primary';
const path=s=>publicRoot+'/'+s;
const makePayload=(stream,sequence=2,override={})=>({
  version:R2_PUBLIC_PROOF_VERSION,stream,sourceAlias:alias(stream),
  epoch:1,sequence,observedAtMs:now-3000,receivedAtMs:now-1500,
  sample:stream==='water'
    ? {distanceCm:16.5,levelCm:8.5,reportedStatus:'WARNING'}
    : {currentMm:2,dailyMm:12,reportedStatus:'NORMAL'},
  ...override
});
function signedReport(p){
  const bytes=canonicalR2PublicEvidence(p);
  return {payload:p,signature:sign(null,Buffer.from(bytes),
    keys[p.stream].report.privateKey).toString('base64url')};
}
function signedReceipt(p){
  const value={
    version:R2_ISSUER_RECEIPT_VERSION,stream:p.stream,
    sourceAlias:p.sourceAlias,epoch:p.epoch,sequence:p.sequence,
    payloadDigest:hash(canonicalR2PublicEvidence(p)),
    acceptedAtMs:p.receivedAtMs
  };
  return {receipt:value,receiptSignature:sign(null,
    Buffer.from(canonicalR2PublisherReceipt(value)),
    keys[p.stream].issuer.privateKey).toString('base64url')};
}
let env;
const database=s=>env.authenticatedContext(publisherId(s),{
  [claim(s)]:true
}).database();
const anonymous=()=>env.unauthenticatedContext().database();
async function admin(action){
  let output;
  await env.withSecurityRulesDisabled(async context=>{
    output=await action(context.database());
  });
  return output;
}
const readAdmin=p=>admin(async db=>(await db.ref(p).get()).val());
const readPublic=(s)=>anonymous().ref(path(s)).get().then(s=>s.val());
async function input(stream,sequence=2,override={}){
  const p=makePayload(stream,sequence,override);
  const binding=await readAdmin(root+'/evidenceLabAuthorization/'+publisherId(stream));
  return {
    database:database(stream),stream,record:signedReport(p),
    ...signedReceipt(p),
    trustedReportKey:keys[stream].report.publicKey,
    trustedReceiptKey:keys[stream].issuer.publicKey,
    registryBinding:binding,nowMs:now
  };
}
before(async()=>{
  env=await initializeTestEnvironment({projectId:'demo-fg-r2-attested',
    database:{host:'127.0.0.1',port:9000,rules}});
});
after(async()=>{if(env)await env.cleanup();});
beforeEach(async()=>{
  await env.clearDatabase();
  const registry={};
  const publicReports={};
  for(const stream of ['water','rain']){
    registry[publisherId(stream)]={
      stream,sourceAlias:alias(stream),epoch:1,enabled:true,
      scope:scope(stream),
      reportSignerFingerprint:fingerprint(keys[stream].report.publicKey),
      receiptSignerFingerprint:fingerprint(keys[stream].issuer.publicKey)
    };
    publicReports[stream]=signedReport(makePayload(stream,1,{
      observedAtMs:now-5000,receivedAtMs:now-4000
    }));
  }
  await admin(db=>db.ref(root).set({
    evidenceLabAuthorization:registry,evidenceLabV1:publicReports,
    staging:{ingestV1:{'device-stage-a':{privateTest:true}}},
    confirmedIngest:{'device-stage-a':{secret:'TEST_ONLY'}},
    live:{gate:{status:'CLOSED',angle:0},
      esp8266:{ip:'192.0.2.1',wifi:'PRIVATE-TEST'}},
    bot:{contacts:{test:'PRIVATE-TEST'}}
  }));
});

test('dual signed evidence publishes both streams at dedicated leaves only',async()=>{
  const prior=await readAdmin(root);
  for(const stream of ['water','rain']){
    const result=await publishR2AttestedLabReport(await input(stream));
    assert.deepEqual(result,{published:true,
      kind:'OFFLINE_EMULATOR_ATTESTED_PUBLISH_NOT_PRODUCTION'});
    const record=await readPublic(stream);
    assert.equal(record.payload.sequence,2);
    assert.equal(verifyR2PublicEvidence({
      stream,record,trustedPublicKey:keys[stream].report.publicKey,
      connected:true,nowMs:now
    }).accepted,true);
  }
  const next=await readAdmin(root);
  for(const field of ['staging','confirmedIngest','live','bot',
    'evidenceLabAuthorization'])
    assert.deepEqual(next[field],prior[field],field);
  assert.equal(JSON.stringify(await readPublic('water')).includes('device-stage-a'),false);
});

test('forged report or forged server receipt is blocked before any database write',async()=>{
  const baseline=await readAdmin(root);
  for(const stream of ['water','rain']){
    const x=await input(stream);
    for(const bad of [
      {...x,receiptSignature:'A'.repeat(86)},
      {...x,record:{...x.record,signature:'A'.repeat(86)}},
      {...x,receipt:{...x.receipt,payloadDigest:'0'.repeat(64)}},
      {...x,registryBinding:{...x.registryBinding,enabled:false}},
      {...x,registryBinding:{...x.registryBinding,receiptSignerFingerprint:'0'.repeat(64)}}
    ]){
      const result=await publishR2AttestedLabReport(bad);
      assert.equal(result.published,false);
    }
  }
  assert.deepEqual(await readAdmin(root),baseline);
});

test('replay remains rejected after creating a fresh publisher context',async()=>{
  const first=await input('water');
  assert.equal((await publishR2AttestedLabReport(first)).published,true);
  const freshConnection=await input('water');
  assert.equal((await publishR2AttestedLabReport(freshConnection)).published,false);
  assert.equal((await readPublic('water')).payload.sequence,2);
  assert.equal((await readPublic('rain')).payload.sequence,1);
});

test('concurrent identical source sequences can commit only once',async()=>{
  const [a,b]=await Promise.all([
    publishR2AttestedLabReport(await input('rain')),
    publishR2AttestedLabReport(await input('rain'))
  ]);
  assert.equal([a,b].filter(x=>x.published===true).length,1);
  assert.equal([a,b].filter(x=>x.published===false).length,1);
  assert.equal((await readPublic('rain')).payload.sequence,2);
});

test('old observation with increased sequence is denied by RTDB monotonic rules',async()=>{
  const before=await readAdmin(root);
  const bad=await input('water',2,{
    observedAtMs:now-6000,receivedAtMs:now-5000
  });
  const result=await publishR2AttestedLabReport(bad);
  assert.equal(result.published,false);
  assert.equal((await readPublic('water')).payload.sequence,1);
  assert.deepEqual((await readAdmin(root)).live,before.live);
});

test('signed proof cannot revive a forged public checkpoint without operator recovery',async()=>{
  const poisoned=signedReport(makePayload('water',1,{
    observedAtMs:now-5000,receivedAtMs:now-4000
  }));
  poisoned.signature='A'.repeat(86);
  // Security rules check shape/claims, not Ed25519. A lab-only privileged
  // mutation simulates a compromised publisher's old forged checkpoint.
  await admin(db=>db.ref(path('water')).set(poisoned));
  const result=await publishR2AttestedLabReport(await input('water'));
  assert.deepEqual(result,{published:false,reason:'published-checkpoint-unverified'});
  assert.equal((await readPublic('water')).signature,'A'.repeat(86));
});

test('revoked publisher and wrong publisher identity cannot commit',async()=>{
  const x=await input('rain');
  await admin(db=>db.ref(root+'/evidenceLabAuthorization/'+publisherId('rain')+
    '/enabled').set(false));
  assert.equal((await publishR2AttestedLabReport(x)).published,false);
  const y=await input('water');
  const wrong=env.authenticatedContext('wrong-water',{fg_r2_water_publish:true}).database();
  assert.equal((await publishR2AttestedLabReport({...y,database:wrong})).published,false);
  assert.equal((await readPublic('water')).payload.sequence,1);
  await assertFails(anonymous().ref(path('rain')).set(signedReport(makePayload('rain'))));
});

test('legitimate newer observation remains publishable after old historical timestamp',async()=>{
  // The previous frame can be older than the 10s display freshness window.
  await admin(db=>db.ref(path('water')).set(signedReport(makePayload('water',1,{
    observedAtMs:now-80000,receivedAtMs:now-79000
  }))));
  const result=await publishR2AttestedLabReport(await input('water'));
  assert.equal(result.published,true);
  assert.equal((await readPublic('water')).payload.sequence,2);
});
