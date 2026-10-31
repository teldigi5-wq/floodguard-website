// Stage R2: intentionally isolated, disk-backed, signed-water/rain journal
// acceptance. All paths under fresh OS temp folders; no Firebase or hardware.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {createHash,generateKeyPairSync,randomBytes,sign} from 'node:crypto';
import {R2_PUBLIC_PROOF_VERSION,canonicalR2PublicEvidence}
  from '../experiments/r2-dual-stream-public-evidence.mjs';
import {R2_ISSUER_RECEIPT_VERSION,canonicalR2PublisherReceipt}
  from '../experiments/r2-attested-dual-stream-publisher.mjs';
import {draftR2RecoveryAnchor,canonicalR2RecoveryAnchor}
  from '../experiments/r2-recovery-anchor-lab.mjs';
import {draftR2CatchupApproval,canonicalR2CatchupApproval}
  from '../experiments/r2-operator-catchup-lab.mjs';
import {createR2LocalAnchorJournalLab}
  from '../experiments/r2-local-anchor-journal-lab.mjs';

// This test file is itself the explicit lab harness. It creates only fresh
// temporary directories and ephemeral test keys; the library is disabled
// without this opt-in flag outside tests.
process.env.FG_R2_LOCAL_JOURNAL_LAB_TEST='1';

const SCHEMA='floodguard-r2-local-anchor-journal-lab-v1';
const streams=['water','rain'];
const stamp=Date.UTC(2026,9,30,15,0,0);
const digest=s=>createHash('sha256').update(s,'utf8').digest('hex');
function fixture() {
  const signers=Object.fromEntries(streams.map(s=>[s,Object.fromEntries(
    ['report','receipt','anchor','approval'].map(role=>[
      role,generateKeyPairSync('ed25519')
    ])
  )]));
  const trustedKeys=Object.fromEntries(streams.map(s=>[s,Object.fromEntries(
    Object.entries(signers[s]).map(([role,pair])=>[role,pair.publicKey])
  )]));
  const signBytes=(s,role,bytes)=>sign(null,Buffer.from(bytes,'utf8'),
    signers[s][role].privateKey).toString('base64url');
  function publicRecord(s,sequence,custom={}) {
    const payload={
      version:R2_PUBLIC_PROOF_VERSION,stream:s,
      sourceAlias:s==='water'?'water-primary':'rain-primary',
      epoch:1,sequence,observedAtMs:stamp-5000+sequence,
      receivedAtMs:stamp-3000+sequence,
      sample:s==='water'
        ?{distanceCm:16.5,levelCm:8.5,reportedStatus:'WARNING'}
        :{currentMm:2,dailyMm:12,reportedStatus:'NORMAL'},...custom
    };
    return {payload,signature:signBytes(s,'report',
      canonicalR2PublicEvidence(payload))};
  }
  function signedAnchor(s,record) {
    const anchor=draftR2RecoveryAnchor(s,record);
    return {anchor,signature:signBytes(s,'anchor',
      canonicalR2RecoveryAnchor(anchor))};
  }
  function acceptance(s,record) {
    const p=record.payload;
    const receipt={
      version:R2_ISSUER_RECEIPT_VERSION,stream:s,
      sourceAlias:p.sourceAlias,epoch:p.epoch,sequence:p.sequence,
      payloadDigest:digest(canonicalR2PublicEvidence(p)),
      acceptedAtMs:p.receivedAtMs
    };
    return {receipt,receiptSignature:signBytes(s,'receipt',
      canonicalR2PublisherReceipt(receipt))};
  }
  function proposal(s,previous,nextRecord,options={}) {
    const receipt=acceptance(s,nextRecord);
    const approval=draftR2CatchupApproval({
      stream:s,signedAnchor:previous,publicRecord:nextRecord,
      receipt:receipt.receipt,approvedAtMs:stamp
    });
    const signedApproval={
      approval,signature:signBytes(s,'approval',
        canonicalR2CatchupApproval(approval))
    };
    return {stream:s,publicRecord:nextRecord,...receipt,signedApproval,
      signedNextAnchor:signedAnchor(s,nextRecord),...options};
  }
  return {trustedKeys,publicRecord,signedAnchor,proposal,signBytes};
}
function withSetup(fn) {
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'fg-r2-journal-lab-'));
  fs.chmodSync(directory,0o700);
  const integrityKey=randomBytes(32),f=fixture();
  const open=(overrides={})=>createR2LocalAnchorJournalLab({
    directory,integrityKey,trustedKeys:f.trustedKeys,...overrides
  });
  const bootstrap=Object.fromEntries(streams.map(s=>{
    const publicRecord=f.publicRecord(s,1);
    return [s,{publicRecord,signedAnchor:f.signedAnchor(s,publicRecord)}];
  }));
  try{return fn({directory,integrityKey,open,bootstrap,...f});}
  finally{fs.rmSync(directory,{recursive:true,force:true});}
}
const location=d=>path.join(d,'r2-operator-anchor-journal.json');
const lockFile=d=>path.join(d,'r2-operator-anchor-journal.lock');

