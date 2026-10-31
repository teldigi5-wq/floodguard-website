import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash,generateKeyPairSync,sign,webcrypto}
  from 'node:crypto';
import {readFileSync} from 'node:fs';
import {V2_OBSERVATION,V2_ADMISSION,canonicalR3V2Observation,
  canonicalR3V2Admission,verifyR3V2Envelope}
  from '../experiments/r3-v2-admission-contract-lab.mjs';
import {createR3V2AdmissionGatewayLab}
  from '../experiments/r3-v2-server-admission-gate-lab.mjs';

process.env.FG_R3_V2_ADMISSION_LAB_TEST='1';
process.env.FIREBASE_DATABASE_EMULATOR_HOST='127.0.0.1:9000';
const T=Date.UTC(2026,9,31,15,30);
const streams=['water','rain'];
const pairs=Object.fromEntries(streams.map(s=>[s,{
  report:generateKeyPairSync('ed25519'),
  issuer:generateKeyPairSync('ed25519')
}]));
const registry=()=>Object.fromEntries(streams.map(s=>[s,{
  epoch:1,enabled:true,
  report:pairs[s].report.publicKey,issuer:pairs[s].issuer.publicKey
}]));
const spki=s=>({
  report:pairs[s].report.publicKey.export({type:'spki',format:'der'})
    .toString('base64url'),
  issuer:pairs[s].issuer.publicKey.export({type:'spki',format:'der'})
    .toString('base64url')
});
const digest=s=>createHash('sha256').update(s,'utf8').digest('hex');
const signed=(s,role,text)=>sign(null,Buffer.from(text,'utf8'),
  pairs[s][role].privateKey).toString('base64url');
function observed(s,sequence=2,extra={}) {
  const payload={
    version:V2_OBSERVATION,stream:s,sourceAlias:s+'-primary',
    epoch:1,sequence,observedAtMs:T-2500+sequence,
    sample:s==='water'
      ?{distanceCm:16.5,levelCm:8.5,reportedStatus:'WARNING'}
      :{currentMm:2,dailyMm:13,reportedStatus:'NORMAL'},
    ...extra
  };
  return {payload,signature:signed(s,'report',
    canonicalR3V2Observation(payload))};
}
function envelope(s,sequence=1,admittedAtMs=T-4000) {
  const report=observed(s,sequence,{
    observedAtMs:T-5500+sequence
  });
  const p=report.payload;
  const receipt={
    version:V2_ADMISSION,stream:s,sourceAlias:s+'-primary',
    epoch:1,sequence,reportDigest:digest(canonicalR3V2Observation(p)),
    admittedAtMs
  };
  return {report,admission:{receipt,signature:signed(s,'issuer',
    canonicalR3V2Admission(receipt))}};
}
const check=(s,e,extra={})=>verifyR3V2Envelope({
  stream:s,envelope:e,pins:spki(s),subtle:webcrypto.subtle,
  connected:true,nowMs:T,...extra
});
function fixture({clock,issuer,writer,operatorRegistry}={}){
  const state={water:envelope('water'),rain:envelope('rain')},paths=[];
  let calls=0;
  const issuerFn=issuer??(async(s,text)=>{
    calls++;
    return signed(s,'issuer',text);
  });
  const writeFn=writer??(s=>({ref:path=>{
    paths.push(path);
    return {
      get:async()=>({val:()=>state[s]}),
      set:async value=>{state[s]=value;}
    };
  }}));
  const gateway=createR3V2AdmissionGatewayLab({
    registry:operatorRegistry??registry(),clock:clock??(()=>T),
    signAdmission:issuerFn,databaseForStream:writeFn
  });
  return {gateway,state,paths,get signatures(){return calls;}};
}

