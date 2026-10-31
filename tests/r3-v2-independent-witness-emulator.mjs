// Real localhost Firebase RTDB Emulator, with an independent in-memory
// signed high-water witness fixture. NOT persistent independent storage.
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
import {R3_V2_WITNESS_VERSION,canonicalR3V2WitnessCheckpoint,
  reviewR3V2PublishedForWitness,createR3V2WitnessReconciliationLab}
  from '../experiments/r3-v2-independent-witness-reconciliation-lab.mjs';

if(process.env.FG_R3_WITNESS_RECONCILIATION_LAB_TEST!=='1'||
   process.env.FG_R3_V2_ADMISSION_LAB_TEST!=='1'||
   process.env.FIREBASE_DATABASE_EMULATOR_HOST!=='127.0.0.1:9000')
  throw Error('Independent witness RTDB acceptance is isolated loopback-only');
const NOW=Date.UTC(2026,9,31,17,0);
const streams=['water','rain'],root='/floodguard';
const path=s=>root+'/attestedEvidenceLabV2/'+s;
const uid=s=>'r3-v2-'+s+'-writer';
const claim=s=>'fg_r3_v2_'+s+'_write';
const keys=Object.fromEntries(streams.map(s=>[s,{
  report:generateKeyPairSync('ed25519'),
  issuer:generateKeyPairSync('ed25519'),
  witness:generateKeyPairSync('ed25519')
}]));
const hash=x=>createHash('sha256').update(x,'utf8').digest('hex');
const signIt=(s,role,text)=>sign(null,Buffer.from(text,'utf8'),
  keys[s][role].privateKey).toString('base64url');
const enrolled=()=>Object.fromEntries(streams.map(s=>[s,{
  epoch:1,report:keys[s].report.publicKey,
  issuer:keys[s].issuer.publicKey,
  witness:keys[s].witness.publicKey
}]));
const gatewayRegistry=()=>Object.fromEntries(streams.map(s=>[s,{
  epoch:1,enabled:true,report:keys[s].report.publicKey,
  issuer:keys[s].issuer.publicKey
}]));
function report(s,sequence=2,time=NOW){
  const payload={
    version:V2_OBSERVATION,stream:s,sourceAlias:s+'-primary',epoch:1,
    sequence,observedAtMs:time-2500+sequence,
    sample:s==='water'
      ?{distanceCm:16,levelCm:9,reportedStatus:'WARNING'}
      :{currentMm:2,dailyMm:13,reportedStatus:'NORMAL'}
  };
  return {payload,signature:signIt(s,'report',
    canonicalR3V2Observation(payload))};
}
function envelope(s,sequence=1,time=NOW-1500){
  const r=report(s,sequence,time);
  const receipt={
    version:V2_ADMISSION,stream:s,sourceAlias:s+'-primary',
    epoch:1,sequence,
    reportDigest:hash(canonicalR3V2Observation(r.payload)),
    admittedAtMs:time
  };
  return {report:r,admission:{receipt,
    signature:signIt(s,'issuer',canonicalR3V2Admission(receipt))}};
}
const signedCheckpoint=(s,item)=>{
  const v=reviewR3V2PublishedForWitness({
    stream:s,envelope:item,epoch:1,
    trustedReportKey:keys[s].report.publicKey,
    trustedIssuerKey:keys[s].issuer.publicKey
  });
  assert.equal(v.valid,true,v.reason);
  const checkpoint={
    version:R3_V2_WITNESS_VERSION,stream:s,
    sourceAlias:v.sourceAlias,epoch:v.epoch,sequence:v.sequence,
    envelopeDigest:v.envelopeDigest
  };
  return {checkpoint,signature:signIt(s,'witness',
    canonicalR3V2WitnessCheckpoint(checkpoint))};
};
let env,authority;
async function admin(action){
  let result;
  await env.withSecurityRulesDisabled(async c=>{result=await action(c.database());});
  return result;
}
const published=async s=>admin(async db=>(await db.ref(path(s)).get()).val());
const scoped=s=>env.authenticatedContext(uid(s),{[claim(s)]:true}).database();
const pubGate=()=>createR3V2AdmissionGatewayLab({
  registry:gatewayRegistry(),clock:()=>NOW,
  signAdmission:async(s,text)=>signIt(s,'issuer',text),
  databaseForStream:scoped
});
function coordinator({publish,compareAndSwap}={}){
  const gateway=pubGate();
  return createR3V2WitnessReconciliationLab({
    enrolled:enrolled(),readPublished:published,
    readWitness:async s=>authority[s],
    publish:publish??(request=>gateway.publish(request)),
    witnessCAS:compareAndSwap??(async({stream,expectedCheckpoint,nextCheckpoint})=>{
      assert.deepEqual(authority[stream].checkpoint,expectedCheckpoint);
      assert.equal(nextCheckpoint.sequence,expectedCheckpoint.sequence+1);
      authority[stream]={
        checkpoint:nextCheckpoint,
        signature:signIt(stream,'witness',
          canonicalR3V2WitnessCheckpoint(nextCheckpoint))
      };
      return authority[stream];
    })
  });
}
before(async()=>{
  const rules=readFileSync('docs/firebase/r3-v2-admission-emulator.rules.json','utf8');
  env=await initializeTestEnvironment({
    projectId:'demo-fg-r3-v2-witness',
    database:{host:'127.0.0.1',port:9000,rules}
  });
});
after(async()=>{if(env)await env.cleanup();});
beforeEach(async()=>{
  await env.clearDatabase();
  const original={water:envelope('water'),rain:envelope('rain')};
  authority={water:signedCheckpoint('water',original.water),
    rain:signedCheckpoint('rain',original.rain)};
  await admin(db=>db.ref(root).set({
    attestedEvidenceLabV2:original,
    v2AdmissionAuthorization:Object.fromEntries(streams.map(s=>[
      uid(s),{enabled:true,scope:'r3-v2-'+s+'-admit-v1'}
    ])),
    confirmedIngest:{test:{secret:'PRIVATE'}},
    live:{gate:{status:'CLOSED',angle:0}},
    bot:{contacts:{test:'PRIVATE'}}
  }));
});