test('bootstrap requires both signed sensor records and refuses silent reset',()=>withSetup(x=>{
  const journal=x.open();
  assert.throws(()=>journal.snapshot(),/ENOENT/);
  assert.throws(()=>journal.initialize({water:x.bootstrap.water}));
  assert.deepEqual(journal.initialize(x.bootstrap),{
    initialized:true,generation:0
  });
  assert.equal(journal.snapshot().schema,SCHEMA);
  assert.equal(journal.snapshot().water.anchor.sequence,1);
  assert.equal(journal.snapshot().rain.anchor.sequence,1);
  assert.throws(()=>x.open().initialize(x.bootstrap),/already initialized/);
  assert.equal(fs.statSync(location(x.directory)).mode&0o077,0);
}));

test('signed operator catch-up persists both streams across reopened instances',()=>withSetup(x=>{
  x.open().initialize(x.bootstrap);
  for(const s of streams){
    const newRecord=x.publicRecord(s,2);
    const signed=x.proposal(s,x.bootstrap[s].signedAnchor,newRecord);
    assert.deepEqual(x.open().advance(signed),{
      advanced:true,generation:s==='water'?1:2,
      kind:'FSYNC_LOCAL_JOURNAL_ONLY_NOT_NONROLLBACK'
    });
    assert.equal(x.open().snapshot()[s].anchor.sequence,2);
  }
  const last=x.open().snapshot();
  assert.equal(last.generation,2);
  assert.equal(last.water.anchor.sequence,2);
  assert.equal(last.rain.anchor.sequence,2);
}));

test('replayed catch-up approval cannot advance journal after restart',()=>withSetup(x=>{
  const j=x.open();
  j.initialize(x.bootstrap);
  const proposal=x.proposal('water',x.bootstrap.water.signedAnchor,
    x.publicRecord('water',2));
  assert.equal(j.advance(proposal).advanced,true);
  const second=x.open().advance(proposal);
  assert.deepEqual(second,{
    advanced:false,reason:'checkpoint-not-ahead-or-unverified'
  });
  assert.equal(j.snapshot().generation,1);
}));

test('forged replacement anchor, receipt, approval and cross-stream attempt fail closed',()=>withSetup(x=>{
  x.open().initialize(x.bootstrap);
  const newRecord=x.publicRecord('rain',2);
  const good=x.proposal('rain',x.bootstrap.rain.signedAnchor,newRecord);
  for(const bad of [
    {...good,signedNextAnchor:{...good.signedNextAnchor,
      signature:'A'.repeat(86)}},
    {...good,signedNextAnchor:x.signedAnchor('water',x.publicRecord('water',2))},
    {...good,receiptSignature:'A'.repeat(86)},
    {...good,signedApproval:{...good.signedApproval,
      signature:'A'.repeat(86)}},
    {...good,stream:'water'}
  ]){
    const result=x.open().advance(bad);
    assert.equal(result.advanced,false);
  }
  assert.deepEqual(x.open().snapshot().rain.anchor,x.bootstrap.rain.signedAnchor);
  assert.equal(x.open().snapshot().generation,0);
}));

