// FloodGuard R3: synthetic local-only monotonic Ed25519 issuance journal.
// Actual POSIX filesystem used in temporary directory, no cloud or hardware.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {createHash,generateKeyPairSync,randomBytes,sign}
  from 'node:crypto';
import {createOperatorDeviceRegistryLab}
  from '../experiments/operator-device-registry-lab.mjs';
import {createStage9SyntheticDatabase}
  from '../experiments/stage9-downstream-outbox.mjs';
import {createIndependentDbConfirmationIssuerLab}
  from '../experiments/independent-db-confirmation-issuer-lab.mjs';
import {createDurableOfflineIssuerCheckpointLab}
  from '../experiments/durable-offline-issuer-checkpoint-lab.mjs';
import {canonicalOfflineEnvelope}
  from '../experiments/stage7-durable-ingress.mjs';

const NOW=1700000001500,ID='device-stage-a',SEED='a'.repeat(64);
const signature=(text,k)=>sign(null,Buffer.from(text),k).toString('base64url');
function fixture(fn) {
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'fg-r3-durable-issuer-test-'));
  const registryKey=randomBytes(32),databaseKey=randomBytes(32),ledgerKey=randomBytes(32);
  const device=generateKeyPairSync('ed25519'),
    receiptKey=generateKeyPairSync('ed25519'),
    issuerKey=generateKeyPairSync('ed25519');
  const registry=()=>createOperatorDeviceRegistryLab({
    directory,integrityKey:registryKey
  });
  const db=()=>createStage9SyntheticDatabase({directory,integrityKey:databaseKey});
  let currentTime=NOW;
  function request(sequence=2) {
    const envelope={version:'floodguard-offline-envelope-v1',deviceId:ID,epoch:1,
      observedAtMs:NOW-900,
      frame:{sequence,distanceCm:16.5,levelCm:8.5,risk:'WARNING'}};
    const digest=createHash('sha256').update(canonicalOfflineEnvelope(envelope)).digest('hex');
    const receipt={version:'floodguard-offline-receipt-v1',
      deviceId:ID,epoch:1,sequence,digest,acceptedAtMs:NOW-500};
    return {request:{receipt,receiptSignature:signature(
      JSON.stringify(receipt),receiptKey.privateKey)},
      stored:{deviceId:ID,epoch:1,sequence,digest,
        acceptedAtMs:NOW-500,status:'DATABASE_CONFIRMED'}};
  }
  const issuer=()=>createIndependentDbConfirmationIssuerLab({
    databaseReader:Object.freeze({get:deviceId=>db().get(deviceId)}),
    operatorRegistry:registry(),receiptIssuerPublicKey:receiptKey.publicKey,
    databaseIssuerPrivateKey:issuerKey.privateKey,
    databaseIssuerPublicKey:issuerKey.publicKey,clock:()=>currentTime
  });
  const ledger=(options={})=>createDurableOfflineIssuerCheckpointLab({
    directory,integrityKey:ledgerKey,issuer:issuer(),
    issuerPublicKey:issuerKey.publicKey,clock:()=>currentTime,...options
  });
  const seed={deviceId:ID,epoch:1,sequence:1,digest:SEED,
    acceptedAtMs:NOW-1000};
  try{
    registry().commission();registry().enroll(ID,device.publicKey);
    return fn({directory,registry,db,issuer,ledger,seed,request,
      changeTime:v=>{currentTime=v;},issuerKey,receiptKey,ledgerKey});
  }finally{fs.rmSync(directory,{recursive:true,force:true});}
}
const deny=(value,reason)=>{
  assert.equal(value.issued,false,JSON.stringify(value));
  if(reason)assert.equal(value.reason,reason);
  assert.equal(value.signature,undefined);
  for(const k of ['canPublish','canAcknowledge','canSendAlert','canOperateGate'])
    assert.equal(value[k],false);
};

test('missing commissioned issuer history refuses signing and cannot auto-create',()=>{
  fixture(h=>{
    const x=h.request();
    h.db().put(x.stored);
    deny(h.ledger().attest(x.request),'sealed-issuance-history-unavailable');
    assert.equal(fs.existsSync(path.join(h.directory,'r3-local-issuance-checkpoint.json')),false);
    assert.equal(fs.existsSync(path.join(h.directory,'r3-local-issuance-commissioned.marker')),false);
  });
});

