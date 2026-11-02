import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {assessAuthorityPreflight}
  from '../scripts/r3-real-authority-preflight.mjs';
const manifest=JSON.parse(readFileSync(
  'docs/firebase/R3_REAL_AUTHORITY_PREFLIGHT_20261102.json','utf8'));
const rules=JSON.parse(readFileSync('firebase.rules.json','utf8'));
const fresh=x=>structuredClone(x);
const deny=(m,r,reason)=>{
  const result=assessAuthorityPreflight(m,r);
  assert.equal(result.reviewValid,false,JSON.stringify(result));
  if(reason)assert.equal(result.reason,reason);
  assert.equal(result.releaseDecision,'NO_GO');
  for(const k of ['approved','mayDeploy','mayMerge','mayChangeRules',
    'mayFlash','mayPublish','mayAcknowledge','maySendAlert','mayOperateGate'])
    assert.equal(result[k],false,k);
};
test('all offline constraints pass without ever authorizing release or live telemetry',()=>{
  const x=assessAuthorityPreflight(manifest,rules);
  assert.equal(x.reviewValid,true);
  assert.equal(x.releaseDecision,'NO_GO');
  assert.equal(x.unverifiedRealWorldGates,11);
  assert.equal(x.checkedDraftRoleBoundaries,6);
  assert.equal(x.effectiveFirebaseRulesVerified,false);
  assert.equal(x.independentlyProtectedWitnessDeployed,false);
  assert.equal(x.realSensorIdentityVerified,false);
  assert.equal(Object.isFrozen(x),true);
  for(const k of ['approved','mayDeploy','mayMerge','mayChangeRules',
    'mayFlash','mayPublish','mayAcknowledge','maySendAlert','mayOperateGate'])
    assert.equal(x[k],false,k);
});
test('claims of prod approval, privileged SDK access or new credentials refuse',()=>{
  for(const [k,v] of [
    ['mode','PRODUCTION'],['releaseDecision','GO'],
    ['productionChangesAuthorized',true],['deploymentTarget','firebase-prod'],
    ['firebaseAdminCredentialAllowed',true],['physicalDeviceAccessAuthorized',true]
  ]){
    const m=fresh(manifest);m[k]=v;
    deny(m,rules,'REVIEW_MANIFEST_REJECTED');
  }
  const m=fresh(manifest);m.privateKey='never';
  deny(m,rules,'REVIEW_MANIFEST_REJECTED');
});
test('no blanket publisher or observer privilege escalation',()=>{
  const cases=[
    [3,'operation','WRITE_ANY_FIREBASE_PATH'],
    [3,'path','/floodguard'],
    [3,'path','/floodguard/live'],
    [4,'path','/floodguard/live'],
    [2,'operation','READ_AND_WRITE'],
    [0,'operation','FIREBASE_ADMIN'],
    [5,'operation','WRITE_ALLOWLISTED_CHILDREN_ONLY'],
    [5,'path','/floodguard'],
    [1,'trust','TRUSTED_PRODUCTION_ISSUER'],
    [3,'live',true]
  ];
  for(const [i,k,v] of cases){
    const m=fresh(manifest);m.roles[i][k]=v;
    deny(m,rules,'AUTHORITY_ROLE_BOUNDARIES_INVALID');
  }
});
test('extra or missing service identity and extra fields are denied',()=>{
  for(const action of [
    x=>x.roles.pop(),
    x=>x.roles.push(fresh(x.roles[0])),
    x=>x.roles[0].id='root-admin',
    x=>x.roles[0].admin=true
  ]){const m=fresh(manifest);action(m);
    deny(m,rules,'AUTHORITY_ROLE_BOUNDARIES_INVALID');}
});
test('incomplete, forged, reordered, or magically completed physical gates fail',()=>{
  for(const change of [
    x=>x.mandatoryGates.pop(),
    x=>x.mandatoryGates[0].id='other',
    x=>x.mandatoryGates[0].status='VERIFIED',
    x=>x.mandatoryGates[0].evidence='user-claims-pass',
    x=>x.mandatoryGates[0].approved=true,
    x=>x.mandatoryGates.reverse()
  ]){const m=fresh(manifest);change(m);
    deny(m,rules);}
});
test('missing top-level/default-deny rules reject local source review',()=>{
  for(const change of [
    x=>delete x.rules['.read'],
    x=>x.rules['.read']=true,
    x=>x.rules['.write']=true,
    x=>delete x.rules['.write'],
    x=>x.rules={},
    x=>delete x.rules
  ]){const r=fresh(rules);change(r);
    deny(manifest,r,'LOCAL_REPO_RULES_FAIL_CLOSED_REVIEW_FAILED');}
});
test('deep descendant write grants cannot hide under a denied root',()=>{
  for(const entry of [
    ['floodguard','live','water','distanceCm'],
    ['floodguard','live','gate'],
    ['floodguard','esp8266'],
    ['floodguard','deviceAuthorization'],
    ['floodguard','staging']
  ]){
    const r=fresh(rules),last=entry.pop();
    let current=r.rules;
    for(const k of entry)current=current[k]??(current[k]={});
    current[last]??={};
    current[last]['.write']="auth != null";
    deny(manifest,r,'LOCAL_REPO_RULES_FAIL_CLOSED_REVIEW_FAILED');
  }
});
test('ESP network metadata and nine current read child paths cannot be broadened',()=>{
  const r=fresh(rules);
  r.rules.floodguard.live.esp8266.ip['.read']=true;
  deny(manifest,r,'LOCAL_REPO_RULES_FAIL_CLOSED_REVIEW_FAILED');
  for(const [group,leaf] of [
    ['water',null],['rain',null],['gate',null],['alarm',null],
    ['devices',null],['system',null],['esp8266','connection'],
    ['esp8266','rssi'],['esp8266','status']
  ]){
    const copy=fresh(rules);
    const target=leaf?copy.rules.floodguard.live[group][leaf]:
      copy.rules.floodguard.live[group];
    target['.read']=false;
    deny(manifest,copy,'LOCAL_REPO_RULES_FAIL_CLOSED_REVIEW_FAILED');
  }
});
test('never confuse a local repository candidate with effective production rules',()=>{
  const x=assessAuthorityPreflight(manifest,rules);
  assert.equal(x.localRulesCandidateReviewed,true);
  assert.equal(x.effectiveFirebaseRulesVerified,false);
  assert.equal(x.releaseDecision,'NO_GO');
  const m=fresh(manifest);
  m.mandatoryGates[0].status='PRODUCTION_RULES_VERIFIED';
  deny(m,rules,'REAL_WORLD_GATE_NOT_REVIEW_ONLY');
});
test('preflight does not read cloud config, load runtime credentials or write files',()=>{
  const src=readFileSync('scripts/r3-real-authority-preflight.mjs','utf8');
  assert.doesNotMatch(src,/firebase-admin|firebase\/database|node:http|node:https/);
  assert.doesNotMatch(src,/\bfetch\s*\(|\.listen\s*\(|writeFileSync|\.set\s*\(/);
  assert.doesNotMatch(src,/process\.env|serviceAccountKey|databaseAuthVariableOverride/);
  assert.match(src,/localRulesCandidateReviewed:true/);
  assert.match(src,/effectiveFirebaseRulesVerified:false/);
  assert.match(src,/mayOperateGate:false/);
});
