import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  validateSyntheticFrame,inspectSyntheticLegacyUpload,calculateSyntheticBackoff,
  createSyntheticOfflineQueue,createSyntheticGatewayHarness
} from '../experiments/offline-ingestion-gateway.mjs';

const frame=(seq,extra={})=>({sequence:seq,distanceCm:18.5,levelCm:6.5,risk:'SAFE',...extra});
const make=()=>{
  let ms=1000;
  const gateway=createSyntheticGatewayHarness({clock:()=>ms});
  gateway.provision('device-stage-a');
  gateway.provision('device-stage-b');
  const token=gateway.issueSyntheticToken('device-stage-a',{ttlMs:2000});
  const transportProof=gateway.issueSyntheticTransportProof();
  return {gateway,token,transportProof,advance:(by)=>{ms+=by;}};
};
test('accepted frame schema exactly matches four validated Stage 5 emulator fields',()=>{
  const rules=JSON.parse(readFileSync('docs/firebase/phase-b-authenticated-prototype.rules.json','utf8'));
  const stage=rules.rules.floodguard.staging.ingestV1.$deviceId;
  assert.deepEqual(Object.keys(stage).filter(x=>!x.startsWith('.')).sort(),Object.keys(frame(1)).sort().concat('$other').sort());
  const validation=validateSyntheticFrame(frame(1));
  assert.equal(validation.ok,true);
  assert.equal(Object.isFrozen(validation.frame),true);
});
test('reject unknown and private keys, missing fields, malformed and oversized frames',()=>{
  for(const bad of [
    {...frame(1),debug:true},{...frame(1),ip:'192.0.2.1'},
    {...frame(1),wifi:'TEST'}, {sequence:1,distanceCm:15,levelCm:10},
    null,[],{},'hello',{...frame(1),__proto__:null,extra:'x'},
    frame(1,{risk:'OK'}),frame(1,{risk:null}),
    frame(1,{distanceCm:Infinity}),frame(1,{distanceCm:NaN}),
    frame(1,{distanceCm:401}),frame(1,{levelCm:25.01}),
    frame(1,{sequence:1.1}),frame(0),frame(2147483648),frame('1'),
    {...frame(1),padding:'X'.repeat(1000)}
  ])assert.equal(validateSyntheticFrame(bad).ok,false);
  assert.equal(validateSyntheticFrame(frame(1,{risk:'SENSOR_ERROR'})).ok,true);
});
test('strict synthetic ingestion rejects impossible or contradictory physical tuples',()=>{
  const rejects=[
    [frame(1,{distanceCm:400,levelCm:0,risk:'SAFE'}),'invalid-distance'],
    [frame(1,{distanceCm:26,levelCm:0,risk:'SAFE'}),'invalid-distance'],
    [frame(1,{distanceCm:0,levelCm:25,risk:'DANGER'}),'invalid-distance'],
    [frame(1,{distanceCm:20,levelCm:0,risk:'SAFE'}),'inconsistent-installation-depth'],
    [frame(1,{distanceCm:20,levelCm:10,risk:'WARNING'}),'inconsistent-installation-depth'],
    [frame(1,{distanceCm:14,levelCm:11,risk:'SAFE'}),'inconsistent-water-risk'],
    [frame(1,{distanceCm:16.5,levelCm:8.5,risk:'SAFE'}),'inconsistent-water-risk'],
    [frame(1,{distanceCm:25,levelCm:0,risk:'DANGER'}),'inconsistent-water-risk']
  ];
  for(const [candidate,reason] of rejects)
    assert.equal(validateSyntheticFrame(candidate).reason,reason,
      JSON.stringify(candidate));
  for(const value of [
    frame(1),
    frame(2,{distanceCm:16.5,levelCm:8.5,risk:'WARNING'}),
    frame(3,{distanceCm:14,levelCm:11,risk:'DANGER'}),
    frame(4,{distanceCm:18.51,levelCm:6.49,risk:'SAFE'}),
    frame(5,{distanceCm:25,levelCm:0,risk:'SENSOR_ERROR'})
  ])assert.equal(validateSyntheticFrame(value).ok,true,JSON.stringify(value));
});

test('fake authenticated gateway and offline queue reject self-contradictory frames',()=>{
  const x=make();
  const credentials={token:x.token,transportProof:x.transportProof};
  const bad=frame(1,{distanceCm:400,levelCm:0,risk:'SAFE'});
  assert.equal(x.gateway.accept({...credentials,frame:bad}).accepted,false);
  assert.equal(x.gateway.lastAcceptedSequence('device-stage-a'),0);
  const queue=createSyntheticOfflineQueue();
  assert.equal(queue.enqueue(bad).accepted,false);
  assert.equal(queue.depth,0);
  assert.equal(x.gateway.accept({...credentials,frame:frame(1)}).accepted,true);
});

