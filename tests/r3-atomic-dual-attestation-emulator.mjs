// R3 single-leaf attested-evidence acceptance on REAL loopback RTDB Emulator.
// All keys, authorization claims and telemetry here are synthetic fixtures.
import {test,before,after,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {createHash,generateKeyPairSync,sign,webcrypto} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {initializeTestEnvironment,assertFails}
  from '@firebase/rules-unit-testing';
import {R2_PUBLIC_PROOF_VERSION,canonicalR2PublicEvidence}
  from '../experiments/r2-dual-stream-public-evidence.mjs';
import {R2_ISSUER_RECEIPT_VERSION,canonicalR2PublisherReceipt}
  from '../experiments/r2-attested-dual-stream-publisher.mjs';
import {createR3AtomicDualObserver}
  from '../experiments/r3-atomic-dual-attestation-reader-lab.mjs';

if(process.env.FG_R3_ATOMIC_DUAL_EMULATOR_TEST!=='1'||
   process.env.FIREBASE_DATABASE_EMULATOR_HOST!=='127.0.0.1:9000')
  throw Error('Atomic dual evidence tests require isolated loopback RTDB Emulator');

const root='/floodguard',path=s=>root+'/attestedEvidenceLabV1/'+s;
const now=Date.UTC(2026,9,31,11,0,0);
const streams=['water','rain'];
const keys=Object.fromEntries(streams.map(s=>[s,{
  report:generateKeyPairSync('ed25519'),
  issuer:generateKeyPairSync('ed25519')
}]));
const pins=Object.fromEntries(streams.map(s=>[s,{
  report:keys[s].report.publicKey.export({type:'spki',format:'der'})
    .toString('base64url'),
  issuer:keys[s].issuer.publicKey.export({type:'spki',format:'der'})
    .toString('base64url')
}]));
const hash=s=>createHash('sha256').update(s,'utf8').digest('hex');
const sig=(bytes,k)=>sign(null,Buffer.from(bytes),k.privateKey)
  .toString('base64url');
const id=s=>'r3-'+s+'-attested-publisher';
const claim=s=>'fg_r3_'+s+'_attested';
const scope=s=>'r3-'+s+'-attested-publish-v1';
function evidence(stream,sequence=1){
  const payload={
    version:R2_PUBLIC_PROOF_VERSION,stream,sourceAlias:stream+'-primary',
    epoch:1,sequence,
    observedAtMs:now-3000+sequence,
    receivedAtMs:now-2000+sequence,
    sample:stream==='water'
      ?{distanceCm:16.5,levelCm:8.5,reportedStatus:'WARNING'}
      :{currentMm:2,dailyMm:12,reportedStatus:'NORMAL'}
  };
  const canonical=canonicalR2PublicEvidence(payload);
  const receipt={
    version:R2_ISSUER_RECEIPT_VERSION,stream,
    sourceAlias:stream+'-primary',epoch:1,sequence,
    payloadDigest:hash(canonical),
    acceptedAtMs:payload.receivedAtMs
  };
  return {
    report:{payload,signature:sig(canonical,keys[stream].report)},
    acceptance:{receipt,signature:sig(canonicalR2PublisherReceipt(receipt),
      keys[stream].issuer)}
  };
}
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(condition) {
  for(let i=0;i<150;i++){
    if(condition())return;
    await sleep(10);
  }
  throw Error('Timed out waiting for atomic RTDB listener state');
}
let env;
const readDb=()=>env.unauthenticatedContext().database();
const writer=s=>env.authenticatedContext(id(s),{
  [claim(s)]:true
}).database();
const impostor=s=>env.authenticatedContext('other-'+id(s),{
  [claim(s)]:true
}).database();
async function admin(action) {
  let output;
  await env.withSecurityRulesDisabled(async context=>{
    output=await action(context.database());
  });
  return output;
}
async function seed(){
  await admin(db=>db.ref(root).set({
    attestedEvidenceLabV1:{
      water:evidence('water'),rain:evidence('rain')
    },
    attestedEvidenceLabAuthorization:Object.fromEntries(streams.map(s=>[
      id(s),{enabled:true,scope:scope(s)}
    ])),
    evidenceLabV1:{water:{payload:{private:'OLD-LAB'}}},
    confirmedIngest:{'device-stage-a':{receipt:'PRIVATE'}},
    staging:{'device-stage-a':{secret:'PRIVATE'}},
    live:{gate:{status:'CLOSED',angle:0},esp8266:{
      ip:'192.0.2.1',wifi:'TEST-PRIVATE'
    }},
    bot:{contacts:{test:'PRIVATE'}}
  }));
}
function view() {
  const db=readDb(),paths=[],listeners=[],events=[];
  const subscribe=(location,onValue,onError)=>{
    paths.push(location);
    if(location==='.info/connected'){
      onValue(true);
      return ()=>{};
    }
    if(!streams.some(s=>location===path(s)))
      throw Error('Out-of-scope subscription path');
    const reference=db.ref(location);
    const fn=snapshot=>onValue(snapshot.val());
    reference.on('value',fn,onError);
    listeners.push(reference);
    return ()=>reference.off('value',fn);
  };
  const observer=createR3AtomicDualObserver({
    subscribe,pins,subtle:webcrypto.subtle,clock:()=>now,
    onChange:state=>events.push(state)
  });
  return {db,paths,events,handle:observer.start()};
}
before(async()=>{
  const rules=readFileSync(
    'docs/firebase/r3-atomic-dual-attestation-lab.rules.json','utf8'
  );
  env=await initializeTestEnvironment({
    projectId:'demo-fg-r3-atomic',
    database:{host:'127.0.0.1',port:9000,rules}
  });
});
after(async()=>{if(env)await env.cleanup();});
beforeEach(async()=>{await env.clearDatabase();await seed();});

test('anonymous reads exact two atomic leaves and validates both signatures',async()=>{
  const x=view();
  try{
    await until(()=>x.handle.snapshot().water.status==='signed-lab-only'&&
      x.handle.snapshot().rain.status==='signed-lab-only');
    const snapshot=x.handle.snapshot();
    assert.deepEqual(x.paths,['.info/connected',path('water'),path('rain')]);
    assert.equal(snapshot.water.report.sequence,1);
    assert.equal(snapshot.rain.report.sequence,1);
    assert.equal(snapshot.productionBackendVerified,false);
    assert.equal(snapshot.physicalSafetyVerified,false);
    assert.equal(JSON.stringify(snapshot).includes('TEST-PRIVATE'),false);
    for(const denied of [root,root+'/attestedEvidenceLabV1',
      root+'/attestedEvidenceLabAuthorization',root+'/confirmedIngest',
      root+'/staging',root+'/live/gate',root+'/live/esp8266/ip',
      root+'/bot',root+'/evidenceLabV1'])
      await assertFails(x.db.ref(denied).get());
  }finally{x.handle.close();}
});

test('scoped publisher advances only own whole leaf; rules reject wrong identity and replay',async()=>{
  const x=view(),snapshot=await admin(async db=>(await db.ref(root).get()).val());
  try{
    await until(()=>x.handle.snapshot().water.status==='signed-lab-only');
    const valid=evidence('water',2);
    await writer('water').ref(path('water')).set(valid);
    await until(()=>x.handle.snapshot().water.status==='signed-lab-only'&&
      x.handle.snapshot().water.report.sequence===2);
    assert.equal(x.handle.snapshot().rain.report.sequence,1);
    await assertFails(writer('water').ref(path('rain')).set(evidence('rain',2)));
    await assertFails(impostor('water').ref(path('water')).set(evidence('water',3)));
    await assertFails(writer('water').ref(path('water')).set(valid));
    await assertFails(writer('water').ref(path('water')).set(evidence('water',1)));
    await assertFails(writer('water').ref(root+'/live/gate').set({status:'OPEN'}));
    const after=await admin(async db=>(await db.ref(root).get()).val());
    for(const field of ['confirmedIngest','staging','live','bot',
      'attestedEvidenceLabAuthorization','evidenceLabV1'])
      assert.deepEqual(after[field],snapshot[field],field);
  }finally{x.handle.close();}
});

test('a client cannot write missing receipt, extra metadata or split children',async()=>{
  for(const s of streams){
    const record=evidence(s,2);
    await assertFails(writer(s).ref(path(s)).set({report:record.report}));
    await assertFails(writer(s).ref(path(s)).set({
      ...record,gateCommand:'OPEN'
    }));
    await assertFails(writer(s).ref(path(s)).set({
      ...record,acceptance:{...record.acceptance,
        receipt:{...record.acceptance.receipt,privateIp:'192.0.2.1'}}
    }));
    await assertFails(writer(s).ref(path(s)).set({
      ...record,acceptance:{...record.acceptance,
        receipt:{...record.acceptance.receipt,sequence:999}}
    }));
    await assertFails(writer(s).ref(path(s)+'/report').set(record.report));
    await assertFails(writer(s).ref(path(s)+'/acceptance').set(record.acceptance));
    await assertFails(writer(s).ref(path(s)).remove());
  }
});

test('direct credential can submit forged signatures but browser verifies and refuses them',async()=>{
  const x=view();
  try {
    await until(()=>x.handle.snapshot().water.status==='signed-lab-only'&&
      x.handle.snapshot().rain.status==='signed-lab-only');
    const forged=evidence('water',2);
    forged.acceptance.signature='A'.repeat(86);
    // This demonstrates the live security blocker: Firebase Rules verify
    // shape and auth claim, NOT Ed25519 cryptography. Never deploy a broad
    // scoped publisher credential or mistake Rules for issuer verification.
    await writer('water').ref(path('water')).set(forged);
    await until(()=>x.handle.snapshot().water.status==='invalid');
    assert.equal(x.handle.snapshot().water.reason,'issuer-signature-unverified');
    assert.equal(x.handle.snapshot().rain.status,'signed-lab-only');
    assert.equal(x.handle.snapshot().physicalSafetyVerified,false);
  }finally{x.handle.close();}
});

test('source-alias, epoch and acceptance clock cannot diverge in atomic write',async()=>{
  const e=evidence('rain',2);
  for(const delta of [
    {epoch:2},
    {sourceAlias:'water-primary'},
    {acceptedAtMs:e.acceptance.receipt.acceptedAtMs+7}
  ]){
    const altered={...e,acceptance:{...e.acceptance,
      receipt:{...e.acceptance.receipt,...delta}}};
    await assertFails(writer('rain').ref(path('rain')).set(altered));
  }
});

test('anonymous writes, parent writes and private reads are all denied',async()=>{
  const db=readDb();
  await assertFails(db.ref(path('water')).set(evidence('water',2)));
  await assertFails(db.ref(path('rain')).remove());
  await assertFails(writer('water').ref(root+'/attestedEvidenceLabV1').set({
    water:evidence('water',2),rain:evidence('rain',2)
  }));
  await assertFails(db.ref(root+'/confirmedIngest').get());
});
