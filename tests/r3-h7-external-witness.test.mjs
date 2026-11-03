// Synthetic-only R3 H7 witness and existing H4 signed issuer regression.
// No network, cloud IAM, real Firebase, hardware, alerts or gate operations.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {generateKeyPairSync,randomBytes,sign,createHash}
  from 'node:crypto';
import {
  createH7OfflineWitness,canonicalH7OperatorEvent,
  canonicalH7Acknowledgement
} from '../experiments/r3-h7-external-witness-lab.mjs';
import {createH7OfflineCoordinator}
  from '../experiments/r3-h7-offline-coordinator.mjs';
import {createH4OfflineAdmissionIssuer}
  from '../experiments/r3-h4-signed-admission-issuer.mjs';
import {canonicalOfflineEnvelope}
  from '../experiments/stage7-durable-ingress.mjs';
import {canonicalSyntheticPublicationAttestation}
  from '../experiments/synthetic-publication-attestation.mjs';

const NOW=1762180000000;
const ID='device-stage-a';
const A='a'.repeat(64);
const ZERO='0'.repeat(64);
const signText=(txt,key)=>sign(null,Buffer.from(txt),key).toString('base64url');
function setup(){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'floodguard-h7-witness-'));
  let anchorState={revision:0,head:ZERO},allowAdvance=true,allowRead=true;
  const externalAnchor=Object.freeze({
    read(){
      if(!allowRead)throw Error('independent anchor offline');
      return {...anchorState};
    },
    compareAndAdvance(oldValue,next){
      if(!allowAdvance||oldValue.revision!==anchorState.revision||
        oldValue.head!==anchorState.head)
        return false;
      anchorState={...next};return true;
    }
  });
  const operator=generateKeyPairSync('ed25519');
  const witnessSigner=generateKeyPairSync('ed25519');
  const integrityKey=randomBytes(32);
  const options={
    directory:dir,integrityKey,externalAnchor,
    operatorPublicKey:operator.publicKey,
    confirmationPublicKey:witnessSigner.publicKey,clock:()=>NOW
  };
  const witness=createH7OfflineWitness(options);
  const incident=(kind,{epoch,revision,sequence,digest}={})=>{
    const s=kind==='BOOTSTRAP'?null:witness.snapshot();
    const event={
      kind,deviceId:ID,epoch:epoch??(s?s.epoch+1:1),
      revision:revision??(s?s.revision+1:1),
      sequence:sequence??(s?s.sequence:1),
      digest:digest??(s?s.digest:A),atMs:NOW
    };
    return {event,signature:signText(canonicalH7OperatorEvent(event),
      operator.privateKey)};
  };
  const bootstrap=()=>{
    const {event,signature}=incident('BOOTSTRAP');
    return witness.operator(event,signature);
  };
  function frame(){
    const device=generateKeyPairSync('ed25519');
    const receipt=generateKeyPairSync('ed25519');
    const attestor=generateKeyPairSync('ed25519');
    const envelope={
      version:'floodguard-offline-envelope-v1',deviceId:ID,epoch:1,
      observedAtMs:NOW-1000,
      frame:{sequence:2,distanceCm:16.5,levelCm:8.5,risk:'WARNING'}
    };
    const canonical=canonicalOfflineEnvelope(envelope);
    const digest=createHash('sha256').update(canonical).digest('hex');
    const receiptObj={version:'floodguard-offline-receipt-v1',
      deviceId:ID,epoch:1,sequence:2,digest,acceptedAtMs:NOW-250};
    const attestation={
      version:'floodguard-synthetic-persisted-attestation-v1',
      deviceId:ID,epoch:1,sequence:2,digest,acceptedAtMs:NOW-250,
      confirmedAtMs:NOW-100,scope:'prototype-ingest-v1',
      deviceEnabled:true,databaseState:'DATABASE_CONFIRMED'
    };
    const signedEvidence={
      envelope,deviceSignature:signText(canonical,device.privateKey),
      receipt:receiptObj,receiptSignature:signText(
        JSON.stringify(receiptObj),receipt.privateKey),
      attestation,attestationSignature:signText(
        canonicalSyntheticPublicationAttestation(attestation),
        attestor.privateKey),
      databaseRecord:{deviceId:ID,epoch:1,sequence:2,digest,
        acceptedAtMs:NOW-250,status:'DATABASE_CONFIRMED'}
    };
    const authority=Object.freeze({
      read:async()=>({
        revision:1,
        issuer:{enabled:true,generation:1,scope:'lab-signed-admission-v1'},
        publisher:{enabled:true,deviceId:ID,epoch:1,
          scope:'publication-lab-water-v1'},
        incident:{blocked:false,epoch:1},
        sourceBinding:{deviceId:ID,epoch:1,enabled:true,
          scope:'prototype-ingest-v1',publicKey:device.publicKey},
        trustedReceiptKey:receipt.publicKey,
        trustedDatabaseIssuerKey:attestor.publicKey,
        lastPublished:{initialized:true,epoch:1,sequence:1,digest:A}
      })
    });
    const issuer=createH4OfflineAdmissionIssuer({
      authority,clock:()=>NOW
    });
    return {signedEvidence,issuer,digest};
  }
  function acknowledge(reservation){
    const state=witness.snapshot();
    const ack={
      kind:'SIGNED_PUBLICATION_CONFIRMED',deviceId:ID,
      epoch:state.epoch,revision:state.revision+1,
      sequence:reservation.sequence,digest:reservation.digest,
      reservationId:reservation.reservationId,atMs:NOW
    };
    return {ack,signature:signText(canonicalH7Acknowledgement(ack),
      witnessSigner.privateKey)};
  }
  const cleanup=()=>fs.rmSync(dir,{recursive:true,force:true});
  return {dir,witness,bootstrap,incident,frame,acknowledge,
    operator,witnessSigner,integrityKey,externalAnchor,options,cleanup,
    setAdvance:v=>{allowAdvance=v;},setRead:v=>{allowRead=v;},
    anchorSnapshot:()=>({...anchorState})};
}
test('no implicit enrollment: unsigned/wrong operator events cannot bootstrap',()=>{
  const x=setup();try{
    assert.throws(()=>x.witness.snapshot(),/not explicitly initialized/);
    const {event,signature}=x.incident('BOOTSTRAP');
    assert.equal(x.witness.operator(event,'A'.repeat(86)).ok,false);
    assert.equal(x.witness.operator({...event,deviceId:'device-stage-b'},signature).ok,false);
    assert.equal(x.witness.operator(event,signature).ok,true);
    assert.equal(x.witness.snapshot().quarantined,false);
    assert.equal(x.witness.operator(event,signature).ok,false);
  }finally{x.cleanup();}
});
test('three signed proofs -> witness reservation -> independent signed acknowledgement advances once',async()=>{
  const x=setup();try{
    x.bootstrap();
    const f=x.frame();
    const coordinator=createH7OfflineCoordinator({issuer:f.issuer,witness:x.witness});
    const reserved=await coordinator.prepare(f.signedEvidence);
    assert.equal(reserved.ok,true,JSON.stringify(reserved));
    assert.equal(reserved.canPublish,false);
    assert.equal(x.witness.snapshot().sequence,1);
    assert.equal(x.witness.snapshot().pending.digest,f.digest);
    const {ack,signature}=x.acknowledge(reserved);
    const done=x.witness.acknowledge(ack,signature);
    assert.equal(done.ok,true,JSON.stringify(done));
    const state=x.witness.snapshot();
    assert.equal(state.sequence,2);
    assert.equal(state.digest,f.digest);
    assert.equal(state.pending,null);
    assert.equal((await coordinator.prepare(f.signedEvidence)).ok,false);
    assert.equal(x.witness.acknowledge(ack,signature).ok,false);
  }finally{x.cleanup();}
});
test('forged source signature is refused by H4 before any witness reservation',async()=>{
  const x=setup();try{
    x.bootstrap();const f=x.frame();
    const c=createH7OfflineCoordinator({issuer:f.issuer,witness:x.witness});
    const r=await c.prepare({...f.signedEvidence,deviceSignature:'A'.repeat(86)});
    assert.equal(r.ok,false);
    assert.equal(x.witness.snapshot().revision,1);
    assert.equal(x.witness.snapshot().pending,null);
  }finally{x.cleanup();}
});
test('quarantine while publication pending permanently blocks acknowledgement and automatic recovery',async()=>{
  const x=setup();try{
    x.bootstrap();const f=x.frame();
    const c=createH7OfflineCoordinator({issuer:f.issuer,witness:x.witness});
    const reserved=await c.prepare(f.signedEvidence);
    assert.equal(reserved.ok,true);
    const proof=x.acknowledge(reserved); // signed BEFORE quarantine
    const event=x.incident('QUARANTINE');
    assert.equal(x.witness.operator(event.event,event.signature).ok,true);
    assert.equal(x.witness.snapshot().epoch,2);
    assert.equal(x.witness.snapshot().quarantined,true);
    assert.equal(x.witness.acknowledge(proof.ack,proof.signature).ok,false);
    const recover=x.incident('RECOVER');
    assert.equal(x.witness.operator(recover.event,recover.signature).ok,false);
    assert.equal((await c.prepare(f.signedEvidence)).ok,false);
    assert.equal(x.witness.snapshot().pending.reservationId,reserved.reservationId);
  }finally{x.cleanup();}
});
test('quarantine and recovery require new signed incident epoch; old epoch-1 evidence remains blocked',async()=>{
  const x=setup();try{
    x.bootstrap();const f=x.frame();
    const q=x.incident('QUARANTINE');
    assert.equal(x.witness.operator(q.event,q.signature).ok,true);
    assert.equal(x.witness.operator(q.event,q.signature).ok,false);
    const recover=x.incident('RECOVER');
    assert.equal(x.witness.operator(recover.event,recover.signature).ok,true);
    assert.equal(x.witness.snapshot().epoch,3);
    const c=createH7OfflineCoordinator({issuer:f.issuer,witness:x.witness});
    assert.equal((await c.prepare(f.signedEvidence)).ok,false);
    assert.equal(x.witness.snapshot().sequence,1);
  }finally{x.cleanup();}
});
test('operator signature replay and wrong epoch cannot clear a quarantine',()=>{
  const x=setup();try{
    x.bootstrap();
    const q=x.incident('QUARANTINE');
    assert.equal(x.witness.operator(q.event,q.signature).ok,true);
    const recover=x.incident('RECOVER');
    assert.equal(x.witness.operator(recover.event,'A'.repeat(86)).ok,false);
    assert.equal(x.witness.operator({...recover.event,epoch:55},
      recover.signature).ok,false);
    assert.equal(x.witness.snapshot().quarantined,true);
  }finally{x.cleanup();}
});
test('forged witness attestation never confirms an uncertain publication',async()=>{
  const x=setup();try{
    x.bootstrap();const f=x.frame();
    const c=createH7OfflineCoordinator({issuer:f.issuer,witness:x.witness});
    const r=await c.prepare(f.signedEvidence);
    const ack=x.acknowledge(r);
    assert.equal(x.witness.acknowledge(ack.ack,'A'.repeat(86)).ok,false);
    assert.equal(x.witness.acknowledge({...ack.ack,digest:'f'.repeat(64)},
      ack.signature).ok,false);
    assert.equal(x.witness.snapshot().sequence,1);
    assert.notEqual(x.witness.snapshot().pending,null);
  }finally{x.cleanup();}
});
test('external anchor detects a byte-for-byte rollback of a valid HMAC-sealed local checkpoint',async()=>{
  const x=setup();try{
    x.bootstrap();
    const original=fs.readFileSync(path.join(x.dir,'r3-h7-synthetic-witness.json'));
    const f=x.frame();
    const c=createH7OfflineCoordinator({issuer:f.issuer,witness:x.witness});
    assert.equal((await c.prepare(f.signedEvidence)).ok,true);
    const laterAnchor=x.anchorSnapshot();
    assert.equal(laterAnchor.revision,2);
    fs.writeFileSync(path.join(x.dir,'r3-h7-synthetic-witness.json'),original);
    assert.throws(()=>x.witness.snapshot(),/anchor mismatch/);
  }finally{x.cleanup();}
});
test('local ledger HMAC alteration is detected even when external anchor remains unchanged',()=>{
  const x=setup();try{
    x.bootstrap();
    const p=path.join(x.dir,'r3-h7-synthetic-witness.json');
    const contents=JSON.parse(fs.readFileSync(p,'utf8'));
    contents.state.digest='f'.repeat(64);
    fs.writeFileSync(p,JSON.stringify(contents));
    assert.throws(()=>x.witness.snapshot(),/integrity failure/);
  }finally{x.cleanup();}
});
test('failed external checkpoint advance blocks future operations after durable local write',async()=>{
  const x=setup();try{
    x.bootstrap();const f=x.frame();
    const c=createH7OfflineCoordinator({issuer:f.issuer,witness:x.witness});
    x.setAdvance(false);
    const result=await c.prepare(f.signedEvidence);
    assert.equal(result.ok,false);
    assert.equal(result.reason,'unavailable-or-uncertain');
    assert.throws(()=>x.witness.snapshot(),/anchor mismatch/);
  }finally{x.cleanup();}
});
test('unavailable external authority and abandoned lock refuse all reads and commits',()=>{
  const x=setup();try{
    x.bootstrap();
    x.setRead(false);
    assert.throws(()=>x.witness.snapshot(),/independent anchor offline/);
    x.setRead(true);
    const lock=path.join(x.dir,'r3-h7-synthetic-witness.lock');
    fs.writeFileSync(lock,'synthetic-abandoned-lock');
    assert.throws(()=>x.witness.snapshot(),/EEXIST/);
    // Deliberate manual synthetic fixture cleanup, never automatic lock steal.
    fs.unlinkSync(lock);
    assert.equal(x.witness.snapshot().revision,1);
  }finally{x.cleanup();}
});
test('two contenders carrying the same witness revision cannot reserve twice',async()=>{
  const x=setup();try{
    x.bootstrap();const f=x.frame();
    const candidate=await f.issuer.issue(f.signedEvidence);
    assert.equal(candidate.issued,true);
    const snapshot=x.witness.snapshot();
    const expected={revision:snapshot.revision,head:snapshot.head};
    const first=x.witness.reserve({candidate,expected});
    const second=x.witness.reserve({candidate,expected});
    assert.equal(first.ok,true);
    assert.equal(second.ok,false);
    assert.equal(x.witness.snapshot().pending.reservationId,first.reservationId);
  }finally{x.cleanup();}
});
test('independent anchor advanced but ledger missing cannot be treated as a new install',()=>{
  const x=setup();try{
    x.bootstrap();
    fs.unlinkSync(path.join(x.dir,'r3-h7-synthetic-witness.json'));
    assert.throws(()=>x.witness.snapshot(),/rollback or missing local state/);
    // A lost journal plus an advanced external anchor is a hard failure;
    // even a new signed bootstrap cannot silently replace the missing state.
    const op=x.incident('BOOTSTRAP',{revision:2,epoch:1});
    assert.throws(()=>x.witness.operator(op.event,op.signature),/rollback or missing local state/);
  }finally{x.cleanup();}
});
test('rotated MAC key or equal operator/confirmation key fails closed',()=>{
  const x=setup();try{
    x.bootstrap();
    const alternate=createH7OfflineWitness({
      ...x.options,integrityKey:randomBytes(32)
    });
    assert.throws(()=>alternate.snapshot(),/integrity failure/);
    assert.throws(()=>createH7OfflineWitness({
      ...x.options,confirmationPublicKey:x.operator.publicKey
    }),TypeError);
  }finally{x.cleanup();}
});
