// Real isolated filesystem test only. Ephemeral keys and public identities;
// never import Firebase, expose an enrollment route or copy real firmware keys.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {generateKeyPairSync,randomBytes,createHash} from 'node:crypto';
import {createStage7OfflineLedger} from '../experiments/stage7-durable-ingress.mjs';
import {createOperatorDeviceRegistryLab} from '../experiments/operator-device-registry-lab.mjs';

const uid='device-stage-a',uid2='device-stage-b';
const fp=key=>createHash('sha256').update(key.export({format:'der',type:'spki'})).digest('hex');
function fixture(run){
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'floodguard-operator-registry-'));
  const integrityKey=randomBytes(32);
  const make=(key=integrityKey)=>createOperatorDeviceRegistryLab({directory,integrityKey:key});
  try{return run({directory,integrityKey,make});}
  finally{fs.rmSync(directory,{recursive:true,force:true});}
}

test('operator commissioning is explicit, one-time and never auto-enrolls',()=>fixture(({make})=>{
  const registry=make(),key=generateKeyPairSync('ed25519');
  assert.throws(()=>registry.get(uid),'missing history must refuse requests');
  assert.deepEqual(registry.commission(),{commissioned:true,revision:1});
  assert.throws(()=>registry.commission(),/already commissioned/);
  assert.equal(registry.get(uid),undefined,'no default device identity');
  assert.throws(()=>registry.enroll(uid,generateKeyPairSync('rsa',{modulusLength:2048}).publicKey),
    /Ed25519/);
  assert.deepEqual(registry.enroll(uid,key.publicKey),{enrolled:true,deviceId:uid,epoch:1});
  assert.throws(()=>registry.enroll(uid,key.publicKey),/already allocated/);
  assert.deepEqual(make().status().devices,[{deviceId:uid,epoch:1,enabled:true}]);
  assert.equal(make().get(uid).publicKey.export({format:'pem',type:'spki'}),
    key.publicKey.export({format:'pem',type:'spki'}));
}));

test('revocation persists across independent registry instances and refuses implicit re-enrollment',()=>fixture(({make})=>{
  const registry=make(),key=generateKeyPairSync('ed25519');
  registry.commission();registry.enroll(uid,key.publicKey);
  assert.deepEqual(registry.revoke(uid),{revoked:true,deviceId:uid,epoch:1});
  assert.equal(make().get(uid).enabled,false);
  assert.throws(()=>make().enroll(uid,key.publicKey),/already allocated/);
  assert.throws(()=>make().revoke(uid),/No enabled identity/);
  assert.equal(make().status().revision,3);
}));

test('staged rotation stays disabled until exact sealed replay checkpoint agrees',()=>fixture(({make,directory})=>{
  const registry=make(),first=generateKeyPairSync('ed25519');
  const next=generateKeyPairSync('ed25519'),oldFp=fp(first.publicKey),newFp=fp(next.publicKey);
  const replay=createStage7OfflineLedger({directory,integrityKey:randomBytes(32)});
  registry.commission();registry.enroll(uid,first.publicKey);
  assert.deepEqual(replay.commit({uid,epoch:1,sequence:7,keyFingerprint:oldFp}),
    {accepted:true,sequence:7});
  assert.throws(()=>registry.stageRotation(uid,next.publicKey),/requires revoked/);
  registry.revoke(uid);
  assert.throws(()=>registry.stageRotation(uid,first.publicKey),/requires revoked/);
  assert.deepEqual(registry.stageRotation(uid,next.publicKey),{
    staged:true,deviceId:uid,epoch:2,enabled:false
  });
  assert.equal(make().get(uid).enabled,false);
  assert.equal(make().get(uid).epoch,2);
  assert.equal(make().get(uid).publicKey.export({format:'pem',type:'spki'}),
    next.publicKey.export({format:'pem',type:'spki'}));
  assert.throws(()=>make().activateStaged(uid,2),/independent sealed replay ledger/);
  assert.throws(()=>make().activateStaged(uid,1,{replayLedger:replay,expectedSequence:7}),
    /mismatch/);
  assert.throws(()=>make().activateStaged(uid,2,{replayLedger:replay,expectedSequence:7}),
    /not independently confirmed/);
  assert.equal(registry.get(uid).enabled,false);
  assert.deepEqual(replay.rebind({
    uid,expected:{epoch:1,sequence:7,keyFingerprint:oldFp},
    next:{epoch:2,keyFingerprint:newFp},operatorRegistry:make()
  }),{rebound:true,kind:'OFFLINE_OPERATOR_REBIND_ONLY',epoch:2,sequence:7});
  assert.deepEqual(replay.last(uid),{epoch:2,sequence:7,keyFingerprint:newFp});
  assert.throws(()=>make().activateStaged(uid,2,{replayLedger:replay,expectedSequence:6}),
    /not independently confirmed/);
  assert.deepEqual(make().activateStaged(uid,2,{replayLedger:replay,expectedSequence:7}),
    {activated:true,deviceId:uid,epoch:2});
  assert.equal(registry.get(uid).enabled,true);
  assert.deepEqual(replay.commit({uid,epoch:1,sequence:8,keyFingerprint:oldFp}),
    {accepted:false,reason:'identity-epoch-mismatch'});
  assert.deepEqual(replay.commit({uid,epoch:2,sequence:7,keyFingerprint:newFp}),
    {accepted:false,reason:'replay-or-out-of-order'});
  assert.deepEqual(replay.commit({uid,epoch:2,sequence:8,keyFingerprint:newFp}),
    {accepted:true,sequence:8});
  assert.throws(()=>registry.activateStaged(uid,2,{replayLedger:replay,expectedSequence:8}),/mismatch/);
}));

