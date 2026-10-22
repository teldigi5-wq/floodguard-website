import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert/strict';
import test from 'node:test';

const root=join(dirname(fileURLToPath(import.meta.url)),'..');
const rules=JSON.parse(readFileSync(join(root,'docs/firebase/phase-a-privacy-candidate.rules.json'),'utf8')).rules;
const live=rules.floodguard.live;

test('Phase A explicitly preserves anonymous firmware upload compatibility, not security certification',()=>{
 assert.equal(rules['.read'],false);
 assert.equal(rules['.write'],false);
 assert.equal(live['.write'],true,'Phase A must not silently break existing anonymous device uploads');
 assert.equal(rules.floodguard.test['.write'],false);
 assert.equal(rules.floodguard.bot['.write'],false);
});
test('No ancestor grants can disclose private ESP8266 fields',()=>{
 for(const node of [rules,rules.floodguard,live,live.esp8266])
   assert.notEqual(node['.read'],true,'Inherited read grant overrides private child denies');
 for(const path of ['ip','wifi'])assert.equal(live.esp8266[path]['.read'],false);
});
test('Public browser, mobile, and bot telemetry child paths are available',()=>{
 for(const key of ['water','rain','gate','alarm','devices','system'])
   assert.equal(live[key]['.read'],true,key);
 for(const key of ['connection','rssi','status'])
   assert.equal(live.esp8266[key]['.read'],true,'esp8266/'+key);
 assert.notEqual(live['.read'],true);
});
test('Preserves validation of the live Firebase rules provided by project owner',()=>{
 const expected={
  water:['distanceCm','levelCm','status'],
  rain:['currentMm','dailyMm','waterDepthCm','rawValue','weightGrams'],
  gate:['status','angle','countdownSeconds']
 };
 for(const [group,children] of Object.entries(expected)){
   for(const field of children){
     assert.equal(typeof live[group][field]['.validate'],'string',group+'/'+field);
   }
 }
 assert.match(live.gate.status['.validate'],/COUNTDOWN/);
 assert.match(live.water.status['.validate'],/SENSOR_ERROR/);
 assert.match(live.water.levelCm['.validate'],/25/);
});
