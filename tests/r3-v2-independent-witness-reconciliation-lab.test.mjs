import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash,generateKeyPairSync,sign}
  from 'node:crypto';
import {readFileSync} from 'node:fs';
import {V2_OBSERVATION,V2_ADMISSION,canonicalR3V2Observation,
  canonicalR3V2Admission}
  from '../experiments/r3-v2-admission-contract-lab.mjs';
import {createR3V2AdmissionGatewayLab}
  from '../experiments/r3-v2-server-admission-gate-lab.mjs';
import {R3_V2_WITNESS_VERSION,canonicalR3V2WitnessCheckpoint,
  reviewR3V2PublishedForWitness,createR3V2WitnessReconciliationLab}
  from '../experiments/r3-v2-independent-witness-reconciliation-lab.mjs';

process.env.FG_R3_V2_ADMISSION_LAB_TEST='1';
process.env.FG_R3_WITNESS_RECONCILIATION_LAB_TEST='1';
process.env.FIREBASE_DATABASE_EMULATOR_HOST='127.0.0.1:9000';
const initial=Date.UTC(2026,9,31,16,0,0);
const streams=['water','rain'];
const keys=Object.fromEntries(streams.map(s=>[s,{
  report:generateKeyPairSync('ed25519'),
  issuer:generateKeyPairSync('ed25519'),
  witness:generateKeyPairSync('ed25519')
}]));
const hash=v=>createHash('sha256').update(v,'utf8').digest('hex');
const signature=(stream,role,bytes)=>sign(null,Buffer.from(bytes,'utf8'),
  keys[stream][role].privateKey).toString('base64url');
