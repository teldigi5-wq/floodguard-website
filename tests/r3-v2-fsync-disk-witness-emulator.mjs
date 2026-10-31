// R3 V2 disk witness + actual loopback RTDB Emulator. Synthetic-only.
// The witness is private local fsync storage, NOT independent nonrollback.
import {test,before,after,beforeEach,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {createHash,generateKeyPairSync,sign} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {initializeTestEnvironment,assertFails}
  from '@firebase/rules-unit-testing';
import {V2_OBSERVATION,V2_ADMISSION,canonicalR3V2Observation,
  canonicalR3V2Admission}
  from '../experiments/r3-v2-admission-contract-lab.mjs';
import {createR3V2AdmissionGatewayLab}
  from '../experiments/r3-v2-server-admission-gate-lab.mjs';
import {R3_V2_WITNESS_VERSION,canonicalR3V2WitnessCheckpoint,
  reviewR3V2PublishedForWitness,createR3V2WitnessReconciliationLab}
  from '../experiments/r3-v2-independent-witness-reconciliation-lab.mjs';
import {createR3V2DiskWitnessLab}
  from '../experiments/r3-v2-fsync-disk-witness-lab.mjs';

if(process.env.FG_R3_DISK_WITNESS_LAB_TEST!=='1'||
   process.env.FG_R3_V2_ADMISSION_LAB_TEST!=='1'||
   process.env.FG_R3_WITNESS_RECONCILIATION_LAB_TEST!=='1'||
   process.env.FIREBASE_DATABASE_EMULATOR_HOST!=='127.0.0.1:9000')
  throw Error('Disk witness integration requires isolated localhost emulator');
const NOW=Date.UTC(2026,9,31,17,30);
const streams=['water','rain'],root='/floodguard';
const leaf=s=>root+'/attestedEvidenceLabV2/'+s;
const uid=s=>'r3-v2-'+s+'-writer';
const claims=s=>({['fg_r3_v2_'+s+'_write']:true});
const keys=Object.fromEntries(streams.map(s=>[s,{
  report:generateKeyPairSync('ed25519'),
  issuer:generateKeyPairSync('ed25519'),
  witness:generateKeyPairSync('ed25519')
}]));
const hash=x=>createHash('sha256').update(x,'utf8').digest('hex');
const signIt=(s,role,msg)=>sign(null,Buffer.from(msg,'utf8'),
  keys[s][role].privateKey).toString('base64url');
const enroll=()=>Object.fromEntries(streams.map(s=>[s,{
  epoch:1,report:keys[s].report.publicKey,
  issuer:keys[s].issuer.publicKey,witness:keys[s].witness.publicKey
}]));
const registry=()=>Object.fromEntries(streams.map(s=>[s,{
  epoch:1,enabled:true,report:keys[s].report.publicKey,
  issuer:keys[s].issuer.publicKey
}]));
function report(s,seq=2,admit=NOW){
  const payload={
    version:V2_OBSERVATION,stream:s,sourceAlias:s+'-primary',
    epoch:1,sequence:seq,observedAtMs:admit-2500+seq,
    sample:s==='water'
      ?{distanceCm:16,levelCm:9,reportedStatus:'WARNING'}
      :{currentMm:2,dailyMm:13,reportedStatus:'NORMAL'}
  };
  return {payload,signature:signIt(s,'report',
    canonicalR3V2Observation(payload))};
}
function genesisEnvelope(s){
  const rec=report(s,1,NOW-1500),p=rec.payload;
  const receipt={
    version:V2_ADMISSION,stream:s,sourceAlias:p.sourceAlias,
    epoch:1,sequence:1,
    reportDigest:hash(canonicalR3V2Observation(p)),admittedAtMs:NOW-1500
  };
  return {report:rec,admission:{receipt,signature:signIt(s,'issuer',
    canonicalR3V2Admission(receipt))}};
}
function checkpoint(s,envelope){
  const p=reviewR3V2PublishedForWitness({
    stream:s,envelope,epoch:1,
    trustedReportKey:keys[s].report.publicKey,
    trustedIssuerKey:keys[s].issuer.publicKey
  });
  assert.equal(p.valid,true,p.reason);
  return {
    version:R3_V2_WITNESS_VERSION,stream:s,sourceAlias:s+'-primary',
    epoch:1,sequence:p.sequence,envelopeDigest:p.envelopeDigest
  };
}
const seal=(s,cp)=>({
  checkpoint:cp,signature:signIt(s,'witness',
    canonicalR3V2WitnessCheckpoint(cp))
});
let env,directory,store,original;
async function admin(fn){
  let result;
  await env.withSecurityRulesDisabled(async x=>{result=await fn(x.database());});
  return result;
}
const published=s=>admin(async db=>(await db.ref(leaf(s)).get()).val());
const writer=s=>env.authenticatedContext(uid(s),claims(s)).database();
function openStore(options={}){
  return createR3V2DiskWitnessLab({
    directory,
    enrollment:Object.fromEntries(streams.map(s=>[s,{
      epoch:1,publicKey:keys[s].witness.publicKey
    }])),
    signCheckpoint:(s,canonical)=>signIt(s,'witness',canonical),
    ...options
  });
}
function coordinator({witness,issuer}={}){
  const disk=witness??openStore();
  const gateway=createR3V2AdmissionGatewayLab({
    registry:registry(),clock:()=>NOW,
    signAdmission:issuer??(async(s,canonical)=>signIt(s,'issuer',canonical)),
    databaseForStream:writer
  });
  return createR3V2WitnessReconciliationLab({
    enrolled:enroll(),readPublished:published,
    readWitness:async s=>disk.readSigned(s),
    witnessCAS:async request=>disk.compareAndSwap(request),
    publish:request=>gateway.publish(request)
  });
}
before(async()=>{
  const rules=readFileSync(
    'docs/firebase/r3-v2-admission-emulator.rules.json','utf8'
  );
  env=await initializeTestEnvironment({
    projectId:'demo-fg-r3-v2-disk-witness',
    database:{host:'127.0.0.1',port:9000,rules}
  });
});
after(async()=>{if(env)await env.cleanup();});
beforeEach(async()=>{
  await env.clearDatabase();
  directory=fs.mkdtempSync(path.join(os.tmpdir(),'fg-v2-witness-emulator-'));
  fs.chmodSync(directory,0o700);
  original={water:genesisEnvelope('water'),rain:genesisEnvelope('rain')};
  await admin(db=>db.ref(root).set({
    attestedEvidenceLabV2:original,
    v2AdmissionAuthorization:Object.fromEntries(streams.map(s=>[uid(s),{
      enabled:true,scope:'r3-v2-'+s+'-admit-v1'
    }])),
    live:{gate:{angle:0,status:'CLOSED'}},
    confirmedIngest:{test:{secret:'PRIVATE'}},
    bot:{contacts:{test:'PRIVATE'}}
  }));
  store=openStore();
  store.initialize({
    water:seal('water',checkpoint('water',original.water)),
    rain:seal('rain',checkpoint('rain',original.rain))
  });
});
afterEach(()=>{fs.rmSync(directory,{recursive:true,force:true});});

test('water and rain commit to actual RTDB, then signed fsync witness survives fresh readers',async()=>{
  for(const s of streams){
    const out=await coordinator().advance({stream:s,record:report(s)});
    assert.equal(out.reconciled,true,out.reason);
    assert.equal((await openStore().readSigned(s)).checkpoint.sequence,2);
    assert.equal((await coordinator().inspect(s)).aligned,true);
  }
  assert.equal((await published('water')).report.payload.sequence,2);
  assert.equal((await published('rain')).report.payload.sequence,2);
  await assertFails(env.unauthenticatedContext().database()
    .ref(root+'/confirmedIngest').get());
});
test('RTDB is behind after privileged restore; witness remains fsync durable locally',async()=>{
  assert.equal((await coordinator().advance({
    stream:'water',record:report('water')
  })).reconciled,true);
  await admin(db=>db.ref(leaf('water')).set(original.water));
  assert.equal((await coordinator().inspect('water')).reason,
    'database-behind-external-witness');
  assert.equal(openStore().readSigned('water').checkpoint.sequence,2);
  assert.equal((await coordinator().advance({
    stream:'water',record:report('water',3)
  })).reconciled,false);
});
test('witness write denied after RTDB commit leaves signed DB ahead and no auto-catchup',async()=>{
  const broken=openStore({onFault:stage=>{
    if(stage==='before-write')throw Error('witness disk unavailable');
  }});
  const out=await coordinator({witness:broken}).advance({
    stream:'rain',record:report('rain')
  });
  assert.equal(out.reason,'witness-outcome-unconfirmed');
  assert.equal((await published('rain')).report.payload.sequence,2);
  assert.equal(openStore().readSigned('rain').checkpoint.sequence,1);
  assert.equal((await coordinator().inspect('rain')).reason,
    'database-ahead-requires-signed-operator-catchup');
});
test('fully valid older witness journal restore evades local-only rollback detection',async()=>{
  const file=path.join(directory,'r3-v2-witness-journal.log');
  const previous=fs.readFileSync(file);
  assert.equal((await coordinator().advance({
    stream:'rain',record:report('rain')
  })).reconciled,true);
  // Only the witness is restored here: DB is ahead and must fail closed.
  fs.writeFileSync(file,previous);
  assert.equal((await coordinator().inspect('rain')).reason,
    'database-ahead-requires-signed-operator-catchup');
  // Once the DB is ALSO restored, both old records are fully signed and
  // consistent: there is NO independent monotonic root to detect rollback.
  await admin(db=>db.ref(leaf('rain')).set(original.rain));
  assert.equal((await coordinator().inspect('rain')).aligned,true);
  assert.equal((await coordinator().inspect('rain')).sequence,1);
});
