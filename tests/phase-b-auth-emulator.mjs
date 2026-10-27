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
      'device-demo-other':{enabled:true,scope:'another-role'},
      'device-stage-a':{enabled:true,scope:'prototype-ingest-v1'},
      'device-stage-b':{enabled:true,scope:'prototype-ingest-v1'},
      'device-stage-revoked':{enabled:false,scope:'prototype-ingest-v1'},
      'device-stage-wrong-scope':{enabled:true,scope:'prototype-primary-telemetry'}
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

/*
 * Stage 5 isolated ingestion lane:
 * A synthetic, versioned private endpoint. This is NOT the currently flashed
 * ESP8266 upload format and is not referenced by the real website/mobile/bot.
 * Emulator auth claims are mocked; they do not prove token issuance or TLS.
 */
const staging='/floodguard/staging/ingestV1';
const stageDevice=(uid,claims={fg_ingest_v1:true})=>env.authenticatedContext(uid,claims).database();
const stageFrame=(sequence,overrides={})=>({sequence,distanceCm:16.5,levelCm:8.5,risk:'WARNING',...overrides});

test('Stage 5 permits only a scoped device claim and matching registry binding for a private frame',async()=>{
  const db=stageDevice('device-stage-a');
  await assertSucceeds(db.ref(staging+'/device-stage-a').set(stageFrame(1)));
  await assertSucceeds(db.ref(staging+'/device-stage-a').set(stageFrame(2,{risk:'SAFE'})));
  let stored;
  await env.withSecurityRulesDisabled(async context=>{
    stored=(await context.database().ref(staging+'/device-stage-a').get()).val();
  });
  if(stored.sequence!==2||stored.risk!=='SAFE')throw Error('Staging frame was not updated');
});

test('Stage 5 rejects anonymous, ordinary, missing-claim, spoofed-role and disabled identities',async()=>{
  for(const db of [
    visitor(), context('ordinary-user'),
    stageDevice('device-stage-a',{}),
    stageDevice('device-stage-a',{fg_ingest_v1:false}),
    stageDevice('ordinary-user'),
    stageDevice('device-stage-revoked'),
    stageDevice('device-stage-wrong-scope'),
    stageDevice('nonexistent-device')
  ]){
    await assertFails(db.ref(staging+'/device-stage-a').set(stageFrame(1)));
  }
});

test('Stage 5 prevents a device accessing another device, registry, production live writes and private reads',async()=>{
  const db=stageDevice('device-stage-a');
  await assertFails(db.ref(staging+'/device-stage-b').set(stageFrame(1)));
  await assertFails(db.ref(staging).set({'device-stage-a':stageFrame(1)}));
  await assertFails(db.ref('/floodguard/staging').set({ingestV1:{'device-stage-a':stageFrame(1)}}));
  await assertFails(db.ref('/floodguard/deviceAuthorization/device-stage-a/enabled').set(false));
  await assertFails(db.ref('/floodguard/live/water/levelCm').set(8.5));
  await assertFails(db.ref('/floodguard/live/esp8266/ip').set('198.51.100.1'));
  await assertFails(db.ref('/floodguard/bot/state').set({active:true}));
  await assertFails(db.ref(staging+'/device-stage-a').get());
  await assertFails(visitor().ref(staging+'/device-stage-a').get());
  await assertFails(visitor().ref(staging).get());
  await assertFails(visitor().ref('/floodguard/staging').get());
});

test('Stage 5 rejects replayed or decreasing sequence and deletion, without losing last accepted frame',async()=>{
  const db=stageDevice('device-stage-a'),ref=db.ref(staging+'/device-stage-a');
  await assertSucceeds(ref.set(stageFrame(5)));
  await assertFails(ref.set(stageFrame(5,{risk:'DANGER'})));
  await assertFails(ref.set(stageFrame(4)));
  await assertFails(ref.remove());
  await assertFails(ref.child('risk').remove());
  await assertFails(ref.child('distanceCm').set(20));
  await assertSucceeds(ref.set(stageFrame(6,{risk:'DANGER'})));
  let stored;
  await env.withSecurityRulesDisabled(async context=>{
    stored=(await context.database().ref(staging+'/device-stage-a').get()).val();
  });
  if(stored.sequence!==6||stored.risk!=='DANGER')throw Error('Replay changed private data');
});

