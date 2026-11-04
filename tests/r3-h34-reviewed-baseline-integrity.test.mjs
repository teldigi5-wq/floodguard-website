// Synthetic-only H34: reject duplicate keys in reviewed local baselines.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const source=JSON.parse(fs.readFileSync(path.join(root,'firebase.rules.json'),'utf8'));
const manifest=JSON.parse(fs.readFileSync(path.join(root,
  'docs/firebase/R3_REAL_AUTHORITY_PREFLIGHT_20261102.json'),'utf8'));

function fixture(fn){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'fg-h34-'));
  const checkout=path.join(dir,'review-checkout');
  const scripts=path.join(checkout,'scripts');
  const documents=path.join(checkout,'docs/firebase');
  const evidence=path.join(checkout,'.floodguard-private-evidence');
  const privateDir=path.join(dir,'home','.local','share','floodguard-private','r3-h1b');
  const foreign=path.join(dir,'foreign-cwd');
  try{
    for(const p of [scripts,documents,foreign])fs.mkdirSync(p,{recursive:true});
    for(const p of [evidence,privateDir]){
      fs.mkdirSync(p,{recursive:true,mode:0o700});
      fs.chmodSync(p,0o700);
    }
    for(const name of [
      'r3-effective-rules-export-review.mjs',
      'r3-h1b-authority-evidence-review.mjs',
      'r3-real-authority-preflight.mjs',
      'r3-private-json-evidence-core.mjs'
    ])fs.copyFileSync(path.join(root,'scripts',name),path.join(scripts,name));
    const candidate=path.join(checkout,'firebase.rules.json');
    const reviewed=path.join(documents,'R3_REAL_AUTHORITY_PREFLIGHT_20261102.json');
    fs.writeFileSync(candidate,JSON.stringify(source));
    fs.writeFileSync(reviewed,JSON.stringify(manifest));
    const operator=path.join(evidence,'operator.json');
    const privateRules=path.join(privateDir,'rules.json');
    const privateIam=path.join(privateDir,'iam.json');
    for(const [p,value] of [[operator,source],[privateRules,source],
      [privateIam,{bindings:[{role:'roles/viewer',members:['user:synthetic@example.invalid']}]}]]){
      fs.writeFileSync(p,JSON.stringify(value),{mode:0o600});
      fs.chmodSync(p,0o600);
    }
    const run=(name,args)=>{
      const x=spawnSync(process.execPath,[path.join(scripts,name),...args],{
        cwd:foreign,
        env:{...process.env,HOME:path.join(dir,'home'),USERPROFILE:path.join(dir,'home')},
        encoding:'utf8',maxBuffer:65536,timeout:6000
      });
      assert.equal(x.error,undefined);
      assert.equal(x.stderr,'');
      const report=JSON.parse(x.stdout);
      assert.equal(report.releaseDecision,'NO_GO');
      assert.equal(report.mayDeploy,false);
      assert.doesNotMatch(x.stdout,/synthetic@example\.invalid|operator\.json|rules\.json|iam\.json|\.read/);
      return {code:x.status,report};
    };
    const both=()=>({
      a:run('r3-effective-rules-export-review.mjs',[operator]),
      b:run('r3-h1b-authority-evidence-review.mjs',
        ['--effective-rules',privateRules,'--project-iam',privateIam])
    });
    return fn({candidate,reviewed,both});
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
}
function rejected(x){
  assert.equal(x.a.code,2);
  assert.equal(x.a.report.reason,'OPERATOR_EXPORT_UNAVAILABLE_OR_MALFORMED');
  assert.equal(x.a.report.repoCandidateMatchesExport,false);
  assert.equal(x.b.code,2);
  assert.equal(x.b.report.reason,'PRIVATE_EVIDENCE_INPUT_UNAVAILABLE');
}
function altered(file,original,raw,both){
  assert.notEqual(original,raw);
  assert.deepEqual(JSON.parse(raw),JSON.parse(original),
    'The threat must be invisible to plain JSON.parse');
  fs.writeFileSync(file,raw);
  rejected(both());
}

test('H34 normal source/manifest still compare locally and never authorize release',()=>fixture(({both})=>{
  const x=both();
  assert.equal(x.a.code,0);
  assert.equal(x.a.report.repoCandidateMatchesExport,true);
  assert.equal(x.a.report.authenticatedCloudExport,false);
  assert.equal(x.b.code,0);
  assert.equal(x.b.report.rulesDocumentsStructurallyMatch,true);
  assert.equal(x.b.report.exportProvenanceVerified,false);
}));
test('H34 shadowed top-level candidate Rules are rejected by both CLIs',()=>fixture(({candidate,both})=>{
  const original=JSON.stringify(source);
  const raw='{"rules":{"floodguard":{"live":{".read":true}}},"rules":'+
    JSON.stringify(source.rules)+'}';
  altered(candidate,original,raw,both);
}));
test('H34 duplicate nested .read permission is rejected in candidate',()=>fixture(({candidate,both})=>{
  const original=JSON.stringify(source);
  altered(candidate,original,original.replace('".read":false',
    '".read":true,".read":false'),both);
}));
test('H34 Unicode-escaped duplicate candidate key is rejected',()=>fixture(({candidate,both})=>{
  const original=JSON.stringify(source);
  const escaped='".read":true,"'+String.fromCharCode(92)+'u002eread":false';
  altered(candidate,original,original.replace('".read":false',escaped),both);
}));
test('H34 duplicate manifest releaseDecision cannot be silently discarded',()=>fixture(({reviewed,both})=>{
  const original=JSON.stringify(manifest);
  altered(reviewed,original,original.replace('"releaseDecision":"NO_GO"',
    '"releaseDecision":"GO","releaseDecision":"NO_GO"'),both);
}));
test('H34 duplicate nested manifest role trust cannot be silently discarded',()=>fixture(({reviewed,both})=>{
  const original=JSON.stringify(manifest);
  altered(reviewed,original,original.replace('"trust":"DEVICE_KEY_NOT_VERIFIED"',
    '"trust":"VERIFIED","trust":"DEVICE_KEY_NOT_VERIFIED"'),both);
}));
test('H34 source policy: both CLIs parse candidate and manifest with shared no-I/O duplicate guard',()=>{
  for(const file of ['r3-effective-rules-export-review.mjs','r3-h1b-authority-evidence-review.mjs']){
    const sourceText=fs.readFileSync(path.join(root,'scripts',file),'utf8');
    assert.match(sourceText,/parsePrivateEvidenceJson\(fs\.readFileSync/);
    assert.doesNotMatch(sourceText,/JSON\.parse\(fs\.readFileSync/);
    assert.doesNotMatch(sourceText,/\bfetch\s*\(|firebase deploy|writeFileSync|execSync|spawnSync/);
  }
});
