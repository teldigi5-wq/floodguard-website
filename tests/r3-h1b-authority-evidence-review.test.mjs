import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {assessPrivateAuthorityEvidence,readPrivateJson,isOfflineReviewReady}
  from '../scripts/r3-h1b-authority-evidence-review.mjs';
const manifest = JSON.parse(fs.readFileSync(
  'docs/firebase/R3_REAL_AUTHORITY_PREFLIGHT_20261102.json', 'utf8'));
const sourceRules = JSON.parse(fs.readFileSync('firebase.rules.json', 'utf8'));
const viewerIam = {bindings:[{role:'roles/viewer', members:['user:placeholder@example.invalid']}]};
const copy = x => structuredClone(x);
const review = (effectiveRules=sourceRules, projectIam=viewerIam) =>
  assessPrivateAuthorityEvidence({manifest,sourceRules,effectiveRules,projectIam});
const neverRelease = x => {
  assert.equal(x.releaseDecision,'NO_GO');
  for(const k of ['approved','mayDeploy','mayMerge','mayChangeRules','mayPublish',
    'mayAcknowledge','maySendAlert','mayFlash','mayOperateGate'])
    assert.equal(x[k],false,k);
  assert.equal(x.exportProvenanceVerified,false);
  assert.equal(x.inheritedAndResourceIamVerified,false);
  assert.equal(x.publicDescendantsInventoryVerified,false);
  assert.equal(x.realWorldGatesUnverified,11);
};
test('source-equivalent local inputs only permit review, not operational authority',()=>{
  const r=review();neverRelease(r);
  assert.equal(r.sourceRulesPreflightValid,true);
  assert.equal(r.importedRulesPassedStrictSourceContract,true);
  assert.equal(r.rulesDocumentsStructurallyMatch,true);
  assert.equal(r.projectIamExportWellFormed,true);
});
test('unexpected parent read is blocked despite deeper private false rules',()=>{
  const r=copy(sourceRules);r.rules.floodguard.live['.read']=true;
  const f=review(r);neverRelease(f);
  assert.equal(f.importedRulesPassedStrictSourceContract,false);
  assert.equal(f.rulesDocumentsStructurallyMatch,false);
});
test('conditional wildcard parent grant cannot silently pass',()=>{
  const r=copy(sourceRules);r.rules.floodguard['$uid']={'.read':'auth != null'};
  assert.equal(review(r).importedRulesPassedStrictSourceContract,false);
});
test('unexpected write grant is denied without claiming production verification',()=>{
  const r=copy(sourceRules);r.rules.floodguard.live.water['.write']='auth != null';
  assert.equal(review(r).importedRulesPassedStrictSourceContract,false);
});
test('high-privileged IAM role requires human inspection',()=>{
  const x=review(sourceRules,{bindings:[{role:'roles/owner',members:['serviceAccount:synthetic@example.invalid']}]});
  neverRelease(x);assert.equal(x.highPrivilegeIamRoleRequiresReview,true);
});
test('public and all-authenticated IAM members are flagged',()=>{
  for(const member of ['allUsers','allAuthenticatedUsers']){
    const x=review(sourceRules,{bindings:[{role:'roles/viewer',members:[member]}]});
    assert.equal(x.publicIamMemberRequiresReview,true);
  }
});
test('conditional and custom IAM roles are not assumed safe',()=>{
  const x=review(sourceRules,{bindings:[{
    role:'projects/synthetic/roles/runtimeWriter',
    members:['serviceAccount:synthetic@example.invalid'],
    condition:{title:'temporary',expression:'request.time < timestamp("2030-01-01T00:00:00Z")'}
  }]});
  assert.equal(x.customIamRoleRequiresReview,true);
  assert.equal(x.nonViewerIamRoleRequiresReview,true);
  assert.equal(x.conditionalIamBindingRequiresReview,true);
});
test('unrecognized standard role and service account admin require review',()=>{
  const a=review(sourceRules,{bindings:[{role:'roles/iam.serviceAccountAdmin',members:['serviceAccount:synthetic@example.invalid']}]});
  assert.equal(a.highPrivilegeIamRoleRequiresReview,true);
  assert.equal(a.nonViewerIamRoleRequiresReview,true);
  const b=review(sourceRules,{bindings:[{role:'roles/nonexistentUnrecognized',members:['user:synthetic@example.invalid']}]});
  assert.equal(b.nonViewerIamRoleRequiresReview,true);
});
test('malformed policies fail closed',()=>{
  for(const x of [{},{bindings:null},{bindings:[{role:'roles/viewer'}]},
    {bindings:[{role:'roles/viewer',members:42}]}]){
    const r=review(sourceRules,x);neverRelease(r);
    assert.equal(r.projectIamExportWellFormed,false);
  }
});
test('output never reflects sensitive IAM member names or custom role strings',()=>{
  const secret='sensitive-identity@example.invalid';
  const r=review(sourceRules,{bindings:[{
    role:'projects/hidden/roles/custom',members:['user:'+secret]}]});
  const s=JSON.stringify(r);
  assert.equal(s.includes(secret),false);
  assert.equal(s.includes('projects/hidden'),false);
});
test('private reader refuses symlinks and world-readable files',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'fg-h1b-'));
  try {
    fs.chmodSync(dir,0o700);
    const original=path.join(dir,'iam.json');
    const alias=path.join(dir,'alias.json');
    fs.writeFileSync(original,JSON.stringify(viewerIam),{mode:0o600});
    fs.chmodSync(original,0o600);
    assert.deepEqual(readPrivateJson(original),viewerIam);
    fs.symlinkSync(original,alias);
    assert.throws(()=>readPrivateJson(alias),/PRIVATE_EVIDENCE_INPUT_UNAVAILABLE/);
    fs.chmodSync(original,0o644);
    if(process.platform !== 'win32')
      assert.throws(()=>readPrivateJson(original),/PRIVATE_EVIDENCE_INPUT_UNAVAILABLE/);
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
});
test('private reader refuses oversized or invalid JSON',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'fg-h1b-'));
  try {
    fs.chmodSync(dir,0o700);
    const f=path.join(dir,'evidence.json');
    fs.writeFileSync(f,'{not-json',{mode:0o600});fs.chmodSync(f,0o600);
    assert.throws(()=>readPrivateJson(f),/PRIVATE_EVIDENCE_INPUT_UNAVAILABLE/);
    fs.writeFileSync(f,'a'.repeat(1024*1024+1));fs.chmodSync(f,0o600);
    assert.throws(()=>readPrivateJson(f),/PRIVATE_EVIDENCE_INPUT_UNAVAILABLE/);
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
});
test('review has no network or write implementation',()=>{
  const source=fs.readFileSync('scripts/r3-h1b-authority-evidence-review.mjs','utf8');
  const imports=source.match(/^import .*$/gm)?.join('\n')??'';
  assert.doesNotMatch(imports,/https?|firebase-admin|child_process|axios/);
  assert.doesNotMatch(source,/\bfetch\s*\(|\.listen\s*\(|writeFileSync|execSync|spawnSync/);
});

// H1/B2: The CLI must not report success for mismatched or unsubstantiated exports.
test('an invalid source baseline cannot produce an offline review-ready result',()=>{
  const modified=copy(sourceRules);
  modified.rules.floodguard.live.water['.read']=false;
  const x=assessPrivateAuthorityEvidence({manifest,sourceRules:modified,
    effectiveRules:sourceRules,projectIam:viewerIam});
  assert.equal(x.sourceRulesPreflightValid,false);
  assert.equal(x.importedRulesPassedStrictSourceContract,true);
  assert.equal(isOfflineReviewReady(x),false);
});
test('different valid rule documents cannot produce offline review-ready status',()=>{
  const effective=copy(sourceRules);
  effective.rules.floodguard.live.water['.indexOn']=['ts'];
  const x=review(effective);
  assert.equal(x.sourceRulesPreflightValid,true);
  assert.equal(x.importedRulesPassedStrictSourceContract,true);
  assert.equal(x.rulesDocumentsStructurallyMatch,false);
  assert.equal(isOfflineReviewReady(x),false);
});
test('empty or ineffective IAM bindings are not enough for offline review-ready',()=>{
  for(const policy of [{bindings:[]},
    {bindings:[{role:'roles/viewer',members:[]}]}]){
    const x=review(sourceRules,policy);
    assert.equal(x.projectIamExportWellFormed,true);
    assert.equal(isOfflineReviewReady(x),false);
  }
});
test('review-ready is a narrow local check and never upgrades release status',()=>{
  const x=review();
  assert.equal(isOfflineReviewReady(x),true);
  neverRelease(x);
  for(const iam of [
    {bindings:[{role:'roles/owner',members:['user:example.invalid']}]},
    {bindings:[{role:'roles/viewer',members:['allUsers']}]},
    {bindings:[{role:'roles/viewer',members:['user:example.invalid'],condition:{title:'x',expression:'true'}}]}
  ]) assert.equal(isOfflineReviewReady(review(sourceRules,iam)),false);
});

test('CLI exit 0 is reserved for matching and nonempty offline review documents',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'fg-h1b-cli-'));
  try {
    fs.chmodSync(dir,0o700);
    const rulePath=path.join(dir,'rules.json');
    const iamPath=path.join(dir,'iam.json');
    const run=(rules,iam)=>{
      fs.writeFileSync(rulePath,JSON.stringify(rules),{mode:0o600});
      fs.writeFileSync(iamPath,JSON.stringify(iam),{mode:0o600});
      fs.chmodSync(rulePath,0o600);fs.chmodSync(iamPath,0o600);
      const result=spawnSync(process.execPath,[
        'scripts/r3-h1b-authority-evidence-review.mjs',
        '--effective-rules',rulePath,'--project-iam',iamPath],
        {cwd:process.cwd(),encoding:'utf8',timeout:5000,maxBuffer:16384});
      assert.equal(result.error,undefined);
      const report=JSON.parse(result.stdout);
      neverRelease(report);
      assert.doesNotMatch(result.stdout,/placeholder@example\.invalid/);
      return {code:result.status,report};
    };
    assert.equal(run(sourceRules,viewerIam).code,0);
    assert.equal(run(sourceRules,{bindings:[]}).code,2);
    assert.equal(run(sourceRules,{bindings:[{role:'roles/viewer',members:[]}]}).code,2);
    const changed=copy(sourceRules);
    changed.rules.floodguard.live.water['.indexOn']=['ts'];
    assert.equal(run(changed,viewerIam).code,2);
    const unsafe=copy(sourceRules);
    unsafe.rules.floodguard.live['.read']=true;
    assert.equal(run(unsafe,viewerIam).code,2);
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
});