test('Stage 5 rejects missing, unknown, malformed and out-of-range fields, including synthetic commands',async()=>{
  const db=stageDevice('device-stage-a'),ref=db.ref(staging+'/device-stage-a');
  const bad=[
    {sequence:1,distanceCm:10,levelCm:15},
    {sequence:1,distanceCm:10,levelCm:15,risk:'SAFE',gateCommand:'OPEN'},
    stageFrame(1,{extra:'not allowed'}),
    stageFrame(0),stageFrame(-1),stageFrame(2147483648),
    stageFrame('1'),stageFrame(1.5),
    stageFrame(1,{distanceCm:-1}),stageFrame(1,{distanceCm:401}),
    stageFrame(1,{levelCm:26}),stageFrame(1,{levelCm:null}),
    stageFrame(1,{risk:'NORMAL'}),stageFrame(1,{risk:null}),
    stageFrame(1,{risk:{status:'SAFE'}})
  ];
  for(const payload of bad)await assertFails(ref.set(payload));
  await assertSucceeds(ref.set(stageFrame(1)));
  await assertFails(ref.update({sequence:2,risk:'INVALID'}));
  await assertFails(ref.update({'sequence':2,'gateCommand':'OPEN'}));
  await assertFails(db.ref(staging+'/device-stage-b').update({sequence:2}));
});

test('Stage 5 revocation denies further writes while preserving previous synthetic frame',async()=>{
  const db=stageDevice('device-stage-a'),ref=db.ref(staging+'/device-stage-a');
  await assertSucceeds(ref.set(stageFrame(1)));
  await env.withSecurityRulesDisabled(context=>context.database().ref('/floodguard/deviceAuthorization/device-stage-a/enabled').set(false));
  await assertFails(ref.set(stageFrame(2)));
  let stored;
  await env.withSecurityRulesDisabled(async context=>{
    stored=(await context.database().ref(staging+'/device-stage-a').get()).val();
  });
  if(stored.sequence!==1)throw Error('Revoked write changed synthetic data');
});


// Stage 19: every explicitly writable Phase B live leaf must remain denied
// to anonymous, ordinary, revoked and wrong-scope identities. All values,
// UIDs and network names are synthetic; this never uses production Firebase.
const prototypeLeaves = Object.freeze([
  ['water/distanceCm', 15.35],
  ['water/levelCm', 9.65],
  ['water/status', 'WARNING'],
  ['gate/status', 'CLOSED'],
  ['gate/angle', 0],
  ['esp8266/status', 'ONLINE']
]);

test('Stage 19 denies every prototype live leaf to all untrusted writer classes',async()=>{
  const denied=[
    ['anonymous',visitor()],
    ['ordinary',context('ordinary-user')],
    ['revoked',context('device-demo-revoked')],
    ['wrong-scope',context('device-demo-other')],
    ['unregistered',context('no-device-binding')]
  ];
  for(const [identity,db] of denied){
    for(const [leaf,value] of prototypeLeaves){
      await assertFails(db.ref(live+'/'+leaf).set(value));
    }
  }
});

test('Stage 19 revocation stops all six valid live-leaf writes without changing prior data',async()=>{
  const db=context('device-demo-a');
  for(const [leaf,value] of prototypeLeaves){
    await assertSucceeds(db.ref(live+'/'+leaf).set(value));
  }
  await env.withSecurityRulesDisabled(async admin=>{
    await admin.database()
      .ref('/floodguard/deviceAuthorization/device-demo-a/enabled').set(false);
  });
  for(const [leaf,value] of prototypeLeaves){
    await assertFails(db.ref(live+'/'+leaf).set(value));
    await assertFails(db.ref(live+'/'+leaf).remove());
  }
  await env.withSecurityRulesDisabled(async admin=>{
    for(const [leaf,value] of prototypeLeaves){
      const actual=(await admin.database().ref(live+'/'+leaf).get()).val();
      if(actual!==value)throw Error('Revoked identity changed persisted demo telemetry');
    }
  });
});

test('Stage 19 rejects mixed root PATCH and parent PUT after a legitimate child write',async()=>{
  const db=context('device-demo-a');
  await assertSucceeds(db.ref(live+'/water/levelCm').set(9.65));
  // A supported leaf must not elevate its owner to whole-parent, sibling,
  // private metadata, or cross-domain writes.
  await assertFails(db.ref(live).update({
    'water/levelCm':10.5,
    'esp8266/wifi':'EXAMPLE-NONSECRET'
  }));
  await assertFails(db.ref(live+'/water').set({
    levelCm:10.5,status:'WARNING'
  }));
  await assertFails(db.ref(live+'/system').set({
    lastUpdate:1234567890,overallRisk:'LOW'
  }));
  await assertFails(db.ref('/floodguard/deviceAuthorization/device-demo-a').update({
    enabled:false
  }));
  await env.withSecurityRulesDisabled(async admin=>{
    const stored=(await admin.database().ref(live+'/water/levelCm').get()).val();
    if(stored!==9.65)throw Error('Denied mixed PATCH changed demo water level');
  });
});
