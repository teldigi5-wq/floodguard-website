// R3 gated publisher on actual localhost Firebase Realtime Database Emulator.
// Test-only identities, issuer signatures, rules and seeded public records.
// NO network listener, production project, privileged Admin SDK or hardware.
import {test,before,after,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {createHash,generateKeyPairSync,sign,webcrypto}
  from 'node:crypto';
import {readFileSync} from 'node:fs';
import {initializeTestEnvironment,assertFails}
  from '@firebase/rules-unit-testing';
import {R2_PUBLIC_PROOF_VERSION,canonicalR2PublicEvidence}
  from '../experiments/r2-dual-stream-public-evidence.mjs';
import {R2_ISSUER_RECEIPT_VERSION,canonicalR2PublisherReceipt}
  from '../experiments/r2-attested-dual-stream-publisher.mjs';
import {createR3ServerVerifiedIngestLab}
  from '../experiments/r3-server-verified-ingest-gate-lab.mjs';
import {verifyR3AtomicDualAttestation}
  from '../experiments/r3-atomic-dual-attestation-reader-lab.mjs';

if(process.env.FG_R3_TRUSTED_INGEST_LAB_TEST!=='1'||
   process.env.FIREBASE_DATABASE_EMULATOR_HOST!=='127.0.0.1:9000')
  throw Error('R3 trusted gate requires localhost-only RTDB emulator');

const streams=['water','rain'],base='/floodguard';
const now=Date.UTC(2026,9,31,15,0,0);
const path=s=>base+'/attestedEvidenceLabV1/'+s;
const scope=s=>'r3-'+s+'-attested-publish-v1';
const uid=s=>'r3-'+s+'-attested-publisher';
const claim=s=>'fg_r3_'+s+'_attested';
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
const signText=(s,role,message)=>sign(null,Buffer.from(message),
  keys[s][role].privateKey).toString('base64url');
function report(s,seq=2,extras={}) {
  const payload={
    version:R2_PUBLIC_PROOF_VERSION,stream:s,sourceAlias:s+'-primary',
    epoch:1,sequence:seq,
    observedAtMs:now-2500+seq,
    receivedAtMs:now-1000+seq,
    sample:s==='water'
      ?{distanceCm:16,levelCm:9,reportedStatus:'WARNING'}
      :{currentMm:2,dailyMm:12,reportedStatus:'NORMAL'},
    ...extras
  };
  return {payload,signature:signText(s,'report',
    canonicalR2PublicEvidence(payload))};
}
function envelope(s,seq=1,extra={}) {
  const r=report(s,seq,extra);
  const p=r.payload;
  const receipt={
    version:R2_ISSUER_RECEIPT_VERSION,stream:s,
    sourceAlias:s+'-primary',epoch:p.epoch,
    sequence:p.sequence,payloadDigest:hash(canonicalR2PublicEvidence(p)),
    acceptedAtMs:p.receivedAtMs
  };
  return {
    report:r,
    acceptance:{
      receipt,signature:signText(s,'issuer',
        canonicalR2PublisherReceipt(receipt))
    }
  };
}
let env;
async function admin(action) {
  let output;
  await env.withSecurityRulesDisabled(async c=>{
    output=await action(c.database());
  });
  return output;
}
const readAdmin=p=>admin(async db=>(await db.ref(p).get()).val());
const anonymous=()=>env.unauthenticatedContext().database();
const db=s=>env.authenticatedContext(uid(s),{
  [claim(s)]:true
}).database();
const registry=()=>Object.fromEntries(streams.map(s=>[s,{
  enabled:true,epoch:1,
  reportPublicKey:keys[s].report.publicKey,
  issuerPublicKey:keys[s].issuer.publicKey
}]));
const issue=async(s,canonical)=>signText(s,'issuer',canonical);
const gate=(options={})=>createR3ServerVerifiedIngestLab({
  registry:registry(),clock:()=>now,
  issueSignedReceipt:issue,databaseForStream:db,...options
});
before(async()=>{
  const rules=readFileSync(
    'docs/firebase/r3-atomic-dual-attestation-lab.rules.json','utf8'
  );
  env=await initializeTestEnvironment({
    projectId:'demo-fg-r3-gated-ingest',
    database:{host:'127.0.0.1',port:9000,rules}
  });
});
after(async()=>{if(env)await env.cleanup();});
beforeEach(async()=>{
  await env.clearDatabase();
  await admin(database=>database.ref(base).set({
    attestedEvidenceLabV1:{
      water:envelope('water',1,{
        observedAtMs:now-5000,receivedAtMs:now-4000
      }),
      rain:envelope('rain',1,{
        observedAtMs:now-5000,receivedAtMs:now-4000
      })
    },
    attestedEvidenceLabAuthorization:Object.fromEntries(streams.map(s=>[
      uid(s),{enabled:true,scope:scope(s)}
    ])),
    confirmedIngest:{'device-stage-a':{secret:'TEST-ONLY'}},
    staging:{'device-stage-a':{networkKey:'TEST-PRIVATE'}},
    bot:{contacts:{test:'PRIVATE'}},
    live:{esp8266:{ip:'192.0.2.42',wifi:'PRIVATE'},
      gate:{status:'CLOSED',angle:0}}
  }));
});

test('independent signed gateway advances water and rain only at scoped atomic leaves',async()=>{
  const before=await readAdmin(base),x=gate();
  for(const s of streams){
    const result=await x.publish({stream:s,record:report(s)});
    assert.deepEqual(result,{
      published:true,kind:'EMULATOR_SCOPED_SIGNED_GATE_ONLY_NOT_PRODUCTION',
      requiresIndependentRecoveryAnchor:true
    });
    const published=(await anonymous().ref(path(s)).get()).val();
    assert.equal(published.report.payload.sequence,2);
    const verified=await verifyR3AtomicDualAttestation({
      stream:s,envelope:published,pins:pins[s],subtle:webcrypto.subtle,
      connected:true,nowMs:now
    });
    assert.equal(verified.verified,true);
    assert.equal(verified.productionBackendVerified,false);
    assert.equal(verified.physicalSafetyVerified,false);
  }
  const after=await readAdmin(base);
  for(const name of ['confirmedIngest','staging','bot','live',
    'attestedEvidenceLabAuthorization'])
    assert.deepEqual(after[name],before[name]);
  assert.equal(JSON.stringify(after.attestedEvidenceLabV1).includes('TEST-PRIVATE'),false);
});

test('forged signed report blocked before issuer is invoked or any DB write',async()=>{
  let signCalls=0;
  const x=gate({issueSignedReceipt:async(s,canon)=>{
    signCalls++;
    return issue(s,canon);
  }});
  const prior=await readAdmin(base);
  for(const s of streams){
    const next=report(s);
    for(const bad of [
      {...next,signature:'A'.repeat(86)},
      {...next,payload:{...next.payload,sequence:3}},
      report(s,2,{epoch:2})
    ])assert.equal((await x.publish({stream:s,record:bad})).published,false);
  }
  assert.equal(signCalls,0);
  assert.deepEqual(await readAdmin(base),prior);
});

test('operator registry pins cannot be substituted from hostile request',async()=>{
  const x=gate(),before=await readAdmin(base);
  const request={
    stream:'water',record:report('water'),
    trustedReportKey:keys.rain.report.publicKey,
    issuerSigner:keys.rain.issuer.privateKey,
    db:db('rain'),
    gateCommand:'OPEN',path:'/floodguard/live/gate'
  };
  assert.deepEqual(await x.publish(request),{
    published:false,reason:'untrusted-request-shape'
  });
  assert.deepEqual(await readAdmin(base),before);
});

test('revoked test publisher or cross-stream credential cannot write via gate',async()=>{
  const before=await readAdmin(base);
  await admin(db=>db.ref(base+'/attestedEvidenceLabAuthorization/'+
    uid('water')+'/enabled').set(false));
  const disabled=await gate().publish({stream:'water',record:report('water')});
  assert.equal(disabled.published,false);
  const swapped=gate({databaseForStream:s=>db(s==='water'?'rain':'water')});
  assert.equal((await swapped.publish({
    stream:'rain',record:report('rain')
  })).published,false);
  const after=await readAdmin(base);
  assert.deepEqual(after.attestedEvidenceLabV1,before.attestedEvidenceLabV1);
});

test('invalid historical report, receipt or digest blocks renewal and does not autoheal',async()=>{
  for(const defect of ['report','receipt','digest']){
    await admin(db=>db.ref(path('water')).set(envelope('water',1,{
      observedAtMs:now-5000,receivedAtMs:now-4000
    })));
    const corrupted=await readAdmin(path('water'));
    if(defect==='report')corrupted.report.signature='A'.repeat(86);
    if(defect==='receipt')corrupted.acceptance.signature='A'.repeat(86);
    if(defect==='digest')corrupted.acceptance.receipt.payloadDigest='0'.repeat(64);
    await admin(db=>db.ref(path('water')).set(corrupted));
    const result=await gate().publish({
      stream:'water',record:report('water')
    });
    assert.deepEqual(result,{
      published:false,reason:'published-checkpoint-unverified'
    });
    assert.deepEqual(await readAdmin(path('water')),corrupted);
  }
});

test('duplicate or competing sequence is allowed only once by atomic RTDB rules',async()=>{
  const x=gate(),[first,second]=await Promise.all([
    x.publish({stream:'rain',record:report('rain')}),
    x.publish({stream:'rain',record:report('rain')})
  ]);
  assert.equal([first,second].filter(i=>i.published).length,1);
  assert.equal((await readAdmin(path('rain'))).report.payload.sequence,2);
  assert.equal((await x.publish({
    stream:'rain',record:report('rain')
  })).published,false);
});

test('forged or missing issuer response rejects both streams without database mutation',async()=>{
  const before=await readAdmin(base);
  for(const issuer of [
    async()=>('A'.repeat(86)),
    async(s,canon)=>issue(s==='water'?'rain':'water',canon),
    async()=>{throw Error('issuer not reachable');}
  ]){
    const x=gate({issueSignedReceipt:issuer});
    assert.equal((await x.publish({
      stream:'water',record:report('water')
    })).published,false);
  }
  assert.deepEqual(await readAdmin(base),before);
});

test('direct scoped Firebase credential bypasses gateway, proving production gap',async()=>{
  const forged=envelope('water',2);
  forged.acceptance.signature='A'.repeat(86);
  // The scoped test credential is held by a malicious actor in this negative
  // demonstration. RTDB Rules CANNOT validate Ed25519. Protect this
  // credential inside an actual privileged gateway in any real deployment.
  await db('water').ref(path('water')).set(forged);
  const publicRecord=(await anonymous().ref(path('water')).get()).val();
  assert.equal(publicRecord.acceptance.signature,'A'.repeat(86));
  const checked=await verifyR3AtomicDualAttestation({
    stream:'water',envelope:publicRecord,
    pins:pins.water,subtle:webcrypto.subtle,connected:true,nowMs:now
  });
  assert.equal(checked.verified,false);
  assert.equal(checked.reason,'issuer-signature-unverified');
  assert.deepEqual(await gate().publish({
    stream:'water',record:report('water',3)
  }),{published:false,reason:'published-checkpoint-unverified'});
});

test('anonymous and private parent reads, cross-stream writes remain denied',async()=>{
  const reader=anonymous();
  await assertFails(reader.ref(base+'/attestedEvidenceLabV1').get());
  await assertFails(reader.ref(base+'/confirmedIngest').get());
  await assertFails(reader.ref(base+'/live/gate').get());
  await assertFails(reader.ref(path('rain')).set(envelope('rain',2)));
  await assertFails(db('water').ref(path('rain')).set(envelope('rain',2)));
  await assertFails(db('water').ref(base+'/live/gate').set({status:'OPEN'}));
});
