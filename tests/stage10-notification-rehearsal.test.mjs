import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {createHash,generateKeyPairSync,randomBytes,sign} from 'node:crypto';
import {canonicalOfflineEnvelope} from '../experiments/stage7-durable-ingress.mjs';
import {createStage8OfflineReceiptContract,createStage8OfflineReceiptLedger,
  makeStage8ReconciliationQuery} from '../experiments/stage8-ack-reconciliation.mjs';
import {createStage9OfflineOutbox,createStage9SyntheticDatabase} from '../experiments/stage9-downstream-outbox.mjs';
import {createStage10SyntheticProvider,createStage10SyntheticNotificationLab}
  from '../experiments/stage10-notification-rehearsal.mjs';

const uid='device-stage-a';
function fixture(){
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'floodguard-stage10-'));
  const integrityKey=randomBytes(32),device=generateKeyPairSync('ed25519'),
    server=generateKeyPairSync('ed25519');
  let ms=1700000000000;
  const ledger=()=>createStage8OfflineReceiptLedger({directory,integrityKey});
  const newGateway=()=>{
    const gateway=createStage8OfflineReceiptContract({
      ledger:ledger(),clock:()=>ms,
      serverPrivateKey:server.privateKey,serverPublicKey:server.publicKey
    });
    gateway.provision(uid,{devicePublicKey:device.publicKey});
    return {gateway,proof:gateway.issueSyntheticChannelProof()};
  };
  const first=newGateway();
  const keyFingerprint=createHash('sha256').update(device.publicKey.export({format:'der',type:'spki'})).digest('hex');
  const outbox=()=>createStage9OfflineOutbox({directory,integrityKey,stage8Ledger:ledger(),
    stage8PublicKey:server.publicKey});
  const database=()=>createStage9SyntheticDatabase({directory,integrityKey});
  const lab=()=>createStage10SyntheticNotificationLab({directory,integrityKey,outbox:outbox(),
    database:database(),clock:()=>ms});
  const provider=()=>createStage10SyntheticProvider({directory,integrityKey,clock:()=>ms});
  const envelope=(seq)=>({version:'floodguard-offline-envelope-v1',deviceId:uid,
    epoch:1,observedAtMs:ms,frame:{sequence:seq,distanceCm:16.5,levelCm:8.5,risk:'WARNING'}});
  const signature=e=>sign(null,Buffer.from(canonicalOfflineEnvelope(e)),device.privateKey).toString('base64url');
  const ingest=(seq,failPoint)=>{const e=envelope(seq);return {e,...first.gateway.ingest({
    envelope:e,signature:signature(e),channelProof:first.proof,failPoint
  })};};
  const storeReceipt=r=>outbox().enqueue({...r,keyFingerprint});
  const confirmed=seq=>{
    const receipt=ingest(seq);
    assert.equal(receipt.accepted,true);
    assert.equal(storeReceipt(receipt).status,'enqueued');
    assert.equal(outbox().deliverOne({deviceId:uid,sink:database()}).status,'database-confirmed');
    return receipt;
  };
  return {directory,integrityKey,device,server,first,newGateway,ledger,outbox,database,lab,provider,
    envelope,signature,ingest,storeReceipt,confirmed,keyFingerprint,
    tick:n=>{ms+=n;},time:()=>ms,
    clean:()=>fs.rmSync(directory,{recursive:true,force:true})};
}
function withFixture(fn){const x=fixture();try{fn(x);}finally{x.clean();}}
test('end-to-end synthetic signature -> acceptance -> mock database -> fake notification',()=>withFixture(x=>{
  const read=x.confirmed(1);
  const lab=x.lab(),mock=x.provider();
  assert.equal(lab.queue(uid).status,'queued-simulation-only');
  assert.deepEqual(lab.status(uid),{kind:'OFFLINE_SIMULATION',
    database:'SYNTHETIC_DATABASE_CONFIRMED',notification:'QUEUED_SYNTHETIC_ONLY'});
  assert.equal(lab.dispatch({deviceId:uid,provider:mock}).status,'mock-notification-confirmed');
  assert.equal(mock.get(uid).sequence,1);
  assert.equal(lab.status(uid).notification,'SIMULATED_PROVIDER_ACK_ONLY');
  assert.equal(read.receipt.sequence,1);
  assert.deepEqual(lab.audit().map(e=>e.type),['QUEUED','MOCK_ACK_RECORDED']);
}));
test('notification cannot queue when reading is accepted but database not confirmed',()=>withFixture(x=>{
  const accepted=x.ingest(1);
  assert.equal(x.lab().queue(uid).status,'blocked-no-database-confirmation');
  assert.equal(x.storeReceipt(accepted).status,'enqueued');
  assert.equal(x.lab().queue(uid).status,'blocked-no-database-confirmation');
  assert.equal(x.lab().status(uid).notification,'NOT_QUEUED');
}));
test('database confirmation after unknown write outcome unlocks simulated notification',()=>withFixture(x=>{
  const accepted=x.ingest(1);x.storeReceipt(accepted);
  assert.equal(x.outbox().deliverOne({deviceId:uid,sink:x.database(),
    failPoint:'after-sink-before-confirm'}).status,'database-outcome-unknown');
  assert.equal(x.lab().queue(uid).status,'blocked-no-database-confirmation');
  assert.equal(x.outbox().deliverOne({deviceId:uid,sink:x.database()}).status,'database-confirmed');
  assert.equal(x.lab().queue(uid).status,'queued-simulation-only');
}));
test('crash before mock provider retains queued state and does not create fake delivery',()=>withFixture(x=>{
  x.confirmed(1);x.lab().queue(uid);
  assert.equal(x.lab().dispatch({deviceId:uid,provider:x.provider(),failPoint:'before-mock-provider'}).status,
    'simulated-before-mock');
  assert.equal(x.provider().get(uid),null);
  assert.equal(x.lab().status(uid).notification,'QUEUED_SYNTHETIC_ONLY');
}));
test('crash after fake provider stores acknowledgement is idempotent on restart',()=>withFixture(x=>{
  x.confirmed(1);x.lab().queue(uid);
  assert.equal(x.lab().dispatch({deviceId:uid,provider:x.provider(),
    failPoint:'after-mock-provider-before-confirm'}).status,'simulated-provider-outcome-unknown');
  assert.equal(x.provider().get(uid).sequence,1);
  assert.equal(x.lab().status(uid).notification,'QUEUED_SYNTHETIC_ONLY');
  const restarted=x.lab(),provider=x.provider();
  assert.equal(restarted.dispatch({deviceId:uid,provider}).status,'mock-notification-confirmed');
  assert.equal(restarted.dispatch({deviceId:uid,provider}).status,'already-simulated');
  assert.equal(provider.audit().length,1,'fake provider must not record duplicate delivery');
  assert.deepEqual(restarted.audit().map(e=>e.type),['QUEUED','MOCK_ACK_RECORDED']);
}));
test('unapproved provider is rejected without any callbacks or state changes',()=>withFixture(x=>{
  x.confirmed(1);x.lab().queue(uid);
  let invoked=false;
  assert.equal(x.lab().dispatch({deviceId:uid,provider:{put:()=>{invoked=true;}}}).status,'unapproved-mock-provider');
  assert.equal(invoked,false);
  assert.equal(x.lab().status(uid).notification,'QUEUED_SYNTHETIC_ONLY');
}));
test('tampered mock database refuses confirmation and blocks simulated sends',()=>withFixture(x=>{
  x.confirmed(1);x.lab().queue(uid);
  const file=path.join(x.directory,'stage9-database.json');
  const doc=JSON.parse(fs.readFileSync(file,'utf8'));
  doc.state.entries[uid].sequence=0;
  fs.writeFileSync(file,JSON.stringify(doc));
  assert.equal(x.lab().status(uid).database,'NOT_VERIFIED');
  assert.equal(x.lab().dispatch({deviceId:uid,provider:x.provider()}).status,'blocked-no-database-confirmation');
}));
test('old or mismatched notification cannot masquerade as a fresh database confirmation',()=>withFixture(x=>{
  x.confirmed(1);x.lab().queue(uid);
  x.confirmed(2);
  assert.equal(x.lab().status(uid).database,'NOT_VERIFIED');
  assert.equal(x.lab().dispatch({deviceId:uid,provider:x.provider()}).status,'blocked-no-database-confirmation');
  assert.equal(x.lab().queue(uid).status,'prior-mock-notification-unresolved');
}));
test('previous simulated notification can be superseded by a newer confirmed reading',()=>withFixture(x=>{
  x.confirmed(1);x.lab().queue(uid);
  assert.equal(x.lab().dispatch({deviceId:uid,provider:x.provider()}).status,'mock-notification-confirmed');
  x.confirmed(2);
  assert.equal(x.lab().queue(uid).status,'queued-simulation-only');
  assert.equal(x.lab().dispatch({deviceId:uid,provider:x.provider()}).status,'mock-notification-confirmed');
  assert.equal(x.provider().get(uid).sequence,2);
}));
test('repeated queueing and dispatch never record duplicate fake delivery',()=>withFixture(x=>{
  x.confirmed(1);
  const lab=x.lab(),mock=x.provider();
  assert.equal(lab.queue(uid).status,'queued-simulation-only');
  assert.equal(lab.queue(uid).status,'already-queued');
  assert.equal(lab.dispatch({deviceId:uid,provider:mock}).status,'mock-notification-confirmed');
  assert.equal(lab.dispatch({deviceId:uid,provider:mock}).status,'already-simulated');
  assert.equal(lab.queue(uid).status,'already-queued');
  assert.equal(mock.audit().length,1);
}));
test('tampered notification journal fails closed; audit is not trusted',()=>withFixture(x=>{
  x.confirmed(1);x.lab().queue(uid);
  const file=path.join(x.directory,'stage10-notifications.json');
  const doc=JSON.parse(fs.readFileSync(file,'utf8'));
  doc.state.entries[uid].status='SIMULATED_PROVIDER_ACK_ONLY';
  fs.writeFileSync(file,JSON.stringify(doc));
  assert.throws(()=>x.lab().status(uid),/integrity failure/);
  assert.throws(()=>x.lab().audit(),/integrity failure/);
}));
test('unknown or lost seal key cannot make a corrupt notification appear delivered',()=>withFixture(x=>{
  x.confirmed(1);x.lab().queue(uid);
  const lab=createStage10SyntheticNotificationLab({directory:x.directory,
    integrityKey:randomBytes(32),outbox:x.outbox(),database:x.database()});
  assert.throws(()=>lab.status(uid),/integrity failure/);
}));
test('orphan lock blocks delivery and is not automatically removed',()=>withFixture(x=>{
  x.confirmed(1);x.lab().queue(uid);
  const lock=path.join(x.directory,'stage10-notifications.lock');
  fs.writeFileSync(lock,'SUPERVISED-RECOVERY-ONLY',{flag:'wx'});
  assert.throws(()=>x.lab().status(uid),/EEXIST/);
  assert.equal(fs.readFileSync(lock,'utf8'),'SUPERVISED-RECOVERY-ONLY');
}));
test('audit events are synthetic and metadata-only, not real sensor, recipient or token data',()=>withFixture(x=>{
  x.confirmed(1);x.lab().queue(uid);x.lab().dispatch({deviceId:uid,provider:x.provider()});
  const trace=JSON.stringify(x.lab().audit())+JSON.stringify(x.provider().audit());
  assert.doesNotMatch(trace,/whatsapp|sms|phone|@|distanceCm|levelCm|Authorization|token|wifi|192\.0\.2/i);
  assert.match(trace,/MOCK_ACK_RECORDED/);
  assert.doesNotMatch(JSON.stringify(x.lab().status(uid)),/DELIVERED|LIVE/);
}));
test('lost acknowledgement at every stage recovers without emitting a real alert',()=>withFixture(x=>{
  const lost=x.ingest(7,'after-commit-before-ack');
  assert.equal(lost.reason,'ack-lost-outcome-unknown');
  const gateway=x.newGateway(),query=makeStage8ReconciliationQuery({
    deviceId:uid,epoch:1,sequence:7,
    digest:createHash('sha256').update(canonicalOfflineEnvelope(lost.e)).digest('hex'),
    requestedAtMs:x.time()
  });
  const signature=sign(null,Buffer.from(JSON.stringify(query)),x.device.privateKey).toString('base64url');
  const recovered=gateway.gateway.reconcile({query,signature,channelProof:gateway.proof});
  assert.equal(recovered.found,true);
  assert.equal(x.storeReceipt(recovered).status,'enqueued');
  assert.equal(x.outbox().deliverOne({deviceId:uid,sink:x.database(),
    failPoint:'after-sink-before-confirm'}).status,'database-outcome-unknown');
  assert.equal(x.outbox().deliverOne({deviceId:uid,sink:x.database()}).status,'database-confirmed');
  assert.equal(x.lab().queue(uid).status,'queued-simulation-only');
  assert.equal(x.lab().dispatch({deviceId:uid,provider:x.provider(),
    failPoint:'after-mock-provider-before-confirm'}).status,'simulated-provider-outcome-unknown');
  assert.equal(x.lab().dispatch({deviceId:uid,provider:x.provider()}).status,'mock-notification-confirmed');
  assert.equal(x.provider().audit().length,1);
}));
test('notification simulator has no network, production Firebase or WhatsApp runtime imports',()=>{
  const src=fs.readFileSync('experiments/stage10-notification-rehearsal.mjs','utf8');
  assert.doesNotMatch(src,/\b(?:fetch|WebSocket|XMLHttpRequest)\s*\(|\.listen\s*\(/);
  assert.doesNotMatch(src,/firebase-admin|process\.env|FIREBASE_DATABASE_URL|baileys|sendMessage\s*\(/);
  assert.doesNotMatch(src,/node:http|node:https|node:tls|node:net/);
});
