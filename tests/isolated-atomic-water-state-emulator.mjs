// Loopback Firebase Emulator ONLY. No production project or service creds.
import {before,after,beforeEach,test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash,generateKeyPairSync,sign} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {initializeTestEnvironment,assertFails,assertSucceeds}
  from '@firebase/rules-unit-testing';
import {canonicalOfflineEnvelope} from '../experiments/stage7-durable-ingress.mjs';
import {deriveIsolatedAtomicWaterStateLab}
  from '../experiments/isolated-atomic-water-state-lab.mjs';

const ROOT='/floodguard',PUBLIC=ROOT+'/publicTelemetryLabV1';
const HOST='127.0.0.1:9000',NOW=1793450000500,UID='device-stage-a';
if(process.env.FG_ATOMIC_LEAF_LAB!=='1'||
   process.env.FIREBASE_DATABASE_EMULATOR_HOST!==HOST)
  throw Error('Explicit isolated RTDB Emulator required');

let env,issuer;
const pubkey=()=>issuer.publicKey;
const digest=e=>createHash('sha256')
  .update(canonicalOfflineEnvelope(e),'utf8').digest('hex');
function observation(sequence=1,{distanceCm=16.5,levelCm=8.5,risk='WARNING',observedAtMs=NOW-1000}={}) {
  const envelope={version:'floodguard-offline-envelope-v1',deviceId:UID,
    epoch:1,observedAtMs,frame:{sequence,distanceCm,levelCm,risk}};
  const hash=digest(envelope);
  const receipt={version:'floodguard-offline-receipt-v1',deviceId:UID,
    epoch:1,sequence,digest:hash,acceptedAtMs:NOW-250};
  const signature=sign(null,Buffer.from(JSON.stringify(receipt)),issuer.privateKey).toString('base64url');
  return {envelope,receipt,signature,trustedReceiptKey:pubkey(),nowMs:NOW};
}
const signerFingerprint=()=>createHash('sha256')
  .update(pubkey().export({format:'der',type:'spki'})).digest('hex');
function initialState(obs) {
  return {
    deviceAuthorization:{[UID]:{enabled:true,scope:'prototype-ingest-v1'}},
    projectionControl:{
      waterAuthority:{deviceId:UID,epoch:1,enabled:true,scope:'water-primary',
        receiptSignerFingerprint:signerFingerprint()},
      devices:{[UID]:{initialized:false,epoch:1}}
    },
    staging:{ingestV1:{[UID]:obs.envelope.frame}},
    confirmedIngest:{[UID]:{
      deviceId:UID,epoch:1,sequence:obs.envelope.frame.sequence,
      digest:obs.receipt.digest,acceptedAtMs:obs.receipt.acceptedAtMs,
      status:'DATABASE_CONFIRMED'}},
    publicTelemetryLabV1:{
      water:{distanceCm:18.5,levelCm:6.5,status:'SAFE'},
      system:{lastUpdate:NOW-2000,overallRisk:'UNKNOWN'},
      gate:{status:'UNKNOWN'},
      alarm:{active:false}
    },
    privateIngest:{note:'SYNTHETIC_PRIVATE'},
    live:{esp8266:{ip:'SYNTHETIC_PRIVATE_IP'}}
  };
}
const seed=async state=>env.withSecurityRulesDisabled(
  async ctx=>ctx.database().ref(ROOT).set(state)
);
const get=async()=>{
  // Test-environment callback return values are not exposed; capture the
  // snapshot inside the privileged context explicitly.
  let snapshot;
  await env.withSecurityRulesDisabled(async ctx=>{
    snapshot=(await ctx.database().ref(ROOT).get()).val();
  });
  return snapshot;
};
const guest=()=>env.unauthenticatedContext().database();
const read=async path=>(await assertSucceeds(guest().ref(path).get())).val();
async function atomic(obs){
  let outcome;
  await env.withSecurityRulesDisabled(async ctx=>{
    const ref=ctx.database().ref(ROOT);
    // Hold RTDB's initial value in the sync tree across the transaction;
    // get() alone may be released before the transaction's first callback.
    const cb=()=>{};
    let ready=false;
    await new Promise((resolve,reject)=>{
      let timer;
      const onValue=()=>{ready=true;clearTimeout(timer);resolve();};
      const onCancel=error=>{clearTimeout(timer);reject(error);};
      timer=setTimeout(()=>reject(Error('emulator snapshot timeout')),4000);
      ref.on('value',onValue,onCancel);
      // callback identity must be retained for post-transaction removal.
      cb.listener=onValue;
    });
    assert.equal(ready,true);
    let result={allowed:false,reason:'not-called'};
    try {
      const completed=await ref.transaction(current=>{
        result=deriveIsolatedAtomicWaterStateLab({current,...obs});
        return result.allowed ? result.next : undefined;
      },undefined,false);
      outcome={committed:completed.committed,reason:result.reason||null,
        sequence:result.allowed ? result.sequence:null};
    }finally{ref.off('value',cb.listener);}
  });
  return outcome;
}
const denied=async obs=>{
  const before=await get(),res=await atomic(obs);
  assert.equal(res.committed,false);
  assert.deepEqual(await get(),before);
  return res;
};