test('explicit operator seed, durable commit, restart, and duplicate denial',()=>{
  fixture(h=>{
    const ledger=h.ledger();
    assert.deepEqual(ledger.commission(h.seed),{
      commissioned:true,releaseAuthorized:false
    });
    const {request,stored}=h.request(2);
    h.db().put(stored);
    const first=ledger.attest(request);
    assert.equal(first.issued,true,JSON.stringify(first));
    assert.equal(first.kind,'LOCAL_SYNTHETIC_DURABLY_RECORDED_ATTESTATION');
    assert.equal(first.releaseAuthorized,false);
    assert.equal(first.canPublish,false);
    assert.equal(first.canAcknowledge,false);
    assert.equal(first.canOperateGate,false);
    assert.deepEqual(h.ledger().checkpoint(),{
      deviceId:ID,epoch:1,sequence:2,digest:request.receipt.digest,
      revision:2,releaseAuthorized:false
    });
    deny(h.ledger().attest(request),'issuance-replay-gap-or-identity-conflict');
    assert.throws(()=>h.ledger().commission(h.seed),/already commissioned/);
  });
});

test('wrong seed and unapproved empty device cannot initialize',()=>{
  fixture(h=>{
    for(const seed of [undefined,{}, {...h.seed,sequence:0},
      {...h.seed,digest:'not-a-hash'}, {...h.seed,unexpected:true}]){
      assert.throws(()=>h.ledger().commission(seed),/Explicit operator/);
    }
    assert.equal(fs.existsSync(path.join(h.directory,'r3-local-issuance-commissioned.marker')),false);
  });
});

test('sequence gaps, epoch transitions, identity swaps and injected request fields fail closed',()=>{
  fixture(h=>{
    h.ledger().commission(h.seed);
    h.db().put(h.request(3).stored);
    deny(h.ledger().attest(h.request(3).request),
      'issuance-replay-gap-or-identity-conflict');
    const r=h.request(2);
    deny(h.ledger().attest({receipt:{...r.request.receipt,epoch:2},
      receiptSignature:r.request.receiptSignature}),
      'issuance-replay-gap-or-identity-conflict');
    deny(h.ledger().attest({receipt:{...r.request.receipt,deviceId:'device-stage-b'},
      receiptSignature:r.request.receiptSignature}),
      'issuance-replay-gap-or-identity-conflict');
    deny(h.ledger().attest({...r.request,databaseRecord:r.stored,admin:true}),
      'issuance-replay-gap-or-identity-conflict');
    assert.equal(h.ledger().checkpoint().sequence,1);
  });
});

test('forged receipt and operator revocation do not advance sealed checkpoint',()=>{
  fixture(h=>{
    h.ledger().commission(h.seed);
    const r=h.request(2);
    h.db().put(r.stored);
    deny(h.ledger().attest({...r.request,receiptSignature:'A'.repeat(86)}),
      'acceptance-signature-invalid');
    h.registry().revoke(ID);
    deny(h.ledger().attest(r.request),'operator-authorization-unverified');
    assert.equal(h.ledger().checkpoint().sequence,1);
  });
});

test('unconfirmed, missing, or MAC-corrupt database does not advance ledger',()=>{
  fixture(h=>{
    h.ledger().commission(h.seed);
    const r=h.request(2);
    deny(h.ledger().attest(r.request),
      'independent-database-read-unconfirmed');
    h.db().put(r.stored);
    const file=path.join(h.directory,'stage9-database.json');
    const saved=fs.readFileSync(file,'utf8');
    fs.writeFileSync(file,saved.replace('DATABASE_CONFIRMED','ACCEPTED_ONLY'));
    deny(h.ledger().attest(r.request),'offline-authority-or-db-unavailable');
    assert.equal(h.ledger().checkpoint().sequence,1);
  });
});

test('missing issued ledger or commissioning marker after restart stays fail closed',()=>{
  for(const filename of ['r3-local-issuance-checkpoint.json',
    'r3-local-issuance-commissioned.marker']){
    fixture(h=>{
      h.ledger().commission(h.seed);
      const r=h.request(2);h.db().put(r.stored);
      fs.unlinkSync(path.join(h.directory,filename));
      deny(h.ledger().attest(r.request),'sealed-issuance-history-unavailable');
      assert.throws(()=>h.ledger().commission(h.seed),/already commissioned/);
    });
  }
});

