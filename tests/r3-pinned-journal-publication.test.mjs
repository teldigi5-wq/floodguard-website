// Synthetic, offline-only integration of two existing verification contracts.
import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign} from 'node:crypto';
import {canonicalSyntheticPublicationAttestation}
  from '../experiments/synthetic-publication-attestation.mjs';
import {canonicalSyntheticIncidentWitness}
  from '../experiments/r3-witness-gated-publication.mjs';
import {canonicalSyntheticIncidentEvent,canonicalSyntheticIncidentCheckpoint,
 syntheticSignedEventHash} from '../experiments/r3-anchored-incident-journal.mjs';
import {verifyPinnedJournalGatedSyntheticPublication}
  from '../experiments/r3-pinned-journal-publication.mjs';

process.env.FG_R3_WITNESS_CONTRACT_TEST='1';
process.env.FG_R3_ANCHORED_JOURNAL_TEST='1';
const NOW=1700000005000,DEVICE='device-stage-a';
const JOURNAL=generateKeyPairSync('ed25519');
const CHECKPOINT=generateKeyPairSync('ed25519');
const WITNESS=generateKeyPairSync('ed25519');
const ATTESTOR=generateKeyPairSync('ed25519');
const signClaim=(key,raw)=>sign(null,Buffer.from(raw),key)
  .toString('base64url');
const attestation={
 version:'floodguard-synthetic-persisted-attestation-v1',
 deviceId:DEVICE,epoch:1,sequence:2,digest:'a'.repeat(64),
 acceptedAtMs:NOW-1400,confirmedAtMs:NOW-1100,
 scope:'prototype-ingest-v1',deviceEnabled:true,
 databaseState:'DATABASE_CONFIRMED'
};
const receipt={deviceId:DEVICE,epoch:1,sequence:2,
 digest:'a'.repeat(64),acceptedAtMs:NOW-1400};
const claim={version:'floodguard-synthetic-incident-witness-v1',
 deviceId:DEVICE,currentEpoch:1,revision:1,quarantined:false,
 issuedAtMs:NOW-1500,expiresAtMs:NOW+3500,
 scope:'SYNTHETIC_INCIDENT_READ_ONLY'};
function fixtures(quarantine=false){
 let previousHash='0'.repeat(64);
 const states=quarantine
  ?[{currentEpoch:1,quarantined:false},{currentEpoch:2,quarantined:true}]
  :[{currentEpoch:1,quarantined:false}];
 const entries=states.map((state,i)=>{
  const event={version:'floodguard-synthetic-incident-event-v1',
   deviceId:DEVICE,revision:i+1,...state,
   occurredAtMs:NOW-3000+i*1000,previousHash};
  const signature=signClaim(JOURNAL.privateKey,canonicalSyntheticIncidentEvent(event));
  previousHash=syntheticSignedEventHash(event,signature);
  return {event,signature};
 });
 const head=entries.at(-1).event;
 const checkpoint={version:'floodguard-synthetic-incident-checkpoint-v1',
  deviceId:DEVICE,revision:head.revision,
  currentEpoch:head.currentEpoch,quarantined:head.quarantined,
  headHash:previousHash,checkpointAtMs:NOW-200};
 const journal={entries,signedCheckpoint:{checkpoint,
   signature:signClaim(CHECKPOINT.privateKey,
    canonicalSyntheticIncidentCheckpoint(checkpoint))},
  journalPublicKey:JOURNAL.publicKey,
  checkpointPublicKey:CHECKPOINT.publicKey,
  nowMs:NOW,
  trustedPinnedRevision:head.revision,
  trustedPinnedEpoch:head.currentEpoch,
  trustedPinnedHash:previousHash
 };
 const publication={attestation,attestationSignature:signClaim(
   ATTESTOR.privateKey,canonicalSyntheticPublicationAttestation(attestation)),
   attestorPublicKey:ATTESTOR.publicKey,
   receipt,incidentWitness:claim,
   incidentSignature:signClaim(WITNESS.privateKey,
    canonicalSyntheticIncidentWitness(claim)),
   witnessPublicKey:WITNESS.publicKey,nowMs:NOW};
 return {journal,publication};
}
const check=entry=>verifyPinnedJournalGatedSyntheticPublication(entry);

test('unquarantined signed journal + independent witness + attestation passes only offline gate',()=>{
 assert.equal(check(fixtures()),true);
});
test('anchored quarantined epoch 2 blocks old valid epoch 1 publication',()=>{
 assert.equal(check(fixtures(true)),false);
});
test('rolling back both signed files fails when outside-trusted pin has advanced',()=>{
 const old=fixtures();
 const newest=fixtures(true);
 old.journal.trustedPinnedRevision=newest.journal.trustedPinnedRevision;
 old.journal.trustedPinnedEpoch=newest.journal.trustedPinnedEpoch;
 old.journal.trustedPinnedHash=newest.journal.trustedPinnedHash;
 assert.equal(check(old),false);
});
test('witness revision must match anchored head exactly, even with valid signature',()=>{
 const row=fixtures();
 const modified={...row.publication.incidentWitness,revision:2};
 row.publication.incidentWitness=modified;
 row.publication.incidentSignature=signClaim(WITNESS.privateKey,
   canonicalSyntheticIncidentWitness(modified));
 assert.equal(check(row),false);
});
test('independent journal, anchor, witness and attestor public keys are mandatory',()=>{
 const row=fixtures();
 row.publication.witnessPublicKey=row.journal.checkpointPublicKey;
 assert.equal(check(row),false);
 assert.equal(check({journal:fixtures().journal,publication:null}),false);
});
test('synthetic gate refuses when either test contract guard is disabled',()=>{
 const row=fixtures();
 delete process.env.FG_R3_ANCHORED_JOURNAL_TEST;
 try{assert.equal(check(row),false);}finally{
  process.env.FG_R3_ANCHORED_JOURNAL_TEST='1';
 }
 delete process.env.FG_R3_WITNESS_CONTRACT_TEST;
 try{assert.equal(check(row),false);}finally{
  process.env.FG_R3_WITNESS_CONTRACT_TEST='1';
 }
});
