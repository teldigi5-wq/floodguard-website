import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {test} from 'node:test';

const load=p=>JSON.parse(readFileSync(p,'utf8'));
const source=load('docs/firebase/phase-b-authenticated-prototype.rules.json');
const strict=load('docs/firebase/phase-b-strict-readonly-live.rules.json');
const fields=[
  ['water','distanceCm'],['water','levelCm'],['water','status'],
  ['gate','status'],['gate','angle'],['esp8266','status']
];

test('strict candidate differs only by removing all six independent public telemetry leaf writes',()=>{
  const expected=structuredClone(source);
  for(const [branch,leaf] of fields){
    assert.equal(typeof expected.rules.floodguard.live[branch][leaf]['.write'],'string');
    delete expected.rules.floodguard.live[branch][leaf]['.write'];
  }
  assert.deepEqual(strict,expected,'unreviewed rule changes must be separately approved');
});

test('no descendant under public live has a write grant',()=>{
  const visit=(node,where)=>{
    if(node===null||typeof node!=='object')return;
    for(const [name,value] of Object.entries(node)){
      if(name==='.write'){
        assert.equal(value,false,'unexpected live client write at '+where);
      }else visit(value,where+'/'+name);
    }
  };
  visit(strict.rules.floodguard.live,'/floodguard/live');
  assert.equal(strict.rules['.write'],false);
  assert.equal(strict.rules.floodguard['.write'],undefined);
  assert.equal(strict.rules.floodguard.live['.write'],false);
});

test('private staging remains claim-bound and does not become a public read or write path',()=>{
  const root=strict.rules.floodguard;
  const lane=root.staging.ingestV1.$deviceId;
  assert.equal(root.staging['.read'],false);
  assert.equal(root.staging['.write'],false);
  assert.equal(root.staging.ingestV1['.read'],false);
  assert.equal(root.staging.ingestV1['.write'],false);
  assert.equal(lane['.read'],false);
  assert.match(lane['.write'],/auth.uid === \$deviceId/);
  assert.match(lane['.write'],/fg_ingest_v1 === true/);
  assert.match(lane['.write'],/prototype-ingest-v1/);
  assert.match(lane['.write'],/sequence.*data.child\('sequence'\)/);
  assert.equal(root.deviceAuthorization['.read'],false);
  assert.equal(root.deviceAuthorization['.write'],false);
});

test('strict candidate is isolated from deployed Firebase Rules and uses local emulator config',()=>{
  assert.equal(load('firebase.phase-b-strict.json').database.rules,
    'docs/firebase/phase-b-strict-readonly-live.rules.json');
  const original=readFileSync('firebase.rules.json','utf8');
  assert.doesNotMatch(original,/prototype-ingest-v1|fg_ingest_v1/);
  const workflow=readFileSync('.github/workflows/firebase-phase-b-prototype.yml','utf8');
  assert.match(workflow,/FG_PHASE_B_STRICT_TEST=1/);
  assert.match(workflow,/firebase\.phase-b-strict\.json/);
  assert.match(workflow,/phase-b-strict-emulator\.mjs/);
});
