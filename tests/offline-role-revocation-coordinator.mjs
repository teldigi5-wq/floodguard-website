// Offline deterministic failure-injection around two non-atomic services.
// No production Firebase, clock mocking, live tokens or network access.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createOfflineRoleRevocationCoordinator} from
  '../experiments/offline-role-revocation-coordinator.mjs';

const uid='ingest-verifier-stage-a',now=1793270000000;
const cutoff=new Date(now-2000).toISOString();
const permitted=()=>Object.assign(process.env,{
  FG_REVOCATION_SAGA_TEST:'1',
  FIREBASE_AUTH_EMULATOR_HOST:'127.0.0.1:9099',
  FIREBASE_DATABASE_EMULATOR_HOST:'127.0.0.1:9000',
  GCLOUD_PROJECT:'demo-fg-auth-lifecycle'
});
permitted();
function fixture({failure='',initialEnabled=true}={}){
  const state={enabled:initialEnabled,roleGeneration:4,revokeTime:2};
  let revoked=0,disableAttempts=0,commits=0,cutoffReads=0;
  const store=Object.freeze({
    async read(){
      if(failure==='initialRead'&&disableAttempts===0)throw Error('read unavailable');
      if(failure==='verifyDisabledRead'&&disableAttempts>0&&revoked===0)
        throw Error('read after disable failed');
      return {...state};
    },
    async disableRoleCAS(_,generation){
      disableAttempts++;
      if(failure==='disableThrows')throw Error('ack lost');
      if(failure==='disableFalse')return false;
      if(generation!==state.roleGeneration||!state.enabled)return false;
      state.enabled=false;
      return true;
    },
    async advanceSessionCAS(_,{expectedGeneration,cutoffSeconds,nextGeneration}){
      commits++;
      if(failure==='commitThrows')throw Error('cutoff ack lost');
      if(failure==='commitFalse')return false;
      if(state.enabled||state.roleGeneration!==expectedGeneration||
         nextGeneration!==expectedGeneration+1||
         cutoffSeconds<state.revokeTime)return false;
      state.revokeTime=cutoffSeconds;state.roleGeneration=nextGeneration;
      return true;
    }
  });
  const auth=Object.freeze({
    async revokeRefreshTokens(){
      revoked++;
      if(failure==='authThrows')throw Error('Auth unavailable');
    },
    async getUser(){
      cutoffReads++;
      if(failure==='cutoffThrows')throw Error('Auth fetch unavailable');
      return {tokensValidAfterTime:failure==='invalidCutoff'?'??':cutoff};
    }
  });
  const coordinator=()=>createOfflineRoleRevocationCoordinator({
    uid,roleStore:store,auth,clock:()=>now
  });
  return {coordinator,state,counts:()=>({revoked,disableAttempts,commits,cutoffReads})};
}
const run=async(f,config={})=>f.coordinator().revoke({expectedGeneration:4,...config});
test('disable, revoke and monotonic cutoff commit never auto-enable',async()=>{
  const f=fixture();
  const result=await run(f);
  assert.equal(result.completed,true);
  assert.equal(result.roleDisabled,true);
  assert.equal(result.roleGeneration,5);
  assert.equal(result.revokeTime,Math.ceil(Date.parse(cutoff)/1000));
  assert.equal(f.state.enabled,false);
  assert.deepEqual(f.counts(),{
    revoked:1,disableAttempts:1,commits:1,cutoffReads:1
  });
});
test('uncertain disable never calls Authentication or records speculative cutoff',async()=>{
  for(const failure of ['disableThrows','disableFalse','initialRead','verifyDisabledRead']){
    const f=fixture({failure});
    const result=await run(f);
    assert.equal(result.completed,false,failure);
    assert.equal(result.manualRecoveryRequired,true);
    assert.equal(f.counts().revoked,0,failure);
    assert.equal(f.counts().commits,0,failure);
    assert.equal(f.state.roleGeneration,4);
  }
});
test('Auth revoke, getUser or cutoff corruption leave role disabled',async()=>{
  for(const failure of ['authThrows','cutoffThrows','invalidCutoff']){
    const f=fixture({failure}),response=await run(f);
    assert.equal(response.completed,false,failure);
    assert.equal(response.manualRecoveryRequired,true);
    assert.equal(f.state.enabled,false,failure);
    assert.equal(f.state.roleGeneration,4,failure);
    assert.equal(f.counts().commits,0,failure);
  }
});
test('uncertain or conflicted cutoff CAS does not enable old role',async()=>{
  for(const failure of ['commitThrows','commitFalse']){
    const f=fixture({failure}),response=await run(f);
    assert.equal(response.completed,false,failure);
    assert.equal(f.state.enabled,false);
    assert.equal(f.state.roleGeneration,4);
    assert.equal(f.counts().revoked,1);
  }
});
test('restart requires explicit manual resume of already disabled role',async()=>{
  const f=fixture({failure:'authThrows'});
  assert.equal((await run(f)).step,'auth-revocation-uncertain');
  const before=f.counts().revoked;
  assert.equal((await run(f)).step,'role-already-disabled-manual-resume');
  assert.equal(f.counts().revoked,before);
  // A different operator-approved coordinator can resume, but we do not
  // automatically authorize, issue an ID token or re-enable the role.
  const resumed=await run(f,{resumeDisabled:true});
  assert.equal(resumed.completed,false);
  assert.equal(resumed.step,'auth-revocation-uncertain');
  assert.equal(f.state.enabled,false);
});
test('manual resume of disabled role can finish after prior crash',async()=>{
  const f=fixture({initialEnabled:false});
  assert.equal((await run(f)).step,'role-already-disabled-manual-resume');
  const result=await run(f,{resumeDisabled:true});
  assert.equal(result.completed,true);
  assert.equal(f.state.enabled,false);
  assert.equal(f.state.roleGeneration,5);
  assert.equal(f.counts().disableAttempts,0);
});
test('stale generation cannot initiate a new revoke or resurrect role',async()=>{
  const f=fixture();
  const a=await run(f);
  assert.equal(a.completed,true);
  const next=await f.coordinator().revoke({expectedGeneration:4,resumeDisabled:true});
  assert.equal(next.step,'initial-state-mismatch');
  assert.equal(f.state.enabled,false);
  assert.equal(f.state.roleGeneration,5);
});
test('bad or non-demo environment fails before any side effect',async()=>{
  const f=fixture();
  const previous=process.env.FG_REVOCATION_SAGA_TEST;
  delete process.env.FG_REVOCATION_SAGA_TEST;
  try{
    assert.equal((await run(f)).step,'local-emulator-only');
    assert.deepEqual(f.counts(),{
      revoked:0,disableAttempts:0,commits:0,cutoffReads:0
    });
  }finally{process.env.FG_REVOCATION_SAGA_TEST=previous;}
});
test('concurrent same-instance calls are refused without duplicated Auth revocation',async()=>{
  let release;
  const wait=new Promise(resolve=>{release=resolve;});
  const f=fixture();
  const store=Object.freeze({
    async read(){return {...f.state};},
    async disableRoleCAS(){f.state.enabled=false;await wait;return true;},
    async advanceSessionCAS(){return false;}
  });
  let count=0;
  const auth=Object.freeze({
    async revokeRefreshTokens(){count++;},
    async getUser(){return {tokensValidAfterTime:cutoff};}
  });
  const actor=createOfflineRoleRevocationCoordinator({
    uid,roleStore:store,auth,clock:()=>now
  });
  const first=actor.revoke({expectedGeneration:4});
  const second=await actor.revoke({expectedGeneration:4});
  assert.equal(second.step,'already-in-progress');
  assert.equal(count,0);
  release();
  assert.equal((await first).step,'session-cas-conflict');
  assert.equal(count,1);
  assert.equal(f.state.enabled,false);
});
