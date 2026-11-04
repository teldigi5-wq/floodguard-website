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
const privateWrite=(file,content)=>{
  fs.writeFileSync(file,content,{mode:0o600});
  fs.chmodSync(file,0o600);
};
const tmp=fn=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'fg-effective-rules-'));
  try{return fn(directory)}finally{fs.rmSync(directory,{recursive:true,force:true});}
};
const run=(file,{cwd=root,
  script=path.join(root,'scripts/r3-effective-rules-export-review.mjs')}={})=>
  spawnSync(process.execPath,[script,file],
    {cwd,encoding:'utf8',timeout:3000,maxBuffer:65536});

// An isolated synthetic checkout tests the *real CLI* without writing a
// secret or even a synthetic export into the source repository. The production
// CLI's evidence root stays fixed, never configured from untrusted arguments.
const cliFixture=dir=>{
  const cwd=path.join(dir,'synthetic-checkout');
  const evidence=path.join(cwd,'.floodguard-private-evidence');
  fs.mkdirSync(evidence,{recursive:true,mode:0o700});
  fs.mkdirSync(path.join(cwd,'docs/firebase'),{recursive:true});
  const scripts=path.join(cwd,'scripts');
  fs.mkdirSync(scripts,{recursive:true});
  for(const name of [
    'r3-effective-rules-export-review.mjs',
    'r3-real-authority-preflight.mjs',
    'r3-private-json-evidence-core.mjs'
  ]) fs.copyFileSync(path.join(root,'scripts',name),path.join(scripts,name));
  const script=path.join(scripts,'r3-effective-rules-export-review.mjs');
  fs.writeFileSync(path.join(cwd,'firebase.rules.json'),JSON.stringify(source));
  fs.writeFileSync(path.join(cwd,'docs/firebase/R3_REAL_AUTHORITY_PREFLIGHT_20261102.json'),
    JSON.stringify(manifest));
  return {cwd,evidence,script};
};

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
  const {cwd,evidence,script}=cliFixture(dir);
  const location=path.join(evidence,'rules-export.json');
  privateWrite(location,JSON.stringify(source));
  const r=inspectExportFromFile(location,{...options,privateEvidenceDirectory:path.dirname(location)});
  assert.equal(r.repoCandidateMatchesExport,true);
  noGo(r);
  const p=run(location,{cwd,script});
  assert.equal(p.status,0,p.stderr);
  assert.equal(p.stderr,'');
  const result=JSON.parse(p.stdout);
  assert.equal(result.effectiveFirebaseRulesVerified,false);
  assert.equal(result.releaseDecision,'NO_GO');
  assert.doesNotMatch(p.stdout, /floodguard\/live|rules-export|private|access_token|\.read/);

  privateWrite(location,'{invalid-json "auth=DO_NOT_LEAK"');
  const invalid=run(location,{cwd,script});
  assert.equal(invalid.status,2);
  assert.doesNotMatch(invalid.stdout,/DO_NOT_LEAK/);
  privateWrite(location,'X'.repeat(128*1024+1));
  const huge=run(location,{cwd,script});
  assert.equal(huge.status,2);
  assert.equal(JSON.parse(huge.stdout).repoCandidateMatchesExport,false);

  const link=path.join(evidence,'link.json');
  fs.symlinkSync(candidateFile,link);
  const linked=run(link,{cwd,script});
  assert.equal(linked.status,2,'a symlink to the repo file is forbidden');
  assert.equal(JSON.parse(linked.stdout).repoCandidateMatchesExport,false);
}));
test('a hard link to the repository candidate is not separate operator evidence',()=>tmp(dir=>{
  // Keep both fixture files on the same filesystem to exercise inode aliasing
  // without writing to the repository or assuming /tmp shares its mount.
  const candidate=path.join(dir,'local-repo-candidate.json');
  const hardlink=path.join(dir,'fake-operator-export.json');
  fs.writeFileSync(candidate,JSON.stringify(source));
  fs.linkSync(candidate,hardlink);
  assert.notEqual(fs.realpathSync(candidate),fs.realpathSync(hardlink));
  assert.equal(fs.statSync(candidate).ino,fs.statSync(hardlink).ino);
  assert.equal(fs.statSync(hardlink).nlink,2);
  const r=inspectExportFromFile(hardlink,{candidateFile:candidate,manifestFile,privateEvidenceDirectory:dir});
  assert.equal(r.reason,'OPERATOR_EXPORT_UNAVAILABLE_OR_MALFORMED');
  assert.equal(r.repoCandidateMatchesExport,false);
  noGo(r);
}));

