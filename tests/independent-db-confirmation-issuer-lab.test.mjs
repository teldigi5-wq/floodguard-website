// FloodGuard R3: hermetic actual-local-file integration, SYNTHETIC data only.
// Independent HMAC keys for the operator registry and Stage9 fake database.
// No RTDB, real sensor, production credentials, network, ACK or actuator.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {createHash,generateKeyPairSync,randomBytes,sign} from 'node:crypto';
import {createOperatorDeviceRegistryLab}
  from '../experiments/operator-device-registry-lab.mjs';
import {createStage9SyntheticDatabase}
  from '../experiments/stage9-downstream-outbox.mjs';
import {createIndependentDbConfirmationIssuerLab}
  from '../experiments/independent-db-confirmation-issuer-lab.mjs';
import {canonicalOfflineEnvelope}
  from '../experiments/stage7-durable-ingress.mjs';
import {planThreeSignerWaterProjectionGate}
  from '../experiments/three-signer-water-projection-gate.mjs';

const NOW=1700000001500;
const UID='device-stage-a';
const signBytes=(s,k)=>sign(null,Buffer.from(s),k).toString('base64url');
function fixture(callback) {
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'floodguard-r3-issuer-synthetic-'));
  const registryKey=randomBytes(32),databaseKey=randomBytes(32);
  const device=generateKeyPairSync('ed25519');
  const receiptIssuer=generateKeyPairSync('ed25519');
  const dbIssuer=generateKeyPairSync('ed25519');
  const registry=()=>createOperatorDeviceRegistryLab({directory,integrityKey:registryKey});
  const db=()=>createStage9SyntheticDatabase({directory,integrityKey:databaseKey});
  let now=NOW;
  try {
    registry().commission();
    registry().enroll(UID,device.publicKey);
    const envelope={
      version:'floodguard-offline-envelope-v1',deviceId:UID,epoch:1,
      observedAtMs:NOW-1000,
      frame:{sequence:2,distanceCm:16.5,levelCm:8.5,risk:'WARNING'}
    };
    const canonical=canonicalOfflineEnvelope(envelope);
    const digest=createHash('sha256').update(canonical).digest('hex');
    const receipt={
      version:'floodguard-offline-receipt-v1',deviceId:UID,epoch:1,
      sequence:2,digest,acceptedAtMs:NOW-500
    };
    const receiptSignature=signBytes(JSON.stringify(receipt),receiptIssuer.privateKey);
    const record={deviceId:UID,epoch:1,sequence:2,digest,
      acceptedAtMs:NOW-500,status:'DATABASE_CONFIRMED'};
    const reader=Object.freeze({get:deviceId=>db().get(deviceId)});
    const issuer=(overrides={})=>createIndependentDbConfirmationIssuerLab({
      databaseReader:reader,operatorRegistry:registry(),
      receiptIssuerPublicKey:receiptIssuer.publicKey,
      databaseIssuerPrivateKey:dbIssuer.privateKey,
      databaseIssuerPublicKey:dbIssuer.publicKey,
      clock:()=>now,...overrides
    });
    return callback({
      directory,registryKey,databaseKey,registry,db,device,receiptIssuer,
      dbIssuer,issuer,reader,envelope,canonical,receipt,receiptSignature,
      record,setNow:x=>{now=x;},
      request:()=>({receipt,receiptSignature})
    });
  }finally{
    fs.rmSync(directory,{recursive:true,force:true});
  }
}
const deny=(r,reason)=>{
  assert.equal(r.issued,false,JSON.stringify(r));
  if(reason)assert.equal(r.reason,reason);
  for(const flag of ['canPublish','canAcknowledge','canSendAlert','canOperateGate'])
    assert.equal(r[flag],false,flag);
  assert.equal(r.signature,undefined);
  assert.equal(r.attestation,undefined);
};