before(async()=>{
  env=await initializeTestEnvironment({
    projectId:'demo-fg-atomic-leaf',
    database:{host:'127.0.0.1',port:9000,
      rules:readFileSync('tests/fixtures/pr34/public-telemetry-leaf-lab.rules.json','utf8')}
  });
});
after(async()=>{if(env)await env.cleanup();});
beforeEach(async()=>{
  issuer=generateKeyPairSync('ed25519');
  await env.clearDatabase();
  const obs=observation();
  await seed(initialState(obs));
});

test('signed confirmed frame atomically advances exact public leaves and private checkpoint',async()=>{
  const obs=observation();
  const result=await atomic(obs);
  assert.equal(result.committed,true,JSON.stringify(result));
  const state=await get();
  assert.equal(state.projectionControl.devices[UID].sequence,1);
  assert.equal(state.projectionControl.devices[UID].digest,obs.receipt.digest);
  assert.equal(await read(PUBLIC+'/water/status'),'WARNING');
  assert.equal(await read(PUBLIC+'/water/levelCm'),8.5);
  assert.equal(await read(PUBLIC+'/system/overallRisk'),'UNKNOWN');
  assert.equal(state.publicTelemetryLabV1.gate.status,'UNKNOWN');
  assert.equal(state.publicTelemetryLabV1.alarm.active,false);
  assert.equal(state.privateIngest.note,'SYNTHETIC_PRIVATE');
});

test('approved individual public reads but parent/private reads and every anonymous write denied',async()=>{
  await atomic(observation());
  for(const path of [ROOT,PUBLIC,PUBLIC+'/water',PUBLIC+'/system',
    ROOT+'/privateIngest',ROOT+'/live',ROOT+'/projectionControl',
    ROOT+'/confirmedIngest',PUBLIC+'/esp8266/ip'])
    await assertFails(guest().ref(path).get());
  for(const path of [PUBLIC,PUBLIC+'/water/status',PUBLIC+'/gate/status',
    ROOT+'/live/gate/status'])
    await assertFails(guest().ref(path).set('FORGED'));
  assert.equal(await read(PUBLIC+'/water/status'),'WARNING');
  assert.equal(await read(PUBLIC+'/system/overallRisk'),'UNKNOWN');
});

test('duplicate signed receipt cannot advance checkpoint or replace public data',async()=>{
  assert.equal((await atomic(observation())).committed,true);
  const res=await denied(observation());
  assert.equal(res.reason,'publication-replay-or-out-of-order');
});

