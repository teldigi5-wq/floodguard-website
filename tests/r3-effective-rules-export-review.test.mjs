// FloodGuard R3 private Rules export comparison: synthetic fixtures only.
// Never authenticate to real Firebase or place deployed exports in Git/CI.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {
  assessOperatorRulesExport,inspectExportFromFile
} from '../scripts/r3-effective-rules-export-review.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const candidateFile=path.join(root,'firebase.rules.json');
const manifestFile=path.join(root,
  'docs/firebase/R3_REAL_AUTHORITY_PREFLIGHT_20261102.json');
const source=JSON.parse(fs.readFileSync(candidateFile,'utf8'));
const manifest=JSON.parse(fs.readFileSync(manifestFile,'utf8'));
const copy=x=>structuredClone(x);
const options={candidateFile,manifestFile};
const noGo=r=>{
  assert.equal(r.releaseDecision,'NO_GO');
  for(const field of ['authenticatedCloudExport','effectiveFirebaseRulesVerified',
    'realAuthorizationVerified','mayDeploy','mayChangeRules','maySendAlert',
    'mayOperateGate','mayApproveRelease'])
    assert.equal(r[field],false,field);
  assert.equal(Object.isFrozen(r),true);
};
const tmp=fn=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'fg-effective-rules-'));
  try{return fn(directory)}finally{fs.rmSync(directory,{recursive:true,force:true});}
};
const run=file=>spawnSync(process.execPath,[
  path.join(root,'scripts/r3-effective-rules-export-review.mjs'),file
],{cwd:root,encoding:'utf8',timeout:3000,maxBuffer:65536});

test('matching synthetic local Rules is an UNATTESTED snapshot, never release authority',()=>{
  const r=assessOperatorRulesExport(copy(source),source,manifest);
  assert.equal(r.repoCandidateMatchesExport,true);
  assert.equal(r.offlineRuleShapeReviewed,true);
  assert.equal(r.reason,'MATCHES_REPO_CANDIDATE_BUT_CLOUD_PROVENANCE_UNVERIFIED');
  noGo(r);
});
test('unexpected write access under public/live or internal nodes fails closed',()=>{
  for(const mutate of [
    r=>r.rules['.write']=true,
    r=>r.rules.floodguard.live.water['.write']='auth != null',
    r=>r.rules.floodguard.staging={'.write':true},
  ]){
    const input=copy(source);
    mutate(input);
    const r=assessOperatorRulesExport(input,source,manifest);
    assert.equal(r.repoCandidateMatchesExport,false);
    assert.equal(r.reason,'OPERATOR_EXPORT_FAILS_REVIEWED_RULE_SCOPE');
    noGo(r);
  }
});
test('unreviewed parent/private read grants and absent public paths are denied',()=>{
  for(const mutate of [
    r=>r.rules.floodguard.live['.read']=true,
    r=>r.rules.floodguard.live.esp8266.ip['.read']=true,
    r=>r.rules.floodguard.live.esp8266.wifi['.read']=true,
    r=>r.rules.floodguard.live.rain['.read']=false,
  ]){
    const input=copy(source);
    mutate(input);
    const r=assessOperatorRulesExport(input,source,manifest);
    assert.equal(r.reason,'OPERATOR_EXPORT_FAILS_REVIEWED_RULE_SCOPE');
    noGo(r);
  }
});
test('compatible but different real Rules still flag drift, not a false exact match',()=>{
  const input=copy(source);
  input.rules.floodguard.live.water['.indexOn']=['distanceCm'];
  const r=assessOperatorRulesExport(input,source,manifest);
  assert.equal(r.offlineRuleShapeReviewed,true);
  assert.equal(r.repoCandidateMatchesExport,false);
  assert.equal(r.reason,'OPERATOR_EXPORT_DIFFERS_FROM_REPO_CANDIDATE');
  noGo(r);
});
test('operator input cannot authorize production by adding fields or self attestation',()=>{
  for(const input of [
    null,{},[],{rules:true},
    {...copy(source),effectiveFirebaseRulesVerified:true},
    {...copy(source),productionChangesAuthorized:true},
  ]){
    const r=assessOperatorRulesExport(input,source,manifest);
    assert.equal(r.repoCandidateMatchesExport,false);
    noGo(r);
  }
});
test('CLI refuses the repository candidate itself as a false operator export',()=>{
  const r=inspectExportFromFile(candidateFile,options);
  assert.equal(r.reason,'REPO_CANDIDATE_IS_NOT_OPERATOR_EXPORT');
  noGo(r);
  const p=run(candidateFile);
  assert.equal(p.status,2);
  assert.equal(JSON.parse(p.stdout).repoCandidateMatchesExport,false);
});
test('CLI reads only a distinct, bounded, regular private file and redacts output',()=>tmp(dir=>{
  const location=path.join(dir,'rules-export.json');
  fs.writeFileSync(location,JSON.stringify(source));
  const r=inspectExportFromFile(location,options);
  assert.equal(r.repoCandidateMatchesExport,true);
  noGo(r);
  const p=run(location);
  assert.equal(p.status,0,p.stderr);
  assert.equal(p.stderr,'');
  const result=JSON.parse(p.stdout);
  assert.equal(result.effectiveFirebaseRulesVerified,false);
  assert.equal(result.releaseDecision,'NO_GO');
  assert.doesNotMatch(p.stdout, /floodguard\/live|rules-export|private|access_token|\.read/);

  fs.writeFileSync(location,'{invalid-json "auth=DO_NOT_LEAK"');
  const invalid=run(location);
  assert.equal(invalid.status,2);
  assert.doesNotMatch(invalid.stdout,'DO_NOT_LEAK');
  fs.writeFileSync(location,'X'.repeat(128*1024+1));
  const huge=run(location);
  assert.equal(huge.status,2);
  assert.equal(JSON.parse(huge.stdout).repoCandidateMatchesExport,false);

  const link=path.join(dir,'link.json');
  fs.symlinkSync(candidateFile,link);
  const linked=run(link);
  assert.equal(linked.status,2,'a symlink to the repo file is forbidden');
  assert.equal(JSON.parse(linked.stdout).repoCandidateMatchesExport,false);
}));
test('CLI without export fails closed without opening a cloud connection',()=>{
  const proc=spawnSync(process.execPath,[
    path.join(root,'scripts/r3-effective-rules-export-review.mjs')
  ],{cwd:root,encoding:'utf8',timeout:3000});
  assert.equal(proc.status,2);
  noGo(JSON.parse(proc.stdout));
});