test('only independently read HMAC-sealed synthetic DB record yields signed confirmation',()=>{
  fixture(h=>{
    deny(h.issuer().attest(h.request()),'independent-database-read-unconfirmed');
    assert.deepEqual(h.db().put({...h.record,status:'ACCEPTED_ONLY'}),{status:'persisted'});
    // The Stage9 sink accepts a valid record and persists DATABASE_CONFIRMED;
    // changing status input to ACCEPTED_ONLY cannot be used as a grant.
    const evidence=h.issuer().attest(h.request());
    assert.equal(evidence.issued,true,JSON.stringify(evidence));
    assert.equal(evidence.kind,'LOCAL_SYNTHETIC_DB_READ_ATTESTATION_NOT_PUBLISHED');
    assert.deepEqual(evidence.databaseRecord,h.record);
    assert.equal(evidence.attestation.databaseState,'DATABASE_CONFIRMED');
    assert.equal(evidence.attestation.confirmedAtMs,NOW);
    for(const flag of ['canPublish','canAcknowledge','canSendAlert','canOperateGate'])
      assert.equal(evidence[flag],false);
    assert.equal(Object.isFrozen(evidence),true);
    assert.equal(Object.isFrozen(evidence.attestation),true);
    assert.equal(Object.isFrozen(evidence.databaseRecord),true);
    assert.doesNotMatch(JSON.stringify(evidence),/privateKey|serviceAccount|wifiPassword/);
  });
});

test('real local test DB read, separate signature, and PR73 planner compose without publishing',()=>{
  fixture(h=>{
    assert.deepEqual(h.db().put(h.record),{status:'persisted'});
    const signed=h.issuer().attest(h.request());
    assert.equal(signed.issued,true);
    const project=planThreeSignerWaterProjectionGate({
      envelope:h.envelope,
      deviceSignature:signBytes(h.canonical,h.device.privateKey),
      sourceBinding:{deviceId:UID,epoch:1,enabled:true,
        scope:'prototype-ingest-v1',publicKey:h.device.publicKey},
      receipt:h.receipt,receiptSignature:h.receiptSignature,
      trustedReceiptKey:h.receiptIssuer.publicKey,
      attestation:signed.attestation,attestationSignature:signed.signature,
      trustedDatabaseIssuerKey:h.dbIssuer.publicKey,
      databaseRecord:signed.databaseRecord,
      lastPublished:{initialized:true,epoch:1,sequence:1,digest:'a'.repeat(64)},
      nowMs:NOW
    });
    assert.equal(project.planned,true,JSON.stringify(project));
    assert.deepEqual(Object.keys(project.proposedLeaves),[
      'water/distanceCm','water/levelCm','water/status',
      'system/lastUpdate','system/overallRisk'
    ]);
    assert.equal(project.proposedLeaves['system/overallRisk'],'UNKNOWN');
    assert.equal(project.canPublish,false);
    assert.equal(project.canAcknowledge,false);
    assert.equal(project.canOperateGate,false);
  });
});

test('unconfirmed, mismatched, or absent independent DB record never signs',()=>{
  fixture(h=>{
    deny(h.issuer().attest(h.request()),'independent-database-read-unconfirmed');
    const reader=Object.freeze({get:()=>({...h.record,status:'ACCEPTED_ONLY'})});
    deny(h.issuer({databaseReader:reader}).attest(h.request()),
      'independent-database-read-unconfirmed');
    for(const changed of [
      {...h.record,sequence:3},{...h.record,digest:'f'.repeat(64)},
      {...h.record,acceptedAtMs:NOW},{...h.record,extra:'forged'},
      null
    ]){
      const copy=Object.freeze({get:()=>changed});
      deny(h.issuer({databaseReader:copy}).attest(h.request()),
        'independent-database-read-unconfirmed');
    }
  });
});

test('incorrect or rotated receipt issuer cannot mint attestation',()=>{
  fixture(h=>{
    h.db().put(h.record);
    deny(h.issuer().attest({receipt:h.receipt,receiptSignature:'A'.repeat(86)}),
      'acceptance-signature-invalid');
    const stranger=generateKeyPairSync('ed25519');
    deny(h.issuer({receiptIssuerPublicKey:stranger.publicKey}).attest(h.request()),
      'acceptance-signature-invalid');
    deny(h.issuer().attest({receipt:{...h.receipt,sequence:3},
      receiptSignature:h.receiptSignature}),'acceptance-signature-invalid');
  });
});

test('different Ed25519 signing roles and correct issuer private/public pair are enforced',()=>{
  fixture(h=>{
    assert.throws(()=>h.issuer({
      databaseIssuerPrivateKey:h.receiptIssuer.privateKey,
      databaseIssuerPublicKey:h.receiptIssuer.publicKey
    }),/Distinct pinned/);
    assert.throws(()=>h.issuer({
      databaseIssuerPublicKey:h.device.publicKey
    }),/Distinct pinned/);
    assert.throws(()=>h.issuer({
      databaseReader:{get:()=>h.record}
    }),/read capability/);
    assert.throws(()=>h.issuer({
      databaseReader:Object.freeze({get:()=>h.record,put:()=>{}})
    }),/read capability/);
  });
});

