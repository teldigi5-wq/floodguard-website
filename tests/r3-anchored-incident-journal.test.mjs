// All keys, events, checkpoints and disk files below are disposable synthetic
// fixtures. This is NOT an independent operational store or real publisher.
import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign} from 'node:crypto';
import {mkdtempSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {
 canonicalSyntheticIncidentEvent,canonicalSyntheticIncidentCheckpoint,
 syntheticSignedEventHash,verifyExternallyPinnedSyntheticIncidentJournal
} from '../experiments/r3-anchored-incident-journal.mjs';
process.env.FG_R3_ANCHORED_JOURNAL_TEST='1';
const NOW=1700000005000,DEVICE='device-stage-a';
const JOURNAL=generateKeyPairSync('ed25519');
const ANCHOR=generateKeyPairSync('ed25519');
const OTHER=generateKeyPairSync('ed25519');
const signText=(privateKey,content)=>sign(null,Buffer.from(content),privateKey)
 .toString('base64url');
function makeJournal(states=[{currentEpoch:1,quarantined:false}],at=NOW-100){
 const entries=[];let previousHash='0'.repeat(64);
 for(let i=0;i<states.length;i++){
  const event={version:'floodguard-synthetic-incident-event-v1',
    deviceId:DEVICE,revision:i+1,...states[i],
    occurredAtMs:NOW-3000+i*1000,previousHash};
  const signature=signText(JOURNAL.privateKey,canonicalSyntheticIncidentEvent(event));
  entries.push({event,signature});
  previousHash=syntheticSignedEventHash(event,signature);
 }
 const last=entries.at(-1).event;
 const checkpoint={version:'floodguard-synthetic-incident-checkpoint-v1',
  deviceId:DEVICE,revision:last.revision,currentEpoch:last.currentEpoch,
  quarantined:last.quarantined,headHash:previousHash,checkpointAtMs:at};
 const signedCheckpoint={checkpoint,
  signature:signText(ANCHOR.privateKey,canonicalSyntheticIncidentCheckpoint(checkpoint))};
 return {entries,signedCheckpoint};
}
function pin(journal,index=0){
 const x=journal.entries[index];
 return {trustedPinnedRevision:index+1,trustedPinnedEpoch:x.event.currentEpoch,
  trustedPinnedHash:syntheticSignedEventHash(x.event,x.signature)};
}
function check(journal,overrides={}){
 let currentPin={};
 try {if(journal)currentPin=pin(journal);}catch{}
 return verifyExternallyPinnedSyntheticIncidentJournal({
  ...journal,...currentPin,journalPublicKey:JOURNAL.publicKey,
  checkpointPublicKey:ANCHOR.publicKey,nowMs:NOW,...overrides
 });
}
const ACTIVE=[{currentEpoch:1,quarantined:false}];
const QUARANTINED=[...ACTIVE,{currentEpoch:2,quarantined:true}];

test('valid signed anchor and separately signed append-only event pass conditional integrity review',()=>{
 const res=check(makeJournal(ACTIVE));
 assert.equal(res?.verified,true);
 assert.equal(res.operationallyApproved,false);
 assert.equal(res.releaseDecision,'NO_GO');
 assert.equal(res.trustedMinimumEpoch,1);
 assert.equal(res.trustedMinimumRevision,1);
});
test('signed quarantine + epoch increase is verified but never operationally approved',()=>{
 const journal=makeJournal(QUARANTINED);
 const res=check(journal,{...pin(journal,1)});
 assert.equal(res.verified,true);
 assert.equal(res.quarantined,true);
 assert.equal(res.trustedMinimumEpoch,2);
 assert.equal(res.releaseDecision,'NO_GO');
});
test('rolling back the journal and old valid signed anchor fails against independently pinned revision-two receipt',()=>{
 const updated=makeJournal(QUARANTINED);
 const old=makeJournal(ACTIVE);
 assert.equal(check(old,{...pin(updated,1)}),null);
});
test('rewriting signed history under otherwise valid signer cannot defeat externally pinned exact hash',()=>{
 const original=makeJournal(QUARANTINED);
 const fork=makeJournal([...ACTIVE,{currentEpoch:1,quarantined:false}]);
 // Even when both signers can sign the alternate branch, the external pin wins.
 assert.equal(check(fork,{...pin(original,1)}),null);
});
test('modified event or signature and modified signed anchor are rejected',()=>{
 const base=makeJournal(QUARANTINED);
 const changed=structuredClone(base);
 changed.entries[0].event.currentEpoch=2;
 assert.equal(check(changed),null);
 const changedAnchor=structuredClone(base);
 changedAnchor.signedCheckpoint.checkpoint.quarantined=false;
 assert.equal(check(changedAnchor),null);
 const sig=structuredClone(base);
 sig.entries[0].signature='A'.repeat(86);
 assert.equal(check(sig),null);
});
test('truncation, missing checkpoint, unanchored trailing event and non-sequential events fail closed',()=>{
 const whole=makeJournal(QUARANTINED);
 assert.equal(check({...whole,entries:whole.entries.slice(0,1)}),null);
 assert.equal(check({...whole,signedCheckpoint:null}),null);
 const staleAnchor=makeJournal(ACTIVE).signedCheckpoint;
 assert.equal(check({...whole,signedCheckpoint:staleAnchor}),null);
 const duplicate={...whole,entries:[whole.entries[0],whole.entries[0]]};
 assert.equal(check(duplicate),null);
});
test('quarantine cannot be quietly cleared in same epoch or in a later epoch',()=>{
 const cleared=makeJournal([...QUARANTINED,{currentEpoch:2,quarantined:false}]);
 assert.equal(check(cleared),null);
 const afterEpoch=makeJournal([...QUARANTINED,{currentEpoch:3,quarantined:false}]);
 assert.equal(check(afterEpoch),null);
});
test('epoch can advance by only one on a quarantining event, and cannot rewind',()=>{
 assert.equal(check(makeJournal([...ACTIVE,{currentEpoch:3,quarantined:true}])),null);
 assert.equal(check(makeJournal([...ACTIVE,{currentEpoch:2,quarantined:false}])),null);
 assert.equal(check(makeJournal([...QUARANTINED,{currentEpoch:1,quarantined:true}])),null);
});
test('missing and forged external pin, invalid key role, or missing test guard fail closed',()=>{
 const journal=makeJournal(QUARANTINED);
 for(const opts of [{trustedPinnedHash:null},{trustedPinnedRevision:null},
  {trustedPinnedEpoch:0},{trustedPinnedHash:'b'.repeat(64)},
  {checkpointPublicKey:OTHER.publicKey},
  {checkpointPublicKey:JOURNAL.publicKey},
  {journalPublicKey:OTHER.publicKey}])assert.equal(check(journal,opts),null);
 const orig=process.env.FG_R3_ANCHORED_JOURNAL_TEST;
 delete process.env.FG_R3_ANCHORED_JOURNAL_TEST;
 try {assert.equal(check(journal),null);}finally{
  process.env.FG_R3_ANCHORED_JOURNAL_TEST=orig;
 }
});
test('a signed but stale or future checkpoint cannot establish current publication minimum',()=>{
 const old=makeJournal(ACTIVE,NOW-16000);
 assert.equal(check(old),null);
 const future=makeJournal(ACTIVE,NOW+2500);
 assert.equal(check(future),null);
});
test('restart from separate synthetic journal and pinned-checkpoint files verifies, but torn write fails',()=>{
 const dir=mkdtempSync(join(tmpdir(),'floodguard-r3-anchored-review-'));
 try {
  // These files stand in for separately controlled stores; test filesystem
  // directories in one runner are NOT an actual independent trust domain.
  const journalFile=join(dir,'journal.synthetic.json');
  const trustedFile=join(dir,'externally-pinned.synthetic.json');
  const journal=makeJournal(QUARANTINED);
  writeFileSync(journalFile,JSON.stringify(journal),{mode:0o600});
  writeFileSync(trustedFile,JSON.stringify(pin(journal,1)),{mode:0o600});
  const restored=JSON.parse(readFileSync(journalFile,'utf8'));
  const external=JSON.parse(readFileSync(trustedFile,'utf8'));
  assert.equal(check(restored,external)?.trustedMinimumEpoch,2);
  // Simulate partially written or corrupted journal; no repair or fallback
  // to older accepted state is permitted by this read-only gate.
  writeFileSync(journalFile,JSON.stringify(journal).slice(0,-8));
  assert.throws(()=>JSON.parse(readFileSync(journalFile,'utf8')));
  assert.equal(check(null,external),null);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('monotonic digest and exact-schema guards block unknown fields and malformed types',()=>{
 const journal=makeJournal(ACTIVE);
 const tampered=structuredClone(journal);
 tampered.entries[0].event.unexpected='SECRET_NOT_PRINTED';
 assert.equal(check(tampered),null);
 assert.throws(()=>canonicalSyntheticIncidentEvent({}));
 assert.throws(()=>canonicalSyntheticIncidentCheckpoint({}));
 assert.throws(()=>syntheticSignedEventHash(journal.entries[0].event,'wrong'));
});
test('pure verifier source has no signing key, Firebase/network or file-write capability',()=>{
 const src=readFileSync(new URL('../experiments/r3-anchored-incident-journal.mjs',import.meta.url),'utf8');
 assert.doesNotMatch(src,/\bfetch\s*\(|https?\.request\s*\(|\bsign\s*\(|writeFile|firebase-admin|sendMessage|Serial\./);
 assert.match(src,/trustedPinnedHash/);
 assert.match(src,/releaseDecision:'NO_GO'/);
});
