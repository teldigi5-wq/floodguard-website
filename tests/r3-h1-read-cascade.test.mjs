import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {assessAuthorityPreflight} from '../scripts/r3-real-authority-preflight.mjs';
const base=JSON.parse(readFileSync('firebase.rules.json','utf8'));
const manifest=JSON.parse(readFileSync('docs/firebase/R3_REAL_AUTHORITY_PREFLIGHT_20261102.json','utf8'));
const fresh=()=>structuredClone(base);
const mustDeny=(ruleDoc)=>{
  const result=assessAuthorityPreflight(manifest,ruleDoc);
  assert.equal(result.reviewValid,false,'unexpectedly approved widened Firebase Rules source');
  assert.equal(result.releaseDecision,'NO_GO');
  assert.equal(result.mayChangeRules,false);
  assert.equal(result.mayDeploy,false);
  assert.equal(result.mayPublish,false);
};
test('original reviewed repository Rules remain source-review valid but production NO-GO',()=>{
  const r=assessAuthorityPreflight(manifest,base);
  assert.equal(r.reviewValid,true);
  assert.equal(r.effectiveFirebaseRulesVerified,false);
  assert.equal(r.releaseDecision,'NO_GO');
});
test('new public .read on floodguard parent fails',()=>{
  const r=fresh(); r.rules.floodguard['.read']=true;mustDeny(r);
});
test('new public .read on live parent fails despite IP and Wi-Fi child denies',()=>{
  const r=fresh();r.rules.floodguard.live['.read']=true;mustDeny(r);
});
test('new public .read on esp8266 parent fails despite IP and Wi-Fi child denies',()=>{
  const r=fresh();r.rules.floodguard.live.esp8266['.read']=true;mustDeny(r);
});
test('dynamic conditional read above live subtree requires manual review',()=>{
  const r=fresh();r.rules.floodguard.live['.read']="auth != null";mustDeny(r);
});
test('unauthorized extra public subtree fails',()=>{
  const r=fresh();r.rules.floodguard.adminPrivate={'.read':true};mustDeny(r);
});
test('unauthorized extra public sibling under live fails',()=>{
  const r=fresh();r.rules.floodguard.live.otherPrivate={'.read':true};mustDeny(r);
});
test('unknown child conditional read fails even under a public read subtree',()=>{
  const r=fresh();r.rules.floodguard.live.water.newPrivate={'.read':"auth != null"};mustDeny(r);
});
test('explicit false on an ancestor does not accidentally block reviewed public nine paths',()=>{
  const r=fresh();r.rules.floodguard['.read']=false;
  r.rules.floodguard.live['.read']=false;
  r.rules.floodguard.live.esp8266['.read']=false;
  const res=assessAuthorityPreflight(manifest,r);
  assert.equal(res.reviewValid,true);
  assert.equal(res.releaseDecision,'NO_GO');
});
