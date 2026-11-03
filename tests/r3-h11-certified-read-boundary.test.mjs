// R3 H11 pure signed-view tests; no Firebase, network, production or gate.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {
  canonicalH11Certificate,createH11LabCertifier,createH11LabConsumer
} from '../experiments/r3-h11-certified-read-boundary.mjs';

const NOW=1762180000000,ID='device-stage-a',DIGEST='c'.repeat(64);
const keys=generateKeyPairSync('ed25519');
const bad=generateKeyPairSync('ed25519');
function fixture(){
  const current={distanceCm:16.5,levelCm:8.5,status:'WARNING',
    observedAtMs:NOW-1000,overallRisk:'UNKNOWN'};
  const checkpoint={initialized:true,deviceId:ID,epoch:1,
    sequence:2,digest:DIGEST,observedAtMs:NOW-1000};
  const control={
    epoch:1,blocked:false,revision:1,
    device:{enabled:true,scope:'prototype-ingest-v1'},
    publisher:{enabled:true,deviceId:ID,epoch:1,
      scope:'publication-lab-water-v1'},
    issuer:{enabled:true,generation:1,scope:'lab-signed-admission-v1'}
  };
  const node={control,current,checkpoint};
  const anchor={
    witness:{revision:3,head:'a'.repeat(64),epoch:1,
      quarantined:false,sequence:2,digest:DIGEST,pending:null,
      releaseDecision:'NO_GO'},
    signer:{enabled:true,generation:1,scope:'h11-signed-readback-v1'}
  };
  const certificate={
    version:'floodguard-r3-h11-water-certificate-v1',
    deviceId:ID,epoch:1,authorityRevision:1,signerGeneration:1,
    sequence:2,digest:DIGEST,status:'WARNING',
    distanceCm:16.5,levelCm:8.5,observedAtMs:NOW-1000,
    issuedAtMs:NOW,expiresAtMs:NOW+4000
  };
  const proof={
    certificate,signature:sign(null,Buffer.from(
      canonicalH11Certificate(certificate)),
      keys.privateKey).toString('base64url')
  };
  return {node,anchor,certificate,proof};
}
function consumer({node,anchor,clock=()=>NOW,
  readPublication,readIndependentAnchor,publicKey=keys.publicKey}={}){
  const f=fixture();
  return createH11LabConsumer({
    verifierPublicKey:publicKey,
    readPublication:readPublication??(async()=>structuredClone(node??f.node)),
    readIndependentAnchor:readIndependentAnchor??(async()=>structuredClone(anchor??f.anchor)),
    clock
  });
}
test('valid signer, published record and acknowledged witness yield only LAB evidence, never SAFE authority',async()=>{
  const f=fixture(),r=await consumer().inspect(f.proof);
  assert.equal(r.verified,true,JSON.stringify(r));
  assert.equal(r.signedStatus,'WARNING');
  for(const k of ['canDeclareSafe','canOperateGate','canSendAlert','physicalSourceVerified'])
    assert.equal(r[k],false,k);
  assert.equal(r.releaseDecision,'NO_GO');
});
test('tampered or untrusted signatures never certify',async()=>{
  const f=fixture();
  for(const proof of [
    {...f.proof,signature:'A'.repeat(86)},
    {...f.proof,certificate:{...f.certificate,status:'SAFE'}},
    {...f.proof,certificate:{...f.certificate,distanceCm:22}},
    {...f.proof,certificate:{...f.certificate,extra:'owner'}},
    {...f.proof,certificate:{...f.certificate,signerGeneration:2}},
    {...f.proof,signature:'malformed'},
    null
  ])assert.equal((await consumer().inspect(proof)).verified,false);
  assert.equal((await consumer({publicKey:bad.publicKey})
    .inspect(f.proof)).verified,false);
});
test('forged privileged SAFE record and changed replay checkpoint cannot be trusted',async()=>{
  const f=fixture();
  for(const alteration of [
    {...f.node,current:{...f.node.current,status:'SAFE'}},
    {...f.node,current:{...f.node.current,distanceCm:20}},
    {...f.node,checkpoint:{...f.node.checkpoint,digest:'f'.repeat(64)}},
    {...f.node,checkpoint:{...f.node.checkpoint,sequence:3}},
    {...f.node,current:{...f.node.current,privateIp:'192.0.2.1'}},
    {...f.node,control:{...f.node.control,blocked:true}},
    {...f.node,control:{...f.node.control,issuer:{
      ...f.node.control.issuer,enabled:false}}}
  ])assert.equal((await consumer({node:alteration})
    .inspect(f.proof)).verified,false);
});
test('witness must acknowledge exact digest and sequence, no pending or quarantine',async()=>{
  const f=fixture();
  for(const state of [
    {...f.anchor,witness:{...f.anchor.witness,sequence:1}},
    {...f.anchor,witness:{...f.anchor.witness,digest:'f'.repeat(64)}},
    {...f.anchor,witness:{...f.anchor.witness,quarantined:true}},
    {...f.anchor,witness:{...f.anchor.witness,pending:{reservationId:'a'}}},
    {...f.anchor,witness:{...f.anchor.witness,epoch:2}},
    {...f.anchor,signer:{...f.anchor.signer,enabled:false}},
    {...f.anchor,signer:{...f.anchor.signer,generation:2}}
  ])assert.equal((await consumer({anchor:state})
    .inspect(f.proof)).verified,false);
});
test('stale and future timestamps and expired certificate are refused',async()=>{
  const f=fixture();
  for(const time of [NOW+5000,NOW+32000,NOW-3000]){
    assert.equal((await consumer({clock:()=>time}).inspect(f.proof)).verified,false);
  }
  assert.throws(()=>canonicalH11Certificate({...f.certificate,
    expiresAtMs:NOW+4001}),/noncanonical/);
  assert.throws(()=>canonicalH11Certificate({...f.certificate,
    observedAtMs:'2026-11-03'}),/noncanonical/);
});
test('independent anchor changes during DB read refuse final verification',async()=>{
  const f=fixture();
  let revision=3;
  const c=consumer({
    readIndependentAnchor:async()=>({
      ...structuredClone(f.anchor),witness:{
        ...f.anchor.witness,revision
      }
    }),
    readPublication:async()=>{revision=4;return structuredClone(f.node);}
  });
  const r=await c.inspect(f.proof);
  assert.equal(r.verified,false);
  assert.equal(r.reason,'authority-changed-during-read');
});
test('read outage and stale signer policy cannot return a verified view',async()=>{
  const f=fixture();
  for(const args of [
    {readIndependentAnchor:async()=>{throw Error('independent offline');}},
    {readPublication:async()=>{throw Error('Firebase offline');}},
    {clock:()=>NaN}
  ])assert.equal((await consumer(args).inspect(f.proof)).verified,false);
});
test('synthetic certifier refuses absent H4 verification or altered record',async()=>{
  const f=fixture();
  const no=Object.freeze({issue:async()=>({issued:false,releaseDecision:'NO_GO'})});
  const signer=keys.privateKey;
  const x=createH11LabCertifier({
    issuer:no,readPublication:async()=>structuredClone(f.node),
    signerPrivateKey:signer,clock:()=>NOW
  });
  assert.equal((await x.certify({})).verified,false);
  let node=structuredClone(f.node);
  const fakeIssuer=Object.freeze({issue:async()=>({
    issued:true,releaseDecision:'NO_GO',canWriteFirebase:false,canPublish:false,
    candidate:{current:structuredClone(f.node.current),
      checkpoint:structuredClone(f.node.checkpoint)}
  })});
  const y=createH11LabCertifier({
    issuer:fakeIssuer,readPublication:async()=>structuredClone(node),
    signerPrivateKey:signer,clock:()=>NOW
  });
  assert.equal((await y.certify({})).certified,true);
  node.current.status='SAFE';
  assert.equal((await y.certify({})).certified,undefined);
  const z=createH11LabCertifier({
    issuer:fakeIssuer,
    readPublication:async()=>{
      const copy=structuredClone(f.node);
      node.control.blocked=!node.control.blocked;
      return {...copy,control:{...copy.control,blocked:node.control.blocked}};
    },
    signerPrivateKey:signer,clock:()=>NOW
  });
  assert.equal((await z.certify({})).certified,undefined);
});
test('EXPECTED OPEN DEFECT: collusion over signer AND external witness AND privileged DB owner defeats view verification',async()=>{
  const f=fixture();
  const ownerForged=structuredClone(f.node);
  ownerForged.current.status='SAFE';
  ownerForged.current.distanceCm=20;
  ownerForged.checkpoint.digest='f'.repeat(64);
  const compromisedCertificate={
    ...f.certificate,status:'SAFE',distanceCm:20,
    digest:'f'.repeat(64)
  };
  const compromisedProof={
    certificate:compromisedCertificate,
    signature:sign(null,Buffer.from(
      canonicalH11Certificate(compromisedCertificate)),
      keys.privateKey).toString('base64url')
  };
  const jointlyForgedAnchor={
    ...f.anchor,witness:{...f.anchor.witness,digest:'f'.repeat(64)}
  };
  const r=await consumer({node:ownerForged,anchor:jointlyForgedAnchor})
    .inspect(compromisedProof);
  assert.equal(r.verified,true,'Joint trust-domain compromise remains a demonstrable attack');
  assert.equal(r.signedStatus,'SAFE');
  assert.equal(r.canDeclareSafe,false);
  assert.equal(r.physicalSourceVerified,false);
});
test('no cloud/Admin/API/physical controls exist in pure certificate gate',()=>{
  const source=readFileSync(new URL(
    '../experiments/r3-h11-certified-read-boundary.mjs',import.meta.url),'utf8');
  assert.doesNotMatch(source,/from 'firebase|from 'node:http|from 'node:https|fetch\s*\(|writeFileSync\s*\(/);
  assert.doesNotMatch(source,/servo\.write\s*\(|\.listen\s*\(|\bspawn\s*\(/);
  assert.match(source,/releaseDecision:'NO_GO'/);
  assert.match(source,/physicalSourceVerified:false/);
});