test('V2 source canonical payload excludes every server reception timestamp',()=>{
  for(const s of streams){
    const a=observed(s);
    assert.deepEqual(Object.keys(a.payload),[
      'version','stream','sourceAlias','epoch','sequence',
      'observedAtMs','sample'
    ]);
    const canon=canonicalR3V2Observation(a.payload);
    assert.doesNotMatch(canon,/receivedAtMs|admittedAtMs|gatewayIp/);
    assert.equal(canonicalR3V2Observation(Object.fromEntries(
      Object.entries(a.payload).reverse())),canon);
    assert.throws(()=>canonicalR3V2Observation({
      ...a.payload,receivedAtMs:T+12000
    }));
    assert.throws(()=>canonicalR3V2Observation({
      ...a.payload,gateCommand:'OPEN'
    }));
  }
});
test('gateway alone provides signed admission clock, including independent streams',async()=>{
  const x=fixture();
  for(const s of streams){
    const out=await x.gateway.publish({stream:s,record:observed(s)});
    assert.equal(out.published,true);
    assert.equal(out.requiresIndependentRecoveryAnchor,true);
    assert.equal(x.state[s].admission.receipt.admittedAtMs,T);
    assert.equal(x.state[s].report.payload.observedAtMs,T-2498);
    const valid=await check(s,x.state[s]);
    assert.equal(valid.verified,true);
    assert.equal(valid.serverAdmittedAtMs,T);
    assert.equal(valid.productionBackendVerified,false);
    assert.equal(valid.physicalSafetyVerified,false);
    assert.equal(valid.durableAntirollbackVerified,false);
  }
  assert.deepEqual(x.paths,[
    '/floodguard/attestedEvidenceLabV2/water',
    '/floodguard/attestedEvidenceLabV2/rain'
  ]);
});
test('caller injection, unsigned report and wrong device key fail before signer',async()=>{
  const x=fixture();
  const r=observed('water');
  for(const bad of [
    {stream:'water',record:r,admittedAtMs:T+12000},
    {stream:'water',record:{...r,signature:'A'.repeat(86)}},
    {stream:'water',record:{...r,payload:{...r.payload,sequence:3}}},
    {stream:'water',record:{...r,privateKey:'TEST'}},
    {stream:'water',record:observed('rain')}
  ])assert.equal((await x.gateway.publish(bad)).published,false);
  assert.equal(x.signatures,0);
  assert.equal(x.paths.length,0);
});
test('source old/future times, duplicate sequence, changed epoch and invalid clock denied',async()=>{
  const x=fixture();
  for(const r of [
    observed('water',1),
    observed('water',2,{epoch:2}),
    observed('water',2,{observedAtMs:T-20000}),
    observed('water',2,{observedAtMs:T+3000})
  ])assert.equal((await x.gateway.publish({
    stream:'water',record:r
  })).published,false);
  assert.equal(x.state.water.report.payload.sequence,1);
  const broken=fixture({clock:()=>T+100000});
  assert.equal((await broken.gateway.publish({
    stream:'water',record:observed('water')
  })).reason,'server-time-or-source-skew-invalid');
});
test('historical forged report, issuer, or digest cannot be silently repaired',async()=>{
  for(const what of ['report','issuer','digest']){
    const x=fixture();
    if(what==='report')x.state.water.report.signature='A'.repeat(86);
    if(what==='issuer')x.state.water.admission.signature='A'.repeat(86);
    if(what==='digest')
      x.state.water.admission.receipt.reportDigest='0'.repeat(64);
    assert.equal((await x.gateway.publish({
      stream:'water',record:observed('water')
    })).reason,'historical-dual-proof-unverified');
    assert.equal(x.signatures,0);
  }
});
test('browser digest, both independent signatures and signed times are mandatory',async()=>{
  const x=fixture();
  assert.equal((await x.gateway.publish({
    stream:'water',record:observed('water')
  })).published,true);
  const good=x.state.water;
  const forged={...good,admission:{
    ...good.admission,signature:'A'.repeat(86)
  }};
  assert.equal((await check('water',forged)).reason,
    'admission-signature-invalid');
  const changed={...good,admission:{
    ...good.admission,receipt:{
      ...good.admission.receipt,admittedAtMs:T+1
    }
  }};
  assert.equal((await check('water',changed)).reason,
    'admission-signature-invalid');
  assert.equal((await check('rain',good)).verified,false);
  assert.equal((await check('water',good,{
    pins:{report:spki('water').report,issuer:spki('water').report}
  })).reason,'invalid-or-shared-signing-key');
  assert.equal((await check('water',good,{
    prior:{sourceAlias:'water-primary',epoch:1,sequence:2,
      observedAtMs:T-3000,admittedAtMs:T-1000}
  })).reason,'replay-or-clock-rollback');
});
test('signer unavailability and wrong issuer never writes',async()=>{
  let writes=0;
  for(const issue of [
    async()=>{throw Error('issuer offline');},
    async()=>('A'.repeat(86)),
    async(_,canonical)=>signed('rain','issuer',canonical)
  ]){
    const x=fixture({issuer:issue,writer:s=>({ref:()=>({
      get:async()=>({val:()=>envelope(s)}),
      set:async()=>{writes++;}
    })})});
    assert.equal((await x.gateway.publish({
      stream:'water',record:observed('water')
    })).published,false);
  }
  assert.equal(writes,0);
});
test('write acknowledgment loss is unknown and never retried automatically',async()=>{
  let writes=0;
  const x=fixture({writer:s=>({ref:()=>({
    get:async()=>({val:()=>envelope(s)}),
    set:async()=>{writes++;throw Error('ack lost');}
  })})});
  assert.deepEqual(await x.gateway.publish({
    stream:'water',record:observed('water')
  }),{published:false,reason:'publication-outcome-unconfirmed'});
  assert.equal(writes,1);
});
test('registry pins cannot collide or be edited after construction',async()=>{
  const bad=registry();
  bad.water.issuer=bad.water.report;
  assert.throws(()=>fixture({operatorRegistry:bad}),/roles must be distinct/);
  const source=registry(),x=fixture({operatorRegistry:source});
  source.water.epoch=2;
  assert.equal((await x.gateway.publish({
    stream:'water',record:observed('water')
  })).published,true);
  x.gateway.close();
  assert.equal((await x.gateway.publish({
    stream:'rain',record:observed('rain')
  })).reason,'gateway-closed');
});
test('local-only modules never contain network listener, Admin SDK or real device code',()=>{
  const server=readFileSync(
    'experiments/r3-v2-server-admission-gate-lab.mjs','utf8');
  const browser=readFileSync(
    'experiments/r3-v2-admission-contract-lab.mjs','utf8');
  assert.doesNotMatch(server,/firebase-admin|serviceAccount|node:http|node:https|privateKey/);
  assert.doesNotMatch(browser,/node:crypto|firebase\/database|process\.env|\.ref\s*\(/);
  assert.doesNotMatch(readFileSync('providers/flood-provider.tsx','utf8'),
    /r3-v2-admission-contract-lab/);
});
