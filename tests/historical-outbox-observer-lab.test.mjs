import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash,generateKeyPairSync,randomBytes,sign} from 'node:crypto';
import {canonicalOfflineEnvelope} from '../experiments/stage7-durable-ingress.mjs';
import {createDurableAdmissionOutboxLab} from '../experiments/durable-admission-outbox-lab.mjs';
import {deriveHistoricalAtomicWaterStateLab}
  from '../experiments/immutable-publication-history-lab.mjs';
import {observeHistoricalOutboxRecordLab}
  from '../experiments/historical-outbox-observer-lab.mjs';

const NOW=1793450000500,UID='device-stage-a';
function withFixture(work){
  const directory=mkdtempSync(path.join(os.tmpdir(),'fg-historical-proof-'));
  try {
    const device=generateKeyPairSync('ed25519');
    const issuer=generateKeyPairSync('ed25519');
    const sourceBinding={deviceId:UID,epoch:1,enabled:true,
      scope:'prototype-ingest-v1',publicKey:device.publicKey};
    const journal=createDurableAdmissionOutboxLab({
      directory,integrityKey:randomBytes(32),
      identities:new Map([[UID,sourceBinding]]),clock:()=>NOW
    });
    journal.commission();
    const issuerFp=createHash('sha256').update(
      issuer.publicKey.export({format:'der',type:'spki'})).digest('hex');
    let root={
      deviceAuthorization:{[UID]:{enabled:true,scope:'prototype-ingest-v1'}},
      projectionControl:{
        waterAuthority:{deviceId:UID,epoch:1,enabled:true,
          scope:'water-primary',receiptSignerFingerprint:issuerFp},
        devices:{[UID]:{initialized:false,epoch:1}}
      },
      staging:{ingestV1:{}},confirmedIngest:{},
      publicTelemetryLabV1:{
        water:{distanceCm:18.5,levelCm:6.5,status:'SAFE'},
        system:{lastUpdate:NOW-2500,overallRisk:'UNKNOWN'},
        gate:{status:'UNKNOWN'},alarm:{active:false}
      },
      privateIngest:{secret:'SYNTHETIC_PRIVATE'}
    };
    function publish(sequence,frame={}){
      const envelope={version:'floodguard-offline-envelope-v1',
        deviceId:UID,epoch:1,observedAtMs:NOW-1500+sequence*400,
        frame:{sequence,distanceCm:16.5,levelCm:8.5,risk:'WARNING',...frame}};
      const deviceSig=sign(null,Buffer.from(canonicalOfflineEnvelope(envelope)),
        device.privateKey).toString('base64url');
      assert.equal(journal.accept({envelope,signature:deviceSig}).accepted,true);
      const digest=createHash('sha256').update(canonicalOfflineEnvelope(envelope)).digest('hex');
      const receipt={version:'floodguard-offline-receipt-v1',
        deviceId:UID,epoch:1,sequence,digest,acceptedAtMs:NOW+50};
      const receiptSig=sign(null,Buffer.from(JSON.stringify(receipt)),
        issuer.privateKey).toString('base64url');
      root.staging.ingestV1[UID]={...envelope.frame};
      root.confirmedIngest[UID]={deviceId:UID,epoch:1,sequence,digest,
        acceptedAtMs:receipt.acceptedAtMs,status:'DATABASE_CONFIRMED'};
      const result=deriveHistoricalAtomicWaterStateLab({
        current:root,envelope,receipt,signature:receiptSig,
        trustedReceiptKey:issuer.publicKey,nowMs:NOW+100
      });
      assert.equal(result.allowed,true,JSON.stringify(result));
      root=result.next;
      return {envelope,receipt,receiptSig};
    }
    const observe=(sequence=1,overrides={})=>observeHistoricalOutboxRecordLab({
      pending:journal.pending(UID).find(x=>x.sequence===sequence),
      root,sourceBinding,trustedReceiptKey:issuer.publicKey,
      nowMs:NOW+100,...overrides
    });
    return work({publish,observe,journal,device,issuer,sourceBinding,
      get root(){return root;},replace:value=>{root=value;}});
  }finally{rmSync(directory,{recursive:true,force:true});}
}
const mutate=(x,fn)=>{const r=structuredClone(x.root);fn(r);x.replace(r);};
test('historical signed record remains observable after newer public reading replaces it',()=>withFixture(x=>{
  x.publish(1);
  const old=x.journal.pending(UID)[0];
  x.publish(2,{distanceCm:13.5,levelCm:11.5,risk:'DANGER'});
  const result=x.observe(1);
  assert.equal(result.observed,true,JSON.stringify(result));
  assert.equal(result.sequence,1);
  assert.equal(result.latestSequence,2);
  assert.equal(result.isLatest,false);
  assert.equal(result.canAcknowledge,false);
  assert.equal(result.notificationDelivery,'NOT_VERIFIED');
  assert.equal(x.journal.pending(UID).length,2);
  assert.deepEqual(x.journal.pending(UID)[0],old);
  assert.equal(x.root.publicTelemetryLabV1.water.status,'DANGER');
}));
test('latest record also observes only evidence and never clears a flood',()=>withFixture(x=>{
  x.publish(1);x.publish(2);
  const a=x.observe(2);
  assert.equal(a.observed,true,JSON.stringify(a));
  assert.equal(a.isLatest,true);
  assert.equal(a.canAcknowledge,false);
  assert.equal(a.floodClearance,'UNKNOWN');
  assert.equal(a.physicalGatePosition,'UNVERIFIED');
}));
test('missing historical entry cannot inherit proof from newer checkpoint',()=>withFixture(x=>{
  x.publish(1);x.publish(2);
  mutate(x,r=>delete r.publicationHistoryV1.entries.s_1);
  const result=x.observe(1);
  assert.equal(result.observed,false);
  assert.equal(result.canAcknowledge,false);
  assert.equal(x.journal.pending(UID).length,2);
}));
test('altered historic signature, projected value, timestamp or digest fails',()=>withFixture(x=>{
  x.publish(1);x.publish(2);
  const original=structuredClone(x.root);
  const changes=[
    r=>r.publicationHistoryV1.entries.s_1.receiptSignature='A'.repeat(86),
    r=>r.publicationHistoryV1.entries.s_1.distanceCm=5,
    r=>r.publicationHistoryV1.entries.s_1.observedAtMs+=300,
    r=>r.publicationHistoryV1.entries.s_1.digest='0'.repeat(64),
    r=>r.publicationHistoryV1.entries.s_1.status={ip:'PRIVATE'}
  ];
  for(const change of changes){
    const r=structuredClone(original);change(r);x.replace(r);
    assert.equal(x.observe(1).observed,false);
  }
  x.replace(original);
}));
test('latest checkpoint, confirmed record and current public projection must agree',()=>withFixture(x=>{
  x.publish(1);x.publish(2);
  const original=structuredClone(x.root);
  const changes=[
    r=>r.projectionControl.devices[UID].sequence=3,
    r=>r.projectionControl.devices[UID].digest='f'.repeat(64),
    r=>r.confirmedIngest[UID].sequence=1,
    r=>r.confirmedIngest[UID].status='PENDING',
    r=>r.publicTelemetryLabV1.water.status='SAFE',
    r=>r.publicTelemetryLabV1.water.status={ip:'PRIVATE'},
    r=>r.publicTelemetryLabV1.esp8266={wifi:'PRIVATE'},
    r=>r.publicationHistoryV1.entries.s_2.receiptSignature='A'.repeat(86)
  ];
  for(const change of changes){
    const r=structuredClone(original);change(r);x.replace(r);
    assert.equal(x.observe(1).observed,false);
  }
}));
test('revocation, source key mismatch and receipt issuer mismatch block historical proof',()=>withFixture(x=>{
  x.publish(1);x.publish(2);
  mutate(x,r=>r.deviceAuthorization[UID].enabled=false);
  assert.equal(x.observe(1).observed,false);
  mutate(x,r=>r.deviceAuthorization[UID].enabled=true);
  const stranger=generateKeyPairSync('ed25519');
  assert.equal(x.observe(1,{sourceBinding:{...x.sourceBinding,
    publicKey:stranger.publicKey}}).observed,false);
  assert.equal(x.observe(1,{trustedReceiptKey:stranger.publicKey}).observed,false);
}));
test('no historical proof from missing local frame or invalid root snapshot',()=>withFixture(x=>{
  x.publish(1);x.publish(2);
  assert.equal(x.observe(3).observed,false);
  assert.equal(x.observe(1,{root:null}).observed,false);
  assert.equal(x.observe(1,{nowMs:NaN}).observed,false);
}));
test('reported SAFE still cannot independently certify physical safety',()=>withFixture(x=>{
  x.publish(1,{distanceCm:18.5,levelCm:6.5,risk:'SAFE'});
  x.publish(2,{distanceCm:13.5,levelCm:11.5,risk:'DANGER'});
  const result=x.observe(1);
  assert.equal(result.observed,true);
  assert.equal(result.floodClearance,'UNKNOWN');
  assert.equal(result.sourceFreshness,'NOT_CERTIFIED');
  assert.equal(result.canAcknowledge,false);
}));
test('read-only historical reconciler has no SDK, write or ACK path',()=>{
  const s=readFileSync('experiments/historical-outbox-observer-lab.mjs','utf8');
  for(const q of ['firebase-admin','firebase/database','node:https','servo.write'])
    assert.ok(!s.includes(q));
  assert.doesNotMatch(s,/\b(?:db|database|ref|target)\.(?:set|update|remove|transaction)\s*\(/);
  assert.doesNotMatch(s,/\.acknowledge\s*\(|\.delete\s*\(|fetch\s*\(/);
});
