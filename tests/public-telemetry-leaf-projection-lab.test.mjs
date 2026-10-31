import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  projectPublicTelemetryLabV1,
  PUBLIC_TELEMETRY_LAB_FIELDS,
  PUBLIC_TELEMETRY_LAB_ROOT
} from '../experiments/public-telemetry-leaf-projection-lab.mjs';
const rules=JSON.parse(readFileSync(
  'docs/firebase/public-telemetry-leaf-lab.rules.json','utf8')).rules;
const tree=rules.floodguard.publicTelemetryLabV1;

test('new isolated public root does not replace the current live feed',()=>{
  assert.equal(PUBLIC_TELEMETRY_LAB_ROOT,
    '/floodguard/publicTelemetryLabV1');
  assert.equal(rules['.read'],false);
  assert.equal(rules['.write'],false);
  assert.equal(tree['.read'],undefined);
  assert.equal(tree['.write'],undefined);
  assert.equal(tree.water['.read'],undefined);
  assert.equal(tree.esp8266['.read'],undefined);
  const legacy=JSON.parse(readFileSync('firebase.rules.json','utf8'));
  assert.equal(legacy.rules.floodguard.live.water['.read'],true);
});

test('public primitive leaf allowlist and exact read rules cannot drift',()=>{
  for(const [group,fields] of Object.entries(PUBLIC_TELEMETRY_LAB_FIELDS)){
    assert.deepEqual(Object.keys(tree[group]).sort(),[...fields].sort());
    for(const field of fields)
      assert.deepEqual(tree[group][field],{'.read':true});
  }
  assert.deepEqual(Object.keys(tree).sort(),
    Object.keys(PUBLIC_TELEMETRY_LAB_FIELDS).sort());
  for(const group of ['water','rain','gate','alarm','devices','system','esp8266']){
    assert.equal(tree[group].ip?.['.read'],undefined);
    assert.equal(tree[group].wifi?.['.read'],undefined);
    assert.equal(tree[group].secret?.['.read'],undefined);
  }
});

test('projection strips private fields, root metadata and nested secrets',()=>{
  const input={
    water:{distanceCm:14.5,levelCm:10.5,status:'WARNING',
      wifi:{ssid:'DO_NOT_LEAK'},ip:'192.0.2.1',accessToken:'SECRET'},
    rain:{currentMm:1,dailyMm:10,status:'NORMAL',privateCalibration:{x:1}},
    esp8266:{connection:'ONLINE',rssi:-63,status:'ONLINE',
      wifi:'PRIVATE',ip:'198.51.100.1'},
    bot:{contacts:{phone:'PRIVATE'}},
    confirmedIngest:{privateKey:'SECRET'},
    privateLog:{messages:['SECRET']}
  };
  const out=projectPublicTelemetryLabV1(input);
  assert.deepEqual(Object.keys(out).sort(),['esp8266','rain','water']);
  assert.deepEqual({...out.water},{distanceCm:14.5,levelCm:10.5,status:'WARNING'});
  assert.deepEqual({...out.esp8266},{connection:'ONLINE',rssi:-63,status:'ONLINE'});
  assert.doesNotMatch(JSON.stringify(out),/SECRET|DO_NOT_LEAK|PRIVATE|192\.0\.2|198\.51/);
  assert.equal(Object.getPrototypeOf(out),null);
  assert.equal(Object.getPrototypeOf(out.water),null);
  assert.equal(input.water.accessToken,'SECRET','must not mutate original source');
});

test('invalid safe-looking fields cannot become a partial or substituted frame',()=>{
  for(const value of [NaN,Infinity,-1,9999,'14',null]){
    assert.throws(()=>projectPublicTelemetryLabV1({
      water:{status:'SAFE',distanceCm:value}
    }),/Invalid public field/);
  }
  for(const value of ['normal','CLEAR','',null,{},['SAFE']])
    assert.throws(()=>projectPublicTelemetryLabV1({
      water:{status:value}
    }),/Invalid public field/);
  for(const invalid of [
    {water:{levelCm:26}},{gate:{angle:180}},
    {rain:{currentMm:-1}},{alarm:{active:'false'}},
    {devices:{servo:{status:'ONLINE'}}}
  ])assert.throws(()=>projectPublicTelemetryLabV1(invalid),
    /Invalid public field/);
});

test('unknown groups alone and non-plain input are rejected without unsafe defaults',()=>{
  for(const input of [
    {},null,[],true,'text',{bot:{contacts:'PRIVATE'}},
    {water:null},{water:['DISTANCE']},
    {water:{distanceCm:undefined}}
  ])assert.throws(()=>projectPublicTelemetryLabV1(input));
  assert.deepEqual(
    {...projectPublicTelemetryLabV1({water:{status:'SENSOR_ERROR'}}).water},
    {status:'SENSOR_ERROR'}
  );
});

test('only validated allowlisted scalar values survive group projection',()=>{
  const out=projectPublicTelemetryLabV1({
    water:{distanceCm:12,status:'DANGER',levelCm:13},
    gate:{status:'COUNTDOWN',angle:0,countdownSeconds:30,reason:'WATER_DANGER'},
    alarm:{active:true,type:'SIREN'},
    system:{overallRisk:'CRITICAL',lastUpdate:1793450000000},
    devices:{arduino:'ONLINE',servo:'UNKNOWN'},
    rain:{status:'HEAVY_RAIN',currentMm:40.5,dailyMm:100},
  });
  assert.deepEqual({...out.gate},
    {status:'COUNTDOWN',angle:0,countdownSeconds:30,reason:'WATER_DANGER'});
  for(const group of Object.values(out))for(const value of Object.values(group))
    assert.ok(['string','number','boolean'].includes(typeof value));
});

test('this lab has no Firebase writes, deployed service, network host or signing keys',()=>{
  const src=readFileSync(
    'experiments/public-telemetry-leaf-projection-lab.mjs','utf8');
  assert.doesNotMatch(src,/firebase-admin|firebase\/database|node:http|node:https|serviceAccount|sign\(/);
  assert.doesNotMatch(src,/fetch\s*\(|set\s*\(|update\s*\(|remove\s*\(/);
  assert.doesNotMatch(src,/privateKey|NEXT_PUBLIC_FIREBASE_DATABASE_URL/);
});
