// Real RTDB Emulator tests for an in-transaction PRIVATE history candidate.
// No production service account, actual device, notification, alert, gate.
import {before,after,beforeEach,test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash,generateKeyPairSync,sign} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {initializeTestEnvironment,assertFails,assertSucceeds}
  from '@firebase/rules-unit-testing';
import {canonicalOfflineEnvelope} from '../experiments/stage7-durable-ingress.mjs';
import {deriveHistoricalAtomicWaterStateLab}
  from '../experiments/immutable-publication-history-lab.mjs';

const HOST='127.0.0.1:9000',UID='device-stage-a',NOW=1793450000500;
const ROOT='/floodguard',PUBLIC=ROOT+'/publicTelemetryLabV1';
if(process.env.FG_HISTORY_LAB!=='1'||
   process.env.FIREBASE_DATABASE_EMULATOR_HOST!==HOST)
  throw Error('Exact loopback RTDB Emulator opt-in required');
let env,pair;
const fp=()=>createHash('sha256')
  .update(pair.publicKey.export({type:'spki',format:'der'})).digest('hex');
async function elevated(callback){
  let value;
  await env.withSecurityRulesDisabled(async context=>{
    value=await callback(context.database());
  });
  return value;
}
const get=()=>elevated(async db=>(await db.ref(ROOT).get()).val());
const seed=state=>elevated(db=>db.ref(ROOT).set(state));
function reading(sequence,{observedAtMs=NOW-1000,distanceCm=16.5,levelCm=8.5,risk='WARNING'}={}){
  const envelope={
    version:'floodguard-offline-envelope-v1',deviceId:UID,epoch:1,observedAtMs,
    frame:{sequence,distanceCm,levelCm,risk}
  };
  const digest=createHash('sha256').update(canonicalOfflineEnvelope(envelope)).digest('hex');
  const receipt={version:'floodguard-offline-receipt-v1',
    deviceId:UID,epoch:1,sequence,digest,acceptedAtMs:NOW-250};
  return {envelope,receipt,signature:sign(null,Buffer.from(JSON.stringify(receipt)),
    pair.privateKey).toString('base64url'),trustedReceiptKey:pair.publicKey,nowMs:NOW};
}
function initial(req){
  return {
    projectionControl:{
      waterAuthority:{deviceId:UID,epoch:1,enabled:true,scope:'water-primary',
        receiptSignerFingerprint:fp()},
      devices:{[UID]:{initialized:false,epoch:1}}
    },
    deviceAuthorization:{[UID]:{enabled:true,scope:'prototype-ingest-v1'}},
    confirmedIngest:{[UID]:{deviceId:UID,epoch:1,sequence:req.envelope.frame.sequence,
      digest:req.receipt.digest,acceptedAtMs:req.receipt.acceptedAtMs,
      status:'DATABASE_CONFIRMED'}},
    staging:{ingestV1:{[UID]:{...req.envelope.frame}}},
    publicTelemetryLabV1:{
      water:{distanceCm:18.5,levelCm:6.5,status:'SAFE'},
      system:{lastUpdate:NOW-2500,overallRisk:'UNKNOWN'},
      gate:{status:'UNKNOWN'},alarm:{active:false}
    },
    privateIngest:{wifi:'PRIVATE_SYNTHETIC'}
  };
}
async function atomic(req){
  let outcome;
  await env.withSecurityRulesDisabled(async context=>{
    const ref=context.database().ref(ROOT);
    const handle=()=>{};
    await new Promise((resolve,reject)=>{
      const timeout=setTimeout(()=>reject(Error('RTDB Emulator listener timeout')),4000);
      const onValue=()=>{clearTimeout(timeout);resolve();};
      handle.listener=onValue;
      ref.on('value',onValue,error=>{clearTimeout(timeout);reject(error);});
    });
    try{
      let candidate={allowed:false,reason:'not-called'};
      const result=await ref.transaction(current=>{
        candidate=deriveHistoricalAtomicWaterStateLab({current,...req});
        return candidate.allowed ? candidate.next : undefined;
      },undefined,false);
      outcome={committed:result.committed,reason:candidate.reason??null};
    }finally{ref.off('value',handle.listener);}
  });
  return outcome;
}
async function stage(req){
  const current=await get();
  current.staging.ingestV1[UID]={...req.envelope.frame};
  current.confirmedIngest[UID]={
    deviceId:UID,epoch:1,sequence:req.envelope.frame.sequence,
    digest:req.receipt.digest,acceptedAtMs:req.receipt.acceptedAtMs,
    status:'DATABASE_CONFIRMED'
  };
  await seed(current);
}
before(async()=>{
  env=await initializeTestEnvironment({
    projectId:'demo-fg-immutable-history',
    database:{host:'127.0.0.1',port:9000,
      rules:readFileSync('tests/fixtures/pr34/public-telemetry-leaf-lab.rules.json','utf8')}
  });
});
after(async()=>{if(env)await env.cleanup();});
beforeEach(async()=>{
  pair=generateKeyPairSync('ed25519');
  await env.clearDatabase();
  await seed(initial(reading(1)));
});

