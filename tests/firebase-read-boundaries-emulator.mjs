// Actual localhost RTDB emulator against the exact main-branch rule template.
// NO production credentials; fixture data is synthetic.
// This deliberately documents broad public subtree leakage risk as a blocker.
import {test,before,after,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {initializeTestEnvironment,assertSucceeds,assertFails}
  from '@firebase/rules-unit-testing';
if(process.env.FG_READ_BOUNDARY_LAB!=='1'||
  process.env.FIREBASE_DATABASE_EMULATOR_HOST!=='127.0.0.1:9000')
  throw Error('Read boundary test must run on isolated loopback demo emulator');
const template=readFileSync('firebase.rules.json','utf8');
const publicPaths=[
 'water','rain','gate','alarm','devices','system',
 'esp8266/connection','esp8266/rssi','esp8266/status'
];
const privatePaths=[
 '', 'live','live/esp8266','live/esp8266/ip','live/esp8266/wifi',
 'bot','confirmedIngest','staging','projectionControl'
];
const root='/floodguard',live=root+'/live';
let env;
const visitor=()=>env.unauthenticatedContext().database();
const ordinary=()=>env.authenticatedContext('random-user',{admin:true}).database();
async function privileged(fn){
 await env.withSecurityRulesDisabled(async context=>fn(context.database()));
}
before(async()=>{
  env=await initializeTestEnvironment({
    projectId:'demo-fg-read-boundary-audit',
    database:{host:'127.0.0.1',port:9000,rules:template}
  });
});
after(async()=>{if(env)await env.cleanup();});
beforeEach(async()=>{
  await env.clearDatabase();
  await privileged(db=>db.ref(root).set({
    live:{
      water:{distanceCm:16,status:'WARNING'},
      rain:{dailyMm:3,status:'NORMAL'},
      gate:{status:'UNKNOWN',angle:null},
      alarm:{active:false},
      devices:{servo:{status:'UNKNOWN'}},
      system:{lastUpdate:'2026-10-31T10:00:00Z',overallRisk:'UNKNOWN'},
      esp8266:{
        connection:'ONLINE',rssi:-62,status:'ONLINE',
        ip:'TEST-NET-ADDRESS',wifi:{ssid:'PRIVATE-TEST-ONLY'}
      }
    },
    bot:{contacts:{fixture:'NOT-PUBLIC'}},
    confirmedIngest:{record:'NOT-PUBLIC'},
    staging:{record:'NOT-PUBLIC'},
    projectionControl:{record:'NOT-PUBLIC'}
  }));
});
test('anonymous readers get exactly the approved telemetry groups, not their parents',async()=>{
  for(const p of publicPaths){
    const result=await assertSucceeds(visitor().ref(live+'/'+p).get());
    assert.equal(result.exists(),true,p);
  }
  for(const p of privatePaths)
    await assertFails(visitor().ref(root+(p?'/'+p:'')).get());
  await assertFails(visitor().ref('/').get());
});
test('private ESP fields remain denied even with a child-published status',async()=>{
  const pub=(await assertSucceeds(visitor().ref(live+'/esp8266/status').get())).val();
  assert.equal(pub,'ONLINE');
  for(const p of ['esp8266','esp8266/ip','esp8266/wifi','esp8266/wifi/ssid'])
    await assertFails(visitor().ref(live+'/'+p).get());
});
test('anonymous and arbitrary authenticated clients cannot write telemetry, gate or private paths',async()=>{
  for(const db of [visitor(),ordinary()]){
    for(const p of [
      '/','/floodguard','/floodguard/live/water',
      '/floodguard/live/esp8266/status',
      '/floodguard/live/gate','/floodguard/bot/contacts',
      '/floodguard/confirmedIngest'
    ])await assertFails(db.ref(p).set({spoof:true}));
    await assertFails(db.ref(live+'/gate/angle').set(90));
    await assertFails(db.ref(live+'/alarm/active').set(false));
  }
});
test('known limitation: public leaf grants expose all future nested data below that leaf',async()=>{
  await privileged(db=>db.ref(live+'/water/unexpectedPrivateMetadata')
    .set('SYNTHETIC-LEAK-DEMONSTRATION'));
  const leak=await assertSucceeds(visitor()
    .ref(live+'/water/unexpectedPrivateMetadata').get());
  assert.equal(leak.val(),'SYNTHETIC-LEAK-DEMONSTRATION');
  // THIS IS NOT A PASSING PRIVACY DESIGN. It is positive proof that a
  // writer putting sensitive data in the wide-open water subtree exposes it.
  // Do not publish credentials, private measurements or personal data under
  // the old publicly readable group roots.
});
