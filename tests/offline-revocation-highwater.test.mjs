// No production Firebase or network calls. Synthetic independent filesystem
// witness detects database rollback only if separately retained witness
// and key have NOT also been restored to an earlier point.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,writeFileSync,rmSync,unlinkSync,chmodSync}
  from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomBytes} from 'node:crypto';
import {createOfflineRevocationWitness}
  from '../experiments/offline-revocation-highwater.mjs';
import {createOfflineRoleRevocationCoordinator}
  from '../experiments/offline-role-revocation-coordinator.mjs';

Object.assign(process.env,{
  FG_REVOCATION_SAGA_TEST:'1',
  FIREBASE_AUTH_EMULATOR_HOST:'127.0.0.1:9099',
  FIREBASE_DATABASE_EMULATOR_HOST:'127.0.0.1:9000',
  GCLOUD_PROJECT:'demo-fg-auth-lifecycle'
});
const uid='ingest-verifier-stage-a',other='ingest-authority-stage-a';
const now=1793270000000,validCutoff=new Date(now-2000).toISOString();
const root=(f)=>join(f.dir,'floodguard-revocation-witness-lab.json');
function lab(){
  const dir=mkdtempSync(join(tmpdir(),'fg-revoke-highwater-'));
  const key=randomBytes(32);
  const witness=createOfflineRevocationWitness({directory:dir,integrityKey:key});
  witness.bootstrap({uid,roleGeneration:4,revokeTime:0});
  const state={enabled:true,roleGeneration:4,revokeTime:0};
  let authRevokeCount=0,disableCount=0,sessionCount=0;
  let breakWitnessAdvance=false;
  const roleStore=Object.freeze({
    async read(){return {...state};},
    async disableRoleCAS(_,expected){
      disableCount++;
      if(state.roleGeneration!==expected||!state.enabled)return false;
      state.enabled=false;return true;
    },
    async advanceSessionCAS(_,{expectedGeneration,cutoffSeconds,nextGeneration}){
      sessionCount++;
      if(state.enabled||state.roleGeneration!==expectedGeneration||
         nextGeneration!==expectedGeneration+1||
         cutoffSeconds<state.revokeTime)return false;
      state.roleGeneration=nextGeneration;state.revokeTime=cutoffSeconds;
      return true;
    }
  });
  const auth=Object.freeze({
    async revokeRefreshTokens(){authRevokeCount++;},
    async getUser(){return {tokensValidAfterTime:validCutoff};}
  });
  const anchor=Object.freeze({
    snapshot:u=>witness.snapshot(u),
    advance(...args){
      if(breakWitnessAdvance)throw Error('simulated independent witness failure');
      return witness.advance(...args);
    }
  });
  const coordinator=()=>createOfflineRoleRevocationCoordinator({
    uid,roleStore,auth,clock:()=>now,independentWitness:anchor
  });
  return {
    dir,key,witness,roleStore,auth,anchor,state,coordinator,
    counts:()=>({authRevokeCount,disableCount,sessionCount}),
    breakAdvance:v=>{breakWitnessAdvance=v;},
    close:()=>rmSync(dir,{recursive:true,force:true})
  };
}
test('independent checkpoint is sealed and persists new monotonic generation',async()=>{
  const f=lab();
  try{
    const r=await f.coordinator().revoke({expectedGeneration:4});
    assert.equal(r.completed,true);
    assert.equal(r.roleGeneration,5);
    assert.equal(f.state.enabled,false);
    assert.deepEqual(f.witness.snapshot(uid),{
      uid,roleGeneration:5,revokeTime:r.revokeTime
    });
    assert.equal(f.counts().authRevokeCount,1);
  }finally{f.close();}
});
test('restored old database generation is detected BEFORE disabling or contacting Auth',async()=>{
  const f=lab();
  try{
    assert.equal((await f.coordinator().revoke({expectedGeneration:4})).completed,true);
    f.state.enabled=true;f.state.roleGeneration=4;f.state.revokeTime=0;
    const prior=f.counts();
    const stopped=await f.coordinator().revoke({expectedGeneration:4});
    assert.equal(stopped.step,'independent-checkpoint-mismatch');
    assert.equal(stopped.manualRecoveryRequired,true);
    assert.deepEqual(f.counts(),prior);
  }finally{f.close();}
});
test('cutoff rollback without generation rollback is separately detected',async()=>{
  const f=lab();
  try{
    const r=await f.coordinator().revoke({expectedGeneration:4});
    assert.equal(r.completed,true);
    f.state.revokeTime=0;
    const denied=await f.coordinator().revoke({
      expectedGeneration:5,resumeDisabled:true
    });
    assert.equal(denied.step,'independent-checkpoint-mismatch');
  }finally{f.close();}
});
test('witness loss fails closed and cannot silently be recommissioned',async()=>{
  const f=lab();
  try{
    unlinkSync(root(f));
    const r=await f.coordinator().revoke({expectedGeneration:4});
    assert.equal(r.step,'independent-checkpoint-unavailable');
    assert.equal(f.counts().authRevokeCount,0);
    assert.equal(f.state.enabled,true);
    // A missing witness cannot be reconstructed by the coordinator from RTDB.
    assert.throws(()=>f.witness.snapshot(uid));
  }finally{f.close();}
});
test('tampered witness bytes and incorrect HMAC key are rejected',async()=>{
  const f=lab();
  try{
    const contents=readFileSync(root(f),'utf8');
    writeFileSync(root(f),contents.replace('"roleGeneration":4','"roleGeneration":5'));
    assert.equal((await f.coordinator().revoke({expectedGeneration:4})).step,
      'independent-checkpoint-unavailable');
    writeFileSync(root(f),contents);
    const different=createOfflineRevocationWitness({
      directory:f.dir,integrityKey:randomBytes(32)
    });
    assert.throws(()=>different.snapshot(uid),/seal mismatch/);
  }finally{f.close();}
});
test('owner-unsafe file permissions are rejected instead of trusted',async()=>{
  const f=lab();
  try{
    chmodSync(root(f),0o644);
    assert.equal((await f.coordinator().revoke({expectedGeneration:4})).step,
      'independent-checkpoint-unavailable');
  }finally{f.close();}
});
test('witness checkpoint cannot skip generation, go backward, or switch identity',()=>{
  const f=lab();
  try{
    assert.equal(f.witness.advance(uid,{
      expectedGeneration:4,expectedRevokeTime:0,
      nextGeneration:6,nextRevokeTime:100
    }),false);
    assert.equal(f.witness.advance(uid,{
      expectedGeneration:4,expectedRevokeTime:0,
      nextGeneration:5,nextRevokeTime:-1
    }),false);
    assert.throws(()=>f.witness.snapshot(other),/another identity/);
    assert.throws(()=>f.witness.bootstrap({
      uid,roleGeneration:4,revokeTime:0
    }),/already commissioned/);
    assert.equal(f.witness.snapshot(uid).roleGeneration,4);
  }finally{f.close();}
});
test('checkpoint write failure leaves role DISABLED and demands manual recovery',async()=>{
  const f=lab();
  try{
    f.breakAdvance(true);
    const r=await f.coordinator().revoke({expectedGeneration:4});
    assert.equal(r.step,'independent-checkpoint-advance-uncertain');
    assert.equal(f.state.enabled,false);
    assert.equal(f.state.roleGeneration,5);
    assert.equal(f.witness.snapshot(uid).roleGeneration,4);
    assert.equal((await f.coordinator().revoke({
      expectedGeneration:5,resumeDisabled:true
    })).step,'independent-checkpoint-mismatch');
  }finally{f.close();}
});
test('valid old sealed file rollback cannot be detected without OTHER anchor',async()=>{
  const f=lab();
  try{
    const old=readFileSync(root(f));
    assert.equal((await f.coordinator().revoke({expectedGeneration:4})).completed,true);
    // An attacker able to restore BOTH artifacts can defeat this local
    // single-file witness. This limitation is deliberate and documented.
    f.state.roleGeneration=4;f.state.revokeTime=0;f.state.enabled=true;
    writeFileSync(root(f),old);
    assert.deepEqual(f.witness.snapshot(uid),{
      uid,roleGeneration:4,revokeTime:0
    });
    // We prove the limitation; we never label this scenario secure.
    assert.equal((await f.coordinator().revoke({expectedGeneration:4})).completed,true);
  }finally{f.close();}
});