test('tampered, wrong-MAC-key, symlinked or stale-locked issuer history denies',()=>{
  fixture(h=>{
    h.ledger().commission(h.seed);
    const r=h.request(2);h.db().put(r.stored);
    const file=path.join(h.directory,'r3-local-issuance-checkpoint.json');
    const original=fs.readFileSync(file,'utf8');
    fs.writeFileSync(file,original.replace('"sequence":1','"sequence":8'));
    deny(h.ledger().attest(r.request),'sealed-issuance-history-unavailable');
    fs.writeFileSync(file,original);
    const wrong=h.ledger({integrityKey:randomBytes(32)});
    deny(wrong.attest(r.request),'sealed-issuance-history-unavailable');
    fs.unlinkSync(file);
    const another=path.join(h.directory,'fake-ledger.json');
    fs.writeFileSync(another,original);
    fs.symlinkSync(another,file);
    deny(h.ledger().attest(r.request),'sealed-issuance-history-unavailable');
    fs.unlinkSync(file);fs.writeFileSync(file,original);
    const lock=path.join(h.directory,'r3-local-issuance-checkpoint.lock');
    fs.writeFileSync(lock,'STALE LOCK');
    deny(h.ledger().attest(r.request),'sealed-issuance-history-unavailable');
    assert.equal(fs.readFileSync(lock,'utf8'),'STALE LOCK');
  });
});

test('simulated interrupted commit never returns an unrecorded signature',()=>{
  fixture(h=>{
    h.ledger().commission(h.seed);
    const r=h.request(2);h.db().put(r.stored);
    deny(h.ledger({failPoint:'before-commit'}).attest(r.request),
      'simulated-before-durable-commit');
    assert.equal(h.ledger().checkpoint().sequence,1);
    assert.equal(h.ledger().attest(r.request).issued,true);
    assert.equal(h.ledger().checkpoint().sequence,2);
  });
});

test('simulated lost response AFTER durable commit cannot reissue on restart',()=>{
  fixture(h=>{
    h.ledger().commission(h.seed);
    const r=h.request(2);h.db().put(r.stored);
    deny(h.ledger({failPoint:'after-commit-before-return'}).attest(r.request),
      'simulated-response-lost-after-commit');
    assert.equal(h.ledger().checkpoint().sequence,2);
    deny(h.ledger().attest(r.request),'issuance-replay-gap-or-identity-conflict');
  });
});

test('wrong issuer key cannot open a previously sealed signer checkpoint',()=>{
  fixture(h=>{
    h.ledger().commission(h.seed);
    const other=generateKeyPairSync('ed25519');
    const x=h.ledger({issuerPublicKey:other.publicKey});
    const r=h.request(2);h.db().put(r.stored);
    deny(x.attest(r.request),'sealed-issuance-history-unavailable');
  });
});

test('ledger requires contiguous sequential issuance and refuses full capacity',()=>{
  fixture(h=>{
    h.ledger().commission(h.seed);
    for(let seq=2;seq<=16;seq++){
      const r=h.request(seq);
      assert.equal(h.db().put(r.stored).status,'persisted');
      const result=h.ledger().attest(r.request);
      assert.equal(result.issued,true,JSON.stringify({seq,result}));
    }
    const r=h.request(17);
    h.db().put(r.stored);
    deny(h.ledger().attest(r.request),'issuance-ledger-capacity');
    assert.equal(h.ledger().checkpoint().revision,16);
  });
});

test('offline issuance checkpoint has no production writers, network, ack or gate commands',()=>{
  const source=fs.readFileSync('experiments/durable-offline-issuer-checkpoint-lab.mjs','utf8');
  assert.doesNotMatch(source,/firebase-admin|firebase\/database|node:https|node:http|\.listen\s*\(/);
  assert.doesNotMatch(source,/\bfetch\s*\(|\.ref\s*\(|\.set\s*\(|\.updateChildren\s*\(|servo\.write/);
  assert.doesNotMatch(source,/process\.env|serviceAccount|sendMessage\s*\(|digitalWrite/);
  assert.match(source,/fs\.fsyncSync\(fd\)/);
  assert.match(source,/fs\.fsyncSync\(d\)/);
  assert.match(source,/fs\.renameSync\(tmp,file\)/);
  assert.match(source,/issuer\.attest\(request\)/);
  assert.match(source,/verifySyntheticPublicationAttestation/);
  assert.match(source,/return denial\('sealed-issuance-history-unavailable'\)/);
});
