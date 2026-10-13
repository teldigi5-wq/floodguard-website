import { readFileSync } from 'node:fs';
import { before, after, beforeEach, test } from 'node:test';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';

if(process.env.FG_PHASE_B_TEST !== '1' || process.env.FIREBASE_DATABASE_EMULATOR_HOST !== '127.0.0.1:9000') {
  throw Error('Phase B tests require the isolated local RTDB Emulator');
}
const rules = readFileSync('docs/firebase/phase-b-authenticated-prototype.rules.json','utf8');
const live='/floodguard/live';
let env;
before(async()=>{
  env=await initializeTestEnvironment({projectId:'demo-floodguard',database:{host:'127.0.0.1',port:9000,rules}});
});
after(async()=>{if(env)await env.cleanup();});
beforeEach(async()=>{
  await env.clearDatabase();
  await env.withSecurityRulesDisabled(async context=>{
    await context.database().ref('/floodguard/deviceAuthorization').set({
      'device-demo-a':{enabled:true,scope:'prototype-primary-telemetry'},
      'device-demo-revoked':{enabled:false,scope:'prototype-primary-telemetry'},
      'device-demo-other':{enabled:true,scope:'another-role'}
    });
  });
});
const context=uid=>env.authenticatedContext(uid).database();
const visitor=()=>env.unauthenticatedContext().database();
test('allow only explicitly authorized leaf-level device readings',async()=>{
  const db=context('device-demo-a');
  for(const [path,value] of Object.entries({
    'water/distanceCm':15.35,'water/levelCm':9.65,
    'water/status':'WARNING','gate/status':'CLOSED',
    'gate/angle':0,'esp8266/status':'ONLINE'
  }))await assertSucceeds(db.ref(live+'/'+path).set(value));
});
test('reject anonymous, ordinary, revoked and unauthorized device writers',async()=>{
  const clients=[visitor(),context('ordinary-user'),context('device-demo-revoked'),context('device-demo-other')];
  for(const db of clients){
    await assertFails(db.ref(live+'/water/levelCm').set(9));
    await assertFails(db.ref(live+'/esp8266/status').set('ONLINE'));
  }
});
test('reject parent overwrites, mixed updates and private metadata',async()=>{
  const db=context('device-demo-a');
  await assertFails(db.ref(live).set({water:{levelCm:10}}));
  await assertFails(db.ref(live+'/water').set({levelCm:10}));
  await assertFails(db.ref(live+'/esp8266').set({status:'ONLINE'}));
  await assertFails(db.ref(live).update({'water/levelCm':10,'esp8266/ip':'192.0.2.22'}));
  for(const p of ['esp8266/ip','esp8266/wifi','water/debug','system/lastUpdate','rain/currentMm','alarm/active']){
    await assertFails(db.ref(live+'/'+p).set('unexpected'));
  }
  await assertFails(db.ref('/floodguard/deviceAuthorization/device-demo-a/enabled').set(false));
  await assertFails(db.ref('/floodguard/bot/state').set({active:true}));
});
test('reject deletions and invalid sensor values',async()=>{
  const db=context('device-demo-a');
  await assertSucceeds(db.ref(live+'/water/levelCm').set(10));
  await assertFails(db.ref(live+'/water/levelCm').remove());
  await assertFails(db.ref(live+'/water/levelCm').set(100));
  await assertFails(db.ref(live+'/water/distanceCm').set(-2));
  await assertFails(db.ref(live+'/water/status').set('FABRICATED'));
  await assertFails(db.ref(live+'/gate/angle').set(180));
  await assertFails(db.ref(live+'/esp8266/status').set('SECRET'));
});
test('preserve public child reads, deny private and ancestor reads',async()=>{
  await env.withSecurityRulesDisabled(context=>context.database().ref(live).set({
    water:{levelCm:12.3},gate:{status:'CLOSED'},
    esp8266:{status:'ONLINE',ip:'192.0.2.8',wifi:'EXAMPLE-ONLY'}
  }));
  const db=visitor();
  await assertSucceeds(db.ref(live+'/water').get());
  await assertSucceeds(db.ref(live+'/gate').get());
  await assertSucceeds(db.ref(live+'/esp8266/status').get());
  await assertFails(db.ref(live).get());
  await assertFails(db.ref(live+'/esp8266').get());
  await assertFails(db.ref(live+'/esp8266/ip').get());
  await assertFails(db.ref(live+'/esp8266/wifi').get());
});
