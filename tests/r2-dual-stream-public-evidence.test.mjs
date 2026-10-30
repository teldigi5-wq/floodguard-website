import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {
  R2_PUBLIC_PROOF_VERSION,canonicalR2PublicEvidence,verifyR2PublicEvidence
} from '../experiments/r2-dual-stream-public-evidence.mjs';

const now=Date.UTC(2026,9,30,10,0,0);
const waterKey=generateKeyPairSync('ed25519');
const rainKey=generateKeyPairSync('ed25519');
const payload=(stream='water',sequence=2)=>({
  version:R2_PUBLIC_PROOF_VERSION,
  stream,sourceAlias:stream==='water'?'water-primary':'rain-primary',
  epoch:1,sequence,observedAtMs:now-3500,receivedAtMs:now-2500,
  sample:stream==='water'
    ? {distanceCm:16.5,levelCm:8.5,reportedStatus:'WARNING'}
    : {currentMm:2,dailyMm:10,reportedStatus:'NORMAL'}
});
const signed=(p,privateKey)=>(Object.freeze({
  payload:p,signature:sign(null,Buffer.from(canonicalR2PublicEvidence(p),'utf8'),
    privateKey).toString('base64url')
}));
const proof=(stream='water',seq=2)=>{
  const k=stream==='water'?waterKey:rainKey;
  return {stream,record:signed(payload(stream,seq),k.privateKey),
    trustedPublicKey:k.publicKey,nowMs:now,connected:true};
};

test('two independent signed sensor reports are recent evidence, never a physical-safety assertion',()=>{
  for(const stream of ['water','rain']){
    const input=proof(stream);
    assert.deepEqual(verifyR2PublicEvidence(input),{
      accepted:true,stream,evidence:'FRESH_SIGNED_REPORT_NOT_PHYSICAL_PROOF'
    });
    assert.equal(JSON.stringify(input.record).includes('privateKey'),false);
  }
});
test('canonical bytes ignore property ordering, but unknown fields and commands fail',()=>{
  const p=payload();
  const reverse=Object.fromEntries(Object.entries(p).reverse());
  reverse.sample=Object.fromEntries(Object.entries(p.sample).reverse());
  assert.equal(canonicalR2PublicEvidence(p),canonicalR2PublicEvidence(reverse));
  for(const corrupted of [
    {...p,ip:'192.0.2.14'},
    {...p,deviceId:'device-stage-a'},
    {...p,gateCommand:'OPEN'},
    {...p,sample:{...p.sample,privateIp:'192.0.2.14'}},
    {...p,sourceAlias:'other'},
    {...p,epoch:0},
    {...p,sequence:0},
    {...p,observedAtMs:now+200000},
    {...p,receivedAtMs:p.observedAtMs-1},
    {...p,sample:{...p.sample,levelCm:8.4}},
    {...p,sample:{...p.sample,distanceCm:Infinity}},
    {...p,sample:{...p.sample,reportedStatus:'ALL_CLEAR'}}
  ])assert.throws(()=>canonicalR2PublicEvidence(corrupted));
  assert.throws(()=>canonicalR2PublicEvidence({...payload('rain'),
    sample:{currentMm:0,dailyMm:0,reportedStatus:'SAFE'}}));
});
test('tampering, cross-stream substitution, wrong issuer and extra record metadata fail closed',()=>{
  const input=proof('water');
  assert.equal(verifyR2PublicEvidence({...input,
    record:{...input.record,payload:{...input.record.payload,
      sample:{...input.record.payload.sample,levelCm:11}}}
  }).accepted,false);
  assert.equal(verifyR2PublicEvidence({...input,
    record:{...input.record,deviceId:'device-stage-a'}
  }).reason,'evidence-shape-invalid');
  assert.equal(verifyR2PublicEvidence({...input,
    trustedPublicKey:rainKey.publicKey
  }).reason,'signature-unverified');
  assert.equal(verifyR2PublicEvidence({...input,
    stream:'rain'
  }).reason,'evidence-shape-invalid');
  assert.equal(verifyR2PublicEvidence({...input,
    record:{...input.record,signature:'0'.repeat(86)}
  }).reason,'signature-unverified');
});
test('recent valid signature cannot survive old, future, offline or impossible source clocks',()=>{
  for(const stream of ['water','rain']){
    const good=proof(stream);
    for(const [opts,reason] of [
      [{connected:false},'observer-unavailable'],
      [{nowMs:now+16000},'source-not-current'],
      [{nowMs:now-12000},'source-not-current'],
      [{nowMs:NaN},'observer-unavailable']
    ])assert.equal(verifyR2PublicEvidence({...good,...opts}).reason,reason);
    const key=stream==='water'?waterKey:rainKey;
    const future={...good.record.payload,
      observedAtMs:now+10000,receivedAtMs:now+12000};
    assert.equal(verifyR2PublicEvidence({
      ...good,record:signed(future,key.privateKey)
    }).reason,'source-not-current');
  }
});
test('independent sequence fences do not permit replay or rollback on either stream',()=>{
  for(const stream of ['water','rain']){
    const input=proof(stream,3),p=input.record.payload;
    const prior={sourceAlias:p.sourceAlias,epoch:1,sequence:2,
      observedAtMs:p.observedAtMs-1000,receivedAtMs:p.receivedAtMs-1000};
    assert.equal(verifyR2PublicEvidence({...input,prior}).accepted,true);
    for(const bad of [
      {...prior,sequence:3},
      {...prior,epoch:2},
      {...prior,sourceAlias:'other'},
      {...prior,observedAtMs:p.observedAtMs+100},
      {...prior,receivedAtMs:p.receivedAtMs+100},
      {...prior,receivedAtMs:undefined},
      {...prior,sequence:undefined},
      {}
    ])assert.equal(verifyR2PublicEvidence({...input,prior:bad}).reason,
      'source-not-current');
  }
});
test('old signed water cannot become fresh because sibling rain or system timestamps change',()=>{
  const input=proof('water');
  const other={...input.record.payload,observedAtMs:now-60000,
    receivedAtMs:now-59000};
  const record=signed(other,waterKey.privateKey);
  assert.equal(verifyR2PublicEvidence({...input,record,
    systemLastUpdateMs:now,rainLastUpdateMs:now}).reason,'source-not-current');
});
test('public proof code never includes RTDB SDK, secrets or privileged mutation',()=>{
  const source=readFileSync('experiments/r2-dual-stream-public-evidence.mjs','utf8');
  assert.doesNotMatch(source,/firebase-admin|serviceAccount|process\.env|privateKey/);
  assert.doesNotMatch(source,/\b(?:fetch|XMLHttpRequest|WebSocket)\s*\(|\.ref\s*\(|\.set\s*\(|\.update\s*\(/);
  const provider=readFileSync('providers/flood-provider.tsx','utf8');
  assert.doesNotMatch(provider,/r2-dual-stream-public-evidence/);
});
