// Real local RTDB emulator: signed source -> scoped writer -> public snapshot.
// No remote Firebase, device, public web ingress, or notification hooks.
import {test,before,after,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {createHash,generateKeyPairSync,sign} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {initializeTestEnvironment,assertFails,assertSucceeds}
  from '@firebase/rules-unit-testing';
import {canonicalOfflineEnvelope} from '../experiments/stage7-durable-ingress.mjs';
import {createSignedNarrowEmulatorPublisher} from '../experiments/signed-narrow-publisher-emulator.mjs';
import {canonicalSyntheticPublicationAttestation} from '../experiments/synthetic-publication-attestation.mjs';

if(process.env.FG_NARROW_SIGNED_BRIDGE_TEST!=='1'||
   process.env.FIREBASE_DATABASE_EMULATOR_HOST!=='127.0.0.1:9000')
  throw Error('Signed bridge requires isolated loopback RTDB emulator');

const now=1700000003500,prior=now-3000;
const path='/floodguard',pub=path+'/publicationLab/water';
const deviceId='device-stage-a',publisherId='publisher-water-stage';
const keyPair=generateKeyPairSync('ed25519');
const persistedAttestor=generateKeyPairSync('ed25519');
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
  const attestation={
    version:'floodguard-synthetic-persisted-attestation-v1',
    deviceId:envelope.deviceId,epoch:1,sequence:seq,digest,
    acceptedAtMs:receipt.acceptedAtMs,confirmedAtMs:now-50,
    scope:'prototype-ingest-v1',deviceEnabled:true,
    databaseState:'DATABASE_CONFIRMED'
  };
  return {
    envelope,receipt,
    signature:sign(null,Buffer.from(JSON.stringify(receipt)),
      opts.signingKey??keyPair.privateKey).toString('base64url'),
    attestation,
    attestationSignature:sign(null,
      Buffer.from(canonicalSyntheticPublicationAttestation(attestation)),
      opts.attestorSigningKey??persistedAttestor.privateKey).toString('base64url')
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
const createPublisher=(db=client())=>createSignedNarrowEmulatorPublisher({
  database:db,trustedReceiptKey:keyPair.publicKey,
  trustedAttestationKey:persistedAttestor.publicKey,
  clock:()=>now
});
const project=(options,db=client())=>createPublisher(db)(options);
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
    published:true,kind:'RECOVERED_SIGNED_NARROW_EMULATOR_ONLY',sequence:2
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
    {...ok,attestation:{...ok.attestation,databaseState:'PENDING'}},
    {...ok,attestation:{...ok.attestation,digest:'f'.repeat(64)}},
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
    signingKey:impostor.privateKey
  });
  const denied=await project(changed);
  assert.deepEqual(denied,{published:false,reason:'receipt-unverified'});
  assert.deepEqual(await readWater(),initial);
  assert.equal((await project(source())).published,true);
});


test('caller-supplied trusted key overrides and forged persistence claims are denied',async()=>{
  const unrelated=generateKeyPairSync('ed25519');
  const fakeSource=source(2,now-400,{
    attestorSigningKey:unrelated.privateKey
  });
  assert.deepEqual(await project(fakeSource),{
    published:false,reason:'confirmed-attestation-unverified'
  });
  const original=source();
  const forged={
    ...original,
    trustedReceiptKey:unrelated.publicKey,
    trustedAttestationKey:unrelated.publicKey,
    registryBinding:{deviceId,epoch:1,enabled:true,scope:'prototype-ingest-v1'},
    databaseRecord:{status:'DATABASE_CONFIRMED'}
  };
  assert.deepEqual(await project(forged),{
    published:false,reason:'invalid-request'
  });
  assert.deepEqual(await readWater(),initial);
});

test('a previously valid signed confirmation expires without refreshing its signature',async()=>{
  const original=source();
  const wrongClockPublisher=createSignedNarrowEmulatorPublisher({
    database:client(),trustedReceiptKey:keyPair.publicKey,
    trustedAttestationKey:persistedAttestor.publicKey,
    clock:()=>now+6000
  });
  assert.deepEqual(await wrongClockPublisher(original),{
    published:false,reason:'confirmed-attestation-unverified'
  });
  assert.deepEqual(await readWater(),initial);
});

