import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash,generateKeyPairSync,sign}
  from 'node:crypto';
import {
  R3_V2_WITNESS_VERSION,canonicalR3V2WitnessCheckpoint,
  reviewR3V2WitnessSignedState
} from '../experiments/r3-v2-independent-witness-reconciliation-lab.mjs';
import {createR3V2DiskWitnessLab}
  from '../experiments/r3-v2-fsync-disk-witness-lab.mjs';

process.env.FG_R3_DISK_WITNESS_LAB_TEST='1';
const streams=['water','rain'];
const digest=s=>createHash('sha256').update(s).digest('hex');
const LOG='r3-v2-witness-journal.log';
const LOCK='r3-v2-witness-journal.lock';
function checkpoint(stream,sequence){
  return {
    version:R3_V2_WITNESS_VERSION,stream,
    sourceAlias:stream+'-primary',epoch:1,sequence,
    envelopeDigest:digest(stream+':'+sequence)
  };
}
function fixture(fn,{onFault}={}){
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'fg-v2-disk-witness-'));
  fs.chmodSync(directory,0o700);
  const keys=Object.fromEntries(streams.map(s=>[s,
    generateKeyPairSync('ed25519')]));
  const enrollment=Object.fromEntries(streams.map(s=>[s,{
    epoch:1,publicKey:keys[s].publicKey
  }]));
  const seal=(s,cp)=>({
    checkpoint:cp,
    signature:sign(null,Buffer.from(canonicalR3V2WitnessCheckpoint(cp)),
      keys[s].privateKey).toString('base64url')
  });
  const open=(x={})=>createR3V2DiskWitnessLab({
    directory,enrollment,
    signCheckpoint:(s,canonical)=>sign(null,Buffer.from(canonical),
      keys[s].privateKey).toString('base64url'),
    onFault:x.onFault??onFault??(()=>{})
  });
  const genesis={
    water:seal('water',checkpoint('water',1)),
    rain:seal('rain',checkpoint('rain',1))
  };
  try{return fn({directory,enrollment,keys,seal,genesis,open});}
  finally{fs.rmSync(directory,{recursive:true,force:true});}
}
const loc=d=>path.join(d,LOG);
const lock=d=>path.join(d,LOCK);
const cas=(s,from,to)=>({
  stream:s,expectedCheckpoint:checkpoint(s,from),
  nextCheckpoint:checkpoint(s,to)
});