test('rebind refuses active identities, forged checkpoints, skipped epochs and wrong fingerprints',()=>fixture(({make,directory})=>{
  const operator=make(),original=generateKeyPairSync('ed25519'),next=generateKeyPairSync('ed25519');
  const oldFp=fp(original.publicKey),newFp=fp(next.publicKey);
  const replay=createStage7OfflineLedger({directory,integrityKey:randomBytes(32)});
  operator.commission();operator.enroll(uid,original.publicKey);
  replay.commit({uid,epoch:1,sequence:19,keyFingerprint:oldFp});
  const request=(expected={epoch:1,sequence:19,keyFingerprint:oldFp},
    following={epoch:2,keyFingerprint:newFp})=>({
      uid,expected,next:following,operatorRegistry:make()
    });
  assert.deepEqual(replay.rebind(request()),{
    rebound:false,reason:'staged-identity-unverified'
  });
  operator.revoke(uid);operator.stageRotation(uid,next.publicKey);
  for(const bad of [
    request({epoch:1,sequence:18,keyFingerprint:oldFp}),
    request({epoch:1,sequence:19,keyFingerprint:'e'.repeat(64)}),
    request({epoch:2,sequence:19,keyFingerprint:oldFp})
  ]){
    assert.deepEqual(replay.rebind(bad),{
      rebound:false,reason:'prior-ledger-binding-mismatch'
    });
  }
  for(const bad of [
    request(undefined,{epoch:3,keyFingerprint:newFp}),
    request(undefined,{epoch:2,keyFingerprint:oldFp})
  ])assert.throws(()=>replay.rebind(bad),/Exact prior checkpoint/);
  assert.deepEqual(replay.rebind(request(undefined,{
    epoch:2,keyFingerprint:'d'.repeat(64)
  })),{rebound:false,reason:'staged-identity-unverified'});
  assert.deepEqual(replay.last(uid),{epoch:1,sequence:19,keyFingerprint:oldFp});
  assert.equal(operator.get(uid).enabled,false);
}));

test('offline rotation crash after ledger rebind remains disabled until explicit recovery',()=>fixture(({make,directory})=>{
  const registry=make(),old=generateKeyPairSync('ed25519'),fresh=generateKeyPairSync('ed25519');
  const replayKey=randomBytes(32);
  const ledger=()=>createStage7OfflineLedger({directory,integrityKey:replayKey});
  registry.commission();registry.enroll(uid,old.publicKey);
  ledger().commit({uid,epoch:1,sequence:41,keyFingerprint:fp(old.publicKey)});
  registry.revoke(uid);registry.stageRotation(uid,fresh.publicKey);
  assert.deepEqual(ledger().rebind({
    uid,expected:{epoch:1,sequence:41,keyFingerprint:fp(old.publicKey)},
    next:{epoch:2,keyFingerprint:fp(fresh.publicKey)},operatorRegistry:registry
  }),{rebound:true,kind:'OFFLINE_OPERATOR_REBIND_ONLY',epoch:2,sequence:41});
  // Simulated process restart: no activation happened before the crash.
  assert.equal(make().get(uid).enabled,false);
  assert.deepEqual(ledger().commit({uid,epoch:2,sequence:42,keyFingerprint:fp(old.publicKey)}),
    {accepted:false,reason:'identity-epoch-mismatch'});
  assert.deepEqual(ledger().rebind({
    uid,expected:{epoch:1,sequence:41,keyFingerprint:fp(old.publicKey)},
    next:{epoch:2,keyFingerprint:fp(fresh.publicKey)},operatorRegistry:make()
  }),{rebound:false,reason:'prior-ledger-binding-mismatch'});
  assert.deepEqual(make().activateStaged(uid,2,{replayLedger:ledger(),expectedSequence:41}),
    {activated:true,deviceId:uid,epoch:2});
  assert.equal(make().get(uid).enabled,true);
  assert.deepEqual(ledger().last(uid),{
    epoch:2,sequence:41,keyFingerprint:fp(fresh.publicKey)
  });
}));

