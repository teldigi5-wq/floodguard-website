// Test-only synthetic key material. NEVER real device, signer or witness keys.
import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {
  canonicalSyntheticPublicationAttestation,
  verifySyntheticPublicationAttestation
} from '../experiments/synthetic-publication-attestation.mjs';
import {
  canonicalSyntheticIncidentWitness,
  verifyWitnessGatedSyntheticPublication
} from '../experiments/r3-witness-gated-publication.mjs';

process.env.FG_R3_WITNESS_CONTRACT_TEST='1';
const now=1700000003500;
const DEVICE='device-stage-a', DIGEST='a'.repeat(64);
const ATTESTOR=generateKeyPairSync('ed25519');
const WITNESS=generateKeyPairSync('ed25519');
const OTHER=generateKeyPairSync('ed25519');
const attestation={
  version:'floodguard-synthetic-persisted-attestation-v1',
  deviceId:DEVICE,epoch:1,sequence:2,digest:DIGEST,
  acceptedAtMs:now-400,confirmedAtMs:now-200,
  scope:'prototype-ingest-v1',deviceEnabled:true,
  databaseState:'DATABASE_CONFIRMED'
};
const receipt={deviceId:DEVICE,epoch:1,sequence:2,digest:DIGEST,
  acceptedAtMs:now-400};
const incident={
  version:'floodguard-synthetic-incident-witness-v1',
  deviceId:DEVICE,currentEpoch:1,revision:1,quarantined:false,
  issuedAtMs:now-1000,expiresAtMs:now+8000,
  scope:'SYNTHETIC_INCIDENT_READ_ONLY'
};
const sig=(key,content)=>sign(null,Buffer.from(content),key)
  .toString('base64url');
const attestationSignature=sig(ATTESTOR.privateKey,
  canonicalSyntheticPublicationAttestation(attestation));
const signedIncident=(change={})=>{
  const value={...incident,...change};
  return {incidentWitness:value,incidentSignature:
    sig(WITNESS.privateKey,canonicalSyntheticIncidentWitness(value))};
};
const verify=(custom={})=>verifyWitnessGatedSyntheticPublication({
  attestation,attestationSignature,attestorPublicKey:ATTESTOR.publicKey,
  receipt,witnessPublicKey:WITNESS.publicKey,
  trustedMinimumEpoch:1,trustedMinimumRevision:1,
  nowMs:now,...signedIncident(),...custom
});

test('valid two-signature record + signed active witness + explicit floors passes OFFLINE only',()=>{
  assert.equal(verify(),true);
  assert.equal(verifySyntheticPublicationAttestation({
    attestation,signature:attestationSignature,
    publicKey:ATTESTOR.publicKey,receipt,nowMs:now}),true);
});

test('new signed quarantine denies otherwise valid previously signed attestation',()=>{
  assert.equal(verify({...signedIncident({quarantined:true,revision:2})}),false);
  // The legacy independent attestation signature alone is still valid.
  assert.equal(verifySyntheticPublicationAttestation({
    attestation,signature:attestationSignature,
    publicKey:ATTESTOR.publicKey,receipt,nowMs:now}),true);
});

test('epoch 2 signed witness denies old epoch 1 attestation after service re-enable',()=>{
  const epoch2=signedIncident({currentEpoch:2,quarantined:false,revision:2});
  assert.equal(verify({...epoch2,trustedMinimumEpoch:2,
    trustedMinimumRevision:2}),false);
});

test('old signed active witness is refused against separately trusted epoch/revision floors',()=>{
  assert.equal(verify({trustedMinimumEpoch:2,trustedMinimumRevision:2}),false);
  assert.equal(verify({trustedMinimumRevision:2}),false);
  assert.equal(verify({trustedMinimumEpoch:2}),false);
});

test('missing, zero and malformed trusted anti-rollback floors fail closed',()=>{
  for(const x of [undefined,null,0,-1,1.5,'1',NaN]){
    assert.equal(verify({trustedMinimumEpoch:x}),false);
    assert.equal(verify({trustedMinimumRevision:x}),false);
  }
});

test('wrong signer, signer-key reuse and forged witness signature are rejected',()=>{
  assert.equal(verify({witnessPublicKey:OTHER.publicKey}),false);
  assert.equal(verify({witnessPublicKey:ATTESTOR.publicKey}),false);
  assert.equal(verify({incidentSignature:'A'.repeat(86)}),false);
  assert.equal(verify({attestorPublicKey:OTHER.publicKey}),false);
});

test('tampered witness fields, replayed identity and unexpected fields fail closed',()=>{
  const valid=signedIncident();
  for(const mutation of [
    {quarantined:true},{revision:2},{deviceId:'device-stage-b'},
    {currentEpoch:2},{issuedAtMs:now+5000},{expiresAtMs:now+20000},
    {unknown:'TOKEN_DO_NOT_PRINT'}
  ]){
    assert.equal(verify({...valid,incidentWitness:{...valid.incidentWitness,...mutation}}),false);
  }
});

test('signature-verified but expired or future witness fails freshness bounds',()=>{
  assert.equal(verify({...signedIncident({
    issuedAtMs:now-11000,expiresAtMs:now-1})}),false);
  assert.equal(verify({...signedIncident({
    issuedAtMs:now+2500,expiresAtMs:now+8000})}),false);
  assert.equal(verify({...signedIncident({
    issuedAtMs:now-14000,expiresAtMs:now+5000})}),false);
});

test('stale and tampered independently signed attestation is still denied',()=>{
  assert.equal(verify({nowMs:now+6000}),false); // attestation freshness expires
  assert.equal(verify({attestation:{...attestation,sequence:3}}),false);
  assert.equal(verify({receipt:{...receipt,digest:'b'.repeat(64)}}),false);
  assert.equal(verify({attestationSignature:'A'.repeat(86)}),false);
});

test('missing witness/incident source and ordinary deployment mode fail closed',()=>{
  assert.equal(verify({incidentWitness:null}),false);
  assert.equal(verify({incidentSignature:undefined}),false);
  assert.equal(verify({witnessPublicKey:null}),false);
  const previous=process.env.FG_R3_WITNESS_CONTRACT_TEST;
  delete process.env.FG_R3_WITNESS_CONTRACT_TEST;
  try {assert.equal(verify(),false);}finally{
    process.env.FG_R3_WITNESS_CONTRACT_TEST=previous;
  }
});

test('witness canonical claim is exact and type constrained',()=>{
  assert.equal(canonicalSyntheticIncidentWitness(incident).startsWith('{"version"'),true);
  for(const x of [
    {...incident,revision:0},{...incident,currentEpoch:0},
    {...incident,quarantined:'false'},
    {...incident,scope:'SYSTEM_ADMIN'},
    {...incident,extra:true}
  ]) assert.throws(()=>canonicalSyntheticIncidentWitness(x));
});

test('verifier has no network, data mutation, signing, device or alarm capabilities',()=>{
  const src=readFileSync(
    new URL('../experiments/r3-witness-gated-publication.mjs',import.meta.url),'utf8');
  assert.doesNotMatch(src,/fetch\s*\(|https?\.request\s*\(|createServer\s*\(|sign\s*\(/);
  assert.doesNotMatch(src,/writeFile|firebase-admin|Serial\.|gate\.open|sendMessage/);
  assert.match(src,/trustedMinimumRevision/);
  assert.match(src,/FG_R3_WITNESS_CONTRACT_TEST/);
});
