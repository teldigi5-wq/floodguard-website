import {test} from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign,webcrypto} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {canonicalR2PublicEvidence,R2_PUBLIC_PROOF_VERSION}
  from '../experiments/r2-dual-stream-public-evidence.mjs';
import {canonicalR3BrowserPublicEvidence,verifyR3BrowserPublicReport,
  createR3ReadOnlyEvidenceObserver}
  from '../experiments/r3-browser-readonly-evidence-lab.mjs';

const now=Date.UTC(2026,9,31,0,0,0);
const keys={water:generateKeyPairSync('ed25519'),
  rain:generateKeyPairSync('ed25519')};
const b64=x=>Buffer.from(x).toString('base64url');
const pins=Object.fromEntries(Object.entries(keys).map(([name,k])=>
  [name,b64(k.publicKey.export({format:'der',type:'spki'}))]));
const payload=(stream,seq=1,extra={})=>({
  version:R2_PUBLIC_PROOF_VERSION,stream,
  sourceAlias:stream==='water'?'water-primary':'rain-primary',
  epoch:1,sequence:seq,observedAtMs:now-3000,
  receivedAtMs:now-2000,
  sample:stream==='water'
    ?{distanceCm:16.5,levelCm:8.5,reportedStatus:'WARNING'}
    :{currentMm:1,dailyMm:12,reportedStatus:'NORMAL'},
  ...extra
});
const record=p=>({
  payload:p,signature:sign(null,Buffer.from(canonicalR2PublicEvidence(p)),
    keys[p.stream].privateKey).toString('base64url')
});
const check=(stream,rec,extra={})=>verifyR3BrowserPublicReport({
  stream,record:rec,spkiBase64url:pins[stream],subtle:webcrypto.subtle,
  connected:true,nowMs:now,...extra
});
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(p) {
  for(let i=0;i<100;i++){
    if(p())return;
    await sleep(5);
  }
  throw new Error('Observer output did not become ready');
}
function bus({subtle=webcrypto.subtle}={}){
  const listeners=new Map(),paths=[],outputs=[];
  let time=now;
  const subscribe=(path,onValue,onError)=>{
    paths.push(path);
    listeners.set(path,{onValue,onError});
    return ()=>listeners.delete(path);
  };
  const observer=createR3ReadOnlyEvidenceObserver({
    subscribe,spkiPins:pins,subtle,clock:()=>time,
    onChange:value=>outputs.push(value)
  });
  const handle=observer.start();
  return {handle,paths,outputs,
    fire:(p,value)=>listeners.get(p).onValue(value),
    fail:p=>listeners.get(p).onError(new Error('test-denied')),
    time:value=>time=value,
    listeners};
}
const water='/floodguard/evidenceLabV1/water';
const rain='/floodguard/evidenceLabV1/rain';

test('R3 browser canonical bytes match signed R2 Node contract exactly for both streams',()=>{
  for(const stream of ['water','rain']){
    const p=payload(stream);
    assert.equal(canonicalR3BrowserPublicEvidence(p),
      canonicalR2PublicEvidence(p));
    const reversed=Object.fromEntries(Object.entries(p).reverse());
    reversed.sample=Object.fromEntries(Object.entries(p.sample).reverse());
    assert.equal(canonicalR3BrowserPublicEvidence(reversed),
      canonicalR2PublicEvidence(p));
  }
});

test('browser WebCrypto Ed25519 verifies separately pinned water and rain reports',async()=>{
  for(const stream of ['water','rain']){
    const verified=await check(stream,record(payload(stream)));
    assert.equal(verified.verified,true);
    assert.equal(verified.kind,'SIGNED_REPORT_ONLY_NOT_INGESTION_OR_PHYSICAL_PROOF');
    assert.equal(verified.report.sourceAlias,stream+'-primary');
    assert.equal(verified.report.sequence,1);
    assert.equal(verified.report.reportedStatus,stream==='water'?'WARNING':'NORMAL');
    assert.equal(verified.report.interpretedStatus,stream==='water'?'WARNING':'NORMAL');
    assert.equal(Object.hasOwn(verified,'physicalSafetyVerified'),false);
  }
});

test('tamper, wrong stream, extra metadata, and swapped trust anchor fail closed',async()=>{
  const p=payload('water'),r=record(p);
  const wrong={...r,payload:{...r.payload,sample:{
    distanceCm:16,levelCm:9,reportedStatus:'SAFE'
  }}};
  assert.equal((await check('water',wrong)).reason,'report-signature-unverified');
  assert.equal((await check('water',{...r,deviceId:'private'})).reason,
    'report-shape-invalid');
  assert.equal((await check('rain',r)).reason,'report-shape-invalid');
  assert.equal((await check('water',r,{
    spkiBase64url:pins.rain
  })).reason,'report-signature-unverified');
  assert.equal((await check('water',r,{spkiBase64url:null})).verified,false);
  assert.equal((await check('water',r,{subtle:null})).reason,
    'browser-ed25519-unavailable');
  assert.equal((await check('water',r,{connected:false})).reason,
    'observer-unavailable');
});

