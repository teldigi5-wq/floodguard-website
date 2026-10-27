// Local emulator only. This is a speculative, unauthorised-to-deploy stricter
// candidate: no writes whatsoever under /floodguard/live. A future trusted,
// separately reviewed projector would be necessary before production use.
import {readFileSync} from 'node:fs';
import {before,after,beforeEach,test} from 'node:test';
import assert from 'node:assert/strict';
import {initializeTestEnvironment,assertFails,assertSucceeds} from '@firebase/rules-unit-testing';

if(process.env.FG_PHASE_B_STRICT_TEST!=='1' ||
   process.env.FIREBASE_DATABASE_EMULATOR_HOST!=='127.0.0.1:9000')
  throw Error('Strict candidate tests require isolated local RTDB emulator');

const rules=readFileSync('docs/firebase/phase-b-strict-readonly-live.rules.json','utf8');
const live='/floodguard/live';
const staging='/floodguard/staging/ingestV1';
const leaves=[
  ['water/distanceCm',15.35],['water/levelCm',9.65],['water/status','WARNING'],
  ['gate/status','CLOSED'],['gate/angle',0],['esp8266/status','ONLINE']
];
let env;
before(async()=>{
  env=await initializeTestEnvironment({
    projectId:'demo-floodguard-strict',database:{host:'127.0.0.1',port:9000,rules}
  });
});
after(async()=>{if(env)await env.cleanup();});
beforeEach(async()=>{
  await env.clearDatabase();
  await env.withSecurityRulesDisabled(async owner=>{
    await owner.database().ref('/floodguard/deviceAuthorization').set({
      'device-live':{enabled:true,scope:'prototype-primary-telemetry'},
      'device-stage':{enabled:true,scope:'prototype-ingest-v1'},
      'device-disabled':{enabled:false,scope:'prototype-ingest-v1'}
    });
    await owner.database().ref(live).set({
      water:{distanceCm:20,levelCm:5,status:'SAFE'},
      rain:{dailyMm:0},gate:{status:'CLOSED',angle:0,countdownSeconds:0},
      alarm:{active:false},devices:{arduino:'ONLINE'},
      system:{overallRisk:'LOW',lastUpdate:1700000000000},
      esp8266:{status:'ONLINE',connection:'CONNECTED',rssi:-50,
        ip:'192.0.2.81',wifi:'SYNTHETIC-PRIVATE'}
    });
  });
});
const db=(uid,claims)=>env.authenticatedContext(uid,claims).database();
const frame=seq=>({sequence:seq,distanceCm:16.5,levelCm:8.5,risk:'WARNING'});

test('every previously authorized legacy live leaf is immutable to all client roles',async()=>{
  const identities=[
    env.unauthenticatedContext().database(),
    db('ordinary-user'),
    db('device-live'),
    db('device-stage',{fg_ingest_v1:true}),
    db('device-disabled',{fg_ingest_v1:true})
  ];
  for(const actor of identities){
    for(const [leaf,value] of leaves){
      await assertFails(actor.ref(live+'/'+leaf).set(value));
      await assertFails(actor.ref(live+'/'+leaf).remove());
    }
  }
  await env.withSecurityRulesDisabled(async owner=>{
    const actual=(await owner.database().ref(live+'/water/levelCm').get()).val();
    assert.equal(actual,5,'denied client operations must preserve last value');
  });
});

test('strict candidate rejects root, parent, mixed and sibling client writes',async()=>{
  for(const actor of [db('device-live'),db('device-stage',{fg_ingest_v1:true})]){
    await assertFails(actor.ref(live).set({water:{levelCm:20}}));
    await assertFails(actor.ref(live+'/water').update({levelCm:20}));
    await assertFails(actor.ref(live).update({'water/levelCm':20,'esp8266/ip':'SYNTHETIC'}));
    await assertFails(actor.ref(live+'/system/overallRisk').set('SAFE'));
    await assertFails(actor.ref(live+'/gate/countdownSeconds').set(10));
    await assertFails(actor.ref('/floodguard/deviceAuthorization/device-stage/enabled').set(false));
  }
});

test('nine existing public monitoring child paths remain readable, private ancestors denied',async()=>{
  const visitor=env.unauthenticatedContext().database();
  for(const child of [
    'water','rain','gate','alarm','devices','system',
    'esp8266/status','esp8266/connection','esp8266/rssi'
  ])await assertSucceeds(visitor.ref(live+'/'+child).get());
  for(const privatePath of [
    live,live+'/esp8266',live+'/esp8266/ip',live+'/esp8266/wifi',
    '/floodguard/deviceAuthorization','/floodguard/staging',
    staging+'/device-stage'
  ])await assertFails(visitor.ref(privatePath).get());
});

test('private staging still allows registered claimed matching device with increasing sequence only',async()=>{
  const writer=db('device-stage',{fg_ingest_v1:true});
  const ref=writer.ref(staging+'/device-stage');
  await assertSucceeds(ref.set(frame(1)));
  await assertFails(ref.set(frame(1)));
  await assertFails(ref.set(frame(0)));
  await assertSucceeds(ref.set(frame(2)));
  await assertFails(ref.remove());
  await assertFails(ref.update({gateCommand:'OPEN',sequence:3}));
  const invalid=[
    env.unauthenticatedContext().database(),
    db('ordinary-user'),db('device-live'),
    db('device-stage'),db('device-stage',{fg_ingest_v1:false}),
    db('device-disabled',{fg_ingest_v1:true})
  ];
  for(const actor of invalid){
    await assertFails(actor.ref(staging+'/device-stage').set(frame(3)));
  }
  await assertFails(writer.ref(staging+'/other-device').set(frame(3)));
  await assertFails(writer.ref(staging).set({'device-stage':frame(3)}));
  await env.withSecurityRulesDisabled(async owner=>{
    const actual=(await owner.database().ref(staging+'/device-stage/sequence').get()).val();
    assert.equal(actual,2);
  });
  await env.withSecurityRulesDisabled(owner=>
    owner.database().ref('/floodguard/deviceAuthorization/device-stage/enabled').set(false)
  );
  await assertFails(ref.set(frame(3)));
});