test('H29 rejects top-level duplicate rules even when JSON.parse would match candidate',()=>tmp(dir=>{
  const location=path.join(dir,'ambiguous-top-level.json');
  const raw='{"rules":{"floodguard":{"live":{".read":true}}},"rules":'+
    JSON.stringify(source.rules)+'}';
  assert.deepEqual(JSON.parse(raw),source,'last duplicate wins in JSON.parse');
  privateWrite(location,raw);
  const r=inspectExportFromFile(location,{...options,privateEvidenceDirectory:path.dirname(location)});
  assert.equal(r.reason,'OPERATOR_EXPORT_UNAVAILABLE_OR_MALFORMED');
  assert.equal(r.repoCandidateMatchesExport,false);
  noGo(r);
  const cli=run(location);
  assert.equal(cli.status,2);
  assert.equal(cli.stderr,'');
  assert.doesNotMatch(cli.stdout,/live|rules|ambiguous-top-level|\.read/);
}));

test('H29 rejects duplicate nested permission keys that would disappear on parsing',()=>tmp(dir=>{
  const location=path.join(dir,'ambiguous-nested.json');
  const normal=JSON.stringify(source);
  const raw=normal.replace('".read":false','".read":true,".read":false');
  assert.notEqual(raw,normal);
  assert.deepEqual(JSON.parse(raw),source);
  privateWrite(location,raw);
  const r=inspectExportFromFile(location,{...options,privateEvidenceDirectory:path.dirname(location)});
  assert.equal(r.reason,'OPERATOR_EXPORT_UNAVAILABLE_OR_MALFORMED');
  noGo(r);
}));

test('H29 decodes escaped property names when checking duplicates',()=>tmp(dir=>{
  const location=path.join(dir,'unicode-alias.json');
  const normal=JSON.stringify(source);
  // The JSON property name "\u002eread" is decoded as ".read"; treating
  // raw spellings as different keys would incorrectly accept this snapshot.
  const raw=normal.replace('".read":false',String.raw`".read":true,"\u002eread":false`);
  assert.notEqual(raw,normal);
  assert.deepEqual(JSON.parse(raw),source);
  privateWrite(location,raw);
  const r=inspectExportFromFile(location,{...options,privateEvidenceDirectory:path.dirname(location)});
  assert.equal(r.repoCandidateMatchesExport,false);
  assert.equal(r.reason,'OPERATOR_EXPORT_UNAVAILABLE_OR_MALFORMED');
  noGo(r);
}));

test('H29 rejects duplicate nested ESP node even when last value is restrictive',()=>tmp(dir=>{
  const location=path.join(dir,'ambiguous-esp.json');
  const normal=JSON.stringify(source);
  const raw=normal.replace('"esp8266":',
    '"esp8266":{"ip":{".read":true}},"esp8266":');
  assert.notEqual(raw,normal);
  assert.deepEqual(JSON.parse(raw),source);
  privateWrite(location,raw);
  const r=inspectExportFromFile(location,{...options,privateEvidenceDirectory:path.dirname(location)});
  assert.equal(r.repoCandidateMatchesExport,false);
  assert.equal(r.reason,'OPERATOR_EXPORT_UNAVAILABLE_OR_MALFORMED');
  noGo(r);
}));

