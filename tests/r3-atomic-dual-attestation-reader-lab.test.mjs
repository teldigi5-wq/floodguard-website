import {test} from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign,createHash,webcrypto} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {R2_PUBLIC_PROOF_VERSION,canonicalR2PublicEvidence}
  from '../experiments/r2-dual-stream-public-evidence.mjs';
import {R2_ISSUER_RECEIPT_VERSION,canonicalR2PublisherReceipt}
  from '../experiments/r2-attested-dual-stream-publisher.mjs';
import {canonicalR3BrowserIssuerReceipt,verifyR3AtomicDualAttestation,
  createR3AtomicDualObserver}
  from '../experiments/r3-atomic-dual-attestation-reader-lab.mjs';

const t=Date.UTC(2026,9,31,10,0,0);
const streams=['water','rain'];
const pairs=Object.fromEntries(streams.map(s=>[s,{
  report:generateKeyPairSync('ed25519'),
  issuer:generateKeyPairSync('ed25519')
}]));
const pins=Object.fromEntries(streams.map(s=>[s,{
  report:pairs[s].report.publicKey.export({type:'spki',format:'der'})
    .toString('base64url'),
  issuer:pairs[s].issuer.publicKey.export({type:'spki',format:'der'})
    .toString('base64url')
}]));
const digest=txt=>createHash('sha256').update(txt,'utf8').digest('hex');
const signed=(str,pair)=>sign(null,Buffer.from(str),pair.privateKey)
  .toString('base64url');
function envelope(stream,sequence=1,modify={}) {
  const p={
    version:R2_PUBLIC_PROOF_VERSION,stream,sourceAlias:stream+'-primary',
    epoch:1,sequence,observedAtMs:t-3000+sequence,
    receivedAtMs:t-2000+sequence,
    sample:stream==='water'
      ?{distanceCm:16,levelCm:9,reportedStatus:'WARNING'}
      :{currentMm:2,dailyMm:14,reportedStatus:'NORMAL'},
    ...modify
  };
  const report={payload:p,signature:signed(canonicalR2PublicEvidence(p),
    pairs[stream].report)};
  const receipt={
    version:R2_ISSUER_RECEIPT_VERSION,stream,sourceAlias:stream+'-primary',
    epoch:p.epoch,sequence:p.sequence,
    payloadDigest:digest(canonicalR2PublicEvidence(p)),
    acceptedAtMs:p.receivedAtMs
  };
  return {report,acceptance:{receipt,
    signature:signed(canonicalR2PublisherReceipt(receipt),
      pairs[stream].issuer)}};
}
const verify=(stream,e,extra={})=>verifyR3AtomicDualAttestation({
  stream,envelope:e,pins:pins[stream],subtle:webcrypto.subtle,
  connected:true,nowMs:t,...extra
});
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(testCondition) {
  for(let i=0;i<120;i++){
    if(testCondition())return;
    await pause(5);
  }
  throw Error('Did not observe proof state');
}
function harness(crypto=webcrypto.subtle) {
  const handlers=new Map(),paths=[],events=[];
  let time=t;
  const obs=createR3AtomicDualObserver({
    subscribe:(path,success,failure)=>{
      paths.push(path);handlers.set(path,{success,failure});
      return ()=>handlers.delete(path);
    },
    pins,subtle:crypto,clock:()=>time,
    onChange:v=>events.push(v)
  });
  const api=obs.start();
  return {api,paths,events,handlers,
    send:(path,x)=>handlers.get(path).success(x),
    deny:path=>handlers.get(path).failure(Error('unauthorized')),
    now:v=>time=v};
}
const water='/floodguard/attestedEvidenceLabV1/water';
const rain='/floodguard/attestedEvidenceLabV1/rain';

test('browser canonical issuer receipt matches R2 Node signer exactly',()=>{
  for(const s of streams){
    const value=envelope(s).acceptance.receipt;
    assert.equal(canonicalR3BrowserIssuerReceipt(value),
      canonicalR2PublisherReceipt(value));
    assert.equal(canonicalR3BrowserIssuerReceipt(
      Object.fromEntries(Object.entries(value).reverse())),
      canonicalR2PublisherReceipt(value));
    for(const bad of [
      {...value,ip:'192.0.2.1'}, {...value,gateCommand:'OPEN'},
      {...value,payloadDigest:'none'},{...value,sequence:0},
      {...value,acceptedAtMs:-1}
    ])assert.throws(()=>canonicalR3BrowserIssuerReceipt(bad));
  }
});

test('browser accepts a fully bound report and distinct signed synthetic receipt',async()=>{
  for(const s of streams){
    const v=await verify(s,envelope(s));
    assert.equal(v.verified,true);
    assert.equal(v.kind,'SYNTHETIC_DUAL_SIGNATURES_NOT_BACKEND_OR_PHYSICAL_PROOF');
    assert.equal(v.syntheticIssuerSignatureVerified,true);
    assert.equal(v.productionBackendVerified,false);
    assert.equal(v.physicalSafetyVerified,false);
    assert.equal(v.report.interpretedStatus,s==='water'?'WARNING':'NORMAL');
    assert.equal(JSON.stringify(v).includes('receipt'),false);
  }
});

test('forged report, forged issuer, wrong pins, and one reused signing identity fail',async()=>{
  const x=envelope('water');
  assert.equal((await verify('water',{...x,report:{
    ...x.report,signature:'A'.repeat(86)
  }})).reason,'report-report-signature-unverified');
  assert.equal((await verify('water',{...x,acceptance:{
    ...x.acceptance,signature:'A'.repeat(86)
  }})).reason,'issuer-signature-unverified');
  assert.equal((await verify('water',x,{pins:pins.rain})).verified,false);
  assert.equal((await verify('water',x,{pins:{
    report:pins.water.report,issuer:pins.water.report
  }})).reason,'issuer-must-be-independent');
  assert.equal((await verify('water',x,{pins:null})).reason,
    'independent-trust-pins-unavailable');
});