test('attestation evidence rejects forged approval, mismatched receipt and extra fields',async()=>{
  const signed=source();
  const variants=[
    {...signed,attestation:{...signed.attestation,deviceEnabled:false}},
    {...signed,attestation:{...signed.attestation,databaseState:'PENDING'}},
    {...signed,attestation:{...signed.attestation,scope:'operator-admin'}},
    {...signed,attestation:{...signed.attestation,sequence:99}},
    {...signed,attestation:{...signed.attestation,arbitrary:true}},
    {...signed,attestationSignature:'A'.repeat(86)}
  ];
  for(const v of variants){
    assert.deepEqual(await project(v),{
      published:false,reason:'confirmed-attestation-unverified'
    });
    assert.deepEqual(await readWater(),initial);
  }
});

test('revoked, different or mis-scoped source identity cannot bypass source checks',async()=>{
  const valid=source();
  const candidates=[
    {...valid,attestation:{...valid.attestation,deviceEnabled:false}},
    {...valid,attestation:{...valid.attestation,scope:'admin'}},
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
  assert.equal(results.filter(v=>v.kind==='SIGNED_NARROW_EMULATOR_ONLY').length,1);
  assert.ok(results.every(v=>
    v.kind==='SIGNED_NARROW_EMULATOR_ONLY'||
    v.kind==='RECOVERED_SIGNED_NARROW_EMULATOR_ONLY'||
    (v.published===false&&v.reason==='publication-replay-or-out-of-order')
  ));
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


test('lost publisher acknowledgment AFTER actual RTDB commit recovers exact snapshot and checkpoint',async()=>{
  let committed=false,transactionAttempts=0;
  const genuine=client();
  const simulatedLostAck={
    ref(p){
      const actual=genuine.ref(p);
      if(p!==pub)return actual;
      return {
        on:(...args)=>actual.on(...args),
        off:(...args)=>actual.off(...args),
        get:()=>actual.get(),
        async transaction(...args){
          transactionAttempts++;
          const result=await actual.transaction(...args);
          if(result.committed){
            committed=true;
            throw new Error('SIMULATED_PUBLISHER_ACK_LOST_AFTER_COMMIT');
          }
          return result;
        }
      };
    }
  };
  const before=await readRoot();
  const result=await project(source(),simulatedLostAck);
  assert.equal(committed,true);
  assert.equal(transactionAttempts,1);
  assert.deepEqual(result,{
    published:true,kind:'RECOVERED_SIGNED_NARROW_EMULATOR_ONLY',sequence:2
  });
  const after=await readRoot();
  assert.equal(after.publicationLab.water.checkpoint.sequence,2);
  assert.equal(after.publicationLab.water.checkpoint.digest,source().receipt.digest);
  assert.equal(after.publicationLab.water.current.status,'WARNING');
  assert.equal(after.publicationLab.water.current.observedAtMs,now-400);
  assert.deepEqual(after.live,before.live);
  assert.deepEqual(after.bot,before.bot);
  assert.deepEqual(after.staging,before.staging);
});

test('restart after exact persisted publication does not attempt a second transaction',async()=>{
  assert.equal((await project(source())).kind,'SIGNED_NARROW_EMULATOR_ONLY');
  const before=await readWater();
  let called=false;
  const real=client();
  const mustNotWrite={
    ref(p){
      const actual=real.ref(p);
      return {
        on:(...a)=>actual.on(...a),
        off:(...a)=>actual.off(...a),
        get:()=>actual.get(),
        transaction:async()=>{
          called=true;throw new Error('REPLAY_MUST_NOT_ATTEMPT_WRITE');
        }
      };
    }
  };
  assert.deepEqual(await project(source(),mustNotWrite),{
    published:true,kind:'RECOVERED_SIGNED_NARROW_EMULATOR_ONLY',sequence:2
  });
  assert.equal(called,false);
  assert.deepEqual(await readWater(),before);
});

test('precommit failure with no persisted matching snapshot remains unknown and never retries',async()=>{
  let attempts=0;
  const real=client();
  const droppedBeforeCommit={
    ref(p){
      const actual=real.ref(p);
      return {
        on:(...a)=>actual.on(...a),
        off:(...a)=>actual.off(...a),
        get:()=>actual.get(),
        transaction:async()=>{attempts++;throw new Error('NO_COMMIT_HAPPENED');}
      };
    }
  };
  const before=await readWater();
  const outcome=await project(source(),droppedBeforeCommit);
  assert.deepEqual(outcome,{published:false,reason:'publisher-outcome-unknown'});
  assert.equal(attempts,1,'unknown result must not trigger another write');
  assert.deepEqual(await readWater(),before);
});

test('ambiguous commit with unreadable persisted snapshot is UNKNOWN, not reported published',async()=>{
  const real=client();
  let committed=false;
  const unavailableRead={
    ref(p){
      const actual=real.ref(p);
      return {
        on:(...a)=>actual.on(...a),
        off:(...a)=>actual.off(...a),
        get:async()=>{throw new Error('SIMULATED_CHECKPOINT_READ_OUTAGE');},
        transaction:async(...a)=>{
          const result=await actual.transaction(...a);
          if(result.committed){
            committed=true;
            throw new Error('SIMULATED_ACK_LOST');
          }
          return result;
        }
      };
    }
  };
  const result=await project(source(),unavailableRead);
  assert.equal(committed,true);
  assert.deepEqual(result,{published:false,reason:'publisher-outcome-unknown'});
  assert.equal((await readWater()).checkpoint.sequence,2,
    'real persistence and response confidence are separate');
});

test('mismatched or corrupted public snapshot is never accepted as recovered publication',async()=>{
  assert.equal((await project(source())).published,true);
  const valid=await readWater();
  const forgedStates=[
    {...valid,current:{...valid.current,status:'DANGER'}},
    {...valid,current:{...valid.current,distanceCm:15}},
    {...valid,current:{...valid.current,overallRisk:'LOW'}},
    {...valid,current:{...valid.current,observedAtMs:valid.current.observedAtMs+1}},
    {...valid,checkpoint:{...valid.checkpoint,digest:'f'.repeat(64)}},
    {...valid,checkpoint:{...valid.checkpoint,sequence:3}},
    {...valid,checkpoint:{...valid.checkpoint,observedAtMs:valid.checkpoint.observedAtMs+1}},
    {...valid,current:{...valid.current,extra:'inject'}},
    {...valid,checkpoint:{...valid.checkpoint,extra:true}},
    {current:valid.current},
    null
  ];
  // This is a controlled emulator-only privileged fixture which simulates a
  // corrupted persisted record, NEVER a permitted publisher operation.
  for(const state of forgedStates){
    await adminSet(pub,state);
    const real=client();
    const failTransaction={
      ref(p){
        const actual=real.ref(p);
        return {
          on:(...a)=>actual.on(...a),
          off:(...a)=>actual.off(...a),
          get:()=>actual.get(),
          transaction:async()=>{throw new Error('SIMULATED_AMBIGUOUS_OUTCOME');}
        };
      }
    };
    const result=await project(source(),failTransaction);
    assert.notEqual(result.kind,'RECOVERED_SIGNED_NARROW_EMULATOR_ONLY');
    assert.equal(result.published,false);
  }
});

test('untrusted or expired message cannot recover a snapshot merely by matching sequence',async()=>{
  assert.equal((await project(source())).published,true);
  const before=await readWater();
  const impostor=generateKeyPairSync('ed25519');
  const forged=source(2,now-400,{signingKey:impostor.privateKey});
  assert.equal((await project(forged)).published,false);
  const old=source(2,now-400);
  const late=createSignedNarrowEmulatorPublisher({
    database:client(),trustedReceiptKey:keyPair.publicKey,
    trustedAttestationKey:persistedAttestor.publicKey,
    clock:()=>now+6000
  });
  assert.deepEqual(await late(old),{
    published:false,reason:'confirmed-attestation-unverified'
  });
  assert.deepEqual(await readWater(),before);
});

test('module cannot reference broad database root, Admin SDK or production keys',()=>{
  const s=readFileSync('experiments/signed-narrow-publisher-emulator.mjs','utf8');
  assert.match(s,/database\.ref\(PATH\)/);
  assert.match(s,/const PATH='\/floodguard\/publicationLab\/water'/);
  assert.match(s,/planStrictSyntheticPublicProjection/);
  assert.match(s,/verifySyntheticPublicationAttestation/);
  assert.match(s,/createSignedNarrowEmulatorPublisher/);
  assert.doesNotMatch(s,/expectedSignerFingerprint|registryBinding,databaseRecord,nowMs/);
  assert.doesNotMatch(s,/firebase-admin|serviceAccount|https:\/\/|fetch\s*\(|\.listen\s*\(/);
  assert.doesNotMatch(s,/database\.ref\('\/floodguard'\)/);
  // SHA-256 hash.update is cryptographic, not an unrestricted database write.
  assert.doesNotMatch(s,/\b(?:database|ref|db)\.(?:set|update)\s*\(/);
  assert.doesNotMatch(s,/\.ref\([^)]*\)\.(?:set|update)\s*\(/);
  assert.doesNotMatch(s,/\b(?:writeFileSync|spawnSync)\s*\(/);
});
