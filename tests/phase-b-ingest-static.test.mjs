import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';

const rules=JSON.parse(readFileSync('docs/firebase/phase-b-authenticated-prototype.rules.json','utf8')).rules;
const fb=rules.floodguard;
const lane=fb.staging?.ingestV1?.$deviceId;

test('Stage 5 ingestion remains private and is excluded from currently shipped Firebase rules',()=>{
  assert.equal(rules['.write'],false);
  assert.equal(fb.live['.write'],false);
  assert.equal(fb.staging['.write'],false);
  assert.equal(fb.staging['.read'],false);
  assert.equal(fb.staging.ingestV1['.write'],false);
  assert.equal(fb.staging.ingestV1['.read'],false);
  assert.equal(lane['.read'],false);
  assert.match(lane['.write'],/auth.uid === \$deviceId/);
  assert.match(lane['.write'],/auth.token.fg_ingest_v1 === true/);
  assert.match(lane['.write'],/deviceAuthorization/);
  assert.match(lane['.write'],/prototype-ingest-v1/);
  assert.match(lane['.write'],/newData.exists\(\)/);
  assert.match(lane['.write'],/sequence.*data.child\('sequence'\)/);
  const config=JSON.parse(readFileSync('firebase.phase-b.json','utf8'));
  assert.equal(config.database.rules,'docs/firebase/phase-b-authenticated-prototype.rules.json');
  const production=readFileSync('firebase.rules.json','utf8');
  assert.doesNotMatch(production,/ingestV1|fg_ingest_v1|prototype-ingest-v1/);
});
test('Stage 5 staging schema denies unknown or missing fields and checks ranges',()=>{
  assert.match(lane['.validate'],/hasChildren/);
  for(const id of ['sequence','distanceCm','levelCm','risk'])assert.ok(lane[id]?.['.validate'],id);
  assert.equal(lane.$other['.validate'],false);
  assert.match(lane.sequence['.validate'],/2147483647/);
  assert.match(lane.sequence['.validate'],/% 1 === 0/);
  assert.match(lane.distanceCm['.validate'],/400/);
  assert.match(lane.levelCm['.validate'],/25/);
  assert.match(lane.risk['.validate'],/SENSOR_ERROR/);
});
test('Stage 5 still disallows registry writes and preserves private ESP telemetry',()=>{
  assert.equal(fb.deviceAuthorization['.read'],false);
  assert.equal(fb.deviceAuthorization['.write'],false);
  assert.equal(fb.live.esp8266.ip['.read'],false);
  assert.equal(fb.live.esp8266.wifi['.read'],false);
  assert.equal(fb.live.esp8266['.read'],false);
});


test('Stage 19 requires device-specific authorization on every live prototype write leaf',()=>{
  const leaves=[
    fb.live.water.distanceCm,
    fb.live.water.levelCm,
    fb.live.water.status,
    fb.live.gate.status,
    fb.live.gate.angle,
    fb.live.esp8266.status
  ];
  assert.equal(leaves.length,6);
  for(const leaf of leaves){
    const policy=leaf['.write'];
    assert.equal(typeof policy,'string');
    assert.match(policy,/auth != null/);
    assert.match(policy,/deviceAuthorization/);
    assert.match(policy,/child\(auth.uid\)/);
    assert.match(policy,/child\('enabled'\)\.val\(\) === true/);
    assert.match(policy,/prototype-primary-telemetry/);
    assert.match(policy,/newData.exists\(\)/);
  }
  for(const ancestor of [rules,fb,fb.live,fb.live.water,
    fb.live.gate,fb.live.esp8266]){
    assert.notEqual(ancestor['.write'],true,'ancestor must not grant unrestricted device writes');
  }
});

test('Stage 19 has no unconditional true write grant anywhere in the Phase B prototype',()=>{
  function inspect(value,path='rules'){
    if(!value || typeof value!=='object')return;
    for(const [key,nested] of Object.entries(value)){
      if(key==='.write')assert.notEqual(nested,true,'unexpected public writer at '+path);
      else inspect(nested,path+'/'+key);
    }
  }
  inspect(rules);
});
