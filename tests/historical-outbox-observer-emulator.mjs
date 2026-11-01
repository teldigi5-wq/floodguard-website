// Real Firebase RTDB Emulator, synthetic signed source and local outbox ONLY.
// Never use production project credentials or actuate physical hardware.
import {before,after,beforeEach,afterEach,test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash,generateKeyPairSync,randomBytes,sign} from 'node:crypto';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {initializeTestEnvironment,assertFails,assertSucceeds}
  from '@firebase/rules-unit-testing';
import {canonicalOfflineEnvelope} from '../experiments/stage7-durable-ingress.mjs';
import {createDurableAdmissionOutboxLab}
  from '../experiments/durable-admission-outbox-lab.mjs';
import {deriveHistoricalAtomicWaterStateLab}
  from '../experiments/immutable-publication-history-lab.mjs';
import {observeHistoricalOutboxRecordLab}
  from '../experiments/historical-outbox-observer-lab.mjs';
import {canonicalPublicationHistoryWitnessLab,observePinnedHistoricalWitnessLab}
  from '../experiments/pinned-historical-witness-lab.mjs';

const HOST='127.0.0.1:9000',UID='device-stage-a',NOW=1793450000500;
const ROOT='/floodguard',PUBLIC=ROOT+'/publicTelemetryLabV1';
if(process.env.FG_HISTORIC_OUTBOX_LAB!=='1'||
   process.env.FIREBASE_DATABASE_EMULATOR_HOST!==HOST)
  throw Error('Exact disposable loopback RTDB Emulator required');

let env,dir,device,issuer,journal,sourceBinding;
async function elevated(fn){
  let value;await env.withSecurityRulesDisabled(async c=>{
    value=await fn(c.database());
  });return value;
}
const get=()=>elevated(async db=>(await db.ref(ROOT).get()).val());
const seed=state=>elevated(db=>db.ref(ROOT).set(state));
function reading(sequence,fields={}){
  const envelope={version:'floodguard-offline-envelope-v1',
    deviceId:UID,epoch:1,observedAtMs:NOW-1500+sequence*400,
    frame:{sequence,distanceCm:16.5,levelCm:8.5,risk:'WARNING',...fields}};
  const deviceSig=sign(null,Buffer.from(canonicalOfflineEnvelope(envelope)),
    device.privateKey).toString('base64url');
  const digest=createHash('sha256').update(canonicalOfflineEnvelope(envelope)).digest('hex');
  const receipt={version:'floodguard-offline-receipt-v1',deviceId:UID,
    epoch:1,sequence,digest,acceptedAtMs:NOW+50};
  const signature=sign(null,Buffer.from(JSON.stringify(receipt)),
    issuer.privateKey).toString('base64url');
  return {envelope,deviceSig,receipt,signature,
    trustedReceiptKey:issuer.publicKey,nowMs:NOW+100};
}
async function atomic(req){
  let result;
  await env.withSecurityRulesDisabled(async c=>{
    const ref=c.database().ref(ROOT);
    const h=()=>{};
    await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(Error('RTDB local listener timeout')),4000);
      h.listener=()=>{clearTimeout(timer);resolve();};
      ref.on('value',h.listener,e=>{clearTimeout(timer);reject(e);});
    });
    try{
      let plan={allowed:false,reason:'not-called'};
      const txn=await ref.transaction(current=>{
        plan=deriveHistoricalAtomicWaterStateLab({current,...req});
        return plan.allowed ? plan.next : undefined;
      },undefined,false);
      result={committed:txn.committed,reason:plan.reason??null};
    }finally{ref.off('value',h.listener);}
  });
  return result;
}
async function publish(req){
  assert.equal(journal.accept({envelope:req.envelope,signature:req.deviceSig}).accepted,true);
  const state=await get();
  state.staging.ingestV1[UID]={...req.envelope.frame};
  state.confirmedIngest[UID]={deviceId:UID,epoch:1,
    sequence:req.envelope.frame.sequence,digest:req.receipt.digest,
    acceptedAtMs:req.receipt.acceptedAtMs,status:'DATABASE_CONFIRMED'};
  await seed(state);
  assert.deepEqual(await atomic(req),{committed:true,reason:null});
}
async function observed(sequence,overrides={}){
  const root=await get();
  return observeHistoricalOutboxRecordLab({
    pending:journal.pending(UID).find(x=>x.sequence===sequence),
    root,sourceBinding,trustedReceiptKey:issuer.publicKey,nowMs:NOW+100,...overrides
  });
}
before(async()=>{
  env=await initializeTestEnvironment({
    projectId:'demo-fg-historic-outbox',
    database:{host:'127.0.0.1',port:9000,
      rules:readFileSync('tests/fixtures/pr34/public-telemetry-leaf-lab.rules.json','utf8')}
  });
});
after(async()=>{if(env)await env.cleanup();});
beforeEach(async()=>{
  await env.clearDatabase();
  dir=mkdtempSync(path.join(os.tmpdir(),'fg-historic-emulator-'));
  device=generateKeyPairSync('ed25519');
  issuer=generateKeyPairSync('ed25519');
  sourceBinding={deviceId:UID,epoch:1,enabled:true,
    scope:'prototype-ingest-v1',publicKey:device.publicKey};
  journal=createDurableAdmissionOutboxLab({directory:dir,
    integrityKey:randomBytes(32),identities:new Map([[UID,sourceBinding]]),
    clock:()=>NOW});
  journal.commission();
  const fp=createHash('sha256').update(issuer.publicKey.export({
    type:'spki',format:'der'})).digest('hex');
  // RTDB omits empty maps. Seed an actual synthetic first input so that
  // the required privileged staging and confirmed domains exist.
  const first=reading(1);
  await seed({
    projectionControl:{waterAuthority:{deviceId:UID,epoch:1,enabled:true,
      scope:'water-primary',receiptSignerFingerprint:fp},
      devices:{[UID]:{initialized:false,epoch:1}}},
    deviceAuthorization:{[UID]:{enabled:true,scope:'prototype-ingest-v1'}},
    staging:{ingestV1:{[UID]:{...first.envelope.frame}}},
    confirmedIngest:{[UID]:{
      deviceId:UID,epoch:1,sequence:1,digest:first.receipt.digest,
      acceptedAtMs:first.receipt.acceptedAtMs,status:'DATABASE_CONFIRMED'
    }},
    publicTelemetryLabV1:{
      water:{distanceCm:18.5,levelCm:6.5,status:'SAFE'},
      system:{lastUpdate:NOW-2500,overallRisk:'UNKNOWN'},
      gate:{status:'UNKNOWN'},alarm:{active:false}
    },
    privateIngest:{secret:'SYNTHETIC_PRIVATE'}
  });
});
afterEach(()=>{if(dir)rmSync(dir,{recursive:true,force:true});});

