import assert from 'node:assert/strict';
import test from 'node:test';

const origin='http://127.0.0.1:9000';
const ns='demo-floodguard-default-rtdb';
const publicBranches=['water','rain','gate','alarm','devices','system',
 'esp8266/connection','esp8266/rssi','esp8266/status'];
async function request(path,{method='GET',json,admin=false}={}){
 const url=origin+path+'.json?ns='+ns+(admin?'&auth=owner':'');
 const response=await fetch(url,{method,headers:{'Content-Type':'application/json'},
   ...(json===undefined?{}:{body:JSON.stringify(json)})});
 return {status:response.status,body:await response.text()};
}

test('emulator starts with our Phase A rules, never contacts live Firebase',async()=>{
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
test('emulator exposes safe public children to browser and mobile',async()=>{
 for(const branch of publicBranches){
  const result=await request('/floodguard/live/'+branch);
  assert.equal(result.status,200,branch+' '+result.body);
 }
});
test('emulator denies private ESP network data and all ancestors',async()=>{
 for(const path of ['/','/floodguard','/floodguard/live','/floodguard/live/esp8266',
  '/floodguard/live/esp8266/ip','/floodguard/live/esp8266/wifi',
  '/floodguard/bot','/floodguard/test']){
  const result=await request(path);
  assert.ok([401,403].includes(result.status),path+' unexpectedly '+result.status);
 }
});
test('Phase A temporarily permits current anonymous uploads, but validates fields',async()=>{
 const valid=await request('/floodguard/live/water/levelCm',{method:'PUT',json:10});
 assert.equal(valid.status,200,valid.body);
 const invalid=await request('/floodguard/live/water/levelCm',{method:'PUT',json:100});
 assert.ok([401,403].includes(invalid.status),'out of range level accepted');
 const rootWrite=await request('/floodguard/bot/state',{method:'PUT',json:{enabled:false}});
 assert.ok([401,403].includes(rootWrite.status),'bot-state public writes accepted');
});
