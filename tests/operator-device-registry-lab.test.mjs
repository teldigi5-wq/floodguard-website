// Real isolated filesystem test only. Ephemeral keys and public identities;
// never import Firebase, expose an enrollment route or copy real firmware keys.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {generateKeyPairSync,randomBytes} from 'node:crypto';
import {createOperatorDeviceRegistryLab} from '../experiments/operator-device-registry-lab.mjs';

const uid='device-stage-a',uid2='device-stage-b';
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

test('staged rotation stays disabled until explicit epoch activation',()=>fixture(({make})=>{
  const registry=make(),first=generateKeyPairSync('ed25519');
  const next=generateKeyPairSync('ed25519');
  registry.commission();registry.enroll(uid,first.publicKey);
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
  assert.throws(()=>make().activateStaged(uid,1),/mismatch/);
  assert.deepEqual(make().activateStaged(uid,2),{activated:true,deviceId:uid,epoch:2});
  assert.equal(registry.get(uid).enabled,true);
  assert.throws(()=>registry.activateStaged(uid,2),/mismatch/);
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
