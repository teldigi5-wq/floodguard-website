// Offline reconciliation against ACTUAL retained HMAC-sealed journal records.
// No Firebase SDK, production data, webhook, queue ACK, or physical control.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {createHash,generateKeyPairSync,randomBytes,sign} from 'node:crypto';
import {canonicalOfflineEnvelope} from '../experiments/stage7-durable-ingress.mjs';
import {createDurableAdmissionOutboxLab} from '../experiments/durable-admission-outbox-lab.mjs';
import {reconcileConfirmedWaterOutboxLab}
  from '../experiments/confirmed-outbox-reconciliation-lab.mjs';

const NOW=1793450000500,UID='device-stage-a';
function fixture(work,{risk='WARNING',distanceCm=16.5,levelCm=8.5}={}){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'fg-confirmed-outbox-'));
  try{
    const device=generateKeyPairSync('ed25519'),issuer=generateKeyPairSync('ed25519');
    const sourceBinding={deviceId:UID,epoch:1,enabled:true,
      scope:'prototype-ingest-v1',publicKey:device.publicKey};
    const journal=createDurableAdmissionOutboxLab({directory:dir,
      integrityKey:randomBytes(32),
      identities:new Map([[UID,sourceBinding]]),clock:()=>NOW});
    journal.commission();
    const envelope={version:'floodguard-offline-envelope-v1',
      deviceId:UID,epoch:1,observedAtMs:NOW-1000,
      frame:{sequence:1,distanceCm,levelCm,risk}};
    const signature=sign(null,Buffer.from(canonicalOfflineEnvelope(envelope)),
      device.privateKey).toString('base64url');
    const admission=journal.accept({envelope,signature});
    assert.equal(admission.accepted,true,JSON.stringify(admission));
    const pending=journal.pending(UID)[0];
    const receipt={version:'floodguard-offline-receipt-v1',
      deviceId:UID,epoch:1,sequence:1,digest:pending.digest,
      acceptedAtMs:NOW+50};
    const receiptSignature=sign(null,Buffer.from(JSON.stringify(receipt)),
      issuer.privateKey).toString('base64url');
    const fingerprint=createHash('sha256')
      .update(issuer.publicKey.export({type:'spki',format:'der'})).digest('hex');
    const root={
      projectionControl:{
        waterAuthority:{deviceId:UID,epoch:1,enabled:true,
          scope:'water-primary',receiptSignerFingerprint:fingerprint},
        devices:{[UID]:{initialized:true,epoch:1,sequence:1,digest:pending.digest}}
      },
      deviceAuthorization:{[UID]:{enabled:true,scope:'prototype-ingest-v1'}},
      confirmedIngest:{[UID]:{deviceId:UID,epoch:1,sequence:1,
        digest:pending.digest,acceptedAtMs:receipt.acceptedAtMs,status:'DATABASE_CONFIRMED'}},
      publicTelemetryLabV1:{
        water:{distanceCm,levelCm,status:risk},
        system:{lastUpdate:envelope.observedAtMs,overallRisk:'UNKNOWN'},
        gate:{status:'UNKNOWN'},
        alarm:{active:false}
      },
      privateIngest:{secret:'SYNTHETIC_PRIVATE_NEVER_PUBLIC'},
      live:{esp8266:{wifi:'SYNTHETIC_PRIVATE_NEVER_PUBLIC'}}
    };
    const input={pending,root,receipt,receiptSignature,
      trustedReceiptKey:issuer.publicKey,sourceBinding,nowMs:NOW+100};
    work({input,journal,device,issuer,dir});
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
}
const evaluate=x=>reconcileConfirmedWaterOutboxLab(x);
const copy=x=>structuredClone(x);

test('actual sealed outbox and independently signed matching database snapshot produce read-only match',()=>fixture(({input,journal})=>{
  const outcome=evaluate(input);
  assert.equal(outcome.confirmed,true,JSON.stringify(outcome));
  assert.equal(outcome.kind,'SYNTHETIC_DB_SNAPSHOT_MATCH_NO_ACK');
  assert.equal(outcome.canAcknowledge,false);
  assert.equal(outcome.floodClearance,'UNKNOWN');
  assert.equal(outcome.physicalGatePosition,'UNVERIFIED');
  assert.equal(outcome.notificationDelivery,'NOT_VERIFIED');
  assert.equal(outcome.sourceFreshness,'NOT_CERTIFIED');
  assert.equal(journal.pending(UID).length,1,'reconciliation must NOT delete outbox payload');
}));

test('signed reported SAFE still cannot certify physical clearance',()=>fixture(({input})=>{
  const r=evaluate(input);assert.equal(r.confirmed,true);
  assert.equal(input.root.publicTelemetryLabV1.water.status,'SAFE');
  assert.equal(r.floodClearance,'UNKNOWN');
  assert.equal(r.canAcknowledge,false);
},{risk:'SAFE',distanceCm:18.5,levelCm:6.5}));