test('missing, corrupt, unsafe or wrong-HMAC journal never becomes new state',()=>withSetup(x=>{
  const journal=x.open();
  journal.initialize(x.bootstrap);
  const file=location(x.directory);
  const original=fs.readFileSync(file,'utf8');
  fs.writeFileSync(file,original.replace('"generation":0','"generation":9'));
  assert.throws(()=>x.open().snapshot(),/integrity mismatch/);
  assert.throws(()=>x.open().initialize(x.bootstrap),/already initialized/);
  fs.writeFileSync(file,original);
  assert.throws(()=>x.open({integrityKey:randomBytes(32)}).snapshot(),
    /integrity mismatch/);
  fs.chmodSync(file,0o644);
  assert.throws(()=>x.open().snapshot(),/Unsafe local journal file/);
  fs.chmodSync(file,0o600);
  fs.rmSync(file);
  assert.throws(()=>x.open().snapshot(),/ENOENT/);
}));

test('stale crash lock is never deleted automatically',()=>withSetup(x=>{
  const journal=x.open();
  journal.initialize(x.bootstrap);
  fs.writeFileSync(lockFile(x.directory),'unreviewed-crash-lock',{mode:0o600,flag:'wx'});
  assert.throws(()=>x.open().snapshot(),/EEXIST/);
  assert.throws(()=>x.open().advance(x.proposal('water',
    x.bootstrap.water.signedAnchor,x.publicRecord('water',2))),/EEXIST/);
  assert.equal(fs.readFileSync(lockFile(x.directory),'utf8'),
    'unreviewed-crash-lock');
}));

test('separate independent stream issuer pins reject wrong anchor authority',()=>withSetup(x=>{
  const journal=x.open();
  journal.initialize(x.bootstrap);
  const changed={
    water:{...x.trustedKeys.water,anchor:x.trustedKeys.rain.anchor},
    rain:{...x.trustedKeys.rain,anchor:x.trustedKeys.water.anchor}
  };
  assert.throws(()=>x.open({trustedKeys:changed}).snapshot(),
    /Invalid signed local journal anchor/);
  const same={
    water:{...x.trustedKeys.water,receipt:x.trustedKeys.water.report},
    rain:x.trustedKeys.rain
  };
  assert.throws(()=>x.open({trustedKeys:same}),/Duplicate issuer/);
}));

test('a replaced older but VALID sealed snapshot remains a documented nonrollback gap',()=>withSetup(x=>{
  const journal=x.open();
  journal.initialize(x.bootstrap);
  const file=location(x.directory);
  const oldBytes=fs.readFileSync(file);
  const nextRecord=x.publicRecord('water',2);
  const next=x.proposal('water',x.bootstrap.water.signedAnchor,nextRecord);
  assert.equal(journal.advance(next).advanced,true);
  assert.equal(x.open().snapshot().water.anchor.sequence,2);
  // This privileged laboratory mutation simulates restore of a whole prior
  // signed, HMAC-valid file; without an *external* nonrollback witness the
  // local file alone is incapable of recognizing this rollback.
  fs.writeFileSync(file,oldBytes);
  assert.equal(x.open().snapshot().water.anchor.sequence,1);
  assert.equal(x.open().snapshot().generation,0);
}));

test('implementation remains local-only and rejects accessible directory mode',()=>withSetup(x=>{
  const src=fs.readFileSync('experiments/r2-local-anchor-journal-lab.mjs','utf8');
  assert.doesNotMatch(src,/firebase-admin|serviceAccount|node:https|node:http/);
  assert.doesNotMatch(src,/\b(?:fetch|XMLHttpRequest|WebSocket)\s*\(|\.ref\s*\(/);
  fs.chmodSync(x.directory,0o755);
  assert.throws(()=>x.open(),/Unsafe local journal directory permissions/);
}));