test('read-back after two atomic publications verifies old signed entry, not cloud delivery',async()=>{
  await publish(reading(1));
  await publish(reading(2,{distanceCm:13.5,levelCm:11.5,risk:'DANGER'}));
  const old=await observed(1);
  assert.equal(old.observed,true,JSON.stringify(old));
  assert.equal(old.latestSequence,2);
  assert.equal(old.isLatest,false);
  assert.equal(old.canAcknowledge,false);
  assert.equal(journal.pending(UID).length,2);
  assert.equal((await observed(2)).observed,true);
  const guest=env.unauthenticatedContext().database();
  assert.equal((await assertSucceeds(guest.ref(PUBLIC+'/water/status').get())).val(),'DANGER');
  await assertFails(guest.ref(ROOT+'/publicationHistoryV1').get());
  await assertFails(guest.ref(ROOT+'/publicationHistoryV1/entries/s_1').get());
  await assertFails(guest.ref(ROOT+'/publicationHistoryV1/entries/s_1').set('FORGED'));
});
test('tampering an older private receipt cannot validate even with newer public state',async()=>{
  await publish(reading(1));
  await publish(reading(2));
  await elevated(db=>db.ref(ROOT+'/publicationHistoryV1/entries/s_1/receiptSignature')
    .set('A'.repeat(86)));
  const x=await observed(1);
  assert.equal(x.observed,false);
  assert.equal(journal.pending(UID).length,2);
});
test('privileged nested-object leak is detectable and does not grant historical proof',async()=>{
  await publish(reading(1));
  await publish(reading(2));
  await elevated(db=>db.ref(PUBLIC+'/water/status').set({unexpected:'SYNTHETIC_PRIVATE'}));
  const guest=env.unauthenticatedContext().database();
  assert.equal((await assertSucceeds(guest.ref(PUBLIC+'/water/status/unexpected').get())).val(),
    'SYNTHETIC_PRIVATE');
  const result=await observed(1);
  assert.equal(result.observed,false);
  assert.equal(result.reason,'current-public-scalar-diverged');
  assert.equal(journal.pending(UID).length,2);
});