test('actual RTDB read, authenticated V2 publish and separately signed witness CAS',async()=>{
  const before=await admin(async db=>(await db.ref(root).get()).val());
  for(const s of streams){
    const result=await coordinator().advance({stream:s,record:report(s)});
    assert.equal(result.reconciled,true,result.reason);
    assert.equal((await coordinator().inspect(s)).aligned,true);
    assert.equal(authority[s].checkpoint.sequence,2);
    const source=await published(s);
    assert.equal((await verifyR3V2Envelope({
      stream:s,envelope:source,pins:{
        report:keys[s].report.publicKey.export({type:'spki',format:'der'}).toString('base64url'),
        issuer:keys[s].issuer.publicKey.export({type:'spki',format:'der'}).toString('base64url')
      },subtle:webcrypto.subtle,nowMs:NOW,connected:true
    })).verified,true);
  }
  const after=await admin(async db=>(await db.ref(root).get()).val());
  for(const key of ['live','confirmedIngest','bot','v2AdmissionAuthorization'])
    assert.deepEqual(after[key],before[key]);
});
test('privileged DB restore behind independent witness refuses next event',async()=>{
  const old=await published('water');
  assert.equal((await coordinator().advance({
    stream:'water',record:report('water')
  })).reconciled,true);
  await admin(db=>db.ref(path('water')).set(old));
  assert.equal((await coordinator().inspect('water')).reason,
    'database-behind-external-witness');
  const other=await published('rain');
  assert.equal((await coordinator().advance({
    stream:'water',record:report('water',3)
  })).reconciled,false);
  assert.deepEqual(await published('rain'),other);
});
test('lost witness CAS after RTDB acknowledged leaves DB ahead and requires review',async()=>{
  const c=coordinator({compareAndSwap:async()=>{
    throw Error('independent witness down');
  }});
  assert.equal((await c.advance({
    stream:'water',record:report('water')
  })).reason,'witness-outcome-unconfirmed');
  assert.equal((await coordinator().inspect('water')).reason,
    'database-ahead-requires-signed-operator-catchup');
  assert.equal((await published('water')).report.payload.sequence,2);
});
test('stolen publisher credential can bypass coordinator and poison public leaf',async()=>{
  const next=envelope('rain',2,NOW);
  next.admission.signature='A'.repeat(86);
  await scoped('rain').ref(path('rain')).set(next);
  assert.equal((await coordinator().inspect('rain')).reason,
    'published-signatures-invalid');
  assert.equal((await coordinator().advance({
    stream:'rain',record:report('rain',3)
  })).reconciled,false);
  await assertFails(env.unauthenticatedContext().database()
    .ref(root+'/live/gate').get());
  await assertFails(env.unauthenticatedContext().database()
    .ref(root+'/attestedEvidenceLabV2').get());
});