test('operator revocation or registered key/epoch mismatch refuse independent issuer',()=>{
  fixture(h=>{
    h.db().put(h.record);
    h.registry().revoke(UID);
    deny(h.issuer().attest(h.request()),'operator-authorization-unverified');
  });
  fixture(h=>{
    h.db().put(h.record);
    const registry=Object.freeze({
      status:()=>h.registry().status(),
      get:()=>Object.freeze({enabled:true,scope:'prototype-ingest-v1',
        epoch:2,publicKey:h.device.publicKey})
    });
    deny(h.issuer({operatorRegistry:registry}).attest(h.request()),
      'operator-authorization-unverified');
  });
});

test('revocation during independent DB read fails against registry revision fence',()=>{
  fixture(h=>{
    h.db().put(h.record);
    let once=false;
    const reader=Object.freeze({get:id=>{
      if(!once){once=true;h.registry().revoke(UID);}
      return h.db().get(id);
    }});
    deny(h.issuer({databaseReader:reader}).attest(h.request()),
      'operator-authorization-changed');
  });
});

test('missing, corrupted or incorrect-MAC local DB prevents signing',()=>{
  fixture(h=>{
    h.db().put(h.record);
    const file=path.join(h.directory,'stage9-database.json');
    const original=fs.readFileSync(file,'utf8');
    fs.writeFileSync(file,original.replace('DATABASE_CONFIRMED','ACCEPTED_ONLY'));
    deny(h.issuer().attest(h.request()),'offline-authority-or-db-unavailable');
    fs.unlinkSync(file);
    deny(h.issuer().attest(h.request()),'independent-database-read-unconfirmed');
  });
  fixture(h=>{
    h.db().put(h.record);
    const alternate=createStage9SyntheticDatabase({
      directory:h.directory,integrityKey:randomBytes(32)
    });
    deny(h.issuer({databaseReader:Object.freeze({get:id=>alternate.get(id)})})
      .attest(h.request()),'offline-authority-or-db-unavailable');
  });
});

test('operator registry absent, tampered, or locked cannot issue signatures',()=>{
  fixture(h=>{
    h.db().put(h.record);
    const file=path.join(h.directory,'operator-device-registry-lab.json');
    fs.unlinkSync(file);
    deny(h.issuer().attest(h.request()),'offline-authority-or-db-unavailable');
  });
  fixture(h=>{
    h.db().put(h.record);
    fs.writeFileSync(path.join(h.directory,'operator-device-registry-lab.lock'),'TEST_STALE_LOCK');
    deny(h.issuer().attest(h.request()),'offline-authority-or-db-unavailable');
  });
});

test('expiry, future accept time or invalid clock never confirm',()=>{
  fixture(h=>{
    h.db().put(h.record);
    h.setNow(NOW+5001);
    deny(h.issuer().attest(h.request()),'confirmation-window-invalid');
    h.setNow(NOW-1000);
    deny(h.issuer().attest(h.request()),'confirmation-window-invalid');
    h.setNow(NaN);
    deny(h.issuer().attest(h.request()),'confirmation-window-invalid');
  });
});

test('no public API accepts databaseRecord, trusted issuer key or operator binding as an attestation request',()=>{
  fixture(h=>{
    h.db().put(h.record);
    deny(h.issuer().attest({...h.request(),
      databaseRecord:h.record,privileged:true,privateKey:'SYNTHETIC'}),
      'request-shape-invalid');
    // Only receipt and its Stage8 signature can be provided. The issuer
    // always obtains confirmation from its separately configured reader.
    assert.deepEqual(h.issuer().attest(h.request()).databaseRecord,h.record);
  });
});

test('no network listener, production Firebase, credentials, gate control or ACK in issuer',()=>{
  const src=fs.readFileSync('experiments/independent-db-confirmation-issuer-lab.mjs','utf8');
  assert.doesNotMatch(src,/firebase-admin|firebase\/database|node:https|node:http|\.listen\s*\(/);
  assert.doesNotMatch(src,/\bfetch\s*\(|\.ref\s*\(|writeFileSync|\.set\s*\(|servo\.write/);
  assert.doesNotMatch(src,/process\.env|serviceAccount|sendMessage\s*\(|digitalWrite/);
  assert.match(src,/databaseReader\.get\(receipt\.deviceId\)/);
  assert.match(src,/operatorRegistry\.status\(\)/);
  assert.match(src,/canonicalSyntheticPublicationAttestation/);
});
