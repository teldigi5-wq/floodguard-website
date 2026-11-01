// Actual Linux filesystem integration, not ESP8266 flash/power-cut tests.
// Tests only disposable temp directories and synthetic signed-looking bodies.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {
  encodeExclusiveRecordLab,inspectExclusiveJournalLab,
  appendExclusiveJournalLab
} from '../experiments/exclusive-device-journal-fs-lab.mjs';

const body=sequence=>JSON.stringify({
  envelope:{version:'floodguard-offline-envelope-v1',deviceId:'device-stage-a',
    epoch:1,sequence},signature:'A'.repeat(86)
});
const slot=(d,i)=>path.join(d,'fgq2_'+i+'.bin');
function disposable(t){
  const d=fs.mkdtempSync(path.join(os.tmpdir(),'fg-excl-storage-'));
  fs.chmodSync(d,0o700);
  t.after(()=>fs.rmSync(d,{force:true,recursive:true}));
  return d;
}
const inspect=d=>inspectExclusiveJournalLab({directory:d});
const append=(d,seq)=>appendExclusiveJournalLab({
  directory:d,sequence:seq,signedJson:body(seq)
});
const runChild=(d,seq)=>new Promise((resolve,reject)=>{
  const p=spawn(process.execPath,[
    'tests/fixtures/exclusive-journal-race-child.mjs',d,body(seq),String(seq)
  ],{stdio:['ignore','pipe','pipe']});
  let stdout='',stderr='';
  p.stdout.on('data',x=>stdout+=x);
  p.stderr.on('data',x=>stderr+=x);
  p.once('error',reject);
  p.once('close',code=>{
    if(code!==0)return reject(Error('child exited '+code+': '+stderr));
    try{resolve(JSON.parse(stdout));}catch(e){reject(e);}
  });
});

