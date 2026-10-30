// Pure, hermetic tests for second-issuer persisted-confirmation evidence.
import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {
  canonicalSyntheticPublicationAttestation,
  verifySyntheticPublicationAttestation
} from '../experiments/synthetic-publication-attestation.mjs';

const now=1700000003500;
const proof=()=>({
  version:'floodguard-synthetic-persisted-attestation-v1',
  deviceId:'device-stage-a',epoch:1,sequence:2,
  digest:'a'.repeat(64),acceptedAtMs:now-100,confirmedAtMs:now-50,
  scope:'prototype-ingest-v1',deviceEnabled:true,
  databaseState:'DATABASE_CONFIRMED'
});
const receipt=()=>({
  deviceId:'device-stage-a',epoch:1,sequence:2,
  digest:'a'.repeat(64),acceptedAtMs:now-100
});
const trusted=generateKeyPairSync('ed25519');
const signProof=(p,key=trusted.privateKey)=>
  sign(null,Buffer.from(canonicalSyntheticPublicationAttestation(p)),key)
    .toString('base64url');
const verifyProof=(p,signature=signProof(p),publicKey=trusted.publicKey,time=now)=> 
  verifySyntheticPublicationAttestation({
    attestation:p,signature,publicKey,receipt:receipt(),nowMs:time
  });

test('valid isolated persistence attestation verifies under independent issuer key',()=>{
  assert.equal(verifyProof(proof()),true);
});
test('canonical ordering is independent of caller property insertion order',()=>{
  const p=proof();
  const reordered=Object.fromEntries(Object.entries(p).reverse());
  assert.equal(canonicalSyntheticPublicationAttestation(p),
    canonicalSyntheticPublicationAttestation(reordered));
  assert.equal(verifyProof(reordered,signProof(p)),true);
});
test('wrong issuer, forged signature or tampered digest cannot verify',()=>{
  const p=proof(),different=generateKeyPairSync('ed25519');
  assert.equal(verifyProof(p,signProof(p,different.privateKey)),false);
  assert.equal(verifyProof(p,signProof(p),different.publicKey),false);
  assert.equal(verifyProof({...p,digest:'0'.repeat(64)},signProof(p)),false);
  assert.equal(verifyProof(p,'A'.repeat(86)),false);
});
test('not confirmed, revoked, mismatched-scope and additional arbitrary fields are invalid',()=>{
  for(const bad of [
    {...proof(),databaseState:'PENDING'},
    {...proof(),deviceEnabled:false},
    {...proof(),scope:'operator-admin'},
    {...proof(),privateIp:'192.0.2.17'},
    {...proof(),deviceId:'bad/device'},
    {...proof(),digest:'bad'},
    {...proof(),acceptedAtMs:now+1}
  ]) {
    assert.throws(()=>canonicalSyntheticPublicationAttestation(bad));
    assert.equal(verifyProof(bad,signProof(proof())),false);
  }
});
test('expired, implausibly future, invalid-epoch or wrong receipt binding fails',()=>{
  const p=proof(),sig=signProof(p);
  assert.equal(verifyProof(p,sig,trusted.publicKey,now+6000),false);
  assert.equal(verifyProof(p,sig,trusted.publicKey,now-2500),false);
  assert.equal(verifySyntheticPublicationAttestation({
    attestation:p,signature:sig,publicKey:trusted.publicKey,
    receipt:{...receipt(),sequence:4},nowMs:now
  }),false);
  assert.throws(()=>canonicalSyntheticPublicationAttestation({...p,epoch:1.5}));
});
test('attestation checker cannot issue credentials, connect remotely or write local files',()=>{
  const s=readFileSync('experiments/synthetic-publication-attestation.mjs','utf8');
  assert.doesNotMatch(s,/createPrivateKey|generateKeyPair|createServer|fetch\s*\(|\.listen\s*\(/);
  assert.doesNotMatch(s,/firebase-admin|serviceAccount|writeFileSync|node:fs|node:https/);
});
