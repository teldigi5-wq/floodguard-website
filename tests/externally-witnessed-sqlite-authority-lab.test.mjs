// FloodGuard R3: all inputs SYNTHETIC. The witness is an in-memory test
// double standing outside the local SQLite file rollback domain. No actual
// external service, hardware trust, device flashing or Firebase operation.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {createHash,generateKeyPairSync,sign} from 'node:crypto';
import {canonicalOfflineEnvelope} from '../experiments/stage7-durable-ingress.mjs';
import {createTransactionalSqliteAuthorityLab}
  from '../experiments/transactional-sqlite-authority-lab.mjs';
import {createExternallyWitnessedSqliteAuthorityLab}
  from '../experiments/externally-witnessed-sqlite-authority-lab.mjs';

const NOW=1700000001500,ID='device-stage-a';
const signed=(text,key)=>sign(null,Buffer.from(text),key).toString('base64url');
const snap=x=>Object.freeze({
  deviceId:x.deviceId,epoch:x.epoch,enabled:x.enabled,
  sequence:x.sequence,digest:x.digest,revision:x.revision
});
function harness(callback){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'fg-r3-external-witness-synthetic-'));
  const databasePath=path.join(dir,'authority.sqlite');
  const device=generateKeyPairSync('ed25519');
  const accept=generateKeyPairSync('ed25519');
  const issuer=generateKeyPairSync('ed25519');
  let currentTime=NOW;
  const open=(overrides={})=>createTransactionalSqliteAuthorityLab({
    databasePath,mode:'open',
    devicePublicKey:device.publicKey,receiptIssuerPublicKey:accept.publicKey,
    databaseIssuerPrivateKey:issuer.privateKey,
    databaseIssuerPublicKey:issuer.publicKey,
    clock:()=>currentTime,allowSyntheticConfirmationWrites:true,
    ...overrides
  });
  const first=open({mode:'commission'});
  const seed={deviceId:ID,epoch:1,previousSequence:1,
    previousDigest:'a'.repeat(64)};
  assert.equal(first.commissionDevice(seed).commissioned,true);
  first.close();
  let anchor=snap(openAndSnapshot());
  function openAndSnapshot(){
    const a=open();try{return a.snapshot(ID);}finally{a.close();}
  }
  let advanceCalls=0;
  let refuse=false;
  const witness=Object.freeze({
    read:()=>snap(anchor),
    compareAndAdvance:(expected,next)=>{
      advanceCalls++;
      if(refuse)return false;
      if(JSON.stringify(snap(expected))!==JSON.stringify(anchor))return false;
      if(next.revision!==anchor.revision+1||next.deviceId!==anchor.deviceId||
         next.epoch!==anchor.epoch||next.sequence<anchor.sequence)return false;
      anchor=snap(next);
      return true;
    }
  });
  const view=()=>snap(anchor);
  const frame=(sequence=2)=>{
    const envelope={
      version:'floodguard-offline-envelope-v1',deviceId:ID,epoch:1,
      observedAtMs:NOW-900,
      frame:{sequence,distanceCm:16.5,levelCm:8.5,risk:'WARNING'}
    };
    const digest=createHash('sha256').update(canonicalOfflineEnvelope(envelope))
      .digest('hex');
    const receipt={
      version:'floodguard-offline-receipt-v1',deviceId:ID,epoch:1,
      sequence,digest,acceptedAtMs:NOW-500
    };
    return {
      receipt,receiptSignature:signed(JSON.stringify(receipt),accept.privateKey),
      record:{deviceId:ID,epoch:1,sequence,digest,
        acceptedAtMs:NOW-500,status:'DATABASE_CONFIRMED'}
    };
  };
  try {
    return callback({dir,databasePath,open,witness,view,frame,
      wrapped:(authority,options={})=>createExternallyWitnessedSqliteAuthorityLab({
        authority,witness,...options
      }),
      advances:()=>advanceCalls,refuse:v=>{refuse=v;},
      changeClock:v=>{currentTime=v;},
      setAnchor:v=>{anchor=snap(v);}
    });
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
}
const denied=(r,reason)=>{
  assert.equal(r.issued,false);
  if(reason)assert.equal(r.reason,reason);
  assert.equal(r.signature,undefined);
  for(const k of ['canPublish','canAcknowledge','canSendAlert',
    'canOperateGate','productionGo'])assert.equal(r[k],false,k);
};

