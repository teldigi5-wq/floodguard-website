// H25: real Firebase JS SDK subscriptions in disposable loopback Chromium.
// The test driver writes synthetic data ONLY to the fixed local demo emulator.
import test, {before,after} from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';

const SITE='http://127.0.0.1:4173';
const EMULATOR='http://127.0.0.1:19001';
const NAMESPACE='demo-floodguard-r3-default-rtdb';
let browser;

function guard() {
  assert.equal(process.env.FG_H25_BROWSER_LAB,'1');
  assert.equal(process.env.FIREBASE_DATABASE_EMULATOR_HOST,'127.0.0.1:19001');
  assert.equal(process.env.GCLOUD_PROJECT,'demo-floodguard-r3');
  assert.equal(new URL(SITE).hostname,'127.0.0.1');
  assert.equal(new URL(EMULATOR).hostname,'127.0.0.1');
}
function emulatorURL(path) {
  guard();
  assert.match(path,/^floodguard\/live(?:\/[a-zA-Z0-9_-]+)*$/);
  return EMULATOR+'/'+path+'.json?ns='+NAMESPACE;
}
async function adminPut(path,value) {
  const response=await fetch(emulatorURL(path),{
    method:'PUT',redirect:'error',
    headers:{authorization:'Bearer owner','content-type':'application/json'},
    signal:AbortSignal.timeout(8000),
    body:JSON.stringify(value)
  });
  assert.equal(response.status,200,'Synthetic emulator-only write rejected on '+path);
  await response.arrayBuffer();
}
function fixture() {
  return {
    water:{distanceCm:20,levelCm:5,status:'SAFE'},
    rain:{status:'NORMAL',currentMm:0,dailyMm:0,rawValue:400,sensorStatus:'ONLINE'},
    gate:{status:'CLOSED',angle:0,countdownSeconds:0},
    alarm:{active:false,type:'NONE'},
    devices:{arduino:'ONLINE',servo:'ONLINE',rainGauge:'ONLINE'},
    system:{overallRisk:'LOW',lastUpdate:Date.now()},
    esp8266:{
      status:'ONLINE',connection:'CONNECTED',rssi:-62,
      ip:'192.0.2.99',wifi:'SYNTHETIC_PRIVATE_WIFI_NEVER_PUBLIC'
    }
  };
}
async function visit(path) {
  const context=await browser.newContext({
    serviceWorkers:'block',
    viewport:{width:1280,height:900},
    reducedMotion:'reduce'
  });
  const blocked=[],websockets=[],errors=[];
  await context.route('**/*',async route=>{
    const u=new URL(route.request().url());
    const allowed=u.protocol==='http:' && u.hostname==='127.0.0.1'
      && ['4173','19001'].includes(u.port);
    if(allowed)return route.continue();
    blocked.push(u.origin);
    return route.abort('blockedbyclient');
  });
  const page=await context.newPage();
  page.setDefaultTimeout(15000);
  page.on('websocket',socket=>websockets.push(socket.url()));
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto(SITE+path,{waitUntil:'domcontentloaded'});
  return {page,context,blocked,websockets,errors};
}
async function finish(ctx){
  const {context,blocked,websockets,errors}=ctx;
  await context.close();
  assert.deepEqual(blocked,[],'Unexpected outbound browser HTTP request');
  assert.deepEqual(errors,[],'Client-side runtime exceptions');
  assert.ok(websockets.every(url=>{
    const u=new URL(url);
    return u.protocol==='ws:' && u.hostname==='127.0.0.1' && u.port==='19001';
  }),'Nonemulator websocket attempted: '+JSON.stringify(websockets));
}
async function settled(page,locator,text) {
  await page.waitForFunction(({selector,needle})=>
    document.querySelector(selector)?.textContent?.includes(needle)===true,
    {selector:locator,needle:text},{timeout:15000});
}

before(async()=>{guard();browser=await chromium.launch({headless:true});});
after(async()=>{if(browser)await browser.close();});

test('real SDK subscribes to public child paths, normalizes ONLINE reports, never leaks ESP private fields',async()=>{
  await adminPut('floodguard/live',fixture());
  const c=await visit('/devices/');
  try{
    await settled(c.page,'.network dl','REPORTED ONLINE · UNVERIFIED');
    const network=await c.page.locator('.network').innerText();
    assert.match(network,/REPORTED ONLINE · UNVERIFIED/);
    assert.match(network,/-62 dBm/);
    const body=await c.page.locator('body').innerText();
    assert.doesNotMatch(body,/SYNTHETIC_PRIVATE_WIFI_NEVER_PUBLIC|192\.0\.2\.99/);
    assert.match(body,/physical link unverified/i);
  }finally{await finish(c);}
});

