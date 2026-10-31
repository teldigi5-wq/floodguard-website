import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {validateFirebaseUrl,checkReadBoundaries,
  ALLOWED_PUBLIC_PATHS,MUST_DENY_PATHS}
from '../scripts/verify-firebase-read-boundaries.mjs';
const origin='https://demo-floodguard-rules.firebaseio.com';
const paths=[...ALLOWED_PUBLIC_PATHS,...MUST_DENY_PATHS];
const pathOf=url=>url.replace(origin+'/','').replace(/\.json$/,'');

test('rejects non-Firebase, insecure, token-bearing, redirected or path-laden origins',()=>{
  assert.equal(validateFirebaseUrl(origin),origin);
  assert.equal(validateFirebaseUrl('https://demo.example.firebasedatabase.app/'),
    'https://demo.example.firebasedatabase.app');
  for(const url of [
    '',null,123,origin+' ',origin+'/floodguard/live',
    origin+'?auth=secret',origin+'/#fragment',origin+':9000',
    'http://demo.firebaseio.com','https://firebaseio.com.evil.test',
    'https://evil.test','https://username:token@demo.firebaseio.com'
  ])assert.throws(()=>validateFirebaseUrl(url));
});

test('only fixed public leaves and denied private/ancestor paths are checked',async()=>{
  const requests=[],cancelled=[];
  const fetcher=async(url,options)=>{
    const p=pathOf(url);
    requests.push({url,options,p});
    assert.equal(options.method,'GET');
    assert.equal(options.redirect,'manual');
    assert.equal(options.credentials,'omit');
    assert.equal(options.cache,'no-store');
    assert.ok(!url.includes('?')&&!url.includes('auth='));
    return {status:ALLOWED_PUBLIC_PATHS.includes(p)?200:401,
      body:{cancel:async()=>cancelled.push(p)}};
  };
  const report=await checkReadBoundaries({databaseUrl:origin,fetcher});
  assert.equal(report.passed,true);
  assert.equal(report.results.length,paths.length);
  assert.equal(cancelled.length,paths.length);
  assert.deepEqual(new Set(requests.map(x=>x.p)),new Set(paths));
  assert.equal(report.results.some(x=>x.path==='(database root)'&&x.success),true);
});

test('unexpected anonymous read of private ESP field is detected, not printed',async()=>{
  const report=await checkReadBoundaries({
    databaseUrl:origin,
    fetcher:async()=>({status:200,body:{cancel:async()=>{}}})
  });
  assert.equal(report.passed,false);
  const exposed=report.results.find(x=>x.path.endsWith('/esp8266/ip'));
  assert.deepEqual([exposed.status,exposed.success],[200,false]);
  assert.doesNotMatch(JSON.stringify(report),/192\.168|password|secret-value/);
});

test('network errors, aborted requests, redirects and status 404 fail closed',async()=>{
  for(const response of [
    ()=>{throw Error('network failed');},
    async()=>({status:302}),
    async()=>({status:404})
  ]){
    const report=await checkReadBoundaries({
      databaseUrl:origin,fetcher:response
    });
    assert.equal(report.passed,false);
    assert.ok(report.results.some(row=>!row.success));
  }
});

test('invalid audit options cannot disable timeout or introduce arbitrary paths',async()=>{
  for(const timeoutMs of [0,-1,1,50,30001,1.2,Infinity]){
    await assert.rejects(checkReadBoundaries({
      databaseUrl:origin,fetcher:async()=>({status:200}),timeoutMs
    }));
  }
  const src=readFileSync('scripts/verify-firebase-read-boundaries.mjs','utf8');
  assert.doesNotMatch(src,/\.json\s*\(|\.text\s*\(|method:\s*'PUT'|method:\s*'POST'|method:\s*'PATCH'|method:\s*'DELETE'/);
  assert.doesNotMatch(src,/firebase-admin|serviceAccount|set\s*\(|update\s*\(|remove\s*\(/);
  assert.match(src,/credentials:'omit'/);
  assert.match(src,/redirect:'manual'/);
});