test('missing and pending-only confirmation cannot establish publication',()=>fixture(({input})=>{
  for(const value of [undefined,null,{...input.root.confirmedIngest[UID],status:'PENDING'}]){
    const root=copy(input.root);
    if(value===undefined)delete root.confirmedIngest[UID];
    else root.confirmedIngest[UID]=value;
    assert.equal(evaluate({...input,root}).confirmed,false);
  }
}));

test('wrong receipt issuer, signature, digest or accepted timestamp never confirm',()=>fixture(({input})=>{
  const stranger=generateKeyPairSync('ed25519');
  assert.equal(evaluate({...input,trustedReceiptKey:stranger.publicKey}).confirmed,false);
  assert.equal(evaluate({...input,receiptSignature:'A'.repeat(86)}).confirmed,false);
  assert.equal(evaluate({...input,receipt:{...input.receipt,digest:'a'.repeat(64)}}).confirmed,false);
  assert.equal(evaluate({...input,receipt:{...input.receipt,acceptedAtMs:NOW+75}}).confirmed,false);
}));

test('revoked water authority, member, wrong scope and signer pin fail closed',()=>fixture(({input})=>{
  for(const change of [
    r=>{r.projectionControl.waterAuthority.enabled=false;},
    r=>{r.projectionControl.waterAuthority.scope='gate-primary';},
    r=>{r.projectionControl.waterAuthority.receiptSignerFingerprint='f'.repeat(64);},
    r=>{r.deviceAuthorization[UID].enabled=false;},
    r=>{r.deviceAuthorization[UID].scope='public-reader';}
  ]){
    const root=copy(input.root);change(root);
    assert.equal(evaluate({...input,root}).confirmed,false);
  }
}));

test('checkpoint sequence advanced or digest conflict cannot retire older retained reading',()=>fixture(({input})=>{
  for(const change of [
    r=>{r.projectionControl.devices[UID].sequence=2;},
    r=>{r.projectionControl.devices[UID].digest='b'.repeat(64);},
    r=>{delete r.projectionControl.devices[UID];},
    r=>{r.projectionControl.devices[UID].initialized=false;}
  ]){
    const root=copy(input.root);change(root);
    const result=evaluate({...input,root});
    assert.equal(result.confirmed,false);
    assert.equal(result.canAcknowledge,false);
  }
}));

test('public projection mismatch or private extra field blocks reconciliation',()=>fixture(({input})=>{
  for(const change of [
    r=>{r.publicTelemetryLabV1.water.status='SAFE';},
    r=>{r.publicTelemetryLabV1.system.overallRisk='LOW';},
    r=>{r.publicTelemetryLabV1.system.lastUpdate+=1000;},
    r=>{r.publicTelemetryLabV1.water.status={secret:'SYNTHETIC_PRIVATE'};},
    r=>{r.publicTelemetryLabV1.water.extra='SECRET';},
    r=>{r.publicTelemetryLabV1.esp8266={wifi:'SYNTHETIC_PRIVATE'};}
  ]){
    const root=copy(input.root);change(root);
    assert.equal(evaluate({...input,root}).confirmed,false);
  }
}));

test('tampered retained digest and device signature cannot be reconciled',()=>fixture(({input})=>{
  assert.equal(evaluate({...input,pending:{...input.pending,digest:'0'.repeat(64)}}).confirmed,false);
  assert.equal(evaluate({...input,pending:{...input.pending,signature:'A'.repeat(86)}}).confirmed,false);
  const stranger=generateKeyPairSync('ed25519');
  assert.equal(evaluate({...input,sourceBinding:{...input.sourceBinding,
    publicKey:stranger.publicKey}}).confirmed,false);
}));

test('untrusted empty root, invalid nowMs and receipt from future never confirm',()=>fixture(({input})=>{
  assert.equal(evaluate({...input,root:undefined}).confirmed,false);
  assert.equal(evaluate({...input,nowMs:NaN}).confirmed,false);
  assert.equal(evaluate({...input,nowMs:NOW-100}).confirmed,false);
}));

test('no network, write, outbox ACK or physical command interfaces in reconciler',()=>{
  const src=fs.readFileSync('experiments/confirmed-outbox-reconciliation-lab.mjs','utf8');
  assert.doesNotMatch(src,/firebase-admin|node:https|fetch\s*\(|\.transaction\s*\(/);
  assert.doesNotMatch(src,/\.set\s*\(|\.remove\s*\(|\.update\s*\(|servo\.write|sendMessage\s*\(/);
  assert.doesNotMatch(src,/\.acknowledge\s*\(|\.delete\s*\(/);
});
