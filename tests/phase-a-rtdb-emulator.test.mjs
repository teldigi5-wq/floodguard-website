import assert from 'node:assert/strict';
import test from 'node:test';

const origin='http://127.0.0.1:9000';
// Standard npm test skips emulator I/O; the isolated rules CI explicitly enables it.
const emulatorTest = process.env.FG_EMULATOR === '1' ? test : test.skip;
const ns='demo-floodguard-default-rtdb';
const publicBranches=['water','rain','gate','alarm','devices','system',
 'esp8266/connection','esp8266/rssi','esp8266/status'];
async function request(path,{method='GET',json,admin=false}={}){
 const url=origin+path+'.json?ns='+ns+(admin?'&auth=owner':'');
 const response=await fetch(url,{method,headers:{'Content-Type':'application/json'},
   ...(json===undefined?{}:{body:JSON.stringify(json)})});
 return {status:response.status,body:await response.text()};
}

emulatorTest('emulator starts with our Phase A rules, never contacts live Firebase',async()=>{
 const r=await request('/floodguard/live',{admin:true,method:'PUT',json:{
  water:{status:'WARNING',distanceCm:15.35,levelCm:9.65},
  rain:{currentMm:0,dailyMm:0},
  gate:{status:'CLOSED',angle:0,countdownSeconds:0},
  alarm:{active:false},
  devices:{arduino:'ONLINE'},
  system:{lastUpdate:1720000000000},
  esp8266:{ip:'192.0.2.10',wifi:'TEST-NETWORK',status:'ONLINE',connection:'CONNECTED',rssi:-60}
 }});
 assert.equal(r.status,200, r.body);
});
emulatorTest('emulator exposes safe public children to browser and mobile',async()=>{
 for(const branch of publicBranches){
  const result=await request('/floodguard/live/'+branch);
  assert.equal(result.status,200,branch+' '+result.body);
 }
});
emulatorTest('emulator denies private ESP network data and all ancestors',async()=>{
 for(const path of ['/','/floodguard','/floodguard/live','/floodguard/live/esp8266',
  '/floodguard/live/esp8266/ip','/floodguard/live/esp8266/wifi',
  '/floodguard/bot','/floodguard/test']){
  const result=await request(path);
  assert.ok([401,403].includes(result.status),path+' unexpectedly '+result.status);
 }
});
emulatorTest('Phase A temporarily permits current anonymous uploads, but validates fields',async()=>{
 const valid=await request('/floodguard/live/water/levelCm',{method:'PUT',json:10});
 assert.equal(valid.status,200,valid.body);
 const invalid=await request('/floodguard/live/water/levelCm',{method:'PUT',json:100});
 assert.ok([401,403].includes(invalid.status),'out of range level accepted');
 const rootWrite=await request('/floodguard/bot/state',{method:'PUT',json:{enabled:false}});
 assert.ok([401,403].includes(rootWrite.status),'bot-state public writes accepted');
});

emulatorTest('Phase A accepts representative ESP8266 multi-location parent PATCH without exposing private children',async()=>{
 // Synthetic shape based on privately held sketch field names only.
 // Test values are reserved documentation/demo data, not device observations.
 const root='/floodguard/live';
 const payload={
  'water/distanceCm':15.35,
  'water/levelCm':9.65,
  'water/status':'WARNING',
  'rain/currentMm':0,
  'rain/dailyMm':0,
  'gate/status':'CLOSED',
  'gate/angle':0,
  'gate/countdownSeconds':0,
  'alarm/active':false,
  'devices/arduino':'ONLINE',
  'esp8266/connection':'CONNECTED',
  'esp8266/status':'ONLINE',
  'esp8266/rssi':-60,
  'esp8266/ip':'192.0.2.42',
  'esp8266/wifi':'EXAMPLE-NETWORK',
  'system/lastUpdate':1720000000000,
  'system/overallRisk':'MODERATE'
 };
 const write=await request(root,{method:'PATCH',json:payload});
 assert.equal(write.status,200,'Firmware-style root PATCH blocked by candidate rules');
 const water=await request(root+'/water/levelCm');
 assert.equal(water.status,200);
 assert.equal(JSON.parse(water.body),9.65);
 for(const path of [root+'/esp8266/ip',root+'/esp8266/wifi',root+'/esp8266']){
  const read=await request(path);
  assert.ok([401,403].includes(read.status),path+' private read unexpectedly allowed');
 }
});

emulatorTest('Phase A supports saved legacy whole-live PUT shape, but rejects invalid sensor fields',async()=>{
 const tree={
  water:{status:'SAFE',distanceCm:20,levelCm:5},
  rain:{currentMm:0,dailyMm:0,rawValue:0},
  gate:{status:'CLOSED',angle:0,countdownSeconds:0},
  alarm:{active:false,type:'NONE'},
  devices:{arduino:'ONLINE',servo:'ONLINE'},
  system:{lastUpdate:1720000000000,overallRisk:'LOW'},
  esp8266:{ip:'192.0.2.47',wifi:'EXAMPLE-NETWORK',status:'ONLINE',connection:'CONNECTED',rssi:-52}
 };
 const valid=await request('/floodguard/live',{method:'PUT',json:tree});
 assert.equal(valid.status,200,'Legacy full-tree PUT blocked by candidate rules');
 const bad=await request('/floodguard/live',{method:'PATCH',json:{'water/levelCm':100}});
 assert.ok([401,403].includes(bad.status),'Out-of-range parent PATCH was allowed');
 const safe=await request('/floodguard/live/water/levelCm');
 assert.equal(JSON.parse(safe.body),5,'Rejected write altered accepted measurement');
});
