import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const ci=fs.readFileSync('.github/workflows/ci.yml','utf8');
const codeql=fs.readFileSync('.github/workflows/codeql.yml','utf8');
const files=[['CI',ci],['CodeQL',codeql]];

test('H38 both baseline workflows use immutable, 40-hex action revisions',()=>{
  for(const [name,content] of files){
    const uses=content.split('\n').filter(line=>/^\s*-\s*uses:\s*/.test(line));
    assert.ok(uses.length>=2,name+' must have pinned actions');
    for(const line of uses){
      assert.match(line,/uses:\s*[a-zA-Z0-9_.\-/]+@[0-9a-f]{40}\s*(?:#.*)?$/,
        name+' must not use mutable actions tags or branches');
    }
    assert.doesNotMatch(content,/uses:\s*\S+@(?:v\d|main|master|latest)\b/);
  }
});

test('H38 checks out without persisting GitHub credentials',()=>{
  for(const [name,content] of files){
    assert.match(content,/uses:\s*actions\/checkout@[0-9a-f]{40}/,name+' checkout not pinned');
    assert.match(content,/with:\s*\n\s*persist-credentials:\s*false/,
      name+' must not persist checkout credentials');
  }
});

test('H38 baseline workflows target PRs to main and use fixed runners',()=>{
  for(const [name,content] of files){
    assert.match(content,/pull_request:\s*\n\s*branches:\s*\[main\]/,name+' main PR event missing');
    assert.match(content,/push:\s*\n\s*branches:\s*\[main\]/,name+' main push event missing');
    assert.match(content,/runs-on:\s*ubuntu-24\.04/,name+' runner must be fixed');
    assert.doesNotMatch(content,/runs-on:\s*ubuntu-latest/);
    assert.match(content,/timeout-minutes:\s*\d+/);
  }
});

test('H38 CI has explicit minimum repository permissions and build gates',()=>{
  assert.match(ci,/permissions:\s*\n\s*contents:\s*read/);
  assert.match(ci,/name:\s*FloodGuard website checks/);
  for(const cmd of ['npm ci','npm run test','npm run lint','npm run typecheck','npm run build'])
    assert.ok(ci.includes('- run: '+cmd),'Missing CI gate: '+cmd);
  assert.match(ci,/node-version:\s*'22'/);
});

test('H38 CodeQL keeps only necessary security upload permissions',()=>{
  assert.match(codeql,/permissions:\s*\n\s*contents:\s*read\s*\n\s*security-events:\s*write\s*\n\s*actions:\s*read/);
  assert.match(codeql,/languages:\s*javascript-typescript/);
  assert.match(codeql,/schedule:\s*\n\s*-\s*cron:/);
  assert.match(codeql,/github\/codeql-action\/init@[0-9a-f]{40}/);
  assert.match(codeql,/github\/codeql-action\/analyze@[0-9a-f]{40}/);
});

test('H38 source and workflow tests remain review-only and cannot deploy',()=>{
  const workflow=fs.readFileSync('.github/workflows/r3-h38-ci-provenance.yml','utf8');
  assert.match(workflow,/security\/r3-h38-restore-main-ci-hardening-20261105/);
  assert.match(workflow,/security\/r3-h37-firebase-named-app-isolation-20261105/);
  assert.match(workflow,/node --test tests\/r3-h38-ci-provenance\.test\.mjs/);
  assert.doesNotMatch(workflow,/firebase deploy|secrets\.|vercel deploy|--prod|workflow_dispatch/);
});