test('H29 permits repeated property names in independent JSON object scopes',()=>tmp(dir=>{
  const location=path.join(dir,'distinct-sibling-permissions.json');
  privateWrite(location,JSON.stringify(source));
  const r=inspectExportFromFile(location,{...options,privateEvidenceDirectory:path.dirname(location)});
  assert.equal(r.repoCandidateMatchesExport,true);
  assert.equal(r.reason,'MATCHES_REPO_CANDIDATE_BUT_CLOUD_PROVENANCE_UNVERIFIED');
  noGo(r);
}));


test('H30 refuses Rules snapshots copied to a tracked checkout path or unrelated /tmp',()=>tmp(dir=>{
  const {cwd,evidence,script}=cliFixture(dir);
  const tracked=path.join(cwd,'operator-rules-export.json');
  fs.writeFileSync(tracked,JSON.stringify(source));
  const report=run(tracked,{cwd,script});
  assert.equal(report.status,2);
  assert.equal(report.stderr,'');
  assert.equal(JSON.parse(report.stdout).reason,'OPERATOR_EXPORT_OUTSIDE_PRIVATE_DIRECTORY');
  const checked=inspectExportFromFile(tracked,{...options,privateEvidenceDirectory:evidence});
  assert.equal(checked.reason,'OPERATOR_EXPORT_OUTSIDE_PRIVATE_DIRECTORY');
  noGo(checked);

  const another=path.join(dir,'outside-snapshot.json');
  fs.writeFileSync(another,JSON.stringify(source));
  const denied=run(another,{cwd,script});
  assert.equal(denied.status,2);
  assert.equal(JSON.parse(denied.stdout).operatorExportProvided,false);
  assert.doesNotMatch(denied.stdout,/operator-rules-export|outside-snapshot|\.read|floodguard\/live/);
}));

test('H30 accepts only a directly contained private child, never a nested or ../ escaped file',()=>tmp(dir=>{
  const {cwd,evidence,script}=cliFixture(dir);
  const nested=path.join(evidence,'sub');
  fs.mkdirSync(nested);
  const nestedFile=path.join(nested,'snapshot.json');
  fs.writeFileSync(nestedFile,JSON.stringify(source));
  const denied=run(nestedFile,{cwd,script});
  assert.equal(denied.status,2);
  assert.equal(JSON.parse(denied.stdout).reason,'OPERATOR_EXPORT_OUTSIDE_PRIVATE_DIRECTORY');

  const valid=path.join(evidence,'operator-snapshot.json');
  privateWrite(valid,JSON.stringify(source));
  const ok=run(valid,{cwd,script});
  assert.equal(ok.status,0,ok.stderr);
  const outcome=JSON.parse(ok.stdout);
  assert.equal(outcome.repoCandidateMatchesExport,true);
  assert.equal(outcome.effectiveFirebaseRulesVerified,false);
  assert.equal(outcome.releaseDecision,'NO_GO');
  assert.equal(outcome.mayDeploy,false);
  assert.equal(outcome.maySendAlert,false);
}));

test('H30 rejects symlinked private evidence root and symlinked evidence files',()=>tmp(dir=>{
  const {cwd,evidence,script}=cliFixture(dir);
  const alternate=path.join(cwd,'untrusted-alias');
  fs.renameSync(evidence,alternate);
  fs.symlinkSync(alternate,evidence,'dir');
  const fromAlias=path.join(evidence,'operator.json');
  fs.writeFileSync(path.join(alternate,'operator.json'),JSON.stringify(source));
  const denied=run(fromAlias,{cwd,script});
  assert.equal(denied.status,2);
  assert.equal(JSON.parse(denied.stdout).reason,'OPERATOR_EXPORT_OUTSIDE_PRIVATE_DIRECTORY');
  fs.unlinkSync(evidence);
  fs.renameSync(alternate,evidence);

  const outside=path.join(cwd,'outside.json');
  fs.writeFileSync(outside,JSON.stringify(source));
  const alias=path.join(evidence,'external-symlink.json');
  fs.symlinkSync(outside,alias);
  const deniedLink=run(alias,{cwd,script});
  assert.equal(deniedLink.status,2);
  assert.equal(deniedLink.stderr,'');
  assert.equal(JSON.parse(deniedLink.stdout).repoCandidateMatchesExport,false);
}));