test('browser rejects future, stale, epoch replay, monotonic clock rollback and invalid sample',async()=>{
  for(const stream of ['water','rain']){
    const r=record(payload(stream,2));
    assert.equal((await check(stream,r,{nowMs:now+16000})).reason,
      'source-not-current');
    assert.equal((await check(stream,r,{nowMs:now-20000})).reason,
      'source-not-current');
    assert.equal((await check(stream,r,{
      prior:{sourceAlias:stream+'-primary',epoch:1,sequence:2,
        observedAtMs:now-4000,receivedAtMs:now-3000}
    })).reason,'source-not-current');
    assert.equal((await check(stream,r,{
      prior:{sourceAlias:stream+'-primary',epoch:2,sequence:1,
        observedAtMs:now-4000,receivedAtMs:now-3000}
    })).reason,'source-not-current');
    assert.equal((await check(stream,r,{
      prior:{sourceAlias:stream+'-primary',epoch:1,sequence:1,
        observedAtMs:now+200,receivedAtMs:now+600}
    })).reason,'source-not-current');
  }
  assert.throws(()=>canonicalR3BrowserPublicEvidence({
    ...payload('water'),sample:{...payload('water').sample,ip:'192.0.2.1'}
  }));
  assert.throws(()=>canonicalR3BrowserPublicEvidence({
    ...payload('rain'),sample:{currentMm:0,dailyMm:0,reportedStatus:'SAFE'}
  }));
});

test('fixed-path observer separates streams and never publishes physical safe/clear',async()=>{
  const x=bus();
  assert.deepEqual(x.paths,['.info/connected',water,rain]);
  assert.equal(x.handle.snapshot().productionCutoverApproved,false);
  x.fire('.info/connected',true);
  x.fire(water,record(payload('water',1)));
  x.fire(rain,record(payload('rain',1)));
  await until(()=>x.handle.snapshot().water.status==='report-only'&&
    x.handle.snapshot().rain.status==='report-only');
  const snapshot=x.handle.snapshot();
  assert.equal(snapshot.backendReceiptVerified,false);
  assert.equal(snapshot.physicalSafetyVerified,false);
  assert.equal(snapshot.water.report.interpretedStatus,'WARNING');
  assert.equal(snapshot.rain.report.interpretedStatus,'NORMAL');
  assert.equal(JSON.stringify(snapshot).includes('firebase-admin'),false);
  x.handle.close();
  assert.equal(x.listeners.size,0);
});

test('invalid water does not overwrite valid rain, and disconnected snapshots are stale',async()=>{
  const x=bus();
  x.fire('.info/connected',true);
  x.fire(rain,record(payload('rain')));
  await until(()=>x.handle.snapshot().rain.status==='report-only');
  x.fire(water,{payload:{deviceId:'test'},signature:'forged'});
  await until(()=>x.handle.snapshot().water.status==='invalid');
  assert.equal(x.handle.snapshot().rain.status,'report-only');
  x.fire('.info/connected',false);
  assert.equal(x.handle.snapshot().water.status,'stale');
  assert.equal(x.handle.snapshot().rain.status,'stale');
  x.handle.close();
});

test('replayed duplicate and source epoch switch fail rather than claim new evidence',async()=>{
  const x=bus();
  x.fire('.info/connected',true);
  x.fire(water,record(payload('water',2)));
  await until(()=>x.handle.snapshot().water.status==='report-only');
  x.fire(water,record(payload('water',2)));
  await until(()=>x.handle.snapshot().water.status==='invalid');
  assert.equal(x.handle.snapshot().water.reason,'source-not-current');
  x.fire(water,record(payload('water',3,{epoch:2})));
  await until(()=>x.handle.snapshot().water.status==='invalid'&&
    x.handle.snapshot().water.reason==='source-not-current');
  x.handle.close();
});

test('slow signature verification cannot overwrite a newer valid callback',async()=>{
  let release;
  const gate=new Promise(resolve=>{release=resolve;});
  let verifies=0;
  const slow={
    importKey:(...args)=>webcrypto.subtle.importKey(...args),
    verify:async(...args)=>{
      verifies++;
      if(verifies===1)await gate;
      return webcrypto.subtle.verify(...args);
    }
  };
  const x=bus({subtle:slow});
  x.fire('.info/connected',true);
  x.fire(water,record(payload('water',2)));
  await until(()=>verifies===1);
  x.fire(water,record(payload('water',3)));
  await until(()=>x.handle.snapshot().water.status==='report-only');
  assert.equal(x.handle.snapshot().water.report.sequence,3);
  release();
  await sleep(20);
  assert.equal(x.handle.snapshot().water.report.sequence,3);
  x.handle.close();
});

test('aging, permission denial and close are fail closed, with no private subscriptions',async()=>{
  const x=bus();
  x.fire('.info/connected',true);
  x.fire(water,record(payload('water')));
  await until(()=>x.handle.snapshot().water.status==='report-only');
  x.time(now+15000);
  x.handle.refresh();
  assert.equal(x.handle.snapshot().water.status,'stale');
  x.fail(rain);
  assert.equal(x.handle.snapshot().rain.status,'unavailable');
  x.handle.close();
  assert.equal(x.listeners.size,0);
  assert.deepEqual(x.paths,['.info/connected',water,rain]);
  assert.doesNotMatch(x.paths.join('|'),/confirmedIngest|gate|bot|ip|wifi|contacts/);
});

test('browser lab module contains no Node crypto, Firebase SDK, production provider or writes',()=>{
  const src=readFileSync('experiments/r3-browser-readonly-evidence-lab.mjs','utf8');
  assert.doesNotMatch(src,/node:crypto|firebase-admin|firebase\/database|process\.env/);
  assert.doesNotMatch(src,/\.set\s*\(|\.update\s*\(|\.push\s*\(|\.transaction\s*\(|sendMessage\s*\(/);
  const provider=readFileSync('providers/flood-provider.tsx','utf8');
  assert.doesNotMatch(provider,/r3-browser-readonly-evidence-lab/);
});
