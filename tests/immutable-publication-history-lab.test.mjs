import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,createHash,sign} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {canonicalOfflineEnvelope} from '../experiments/stage7-durable-ingress.mjs';
import {deriveHistoricalAtomicWaterStateLab}
  from '../experiments/immutable-publication-history-lab.mjs';

const UID='device-stage-a',NOW=1793450000500;
function harness(){
  const signer=generateKeyPairSync('ed25519');
  const fp=createHash('sha256').update(signer.publicKey.export({
    type:'spki',format:'der'})).digest('hex');
  let root={
    deviceAuthorization:{[UID]:{enabled:true,scope:'prototype-ingest-v1'}},
    projectionControl:{
      waterAuthority:{deviceId:UID,epoch:1,enabled:true,scope:'water-primary',
        receiptSignerFingerprint:fp},
      devices:{[UID]:{initialized:false,epoch:1}}
    },
    staging:{ingestV1:{}},
    confirmedIngest:{},
    publicTelemetryLabV1:{
      water:{distanceCm:18.5,levelCm:6.5,status:'SAFE'},
      system:{lastUpdate:NOW-2500,overallRisk:'UNKNOWN'},
      gate:{status:'UNKNOWN'},alarm:{active:false}
    },
    privateIngest:{metadata:'SYNTHETIC_PRIVATE'}
  };
  function request(sequence,{distanceCm=16.5,levelCm=8.5,risk='WARNING',observedAtMs=NOW-1000}={}){
    const envelope={version:'floodguard-offline-envelope-v1',deviceId:UID,
      epoch:1,observedAtMs,frame:{sequence,distanceCm,levelCm,risk}};
    const digest=createHash('sha256')
      .update(canonicalOfflineEnvelope(envelope)).digest('hex');
    const receipt={version:'floodguard-offline-receipt-v1',deviceId:UID,
      epoch:1,sequence,digest,acceptedAtMs:NOW-250};
    const signature=sign(null,Buffer.from(JSON.stringify(receipt)),
      signer.privateKey).toString('base64url');
    root.staging.ingestV1[UID]={...envelope.frame};
    root.confirmedIngest[UID]={deviceId:UID,epoch:1,sequence,digest,
      acceptedAtMs:receipt.acceptedAtMs,status:'DATABASE_CONFIRMED'};
    return {envelope,receipt,signature,trustedReceiptKey:signer.publicKey,nowMs:NOW};
  }
  const derive=req=>deriveHistoricalAtomicWaterStateLab({current:root,...req});
  return {request,derive,get root(){return root;},replace:s=>{root=s;},signer};
}
function advance(h,seq,options){
  const req=h.request(seq,options);
  const result=h.derive(req);
  assert.equal(result.allowed,true,JSON.stringify(result));
  h.replace(result.next);
  return {req,result};
}
test('first signed publication records immutable private evidence with public leaves and checkpoint',()=>{
  const h=harness();
  const {req,result}=advance(h,1);
  assert.equal(result.kind,'EMULATOR_HISTORY_AND_PUBLIC_ATOMIC_CANDIDATE');
  assert.equal(result.canAcknowledge,false);
  assert.equal(result.floodClearance,'UNKNOWN');
  assert.equal(result.physicalGatePosition,'UNVERIFIED');
  assert.equal(h.root.publicTelemetryLabV1.water.status,'WARNING');
  assert.equal(h.root.publicTelemetryLabV1.system.overallRisk,'UNKNOWN');
  assert.equal(h.root.projectionControl.devices[UID].digest,req.receipt.digest);
  assert.equal(h.root.publicationHistoryV1.entries['s_1'].digest,req.receipt.digest);
  assert.equal(h.root.publicationHistoryV1.entries['s_1'].receiptSignature,req.signature);
  assert.equal(h.root.privateIngest.metadata,'SYNTHETIC_PRIVATE');
  assert.equal(h.root.publicationHistoryV1.entries['s_1'].status,'WARNING');
});
test('higher sequence appends independent signed evidence without erasing old frames',()=>{
  const h=harness();advance(h,1);
  const prior=structuredClone(h.root.publicationHistoryV1.entries['s_1']);
  const {req}=advance(h,2,{distanceCm:13.5,levelCm:11.5,risk:'DANGER',observedAtMs:NOW-500});
  assert.deepEqual(h.root.publicationHistoryV1.entries['s_1'],prior);
  assert.equal(h.root.publicationHistoryV1.entries['s_2'].digest,req.receipt.digest);
  assert.deepEqual(Object.keys(h.root.publicationHistoryV1.entries),['s_1','s_2']);
  assert.equal(h.root.publicTelemetryLabV1.water.status,'DANGER');
});
test('replay and duplicate sequence cannot append or change the private checkpoint',()=>{
  const h=harness();const {req}=advance(h,1);
  const before=structuredClone(h.root);
  const outcome=h.derive(req);
  assert.equal(outcome.allowed,false);
  assert.equal(outcome.reason,'publication-replay-or-out-of-order');
  assert.deepEqual(h.root,before);
});
test('missing or corrupted prior evidence refuses next signed proposal',()=>{
  const mutation=[
    x=>{delete x.publicationHistoryV1;},
    x=>{delete x.publicationHistoryV1.entries['s_1'];},
    x=>{x.publicationHistoryV1.entries['s_1'].digest='a'.repeat(64);},
    x=>{x.publicationHistoryV1.entries['s_1'].receiptSignature='A'.repeat(86);},
    x=>{x.publicationHistoryV1.entries['s_1'].status='SAFE';},
    x=>{x.publicationHistoryV1.issuerFingerprint='f'.repeat(64);},
    x=>{x.publicationHistoryV1.entries['s_1'].distanceCm={network:'PRIVATE'};}
  ];
  for(const change of mutation){
    const h=harness();advance(h,1);
    const state=structuredClone(h.root);change(state);h.replace(state);
    const result=h.derive(h.request(2,{distanceCm:13.5,levelCm:11.5,risk:'DANGER',observedAtMs:NOW-500}));
    assert.equal(result.allowed,false,JSON.stringify(result));
    assert.equal(result.next,undefined);
  }
});
test('existing history cannot diverge from current public output or checkpoint',()=>{
  const mutations=[
    x=>{x.publicTelemetryLabV1.water.status='SAFE';},
    x=>{x.publicTelemetryLabV1.system.lastUpdate+=1;},
    x=>{x.projectionControl.devices[UID].digest='b'.repeat(64);}
  ];
  for(const mut of mutations){
    const h=harness();advance(h,1);
    const c=structuredClone(h.root);mut(c);h.replace(c);
    assert.equal(h.derive(h.request(2,{distanceCm:13.5,levelCm:11.5,risk:'DANGER',observedAtMs:NOW-500})).allowed,false);
  }
});
test('issuer change or source revocation never appends history',()=>{
  const h=harness();advance(h,1);
  let c=structuredClone(h.root);c.deviceAuthorization[UID].enabled=false;h.replace(c);
  assert.equal(h.derive(h.request(2,{distanceCm:13.5,levelCm:11.5,risk:'DANGER',observedAtMs:NOW-500})).allowed,false);
  c=structuredClone(h.root);c.deviceAuthorization[UID].enabled=true;
  c.projectionControl.waterAuthority.receiptSignerFingerprint='1'.repeat(64);h.replace(c);
  assert.equal(h.derive(h.request(2,{distanceCm:13.5,levelCm:11.5,risk:'DANGER',observedAtMs:NOW-500})).allowed,false);
});
test('new unsigned, forged or mismatched receipt never creates evidence',()=>{
  const h=harness();
  const req=h.request(1);
  assert.equal(h.derive({...req,signature:'A'.repeat(86)}).allowed,false);
  const stranger=generateKeyPairSync('ed25519');
  assert.equal(h.derive({...req,trustedReceiptKey:stranger.publicKey}).allowed,false);
  assert.equal(h.derive({...req,receipt:{...req.receipt,digest:'1'.repeat(64)}}).allowed,false);
  assert.equal(h.root.publicationHistoryV1,undefined);
});
test('history backpressure blocks ninth event rather than discarding prior eight',()=>{
  const h=harness();
  for(let sequence=1;sequence<=8;sequence++){
    const observedAtMs=NOW-1100+sequence*100;
    const options={observedAtMs};
    if(sequence%2===0)Object.assign(options,{
      distanceCm:18.5,levelCm:6.5,risk:'SAFE'});
    advance(h,sequence,options);
  }
  const before=structuredClone(h.root.publicationHistoryV1);
  const ninth=h.derive(h.request(9,{observedAtMs:NOW-100,
    distanceCm:13.5,levelCm:11.5,risk:'DANGER'}));
  assert.equal(ninth.allowed,false);
  assert.equal(ninth.reason,'publication-evidence-capacity-reached');
  assert.deepEqual(h.root.publicationHistoryV1,before);
});
test('source event time regression cannot extend evidence ledger',()=>{
  const h=harness();advance(h,1);
  const v=h.derive(h.request(2,{observedAtMs:NOW-1500,
    distanceCm:13.5,levelCm:11.5,risk:'DANGER'}));
  assert.equal(v.allowed,false);
  assert.equal(v.reason,'public-timestamp-regression');
});
test('lab contains no network, Firebase APIs, journal ACK or actuator operations',()=>{
  const s=readFileSync('experiments/immutable-publication-history-lab.mjs','utf8');
  for(const x of ['firebase-admin','firebase/database','node:https','servo.write'])
    assert.ok(!s.includes(x));
  assert.doesNotMatch(s,/\b(?:db|database|ref)\.(?:set|update|remove|transaction)\s*\(/);
  assert.doesNotMatch(s,/\.acknowledge\s*\(|\.delete\s*\(|fetch\s*\(/);
});