test('matching independently supplied witness allows only OFFLINE signature proposal',()=>{
  harness(h=>{
    const a=h.open(),x=h.frame();
    assert.equal(a.recordSyntheticConfirmationForTest(x.record).stored,true);
    const w=h.wrapped(a);
    assert.equal(w.check(ID).consistent,true);
    const result=w.attest({receipt:x.receipt,receiptSignature:x.receiptSignature});
    assert.equal(result.issued,true,JSON.stringify(result));
    assert.equal(result.witnessCompared,true);
    assert.equal(result.physicalSourceVerified,false);
    assert.equal(result.productionGo,false);
    assert.equal(result.canPublish,false);
    assert.equal(result.canOperateGate,false);
    assert.equal(h.advances(),1);
    assert.equal(h.view().sequence,2);
    assert.equal(w.check(ID).consistent,true);
    a.close();
  });
});

test('revocation and issuance both advance the same independently held witness',()=>{
  harness(h=>{
    const a=h.open(),x=h.frame();
    a.recordSyntheticConfirmationForTest(x.record);
    const w=h.wrapped(a);
    assert.equal(w.revoke(ID).revoked,true);
    assert.equal(h.view().enabled,false);
    assert.equal(h.view().sequence,1);
    assert.equal(h.advances(),1);
    denied(w.attest({receipt:x.receipt,receiptSignature:x.receiptSignature}),
      'operator-not-authorized'); // precheck still matches; raw authority rejects
    assert.equal(w.check(ID).consistent,true);
    a.close();
  });
});

test('restoring a pre-issuance SQLite file after commit is detected by surviving witness',()=>{
  harness(h=>{
    const x=h.frame(),before=h.open();
    before.recordSyntheticConfirmationForTest(x.record);
    before.close();
    const old=path.join(h.dir,'snapshot-before-issuance-private-test.db');
    fs.copyFileSync(h.databasePath,old);
    const issuing=h.open();
    assert.equal(h.wrapped(issuing).attest({
      receipt:x.receipt,receiptSignature:x.receiptSignature
    }).issued,true);
    issuing.close();
    // Simulates privileged, OFFLINE restore of a whole DB image. No production
    // data is involved. A truly independent witness would survive this.
    fs.copyFileSync(old,h.databasePath);
    const restored=h.open();
    const w=h.wrapped(restored);
    assert.equal(w.check(ID).consistent,false);
    denied(w.attest({receipt:x.receipt,receiptSignature:x.receiptSignature}),
      'authority-witness-diverged');
    assert.equal(restored.snapshot(ID).sequence,1);
    assert.equal(h.view().sequence,2);
    restored.close();
  });
});

test('unwitnessed direct SQLite issue causes divergence and stops later wrapped issue',()=>{
  harness(h=>{
    const a=h.open(),x=h.frame();
    a.recordSyntheticConfirmationForTest(x.record);
    assert.equal(a.attest({receipt:x.receipt,
      receiptSignature:x.receiptSignature}).issued,true);
    const w=h.wrapped(a);
    assert.equal(w.check(ID).consistent,false);
    denied(w.attest({receipt:x.receipt,receiptSignature:x.receiptSignature}),
      'authority-witness-diverged');
    assert.equal(h.view().sequence,1);
    a.close();
  });
});

test('if witness CAS refuses after SQLite commit, signed response is withheld',()=>{
  harness(h=>{
    const a=h.open(),x=h.frame();a.recordSyntheticConfirmationForTest(x.record);
    h.refuse(true);
    const w=h.wrapped(a);
    denied(w.attest({receipt:x.receipt,
      receiptSignature:x.receiptSignature}),'witness-refused-advance');
    assert.equal(a.snapshot(ID).sequence,2);
    assert.equal(h.view().sequence,1);
    denied(w.attest({receipt:x.receipt,
      receiptSignature:x.receiptSignature}),'authority-witness-diverged');
    a.close();
  });
});

test('simulated crash after DB commit but before witness must fail closed',()=>{
  harness(h=>{
    const a=h.open(),x=h.frame();a.recordSyntheticConfirmationForTest(x.record);
    denied(h.wrapped(a,{failPoint:'after-db-before-witness'}).attest({
      receipt:x.receipt,receiptSignature:x.receiptSignature
    }),'simulated-crash-before-witness-cas');
    assert.equal(a.snapshot(ID).sequence,2);
    assert.equal(h.view().sequence,1);
    denied(h.wrapped(a).attest({receipt:x.receipt,
      receiptSignature:x.receiptSignature}),'authority-witness-diverged');
    a.close();
  });
});

test('simulated crash after witness CAS retains both cursors and denies replay',()=>{
  harness(h=>{
    const a=h.open(),x=h.frame();a.recordSyntheticConfirmationForTest(x.record);
    denied(h.wrapped(a,{failPoint:'after-witness-before-response'}).attest({
      receipt:x.receipt,receiptSignature:x.receiptSignature
    }),'simulated-crash-after-witness-cas');
    assert.equal(a.snapshot(ID).sequence,2);
    assert.equal(h.view().sequence,2);
    denied(h.wrapped(a).attest({receipt:x.receipt,
      receiptSignature:x.receiptSignature}),'issuance-replay-or-gap');
    a.close();
  });
});

