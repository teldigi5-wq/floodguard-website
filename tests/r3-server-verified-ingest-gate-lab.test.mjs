// R3 operator-pinned gateway tests: synthetic keys and fake scoped writer.
// No Firebase, hardware, ports, real devices or credentials.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash,generateKeyPairSync,sign,verify}
  from 'node:crypto';
import {readFileSync} from 'node:fs';
import {canonicalR2PublicEvidence,R2_PUBLIC_PROOF_VERSION}
  from '../experiments/r2-dual-stream-public-evidence.mjs';
import {canonicalR2PublisherReceipt,R2_ISSUER_RECEIPT_VERSION}
  from '../experiments/r2-attested-dual-stream-publisher.mjs';
import {createR3ServerVerifiedIngestLab}
  from '../experiments/r3-server-verified-ingest-gate-lab.mjs';
// Local in-memory adapter only. No emulator connection is made by this file.
process.env.FG_R3_TRUSTED_INGEST_LAB_TEST='1';
process.env.FIREBASE_DATABASE_EMULATOR_HOST='127.0.0.1:9000';
const now=Date.UTC(2026,9,31,14,0,0);
const streams=['water','rain'];
const keys=Object.fromEntries(streams.map(s=>[s,{
  report:generateKeyPairSync('ed25519'),
  issuer:generateKeyPairSync('ed25519')
}]));
const initialRegistry=()=>Object.fromEntries(streams.map(s=>[s,{
  enabled:true,epoch:1,
  reportPublicKey:keys[s].report.publicKey,
  issuerPublicKey:keys[s].issuer.publicKey
}]));
const sha256=text=>createHash('sha256').update(text,'utf8').digest('hex');
const signText=(text,role)=>sign(null,Buffer.from(text),role.privateKey)
  .toString('base64url');
function report(stream,seq=2,extra={}) {
  const payload={
    version:R2_PUBLIC_PROOF_VERSION,stream,sourceAlias:stream+'-primary',
    epoch:1,sequence:seq,observedAtMs:now-2500,
    receivedAtMs:now-1000,
    sample:stream==='water'
      ?{distanceCm:16,levelCm:9,reportedStatus:'WARNING'}
      :{currentMm:2,dailyMm:12,reportedStatus:'NORMAL'},
    ...extra
  };
  return {payload,signature:signText(canonicalR2PublicEvidence(payload),
    keys[stream].report)};
}
function envelope(stream,seq=1) {
  const record=report(stream,seq,{
    observedAtMs:now-4000,receivedAtMs:now-3000
  });
  const p=record.payload;
  const receipt={
    version:R2_ISSUER_RECEIPT_VERSION,stream,
    sourceAlias:p.sourceAlias,epoch:p.epoch,sequence:p.sequence,
    payloadDigest:sha256(canonicalR2PublicEvidence(p)),
    acceptedAtMs:p.receivedAtMs
  };
  return {report:record,acceptance:{
    receipt,signature:signText(canonicalR2PublisherReceipt(receipt),
      keys[stream].issuer)
  }};
}
function fixture({issuer,writer,clock,registry}={}) {
  const state={water:envelope('water'),rain:envelope('rain')},paths=[];
  const issueSignedReceipt=issuer??async(s,text)=>
    signText(text,keys[s].issuer);
  const databaseForStream=writer??s=>({
    ref:p=>{
      paths.push(p);
      if(p!=='/floodguard/attestedEvidenceLabV1/'+s)
        throw Error('bad database scope');
      return {
        get:async()=>({val:()=>state[s]}),
        set:async value=>{state[s]=value;}
      };
    }
  });
  const gate=createR3ServerVerifiedIngestLab({
    registry:registry??initialRegistry(),issueSignedReceipt,
    databaseForStream,clock:clock??(()=>now)
  });
  return {gate,state,paths};
}
test('gate refuses construction without explicit localhost opt-in',()=>{
  const old=process.env.FG_R3_TRUSTED_INGEST_LAB_TEST;
  try{
    delete process.env.FG_R3_TRUSTED_INGEST_LAB_TEST;
    assert.throws(()=>fixture(),/disabled outside loopback emulator/);
  }finally{
    if(old===undefined)delete process.env.FG_R3_TRUSTED_INGEST_LAB_TEST;
    else process.env.FG_R3_TRUSTED_INGEST_LAB_TEST=old;
  }
});

test('water and rain publish through separate pinned server capabilities',async()=>{
  const x=fixture();
  for(const stream of streams){
    const next=report(stream);
    const result=await x.gate.publish({stream,record:next});
    assert.deepEqual(result,{
      published:true,kind:'EMULATOR_SCOPED_SIGNED_GATE_ONLY_NOT_PRODUCTION',
      requiresIndependentRecoveryAnchor:true
    });
    const stored=x.state[stream];
    assert.deepEqual(stored.report,next);
    const receipt=stored.acceptance.receipt;
    assert.equal(receipt.payloadDigest,
      sha256(canonicalR2PublicEvidence(next.payload)));
    assert.equal(receipt.acceptedAtMs,next.payload.receivedAtMs);
    assert.equal(verify(null,Buffer.from(canonicalR2PublisherReceipt(receipt)),
      keys[stream].issuer.publicKey,
      Buffer.from(stored.acceptance.signature,'base64url')),true);
    assert.equal(JSON.stringify(result).includes('privateKey'),false);
  }
  assert.deepEqual(x.paths,[
    '/floodguard/attestedEvidenceLabV1/water',
    '/floodguard/attestedEvidenceLabV1/rain'
  ]);
});

