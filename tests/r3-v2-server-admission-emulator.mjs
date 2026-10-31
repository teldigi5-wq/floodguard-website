// Actual isolated Firebase Realtime Database emulator. All signatures,
// identities, reports and timestamps are SYNTHETIC. No production deployment.
import {test,before,after,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {createHash,generateKeyPairSync,sign,webcrypto} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {initializeTestEnvironment,assertFails}
  from '@firebase/rules-unit-testing';
import {V2_OBSERVATION,V2_ADMISSION,canonicalR3V2Observation,
  canonicalR3V2Admission,verifyR3V2Envelope}
  from '../experiments/r3-v2-admission-contract-lab.mjs';
import {createR3V2AdmissionGatewayLab}
  from '../experiments/r3-v2-server-admission-gate-lab.mjs';

if(process.env.FG_R3_V2_ADMISSION_LAB_TEST!=='1'||
   process.env.FIREBASE_DATABASE_EMULATOR_HOST!=='127.0.0.1:9000')
  throw Error('R3 V2 requires loopback emulator and explicit lab flag');
const NOW=Date.UTC(2026,9,31,15,50);
const root='/floodguard',streams=['water','rain'];
const path=s=>root+'/attestedEvidenceLabV2/'+s;
const uid=s=>'r3-v2-'+s+'-writer';
const claim=s=>'fg_r3_v2_'+s+'_write';
const pins=Object.fromEntries(streams.map(s=>[s,{
  report:generateKeyPairSync('ed25519'),
  issuer:generateKeyPairSync('ed25519')
}]));
const pinnedSpki=s=>({
  report:pins[s].report.publicKey.export({format:'der',type:'spki'})
    .toString('base64url'),
  issuer:pins[s].issuer.publicKey.export({format:'der',type:'spki'})
    .toString('base64url')
});
const hash=t=>createHash('sha256').update(t,'utf8').digest('hex');
const signIt=(s,role,t)=>sign(null,Buffer.from(t),
  pins[s][role].privateKey).toString('base64url');
const reg=()=>Object.fromEntries(streams.map(s=>[s,{
  epoch:1,enabled:true,
  report:pins[s].report.publicKey,issuer:pins[s].issuer.publicKey
}]));
function report(s,sequence=2,over={}) {
  const payload={
    version:V2_OBSERVATION,stream:s,sourceAlias:s+'-primary',
    epoch:1,sequence,observedAtMs:NOW-2000+sequence,
    sample:s==='water'
      ?{distanceCm:16,levelCm:9,reportedStatus:'WARNING'}
      :{currentMm:2,dailyMm:13,reportedStatus:'NORMAL'},
    ...over
  };
  return {payload,signature:signIt(s,'report',
    canonicalR3V2Observation(payload))};
}
function seed(s){
  const rec=report(s,1,{observedAtMs:NOW-5000});
  const receipt={
    version:V2_ADMISSION,stream:s,sourceAlias:s+'-primary',
    epoch:1,sequence:1,reportDigest:hash(
      canonicalR3V2Observation(rec.payload)),
    admittedAtMs:NOW-4000
  };
  return {report:rec,admission:{
    receipt,signature:signIt(s,'issuer',
      canonicalR3V2Admission(receipt))
  }};
}
let env;
async function admin(work){
  let value;
  await env.withSecurityRulesDisabled(async c=>{value=await work(c.database());});
  return value;
}
const read=p=>admin(async db=>(await db.ref(p).get()).val());
const writer=s=>env.authenticatedContext(uid(s),{[claim(s)]:true}).database();
const gateway=(override={})=>createR3V2AdmissionGatewayLab({
  registry:reg(),clock:()=>NOW,
  signAdmission:async(s,canonical)=>signIt(s,'issuer',canonical),
  databaseForStream:writer,...override
});
before(async()=>{
  const rules=readFileSync('docs/firebase/r3-v2-admission-emulator.rules.json','utf8');
  env=await initializeTestEnvironment({
    projectId:'demo-fg-r3-v2-admission',
    database:{host:'127.0.0.1',port:9000,rules}
  });
});
after(async()=>{if(env)await env.cleanup();});
beforeEach(async()=>{
  await env.clearDatabase();
  await admin(db=>db.ref(root).set({
    attestedEvidenceLabV2:{water:seed('water'),rain:seed('rain')},
    v2AdmissionAuthorization:Object.fromEntries(streams.map(s=>[uid(s),{
      enabled:true,scope:'r3-v2-'+s+'-admit-v1'
    }])),
    live:{esp8266:{ip:'192.0.2.10',wifi:'TEST-PRIVATE'},
      gate:{angle:0,status:'CLOSED'}},
    confirmedIngest:{test:{secret:'PRIVATE'}},
    staging:{test:{secret:'PRIVATE'}},
    bot:{contacts:{test:'PRIVATE'}}
  }));
});
test('V2 gateway stamps and signs only server admission time in each public leaf',async()=>{
  const before=await read(root),gate=gateway();
  for(const s of streams){
    const out=await gate.publish({stream:s,record:report(s)});
    assert.equal(out.published,true);
    const result=(await env.unauthenticatedContext().database()
      .ref(path(s)).get()).val();
    assert.equal(result.admission.receipt.admittedAtMs,NOW);
    assert.equal(Object.hasOwn(result.report.payload,'receivedAtMs'),false);
    assert.equal(Object.hasOwn(result.report.payload,'admittedAtMs'),false);
    assert.equal((await verifyR3V2Envelope({
      stream:s,envelope:result,pins:pinnedSpki(s),
      subtle:webcrypto.subtle,connected:true,nowMs:NOW
    })).verified,true);
  }
  const after=await read(root);
  for(const s of ['live','staging','bot','confirmedIngest',
    'v2AdmissionAuthorization'])
    assert.deepEqual(after[s],before[s]);
});
test('scoped Firebase Rules accept only rising sequence and signed-time-shaped envelope',async()=>{
  const first=gateway();
  assert.equal((await first.publish({
    stream:'water',record:report('water')
  })).published,true);
  const db=writer('water');
  await assertFails(db.ref(path('water')).set(seed('water')));
  await assertFails(db.ref(path('rain')).set(seed('rain')));
  await assertFails(db.ref(path('water')+'/report').set(report('water',3)));
  await assertFails(db.ref(path('water')).remove());
  await assertFails(db.ref(root+'/live/gate').set({status:'OPEN'}));
});
test('forged scoped publisher can inject malformed signature, but browser rejects it',async()=>{
  const fake=seed('water');
  const candidate=report('water');
  const receipt={
    version:V2_ADMISSION,stream:'water',sourceAlias:'water-primary',
    epoch:1,sequence:2,
    reportDigest:hash(canonicalR3V2Observation(candidate.payload)),
    admittedAtMs:NOW
  };
  const forged={report:candidate,admission:{
    receipt,signature:'A'.repeat(86)
  }};
  await writer('water').ref(path('water')).set(forged);
  const current=(await env.unauthenticatedContext().database()
    .ref(path('water')).get()).val();
  const checked=await verifyR3V2Envelope({
    stream:'water',envelope:current,pins:pinnedSpki('water'),
    subtle:webcrypto.subtle,connected:true,nowMs:NOW
  });
  assert.equal(checked.verified,false);
  assert.equal(checked.reason,'admission-signature-invalid');
  assert.equal((await gateway().publish({
    stream:'water',record:report('water',3)
  })).reason,'historical-dual-proof-unverified');
  assert.equal(fake.report.payload.sequence,1);
});
test('V2 rules deny invented device receivedAtMs or mismatched admission time',async()=>{
  const s='rain',r=report(s);
  const q={
    version:V2_ADMISSION,stream:s,sourceAlias:s+'-primary',
    epoch:1,sequence:2,reportDigest:hash(canonicalR3V2Observation(r.payload)),
    admittedAtMs:NOW
  };
  const e={report:r,admission:{receipt:q,
    signature:signIt(s,'issuer',canonicalR3V2Admission(q))}};
  await assertFails(writer(s).ref(path(s)).set({
    ...e,report:{...e.report,payload:{...r.payload,receivedAtMs:NOW}}
  }));
  await assertFails(writer(s).ref(path(s)).set({
    ...e,admission:{...e.admission,receipt:{...q,admittedAtMs:NOW+20000}}
  }));
  await assertFails(writer(s).ref(path(s)).set({
    ...e,admission:{...e.admission,receipt:{...q,sequence:9}}
  }));
  await assertFails(writer(s).ref(path(s)).set({...e,gateCommand:'OPEN'}));
});
test('unauthenticated clients cannot read parent/private or write any V2 or gate',async()=>{
  const client=env.unauthenticatedContext().database();
  for(const pathName of [root,root+'/attestedEvidenceLabV2',
    root+'/v2AdmissionAuthorization',root+'/confirmedIngest',
    root+'/staging',root+'/live/esp8266/ip',root+'/live/gate',
    root+'/bot'])
    await assertFails(client.ref(pathName).get());
  await assertFails(client.ref(path('water')).set(seed('water')));
  await assertFails(client.ref(root+'/live/gate').set({angle:90}));
});
test('simultaneous same sequence has exactly one atomic scoped winner',async()=>{
  const gate=gateway(),item=report('rain');
  const result=await Promise.all([
    gate.publish({stream:'rain',record:item}),
    gate.publish({stream:'rain',record:item})
  ]);
  assert.equal(result.filter(x=>x.published).length,1);
  assert.equal((await read(path('rain'))).report.payload.sequence,2);
});
