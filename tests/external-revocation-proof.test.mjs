// All signing material below belongs to isolated test fixtures. The client
// imports only pinned PUBLIC keys and cannot sign its own authority records.
// No external network, production Firebase, firmware, gate or bot is touched.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign} from 'node:crypto';
import {
  canonicalExternalRevocationProof,externalRevocationProofDomain,
  createExternalRevocationProofClient
} from '../experiments/external-revocation-proof-client.mjs';
import {createOfflineRoleRevocationCoordinator}
  from '../experiments/offline-role-revocation-coordinator.mjs';

Object.assign(process.env,{
  FG_REVOCATION_SAGA_TEST:'1',
  FG_EXTERNAL_AUTHORITY_TEST:'1',
  FIREBASE_AUTH_EMULATOR_HOST:'127.0.0.1:9099',
  FIREBASE_DATABASE_EMULATOR_HOST:'127.0.0.1:9000',
  GCLOUD_PROJECT:'demo-fg-auth-lifecycle'
});
const UID='ingest-verifier-stage-a',AUTHORITY='floodguard-external-stage-a';
const NOW=1793270000000,ISO=new Date(NOW-2000).toISOString();
const PAIR=generateKeyPairSync('ed25519');
const OTHER=generateKeyPairSync('ed25519');
function authority({mode='normal'}={}){
  const remote={roleGeneration:4,revokeTime:0};
  const stats={reads:0,advances:0};
  let oldResponse=null;
  const proof=(uid,challenge)=>{
    const r={domain:externalRevocationProofDomain,issuer:AUTHORITY,uid,
      roleGeneration:remote.roleGeneration,revokeTime:remote.revokeTime,
      challenge,issuedAtMs:NOW-100,expiresAtMs:NOW+10000};
    if(mode==='wrong-uid')r.uid='ingest-observer-stage-a';
    if(mode==='wrong-issuer')r.issuer='untrusted-stage-a';
    if(mode==='expired')r.expiresAtMs=NOW-1;
    if(mode==='future')r.issuedAtMs=NOW+3001,r.expiresAtMs=NOW+10000;
    if(mode==='old-challenge'&&oldResponse){
      return oldResponse;
    }
    const signature=sign(null,Buffer.from(canonicalExternalRevocationProof(r)),
      mode==='wrong-signer'?OTHER.privateKey:PAIR.privateKey).toString('base64url');
    const signed={checkpoint:r,signature};
    if(!oldResponse)oldResponse=signed;
    if(mode==='tampered')return {...signed,checkpoint:{...r,roleGeneration:99}};
    if(mode==='invalid-signature')return {...signed,signature:'A'.repeat(86)};
    return signed;
  };
  const transport=Object.freeze({
    async read({uid,challenge}){
      stats.reads++;
      if(mode==='offline')throw Error('external authority offline');
      return proof(uid,challenge);
    },
    async advanceCAS({uid,challenge,expectedGeneration,expectedRevokeTime,
      nextGeneration,nextRevokeTime}){
      stats.advances++;
      if(mode==='advance-offline')throw Error('simulated external ACK loss');
      if(remote.roleGeneration!==expectedGeneration||
         remote.revokeTime!==expectedRevokeTime||
         nextGeneration!==expectedGeneration+1||
         nextRevokeTime<expectedRevokeTime)throw Error('external CAS conflict');
      remote.roleGeneration=nextGeneration;
      remote.revokeTime=nextRevokeTime;
      return proof(uid,challenge);
    }
  });
  const client=createExternalRevocationProofClient({
    authorityId:AUTHORITY,authorityPublicKey:PAIR.publicKey,
    transport,clock:()=>NOW
  });
  return {client,remote,stats,transport};
}
function coordinatorLab(a){
  const state={enabled:true,roleGeneration:4,revokeTime:0};
  const calls={disable:0,auth:0,commit:0};
  const roleStore=Object.freeze({
    async read(){return {...state};},
    async disableRoleCAS(_,generation){
      calls.disable++;
      if(!state.enabled||state.roleGeneration!==generation)return false;
      state.enabled=false;
      return true;
    },
    async advanceSessionCAS(_,{expectedGeneration,cutoffSeconds,nextGeneration}){
      calls.commit++;
      if(state.enabled||state.roleGeneration!==expectedGeneration||
         nextGeneration!==expectedGeneration+1||
         cutoffSeconds<state.revokeTime)return false;
      state.roleGeneration=nextGeneration;state.revokeTime=cutoffSeconds;
      return true;
    }
  });
  const auth=Object.freeze({
    async revokeRefreshTokens(){calls.auth++;},
    async getUser(){return {tokensValidAfterTime:ISO};}
  });
  const create=()=>createOfflineRoleRevocationCoordinator({
    uid:UID,roleStore,auth,clock:()=>NOW,
    externalWitness:a.client
  });
  return {create,state,calls};
}

