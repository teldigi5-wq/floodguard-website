import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {parseFieldTimestamp,ageSeconds,classifyTelemetryFreshness} from '../lib/telemetry-health.mjs';
import {readLocalStage11} from '../scripts/stage11-release-audit.mjs';
const file='docs/firebase/stage18-shared-child-stream.json';
const corpus=JSON.parse(fs.readFileSync(file,'utf8'));
test('shared Stage 18 corpus matches the independently reviewed child allowlist',()=>{
  assert.equal(corpus.schema,'floodguard-stage18-transport-contract-v1');
  assert.equal(corpus.evidence,'SYNTHETIC_LOCAL_REPLAY_ONLY');
  assert.equal(corpus.releaseDecision,'NO_GO');
  assert.equal(corpus.scenarios.length,8);
  assert.equal(corpus.setup.length,9);
  assert.deepEqual(corpus.publicPaths,[
    'water','rain','gate','alarm','devices','system',
    'esp8266/connection','esp8266/rssi','esp8266/status']);
  assert.equal(new Set(corpus.publicPaths).size,9);
  assert.equal(readLocalStage11().pathParity,true);
});
test('the real website provider uses only allowlisted Firebase subscriptions',()=>{
  const src=fs.readFileSync('providers/flood-provider.tsx','utf8');
  assert.match(src,/ref\(db,.*LIVE_PATH.*key/);
  for(const name of ['water','rain','gate','alarm','devices','system'])
    assert.ok(src.includes(name+': '+name+'Schema'),name);
  for(const name of ['connection','rssi','status']){
    const expected='esp'+name[0].toUpperCase()+name.slice(1);
    assert.ok(src.includes(name+': '+expected),name);
  }
  assert.doesNotMatch(src,/ref\(db, LIVE_PATH\)/);
  assert.doesNotMatch(src,/ref\(db, ['"]\\/floodguard\\/live['"]\)/);
});
test('all synthetic event branches are explicitly public and private fields absent',()=>{
  const allowed=new Set(corpus.publicPaths);
  for(const e of corpus.setup)assert.ok(allowed.has(e.branch));
  for(const item of corpus.scenarios){
    assert.ok(Number.isSafeInteger(item.nowMs));
    for(const e of item.operations){
      assert.ok(allowed.has(e.branch),item.id);
      assert.ok(['put','patch'].includes(e.kind));
      assert.ok(e.packet.path.startsWith('/'));
      assert.doesNotMatch(JSON.stringify(e),/password|credential|subscriber/i);
    }
    const state=item.expectedPublic;
    for(const name of ['water','rain','gate','system','alarm','devices','esp8266'])
      assert.ok(state[name],name+' '+item.id);
    assert.equal(state.esp8266.ip,undefined);
    assert.equal(state.esp8266.wifi,undefined);
  }
  for(const banned of corpus.deniedBranches)assert.equal(allowed.has(banned),false);
});
test('actual website timestamp/freshness parser matches all scenario expectations',()=>{
  for(const item of corpus.scenarios){
    const timestamp=parseFieldTimestamp(item.expectedPublic.system.lastUpdate,item.nowMs);
    const age=ageSeconds(timestamp,item.nowMs);
    assert.equal(age,item.ageSeconds,item.id);
    const result=classifyTelemetryFreshness({
      loading:false,hasData:true,connected:item.connected,error:false,ageSeconds:age
    });
    assert.equal(result,item.policy.website,item.id);
  }
});
test('deleting the source timestamp never substitutes the local reconnect time',()=>{
  const item=corpus.scenarios.find(s=>s.id==='deleted-field-timestamp');
  assert.equal(Object.hasOwn(item.expectedPublic.system,'lastUpdate'),false);
  assert.equal(parseFieldTimestamp(item.expectedPublic.system.lastUpdate,item.nowMs),null);
  assert.equal(item.policy.website,'stale');
});
test('no production URL, secret or networking is required for this offline replay',()=>{
  const replayOnly=JSON.stringify(corpus.setup)+JSON.stringify(corpus.scenarios);
  assert.doesNotMatch(replayOnly,/firebasedatabase\\.app|firebaseio\\.com|192\\.168\\.|password|authToken|apiKey/i);
  const testSource=fs.readFileSync('tests/stage18-child-stream-contract.test.mjs','utf8');
  assert.doesNotMatch(testSource,/node:http|node:https|node:net|node:tls/);
});
