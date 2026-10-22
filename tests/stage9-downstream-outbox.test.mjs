import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {createHash,generateKeyPairSync,randomBytes,sign} from 'node:crypto';
import {canonicalOfflineEnvelope} from '../experiments/stage7-durable-ingress.mjs';
import {createStage8OfflineReceiptLedger,createStage8OfflineReceiptContract} from '../experiments/stage8-ack-reconciliation.mjs';
import {createStage9OfflineOutbox,createStage9SyntheticDatabase} from '../experiments/stage9-downstream-outbox.mjs';

const uid='device-stage-a';
function fixture(){
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'floodguard-stage9-test-'));
  const integrityKey=randomBytes(32);
  const signing=generateKeyPairSync('ed25519'),device=generateKeyPairSync('ed25519');
  const stage8Ledger=()=>createStage8OfflineReceiptLedger({directory,integrityKey});
  const stage8=()=>createStage8OfflineReceiptContract({
    ledger:stage8Ledger(),clock:()=>1700000000000,
    serverPrivateKey:signing.privateKey,serverPublicKey:signing.publicKey
  });
  const gateway=stage8();gateway.provision(uid,{devicePublicKey:device.publicKey});
  const channel=gateway.issueSyntheticChannelProof();
  const frame=seq=>({version:'floodguard-offline-envelope-v1',deviceId:uid,epoch:1,
    observedAtMs:1700000000000,frame:{sequence:seq,distanceCm:17,levelCm:8,risk:'SAFE'}});
  const accepted=seq=>{
    const envelope=frame(seq);
    const signature=sign(null,Buffer.from(canonicalOfflineEnvelope(envelope)),device.privateKey).toString('base64url');
    return gateway.ingest({envelope,signature,channelProof:channel});
  };
  const keyFingerprint=createHash('sha256')
    .update(device.publicKey.export({type:'spki',format:'der'})).digest('hex');
  return {directory,integrityKey,stage8Ledger,stage8,accepted,keyFingerprint,
    outbox:()=>createStage9OfflineOutbox({directory,integrityKey,stage8Ledger:stage8Ledger(),stage8PublicKey:signing.publicKey}),
    sink:()=>createStage9SyntheticDatabase({directory,integrityKey}),
    cleanup:()=>fs.rmSync(directory,{recursive:true,force:true})};
}
function run(fn){const x=fixture();try{fn(x);}finally{x.cleanup();}}
const add=(x,receipt)=>x.outbox().enqueue({...receipt,keyFingerprint:x.keyFingerprint});
test('uncommitted or invented receipt cannot create an outbox entry',()=>run(x=>{
  const r=x.accepted(1);
  assert.equal(r.accepted,true);
  const fake={receipt:{...r.receipt,sequence:3},signature:r.signature};
  assert.equal(add(x,fake).status,'unverified-source');
  const falseKey=x.outbox().enqueue({...r,keyFingerprint:'a'.repeat(64)});
  assert.equal(falseKey.status,'source-not-committed');
  assert.equal(x.outbox().pending(uid),null);
}));
test('Stage 8 confirmed receipt is queued but must NOT be described as database committed',()=>run(x=>{
  assert.equal(add(x,x.accepted(1)).status,'enqueued');
  assert.equal(x.outbox().pending(uid).status,'ACCEPTED_ONLY');
  assert.equal(x.sink().get(uid),null);
}));
test('crash before synthetic database call retains pending outbox and zero writes',()=>run(x=>{
  add(x,x.accepted(1));
  assert.equal(x.outbox().deliverOne({deviceId:uid,sink:x.sink(),failPoint:'before-sink'}).status,
    'simulated-before-database');
  assert.equal(x.sink().get(uid),null);
  assert.equal(x.outbox().pending(uid).status,'ACCEPTED_ONLY');
}));
test('crash after database commit but before acknowledgement resumes idempotently',()=>run(x=>{
  add(x,x.accepted(4));
  assert.equal(x.outbox().deliverOne({deviceId:uid,sink:x.sink(),failPoint:'after-sink-before-confirm'}).status,
    'database-outcome-unknown');
  assert.equal(x.sink().get(uid).sequence,4);
  assert.equal(x.outbox().pending(uid).status,'ACCEPTED_ONLY');
  assert.equal(x.outbox().deliverOne({deviceId:uid,sink:x.sink()}).status,'database-confirmed');
  assert.equal(x.sink().get(uid).sequence,4);
  assert.equal(x.outbox().pending(uid).status,'DATABASE_CONFIRMED');
}));
test('separate restart recreates outbox and sink without replaying accepted telemetry',()=>run(x=>{
  add(x,x.accepted(2));
  const sink=x.sink();
  x.outbox().deliverOne({deviceId:uid,sink,failPoint:'after-sink-before-confirm'});
  const restarted=x.outbox();
  assert.equal(restarted.deliverOne({deviceId:uid,sink:x.sink()}).status,'database-confirmed');
  assert.equal(restarted.deliverOne({deviceId:uid,sink:x.sink()}).status,'already-confirmed');
}));
test('a failed destination leaves pending outbox until supervised retry',()=>run(x=>{
  add(x,x.accepted(1));
  const broken={put:()=>{throw new Error('simulated outage');}};
  assert.equal(x.outbox().deliverOne({deviceId:uid,sink:broken}).status,'downstream-unavailable');
  assert.equal(x.outbox().pending(uid).status,'ACCEPTED_ONLY');
  assert.equal(x.outbox().deliverOne({deviceId:uid,sink:x.sink()}).status,'database-confirmed');
}));
test('new receipt is held while prior downstream delivery is unresolved',()=>run(x=>{
  add(x,x.accepted(1));
  assert.equal(add(x,x.accepted(2)).status,'prior-delivery-unresolved');
  assert.equal(x.outbox().pending(uid).sequence,1);
  assert.equal(x.outbox().deliverOne({deviceId:uid,sink:x.sink()}).status,'database-confirmed');
  // Stage 8 holds only the latest receipt, so enqueue the latest already-signed receipt.
  const next=x.accepted(3);
  assert.equal(add(x,next).status,'enqueued');
  assert.equal(x.outbox().pending(uid).sequence,3);
}));
test('older receipt cannot overwrite a newer queued or confirmed downstream record',()=>run(x=>{
  const first=x.accepted(1);add(x,first);
  x.outbox().deliverOne({deviceId:uid,sink:x.sink()});
  const recent=x.accepted(2);add(x,recent);
  assert.equal(add(x,first).status,'source-not-committed');
  assert.equal(x.outbox().pending(uid).sequence,2);
}));
test('tampering with outbox seal blocks drain and does not reset pending state',()=>run(x=>{
  add(x,x.accepted(1));
  const file=path.join(x.directory,'stage9-outbox.json');
  const doc=JSON.parse(fs.readFileSync(file,'utf8'));
  doc.state.entries[uid].status='DATABASE_CONFIRMED';
  fs.writeFileSync(file,JSON.stringify(doc));
  assert.throws(()=>x.outbox().pending(uid),/integrity mismatch/);
  assert.throws(()=>x.outbox().deliverOne({deviceId:uid,sink:x.sink()}),/integrity mismatch/);
}));
test('tampering with mock database seal cannot be interpreted as a successful write',()=>run(x=>{
  add(x,x.accepted(1));x.outbox().deliverOne({deviceId:uid,sink:x.sink()});
  const file=path.join(x.directory,'stage9-database.json');
  const doc=JSON.parse(fs.readFileSync(file,'utf8'));
  doc.state.entries[uid].sequence=0;fs.writeFileSync(file,JSON.stringify(doc));
  assert.throws(()=>x.sink().get(uid),/integrity mismatch/);
}));
test('abandoned outbox lock blocks retry and is not auto removed',()=>run(x=>{
  add(x,x.accepted(1));
  const file=path.join(x.directory,'stage9-outbox.lock');
  fs.writeFileSync(file,'MANUAL-REVIEW',{flag:'wx'});
  assert.throws(()=>x.outbox().pending(uid),/EEXIST/);
  assert.equal(fs.readFileSync(file,'utf8'),'MANUAL-REVIEW');
}));
test('the test sink has no alert-sending or WhatsApp-delivery state',()=>{
  const source=fs.readFileSync('experiments/stage9-downstream-outbox.mjs','utf8');
  assert.doesNotMatch(source,/\b(?:fetch|WebSocket|XMLHttpRequest)\s*\(|\.listen\s*\(/);
  assert.doesNotMatch(source,/firebase-admin|process\.env|FIREBASE_DATABASE_URL|baileys|sendMessage\s*\(/);
  assert.doesNotMatch(source,/node:http|node:https|node:tls|node:net/);
});