test('real SDK child update containing ESP status/connection contradiction revokes ONLINE and cached RSSI',async()=>{
  await adminPut('floodguard/live',fixture());
  const c=await visit('/devices/');
  try{
    await settled(c.page,'.network dl','REPORTED ONLINE · UNVERIFIED');
    await adminPut('floodguard/live/esp8266/connection','DISCONNECTED');
    await settled(c.page,'.network dl','UNKNOWN · SOURCE UNVERIFIED');
    const network=await c.page.locator('.network dl').innerText();
    assert.doesNotMatch(network,/REPORTED ONLINE|-62 dBm/);
    await adminPut('floodguard/live/esp8266/connection','CONNECTED');
    await settled(c.page,'.network dl','REPORTED ONLINE · UNVERIFIED');
    assert.match(await c.page.locator('.network').innerText(),/-62 dBm/);
  }finally{await finish(c);}
});

test('real SDK rain sensor fault withholds existing zero readings and cannot claim normal',async()=>{
  await adminPut('floodguard/live',fixture());
  const c=await visit('/rainfall/');
  try{
    const metric=c.page.locator('.metric').filter({hasText:'Current rainfall report'}).first();
    await c.page.waitForFunction(()=>
      [...document.querySelectorAll('.metric')].some(m=>
        m.textContent?.includes('Current rainfall report') && m.textContent?.includes('0.0 mm')),
      {timeout:15000});
    assert.match(await metric.innerText(),/0\.0 mm/);
    await adminPut('floodguard/live/rain/sensorStatus','OFFLINE');
    await c.page.waitForFunction(()=>
      [...document.querySelectorAll('.metric')].some(m=>
        m.textContent?.includes('Current rainfall report') && m.textContent?.includes('Unavailable')),
      {timeout:15000});
    const body=await c.page.locator('#main-content').innerText();
    assert.match(body,/SENSOR UNAVAILABLE|UNKNOWN/);
    assert.doesNotMatch(await metric.innerText(),/0\.0 mm/);
  }finally{await finish(c);}
});

test('real SDK gate status/angle contradiction revokes CLOSED; stale timestamp revokes all current source claims',async()=>{
  await adminPut('floodguard/live',fixture());
  const c=await visit('/dashboard/');
  try{
    const gate=c.page.locator('.metric').filter({hasText:'Gate report'}).first();
    await settled(c.page,'.dashboard-page','REPORTED CLOSED · UNVERIFIED');
    await adminPut('floodguard/live/gate/status','OPEN');
    await c.page.waitForFunction(()=>
      [...document.querySelectorAll('.metric')].some(m=>m.textContent?.includes('Gate report') &&
        m.textContent?.includes('UNKNOWN · UNVERIFIED')),
      {timeout:15000});
    assert.doesNotMatch(await gate.innerText(),/REPORTED CLOSED|REPORTED OPEN/);
    await adminPut('floodguard/live/system/lastUpdate',0);
    await settled(c.page,'.dashboard-page','CURRENT POSITION UNKNOWN');
    const current=await c.page.locator('.dashboard-page').innerText();
    assert.match(current,/UNKNOWN|UNAVAILABLE|NOT CURRENT/);
    assert.doesNotMatch(current,/Current physical flood risk\s+LOW/);
  }finally{await finish(c);}
});

test('real SDK active alarm remains unsigned; stale active alarm becomes historical status, not live alert',async()=>{
  await adminPut('floodguard/live',fixture());
  const c=await visit('/');
  try{
    await settled(c.page,'.status-dock','Recent DB record');
    await adminPut('floodguard/live/alarm/active',true);
    const banner=c.page.locator('.global-alarm');
    await banner.waitFor({state:'visible'});
    assert.equal(await banner.getAttribute('role'),'alert');
    assert.match(await banner.innerText(),/REPORTED ACTIVE · UNVERIFIED/);
    await adminPut('floodguard/live/system/lastUpdate',0);
    await c.page.waitForFunction(()=>
      document.querySelector('.global-alarm')?.getAttribute('role')==='status',
      {timeout:15000});
    assert.match(await banner.innerText(),/LAST REPORTED ACTIVE · NOT CURRENT/);
    assert.match(await banner.innerText(),/notification delivery unverified/);
  }finally{await finish(c);}
});