test('H30 original source candidate and private hardlinks still fail with fixed redacted NO-GO',()=>tmp(dir=>{
  const {cwd,evidence,script}=cliFixture(dir);
  const candidate=path.join(cwd,'firebase.rules.json');
  const same=run(candidate,{cwd,script});
  assert.equal(same.status,2);
  assert.equal(JSON.parse(same.stdout).reason,'REPO_CANDIDATE_IS_NOT_OPERATOR_EXPORT');
  const hard=path.join(evidence,'hardlink-to-candidate.json');
  fs.linkSync(candidate,hard);
  const denied=run(hard,{cwd,script});
  assert.equal(denied.status,2);
  assert.equal(JSON.parse(denied.stdout).repoCandidateMatchesExport,false);
  assert.doesNotMatch(denied.stdout,/hardlink-to-candidate|firebase.rules.json|\.read/);
}));

test('CLI without export fails closed without opening a cloud connection',()=>{
  const proc=spawnSync(process.execPath,[
    path.join(root,'scripts/r3-effective-rules-export-review.mjs')
  ],{cwd:root,encoding:'utf8',timeout:3000});
  assert.equal(proc.status,2);
  const response=JSON.parse(proc.stdout);
  assert.equal(response.releaseDecision,'NO_GO');
  assert.equal(response.operatorExportProvided,false);
  assert.equal(response.repoCandidateMatchesExport,false);
  assert.equal(response.effectiveFirebaseRulesVerified,false);
  assert.equal(response.mayDeploy,false);
});


test('H33 Rules CLI ignores a different CWD candidate and uses its own checkout',()=>tmp(dir=>{
  const {cwd,evidence,script}=cliFixture(dir);
  const foreign=path.join(dir,'untrusted-cwd');
  fs.mkdirSync(path.join(foreign,'docs/firebase'),{recursive:true});
  const incompatible=copy(source);
  incompatible.rules.floodguard.live.water['.read']=false;
  fs.writeFileSync(path.join(foreign,'firebase.rules.json'),JSON.stringify(incompatible));
  fs.writeFileSync(path.join(foreign,'docs/firebase/R3_REAL_AUTHORITY_PREFLIGHT_20261102.json'),
    JSON.stringify(manifest));

  const operator=path.join(evidence,'original.json');
  privateWrite(operator,JSON.stringify(source));
  const original=run(operator,{cwd:foreign,script});
  assert.equal(original.status,0,original.stderr);
  const report=JSON.parse(original.stdout);
  assert.equal(report.reason,'MATCHES_REPO_CANDIDATE_BUT_CLOUD_PROVENANCE_UNVERIFIED');
  assert.equal(report.repoCandidateMatchesExport,true);
  assert.equal(report.releaseDecision,'NO_GO');
  assert.equal(report.mayDeploy,false);

  // The foreign checkout includes the exact value an attacker would wish
  // matched. It must not become this script's reviewed baseline.
  const compatibleChanged=copy(source);
  compatibleChanged.rules.floodguard.live.water['.indexOn']=['ts'];
  fs.writeFileSync(path.join(foreign,'firebase.rules.json'),
    JSON.stringify(compatibleChanged));
  privateWrite(operator,JSON.stringify(compatibleChanged));
  const rejected=run(operator,{cwd:foreign,script});
  assert.equal(rejected.status,2);
  const denied=JSON.parse(rejected.stdout);
  assert.equal(denied.reason,'OPERATOR_EXPORT_DIFFERS_FROM_REPO_CANDIDATE');
  assert.equal(denied.repoCandidateMatchesExport,false);
  assert.equal(denied.releaseDecision,'NO_GO');
  assert.doesNotMatch(rejected.stdout,/untrusted-cwd|original.json|\.read|\.indexOn/);
}));
