import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,generateKeyPairSync,randomBytes,sign} from 'node:crypto';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {canonicalOfflineEnvelope} from '../experiments/stage7-durable-ingress.mjs';
import {createDurableAdmissionOutboxLab}
  from '../experiments/durable-admission-outbox-lab.mjs';
import {deriveHistoricalAtomicWaterStateLab}
  from '../experiments/immutable-publication-history-lab.mjs';
import {canonicalPublicationHistoryWitnessLab,observePinnedHistoricalWitnessLab}
  from '../experiments/pinned-historical-witness-lab.mjs';

const NOW=1793450000500,UID='device-stage-a';
const VERSION='floodguard-external-publication-witness-lab-v1';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const fp=key=>sha(key.export({format:'der',type:'spki'}));
function fixture(fn){
  const directory=mkdtempSync(path.join(os.tmpdir(),'fg-pinned-witness-'));
  try {
    const device=generateKeyPairSync('ed25519');
    const issuer=generateKeyPairSync('ed25519');
    const witnessKey=generateKeyPairSync('ed25519');
    const sourceBinding={deviceId:UID,epoch:1,enabled:true,
      scope:'prototype-ingest-v1',publicKey:device.publicKey};
    const journal=createDurableAdmissionOutboxLab({
      directory,integrityKey:randomBytes(32),clock:()=>NOW,
      identities:new Map([[UID,sourceBinding]])
    });
    journal.commission();
    let root={
      deviceAuthorization:{[UID]:{enabled:true,scope:'prototype-ingest-v1'}},
      projectionControl:{waterAuthority:{deviceId:UID,epoch:1,
        enabled:true,scope:'water-primary',receiptSignerFingerprint:fp(issuer.publicKey)},
        devices:{[UID]:{initialized:false,epoch:1}}},
      staging:{ingestV1:{}},confirmedIngest:{},
      publicTelemetryLabV1:{
        water:{distanceCm:18.5,levelCm:6.5,status:'SAFE'},
        system:{lastUpdate:NOW-3000,overallRisk:'UNKNOWN'},
        gate:{status:'UNKNOWN'},alarm:{active:false}},
      privateIngest:{secret:'SYNTHETIC_PRIVATE'}
    };
    function append(sequence,{risk='WARNING',distanceCm=16.5,levelCm=8.5}={}){
      const envelope={version:'floodguard-offline-envelope-v1',
        deviceId:UID,epoch:1,observedAtMs:NOW-1600+sequence*400,
        frame:{sequence,distanceCm,levelCm,risk}};
      const signed=sign(null,Buffer.from(canonicalOfflineEnvelope(envelope)),
        device.privateKey).toString('base64url');
      assert.equal(journal.accept({envelope,signature:signed}).accepted,true);
      const digest=sha(canonicalOfflineEnvelope(envelope));
      const receipt={version:'floodguard-offline-receipt-v1',deviceId:UID,
        epoch:1,sequence,digest,acceptedAtMs:NOW-200};
      const sig=sign(null,Buffer.from(JSON.stringify(receipt)),
        issuer.privateKey).toString('base64url');
      root.staging.ingestV1[UID]={...envelope.frame};
      root.confirmedIngest[UID]={deviceId:UID,epoch:1,sequence,digest,
        acceptedAtMs:receipt.acceptedAtMs,status:'DATABASE_CONFIRMED'};
      const next=deriveHistoricalAtomicWaterStateLab({current:root,
        envelope,receipt,signature:sig,
        trustedReceiptKey:issuer.publicKey,nowMs:NOW});
      assert.equal(next.allowed,true,JSON.stringify(next));
      root=next.next;
      return {envelope,receipt};
    }
    function signedWitness(snapshot=root){
      const head=snapshot.projectionControl.devices[UID];
      const historyDigest=sha(canonicalPublicationHistoryWitnessLab(
        snapshot.publicationHistoryV1));
      const witness={version:VERSION,deviceId:UID,epoch:1,
        sequence:head.sequence,digest:head.digest,
        historyDigest,receiptSignerFingerprint:fp(issuer.publicKey),
        witnessedAtMs:NOW};
      const signature=sign(null,Buffer.from(JSON.stringify(witness)),
        witnessKey.privateKey).toString('base64url');
      return {witness,signature,head:{sequence:head.sequence,digest:head.digest,
        historyDigest}};
    }
    const observe=(sequence=1,other={})=>{
      const current=signedWitness();
      return observePinnedHistoricalWitnessLab({
        pending:journal.pending(UID).find(x=>x.sequence===sequence),
        root,sourceBinding,trustedReceiptKey:issuer.publicKey,
        trustedWitnessKey:witnessKey.publicKey,
        expectedWitnessFingerprint:fp(witnessKey.publicKey),
        trustedExternalHead:current.head,witness:current.witness,
        witnessSignature:current.signature,nowMs:NOW+100,...other
      });
    };
    return fn({append,observe,signedWitness,journal,sourceBinding,issuer,
      device,witnessKey,get root(){return root;},setRoot:r=>{root=r;}});
  }finally{rmSync(directory,{recursive:true,force:true});}
}

