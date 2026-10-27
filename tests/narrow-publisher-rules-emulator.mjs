// Isolated Firebase RTDB emulator rules proof. No production or hardware.
import {test,before,after,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {initializeTestEnvironment,assertFails,assertSucceeds}
  from '@firebase/rules-unit-testing';

if(process.env.FG_NARROW_PUBLISHER_EMULATOR_TEST!=='1'||
   process.env.FIREBASE_DATABASE_EMULATOR_HOST!=='127.0.0.1:9000')
  throw Error('Narrow publisher checks require loopback RTDB Emulator');

const rules=readFileSync('docs/firebase/phase-b-narrow-publication-lab.rules.json','utf8');
const root='/floodguard',water=root+'/publicationLab/water';
const approved='publisher-water-stage';
const operatorRecord={
  enabled:true,scope:'publication-lab-water-v1',deviceId:'device-stage-a',epoch:1
};
const oldTime=1700000000000,initialDigest='0'.repeat(64);
const snapshot={
  current:{distanceCm:20,levelCm:5,status:'SAFE',
    observedAtMs:oldTime,overallRisk:'UNKNOWN'},
  checkpoint:{initialized:true,deviceId:'device-stage-a',epoch:1,
    sequence:1,digest:initialDigest,observedAtMs:oldTime}
};
const next=(sequence=2,observedAtMs=oldTime+1000)=>({
  current:{distanceCm:16.5,levelCm:8.5,status:'WARNING',
    observedAtMs,overallRisk:'UNKNOWN'},
  checkpoint:{initialized:true,deviceId:'device-stage-a',epoch:1,
    sequence,digest:'a'.repeat(64),observedAtMs}
});
let env;
const authorized=()=>env.authenticatedContext(approved,{fg_publish_water_v1:true}).database();
const anonymous=()=>env.unauthenticatedContext().database();
const device=()=>env.authenticatedContext('device-stage-a',{fg_ingest_v1:true}).database();
const wrongClaim=()=>env.authenticatedContext(approved,{fg_publish_water_v1:false}).database();
const wrongUid=()=>env.authenticatedContext('publisher-other',{fg_publish_water_v1:true}).database();
async function admin(fn){
  await env.withSecurityRulesDisabled(async ctx=>{await fn(ctx.database());});
}
async function readAdmin(path){let val;await admin(async db=>{val=(await db.ref(path).get()).val();});return val;}
async function setAdmin(path,value){await admin(db=>db.ref(path).set(value));}

before(async()=>{
  env=await initializeTestEnvironment({
    projectId:'demo-narrow-publisher',database:{host:'127.0.0.1',port:9000,rules}
  });
});
after(async()=>{if(env)await env.cleanup();});
beforeEach(async()=>{
  await env.clearDatabase();
  await admin(async db=>{
    await db.ref(root).set({
      publisherLabAuthorization:{[approved]:operatorRecord},
      publicationLab:{water:snapshot},
      live:{
        water:{status:'SAFE',distanceCm:20,levelCm:5},
        gate:{status:'CLOSED',angle:0},
        system:{overallRisk:'LOW'},
        esp8266:{ip:'192.0.2.123',wifi:'PRIVATE-TEST'}
      },
      staging:{ingestV1:{'device-stage-a':{
        sequence:1,distanceCm:20,levelCm:5,risk:'SAFE'
      }}},
      confirmedIngest:{'device-stage-a':{status:'SYNTHETIC-ONLY'}},
      bot:{contacts:{'000':'PRIVATE-TEST'}},
      deviceAuthorization:{'device-stage-a':{
        enabled:true,scope:'prototype-ingest-v1'
      }}
    });
  });
});

test('authenticated operator publisher can atomically advance current and private checkpoint',async()=>{
  const db=authorized(),ref=db.ref(water);
  // With an active listener, RTDB transactions have the initial server
  // snapshot. No elevated/root-scoped security context is required.
  let listener;
  await new Promise((resolve,reject)=>{
    listener=snap=>resolve(snap);
    ref.on('value',listener,reject);
  });
  try{
    const result=await ref.transaction(current=>{
      if(!current)return; // never initialize missing checkpoint
      return next();
    },undefined,false);
    assert.equal(result.committed,true);
  }finally{
    ref.off('value',listener);
  }
  assert.deepEqual(await readAdmin(water),next());
  const publicRead=(await anonymous().ref(water+'/current').get()).val();
  assert.deepEqual(publicRead,next().current);
});

test('anonymous clients see only current reading, not full data or checkpoint',async()=>{
  const db=anonymous();
  await assertSucceeds(db.ref(water+'/current').get());
  await assertFails(db.ref(water).get());
  await assertFails(db.ref(water+'/checkpoint').get());
  await assertFails(db.ref(root+'/publisherLabAuthorization').get());
  await assertFails(db.ref(root+'/publicationLab').get());
  await assertFails(db.ref(root+'/live/esp8266/ip').get());
  for(const path of [water,water+'/current',water+'/checkpoint']){
    await assertFails(db.ref(path).set(next()));
  }
});

test('only a dedicated claimed and enrolled publisher identity can write isolated water subtree',async()=>{
  const actors=[
    anonymous(),device(),wrongClaim(),wrongUid(),
    env.authenticatedContext('ordinary-user').database()
  ];
  for(const actor of actors){
    await assertFails(actor.ref(water).set(next()));
    await assertFails(actor.ref(water+'/current/status').set('SAFE'));
  }
  assert.deepEqual(await readAdmin(water),snapshot);
  assert.equal((await authorized().ref(water).get()).exists(),true);
});

test('authorized publisher cannot touch original live, gate, bot, secrets, staging or identity',async()=>{
  const db=authorized();
  const privateBefore=await readAdmin(root);
  for(const path of [
    root,root+'/live/water/status',root+'/live/gate/angle',
    root+'/live/esp8266/ip',root+'/staging/ingestV1/device-stage-a',
    root+'/deviceAuthorization/device-stage-a/enabled',
    root+'/publisherLabAuthorization/'+approved+'/enabled',
    root+'/confirmedIngest/device-stage-a',root+'/bot/contacts'
  ])await assertFails(db.ref(path).set('MALICIOUS-SYNTHETIC'));
  assert.deepEqual(await readAdmin(root),privateBefore);
});

test('anti-replay and clock rollback protections enforced by rules on direct client mutations',async()=>{
  const db=authorized();
  await assertFails(db.ref(water).set(next(1)));
  await assertFails(db.ref(water).set(next(0)));
  await assertFails(db.ref(water).set(next(2,oldTime-1)));
  await assertFails(db.ref(water).set(next(2,oldTime)));
  await assertFails(db.ref(water+'/checkpoint/sequence').set(3));
  await assertFails(db.ref(water+'/current/status').set('DANGER'));
  await assertSucceeds(db.ref(water).set(next(2,oldTime+1000)));
  await assertFails(db.ref(water).set(next(2,oldTime+2000)));
  await assertSucceeds(db.ref(water).set(next(3,oldTime+2000)));
  assert.equal((await readAdmin(water)).checkpoint.sequence,3);
});

test('deletions, malformed structures, unsafe flags and unapproved extra fields are forbidden',async()=>{
  const db=authorized();
  await assertFails(db.ref(water).remove());
  await assertFails(db.ref(water+'/checkpoint').remove());
  await assertFails(db.ref(water+'/current').remove());
  await assertFails(db.ref(water).set({...next(),checkpoint:null}));
  await assertFails(db.ref(water).set({...next(),current:{status:'SAFE'}}));
  await assertFails(db.ref(water).set({...next(),gateCommand:'OPEN'}));
  await assertFails(db.ref(water).set({...next(),current:{...next().current,privateIp:'192.0.2.25'}}));
  await assertFails(db.ref(water).set({...next(),checkpoint:{...next().checkpoint,secret:'test'}}));
  await assertFails(db.ref(water).set({...next(),current:{...next().current,overallRisk:'LOW'}}));
  await assertFails(db.ref(water).set({...next(),current:{...next().current,levelCm:999}}));
  await assertFails(db.ref(water).set({...next(),checkpoint:{...next().checkpoint,deviceId:'device-stage-b'}}));
  await assertFails(db.ref(water).set({...next(),checkpoint:{...next().checkpoint,epoch:2}}));
  assert.deepEqual(await readAdmin(water),snapshot);
});

test('operator revocation blocks claimed publisher without allowing it to reinstate itself',async()=>{
  await setAdmin(root+'/publisherLabAuthorization/'+approved+'/enabled',false);
  await assertFails(authorized().ref(water).set(next()));
  await assertFails(authorized().ref(root+'/publisherLabAuthorization/'+approved+'/enabled').set(true));
  assert.deepEqual(await readAdmin(water),snapshot);
});

test('no initialization from missing state, and operator-owned data is preserved on denial',async()=>{
  await setAdmin(water,null);
  await assertFails(authorized().ref(water).set(next()));
  assert.equal(await readAdmin(water),null);
  await setAdmin(water,snapshot);
  await setAdmin(root+'/publisherLabAuthorization/'+approved+'/scope','other-scope');
  await assertFails(authorized().ref(water).set(next()));
  assert.deepEqual(await readAdmin(water),snapshot);
});

test('strict old live-client read/write contract remains unchanged in experimental rules',()=>{
  const experiment=JSON.parse(rules).rules.floodguard;
  const baseline=JSON.parse(readFileSync(
    'docs/firebase/phase-b-strict-readonly-live.rules.json','utf8'
  )).rules.floodguard;
  for(const k of Object.keys(baseline))
    assert.deepEqual(experiment[k],baseline[k],
      'research fixture must not broaden pre-existing path: '+k);
  assert.equal(experiment.publicationLab.water.current['.read'],true);
  assert.equal(experiment.publisherLabAuthorization['.write'],false);
});