test('forged and altered sensor frames cannot trigger issuer or writer',async()=>{
  let issued=0,writes=0;
  const x=fixture({
    issuer:async(s,t)=>{issued++;return signText(t,keys[s].issuer);},
    writer:s=>({ref:()=>({
      get:async()=>({val:()=>envelope(s)}),
      set:async()=>{writes++;}
    })})
  });
  const valid=report('water');
  for(const bad of [
    {payload:valid.payload,signature:'A'.repeat(86)},
    {...valid,payload:{...valid.payload,sample:{
      distanceCm:15,levelCm:10,reportedStatus:'SAFE'
    }}},
    {...valid,operatorRegistry:{enabled:true}},
    report('water',2,{epoch:2}),
    report('water',2,{receivedAtMs:now-8000})
  ]){
    assert.equal((await x.gate.publish({stream:'water',record:bad})).published,
      false);
  }
  assert.equal(issued,0);
  assert.equal(writes,0);
});

test('request cannot override the issuer identity, a database or destination',async()=>{
  const x=fixture(),untrusted=generateKeyPairSync('ed25519');
  const legitimate=report('water');
  const attempt={stream:'water',record:legitimate,
    issuerPrivateKey:untrusted.privateKey,registry:{water:{enabled:true}},
    receiptSignature:'A'.repeat(86),path:'/floodguard/live/gate',
    database:{ref:()=>{throw Error('must never be called');}}};
  assert.deepEqual(await x.gate.publish(attempt),{
    published:false,reason:'untrusted-request-shape'
  });
  assert.deepEqual(x.paths,[]);
  assert.equal(x.state.water.report.payload.sequence,1);
});

test('operator registry rejects duplicate roles, missing streams and disabled identity',()=>{
  assert.throws(()=>fixture({registry:{water:initialRegistry().water}}),
    /Operator registry/);
  const duplicated=initialRegistry();
  duplicated.water.issuerPublicKey=duplicated.water.reportPublicKey;
  assert.throws(()=>fixture({registry:duplicated}),/public keys must be distinct/);
  const disabled=initialRegistry();
  disabled.rain.enabled=false;
  assert.throws(()=>fixture({registry:disabled}),/operator-enrolled/);
});

test('operator-provisioned trust cannot be re-enabled or replaced by request',async()=>{
  const registry=initialRegistry(),x=fixture({registry});
  registry.water.enabled=false;
  registry.water.epoch=4;
  registry.water.reportPublicKey=generateKeyPairSync('ed25519').publicKey;
  assert.equal((await x.gate.publish({
    stream:'water',record:report('water')
  })).published,true);
  assert.equal(x.state.water.report.payload.sequence,2);
});

test('forged issuer response, cross-stream issuer, issuer downtime fail closed',async()=>{
  let writes=0;
  const make=issuer=>fixture({
    issuer,writer:s=>({ref:()=>({
      get:async()=>({val:()=>envelope(s)}),
      set:async()=>{writes++;}
    })})
  });
  for(const issue of [
    async()=>('A'.repeat(86)),
    async(s,t)=>signText(t,keys[s==='water'?'rain':'water'].issuer),
    async()=>{throw Error('issuer offline');}
  ])assert.equal((await make(issue).gate.publish({
    stream:'water',record:report('water')
  })).published,false);
  assert.equal(writes,0);
});

test('stored forged receipt or report requires operator recovery, never overwrite',async()=>{
  for(const mode of ['report','issuer','digest']){
    let wrote=false;
    const fake=envelope('water');
    if(mode==='report')fake.report.signature='A'.repeat(86);
    if(mode==='issuer')fake.acceptance.signature='A'.repeat(86);
    if(mode==='digest')fake.acceptance.receipt.payloadDigest='0'.repeat(64);
    const x=fixture({writer:()=>({ref:()=>({
      get:async()=>({val:()=>fake}),
      set:async()=>{wrote=true;}
    })})});
    assert.deepEqual(await x.gate.publish({
      stream:'water',record:report('water')
    }),{published:false,reason:'published-checkpoint-unverified'});
    assert.equal(wrote,false);
  }
});

test('same or earlier sequence and older source timestamps are refused',async()=>{
  const x=fixture();
  assert.equal((await x.gate.publish({
    stream:'water',record:report('water',1)
  })).reason,'publication-replay-or-rollback');
  assert.equal((await x.gate.publish({
    stream:'water',record:report('water',2,{
      observedAtMs:now-5000,receivedAtMs:now-1000
    })
  })).reason,'publication-replay-or-rollback');
  assert.equal(x.state.water.report.payload.sequence,1);
});

test('transport failure outcome is unknown, no automatic retry or checkpoint reset',async()=>{
  let attempts=0;
  const x=fixture({writer:()=>({ref:()=>({
    get:async()=>({val:()=>envelope('water')}),
    set:async()=>{attempts++;throw Error('lost acknowledgement');}
  })})});
  assert.deepEqual(await x.gate.publish({
    stream:'water',record:report('water')
  }),{published:false,reason:'publication-outcome-unconfirmed'});
  assert.equal(attempts,1);
});

test('close stops further writes and test-only source contains no server endpoints',async()=>{
  const x=fixture();x.gate.close();
  assert.deepEqual(await x.gate.publish({
    stream:'water',record:report('water')
  }),{published:false,reason:'gateway-closed'});
  const text=readFileSync('experiments/r3-server-verified-ingest-gate-lab.mjs',
    'utf8');
  assert.doesNotMatch(text,/firebase-admin|serviceAccount|node:http|node:https|node:net|sendMessage\s*\(/);
  assert.doesNotMatch(text,/\b(?:fetch|WebSocket|XMLHttpRequest)\s*\(|privateKey/);
});
