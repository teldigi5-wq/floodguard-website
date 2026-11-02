// FloodGuard R3: isolated host-file lock coordinates TEST-ONLY revocation
// and issuance; no production Firebase, cloud, actual device or gate actions.
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
import {createSerializedOfflineAuthorityLab}
  from '../experiments/serialized-offline-authority-lab.mjs';
import {canonicalOfflineEnvelope}
  from '../experiments/stage7-durable-ingress.mjs';

const NOW=1700000001500,UID='device-stage-a';
const sig=(content,key)=>sign(null,Buffer.from(content),key).toString('base64url');
function fixture(action){
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'fg-r3-local-serialized-'));
  const registrySecret=randomBytes(32),databaseSecret=randomBytes(32),
    issuerSecret=randomBytes(32),device=generateKeyPairSync('ed25519'),
    receiptSigner=generateKeyPairSync('ed25519'),
    confirmationSigner=generateKeyPairSync('ed25519');
  const registry=()=>createOperatorDeviceRegistryLab({
    directory,integrityKey:registrySecret
  });
  const database=()=>createStage9SyntheticDatabase({
    directory,integrityKey:databaseSecret
  });
  const observation=(sequence=2)=>{
    const envelope={
      version:'floodguard-offline-envelope-v1',deviceId:UID,epoch:1,
      observedAtMs:NOW-900,
      frame:{sequence,distanceCm:16.5,levelCm:8.5,risk:'WARNING'}
    };
    const digest=createHash('sha256').update(canonicalOfflineEnvelope(envelope)).digest('hex');
    const receipt={
      version:'floodguard-offline-receipt-v1',deviceId:UID,epoch:1,
      sequence,digest,acceptedAtMs:NOW-500
    };
    return {
      request:{receipt,receiptSignature:sig(JSON.stringify(receipt),receiptSigner.privateKey)},
      stored:{deviceId:UID,epoch:1,sequence,digest,
        acceptedAtMs:NOW-500,status:'DATABASE_CONFIRMED'}
    };
  };
  let reader=Object.freeze({get:deviceId=>database().get(deviceId)});
  let now=NOW;
  const issuer=()=>createIndependentDbConfirmationIssuerLab({
    databaseReader:reader,operatorRegistry:registry(),
    receiptIssuerPublicKey:receiptSigner.publicKey,
    databaseIssuerPrivateKey:confirmationSigner.privateKey,
    databaseIssuerPublicKey:confirmationSigner.publicKey,
    clock:()=>now
  });
  const ledger=(overrides={})=>createDurableOfflineIssuerCheckpointLab({
    directory,integrityKey:issuerSecret,issuer:issuer(),
    issuerPublicKey:confirmationSigner.publicKey,clock:()=>now,...overrides
  });
  const owner=(overrides={})=>createSerializedOfflineAuthorityLab({
    directory,registry:registry(),ledger:ledger(),...overrides
  });
  const seed={deviceId:UID,epoch:1,sequence:1,
    digest:'a'.repeat(64),acceptedAtMs:NOW-1000};
  try {
    registry().commission();
    registry().enroll(UID,device.publicKey);
    ledger().commission(seed);
    return action({
      directory,registry,database,owner,ledger,observation,
      setReader:value=>{reader=value;},changeTime:value=>{now=value;}
    });
  }finally {fs.rmSync(directory,{recursive:true,force:true});}
}
const denied=(result,reason)=>{
  assert.equal(result.issued,false,JSON.stringify(result));
  if(reason)assert.equal(result.reason,reason);
  assert.equal(result.signature,undefined);
  for(const flag of ['canPublish','canAcknowledge','canSendAlert',
    'canOperateGate','productionGo'])assert.equal(result[flag],false,flag);
};

test('cooperating owner issues one confirmation then rejects replay after restart',()=>{
  fixture(h=>{
    const x=h.observation();
    h.database().put(x.stored);
    const result=h.owner().attest(x.request);
    assert.equal(result.issued,true,JSON.stringify(result));
    assert.equal(result.serializedOwner,true);
    assert.equal(result.productionGo,false);
    assert.equal(result.canPublish,false);
    assert.equal(result.canOperateGate,false);
    assert.equal(h.ledger().checkpoint().sequence,2);
    denied(h.owner().attest(x.request),'issuance-replay-gap-or-identity-conflict');
    assert.equal(h.registry().get(UID).enabled,true);
  });
});

test('coordinated revoke prevents new confirmation without destroying journal',()=>{
  fixture(h=>{
    const x=h.observation();
    h.database().put(x.stored);
    const revoked=h.owner().revoke(UID);
    assert.equal(revoked.revoked,true,JSON.stringify(revoked));
    assert.equal(revoked.issued,false);
    assert.equal(revoked.productionGo,false);
    denied(h.owner().attest(x.request),'operator-not-authorized');
    assert.equal(h.ledger().checkpoint().sequence,1);
  });
});

test('revocation cannot enter via cooperating coordinator during in-flight DB read',()=>{
  fixture(h=>{
    const x=h.observation();
    h.database().put(x.stored);
    let nested;
    let coordinator;
    h.setReader(Object.freeze({get:id=>{
      nested=coordinator.revoke(id);
      return h.database().get(id);
    }}));
    coordinator=h.owner();
    const issued=coordinator.attest(x.request);
    assert.equal(nested.revoked,false,JSON.stringify(nested));
    assert.equal(nested.reason,'serialized-authority-unavailable');
    assert.equal(issued.issued,true,JSON.stringify(issued));
    assert.equal(h.registry().get(UID).enabled,true);
    assert.equal(coordinator.revoke(UID).revoked,true);
    denied(coordinator.attest(x.request),'operator-not-authorized');
  });
});

