// Only synthetic loopback Firebase RTDB emulator. NO live project or key.
import {test,before,after,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {initializeTestEnvironment,assertFails,assertSucceeds}
  from '@firebase/rules-unit-testing';
import {projectPublicTelemetryLabV1,PUBLIC_TELEMETRY_LAB_FIELDS}
  from '../experiments/public-telemetry-leaf-projection-lab.mjs';

if(process.env.FG_PUBLIC_LEAF_LAB!=='1'||
  process.env.FIREBASE_DATABASE_EMULATOR_HOST!=='127.0.0.1:9000')
  throw Error('Leaf isolation lab requires isolated loopback RTDB emulator');
let env;
const root='/floodguard',pub=root+'/publicTelemetryLabV1';
const visitor=()=>env.unauthenticatedContext().database();
const authenticated=()=>env.authenticatedContext('random-client',{admin:true}).database();
async function privileged(fn){
  let result;
  await env.withSecurityRulesDisabled(async ctx=>{
    result=await fn(ctx.database());
  });
  return result;
}
const frame=()=>({
  water:{distanceCm:14.5,levelCm:10.5,status:'WARNING',
    wifi:'TOP-SECRET-TEST',unexpectedPrivateMetadata:'SECRET-TEST'},
  rain:{currentMm:1,dailyMm:11,status:'NORMAL',token:'SYNTHETIC-SECRET'},
  gate:{status:'UNKNOWN',angle:0,countdownSeconds:0,reason:'NONE'},
  alarm:{active:false,type:'SIREN'},
  system:{overallRisk:'UNKNOWN',lastUpdate:1793450000000},
  devices:{arduino:'ONLINE',servo:'UNKNOWN'},
  esp8266:{connection:'ONLINE',rssi:-65,status:'ONLINE',
    ip:'192.0.2.1',wifi:{ssid:'PRIVATE-TEST-SSID'}},
  confirmedIngest:{device:{privateReceipt:'SECRET-TEST'}}
});
before(async()=>{
  env=await initializeTestEnvironment({
    projectId:'demo-fg-public-leaf',
    database:{host:'127.0.0.1',port:9000,
      rules:readFileSync('docs/firebase/public-telemetry-leaf-lab.rules.json','utf8')}
  });
});
after(async()=>{if(env)await env.cleanup();});
beforeEach(async()=>{
  await env.clearDatabase();
  const raw=frame();
  // Firebase SDK's data serializer requires own hasOwnProperty. Convert
  // our deliberately null-prototype whitelist to ordinary JSON scalars.
  const projection=JSON.parse(JSON.stringify(projectPublicTelemetryLabV1(raw)));
  await privileged(db=>db.ref(root).set({
    publicTelemetryLabV1:projection,
    privateIngest:{receipt:'PRIVATE'},
    confirmedIngest:raw.confirmedIngest,
    live:{esp8266:{ip:'PRIVATE',wifi:{ssid:'PRIVATE'}}}
  }));
});
test('anonymous can read ONLY individual approved telemetry scalar leaves',async()=>{
  const expected=projectPublicTelemetryLabV1(frame());
  for(const [group,fields] of Object.entries(expected)){
    for(const [field,value] of Object.entries(fields)){
      assert.ok(PUBLIC_TELEMETRY_LAB_FIELDS[group].includes(field));
      const read=(await assertSucceeds(visitor().ref(
        pub+'/'+group+'/'+field).get())).val();
      assert.deepEqual(read,value);
    }
  }
});
test('all ancestors and complete group objects are denied even when individual leaves are public',async()=>{
  for(const path of [
    '/','/floodguard',pub,
    ...Object.keys(PUBLIC_TELEMETRY_LAB_FIELDS).map(x=>pub+'/'+x)
  ])await assertFails(visitor().ref(path).get());
});
test('unexpected nested private fields remain unreadable even if privileged publisher stores them',async()=>{
  await privileged(db=>db.ref(pub+'/water/wifi').set({ssid:'PRIVATE-TEST'}));
  await privileged(db=>db.ref(pub+'/water/unexpectedPrivateMetadata')
    .set('SECRET-TEST'));
  await privileged(db=>db.ref(pub+'/esp8266/ip').set('192.0.2.1'));
  for(const path of [
    pub+'/water/wifi',pub+'/water/wifi/ssid',
    pub+'/water/unexpectedPrivateMetadata',
    pub+'/rain/token',
    pub+'/esp8266/ip',pub+'/esp8266/wifi',
    root+'/privateIngest',root+'/confirmedIngest',
    root+'/live/esp8266/ip'
  ])await assertFails(visitor().ref(path).get());
  assert.equal((await assertSucceeds(visitor()
    .ref(pub+'/water/distanceCm').get())).val(),14.5);
});
test('anonymous, arbitrary authenticated and forged-claim clients cannot publish or control gate',async()=>{
  for(const db of [visitor(),authenticated()]){
    for(const path of [
      '/',root,pub,pub+'/water',pub+'/water/status',
      pub+'/esp8266/status',root+'/privateIngest',
      root+'/live/gate',root+'/confirmedIngest'
    ])await assertFails(db.ref(path).set({spoof:true}));
    await assertFails(db.ref(pub+'/water/distanceCm').set(1));
    await assertFails(db.ref(pub+'/gate/angle').set(90));
    await assertFails(db.ref(pub+'/alarm/active').set(false));
  }
});
test('public scalar leaf is not a complete authenticated sensor-freshness guarantee',()=>{
  const rules=JSON.parse(
    readFileSync('docs/firebase/public-telemetry-leaf-lab.rules.json','utf8')
  ).rules;
  assert.equal(rules['.write'],false);
  assert.equal(rules.floodguard.publicTelemetryLabV1.water.distanceCm['.read'],true);
  assert.equal(rules.floodguard.publicTelemetryLabV1.water['.read'],undefined);
  // Firebase Admin bypasses database rules: a trusted publisher must still
  // validate that approved public primitive fields are never nested secrets.
});
