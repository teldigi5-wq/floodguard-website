// FloodGuard R3: isolated REAL SQLite ACID host tests, all records SYNTHETIC.
// No network, Firebase, secrets, live device, alarm or physical gate.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {DatabaseSync} from 'node:sqlite';
import {createHash,generateKeyPairSync,sign} from 'node:crypto';
import {canonicalOfflineEnvelope} from '../experiments/stage7-durable-ingress.mjs';
import {verifySyntheticPublicationAttestation}
  from '../experiments/synthetic-publication-attestation.mjs';
import {planThreeSignerWaterProjectionGate}
  from '../experiments/three-signer-water-projection-gate.mjs';
import {createTransactionalSqliteAuthorityLab}
  from '../experiments/transactional-sqlite-authority-lab.mjs';

const NOW=1700000001500,ID='device-stage-a',SEED='a'.repeat(64);
const signature=(text,key)=>sign(null,Buffer.from(text),key).toString('base64url');
function setup(run){
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'fg-r3-sqlite-local-only-'));
  const databasePath=path.join(directory,'synthetic-authority.sqlite');
  const device=generateKeyPairSync('ed25519'),
    receiptSigner=generateKeyPairSync('ed25519'),
    dbSigner=generateKeyPairSync('ed25519');
  let now=NOW;
  const create=(opts={})=>createTransactionalSqliteAuthorityLab({
    databasePath,mode:'open',devicePublicKey:device.publicKey,
    receiptIssuerPublicKey:receiptSigner.publicKey,
    databaseIssuerPrivateKey:dbSigner.privateKey,
    databaseIssuerPublicKey:dbSigner.publicKey,
    clock:()=>now,allowSyntheticConfirmationWrites:true,...opts
  });
  const commissioning=()=>create({mode:'commission'});
  const seed={deviceId:ID,epoch:1,previousSequence:1,previousDigest:SEED};
  const frame=(sequence=2,risk='WARNING')=>{
    const envelope={
      version:'floodguard-offline-envelope-v1',deviceId:ID,epoch:1,
      observedAtMs:NOW-900,
      frame:{sequence,distanceCm:16.5,levelCm:8.5,risk}
    };
    const message=canonicalOfflineEnvelope(envelope);
    const digest=createHash('sha256').update(message).digest('hex');
    const receipt={
      version:'floodguard-offline-receipt-v1',deviceId:ID,epoch:1,
      sequence,digest,acceptedAtMs:NOW-500
    };
    return {
      envelope,deviceSignature:signature(message,device.privateKey),
      receipt,receiptSignature:signature(JSON.stringify(receipt),receiptSigner.privateKey),
      record:{
        deviceId:ID,epoch:1,sequence,digest,
        acceptedAtMs:NOW-500,status:'DATABASE_CONFIRMED'
      }
    };
  };
  try {
    return run({directory,databasePath,device,receiptSigner,dbSigner,
      create,commissioning,seed,frame,setNow:x=>{now=x;}});
  }finally {
    fs.rmSync(directory,{recursive:true,force:true});
  }
}
const noGo=result=>{
  for(const key of ['canPublish','canAcknowledge','canSendAlert',
    'canOperateGate','productionGo'])
    assert.equal(result[key],false,key);
};
const checkDenied=(value,reason)=>{
  assert.equal(value.issued,false,JSON.stringify(value));
  if(reason)assert.equal(value.reason,reason);
  assert.equal(value.signature,undefined);
  noGo(value);
};
const req=x=>({receipt:x.receipt,receiptSignature:x.receiptSignature});
function provision(x){
  const a=x.commissioning();
  assert.deepEqual(a.commissionDevice(x.seed),{
    commissioned:true,productionGo:false
  });
  return a;
}

