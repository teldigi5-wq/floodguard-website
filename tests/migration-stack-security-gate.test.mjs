// Cross-stack release safety invariants; local-only, no GitHub API or secrets.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync,statSync} from 'node:fs';
import {join} from 'node:path';
const workflows='.github/workflows';
const files=readdirSync(workflows).filter(f=>/\.ya?ml$/.test(f)).sort();
const read=p=>readFileSync(p,'utf8');
const actionPattern=/^\s*(?:-\s*)?uses:\s*([^\s#]+)/gm;
const pinned=/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)?@[a-f0-9]{40}$/;
function sourceFiles(directory){
  const out=[];
  for(const entry of readdirSync(directory)){
    const full=join(directory,entry),stat=statSync(full);
    if(stat.isDirectory())out.push(...sourceFiles(full));
    else if(/\.(?:ts|tsx|js|jsx|mjs)$/.test(entry))out.push(full);
  }
  return out;
}
test('every migration workflow has only immutable SHA-pinned action dependencies',()=>{
  assert.ok(files.length>=16,'Unexpectedly missing workflow gates');
  for(const name of files){
    const text=read(join(workflows,name));
    const refs=[...text.matchAll(actionPattern)].map(m=>m[1]);
    assert.ok(refs.length>=2,name+': missing action dependencies');
    for(const ref of refs)assert.match(ref,pinned,
      name+': mutable or unapproved action ref '+ref);
    assert.match(text,/^permissions:\s*\n\s+contents:\s*read\b/m,
      name+': token must default to read-only');
    if(refs.some(s=>s.startsWith('actions/checkout@')))
      assert.match(text,/persist-credentials:\s*false/,
        name+': checkout credentials must not persist');
    assert.doesNotMatch(text,/\bpull_request_target\s*:/,
      name+': token-bearing workflow must not execute fork code');
    assert.doesNotMatch(text,/^\s*(?:env|with):\s*\{\{.*secrets\./m,
      name+': unreviewed secret pass-through');
  }
});
test('production CI and CodeQL protections from protected main are preserved',()=>{
  const ci=read(join(workflows,'ci.yml'));
  const codeql=read(join(workflows,'codeql.yml'));
  assert.match(ci,/on:\s*\n\s*push:\s*\n\s*branches:\s*\[main\]/);
  assert.match(ci,/pull_request:\s*\n\s*branches:\s*\[main\]/);
  for(const step of ['npm ci','npm run test','npm run lint',
    'npm run typecheck','npm run build'])
    assert.ok(ci.includes(step),'Missing production check: '+step);
  assert.match(ci,/timeout-minutes:\s*20/);
  assert.match(codeql,/security-events:\s*write/);
  assert.match(codeql,/github\/codeql-action\/init@[0-9a-f]{40}/);
  assert.match(codeql,/github\/codeql-action\/analyze@[0-9a-f]{40}/);
  assert.match(codeql,/pull_request:\s*\n\s*branches:\s*\[main\]/);
  assert.match(codeql,/timeout-minutes:\s*45/);
});
test('synthetic R2/R3 signing and witness laboratories are not imported by public app code',()=>{
  for(const directory of ['app','components','providers','lib']){
    for(const path of sourceFiles(directory)){
      const src=read(path);
      assert.doesNotMatch(src,/(?:from\s*['"]|import\s*\(\s*['"]|require\s*\(\s*['"])[^'"]*(?:experiments\/r[23]-|\/r3-v2-fsync-disk-witness-lab)/,
        path+': experimental trust code must not be mounted into public UI');
    }
  }
});
test('production Firebase rules remain an explicit separate approval gate',()=>{
  const roadmap=read('docs/ENGINEERING_ROADMAP.md');
  assert.match(roadmap,/R3-D2b[\s\S]*NOT IMPLEMENTED/);
  assert.match(roadmap,/production NO-GO|production release NO-GO|overall production NO-GO/i);
  assert.ok(files.some(x=>x.includes('r3-v2-fsync-witness')));
});