test('separately signed witness observes older history in actual RTDB Emulator read-back',async()=>{
  await publish(reading(1));
  await publish(reading(2,{distanceCm:13.5,levelCm:11.5,risk:'DANGER'}));
  const snapshot=await get();
  const external=generateKeyPairSync('ed25519');
  const head=snapshot.projectionControl.devices[UID];
  const historyDigest=createHash('sha256').update(
    canonicalPublicationHistoryWitnessLab(snapshot.publicationHistoryV1)).digest('hex');
  const witness={
    version:'floodguard-external-publication-witness-lab-v1',
    deviceId:UID,epoch:1,sequence:head.sequence,digest:head.digest,
    historyDigest,
    receiptSignerFingerprint:createHash('sha256').update(
      issuer.publicKey.export({type:'spki',format:'der'})).digest('hex'),
    witnessedAtMs:NOW+100
  };
  const witnessSignature=sign(null,Buffer.from(JSON.stringify(witness)),
    external.privateKey).toString('base64url');
  const trustedExternalHead={sequence:head.sequence,digest:head.digest,historyDigest};
  const expectedWitnessFingerprint=createHash('sha256').update(
    external.publicKey.export({type:'spki',format:'der'})).digest('hex');
  const observed=observePinnedHistoricalWitnessLab({
    pending:journal.pending(UID)[0],root:snapshot,sourceBinding,
    trustedReceiptKey:issuer.publicKey,
    witness,witnessSignature,trustedWitnessKey:external.publicKey,
    expectedWitnessFingerprint,trustedExternalHead,nowMs:NOW+100
  });
  assert.equal(observed.observed,true,JSON.stringify(observed));
  assert.equal(observed.latestSequence,2);
  assert.equal(observed.canAcknowledge,false);
});

test('emulated old root and valid old signature fail against retained newer external head',async()=>{
  await publish(reading(1));
  const old=await get();
  await publish(reading(2,{distanceCm:13.5,levelCm:11.5,risk:'DANGER'}));
  const latest=await get();
  const head=latest.projectionControl.devices[UID];
  const latestHistoryDigest=createHash('sha256').update(
    canonicalPublicationHistoryWitnessLab(latest.publicationHistoryV1)).digest('hex');
  const heldHead={sequence:head.sequence,digest:head.digest,
    historyDigest:latestHistoryDigest};
  // A stale RTDB snapshot may be internally consistent, but it cannot match
  // a separately retained, newer operator head. No Firebase prod data touched.
  await seed(old);
  const external=generateKeyPairSync('ed25519');
  const oldCheckpoint=old.projectionControl.devices[UID];
  const oldHistoryDigest=createHash('sha256').update(
    canonicalPublicationHistoryWitnessLab(old.publicationHistoryV1)).digest('hex');
  const witness={version:'floodguard-external-publication-witness-lab-v1',
    deviceId:UID,epoch:1,sequence:oldCheckpoint.sequence,
    digest:oldCheckpoint.digest,historyDigest:oldHistoryDigest,
    receiptSignerFingerprint:createHash('sha256').update(
      issuer.publicKey.export({type:'spki',format:'der'})).digest('hex'),
    witnessedAtMs:NOW+100};
  const signature=sign(null,Buffer.from(JSON.stringify(witness)),
    external.privateKey).toString('base64url');
  const result=observePinnedHistoricalWitnessLab({
    pending:journal.pending(UID)[0],root:await get(),sourceBinding,
    trustedReceiptKey:issuer.publicKey,witness,witnessSignature:signature,
    trustedWitnessKey:external.publicKey,
    expectedWitnessFingerprint:createHash('sha256').update(
      external.publicKey.export({type:'spki',format:'der'})).digest('hex'),
    trustedExternalHead:heldHead,nowMs:NOW+100
  });
  assert.equal(result.observed,false);
  assert.equal(result.reason,'external-witness-snapshot-mismatch');
  assert.equal(journal.pending(UID).length,2);
});
