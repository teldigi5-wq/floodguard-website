import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {createHash,createHmac,generateKeyPairSync,randomBytes,sign} from 'node:crypto';
import {canonicalOfflineEnvelope} from '../experiments/stage7-durable-ingress.mjs';
import {createStage8OfflineReceiptLedger,createStage8OfflineReceiptContract,
  makeStage8ReconciliationQuery,verifyStage8OfflineReceipt} from '../experiments/stage8-ack-reconciliation.mjs';

const uid='device-stage-a';
const make=()=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'floodguard-stage8-synthetic-'));
  const integrityKey=randomBytes(32),deviceKeys=generateKeyPairSync('ed25519'),
    serverKeys=generateKeyPairSync('ed25519');
  let ms=1700000000000;
  const ledger=()=>createStage8OfflineReceiptLedger({directory,integrityKey});
  const instance=()=>createStage8OfflineReceiptContract({
    ledger:ledger(),clock:()=>ms,serverPrivateKey:serverKeys.privateKey,serverPublicKey:serverKeys.publicKey
  });
  const bootstrap=()=>{
    const contract=instance();
    contract.provision(uid,{devicePublicKey:deviceKeys.publicKey});
    return {contract,proof:contract.issueSyntheticChannelProof()};
  };
  const first=bootstrap();
  const envelope=(sequence,other={})=>({
    version:'floodguard-offline-envelope-v1',deviceId:uid,epoch:1,observedAtMs:ms,
    frame:{sequence,distanceCm:18.5,levelCm:6.5,risk:'SAFE'},...other
  });
  const bytes=value=>Buffer.from(canonicalOfflineEnvelope(value));
  const signDevice=value=>sign(null,bytes(value),deviceKeys.privateKey).toString('base64url');
  const signedQuery=e=>{
    const query=makeStage8ReconciliationQuery({deviceId:e.deviceId,epoch:e.epoch,sequence:e.frame.sequence,
      digest:createHash('sha256').update(bytes(e)).digest('hex'),requestedAtMs:ms});
    const signature=sign(null,Buffer.from(JSON.stringify(query)),deviceKeys.privateKey).toString('base64url');
    return {query,signature};
  };
  const ingest=(e,additional={})=>first.contract.ingest({
    envelope:e,signature:signDevice(e),channelProof:first.proof,...additional
  });
  return {directory,integrityKey,deviceKeys,serverKeys,ledger,instance,bootstrap,first,
    envelope,signDevice,signedQuery,ingest,advance:n=>ms+=n,
    cleanup:()=>fs.rmSync(directory,{recursive:true,force:true})};
};
function withTest(fn){const x=make();try{fn(x);}finally{x.cleanup();}}
test('signed receipt binds the exact authenticated sequence, digest and synthetic identity',()=>withTest(x=>{
  const e=x.envelope(1),accepted=x.ingest(e);
  assert.equal(accepted.accepted,true);
  assert.equal(accepted.receipt.sequence,1);
  assert.equal(accepted.receipt.deviceId,uid);
  const request=x.signedQuery(e);
  assert.equal(verifyStage8OfflineReceipt({...accepted,publicKey:x.serverKeys.publicKey,expected:request.query}),true);
  assert.equal(x.ledger().lookup({...request.query,keyFingerprint:
    createHash('sha256').update(x.deviceKeys.publicKey.export({format:'der',type:'spki'})).digest('hex')})?.receipt.sequence,1);
}));
test('crash before ledger commit leaves no receipt and permits a later new accept',()=>withTest(x=>{
  const e=x.envelope(1);
  assert.equal(x.ingest(e,{failPoint:'before-commit'}).reason,'simulated-before-commit');
  const {query,signature}=x.signedQuery(e);
  assert.equal(x.first.contract.reconcile({query,signature,channelProof:x.first.proof}).found,false);
  assert.equal(x.ingest(e).accepted,true);
}));
test('lost acknowledgement recovered after restart without accepting duplicate telemetry',()=>withTest(x=>{
  const e=x.envelope(7);
  assert.equal(x.ingest(e,{failPoint:'after-commit-before-ack'}).reason,'ack-lost-outcome-unknown');
  const restart=x.bootstrap(),{query,signature}=x.signedQuery(e);
  const recovered=restart.contract.reconcile({query,signature,channelProof:restart.proof});
  assert.equal(recovered.found,true);
  assert.equal(recovered.kind,'SYNTHETIC_RECOVERED_ACK_ONLY');
  assert.equal(verifyStage8OfflineReceipt({...recovered,publicKey:x.serverKeys.publicKey,expected:query}),true);
  assert.equal(restart.contract.ingest({envelope:e,signature:x.signDevice(e),channelProof:restart.proof}).reason,
    'already-committed-reconcile');
}));
test('same signed replay after restart is never ingested as a new reading',()=>withTest(x=>{
  const e=x.envelope(4);assert.equal(x.ingest(e).accepted,true);
  const restarted=x.bootstrap();
  assert.equal(restarted.contract.ingest({envelope:e,signature:x.signDevice(e),channelProof:restarted.proof}).reason,
    'already-committed-reconcile');
  const lower=x.envelope(3);
  assert.equal(restarted.contract.ingest({envelope:lower,signature:x.signDevice(lower),channelProof:restarted.proof}).reason,
    'older-sequence');
}));
test('same sequence with different signed sensor content is a conflict',()=>withTest(x=>{
  assert.equal(x.ingest(x.envelope(2)).accepted,true);
  const other=x.envelope(2,{frame:{sequence:2,distanceCm:9,levelCm:16,risk:'DANGER'}});
  assert.equal(x.ingest(other).reason,'sequence-conflict');
  const {query,signature}=x.signedQuery(other);
  assert.equal(x.first.contract.reconcile({query,signature,channelProof:x.first.proof}).found,false);
}));
test('old receipt is not confused with newer telemetry at the same device',()=>withTest(x=>{
  const old=x.envelope(1);x.ingest(old);
  const recent=x.envelope(2);x.ingest(recent);
  const request=x.signedQuery(old);
  assert.equal(x.first.contract.reconcile({...request,channelProof:x.first.proof}).reason,'not-found-or-not-current');
  const newer=x.signedQuery(recent);
  assert.equal(x.first.contract.reconcile({...newer,channelProof:x.first.proof}).found,true);
}));
test('invalid/unsigned queries, forged transport marker and wrong server verification key fail',()=>withTest(x=>{
  const e=x.envelope(1),accepted=x.ingest(e);
  const {query,signature}=x.signedQuery(e);
  for(const attempt of [
    {query,signature:'fakedsignature',channelProof:x.first.proof},
    {query,signature,channelProof:{kind:'SIMULATED_CHANNEL_NOT_REAL_TLS'}},
    {query:{...query,deviceId:'device-stage-b'},signature,channelProof:x.first.proof},
    {query:{...query,digest:'0'.repeat(64)},signature,channelProof:x.first.proof}
  ])assert.equal(x.first.contract.reconcile(attempt).found,false);
  assert.equal(verifyStage8OfflineReceipt({...accepted,publicKey:generateKeyPairSync('ed25519').publicKey}),false);
}));
test('query timestamp freshness is required even when the original reading is old',()=>withTest(x=>{
  const e=x.envelope(1);x.ingest(e);
  const stale=x.signedQuery(e);x.advance(30001);
  assert.equal(x.first.contract.reconcile({...stale,channelProof:x.first.proof}).reason,'expired-or-future-query');
  const fresh=x.signedQuery(e);
  assert.equal(x.first.contract.reconcile({...fresh,channelProof:x.first.proof}).found,true);
}));
test('revoked identity cannot recover a signed receipt',()=>withTest(x=>{
  const e=x.envelope(1);x.ingest(e);
  const pair=x.signedQuery(e);x.first.contract.revoke(uid);
  assert.equal(x.first.contract.reconcile({...pair,channelProof:x.first.proof}).reason,'unprovisioned-or-revoked');
}));
test('restarted instance without identity provisioning cannot reconcile',()=>withTest(x=>{
  const e=x.envelope(1);x.ingest(e);
  const orphan=x.instance(),pair=x.signedQuery(e);
  assert.equal(orphan.reconcile({...pair,channelProof:orphan.issueSyntheticChannelProof()}).reason,
    'unprovisioned-or-revoked');
}));
test('different signing key or unauthorized epoch cannot recover a prior receipt',()=>withTest(x=>{
  const e=x.envelope(1);x.ingest(e);
  const keys=generateKeyPairSync('ed25519'),other=x.instance();
  other.provision(uid,{devicePublicKey:keys.publicKey});
  const pair=x.signedQuery(e);
  assert.equal(other.reconcile({...pair,channelProof:other.issueSyntheticChannelProof()}).reason,'invalid-signature');
  const changed=x.instance();changed.provision(uid,{devicePublicKey:x.deviceKeys.publicKey,epoch:2});
  assert.equal(changed.reconcile({...pair,channelProof:changed.issueSyntheticChannelProof()}).reason,'unprovisioned-or-revoked');
}));
test('a newly signed query for a forged digest does not produce a receipt',()=>withTest(x=>{
  const e=x.envelope(1);x.ingest(e);
  const pair=x.signedQuery(e),query=makeStage8ReconciliationQuery({...pair.query,digest:'a'.repeat(64)});
  const sig=sign(null,Buffer.from(JSON.stringify(query)),x.deviceKeys.privateKey).toString('base64url');
  assert.equal(x.first.contract.reconcile({query,signature:sig,channelProof:x.first.proof}).reason,'not-found-or-not-current');
}));
test('tampered HMAC sealed ledger fails closed and never resets to an empty state',()=>withTest(x=>{
  const e=x.envelope(1);x.ingest(e);
  const location=path.join(x.directory,'stage8-offline-receipts.json');
  const document=JSON.parse(fs.readFileSync(location,'utf8'));
  document.state.devices[uid].receipt.sequence=0;
  fs.writeFileSync(location,JSON.stringify(document));
  const pair=x.signedQuery(e);
  assert.equal(x.first.contract.reconcile({...pair,channelProof:x.first.proof}).reason,'ledger-unavailable');
  assert.equal(x.ingest(x.envelope(2)).reason,'ledger-unavailable');
}));
test('wrong integrity key rejects existing ledger and does not overwrite it',()=>withTest(x=>{
  x.ingest(x.envelope(1));
  const bad=createStage8OfflineReceiptLedger({directory:x.directory,integrityKey:randomBytes(32)});
  assert.throws(()=>bad.lookup({deviceId:uid,epoch:1,sequence:1,digest:'0'.repeat(64),
    keyFingerprint:'0'.repeat(64)}),/integrity mismatch/);
}));
test('stale crash lock is never automatically discarded',()=>withTest(x=>{
  const file=path.join(x.directory,'stage8-offline-receipts.lock');
  fs.writeFileSync(file,'MANUAL-RECOVERY-ONLY',{flag:'wx'});
  assert.equal(x.ingest(x.envelope(1)).reason,'ledger-unavailable');
  assert.equal(fs.readFileSync(file,'utf8'),'MANUAL-RECOVERY-ONLY');
}));
test('corrupted receipt signature is detected even with a re-sealed test ledger',()=>withTest(x=>{
  const e=x.envelope(1);x.ingest(e);
  const location=path.join(x.directory,'stage8-offline-receipts.json');
  const document=JSON.parse(fs.readFileSync(location,'utf8'));
  document.state.devices[uid].signature='A'.repeat(86);
  // Simulate actor with HMAC key but not Ed25519 receipt private key.
  document.mac=createHmac('sha256',x.integrityKey).update(JSON.stringify(document.state)).digest('hex');
  fs.writeFileSync(location,JSON.stringify(document));
  const pair=x.signedQuery(e);
  assert.equal(x.first.contract.reconcile({...pair,channelProof:x.first.proof}).reason,'receipt-signature-invalid');
}));
test('research-only receipt files contain no remote networking or production credentials',()=>{
  const source=fs.readFileSync('experiments/stage8-ack-reconciliation.mjs','utf8');
  assert.doesNotMatch(source,/(?:fetch|WebSocket|XMLHttpRequest|\.listen)\s*\(/);
  assert.doesNotMatch(source,/firebase-admin|process\.env|FIREBASE_DATABASE_URL|baileys|DATA_PATH/);
  assert.doesNotMatch(source,/node:http|node:https|node:tls|node:net/);
  assert.match(source,/offline|synthetic/i);
});
