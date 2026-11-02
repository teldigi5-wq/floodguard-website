// Offline source contract only. Not an RTDB Emulator or production audit.
// NEVER import this candidate into firebase.rules.json or deploy from CI.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const review=JSON.parse(readFileSync(
  new URL('../docs/firebase/R3_PUBLIC_CHILD_READS_MERGED_REVIEW_ONLY_20261102.json',import.meta.url),'utf8'));
const root=review.rules;
const live=root.floodguard.live;
const allowed=[
  'water','rain','gate','alarm','devices','system',
  'esp8266/connection','esp8266/rssi','esp8266/status'
];
const denied=['','floodguard','floodguard/live','floodguard/live/esp8266',
  'floodguard/live/esp8266/ip','floodguard/live/esp8266/wifi',
  'floodguard/bot','floodguard/test'];
const readAt=(node,path)=>path.split('/').filter(Boolean).reduce((p,k)=>p?.[k],node);

// This is an intentionally narrow STATIC boolean-only checker.
// The real Firebase Rules engine and observed runtime must be tested separately.
function granted(path,operation){
  let node=root;
  let grantedAbove=false;
  for(const key of [null,...path.split('/').filter(Boolean)]){
    if(key!==null)node=node?.[key];
    if(node==null)break;
    const v=node[operation];
    assert.ok(v===undefined||typeof v==='boolean',
      'Conditional permission requires Firebase Emulator/manual review');
    if(v===true)grantedAbove=true;
  }
  return grantedAbove;
}
function enumerateGrants(node,prefix='',result=[]){
  for(const [key,value] of Object.entries(node)){
    if(key.startsWith('.')||value===null||typeof value!=='object'||Array.isArray(value))continue;
    const next=prefix?prefix+'/'+key:key;
    if(value['.read']===true)result.push(next);
    enumerateGrants(value,next,result);
  }
  return result;
}
test('nine public reads only; root/live/esp ancestors never granted',()=>{
  assert.equal(root['.read'],false);
  assert.equal(root['.write'],false);
  assert.equal(live['.read'],false);
  assert.equal(live['.write'],false);
  assert.equal(live.esp8266['.read'],false);
  for(const p of denied)assert.equal(granted(p,'.read'),false,p);
  for(const p of allowed)assert.equal(granted('floodguard/live/'+p,'.read'),true,p);
  assert.deepEqual(enumerateGrants(root).sort(),
    allowed.map(x=>'floodguard/live/'+x).sort());
});
test('all client writes remain denied (never permit public sensor forging)',()=>{
  for(const p of [...denied,...allowed.map(x=>'floodguard/live/'+x),
      'floodguard/live/water/status','floodguard/live/rain/dailyMm',
      'floodguard/live/gate/status']){
    assert.equal(granted(p,'.write'),false,p);
  }
  const walk=(node,path='')=>{
    for(const [key,value] of Object.entries(node)){
      if(key==='.write')assert.equal(value,false,path);
      if(!key.startsWith('.')&&value!==null&&typeof value==='object')walk(value,path+'/'+key);
    }
  };
  walk(root);
});
test('private ESP fields and bot/test deny remain intact',()=>{
  assert.equal(live.esp8266.ip['.read'],false);
  assert.equal(live.esp8266.wifi['.read'],false);
  for(const p of ['bot','test']){
    assert.equal(root.floodguard[p]['.read'],false);
    assert.equal(root.floodguard[p]['.write'],false);
  }
});
const validators={
 water:{
  distanceCm:'!newData.exists() || (newData.isNumber() && newData.val() >= 0 && newData.val() <= 400)',
  levelCm:'!newData.exists() || (newData.isNumber() && newData.val() >= 0 && newData.val() <= 25)',
  status:"newData.isString() && (newData.val() === 'SAFE' || newData.val() === 'WARNING' || newData.val() === 'DANGER' || newData.val() === 'SENSOR_ERROR')"
 },
 gate:{
  status:"newData.isString() && (newData.val() === 'CLOSED' || newData.val() === 'COUNTDOWN' || newData.val() === 'OPEN')",
  angle:'!newData.exists() || (newData.isNumber() && newData.val() >= 0 && newData.val() <= 90)',
  countdownSeconds:'!newData.exists() || (newData.isNumber() && newData.val() >= 0 && newData.val() <= 10)'
 },
 rain:{
  currentMm:'!newData.exists() || (newData.isNumber() && newData.val() >= 0)',
  dailyMm:'!newData.exists() || (newData.isNumber() && newData.val() >= 0)',
  waterDepthCm:'!newData.exists() || (newData.isNumber() && newData.val() >= 0 && newData.val() <= 4)',
  rawValue:'!newData.exists() || (newData.isNumber() && newData.val() >= 0 && newData.val() <= 1023)',
  weightGrams:'!newData.exists() || newData.isNumber()'
 }
};
test('exactly preserve all eleven user-provided validation expressions',()=>{
  let count=0;
  for(const [group,fields] of Object.entries(validators)){
    for(const [field,expression] of Object.entries(fields)){
      assert.equal(live[group]?.[field]?.['.validate'],expression,group+'/'+field);
      count++;
    }
  }
  assert.equal(count,11);
  let actual=0;
  const walk=(node)=>{
    for(const [key,value] of Object.entries(node)){
      if(key==='.validate')actual++;
      if(!key.startsWith('.')&&value!==null&&typeof value==='object')walk(value);
    }
  };
  walk(root);
  assert.equal(actual,11);
});
test('no accidental public grants outside original child allowlist',()=>{
  const approved=new Set(allowed.map(x=>'floodguard/live/'+x));
  for(const p of enumerateGrants(root))assert.ok(approved.has(p),p);
  assert.equal(granted('floodguard/live/esp8266','.read'),false);
  assert.equal(granted('floodguard/live','.read'),false);
});