test('pre-commit failed receipt leaves DB and external witness unchanged',()=>{
  harness(h=>{
    const a=h.open(),x=h.frame();a.recordSyntheticConfirmationForTest(x.record);
    const w=h.wrapped(a);
    denied(w.attest({receipt:x.receipt,receiptSignature:'A'.repeat(86)}),
      'signed-acceptance-invalid');
    assert.equal(a.snapshot(ID).sequence,1);
    assert.equal(h.view().sequence,1);
    assert.equal(h.advances(),0);
    a.close();
  });
});

test('malformed or spoofed witness state never permits a signature',()=>{
  harness(h=>{
    const a=h.open(),x=h.frame();a.recordSyntheticConfirmationForTest(x.record);
    const fake=Object.freeze({
      read:()=>({...h.view(),sequence:22}),
      compareAndAdvance:()=>true
    });
    denied(createExternallyWitnessedSqliteAuthorityLab({
      authority:a,witness:fake
    }).attest({receipt:x.receipt,receiptSignature:x.receiptSignature}),
    'authority-witness-diverged');
    const extra=Object.freeze({
      read:()=>({...h.view(),admin:true}),
      compareAndAdvance:()=>true
    });
    denied(createExternallyWitnessedSqliteAuthorityLab({
      authority:a,witness:extra
    }).attest({receipt:x.receipt,receiptSignature:x.receiptSignature}),
    'authority-witness-diverged');
    assert.equal(a.snapshot(ID).sequence,1);
    a.close();
  });
});

test('missing, throwing or falsely acknowledged witness remains fail closed',()=>{
  harness(h=>{
    const a=h.open(),x=h.frame();a.recordSyntheticConfirmationForTest(x.record);
    assert.throws(()=>createExternallyWitnessedSqliteAuthorityLab({
      authority:a,witness:{read:()=>h.view(),compareAndAdvance:()=>true}
    }),/Explicit local authority/);
    const throwing=Object.freeze({
      read:()=>{throw Error('synthetic unavailable witness with private path');},
      compareAndAdvance:()=>true
    });
    denied(createExternallyWitnessedSqliteAuthorityLab({
      authority:a,witness:throwing
    }).attest({receipt:x.receipt,receiptSignature:x.receiptSignature}),
    'external-witness-unavailable');
    const fake=Object.freeze({
      read:()=>h.view(),
      compareAndAdvance:()=>true
    });
    const response=createExternallyWitnessedSqliteAuthorityLab({
      authority:a,witness:fake
    }).attest({receipt:x.receipt,receiptSignature:x.receiptSignature});
    denied(response,'witness-postcheck-unverified');
    assert.equal(a.snapshot(ID).sequence,2);
    a.close();
  });
});

test('witness itself can be substituted: this is NOT a trusted production antirollback system',()=>{
  harness(h=>{
    const a=h.open(),x=h.frame();a.recordSyntheticConfirmationForTest(x.record);
    const forged=Object.freeze({
      read:()=>({
        deviceId:ID,epoch:1,enabled:true,sequence:1,
        digest:'a'.repeat(64),revision:1
      }),
      compareAndAdvance:()=>true
    });
    denied(createExternallyWitnessedSqliteAuthorityLab({
      authority:a,witness:forged
    }).attest({receipt:x.receipt,receiptSignature:x.receiptSignature}),
    'witness-postcheck-unverified');
    assert.equal(a.snapshot(ID).sequence,2);
    a.close();
  });
});

test('pure offline witness gate cannot publish, network, flash or operate actuators',()=>{
  const src=fs.readFileSync('experiments/externally-witnessed-sqlite-authority-lab.mjs','utf8');
  assert.doesNotMatch(src,/firebase-admin|firebase\/database|node:https|node:http|\.listen\s*\(/);
  assert.doesNotMatch(src,/\bfetch\s*\(|writeFileSync|\.ref\s*\(|\.set\s*\(|servo\.write/);
  assert.doesNotMatch(src,/process\.env|serviceAccount|sendMessage\s*\(|digitalWrite|\/floodguard\/live/);
  assert.match(src,/witness\.compareAndAdvance\(anchored,after\)/);
  assert.match(src,/authority\.snapshot\(deviceId\)/);
  assert.match(src,/authority-witness-diverged/);
  assert.match(src,/productionGo:false/);
});