test('two committed transactions preserve both independently signed private receipts',async()=>{
  const first=reading(1);
  assert.deepEqual(await atomic(first),{committed:true,reason:null});
  const one=(await get()).publicationHistoryV1.entries['1'];
  const second=reading(2,{distanceCm:13.5,levelCm:11.5,risk:'DANGER',observedAtMs:NOW-500});
  await stage(second);
  assert.deepEqual(await atomic(second),{committed:true,reason:null});
  const current=await get();
  assert.deepEqual(current.publicationHistoryV1.entries['1'],one);
  assert.equal(current.publicationHistoryV1.entries['2'].receiptSignature,second.signature);
  assert.equal(current.projectionControl.devices[UID].sequence,2);
  assert.equal(current.publicTelemetryLabV1.water.status,'DANGER');
  assert.equal(current.publicTelemetryLabV1.system.overallRisk,'UNKNOWN');
  assert.equal(current.privateIngest.wifi,'PRIVATE_SYNTHETIC');
});

test('ordinary clients may read approved individual telemetry but cannot read history or write it',async()=>{
  await atomic(reading(1));
  const guest=env.unauthenticatedContext().database();
  assert.equal((await assertSucceeds(guest.ref(PUBLIC+'/water/status').get())).val(),'WARNING');
  for(const p of [ROOT,ROOT+'/publicationHistoryV1',ROOT+'/publicationHistoryV1/entries/1',
    ROOT+'/projectionControl',PUBLIC+'/water'])
    await assertFails(guest.ref(p).get());
  for(const p of [ROOT+'/publicationHistoryV1',ROOT+'/publicationHistoryV1/entries/1',
    PUBLIC+'/water/status'])
    await assertFails(guest.ref(p).set('FORGED'));
});

test('wrong receipt signature or revoked source aborts without creating publication history',async()=>{
  const req=reading(1);
  assert.equal((await atomic({...req,signature:'A'.repeat(86)})).committed,false);
  let state=await get();
  assert.equal(state.publicationHistoryV1,undefined);
  state.deviceAuthorization[UID].enabled=false;await seed(state);
  assert.equal((await atomic(req)).committed,false);
  state=await get();assert.equal(state.publicationHistoryV1,undefined);
});

test('deleted or altered historical receipt prevents newer publication without silently deleting data',async()=>{
  assert.equal((await atomic(reading(1))).committed,true);
  const newer=reading(2,{distanceCm:13.5,levelCm:11.5,
    risk:'DANGER',observedAtMs:NOW-500});
  await stage(newer);
  const modified=await get();
  modified.publicationHistoryV1.entries['1'].receiptSignature='A'.repeat(86);
  await seed(modified);
  const before=await get();
  const result=await atomic(newer);
  assert.equal(result.committed,false);
  assert.equal(result.reason,'publication-history-corrupt');
  assert.deepEqual(await get(),before);
});

test('object injection into approved public leaf fails closed and does not grow private history',async()=>{
  await atomic(reading(1));
  const next=reading(2,{distanceCm:13.5,levelCm:11.5,
    risk:'DANGER',observedAtMs:NOW-500});
  await stage(next);
  await elevated(db=>db.ref(PUBLIC+'/water/status').set({
    nested:'SYNTHETIC_NOT_FOR_REAL_DATABASE'
  }));
  const res=await atomic(next);
  assert.equal(res.committed,false);
  assert.equal(res.reason,'public-scalar-schema-corrupt');
  const state=await get();
  assert.deepEqual(Object.keys(state.publicationHistoryV1.entries),['1']);
});