test('missing or tampered replay ledger blocks staged activation; no implicit recovery',()=>fixture(({make,directory})=>{
  const registry=make(),old=generateKeyPairSync('ed25519'),fresh=generateKeyPairSync('ed25519');
  const replay=createStage7OfflineLedger({directory,integrityKey:randomBytes(32)});
  registry.commission();registry.enroll(uid,old.publicKey);
  replay.commit({uid,epoch:1,sequence:11,keyFingerprint:fp(old.publicKey)});
  registry.revoke(uid);registry.stageRotation(uid,fresh.publicKey);
  replay.rebind({
    uid,expected:{epoch:1,sequence:11,keyFingerprint:fp(old.publicKey)},
    next:{epoch:2,keyFingerprint:fp(fresh.publicKey)},operatorRegistry:make()
  });
  const file=path.join(directory,'stage7-synthetic-ledger.json');
  const original=fs.readFileSync(file,'utf8');
  fs.writeFileSync(file,original.replace('"sequence":11','"sequence":1'));
  assert.throws(()=>make().activateStaged(uid,2,{
    replayLedger:replay,expectedSequence:11
  }),/integrity failure/);
  assert.equal(make().get(uid).enabled,false);
  fs.unlinkSync(file);
  assert.throws(()=>make().activateStaged(uid,2,{
    replayLedger:replay,expectedSequence:11
  }),/not independently confirmed/);
  assert.equal(make().get(uid).enabled,false);
}));

test('duplicate device public keys cannot be reused for another device',()=>fixture(({make})=>{
  const r=make(),same=generateKeyPairSync('ed25519'),other=generateKeyPairSync('ed25519');
  r.commission();r.enroll(uid,same.publicKey);
  assert.throws(()=>r.enroll(uid2,same.publicKey),/already allocated/);
  r.enroll(uid2,other.publicKey);
  r.revoke(uid2);
  assert.throws(()=>r.stageRotation(uid2,same.publicKey),/requires revoked/);
  assert.equal(r.get(uid2).epoch,1);
}));

test('tampered, absent or incorrectly keyed persistent state fails closed',()=>fixture(({make,directory})=>{
  const r=make(),key=generateKeyPairSync('ed25519');
  r.commission();r.enroll(uid,key.publicKey);
  const file=path.join(directory,'operator-device-registry-lab.json');
  const original=fs.readFileSync(file,'utf8');
  assert.doesNotMatch(original,/BEGIN PRIVATE KEY|BEGIN PUBLIC KEY|PRIVATE KEY/);
  const wrongKey=make(randomBytes(32));
  assert.throws(()=>wrongKey.get(uid),/integrity failure/);
  fs.writeFileSync(file,original.replace('"enabled":true','"enabled":false'));
  assert.throws(()=>r.get(uid),/integrity failure/);
  fs.writeFileSync(file,original);
  fs.unlinkSync(file);
  assert.throws(()=>make().get(uid),'deleting registry must never yield an empty one');
}));

test('symlink registry and stale operator lock are rejected without auto-healing',()=>fixture(({make,directory})=>{
  const r=make();r.commission();
  const file=path.join(directory,'operator-device-registry-lab.json');
  const other=path.join(directory,'other.json');
  fs.copyFileSync(file,other);fs.unlinkSync(file);fs.symlinkSync(other,file);
  assert.throws(()=>r.status(),/unavailable/);
  fs.unlinkSync(file);fs.copyFileSync(other,file);
  const lock=path.join(directory,'operator-device-registry-lab.lock');
  fs.writeFileSync(lock,'STALE-LOCK','utf8');
  assert.throws(()=>r.status(),/EEXIST/);
  assert.equal(fs.readFileSync(lock,'utf8'),'STALE-LOCK');
}));

test('no network listener, Admin SDK, production credential or implicit enrollment exists',()=>{
  const s=fs.readFileSync('experiments/operator-device-registry-lab.mjs','utf8');
  assert.doesNotMatch(s,/from ['"]node:(?:http|https|net)['"]|\.listen\s*\(|\bfetch\s*\(/);
  assert.doesNotMatch(s,/firebase-admin|process\.env|FIREBASE_DATABASE_URL|serviceAccount/);
  assert.match(s,/commission\(\)/);
  assert.match(s,/integrityKey/);
});