test('signed, pinned, challenge-bound authority state is verified',async()=>{
  const a=authority();
  assert.deepEqual(await a.client.snapshot(UID),{
    ok:true,uid:UID,roleGeneration:4,revokeTime:0
  });
  assert.equal(a.stats.reads,1);
});
test('forged signature and wrong Ed25519 signer are rejected',async()=>{
  for(const mode of ['wrong-signer','invalid-signature','tampered']){
    const r=await authority({mode}).client.snapshot(UID);
    assert.equal(r.ok,false,mode);
    assert.equal(r.reason,'authority-signature-invalid',mode);
  }
});
test('wrong signed authority UID and issuer are rejected',async()=>{
  for(const mode of ['wrong-uid','wrong-issuer']){
    const r=await authority({mode}).client.snapshot(UID);
    assert.equal(r.ok,false,mode);
    assert.equal(r.reason,'authority-identity-or-challenge-mismatch',mode);
  }
});
test('stale or future signed proofs cannot satisfy freshness',async()=>{
  for(const mode of ['expired','future']){
    const r=await authority({mode}).client.snapshot(UID);
    assert.equal(r.ok,false,mode);
    assert.equal(r.reason,'authority-proof-expired');
  }
});
test('old signed proof cannot be replayed against a fresh challenge',async()=>{
  const a=authority({mode:'old-challenge'});
  const first=await a.client.snapshot(UID),second=await a.client.snapshot(UID);
  assert.equal(first.ok,true);
  assert.equal(second.ok,false);
  assert.equal(second.reason,'authority-identity-or-challenge-mismatch');
});
test('remote signer outage fails closed, not guessed from local RTDB',async()=>{
  const a=authority({mode:'offline'}),f=coordinatorLab(a);
  assert.equal((await f.create().revoke({expectedGeneration:4})).step,
    'external-authority-mismatch');
  assert.equal(f.calls.auth,0);
  assert.equal(f.calls.disable,0);
});
test('external authority permits disabled-first successful revocation with readback',async()=>{
  const a=authority(),f=coordinatorLab(a);
  const result=await f.create().revoke({expectedGeneration:4});
  assert.equal(result.completed,true);
  assert.equal(result.roleDisabled,true);
  assert.equal(f.state.enabled,false);
  assert.equal(f.state.roleGeneration,5);
  assert.equal(a.remote.roleGeneration,5);
  assert.equal(a.remote.revokeTime,f.state.revokeTime);
  assert.deepEqual(f.calls,{disable:1,auth:1,commit:1});
  assert.equal(a.stats.reads,2);
  assert.equal(a.stats.advances,1);
});
test('stale restored database state fails before Auth even if database claims look valid',async()=>{
  const a=authority(),f=coordinatorLab(a);
  assert.equal((await f.create().revoke({expectedGeneration:4})).completed,true);
  const prior={...f.calls};
  f.state.enabled=true;f.state.roleGeneration=4;f.state.revokeTime=0;
  const denied=await f.create().revoke({expectedGeneration:4});
  assert.equal(denied.step,'external-authority-mismatch');
  assert.deepEqual(f.calls,prior);
});
test('lost external authority acknowledgement after cutoff commit keeps role disabled',async()=>{
  const a=authority({mode:'advance-offline'}),f=coordinatorLab(a);
  const result=await f.create().revoke({expectedGeneration:4});
  assert.equal(result.step,'external-authority-advance-uncertain');
  assert.equal(result.completed,false);
  assert.equal(f.state.enabled,false);
  assert.equal(f.state.roleGeneration,5);
  assert.equal(a.remote.roleGeneration,4);
  assert.equal(f.calls.auth,1);
  assert.equal((await f.create().revoke({expectedGeneration:5,resumeDisabled:true})).step,
    'external-authority-mismatch');
});
test('external reply with mismatching generation after CAS is rejected',async()=>{
  const a=authority(),bad=Object.freeze({
    snapshot:u=>a.client.snapshot(u),
    async advance(uid,args){
      const result=await a.client.advance(uid,args);
      return {...result,roleGeneration:999};
    }
  });
  const f=coordinatorLab({client:bad});
  const r=await f.create().revoke({expectedGeneration:4});
  assert.equal(r.step,'external-authority-advance-uncertain');
  assert.equal(f.state.enabled,false);
});
test('absence of allowed emulator environment fails before remote contact',async()=>{
  const a=authority();
  const old=process.env.FG_EXTERNAL_AUTHORITY_TEST;
  delete process.env.FG_EXTERNAL_AUTHORITY_TEST;
  try{
    const r=await a.client.snapshot(UID);
    assert.equal(r.ok,false);
    assert.equal(r.reason,'emulator-only');
    assert.equal(a.stats.reads,0);
  }finally{process.env.FG_EXTERNAL_AUTHORITY_TEST=old;}
});
test('coordinated rollback of DB AND external signer is outside this contract',async()=>{
  const a=authority(),f=coordinatorLab(a);
  assert.equal((await f.create().revoke({expectedGeneration:4})).completed,true);
  // This is a deliberate threat demonstration: if even the external
  // authority's authoritative state is restored by a malicious controller,
  // its VALID signer can attest the old generation again. No claim of
  // hardware-backed monotonicity or anti-rollback is made here.
  f.state.enabled=true;f.state.roleGeneration=4;f.state.revokeTime=0;
  a.remote.roleGeneration=4;a.remote.revokeTime=0;
  assert.equal((await f.create().revoke({expectedGeneration:4})).completed,true);
});