test('phase-b prototype Firebase rules do not yet enforce calibrated tuple agreement',()=>{
  const rules=JSON.parse(readFileSync(
    'docs/firebase/phase-b-authenticated-prototype.rules.json','utf8'));
  const lane=rules.rules.floodguard.staging.ingestV1.$deviceId;
  assert.match(lane.distanceCm['.validate'],/400/);
  assert.match(lane.levelCm['.validate'],/25/);
  // The rule compares each child to a range, NOT distance+level consistency
  // or risk with the 8.5/11cm thresholds. Keep this release gap explicit.
  const expressions=[lane['.validate'],lane.distanceCm['.validate'],
    lane.levelCm['.validate'],lane.risk['.validate']].join(' ');
  assert.doesNotMatch(expressions,/25\s*-\s*newData\.child\('distanceCm'\)/);
  assert.doesNotMatch(expressions,/8\.5|>=\s*11/);
});

test('legacy whole-live PUT and root PATCH cannot silently become authenticated staging writes',()=>{
  const put={
    water:{distanceCm:15.35,levelCm:9.65,status:'WARNING'},
    esp8266:{status:'ONLINE',ip:'192.0.2.9',wifi:'EXAMPLE-ONLY'},
    system:{lastUpdate:1720000000000}
  };
  const patch={
    'water/distanceCm':15.35,'water/levelCm':9.65,'water/status':'WARNING',
    'esp8266/ip':'192.0.2.9','esp8266/wifi':'EXAMPLE-ONLY','system/lastUpdate':1720000000000
  };
  for(const [method,payload] of [['PUT',put],['PATCH',patch]]){
    const result=inspectSyntheticLegacyUpload({method,path:'/floodguard/live',payload});
    assert.equal(result.canForward,false);
    assert.equal(result.authenticated,false);
    assert.equal(result.privateMetadataPresent,true);
    assert.equal(result.sequenceAvailable,false);
    assert.equal(result.requiredWaterFieldsPresent,true);
    assert.doesNotMatch(JSON.stringify(result),/192\.0\.2\.9|EXAMPLE-ONLY/);
  }
});
test('legacy upload parser fails closed on unsafe roots, unsupported verbs, huge payloads',()=>{
  for(const item of [
    {method:'GET',path:'/floodguard/live',payload:{}},
    {method:'PATCH',path:'/floodguard/live/esp8266',payload:{}},
    {method:'PATCH',path:'/floodguard/live',payload:'a'},
    {method:'PUT',path:'/floodguard/live',payload:{water:'X'.repeat(5000)}},
    {method:'POST',path:'/floodguard/live',payload:null}
  ])assert.equal(inspectSyntheticLegacyUpload(item).canForward,false);
});
test('provisioned synthetic token and transport proof accept a frame, without live writes',()=>{
  const x=make();
  assert.deepEqual(x.gateway.accept({token:x.token,transportProof:x.transportProof,frame:frame(1)}),
    {accepted:true,kind:'SYNTHETIC_ACCEPTANCE_ONLY',sequence:1});
  assert.equal(x.gateway.lastAcceptedSequence('device-stage-a'),1);
});
test('identity, transport and role spoofing fail closed',()=>{
  const x=make();
  for(const args of [
    {token:x.token,transportProof:{kind:'SYNTHETIC_TRANSPORT_PROOF_NOT_REAL_TLS'}},
    {token:{kind:'SYNTHETIC_TOKEN_NOT_A_FIREBASE_JWT'},transportProof:x.transportProof},
    {token:null,transportProof:x.transportProof},
    {token:x.token},
    {}
  ])assert.equal(x.gateway.accept({...args,frame:frame(1)}).accepted,false);
  x.gateway.provision('device-stage-wrong',{scope:'read-only'});
  assert.throws(()=>x.gateway.issueSyntheticToken('device-stage-wrong'),/not provisioned/);
  assert.equal(x.gateway.lastAcceptedSequence('device-stage-a'),0);
});
test('identity expiry and renewal keep the same replay monotonic boundary',()=>{
  const x=make();
  assert.equal(x.gateway.accept({token:x.token,transportProof:x.transportProof,frame:frame(5)}).accepted,true);
  x.advance(2000);
  assert.equal(x.gateway.accept({token:x.token,transportProof:x.transportProof,frame:frame(6)}).reason,'expired-identity');
  const next=x.gateway.issueSyntheticToken('device-stage-a');
  assert.equal(x.gateway.accept({token:next,transportProof:x.transportProof,frame:frame(5)}).reason,'replay-or-out-of-order');
  assert.equal(x.gateway.accept({token:next,transportProof:x.transportProof,frame:frame(6)}).accepted,true);
});
test('revocation invalidates earlier synthetic credentials immediately',()=>{
  const x=make();
  x.gateway.revoke('device-stage-a');
  assert.equal(x.gateway.accept({token:x.token,transportProof:x.transportProof,frame:frame(1)}).reason,'revoked-or-unscoped');
  assert.throws(()=>x.gateway.issueSyntheticToken('device-stage-a'),/not provisioned/);
});
test('per-device replay and out-of-order updates are rejected across credentials',()=>{
  const x=make(),kwargs={token:x.token,transportProof:x.transportProof};
  assert.equal(x.gateway.accept({...kwargs,frame:frame(8)}).accepted,true);
  for(const n of [8,7,0])assert.equal(x.gateway.accept({...kwargs,frame:frame(n)}).accepted,false);
  assert.equal(x.gateway.lastAcceptedSequence('device-stage-a'),8);
  assert.equal(x.gateway.lastAcceptedSequence('device-stage-b'),0);
});
test('all configured retry delays are deterministic, capped and finite',()=>{
  assert.deepEqual(calculateSyntheticBackoff(),[250,500,1000,2000]);
  assert.deepEqual(calculateSyntheticBackoff({baseMs:500,maxMs:1000,attempts:6}),[500,1000,1000,1000,1000,1000]);
  for(const invalid of [{attempts:0},{attempts:100},{baseMs:0},{maxMs:0},{maxMs:999999}])
    assert.throws(()=>calculateSyntheticBackoff(invalid),RangeError);
});
test('bounded disconnected queue does not silently discard valid data or reorder frames',()=>{
  const queue=createSyntheticOfflineQueue({capacity:2});
  assert.equal(queue.enqueue(frame(1)).accepted,true);
  assert.equal(queue.enqueue(frame(1)).reason,'out-of-order');
  assert.equal(queue.enqueue(frame(0)).reason,'invalid-sequence');
  assert.equal(queue.enqueue(frame(2)).accepted,true);
  assert.equal(queue.enqueue(frame(3)).reason,'queue-full');
  assert.equal(queue.depth,2);
  assert.throws(()=>createSyntheticOfflineQueue({capacity:500}),RangeError);
});
test('queue drains strictly when verified and stops when token expires',()=>{
  const x=make(),queue=createSyntheticOfflineQueue({capacity:4});
  queue.enqueue(frame(1));queue.enqueue(frame(2));
  const credentials={token:x.token,transportProof:x.transportProof};
  assert.deepEqual(queue.drainTo(x.gateway,credentials),{processed:2,remaining:0,stopped:null});
  queue.enqueue(frame(3));x.advance(2000);
  assert.deepEqual(queue.drainTo(x.gateway,credentials),{processed:0,remaining:1,stopped:'expired-identity'});
  const fresh=x.gateway.issueSyntheticToken('device-stage-a');
  assert.deepEqual(queue.drainTo(x.gateway,{...credentials,token:fresh}),{processed:1,remaining:0,stopped:null});
});
test('queue refuses stale replay after reconnect and never overwrites latest accepted frame',()=>{
  const x=make(),credentials={token:x.token,transportProof:x.transportProof};
  x.gateway.accept({...credentials,frame:frame(4)});
  const queue=createSyntheticOfflineQueue();
  queue.enqueue(frame(3));queue.enqueue(frame(5));
  assert.deepEqual(queue.drainTo(x.gateway,credentials),{processed:0,remaining:2,stopped:'replay-or-out-of-order'});
  assert.equal(x.gateway.lastAcceptedSequence('device-stage-a'),4);
});
test('offline harness has no network, process environment, credentials or Firebase runtime imports',()=>{
  const content=readFileSync('experiments/offline-ingestion-gateway.mjs','utf8');
  assert.doesNotMatch(content,/\b(?:fetch|WebSocket|XMLHttpRequest)\s*\(/);
  assert.doesNotMatch(content,/\bimport\s+.*from\s+['"](?:firebase|@firebase|node:http|node:https|node:net)/);
  assert.doesNotMatch(content,/\bprocess\.env\b|writeFileSync|readFileSync|\.listen\(/);
  assert.doesNotMatch(content,/admin\.credential|serviceAccount|Authorization:\s*Bearer/);
});
