// H37: actual Firebase SDK app registry tests. No database listeners, reads,
// writes, secrets, credentials, cloud transport, or real project URLs.
import test from 'node:test';
import assert from 'node:assert/strict';
import {initializeApp,getApps,deleteApp} from 'firebase/app';
import {getScopedPublicMonitorApp,PUBLIC_MONITOR_APP_NAME} from '../lib/firebase-app-policy.mjs';

const configured='https://demo-floodguard-r3-default-rtdb.firebasedatabase.app';
const foreign='https://demo-unrelated-r3-default-rtdb.firebasedatabase.app';
const take=databaseURL=>
  getScopedPublicMonitorApp({databaseURL,getApps,initializeApp});

test('H37 never picks an unrelated default app registered before FloodGuard',async()=>{
  const first=initializeApp({databaseURL:foreign},'[DEFAULT]');
  let monitor;
  try{
    monitor=take(configured);
    assert.notEqual(monitor,first);
    assert.equal(monitor.name,PUBLIC_MONITOR_APP_NAME);
    assert.equal(monitor.options.databaseURL,configured);
    assert.equal(first.options.databaseURL,foreign);
    assert.equal(take(configured),monitor);
    assert.equal(getApps().filter(x=>x.name===PUBLIC_MONITOR_APP_NAME).length,1);
  }finally{
    if(monitor)await deleteApp(monitor);
    await deleteApp(first);
  }
});

test('H37 rejects an existing named app bound to a different Firebase tenant',async()=>{
  const poisoned=initializeApp({databaseURL:foreign},PUBLIC_MONITOR_APP_NAME);
  try{
    assert.throws(()=>take(configured),/does not match configured database/);
    assert.equal(poisoned.options.databaseURL,foreign);
    assert.equal(getApps().find(x=>x.name===PUBLIC_MONITOR_APP_NAME),poisoned);
  }finally{await deleteApp(poisoned);}
});

test('H37 rejects additional app options even if a colliding named app has the same URL',async()=>{
  const poisoned=initializeApp({databaseURL:configured,projectId:'demo-unrelated'},
    PUBLIC_MONITOR_APP_NAME);
  try{
    assert.throws(()=>take(configured),/does not match configured database/);
    assert.equal(poisoned.options.databaseURL,configured);
  }finally{await deleteApp(poisoned);}
});

test('H37 refuses missing, malformed or non-HTTPS Firebase database URLs',()=>{
  for(const invalid of [undefined,null,'','http://demo-floodguard-r3-default-rtdb.firebasedatabase.app',
    'https://example.com','https://demo-floodguard-r3-default-rtdb.firebasedatabase.app/private']){
    const before=getApps().length;
    assert.throws(()=>take(invalid),/database URL is invalid/);
    assert.equal(getApps().length,before);
  }
});

test('H37 matching named app is reused only for the exact configured URL',async()=>{
  let app;
  try{
    app=take(configured);
    assert.equal(take(configured),app);
    assert.throws(()=>take(configured+'/'),/does not match configured database/);
  }finally{if(app)await deleteApp(app);}
});