test('two signed frames and independently signed recent current head observe older event without ACK',()=>fixture(x=>{
  x.append(1);x.append(2,{risk:'DANGER',distanceCm:13.5,levelCm:11.5});
  const result=x.observe(1);
  assert.equal(result.observed,true,JSON.stringify(result));
  assert.equal(result.kind,'PINNED_EXTERNAL_WITNESS_MATCH_LAB_ONLY');
  assert.equal(result.sequence,1);
  assert.equal(result.latestSequence,2);
  assert.equal(result.canAcknowledge,false);
  assert.equal(result.notificationDelivery,'NOT_VERIFIED');
  assert.equal(x.journal.pending(UID).length,2);
}));
test('externally retained newer head defeats simultaneous older database and signed witness rollback',()=>fixture(x=>{
  x.append(1);
  const oldRoot=structuredClone(x.root);
  const old=x.signedWitness(oldRoot);
  x.append(2,{risk:'DANGER',distanceCm:13.5,levelCm:11.5});
  const newHead=x.signedWitness().head;
  x.setRoot(oldRoot);
  const oldMatched=x.observe(1,{witness:old.witness,
    witnessSignature:old.signature,trustedExternalHead:newHead});
  assert.equal(oldMatched.observed,false);
  assert.equal(oldMatched.reason,'external-witness-snapshot-mismatch');
  assert.equal(x.journal.pending(UID).length,2);
}));
test('signature-only old witness is rejected when external monotonic head is unavailable',()=>fixture(x=>{
  x.append(1);
  assert.equal(x.observe(1,{trustedExternalHead:null}).observed,false);
  assert.equal(x.observe(1,{trustedExternalHead:{}}).observed,false);
}));
test('different pinned witness signer and original receipt issuer are mandatory',()=>fixture(x=>{
  x.append(1);
  assert.equal(x.observe(1,{expectedWitnessFingerprint:'a'.repeat(64)}).observed,false);
  assert.equal(x.observe(1,{trustedWitnessKey:x.issuer.publicKey,
    expectedWitnessFingerprint:fp(x.issuer.publicKey)}).observed,false);
  const unknown=generateKeyPairSync('ed25519');
  assert.equal(x.observe(1,{trustedWitnessKey:unknown.publicKey,
    expectedWitnessFingerprint:fp(unknown.publicKey)}).observed,false);
}));
test('tampered digest, unsigned witness and changed event history cannot pass',()=>fixture(x=>{
  x.append(1);x.append(2);
  const v=x.signedWitness();
  assert.equal(x.observe(1,{witnessSignature:'A'.repeat(86)}).observed,false);
  assert.equal(x.observe(1,{witness:{...v.witness,digest:'a'.repeat(64)}}).observed,false);
  const root=structuredClone(x.root);
  root.publicationHistoryV1.entries.s_1.distanceCm=5;
  x.setRoot(root);
  assert.equal(x.observe(1).observed,false);
}));
test('last checkpoint and source authorization must be current and consistent',()=>fixture(x=>{
  x.append(1);x.append(2);
  const original=structuredClone(x.root);
  for(const change of [
    r=>r.deviceAuthorization[UID].enabled=false,
    r=>r.projectionControl.devices[UID].digest='a'.repeat(64),
    r=>r.publicTelemetryLabV1.water.status='SAFE',
    r=>r.publicationHistoryV1.entries.s_2.receiptSignature='A'.repeat(86)
  ]){
    const altered=structuredClone(original);change(altered);x.setRoot(altered);
    assert.equal(x.observe(1).observed,false);
  }
}));
test('stale or future signed witness clocks cannot assert current proof',()=>fixture(x=>{
  x.append(1);const current=x.signedWitness();
  assert.equal(x.observe(1,{nowMs:NOW+31000}).observed,false);
  assert.equal(x.observe(1,{nowMs:NOW-3000}).observed,false);
  assert.equal(x.observe(1,{witness:{...current.witness,
    witnessedAtMs:NOW+5000}}).observed,false);
}));
test('history digest is canonical across object insertion ordering',()=>fixture(x=>{
  x.append(1);x.append(2);
  const h=x.root.publicationHistoryV1;
  const reordered={...h,entries:{s_2:h.entries.s_2,s_1:h.entries.s_1}};
  assert.equal(canonicalPublicationHistoryWitnessLab(reordered),
    canonicalPublicationHistoryWitnessLab(h));
}));
test('source has no witness key issuance, remote connection, writes or outbox ACK',()=>{
  const src=readFileSync('experiments/pinned-historical-witness-lab.mjs','utf8');
  assert.doesNotMatch(src,/firebase-admin|node:https|fetch\s*\(|\.acknowledge\s*\(/);
  assert.doesNotMatch(src,/\b(?:db|ref|database)\.(?:set|update|remove|transaction)\s*\(/);
  assert.doesNotMatch(src,/\.delete\s*\(|servo\.write|sendMessage\s*\(/);
});