function report(stream,sequence=2,clock=initial) {
  const payload={
    version:V2_OBSERVATION,stream,sourceAlias:stream+'-primary',
    epoch:1,sequence,observedAtMs:clock-2500+sequence,
    sample:stream==='water'
      ?{distanceCm:16,levelCm:9,reportedStatus:'WARNING'}
      :{currentMm:2,dailyMm:13,reportedStatus:'NORMAL'}
  };
  return {payload,signature:signature(stream,'report',
    canonicalR3V2Observation(payload))};
}
function makeEnvelope(stream,sequence=1,clock=initial-1500){
  const r=report(stream,sequence,clock);
  const p=r.payload;
  const receipt={
    version:V2_ADMISSION,stream,sourceAlias:p.sourceAlias,epoch:p.epoch,
    sequence:p.sequence,reportDigest:hash(canonicalR3V2Observation(p)),
    admittedAtMs:clock
  };
  return {report:r,admission:{
    receipt,signature:signature(stream,'issuer',
      canonicalR3V2Admission(receipt))
  }};
}
const pins=()=>Object.fromEntries(streams.map(s=>[s,{
  epoch:1,report:keys[s].report.publicKey,
  issuer:keys[s].issuer.publicKey,
  witness:keys[s].witness.publicKey
}]));
const enrolled=()=>Object.fromEntries(streams.map(s=>[s,{
  epoch:1,enabled:true,report:keys[s].report.publicKey,
  issuer:keys[s].issuer.publicKey
}]));
function checkpoint(stream,envelope) {
  const v=reviewR3V2PublishedForWitness({
    stream,envelope,trustedReportKey:keys[stream].report.publicKey,
    trustedIssuerKey:keys[stream].issuer.publicKey,epoch:1
  });
  assert.equal(v.valid,true,v.reason);
  return {version:R3_V2_WITNESS_VERSION,
    stream,sourceAlias:v.sourceAlias,epoch:v.epoch,
    sequence:v.sequence,envelopeDigest:v.envelopeDigest};
}
const seal=(stream,value)=>({
  checkpoint:value,
  signature:signature(stream,'witness',canonicalR3V2WitnessCheckpoint(value))
});
function fixture(options={}) {
  let time=initial;
  const db={water:makeEnvelope('water'),rain:makeEnvelope('rain')};
  const witness={water:seal('water',checkpoint('water',db.water)),
    rain:seal('rain',checkpoint('rain',db.rain))};
  let publishes=0,casCalls=0;
  const scoped=s=>({ref:location=>{
    if(location!== '/floodguard/attestedEvidenceLabV2/'+s)
      throw Error('Out of scope');
    return {
      get:async()=>({val:()=>db[s]}),
      set:async next=>{db[s]=next;}
    };
  }});
  const gateway=createR3V2AdmissionGatewayLab({
    registry:enrolled(),clock:()=>time,
    signAdmission:async(s,bytes)=>signature(s,'issuer',bytes),
    databaseForStream:scoped
  });
  const readPublished=options.readPublished??(async s=>db[s]);
  const readWitness=options.readWitness??(async s=>witness[s]);
  const witnessCAS=options.witnessCAS??(async({stream,expectedCheckpoint,nextCheckpoint})=>{
    casCalls++;
    assert.deepEqual(witness[stream].checkpoint,expectedCheckpoint);
    assert.equal(nextCheckpoint.sequence,expectedCheckpoint.sequence+1);
    witness[stream]=seal(stream,nextCheckpoint);
    return witness[stream];
  });
  const publish=options.publish??(async request=>{
    publishes++;
    return gateway.publish(request);
  });
  const build=()=>createR3V2WitnessReconciliationLab({
    enrolled:pins(),readPublished,readWitness,witnessCAS,publish
  });
  return {
    db,witness,build,gateway,
    setClock:v=>time=v,
    get publishes(){return publishes;},
    get casCalls(){return casCalls;}
  };
}
test('both streams reconcile independently and survive coordinator recreation',async()=>{
  const f=fixture(),c=f.build();
  for(const s of streams){
    assert.equal((await c.inspect(s)).aligned,true);
    const out=await c.advance({stream:s,record:report(s)});
    assert.deepEqual(out,{
      reconciled:true,stream:s,sequence:2,
      kind:'LAB_ACK_AND_WITNESS_CAS_NOT_PROVEN_DURABLE',
      productionDurabilityVerified:false,physicalSafetyVerified:false
    });
    assert.equal((await f.build().inspect(s)).sequence,2);
    assert.equal(f.witness[s].checkpoint.sequence,2);
  }
  assert.equal(f.casCalls,2);
});
test('a candidate cannot skip sequence or inject trust and arbitrary paths',async()=>{
  const f=fixture(),c=f.build();
  for(const bad of [
    {stream:'water',record:report('water',4)},
    {stream:'water',record:report('water'),path:'/floodguard/live/gate'},
    {stream:'water',record:report('rain')},
    {stream:'water',record:{...report('water'),issuerPrivateKey:'fake'}}
  ])assert.equal((await c.advance(bad)).reconciled,false);
  assert.equal(f.publishes,0);
  assert.equal(f.casCalls,0);
});
test('restored older database state is detected when external witness remains ahead',async()=>{
  const f=fixture(),before=f.db.water;
  assert.equal((await f.build().advance({
    stream:'water',record:report('water')
  })).reconciled,true);
  f.db.water=before;
  assert.deepEqual(await f.build().inspect('water'),{
    reconciled:false,reason:'database-behind-external-witness',
    needsIndependentOperatorReview:true
  });
  assert.equal((await f.build().advance({
    stream:'water',record:report('water',3)
  })).reconciled,false);
  assert.equal(f.casCalls,1);
});
test('database ahead of signed witness refuses automatic catch-up',async()=>{
  const f=fixture();
  f.db.rain=makeEnvelope('rain',2,initial);
  const state=await f.build().inspect('rain');
  assert.equal(state.reason,'database-ahead-requires-signed-operator-catchup');
  assert.equal(f.casCalls,0);
});
test('same sequence and different independently signed payload is conflict',async()=>{
  const f=fixture();
  f.db.water=makeEnvelope('water',1,initial);
  assert.equal((await f.build().inspect('water')).reason,
    'same-sequence-digest-conflict');
});
test('missing or forged external signed witness never becomes implicit zero',async()=>{
  for(const type of ['missing','forged']){
    const f=fixture();
    const w=type==='missing'?null:{
      ...f.witness.water,signature:'A'.repeat(86)
    };
    const isolated=createR3V2WitnessReconciliationLab({
      enrolled:pins(),
      readPublished:async s=>f.db[s],
      readWitness:async s=>s==='water'?w:f.witness[s],
      witnessCAS:async()=>{throw Error('unexpected CAS');},
      publish:async()=>{throw Error('unexpected publish');}
    });
    assert.equal((await isolated.advance({
      stream:'water',record:report('water')
    })).reconciled,false);
  }
});
test('ambiguous publish acknowledgment never triggers witness CAS or retry',async()=>{
  const f=fixture();
  let writes=0;
  const c=createR3V2WitnessReconciliationLab({
    enrolled:pins(),readPublished:async s=>f.db[s],
    readWitness:async s=>f.witness[s],
    publish:async()=>{writes++;f.db.water=makeEnvelope('water',2,initial);
      throw Error('lost response');},
    witnessCAS:async()=>{throw Error('should not advance');}
  });
  const result=await c.advance({stream:'water',record:report('water')});
  assert.equal(result.reason,'publication-outcome-unconfirmed');
  assert.equal(writes,1);
  assert.equal((await c.inspect('water')).reason,
    'database-ahead-requires-signed-operator-catchup');
});
test('witness CAS may commit before losing its ACK; no silent retry',async()=>{
  const f=fixture();
  let attempted=0;
  const c=createR3V2WitnessReconciliationLab({
    enrolled:pins(),readPublished:async s=>f.db[s],
    readWitness:async s=>f.witness[s],
    publish:request=>f.gateway.publish(request),
    witnessCAS:async({stream,nextCheckpoint})=>{
      attempted++;f.witness[stream]=seal(stream,nextCheckpoint);
      throw Error('witness response lost');
    }
  });
  assert.equal((await c.advance({
    stream:'water',record:report('water')
  })).reason,'witness-outcome-unconfirmed');
  assert.equal(attempted,1);
  assert.equal((await c.inspect('water')).aligned,true);
});
test('a forged witness CAS response after write is rejected and next advance blocked',async()=>{
  const f=fixture(),c=createR3V2WitnessReconciliationLab({
    enrolled:pins(),readPublished:async s=>f.db[s],
    readWitness:async s=>f.witness[s],
    publish:request=>f.gateway.publish(request),
    witnessCAS:async({stream,nextCheckpoint})=>({
      checkpoint:nextCheckpoint,signature:'A'.repeat(86)
    })
  });
  assert.equal((await c.advance({
    stream:'water',record:report('water')
  })).reason,'witness-result-untrusted');
  assert.equal((await c.inspect('water')).reason,
    'database-ahead-requires-signed-operator-catchup');
});
test('same-process concurrent stream advances are guarded, not distributed fencing',async()=>{
  const f=fixture();
  let unlock;const gate=new Promise(resolve=>{unlock=resolve;});
  const c=createR3V2WitnessReconciliationLab({
    enrolled:pins(),readPublished:async s=>f.db[s],
    readWitness:async s=>f.witness[s],
    publish:async request=>{await gate;return f.gateway.publish(request);},
    witnessCAS:async({stream,nextCheckpoint})=>{
      f.witness[stream]=seal(stream,nextCheckpoint);
      return f.witness[stream];
    }
  });
  const first=c.advance({stream:'rain',record:report('rain')});
  assert.equal((await c.advance({
    stream:'rain',record:report('rain')
  })).reason,'same-process-stream-operation-busy');
  unlock();
  assert.equal((await first).reconciled,true);
});
test('both database and witness restored together remains an explicitly unprevented attack',async()=>{
  const f=fixture(),oldDb=f.db.rain,oldWitness=f.witness.rain;
  assert.equal((await f.build().advance({
    stream:'rain',record:report('rain')
  })).reconciled,true);
  f.db.rain=oldDb;f.witness.rain=oldWitness;
  // A lab in-memory witness is not nonrollback! A privileged simultaneous
  // old snapshot restore cannot be detected without actual external history.
  assert.equal((await f.build().inspect('rain')).aligned,true);
  assert.equal((await f.build().inspect('rain')).sequence,1);
});
test('reject same-role keys and guard lab code against hidden production IO',()=>{
  const f=fixture();
  const duplicate=pins();
  duplicate.water.witness=duplicate.water.issuer;
  assert.throws(()=>createR3V2WitnessReconciliationLab({
    enrolled:duplicate,readPublished:async s=>f.db[s],
    readWitness:async s=>f.witness[s],
    witnessCAS:async()=>null,publish:async()=>null
  }),/independent role/);
  const src=readFileSync(
    'experiments/r3-v2-independent-witness-reconciliation-lab.mjs','utf8'
  );
  assert.doesNotMatch(src,/firebase-admin|node:http|node:https|serviceAccount|node:net/);
  assert.doesNotMatch(src,/\b(?:fetch|WebSocket|XMLHttpRequest)\s*\(/);
});
