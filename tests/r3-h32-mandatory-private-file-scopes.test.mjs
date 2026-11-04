// H32: imported file readers must not accept an unscoped Rules or IAM file.
// All files below are synthetic temporary records; no actual Firebase data.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {inspectExportFromFile} from '../scripts/r3-effective-rules-export-review.mjs';
import {readPrivateJson} from '../scripts/r3-h1b-authority-evidence-review.mjs';

const candidateFile=path.resolve('firebase.rules.json');
const manifestFile=path.resolve('docs/firebase/R3_REAL_AUTHORITY_PREFLIGHT_20261102.json');
const source=JSON.parse(fs.readFileSync(candidateFile,'utf8'));
const iam={bindings:[{role:'roles/viewer',members:['user:synthetic@example.invalid']}]};
const temporary=fn=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'fg-h32-'));
  const evidence=path.join(dir,'private');
  fs.mkdirSync(evidence,{mode:0o700});
  fs.chmodSync(evidence,0o700);
  const rulesFile=path.join(evidence,'synthetic-rules.json');
  const iamFile=path.join(evidence,'synthetic-iam.json');
  fs.writeFileSync(rulesFile,JSON.stringify(source),{mode:0o600});
  fs.writeFileSync(iamFile,JSON.stringify(iam),{mode:0o600});
  fs.chmodSync(rulesFile,0o600);fs.chmodSync(iamFile,0o600);
  try{return fn({dir,evidence,rulesFile,iamFile});}
  finally{fs.rmSync(dir,{recursive:true,force:true});}
};
const rulesAt=(file,privateEvidenceDirectory)=>
  inspectExportFromFile(file,{candidateFile,manifestFile,privateEvidenceDirectory});

test('H32 Rules-only imported file API refuses omitted or empty evidence root',()=>temporary(({rulesFile})=>{
  for(const privateEvidenceDirectory of [undefined,null,'','  ']){
    const r=rulesAt(rulesFile,privateEvidenceDirectory);
    assert.equal(r.reason,'OPERATOR_EXPORT_PRIVATE_DIRECTORY_REQUIRED');
    assert.equal(r.repoCandidateMatchesExport,false);
    assert.equal(r.releaseDecision,'NO_GO');
    assert.equal(r.mayDeploy,false);
  }
}));

test('H32 Rules+IAM file reader refuses omitted or empty private evidence root',()=>temporary(({iamFile})=>{
  for(const privateEvidenceDirectory of [undefined,null,'','  ']){
    assert.throws(()=>readPrivateJson(iamFile,{privateEvidenceDirectory}),
      /PRIVATE_EVIDENCE_INPUT_UNAVAILABLE/);
  }
}));

test('H32 both readers accept explicitly scoped, owner-private synthetic files only',()=>temporary(({evidence,rulesFile,iamFile})=>{
  const r=rulesAt(rulesFile,evidence);
  assert.equal(r.reason,'MATCHES_REPO_CANDIDATE_BUT_CLOUD_PROVENANCE_UNVERIFIED');
  assert.equal(r.repoCandidateMatchesExport,true);
  assert.equal(r.releaseDecision,'NO_GO');
  assert.equal(r.mayDeploy,false);
  assert.deepEqual(readPrivateJson(iamFile,{privateEvidenceDirectory:evidence}),iam);
  assert.doesNotMatch(JSON.stringify(r),/synthetic@example\.invalid|synthetic-rules\.json/);
}));

test('H32 Rules-only API fails closed on unsafe directory or file POSIX permissions',()=>temporary(({evidence,rulesFile,iamFile})=>{
  if(process.platform==='win32')return; // Windows ACLs require separate owner review.
  fs.chmodSync(evidence,0o755);
  const root=rulesAt(rulesFile,evidence);
  assert.equal(root.reason,'OPERATOR_EXPORT_OUTSIDE_PRIVATE_DIRECTORY');
  assert.throws(()=>readPrivateJson(iamFile,{privateEvidenceDirectory:evidence}),
    /PRIVATE_EVIDENCE_INPUT_UNAVAILABLE/);
  fs.chmodSync(evidence,0o700);
  fs.chmodSync(rulesFile,0o644);
  const r=rulesAt(rulesFile,evidence);
  assert.equal(r.reason,'OPERATOR_EXPORT_UNAVAILABLE_OR_MALFORMED');
  assert.equal(r.repoCandidateMatchesExport,false);
  assert.equal(r.mayDeploy,false);
  fs.chmodSync(iamFile,0o644);
  assert.throws(()=>readPrivateJson(iamFile,{privateEvidenceDirectory:evidence}),
    /PRIVATE_EVIDENCE_INPUT_UNAVAILABLE/);
}));

test('H32 library imports cannot override root containment with external or nested paths',()=>temporary(({dir,evidence,rulesFile,iamFile})=>{
  const outside=path.join(dir,'outside.json');
  fs.writeFileSync(outside,JSON.stringify(source),{mode:0o600});
  const nested=path.join(evidence,'nested');
  fs.mkdirSync(nested,{mode:0o700});
  const below=path.join(nested,'rules.json');
  fs.writeFileSync(below,JSON.stringify(source),{mode:0o600});
  for(const file of [outside,below]){
    const r=rulesAt(file,evidence);
    assert.equal(r.reason,'OPERATOR_EXPORT_OUTSIDE_PRIVATE_DIRECTORY');
    assert.equal(r.releaseDecision,'NO_GO');
  }
  assert.throws(()=>readPrivateJson(outside,{privateEvidenceDirectory:evidence}),
    /PRIVATE_EVIDENCE_INPUT_UNAVAILABLE/);
  assert.throws(()=>readPrivateJson(below,{privateEvidenceDirectory:evidence}),
    /PRIVATE_EVIDENCE_INPUT_UNAVAILABLE/);
}));

test('H32 no private evidence is emitted to logs, JSON outputs or cloud routes',()=>{
  const a=fs.readFileSync('scripts/r3-effective-rules-export-review.mjs','utf8');
  const b=fs.readFileSync('scripts/r3-h1b-authority-evidence-review.mjs','utf8');
  for(const s of [a,b]){
    assert.doesNotMatch(s,/\bfetch\s*\(|firebase deploy|firebase-admin|writeFileSync|createWriteStream/);
    assert.match(s,/privateEvidenceDirectory/);
  }
  assert.match(a,/OPERATOR_EXPORT_PRIVATE_DIRECTORY_REQUIRED/);
  assert.match(b,/missing-private-root/);
});
