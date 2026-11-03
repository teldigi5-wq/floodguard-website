// H8 pure readback observer tests: synthetic facts only, no Firebase network.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {generateKeyPairSync,verify} from 'node:crypto';
import {createH8OfflineReadbackObserver}
  from '../experiments/r3-h8-verified-readback-observer.mjs';
import {canonicalH7Acknowledgement}
  from '../experiments/r3-h7-external-witness-lab.mjs';

const NOW=1762180000000;
const ID='device-stage-a';
const DIGEST='c'.repeat(64);
const RESERVATION='a'.repeat(32);
const keys=generateKeyPairSync('ed25519');
function fixture(){
  const candidate={
    current:{distanceCm:16.5,levelCm:8.5,status:'WARNING',
      observedAtMs:NOW-1000,overallRisk:'UNKNOWN'},
    checkpoint:{initialized:true,deviceId:ID,epoch:1,
      sequence:2,digest:DIGEST,observedAtMs:NOW-1000}
  };
  const reservation={
    ok:true,reservationId:RESERVATION,sequence:2,digest:DIGEST,
    releaseDecision:'NO_GO',canPublish:false
  };
  const state={
    revision:2,head:'f'.repeat(64),epoch:1,quarantined:false,
    sequence:1,digest:'b'.repeat(64),
    pending:{reservationId:RESERVATION,epoch:1,sequence:2,
      digest:DIGEST,observedAtMs:NOW-1000},releaseDecision:'NO_GO'
  };
  return {candidate,reservation,state};
}
function make({state,candidate,readPublication,clock=()=>NOW}={}){
  const f=fixture(),s=state??f.state,c=candidate??f.candidate;
  const witness=Object.freeze({snapshot:()=>structuredClone(s)});
  return {
    observer:createH8OfflineReadbackObserver({
      witness,acknowledgerPrivateKey:keys.privateKey,clock,
      readPublication:readPublication??(async()=>structuredClone(c))
    }),
    reservation:f.reservation,candidate:c
  };
}
test('exact independently read whole record yields signed H7 ack, but no publish approval',async()=>{
  const x=make();
  const r=await x.observer.inspect({reservation:x.reservation,candidate:x.candidate});
  assert.equal(r.attested,true,JSON.stringify(r));
  assert.equal(r.releaseDecision,'NO_GO');
  assert.equal(r.canWriteFirebase,false);
  assert.equal(r.canPublish,false);
  assert.equal(r.canOperateGate,false);
  assert.equal(r.acknowledgement.revision,3);
  assert.equal(r.acknowledgement.sequence,2);
  assert.equal(verify(null,Buffer.from(
    canonicalH7Acknowledgement(r.acknowledgement)),
    keys.publicKey,Buffer.from(r.signature,'base64url')),true);
  assert.ok(Object.isFrozen(r));
  assert.ok(Object.isFrozen(r.acknowledgement));
});
test('missing or extra published fields fail closed',async()=>{
  const f=fixture();
  for(const actual of [
    {current:{...f.candidate.current,status:'SAFE'},checkpoint:f.candidate.checkpoint},
    {current:{...f.candidate.current,privateIp:'192.0.2.1'},checkpoint:f.candidate.checkpoint},
    {current:f.candidate.current,checkpoint:{...f.candidate.checkpoint,digest:'d'.repeat(64)}},
    {current:f.candidate.current,checkpoint:{...f.candidate.checkpoint,sequence:1}},
    {current:f.candidate.current},
    null
  ]){
    const x=make({readPublication:async()=>actual});
    const result=await x.observer.inspect({
      reservation:f.reservation,candidate:f.candidate});
    assert.equal(result.attested,false);
    assert.equal(result.signature,undefined);
  }
});
test('missing or quarantined incident authority blocks acknowledgement',async()=>{
  const f=fixture();
  for(const state of [
    {...f.state,quarantined:true},
    {...f.state,pending:null},
    {...f.state,epoch:2},
    {...f.state,pending:{...f.state.pending,digest:'d'.repeat(64)}}
  ]){
    const x=make({state});
    assert.equal((await x.observer.inspect({
      reservation:f.reservation,candidate:f.candidate})).attested,false);
  }
});
test('witness changes while publication is fetched -> no signature',async()=>{
  const f=fixture();
  let revision=f.state.revision,reads=0;
  const witness=Object.freeze({snapshot:()=>{
    reads++;
    return {...structuredClone(f.state),revision};
  }});
  const observer=createH8OfflineReadbackObserver({
    witness,acknowledgerPrivateKey:keys.privateKey,clock:()=>NOW,
    readPublication:async()=>{revision++;return structuredClone(f.candidate);}
  });
  const result=await observer.inspect({
    reservation:f.reservation,candidate:f.candidate});
  assert.equal(reads,2);
  assert.equal(result.attested,false);
  assert.equal(result.reason,'incident-or-anchor-changed-after-readback');
});
test('unavailable witness or actual DB read yields no signed acknowledgement',async()=>{
  const f=fixture();
  const x=make({readPublication:async()=>{throw Error('read-only observer offline');}});
  assert.equal((await x.observer.inspect({
    reservation:f.reservation,candidate:f.candidate})).attested,false);
  const witness=Object.freeze({snapshot:()=>{throw Error('anchor lost');}});
  const observer=createH8OfflineReadbackObserver({
    witness,readPublication:async()=>f.candidate,
    acknowledgerPrivateKey:keys.privateKey,clock:()=>NOW
  });
  assert.equal((await observer.inspect({
    reservation:f.reservation,candidate:f.candidate})).attested,false);
});
test('stale/future observation and clock reversal cannot produce acknowledgement',async()=>{
  const f=fixture();
  for(const now of [NOW+31000,NOW-6000]){
    const x=make({clock:()=>now});
    assert.equal((await x.observer.inspect({
      reservation:f.reservation,candidate:f.candidate})).attested,false);
  }
  const times=[NOW,NOW-1];let index=0;
  const x=make({clock:()=>times[index++]});
  assert.equal((await x.observer.inspect({
    reservation:f.reservation,candidate:f.candidate})).attested,false);
});
test('caller-controlled reservation, candidate epoch or unpublished record cannot fake confirmation',async()=>{
  const f=fixture();
  const x=make();
  for(const params of [
    {reservation:{...f.reservation,reservationId:'e'.repeat(32)},candidate:f.candidate},
    {reservation:{...f.reservation,canPublish:true},candidate:f.candidate},
    {reservation:f.reservation,candidate:{...f.candidate,
      checkpoint:{...f.candidate.checkpoint,epoch:2}}},
    {reservation:{...f.reservation,extra:'admin'},candidate:f.candidate}
  ])assert.equal((await x.observer.inspect(params)).attested,false);
});
test('no Firebase/Admin SDK/HTTP/writes or production release are embedded in observer',()=>{
  const code=readFileSync(new URL(
    '../experiments/r3-h8-verified-readback-observer.mjs',import.meta.url),'utf8');
  assert.doesNotMatch(code,/\bfetch\s*\(|from 'firebase|from 'node:http|from 'node:https/);
  assert.doesNotMatch(code,/\bwriteFileSync\s*\(|\bservo\.write\s*\(|\bspawn\s*\(/);
  assert.match(code,/releaseDecision:'NO_GO'/);
  assert.match(code,/canonicalH7Acknowledgement/);
});
