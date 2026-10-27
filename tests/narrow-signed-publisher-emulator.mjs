// Real local RTDB emulator: signed source -> scoped writer -> public snapshot.
// No remote Firebase, device, public web ingress, or notification hooks.
import {test,before,after,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {createHash,generateKeyPairSync,sign} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {initializeTestEnvironment,assertFails,assertSucceeds}
  from '@firebase/rules-unit-testing';
import {canonicalOfflineEnvelope} from '../experiments/stage7-durable-ingress.mjs';
import {publishSignedToNarrowEmulator} from '../experiments/signed-narrow-publisher-emulator.mjs';

if(process.env.FG_NARROW_SIGNED_BRIDGE_TEST!=='1'||
   process.env.FIREBASE_DATABASE_EMULATOR_HOST!=='127.0.0.1:9000')
  throw Error('Signed bridge requires isolated loopback RTDB emulator');

const now=1700000003500,prior=now-3000;
const path='/floodguard',pub=path+'/publicationLab/water';
const deviceId='device-stage-a',publisherId='publisher-water-stage';
const keyPair=generateKeyPairSync('ed25519');
const fingerprint=key=>createHash('sha256')
  .update(key.export({format:'der',type:'spki'})).digest('hex');
const trustedSigner=fingerprint(keyPair.publicKey);
const initial={
  current:{distanceCm:20,levelCm:5,status:'SAFE',
    observedAtMs:prior,overallRisk:'UNKNOWN'},
  checkpoint:{initialized:true,deviceId,epoch:1,sequence:1,
    digest:'0'.repeat(64),observedAtMs:prior}
};
const source=(seq=2,observedAtMs=now-400,opts={})=>{
  const envelope={
    version:'floodguard-offline-envelope-v1',
    deviceId:opts.deviceId??deviceId,epoch:1,observedAtMs,
    frame:{sequence:seq,distanceCm:16.5,levelCm:8.5,risk:'WARNING'}
  };
  const digest=createHash('sha256')
    .update(canonicalOfflineEnvelope(envelope)).digest('hex');
  const receipt={
    version:'floodguard-offline-receipt-v1',
    deviceId:envelope.deviceId,epoch:1,sequence:seq,digest,acceptedAtMs:now-100
  };
  return {
    envelope,receipt,
    signature:sign(null,Buffer.from(JSON.stringify(receipt)),
      opts.signingKey??keyPair.privateKey).toString('base64url'),
    trustedReceiptKey:opts.verificationKey??keyPair.publicKey,
    expectedSignerFingerprint:trustedSigner,
    registryBinding:{
      deviceId:envelope.deviceId,epoch:1,enabled:true,
      scope:'prototype-ingest-v1'
    },
    databaseRecord:{
      deviceId:envelope.deviceId,epoch:1,sequence:seq,digest,
      acceptedAtMs:receipt.acceptedAtMs,status:'DATABASE_CONFIRMED'
    },
    nowMs:now
  };
};
let env;
async function admin(callback){
  let result;
  await env.withSecurityRulesDisabled(async ctx=>{
    result=await callback(ctx.database());
  });
  return result;
}
const readRoot=()=>admin(async db=>(await db.ref(path).get()).val());
const readWater=()=>admin(async db=>(await db.ref(pub).get()).val());
const adminSet=(p,v)=>admin(db=>db.ref(p).set(v));
const client=(name=publisherId,claim=true)=>
  env.authenticatedContext(name,{fg_publish_water_v1:claim}).database();
const project=(options,db=client())=>publishSignedToNarrowEmulator({
  database:db,...options
});
before(async()=>{
  env=await initializeTestEnvironment({
    projectId:'demo-narrow-signed-bridge',
    database:{
      host:'127.0.0.1',port:9000,
      rules:readFileSync('docs/firebase/phase-b-narrow-publication-lab.rules.json','utf8')
    }
  });
});
after(async()=>{if(env)await env.cleanup();});
beforeEach(async()=>{
  await env.clearDatabase();
  await admin(db=>db.ref(path).set({
    publisherLabAuthorization:{
      [publisherId]:{
        enabled:true,scope:'publication-lab-water-v1',
        deviceId,epoch:1
      }
    },
    publicationLab:{water:initial},
    live:{
      water:{status:'SAFE',distanceCm:20},
      gate:{status:'CLOSED',angle:0},
      esp8266:{ip:'192.0.2.19',wifi:'CONFIDENTIAL-SYNTHETIC'},
      system:{overallRisk:'UNKNOWN'}
    },
    staging:{ingestV1:{[deviceId]:{
      sequence:2,distanceCm:16.5,levelCm:8.5,risk:'WARNING'
    }}},
    bot:{recipients:'PRIVATE-SYNTHETIC'}
  }));
});

test('authentic signed+confirmed test frame publishes with scoped identity and atomic checkpoint',async()=>{
  const before=await readRoot();
  const request=source();
  const reply=await project(request);
  assert.deepEqual(reply,{
    published:true,kind:'SIGNED_NARROW_EMULATOR_ONLY',sequence:2
  });
  const after=await readRoot();
  assert.deepEqual(after.publicationLab.water,{
    current:{
      distanceCm:16.5,levelCm:8.5,status:'WARNING',
      observedAtMs:request.envelope.observedAtMs,overallRisk:'UNKNOWN'
    },
    checkpoint:{
      initialized:true,deviceId,epoch:1,sequence:2,
      digest:request.receipt.digest,
      observedAtMs:request.envelope.observedAtMs
    }
  });
  assert.deepEqual(after.live,before.live);
  assert.deepEqual(after.bot,before.bot);
  assert.deepEqual(after.staging,before.staging);
  assert.deepEqual(after.publisherLabAuthorization,before.publisherLabAuthorization);
  const visitor=env.unauthenticatedContext().database();
  await assertSucceeds(visitor.ref(pub+'/current').get());
  await assertFails(visitor.ref(pub).get());
  await assertFails(visitor.ref(pub+'/checkpoint').get());
});

test('duplicate replay or lower sequence cannot change public status or checkpoint',async()=>{
  assert.equal((await project(source())).published,true);
  const before=await readWater();
  const replay=await project(source());
  assert.deepEqual(replay,{
    published:false,reason:'publication-replay-or-out-of-order'
  });
  assert.deepEqual(await readWater(),before);
  assert.equal((await project(source(1))).published,false);
  assert.deepEqual(await readWater(),before);
});

test('forged envelope or receipt, and unconfirmed database record, fail closed',async()=>{
  const ok=source();
  const before=await readWater();
  const scenarios=[
    {...ok,envelope:{...ok.envelope,frame:{...ok.envelope.frame,risk:'DANGER'}}},
    {...ok,receipt:{...ok.receipt,digest:'f'.repeat(64)}},
    {...ok,databaseRecord:{...ok.databaseRecord,status:'PENDING'}},
    {...ok,databaseRecord:{...ok.databaseRecord,digest:'f'.repeat(64)}},
    {...ok,signature:'A'.repeat(86)}
  ];
  for(const candidate of scenarios){
    assert.equal((await project(candidate)).published,false);
    assert.deepEqual(await readWater(),before);
  }
});

test('caller cannot select their own server verification key to forge an accepted receipt',async()=>{
  const impostor=generateKeyPairSync('ed25519');
  const changed=source(2,now-400,{
    signingKey:impostor.privateKey,verificationKey:impostor.publicKey
  });
  const denied=await project(changed);
  assert.deepEqual(denied,{published:false,reason:'receipt-signer-not-authorized'});
  assert.deepEqual(await readWater(),initial);
  assert.equal((await project(source())).published,true);
});

test('revoked, different or mis-scoped source identity cannot bypass source checks',async()=>{
  const valid=source();
  const candidates=[
    {...valid,registryBinding:{...valid.registryBinding,enabled:false}},
    {...valid,registryBinding:{...valid.registryBinding,scope:'admin'}},
    {...valid,envelope:{...valid.envelope,deviceId:'device-stage-b'}},
    source(2,now-400,{deviceId:'device-stage-b'})
  ];
  for(const candidate of candidates){
    assert.equal((await project(candidate)).published,false);
    assert.deepEqual(await readWater(),initial);
  }
});

test('expired source time and newer sequence with regressed public time are blocked',async()=>{
  const expired=source(2,now-30001);
  assert.deepEqual(await project(expired),{
    published:false,reason:'source-timestamp-unverified'
  });
  const regressed=source(2,prior-1);
  assert.deepEqual(await project(regressed),{
    published:false,reason:'public-timestamp-regression'
  });
  assert.deepEqual(await readWater(),initial);
});

test('publisher revocation or wrong auth claim prevents a signed valid frame',async()=>{
  const initialRoot=await readRoot();
  let denied=await project(source(),client(publisherId,false));
  assert.equal(denied.published,false);
  assert.deepEqual(await readWater(),initial);
  await adminSet(path+'/publisherLabAuthorization/'+publisherId+'/enabled',false);
  denied=await project(source());
  assert.equal(denied.published,false);
  const after=await readRoot();
  assert.deepEqual(after.publicationLab,initialRoot.publicationLab);
  assert.deepEqual(after.live,initialRoot.live);
});

test('lost checkpoint and unknown publication root never reset replay history',async()=>{
  const before=await readRoot();
  await adminSet(pub+'/checkpoint',null);
  assert.deepEqual(await project(source()),{
    published:false,reason:'publication-state-unavailable'
  });
  const after=await readRoot();
  assert.deepEqual(after.live,before.live);
  assert.equal(after.publicationLab.water.checkpoint,undefined);
  await adminSet(pub,null);
  assert.equal((await project(source())).published,false);
  assert.equal(await readWater(),null);
});

test('simultaneous delivery of one signed frame commits no more than once',async()=>{
  const results=await Promise.all([project(source()),project(source())]);
  assert.equal(results.filter(v=>v.published).length,1);
  assert.equal(results.filter(v=>!v.published).length,1);
  assert.equal((await readWater()).checkpoint.sequence,2);
});

test('new later signed and confirmed frame can advance but not alter existing live gate data',async()=>{
  assert.equal((await project(source())).published,true);
  const before=await readRoot();
  const later=source(3,now-100);
  // A verified receipt's acceptedAtMs must not precede observation; choose
  // a fresh but earlier than acceptance timestamp for this synthetic case.
  assert.equal((await project(later)).published,true);
  const after=await readRoot();
  assert.equal(after.publicationLab.water.checkpoint.sequence,3);
  assert.equal(after.publicationLab.water.current.observedAtMs,now-100);
  assert.deepEqual(after.live,before.live);
  assert.deepEqual(after.bot,before.bot);
});

test('module cannot reference broad database root, Admin SDK or production keys',()=>{
  const s=readFileSync('experiments/signed-narrow-publisher-emulator.mjs','utf8');
  assert.match(s,/database\.ref\(PATH\)/);
  assert.match(s,/const PATH='\/floodguard\/publicationLab\/water'/);
  assert.match(s,/planStrictSyntheticPublicProjection/);
  assert.doesNotMatch(s,/firebase-admin|serviceAccount|https:\/\/|fetch\s*\(|\.listen\s*\(/);
  assert.doesNotMatch(s,/database\.ref\('\/floodguard'\)/);
  assert.doesNotMatch(s,/\.set\s*\(|\.update\s*\(|writeFileSync|spawnSync/);
});