test('receipt sequence, digest, epoch and timestamp mismatches fail even with valid receipt signatures',async()=>{
  const s='rain',x=envelope(s);
  for(const update of [
    {sequence:2},{payloadDigest:'0'.repeat(64)},
    {acceptedAtMs:x.acceptance.receipt.acceptedAtMs+1},
    {epoch:2}
  ]){
    const receipt={...x.acceptance.receipt,...update};
    const signature=signed(canonicalR2PublisherReceipt(receipt),
      pairs[s].issuer);
    const v=await verify(s,{...x,acceptance:{receipt,signature}});
    assert.equal(v.verified,false);
    assert.match(v.reason,/receipt-report-binding-invalid|receipt-payload-digest-mismatch/);
  }
});

test('unsigned, malformed, cross-source, old and future reports never pass',async()=>{
  const x=envelope('water');
  assert.equal((await verify('water',{report:x.report})).reason,
    'atomic-envelope-shape-invalid');
  assert.equal((await verify('rain',x)).verified,false);
  assert.equal((await verify('water',x,{connected:false})).verified,false);
  assert.equal((await verify('water',x,{nowMs:t+20000})).reason,
    'report-source-not-current');
  assert.equal((await verify('water',x,{nowMs:t-20000})).reason,
    'report-source-not-current');
  assert.equal((await verify('water',x,{subtle:null})).reason,
    'browser-crypto-unavailable');
});

test('independent water/rain observer subscribes only to atomic public leaves',async()=>{
  const h=harness();
  assert.deepEqual(h.paths,['.info/connected',water,rain]);
  h.send('.info/connected',true);
  h.send(water,envelope('water'));
  h.send(rain,envelope('rain'));
  await until(()=>h.api.snapshot().water.status==='signed-lab-only'&&
    h.api.snapshot().rain.status==='signed-lab-only');
  const x=h.api.snapshot();
  assert.equal(x.productionBackendVerified,false);
  assert.equal(x.physicalSafetyVerified,false);
  assert.equal(x.productionCutoverApproved,false);
  assert.equal(x.water.report.levelCm,9);
  assert.equal(x.rain.report.dailyMm,14);
  h.api.close();
  assert.equal(h.handlers.size,0);
});

test('a forged issuer blocks only that stream, not a valid sibling',async()=>{
  const h=harness();
  h.send('.info/connected',true);
  h.send(water,envelope('water'));
  h.send(rain,envelope('rain'));
  await until(()=>h.api.snapshot().water.status==='signed-lab-only'&&
    h.api.snapshot().rain.status==='signed-lab-only');
  const corrupted=envelope('water',2);
  corrupted.acceptance.signature='A'.repeat(86);
  h.send(water,corrupted);
  await until(()=>h.api.snapshot().water.status==='invalid');
  assert.equal(h.api.snapshot().rain.status,'signed-lab-only');
  h.api.close();
});

test('replay, missing receipt, disconnection and source timeout fail closed',async()=>{
  const h=harness();
  h.send('.info/connected',true);
  h.send(water,envelope('water',2));
  await until(()=>h.api.snapshot().water.status==='signed-lab-only');
  h.send(water,envelope('water',2));
  await until(()=>h.api.snapshot().water.status==='invalid');
  assert.equal(h.api.snapshot().water.reason,'report-source-not-current');
  h.send(rain,null);
  assert.equal(h.api.snapshot().rain.status,'unavailable');
  h.send('.info/connected',false);
  assert.equal(h.api.snapshot().water.status,'stale');
  h.send('.info/connected',true);
  h.send(water,envelope('water',3));
  await until(()=>h.api.snapshot().water.status==='signed-lab-only');
  h.now(t+20000);
  h.api.refresh();
  assert.equal(h.api.snapshot().water.status,'stale');
  h.api.close();
});

test('slow earlier verification cannot overwrite a newer accepted snapshot',async()=>{
  let open;
  const pending=new Promise(resolve=>{open=resolve;});
  let calls=0;
  const slow={
    importKey:(...args)=>webcrypto.subtle.importKey(...args),
    digest:(...args)=>webcrypto.subtle.digest(...args),
    verify:async(...args)=>{
      calls++;
      if(calls===1)await pending;
      return webcrypto.subtle.verify(...args);
    }
  };
  const h=harness(slow);
  h.send('.info/connected',true);
  h.send(water,envelope('water',2));
  await until(()=>calls===1);
  h.send(water,envelope('water',3));
  await until(()=>h.api.snapshot().water.status==='signed-lab-only');
  assert.equal(h.api.snapshot().water.report.sequence,3);
  open();
  await pause(25);
  assert.equal(h.api.snapshot().water.report.sequence,3);
  h.api.close();
});

test('lab has no Node crypto, Firebase SDK, private credentials, or write endpoints',()=>{
  const source=readFileSync(
    'experiments/r3-atomic-dual-attestation-reader-lab.mjs','utf8'
  );
  assert.doesNotMatch(source,/node:crypto|firebase-admin|firebase\/database|process\.env|sendMessage\s*\(/);
  assert.doesNotMatch(source,/\b(?:fetch|XMLHttpRequest|WebSocket)\s*\(|\b(?:db|database|ref)\s*\.\s*(?:set|update|push|transaction)\s*\(/);
  assert.doesNotMatch(readFileSync('providers/flood-provider.tsx','utf8'),
    /r3-atomic-dual-attestation-reader-lab/);
});