test('real host filesystem is empty only after strict directory checks',t=>{
  const d=disposable(t);
  const result=inspect(d);
  assert.equal(result.status,'AVAILABLE');
  assert.equal(result.count,0);
  assert.equal(result.canAcknowledge,false);
  assert.equal(result.canDelete,false);
  assert.equal(result.cloudConfirmed,false);
});
test('durably create a record with exclusive Linux open then recover from disk',t=>{
  const d=disposable(t);
  const result=append(d,1);
  assert.equal(result.status,'COMMITTED_HOST_ONLY',JSON.stringify(result));
  assert.equal(result.count,1);
  assert.equal(result.canAcknowledge,false);
  const f=fs.readFileSync(slot(d,0));
  assert.equal(f.toString('ascii',0,4),'FGP1');
  assert.equal(f.readUInt32BE(4),1);
  assert.equal(f.toString('utf8',10,10+f.readUInt16BE(8)),body(1));
  assert.equal(inspect(d).newestSequence,1);
});
test('append through eight real files; ninth is denied without modifying files',t=>{
  const d=disposable(t);
  for(let i=1;i<=8;i++)
    assert.equal(append(d,i).status,'COMMITTED_HOST_ONLY',String(i));
  const before=Array.from({length:8},(_,i)=>fs.readFileSync(slot(d,i)));
  assert.equal(inspect(d).status,'FULL');
  assert.equal(append(d,9).status,'FULL');
  assert.equal(inspect(d).newestSequence,8);
  for(let i=0;i<8;i++)assert.deepEqual(fs.readFileSync(slot(d,i)),before[i]);
});
test('no replay, rollback or old event overwrite across separate reads',t=>{
  const d=disposable(t);
  assert.equal(append(d,4).status,'COMMITTED_HOST_ONLY');
  const bytes=fs.readFileSync(slot(d,0));
  assert.equal(append(d,4).status,'OUT_OF_ORDER');
  assert.equal(append(d,3).status,'OUT_OF_ORDER');
  assert.deepEqual(fs.readFileSync(slot(d,0)),bytes);
  assert.equal(inspect(d).newestSequence,4);
});
test('torn slot quarantines subsequent writes without automatic cleanup',t=>{
  const d=disposable(t);
  fs.writeFileSync(slot(d,0),Buffer.from('FGP1\0','ascii'),{flag:'wx',mode:0o600});
  const before=fs.readFileSync(slot(d,0));
  assert.equal(inspect(d).status,'DAMAGED_OR_GAP');
  assert.equal(append(d,2).status,'DAMAGED_OR_GAP');
  assert.deepEqual(fs.readFileSync(slot(d,0)),before);
  assert.equal(fs.existsSync(slot(d,1)),false);
});
test('bit-flipped signed-looking payload fails FGP1 CRC with unchanged disk',t=>{
  const d=disposable(t);
  assert.equal(append(d,1).status,'COMMITTED_HOST_ONLY');
  const damaged=fs.readFileSync(slot(d,0));
  damaged[30]^=1;
  fs.writeFileSync(slot(d,0),damaged); // synthetic hostile offline corruption
  assert.equal(inspect(d).status,'DAMAGED_OR_GAP');
  assert.equal(append(d,2).status,'DAMAGED_OR_GAP');
  assert.deepEqual(fs.readFileSync(slot(d,0)),damaged);
});
test('unexpected gap after first file is denied, never filled or skipped',t=>{
  const d=disposable(t);
  assert.equal(append(d,1).status,'COMMITTED_HOST_ONLY');
  const encoded=encodeExclusiveRecordLab({sequence:2,signedJson:body(2)});
  fs.writeFileSync(slot(d,2),encoded,{flag:'wx',mode:0o600});
  assert.equal(inspect(d).status,'DAMAGED_OR_GAP');
  assert.equal(append(d,3).status,'DAMAGED_OR_GAP');
  assert.equal(fs.existsSync(slot(d,1)),false);
});
test('symlink in slot is refused; target never gets truncated',t=>{
  const d=disposable(t);
  const target=path.join(d,'protected-original.txt');
  fs.writeFileSync(target,'DO_NOT_TRUNCATE',{flag:'wx',mode:0o600});
  fs.symlinkSync(target,slot(d,0));
  assert.equal(inspect(d).status,'DAMAGED_OR_GAP');
  assert.equal(append(d,1).status,'DAMAGED_OR_GAP');
  assert.equal(fs.readFileSync(target,'utf8'),'DO_NOT_TRUNCATE');
});
test('directory symlink is rejected, not silently followed',t=>{
  const d=disposable(t);
  const link=d+'-link';
  fs.symlinkSync(d,link);
  t.after(()=>fs.rmSync(link,{force:true}));
  assert.equal(inspect(link).status,'UNSAFE_DIRECTORY');
  assert.equal(append(link,1).status,'UNSAFE_DIRECTORY');
  assert.equal(fs.readdirSync(d).length,0);
});
test('world-readable directory cannot host private signed journal',t=>{
  const d=disposable(t);
  fs.chmodSync(d,0o755);
  assert.equal(inspect(d).status,'UNSAFE_DIRECTORY');
  assert.equal(append(d,1).status,'UNSAFE_DIRECTORY');
  assert.equal(fs.readdirSync(d).length,0);
});
test('reject malformed, overlong, invalid and unsigned-looking bodies',t=>{
  const d=disposable(t);
  for(const [sequence,signedJson] of [
    [0,body(0)],[2147483648,body(2147483648)],
    [1,'{}'],[1,'['+'A'.repeat(100)+']'],
    [1,'{'+'A'.repeat(1100)+'}'],
    [1,body(1)+'\n']
  ]) assert.notEqual(appendExclusiveJournalLab({
    directory:d,sequence,signedJson
  }).status,'COMMITTED_HOST_ONLY');
  assert.equal(fs.readdirSync(d).length,0);
});
test('separate processes racing for one slot never overwrite a completed event',async t=>{
  const d=disposable(t);
  const [a,b]=await Promise.all([runChild(d,1),runChild(d,1)]);
  assert.equal([a,b].filter(x=>x.status==='COMMITTED_HOST_ONLY').length,1);
  assert.equal(inspect(d).count,1);
  const first=fs.readFileSync(slot(d,0));
  assert.equal(inspect(d).newestSequence,1);
  assert.deepEqual(fs.readFileSync(slot(d,0)),first);
  assert.equal(fs.readdirSync(d).length,1);
});
test('host experiment is not an MCU signing implementation or a cloud receipt',()=>{
  const src=fs.readFileSync('experiments/exclusive-device-journal-fs-lab.mjs','utf8');
  for(const unsafe of [
    'firebase-admin','serviceAccount','FIREBASE_URL',
    'setInsecure(','.unlinkSync(','.rmSync(','.renameSync(',
    'acknowledge(', 'servo.write(', 'sendMessage('
  ]) assert.equal(src.includes(unsafe),false,unsafe);
  assert.match(src,/O_EXCL/);
  assert.match(src,/O_NOFOLLOW/);
  assert.match(src,/fs\.fsyncSync\(fd\)/);
  assert.match(src,/fs\.fsyncSync\(dirFd\)/);
});