test('higher sequence with older timestamp cannot overwrite newer shared water feed',async()=>{
  assert.equal((await atomic(observation())).committed,true);
  const future=observation(2,{observedAtMs:NOW-1500});
  let s=await get();
  s.staging.ingestV1[UID]=future.envelope.frame;
  s.confirmedIngest[UID]={deviceId:UID,epoch:1,sequence:2,
    digest:future.receipt.digest,acceptedAtMs:future.receipt.acceptedAtMs,
    status:'DATABASE_CONFIRMED'};
  await seed(s);
  const res=await denied(future);
  assert.equal(res.reason,'public-timestamp-regression');
});

test('revoked identity, switched source authority or wrong receipt issuer abort',async()=>{
  const obs=observation(),original=await get();
  for(const change of [
    s=>{s.deviceAuthorization[UID].enabled=false;},
    s=>{s.projectionControl.waterAuthority.deviceId='device-stage-b';},
    s=>{s.projectionControl.waterAuthority.receiptSignerFingerprint='0'.repeat(64);}
  ]){
    const modified=structuredClone(original);
    change(modified);await seed(modified);
    const res=await denied(obs);
    assert.notEqual(res.reason,null);
  }
});

test('source mismatch, tampered signature and unconfirmed receipt never publish',async()=>{
  const obs=observation(),original=await get();
  let alt=structuredClone(original);
  alt.staging.ingestV1[UID].levelCm=0;
  await seed(alt);
  assert.equal((await denied(obs)).reason,'confirmed-source-not-staged');
  await seed(original);
  assert.equal((await denied({...obs,signature:'A'.repeat(86)})).reason,'receipt-unverified');
  alt=structuredClone(original);
  alt.confirmedIngest[UID].status='PENDING';
  await seed(alt);
  assert.equal((await denied(obs)).reason,'database-not-confirmed');
});

test('public nested object, unexpected field or invalid scalar blocks atomic publication',async()=>{
  const obs=observation(),original=await get();
  for(const change of [
    s=>{s.publicTelemetryLabV1.water.status={nested:'SYNTHETIC_PRIVATE'};},
    s=>{s.publicTelemetryLabV1.esp8266={wifi:'SYNTHETIC_PRIVATE'};},
    s=>{s.publicTelemetryLabV1.water.levelCm=Infinity;},
    s=>{s.publicTelemetryLabV1.water.extra='UNREVIEWED';}
  ]) {
    const modified=structuredClone(original);
    change(modified);
    if(Number.isFinite(modified.publicTelemetryLabV1.water.levelCm)===false)
      modified.publicTelemetryLabV1.water.levelCm=-9;
    await seed(modified);
    const result=await denied(obs);
    assert.equal(result.reason,'public-scalar-schema-corrupt');
  }
});

test('no missing private replay checkpoint or missing root may initialize by accident',async()=>{
  const obs=observation(),original=await get();
  const a=structuredClone(original);
  delete a.projectionControl.devices[UID];
  await seed(a);
  assert.equal((await denied(obs)).reason,'publication-checkpoint-unavailable');
  await seed(null);
  const res=await atomic(obs);
  assert.equal(res.committed,false);
});

test('SAFE report still leaves global safety unknown and never changes physical gate status',async()=>{
  const safe=observation(1,{distanceCm:18.5,levelCm:6.5,risk:'SAFE'});
  const state=initialState(safe);
  await seed(state);
  assert.equal((await atomic(safe)).committed,true);
  assert.equal(await read(PUBLIC+'/water/status'),'SAFE');
  assert.equal(await read(PUBLIC+'/system/overallRisk'),'UNKNOWN');
  assert.equal((await get()).publicTelemetryLabV1.gate.status,'UNKNOWN');
});

test('pure state reducer has no direct SDK, network, credentials, command or write API',()=>{
  const src=readFileSync('experiments/isolated-atomic-water-state-lab.mjs','utf8');
  for(const prohibited of ['firebase-admin','firebase/database','node:https'])
    assert.ok(!src.includes(prohibited));
  assert.doesNotMatch(src,/\b(?:db|database|ref|target)\.(?:set|update)\s*\(/);
  assert.doesNotMatch(src,/servo\.write|serviceAccount|process\.env|\.transaction\s*\(/);
});
