// Actual Firebase Realtime Database Emulator subscription integration.
// Synthetic Ed25519 keys and report records only; no production database.
import {test,before,after,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign,webcrypto} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {initializeTestEnvironment,assertFails}
  from '@firebase/rules-unit-testing';
import {R2_PUBLIC_PROOF_VERSION,canonicalR2PublicEvidence}
  from '../experiments/r2-dual-stream-public-evidence.mjs';
import {createR3ReadOnlyEvidenceObserver}
  from '../experiments/r3-browser-readonly-evidence-lab.mjs';

if(process.env.FG_R3_READONLY_EMULATOR_TEST!=='1'||
   process.env.FIREBASE_DATABASE_EMULATOR_HOST!=='127.0.0.1:9000')
  throw Error('R3 reader integration requires loopback-only Firebase emulator');

const now=Date.UTC(2026,9,31,1,0,0);
const root='/floodguard';
const paths={water:root+'/evidenceLabV1/water',
  rain:root+'/evidenceLabV1/rain'};
const keys={water:generateKeyPairSync('ed25519'),
  rain:generateKeyPairSync('ed25519')};
const pins=Object.fromEntries(Object.entries(keys).map(([s,pair])=>[
  s,pair.publicKey.export({type:'spki',format:'der'}).toString('base64url')
]));
const sample=s=>s==='water'
  ?{distanceCm:15.5,levelCm:9.5,reportedStatus:'WARNING'}
  :{currentMm:3,dailyMm:14,reportedStatus:'NORMAL'};
const signed=(s,seq=1)=> {
  const payload={
    version:R2_PUBLIC_PROOF_VERSION,stream:s,
    sourceAlias:s+'-primary',epoch:1,sequence:seq,
    observedAtMs:now-3000+seq,receivedAtMs:now-2000+seq,
    sample:sample(s)
  };
  return {
    payload,signature:sign(null,Buffer.from(canonicalR2PublicEvidence(payload)),
      keys[s].privateKey).toString('base64url')
  };
};
let env;
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(p){
  for(let i=0;i<120;i++){
    if(p())return;
    await sleep(10);
  }
  throw Error('Timed out awaiting Firebase event');
}
async function admin(f){
  await env.withSecurityRulesDisabled(async context=>f(context.database()));
}
function reader(){
  const events=[],connected=()=>true;
  const db=env.unauthenticatedContext().database();
  const observedPaths=[];
  const subscribe=(path,onValue,onError)=>{
    observedPaths.push(path);
    if(path==='.info/connected'){
      onValue(connected());
      return ()=>{};
    }
    if(!Object.values(paths).includes(path))
      throw Error('Unexpected RTDB path');
    const reference=db.ref(path);
    const callback=snapshot=>onValue(snapshot.val());
    reference.on('value',callback,onError);
    return ()=>reference.off('value',callback);
  };
  const observer=createR3ReadOnlyEvidenceObserver({
    subscribe,spkiPins:pins,subtle:webcrypto.subtle,
    clock:()=>now,onChange:state=>events.push(state)
  });
  return {handle:observer.start(),db,events,observedPaths};
}
before(async()=>{
  const rules=readFileSync(
    'docs/firebase/r2-dual-stream-public-evidence-lab.rules.json','utf8'
  );
  env=await initializeTestEnvironment({
    projectId:'demo-fg-r3-readonly',
    database:{host:'127.0.0.1',port:9000,rules}
  });
});
after(async()=>{if(env)await env.cleanup();});
beforeEach(async()=>{
  await env.clearDatabase();
  await admin(db=>db.ref(root).set({
    evidenceLabV1:{water:signed('water'),rain:signed('rain')},
    confirmedIngest:{'device-stage-a':{secret:'TEST-PRIVATE'}},
    staging:{ingestV1:{'device-stage-a':{secret:'PRIVATE'}}},
    evidenceLabAuthorization:{'r2-water-publisher':{
      enabled:true,scope:'r2-water-publish-v1'
    }},
    bot:{contacts:{test:'PRIVATE'}},
    live:{esp8266:{ip:'192.0.2.12',wifi:'PRIVATE'},
      gate:{status:'CLOSED',angle:0},system:{overallRisk:'LOW'}}
  }));
});

test('anonymous RTDB leaf listeners verify both independent signed streams',async()=>{
  const x=reader();
  try{
    await until(()=>x.handle.snapshot().water.status==='report-only'&&
      x.handle.snapshot().rain.status==='report-only');
    const state=x.handle.snapshot();
    assert.equal(state.water.report.levelCm,9.5);
    assert.equal(state.rain.report.dailyMm,14);
    assert.equal(state.physicalSafetyVerified,false);
    assert.equal(state.backendReceiptVerified,false);
    assert.deepEqual(x.observedPaths,['.info/connected',paths.water,paths.rain]);
    assert.equal(JSON.stringify(state).includes('192.0.2.12'),false);
    assert.equal(JSON.stringify(state).includes('TEST-PRIVATE'),false);
    for(const denied of [root,root+'/evidenceLabV1',
      root+'/confirmedIngest',root+'/staging',root+'/live/esp8266/ip',
      root+'/live/gate',root+'/bot/contacts',
      root+'/evidenceLabAuthorization'])
      await assertFails(x.db.ref(denied).get());
  }finally{x.handle.close();}
});

test('forged water payload after valid update fails closed without erasing verified rain',async()=>{
  const x=reader();
  try{
    await until(()=>x.handle.snapshot().water.status==='report-only'&&
      x.handle.snapshot().rain.status==='report-only');
    const forged=signed('water',2);
    forged.signature='A'.repeat(86);
    await admin(db=>db.ref(paths.water).set(forged));
    await until(()=>x.handle.snapshot().water.status==='invalid');
    assert.equal(x.handle.snapshot().water.reason,'report-signature-unverified');
    assert.equal(x.handle.snapshot().rain.status,'report-only');
    assert.equal(x.handle.snapshot().physicalSafetyVerified,false);
  }finally{x.handle.close();}
});

test('newly signed source sequence updates water only, and replay becomes invalid',async()=>{
  const x=reader();
  try{
    await until(()=>x.handle.snapshot().water.status==='report-only'&&
      x.handle.snapshot().rain.status==='report-only');
    const next=signed('water',2);
    await admin(db=>db.ref(paths.water).set(next));
    await until(()=>x.handle.snapshot().water.status==='report-only'&&
      x.handle.snapshot().water.report.sequence===2);
    assert.equal(x.handle.snapshot().rain.report.sequence,1);
    // Explicit privileged restore for negative testing; rules would block
    // an unprivileged scoped publisher from decreasing a sequence.
    await admin(db=>db.ref(paths.water).set(signed('water',1)));
    await until(()=>x.handle.snapshot().water.status==='invalid');
    assert.equal(x.handle.snapshot().water.reason,'source-not-current');
    assert.equal(x.handle.snapshot().rain.status,'report-only');
  }finally{x.handle.close();}
});

test('anonymous subscriber is read-only and cannot write any evidence or private branch',async()=>{
  const x=reader();
  try{
    await assertFails(x.db.ref(paths.water).set(signed('water',3)));
    await assertFails(x.db.ref(paths.rain).remove());
    await assertFails(x.db.ref(root+'/live/gate/angle').set(90));
    await assertFails(x.db.ref(root+'/confirmedIngest').set({
      forged:true
    }));
  }finally{x.handle.close();}
});
