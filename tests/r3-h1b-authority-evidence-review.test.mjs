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

// The production H1/B CLI uses the operator-owned home directory. In tests,
// replace HOME with a disposable sandbox; never read a user's real evidence.
const localCliFixture=(fn)=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'fg-h31-evidence-'));
  const home=path.join(dir,'synthetic-owner-home');
  const root=path.join(home,'.local','share','floodguard-private','r3-h1b');
  fs.mkdirSync(root,{recursive:true,mode:0o700});
  fs.chmodSync(root,0o700);
  try{
    const run=(rules,iam,{rawRules,rawIam,rulePath,iamPath}={})=>{
      const rp=rulePath??path.join(root,'effective-rtdb-rules.json');
      const ip=iamPath??path.join(root,'project-iam.json');
      if(!rulePath)fs.writeFileSync(rp,rawRules??JSON.stringify(rules),{mode:0o600});
      if(!iamPath)fs.writeFileSync(ip,rawIam??JSON.stringify(iam),{mode:0o600});
      const result=spawnSync(process.execPath,[
        'scripts/r3-h1b-authority-evidence-review.mjs',
        '--effective-rules',rp,'--project-iam',ip
      ],{cwd:process.cwd(),env:{...process.env,HOME:home,USERPROFILE:home},
        encoding:'utf8',timeout:5000,maxBuffer:16384});
      assert.equal(result.error,undefined);
      const report=JSON.parse(result.stdout);
      assert.equal(report.releaseDecision,'NO_GO');
      assert.equal(report.mayDeploy,false);
      assert.equal(report.mayOperateGate,false);
      assert.doesNotMatch(result.stdout,/placeholder@example\.invalid|effective-rtdb-rules\.json|project-iam\.json|\.read/);
      assert.equal(result.stderr,'');
      return {code:result.status,report};
    };
    return fn({dir,home,root,run});
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
};

test('H31 CLI matching local Rules and IAM remain NO-GO, mismatched or empty IAM reject',()=>localCliFixture(({run})=>{
  assert.equal(run(sourceRules,viewerIam).code,0);
  assert.equal(run(sourceRules,{bindings:[]}).code,2);
  assert.equal(run(sourceRules,{bindings:[{role:'roles/viewer',members:[]}]}).code,2);
  const changed=copy(sourceRules);
  changed.rules.floodguard.live.water['.indexOn']=['ts'];
  assert.equal(run(changed,viewerIam).code,2);
  const unsafe=copy(sourceRules);
  unsafe.rules.floodguard.live['.read']=true;
  assert.equal(run(unsafe,viewerIam).code,2);
}));

test('H31 rejects shadowed IAM bindings and duplicate nested role keys',()=>localCliFixture(({run})=>{
  const view=JSON.stringify(viewerIam);
  const shadow='{"bindings":[{"role":"roles/owner","members":["allUsers"]}],"bindings":'+
    view.slice('{"bindings":'.length);
  assert.deepEqual(JSON.parse(shadow),viewerIam);
  assert.equal(run(sourceRules,viewerIam,{rawIam:shadow}).code,2);

  const roleShadow=view.replace('"role":"roles/viewer"',
    '"role":"roles/owner","role":"roles/viewer"');
  assert.deepEqual(JSON.parse(roleShadow),viewerIam);
  assert.equal(run(sourceRules,viewerIam,{rawIam:roleShadow}).code,2);

  const escaped=view.replace('"role":"roles/viewer"',
    String.raw`"role":"roles/owner","\u0072ole":"roles/viewer"`);
  assert.deepEqual(JSON.parse(escaped),viewerIam);
  assert.equal(run(sourceRules,viewerIam,{rawIam:escaped}).code,2);
}));

test('H31 rejects shadowed effective Rules, even with restrictive final key',()=>localCliFixture(({run})=>{
  const raw='{"rules":{"floodguard":{"live":{".read":true}}},"rules":'+
    JSON.stringify(sourceRules.rules)+'}';
  assert.deepEqual(JSON.parse(raw),sourceRules);
  assert.equal(run(sourceRules,viewerIam,{rawRules:raw}).code,2);
}));

test('H31 refuses outside, nested, symlink and hardlink paths under owner home',()=>localCliFixture(({dir,home,root,run})=>{
  const extra=path.join(dir,'tracked-like-rules.json');
  fs.writeFileSync(extra,JSON.stringify(sourceRules),{mode:0o600});
  const outside=run(sourceRules,viewerIam,{rulePath:extra});
  assert.equal(outside.code,2);

  const nestedDir=path.join(root,'sub');
  fs.mkdirSync(nestedDir,{mode:0o700});
  const nested=path.join(nestedDir,'nested.json');
  fs.writeFileSync(nested,JSON.stringify(sourceRules),{mode:0o600});
  assert.equal(run(sourceRules,viewerIam,{rulePath:nested}).code,2);

  const real=path.join(root,'real.json');
  fs.writeFileSync(real,JSON.stringify(sourceRules),{mode:0o600});
  const symlink=path.join(root,'alias.json');
  fs.symlinkSync(real,symlink);
  assert.equal(run(sourceRules,viewerIam,{rulePath:symlink}).code,2);

  const hardlink=path.join(root,'hardlink.json');
  fs.linkSync(real,hardlink);
  assert.equal(run(sourceRules,viewerIam,{rulePath:hardlink}).code,2);

  const moved=path.join(home,'renamed-private');
  fs.renameSync(root,moved);
  fs.symlinkSync(moved,root,'dir');
  const throughRoot=path.join(root,'real.json');
  assert.equal(run(sourceRules,viewerIam,{rulePath:throughRoot}).code,2);
}));

test('H31 private IAM reader rejects unprotected root and group-readable input',()=>localCliFixture(({root,run})=>{
  const good=run(sourceRules,viewerIam);
  assert.equal(good.code,0);
  if(process.platform==='win32')return;
  const pathIam=path.join(root,'project-iam.json');
  fs.chmodSync(pathIam,0o644);
  assert.equal(run(sourceRules,viewerIam,{iamPath:pathIam}).code,2);
  fs.chmodSync(pathIam,0o600);
  fs.chmodSync(root,0o755);
  assert.equal(run(sourceRules,viewerIam).code,2);
}));