test('bypassing coordinator and revoking inside independent DB read is caught',()=>{
  fixture(h=>{
    const x=h.observation();
    h.database().put(x.stored);
    h.setReader(Object.freeze({get:id=>{
      h.registry().revoke(id); // bypass illustrates an unsafe out-of-band write
      return h.database().get(id);
    }}));
    denied(h.owner().attest(x.request),'operator-authorization-changed');
    assert.equal(h.ledger().checkpoint().sequence,1);
    assert.equal(h.registry().get(UID).enabled,false);
  });
});

test('direct external revoke after durable issuance but before response suppresses signature',()=>{
  fixture(h=>{
    const x=h.observation();
    h.database().put(x.stored);
    const actual=h.ledger();
    const interrupted=Object.freeze({
      checkpoint:()=>actual.checkpoint(),
      attest:request=>{
        const signed=actual.attest(request);
        h.registry().revoke(UID); // bypass through raw registry
        return signed;
      }
    });
    denied(h.owner({ledger:interrupted}).attest(x.request),
      'operator-changed-before-response');
    assert.equal(h.ledger().checkpoint().sequence,2);
    denied(h.owner().attest(x.request),'operator-not-authorized');
  });
});

test('a stale shared owner lock refuses both issuance and revocation and is not deleted',()=>{
  fixture(h=>{
    const x=h.observation();h.database().put(x.stored);
    const lock=path.join(h.directory,'r3-local-authority-coordinator.lock');
    fs.writeFileSync(lock,'REVIEW-REQUIRED');
    denied(h.owner().attest(x.request),'serialized-authority-unavailable');
    denied(h.owner().revoke(UID),'serialized-authority-unavailable');
    assert.equal(fs.readFileSync(lock,'utf8'),'REVIEW-REQUIRED');
    assert.equal(h.ledger().checkpoint().sequence,1);
    fs.unlinkSync(lock);
    assert.equal(h.owner().attest(x.request).issued,true);
  });
});

test('unknown device and malformed or smuggled request fields fail closed',()=>{
  fixture(h=>{
    const x=h.observation();h.database().put(x.stored);
    denied(h.owner().revoke('not-a-device'),'invalid-device-id');
    denied(h.owner().attest({...x.request,admin:true,record:x.stored}),
      'request-shape-invalid');
    denied(h.owner().attest({receipt:{...x.request.receipt,epoch:2},
      receiptSignature:x.request.receiptSignature}),'operator-not-authorized');
    denied(h.owner().attest(null),'request-shape-invalid');
    assert.equal(h.ledger().checkpoint().sequence,1);
  });
});

test('empty record or forged receipt never advances the local ledger',()=>{
  fixture(h=>{
    const x=h.observation();
    denied(h.owner().attest(x.request),'independent-database-read-unconfirmed');
    h.database().put(x.stored);
    denied(h.owner().attest({...x.request,receiptSignature:'A'.repeat(86)}),
      'acceptance-signature-invalid');
    assert.equal(h.ledger().checkpoint().sequence,1);
  });
});

test('source registry revision changes are caught even if the key remains the same',()=>{
  fixture(h=>{
    const x=h.observation();h.database().put(x.stored);
    const actual=h.ledger();
    const wrapper=Object.freeze({
      checkpoint:()=>actual.checkpoint(),
      attest:request=>{
        const result=actual.attest(request);
        // Allowed only as adversarial test: independent registry direct write.
        h.registry().revoke(UID);
        return result;
      }
    });
    denied(h.owner({ledger:wrapper}).attest(x.request),
      'operator-changed-before-response');
  });
});

test('lost issued response retains checkpoint and rejects replay across owner restart',()=>{
  fixture(h=>{
    const x=h.observation();h.database().put(x.stored);
    denied(h.owner({ledger:h.ledger({
      failPoint:'after-commit-before-return'
    })}).attest(x.request),'simulated-response-lost-after-commit');
    assert.equal(h.ledger().checkpoint().sequence,2);
    denied(h.owner().attest(x.request),'issuance-replay-gap-or-identity-conflict');
  });
});

test('missing or tampered issuer ledger does not bypass serialized authority',()=>{
  fixture(h=>{
    const x=h.observation();h.database().put(x.stored);
    fs.unlinkSync(path.join(h.directory,'r3-local-issuance-checkpoint.json'));
    denied(h.owner().attest(x.request),'serialized-authority-unavailable');
    assert.equal(h.registry().get(UID).enabled,true);
  });
});

test('read-only offline coordinator has no cloud publishing, ACK, servo or network',()=>{
  const s=fs.readFileSync('experiments/serialized-offline-authority-lab.mjs','utf8');
  assert.doesNotMatch(s,/firebase-admin|firebase\/database|node:https|node:http|\.listen\s*\(/);
  assert.doesNotMatch(s,/\bfetch\s*\(|\.ref\s*\(|\.set\s*\(|\.updateChildren\s*\(|servo\.write|digitalWrite/);
  assert.doesNotMatch(s,/process\.env|serviceAccount|sendMessage\s*\(/);
  assert.match(s,/fs\.openSync\(lockFile,'wx',0o600\)/);
  assert.match(s,/ledger\.checkpoint\(\)/);
  assert.match(s,/ledger\.attest\(request\)/);
  assert.match(s,/registry\.revoke\(deviceId\)/);
  assert.match(s,/stillSame\(before,deviceId,epoch\)/);
});