test('requires explicit opt-in, private directory, and two different trusted signers',()=>fixture(x=>{
  const old=process.env.FG_R3_DISK_WITNESS_LAB_TEST;
  delete process.env.FG_R3_DISK_WITNESS_LAB_TEST;
  assert.throws(()=>x.open(),/disabled outside isolated/);
  process.env.FG_R3_DISK_WITNESS_LAB_TEST=old;
  fs.chmodSync(x.directory,0o755);
  assert.throws(()=>x.open(),/private real directory/);
  fs.chmodSync(x.directory,0o700);
  const duplicate={
    water:x.enrollment.water,rain:{
      epoch:1,publicKey:x.enrollment.water.publicKey
    }
  };
  assert.throws(()=>createR3V2DiskWitnessLab({
    directory:x.directory,enrollment:duplicate,
    signCheckpoint:()=>{}
  }),/separate per stream/);
}));
test('explicit dual-signed initialization refuses silent overwrite and private file modes',()=>fixture(x=>{
  const witness=x.open();
  assert.throws(()=>witness.readSigned('water'),/ENOENT/);
  assert.deepEqual(witness.initialize(x.genesis),{
    initialized:true,entries:2,
    durableLocalFsyncAttempted:true,rollbackResistant:false
  });
  assert.equal(fs.statSync(loc(x.directory)).mode&0o077,0);
  assert.deepEqual(witness.readSigned('water'),x.genesis.water);
  assert.deepEqual(witness.readSigned('rain'),x.genesis.rain);
  assert.throws(()=>x.open().initialize(x.genesis),/already initialized/);
}));
test('two streams append one-step signed CAS and reopen after object restart',()=>fixture(x=>{
  x.open().initialize(x.genesis);
  const water=x.open().compareAndSwap(cas('water',1,2));
  const rain=x.open().compareAndSwap(cas('rain',1,2));
  assert.equal(water.checkpoint.sequence,2);
  assert.equal(rain.checkpoint.sequence,2);
  assert.equal(reviewR3V2WitnessSignedState({
    stream:'water',signed:water,
    trustedWitnessKey:x.enrollment.water.publicKey
  }).valid,true);
  assert.equal(x.open().readSigned('water').checkpoint.sequence,2);
  assert.equal(x.open().readSigned('rain').checkpoint.sequence,2);
  assert.equal(fs.readFileSync(loc(x.directory),'utf8').split('\n').length-1,4);
}));
test('independent Node process reopens and verifies journal without private keys',()=>fixture(x=>{
  x.open().initialize(x.genesis);
  x.open().compareAndSwap(cas('water',1,2));
  const child=spawnSync(process.execPath,
    ['tests/r3-v2-disk-witness-child.mjs'],{
    encoding:'utf8',timeout:10000,cwd:process.cwd(),
    env:{...process.env,
      FG_CHILD_DIRECTORY:x.directory,
      FG_CHILD_KEYS:JSON.stringify(Object.fromEntries(streams.map(s=>[
        s,x.enrollment[s].publicKey.export({format:'der',type:'spki'})
          .toString('base64url')
      ])))}
  });
  assert.equal(child.status,0,child.stderr);
  assert.deepEqual(JSON.parse(child.stdout),{water:2,rain:1});
}));
test('stale expected checkpoint and sequence jump fail without changing journal',()=>fixture(x=>{
  x.open().initialize(x.genesis);
  x.open().compareAndSwap(cas('water',1,2));
  assert.throws(()=>x.open().compareAndSwap(cas('water',1,3)),
    /expected checkpoint stale/);
  assert.throws(()=>x.open().compareAndSwap(cas('water',2,4)),
    /one-step monotonic/);
  assert.equal(x.open().readSigned('water').checkpoint.sequence,2);
}));
test('reopen detects corruption, torn trailing entry and incomplete journal',()=>fixture(x=>{
  x.open().initialize(x.genesis);
  const file=loc(x.directory),original=fs.readFileSync(file);
  fs.writeFileSync(file,Buffer.concat([original,Buffer.from('{bad')]));
  assert.throws(()=>x.open().readSigned('water'),/torn/);
  fs.writeFileSync(file,Buffer.from(original.toString().replace(
    '"sequence":1','"sequence":5')));
  assert.throws(()=>x.open().readSigned('water'),/hash-chain mismatch/);
  fs.writeFileSync(file,original.subarray(0,original.length-16));
  assert.throws(()=>x.open().readSigned('rain'),/torn/);
  fs.writeFileSync(file,original);
  assert.equal(x.open().readSigned('rain').checkpoint.sequence,1);
}));
test('stale exclusive lock is never silently removed',()=>fixture(x=>{
  x.open().initialize(x.genesis);
  fs.writeFileSync(lock(x.directory),'crashed',{mode:0o600,flag:'wx'});
  assert.throws(()=>x.open().readSigned('water'),/EEXIST/);
  assert.throws(()=>x.open().compareAndSwap(cas('water',1,2)),/EEXIST/);
  assert.equal(fs.readFileSync(lock(x.directory),'utf8'),'crashed');
}));
test('an exception after fsync means unknown outcome; reopened journal reveals committed CAS',()=>fixture(x=>{
  x.open().initialize(x.genesis);
  const lab=x.open({onFault:stage=>{
    if(stage==='after-fsync')throw Error('synthetic ACK lost');
  }});
  assert.throws(()=>lab.compareAndSwap(cas('water',1,2)),
    /synthetic ACK lost/);
  assert.equal(x.open().readSigned('water').checkpoint.sequence,2);
  assert.throws(()=>x.open().compareAndSwap(cas('water',1,2)),
    /expected checkpoint stale/);
}));
test('fault before write leaves earlier signed history intact',()=>fixture(x=>{
  x.open().initialize(x.genesis);
  const prior=fs.readFileSync(loc(x.directory));
  const lab=x.open({onFault:stage=>{
    if(stage==='before-write')throw Error('injected crash before write');
  }});
  assert.throws(()=>lab.compareAndSwap(cas('rain',1,2)),
    /injected crash before write/);
  assert.deepEqual(fs.readFileSync(loc(x.directory)),prior);
  assert.equal(x.open().readSigned('rain').checkpoint.sequence,1);
}));
test('dangling symlink, hardlink and public file permissions are rejected',()=>fixture(x=>{
  const file=loc(x.directory);
  fs.symlinkSync(path.join(x.directory,'missing-target'),file);
  assert.throws(()=>x.open().initialize(x.genesis),/already initialized/);
  fs.unlinkSync(file);
  x.open().initialize(x.genesis);
  fs.chmodSync(file,0o644);
  assert.throws(()=>x.open().readSigned('water'),/Unsafe or missing/);
  fs.chmodSync(file,0o600);
  fs.linkSync(file,path.join(x.directory,'duplicate-link'));
  assert.throws(()=>x.open().readSigned('water'),/Unsafe or missing/);
}));
test('restoring earlier fully valid journal remains undetectable without external counter',()=>fixture(x=>{
  x.open().initialize(x.genesis);
  const validOld=fs.readFileSync(loc(x.directory));
  x.open().compareAndSwap(cas('water',1,2));
  assert.equal(x.open().readSigned('water').checkpoint.sequence,2);
  // Explicit negative demonstration of the nonrollback gap.
  fs.writeFileSync(loc(x.directory),validOld);
  assert.equal(x.open().readSigned('water').checkpoint.sequence,1);
}));
test('forged signatures and differently pinned witness identity fail closed',()=>fixture(x=>{
  const invalid={...x.genesis,
    water:{...x.genesis.water,signature:'A'.repeat(86)}};
  assert.throws(()=>x.open().initialize(invalid),/genesis checkpoints/);
  assert.equal(fs.existsSync(loc(x.directory)),false);
  x.open().initialize(x.genesis);
  const alternate={
    ...x.enrollment,water:{
      epoch:1,publicKey:generateKeyPairSync('ed25519').publicKey
    }
  };
  const reader=createR3V2DiskWitnessLab({
    directory:x.directory,enrollment:alternate,
    signCheckpoint:()=>{}
  });
  assert.throws(()=>reader.readSigned('water'),/signature or enrolled epoch/);
}));
test('module has no Firebase SDK, network listener or auto-reset of journal',()=>{
  const src=fs.readFileSync(
    'experiments/r3-v2-fsync-disk-witness-lab.mjs','utf8');
  assert.doesNotMatch(src,/firebase-admin|firebase\/database|node:http|node:https|node:net|serviceAccount/);
  assert.doesNotMatch(src,/\b(?:fetch|XMLHttpRequest|WebSocket)\s*\(/);
  assert.doesNotMatch(src,/unlinkSync\s*\(\s*journal\s*\)/);
});
