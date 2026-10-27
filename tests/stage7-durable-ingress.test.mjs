import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {generateKeyPairSync,randomBytes,sign,createHmac} from 'node:crypto';
import {canonicalOfflineEnvelope,createStage7OfflineLedger,createStage7OfflineContract}
  from '../experiments/stage7-durable-ingress.mjs';

const device='device-stage-a';
const frame=seq=>({sequence:seq,distanceCm:17.5,levelCm:7.5,risk:'SAFE'});
const setup=()=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'floodguard-stage7-test-'));
  const integrityKey=randomBytes(32);
  const keys=generateKeyPairSync('ed25519');
  const ledger=()=>createStage7OfflineLedger({directory,integrityKey});
  let now=1700000000000;
  const instance=()=>createStage7OfflineContract({ledger:ledger(),clock:()=>now});
  const first=instance();
  first.provision(device,{publicKey:keys.publicKey});
  const marker=first.issueOfflineChannelProof();
  const envelope=(sequence,changes={})=>({
    version:'floodguard-offline-envelope-v1',deviceId:device,epoch:1,
    observedAtMs:now,frame:frame(sequence),...changes
  });
  const signature=(item,key=keys.privateKey)=>sign(null,Buffer.from(canonicalOfflineEnvelope(item)),key).toString('base64url');
  return {directory,integrityKey,keys,ledger,instance,first,marker,envelope,signature,now:()=>now,
    tick:ms=>{now+=ms;},clean:()=>fs.rmSync(directory,{recursive:true,force:true})};
};
function withSetup(fn){
  const ctx=setup();
  try{return fn(ctx);}finally{ctx.clean();}
}
test('offline Ed25519 signature succeeds for a scoped synthetic identity and advances local ledger',()=>withSetup(x=>{
  const e=x.envelope(1);
  assert.deepEqual(x.first.accept({envelope:e,signature:x.signature(e),channelProof:x.marker}),
    {accepted:true,kind:'OFFLINE_LEDGER_COMMIT_ONLY',sequence:1});
  assert.equal(x.ledger().last(device).sequence,1);
}));
test('forged signature, unsigned frames and unknown device fail closed without ledger writes',()=>withSetup(x=>{
  const e=x.envelope(1),wrong=generateKeyPairSync('ed25519');
  for(const signature of [null,'garbage',x.signature(e,wrong.privateKey)]){
    assert.equal(x.first.accept({envelope:e,signature,channelProof:x.marker}).accepted,false);
  }
  const other=x.envelope(1,{deviceId:'device-stage-unknown'});
  assert.equal(x.first.accept({envelope:other,signature:x.signature(other),channelProof:x.marker}).accepted,false);
  assert.equal(x.ledger().last(device),null);
}));
test('caller-supplied boolean or shape-alike transport proof cannot simulate verified TLS',()=>withSetup(x=>{
  const e=x.envelope(1),sig=x.signature(e);
  for(const proof of [true,null,{kind:'SIMULATED_VERIFIED_CHANNEL_NOT_TLS'},Object.freeze({kind:'SIMULATED_VERIFIED_CHANNEL_NOT_TLS'})]){
    assert.equal(x.first.accept({envelope:e,signature:sig,channelProof:proof}).reason,'transport-unverified');
  }
  assert.equal(x.ledger().last(device),null);
}));
test('timestamp expiry and future-dated telemetry are rejected even when correctly signed',()=>withSetup(x=>{
  for(const observedAtMs of [x.now()-30001,x.now()+2001]){
    const e=x.envelope(1,{observedAtMs});
    assert.equal(x.first.accept({envelope:e,signature:x.signature(e),channelProof:x.marker}).reason,'timestamp-outside-window');
  }
  const old=x.envelope(1);
  x.tick(30001);
  assert.equal(x.first.accept({envelope:old,signature:x.signature(old),channelProof:x.marker}).accepted,false);
  assert.equal(x.ledger().last(device),null);
}));
test('signed envelope rejects unknown/missing keys, private metadata, invalid sensor values and oversize',()=>withSetup(x=>{
  const bad=[{...x.envelope(1),extra:true},{...x.envelope(1),frame:{...frame(1),ip:'198.51.100.1'}},
    {...x.envelope(1),frame:{sequence:1,risk:'SAFE'}},
    {...x.envelope(1),frame:{...frame(1),risk:'OPEN'}},
    {...x.envelope(1),frame:{...frame(1),sequence:1.5}},
    {...x.envelope(1),frame:{...frame(1),distanceCm:401}},
    {...x.envelope(1),epoch:0},
    {...x.envelope(1),deviceId:'production-device'},
    {...x.envelope(1),frame:{...frame(1),pad:'X'.repeat(800)}}
  ];
  for(const e of bad){
    assert.throws(()=>canonicalOfflineEnvelope(e),TypeError);
    assert.equal(x.first.accept({envelope:e,signature:'bogus',channelProof:x.marker}).accepted,false);
  }
}));
test('changing signed payload or ID after signing never changes ledger',()=>withSetup(x=>{
  const e=x.envelope(1),sig=x.signature(e);
  e.frame.risk='DANGER';
  assert.equal(x.first.accept({envelope:e,signature:sig,channelProof:x.marker}).reason,'invalid-signature');
  assert.equal(x.ledger().last(device),null);
}));
test('duplicate and lower sequences rejected across independent restarts',()=>withSetup(x=>{
  const e=x.envelope(6);
  assert.equal(x.first.accept({envelope:e,signature:x.signature(e),channelProof:x.marker}).accepted,true);
  const restarted=x.instance();restarted.provision(device,{publicKey:x.keys.publicKey});
  const proof=restarted.issueOfflineChannelProof();
  for(const seq of [6,5]){
    const item=x.envelope(seq);
    assert.equal(restarted.accept({envelope:item,signature:x.signature(item),channelProof:proof}).reason,'replay-or-out-of-order');
  }
  const next=x.envelope(7);
  assert.equal(restarted.accept({envelope:next,signature:x.signature(next),channelProof:proof}).accepted,true);
  assert.equal(x.ledger().last(device).sequence,7);
}));
test('restarting without explicit identity provisioning fails closed',()=>withSetup(x=>{
  const e=x.envelope(1),restarted=x.instance(),proof=restarted.issueOfflineChannelProof();
  assert.equal(restarted.accept({envelope:e,signature:x.signature(e),channelProof:proof}).reason,'unprovisioned-or-revoked');
  assert.equal(x.ledger().last(device),null);
}));
test('re-provisioning same UID with a different key cannot reset recorded sequence',()=>withSetup(x=>{
  const e=x.envelope(7);x.first.accept({envelope:e,signature:x.signature(e),channelProof:x.marker});
  const different=generateKeyPairSync('ed25519'),restarted=x.instance();
  restarted.provision(device,{publicKey:different.publicKey});
  const proof=restarted.issueOfflineChannelProof(),item=x.envelope(8);
  const sig=sign(null,Buffer.from(canonicalOfflineEnvelope(item)),different.privateKey).toString('base64url');
  assert.equal(restarted.accept({envelope:item,signature:sig,channelProof:proof}).reason,'identity-epoch-mismatch');
  assert.equal(x.ledger().last(device).sequence,7);
}));
test('epoch change requires separate reviewed migration rather than silently resetting replay counter',()=>withSetup(x=>{
  const e=x.envelope(4);x.first.accept({envelope:e,signature:x.signature(e),channelProof:x.marker});
  const restarted=x.instance();restarted.provision(device,{publicKey:x.keys.publicKey,epoch:2});
  const item=x.envelope(1,{epoch:2}),proof=restarted.issueOfflineChannelProof();
  assert.equal(restarted.accept({envelope:item,signature:x.signature(item),channelProof:proof}).reason,'identity-epoch-mismatch');
  assert.equal(x.ledger().last(device).sequence,4);
}));
test('revocation blocks valid signatures and preserves previous accepted record',()=>withSetup(x=>{
  const first=x.envelope(1);x.first.accept({envelope:first,signature:x.signature(first),channelProof:x.marker});
  x.first.revoke(device);
  const next=x.envelope(2);
  assert.equal(x.first.accept({envelope:next,signature:x.signature(next),channelProof:x.marker}).reason,'unprovisioned-or-revoked');
  assert.equal(x.ledger().last(device).sequence,1);
}));
test('tampered signed replay ledger fails closed; never automatically resets',()=>withSetup(x=>{
  const e=x.envelope(5);x.first.accept({envelope:e,signature:x.signature(e),channelProof:x.marker});
  const file=path.join(x.directory,'stage7-synthetic-ledger.json');
  const snapshot=JSON.parse(fs.readFileSync(file,'utf8'));
  snapshot.state.records[device].sequence=0;
  fs.writeFileSync(file,JSON.stringify(snapshot));
  assert.throws(()=>x.ledger().last(device),/integrity failure/);
  const next=x.envelope(6);
  assert.equal(x.first.accept({envelope:next,signature:x.signature(next),channelProof:x.marker}).reason,'ledger-unavailable');
}));
test('losing the integrity key cannot restore or overwrite a sealed replay ledger',()=>withSetup(x=>{
  const e=x.envelope(1);x.first.accept({envelope:e,signature:x.signature(e),channelProof:x.marker});
  const wrong=createStage7OfflineLedger({directory:x.directory,integrityKey:randomBytes(32)});
  assert.throws(()=>wrong.last(device),/integrity failure/);
  assert.throws(()=>wrong.commit({uid:device,epoch:1,sequence:2,keyFingerprint:x.ledger().last(device).keyFingerprint}),/integrity failure/);
  assert.equal(x.ledger().last(device).sequence,1);
}));
test('existing lock fails closed and remains untouched (crash recovery requires operator review)',()=>withSetup(x=>{
  const lock=path.join(x.directory,'stage7-synthetic-ledger.lock');
  fs.writeFileSync(lock,'OPERATOR-REVIEW-REQUIRED',{flag:'wx'});
  const e=x.envelope(1);
  assert.equal(x.first.accept({envelope:e,signature:x.signature(e),channelProof:x.marker}).reason,'ledger-unavailable');
  assert.equal(fs.readFileSync(lock,'utf8'),'OPERATOR-REVIEW-REQUIRED');
  fs.unlinkSync(lock);
  assert.equal(x.ledger().last(device),null);
}));
test('truncated or non-JSON ledger does not look like an empty device registry',()=>withSetup(x=>{
  const file=path.join(x.directory,'stage7-synthetic-ledger.json');
  fs.writeFileSync(file,'{unavailable',{flag:'wx'});
  assert.throws(()=>x.ledger().last(device));
  const e=x.envelope(1);
  assert.equal(x.first.accept({envelope:e,signature:x.signature(e),channelProof:x.marker}).reason,'ledger-unavailable');
}));
test('same device cannot be committed twice at identical sequence even from distinct ledger instances',()=>withSetup(x=>{
  const e=x.envelope(1);x.first.accept({envelope:e,signature:x.signature(e),channelProof:x.marker});
  const entry=x.ledger().last(device),other=x.ledger();
  assert.deepEqual(other.commit({uid:device,epoch:1,sequence:1,keyFingerprint:entry.keyFingerprint}),
    {accepted:false,reason:'replay-or-out-of-order'});
  assert.equal(x.ledger().last(device).sequence,1);
}));
test('off-network implementation only writes inside an explicitly selected test directory',()=>{
  const file=fs.readFileSync('experiments/stage7-durable-ingress.mjs','utf8');
  assert.doesNotMatch(file,/(?:fetch|WebSocket|XMLHttpRequest|\.listen)\s*\(/);
  assert.doesNotMatch(file,/firebase-admin|process\.env|\.env\b|FIREBASE_DATABASE_URL|baileys|DATA_PATH/);
  assert.doesNotMatch(file,/node:http|node:https|node:tls|node:net/);
  assert.match(file,/OPEN.*|openSync/);
});