test('missing database is never opened or auto-commissioned in recovery mode',()=>{
  setup(h=>{
    assert.throws(()=>h.create(),/ENOENT|unavailable/);
    const a=provision(h);a.close();
    assert.throws(()=>h.commissioning(),/Already commissioned/);
    fs.unlinkSync(h.databasePath);
    assert.throws(()=>h.create(),/ENOENT|unavailable/);
    assert.throws(()=>h.commissioning(),/Already commissioned/);
  });
});
test('explicit operator seed is mandatory; invalid input does not create a device',()=>{
  setup(h=>{
    const a=h.commissioning();
    checkDenied(a.commissionDevice(null),'explicit-operator-seed-required');
    checkDenied(a.commissionDevice({...h.seed,previousSequence:0}),
      'explicit-operator-seed-required');
    checkDenied(a.commissionDevice({...h.seed,previousDigest:'wrong'}),
      'explicit-operator-seed-required');
    assert.equal(a.snapshot(ID),null);
    assert.equal(a.commissionDevice(h.seed).commissioned,true);
    checkDenied(a.commissionDevice(h.seed),'operator-commission-refused');
    a.close();
  });
});
test('signed acceptance plus independently stored synthetic row emits atomic offline signature',()=>{
  setup(h=>{
    const a=provision(h),x=h.frame();
    assert.equal(a.recordSyntheticConfirmationForTest(x.record).stored,true);
    const out=a.attest(req(x));
    assert.equal(out.issued,true,JSON.stringify(out));
    assert.equal(out.kind,'SYNTHETIC_SQLITE_TRANSACTIONAL_ATTESTATION_NOT_PUBLISHED');
    assert.equal(out.physicalSourceVerified,false);
    noGo(out);
    assert.equal(verifySyntheticPublicationAttestation({
      attestation:out.attestation,signature:out.signature,
      publicKey:h.dbSigner.publicKey,receipt:x.receipt,nowMs:NOW
    }),true);
    assert.equal(a.snapshot(ID).sequence,2);
    a.close();
  });
});
test('SQLite transaction result composes with PR73 three-signer offline leaf planner',()=>{
  setup(h=>{
    const a=provision(h),x=h.frame();
    a.recordSyntheticConfirmationForTest(x.record);
    const out=a.attest(req(x));
    assert.equal(out.issued,true);
    const plan=planThreeSignerWaterProjectionGate({
      envelope:x.envelope,deviceSignature:x.deviceSignature,
      sourceBinding:{
        deviceId:ID,epoch:1,enabled:true,scope:'prototype-ingest-v1',
        publicKey:h.device.publicKey
      },
      receipt:x.receipt,receiptSignature:x.receiptSignature,
      trustedReceiptKey:h.receiptSigner.publicKey,
      attestation:out.attestation,attestationSignature:out.signature,
      trustedDatabaseIssuerKey:h.dbSigner.publicKey,
      databaseRecord:x.record,
      lastPublished:{initialized:true,epoch:1,sequence:1,digest:SEED},
      nowMs:NOW
    });
    assert.equal(plan.planned,true,JSON.stringify(plan));
    assert.equal(plan.proposedLeaves['system/overallRisk'],'UNKNOWN');
    assert.equal(plan.canPublish,false);
    assert.equal(plan.canOperateGate,false);
    a.close();
  });
});
test('duplicate/replayed sequence and gaps fail closed across new connections',()=>{
  setup(h=>{
    const a=provision(h),x=h.frame();
    a.recordSyntheticConfirmationForTest(x.record);
    assert.equal(a.attest(req(x)).issued,true);
    a.close();
    const b=h.create();
    checkDenied(b.attest(req(x)),'issuance-replay-or-gap');
    const gap=h.frame(4);
    assert.equal(b.recordSyntheticConfirmationForTest(gap.record).stored,true);
    checkDenied(b.attest(req(gap)),'issuance-replay-or-gap');
    assert.equal(b.snapshot(ID).sequence,2);
    b.close();
  });
});
test('revocation before issuance is atomic with confirmation and cursor state',()=>{
  setup(h=>{
    const a=provision(h),x=h.frame();
    a.recordSyntheticConfirmationForTest(x.record);
    const revoked=a.revoke(ID);
    assert.equal(revoked.revoked,true);
    noGo(revoked);
    checkDenied(a.attest(req(x)),'operator-not-authorized');
    assert.equal(a.snapshot(ID).sequence,1);
    assert.equal(a.snapshot(ID).enabled,false);
    a.close();
  });
});
test('revocation after issued commit prevents later issuance; prior receipt is historic only',()=>{
  setup(h=>{
    const a=provision(h),x=h.frame();
    a.recordSyntheticConfirmationForTest(x.record);
    const committed=a.attest(req(x));
    assert.equal(committed.issued,true);
    assert.equal(a.revoke(ID).revoked,true);
    const later=h.frame(3);
    assert.equal(a.recordSyntheticConfirmationForTest(later.record).stored,false);
    checkDenied(a.attest(req(later)),'operator-not-authorized');
    noGo(committed);
    a.close();
  });
});
test('two SQLite connections enforce exclusive writer lock rather than cooperative file locks',()=>{
  setup(h=>{
    const a=provision(h),x=h.frame();
    a.recordSyntheticConfirmationForTest(x.record);
    const separate=h.create();
    const outsider=new DatabaseSync(h.databasePath);
    outsider.exec('PRAGMA busy_timeout=0');
    outsider.exec('BEGIN IMMEDIATE');
    checkDenied(separate.attest(req(x)),'transaction-unavailable');
    assert.equal(a.snapshot(ID).sequence,1);
    outsider.exec('ROLLBACK');outsider.close();
    assert.equal(separate.attest(req(x)).issued,true);
    checkDenied(a.attest(req(x)),'issuance-replay-or-gap');
    a.close();separate.close();
  });
});
test('forged Stage8 signature, wrong digest and unconfirmed record do not issue',()=>{
  setup(h=>{
    const a=provision(h),x=h.frame();
    checkDenied(a.attest(req(x)),'test-database-unconfirmed');
    a.recordSyntheticConfirmationForTest(x.record);
    checkDenied(a.attest({...req(x),receiptSignature:'A'.repeat(86)}),
      'signed-acceptance-invalid');
    const tampered={...x.receipt,digest:'f'.repeat(64)};
    checkDenied(a.attest({receipt:tampered,receiptSignature:x.receiptSignature}),
      'signed-acceptance-invalid');
    checkDenied(a.attest({...req(x),databaseRecord:x.record,admin:true}),
      'request-shape-invalid');
    assert.equal(a.snapshot(ID).sequence,1);
    a.close();
  });
});
test('fixture write capability is explicitly disabled unless locally enabled',()=>{
  setup(h=>{
    const a=provision(h),x=h.frame();
    const other=h.create({allowSyntheticConfirmationWrites:false});
    assert.equal(other.recordSyntheticConfirmationForTest(x.record).stored,false);
    checkDenied(other.attest(req(x)),'test-database-unconfirmed');
    other.close();a.close();
  });
});
test('pre-commit injected crash rolls back signer cursor and issued row',()=>{
  setup(h=>{
    const a=provision(h),x=h.frame();a.recordSyntheticConfirmationForTest(x.record);
    const crashed=h.create({failPoint:'before-commit'});
    checkDenied(crashed.attest(req(x)),'simulated-pre-commit-crash');
    assert.equal(crashed.snapshot(ID).sequence,1);
    const sqlite=new DatabaseSync(h.databasePath);
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM issued').get().n,0);
    sqlite.close();crashed.close();
    assert.equal(a.attest(req(x)).issued,true);
    a.close();
  });
});
test('committed-but-lost response preserves signed record and denies retry',()=>{
  setup(h=>{
    const a=provision(h),x=h.frame();a.recordSyntheticConfirmationForTest(x.record);
    const crashed=h.create({failPoint:'after-commit-before-response'});
    checkDenied(crashed.attest(req(x)),'simulated-response-lost-after-commit');
    assert.equal(crashed.snapshot(ID).sequence,2);
    crashed.close();
    const sqlite=new DatabaseSync(h.databasePath);
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM issued').get().n,1);
    sqlite.close();
    checkDenied(a.attest(req(x)),'issuance-replay-or-gap');
    a.close();
  });
});
test('wrong issuer key on restart and role-key reuse are refused',()=>{
  setup(h=>{
    const a=provision(h);a.close();
    const stranger=generateKeyPairSync('ed25519');
    assert.throws(()=>h.create({databaseIssuerPrivateKey:stranger.privateKey,
      databaseIssuerPublicKey:stranger.publicKey}),/Pinned issuer/);
    assert.throws(()=>h.create({
      databaseIssuerPrivateKey:h.receiptSigner.privateKey,
      databaseIssuerPublicKey:h.receiptSigner.publicKey
    }),/Signer role confusion/);
  });
});
test('mismatched immutable confirmation cannot be overwritten by another fixture',()=>{
  setup(h=>{
    const a=provision(h),x=h.frame();
    assert.equal(a.recordSyntheticConfirmationForTest(x.record).stored,true);
    assert.equal(a.recordSyntheticConfirmationForTest({...x.record,digest:'f'.repeat(64)}).stored,false);
    assert.equal(a.attest(req(x)).issued,true);
    a.close();
  });
});
test('no endpoint, Firebase SDK, OTA upload, production signing or actuator authority',()=>{
  const src=fs.readFileSync('experiments/transactional-sqlite-authority-lab.mjs','utf8');
  assert.doesNotMatch(src,/firebase-admin|firebase\/database|node:https|node:http|\.listen\s*\(/);
  assert.doesNotMatch(src,/\bfetch\s*\(|\.ref\s*\(|\.set\s*\(|\.updateChildren\s*\(|servo\.write/);
  assert.doesNotMatch(src,/process\.env|serviceAccount|sendMessage\s*\(|digitalWrite|\/floodguard\/live/);
  assert.match(src,/BEGIN IMMEDIATE/);
  assert.match(src,/PRAGMA synchronous=FULL/);
  assert.match(src,/COMMIT/);
  assert.match(src,/verifyStage8OfflineReceipt/);
  assert.match(src,/verifySyntheticPublicationAttestation/);
  assert.match(src,/canOperateGate:false/);
});
