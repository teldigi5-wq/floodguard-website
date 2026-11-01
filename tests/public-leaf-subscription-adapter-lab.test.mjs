import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createPublicLeafSubscriptionAdapterLab} from '../experiments/public-leaf-subscription-adapter-lab.mjs';
import {PUBLIC_MONITOR_LAB_LEAF_PATHS} from '../experiments/public-leaf-monitor-lab.mjs';

const PREFIX = '/floodguard/publicTelemetryLabV1/';
function harness() {
  const listeners = new Map();
  const ever = [];
  const reports=[];
  let now=1000;
  let cancelled=0;
  const subscribe=(path,onValue,onError)=>{
    assert.ok(PUBLIC_MONITOR_LAB_LEAF_PATHS.includes(path));
    const observer={path,onValue,onError};
    ever.push(observer);
    listeners.set(path,observer);
    return ()=>{cancelled++;if(listeners.get(path)===observer)listeners.delete(path);};
  };
  const adapter=createPublicLeafSubscriptionAdapterLab({subscribe,clock:()=>now,onUpdate:x=>reports.push(x)});
  return {adapter, reports, ever, listeners,
    read(path,value){listeners.get(PREFIX+path).onValue(value);},
    fail(path,code){listeners.get(PREFIX+path).onError({code, message:'private URL must not leak'});},
    time(n){now=n;},
    get cancelled(){return cancelled;}};
}
test('read-only adapter subscribes to exactly 24 approved primitive leaves',()=>{
  const h=harness();
  assert.deepEqual(h.adapter.start(),{started:true,leafCount:24});
  assert.equal(h.listeners.size,24);
  assert.deepEqual([...h.listeners.keys()].sort(),[...PUBLIC_MONITOR_LAB_LEAF_PATHS].sort());
  assert.equal(h.adapter.current.summary.sourceTrust,'UNVERIFIED');
  assert.throws(()=>h.adapter.start(),/already started/);
  h.adapter.stop();
  assert.equal(h.cancelled,24);
});
test('a reported SAFE and CLOSED never prove gate position or flood clearance',()=>{
  const h=harness();h.adapter.start();
  h.read('water/status','SAFE');
  h.read('gate/status','CLOSED');
  h.read('system/overallRisk','LOW');
  const s=h.adapter.current.summary;
  assert.equal(s.transport,'PARTIAL_UNVERIFIED');
  assert.equal(s.floodClearance,'UNKNOWN');
  assert.equal(s.physicalGatePosition,'UNVERIFIED');
  assert.equal(s.safetyAutomationReady,false);
});
test('permission denial or transport failure evicts previously accepted values',()=>{
  const h=harness();h.adapter.start();
  h.read('water/status','SAFE');
  h.fail('water/status','PERMISSION_DENIED');
  assert.equal(h.adapter.current.state.records[PREFIX+'water/status'],undefined);
  assert.equal(h.adapter.current.state.faults[PREFIX+'water/status'],'PERMISSION_DENIED');
  h.read('rain/status','HEAVY_RAIN');
  h.fail('rain/status','ERR_INTERNAL');
  assert.equal(h.adapter.current.state.records[PREFIX+'rain/status'],undefined);
  assert.equal(h.adapter.current.state.faults[PREFIX+'rain/status'],'TRANSPORT_ERROR');
  assert.doesNotMatch(JSON.stringify(h.reports),/private URL must not leak/);
});
test('a revoked leaf cannot be resurrected by a delayed value callback',()=>{
  const h=harness(); h.adapter.start();
  const old=h.listeners.get(PREFIX+'water/status');
  old.onValue('WARNING');
  old.onError({code:'PERMISSION_DENIED'});
  const count=h.reports.length;
  old.onValue('SAFE');
  old.onError({code:'ERR_LATE'});
  assert.equal(h.reports.length,count);
  assert.equal(h.adapter.current.state.records[PREFIX+'water/status'],undefined);
  assert.equal(h.adapter.current.state.faults[PREFIX+'water/status'],'PERMISSION_DENIED');
  h.adapter.reconnect();
  h.read('water/status','WARNING');
  assert.equal(h.adapter.current.state.records[PREFIX+'water/status'].value,'WARNING');
});
test('invalid object at a readable scalar leaf cannot poison status',()=>{
  const h=harness();h.adapter.start();
  h.read('water/status',{networkPassword:'not real'});
  assert.equal(h.adapter.current.state.faults[PREFIX+'water/status'],'INVALID');
  assert.equal(h.adapter.current.summary.floodClearance,'UNKNOWN');
});
test('cancel and reconnect ignores late callbacks from old generation',()=>{
  const h=harness();h.adapter.start();
  const old=h.listeners.get(PREFIX+'water/status');
  h.read('water/status','DANGER');
  assert.equal(h.adapter.current.summary.lastReportedHazard,'POTENTIAL_HAZARD_NOT_VERIFIED_CLEAR');
  h.adapter.reconnect();
  assert.equal(h.listeners.size,24);
  assert.equal(h.cancelled,24);
  assert.equal(h.adapter.current.state.records[PREFIX+'water/status'],undefined);
  const before=h.reports.length;
  old.onValue('SAFE');
  old.onError({code:'PERMISSION_DENIED'});
  assert.equal(h.reports.length,before);
  h.read('water/status','SAFE');
  assert.equal(h.adapter.current.summary.lastReportedHazard,'POTENTIAL_HAZARD_NOT_VERIFIED_CLEAR');
  h.adapter.stop();
  assert.equal(h.cancelled,48);
  assert.equal(h.adapter.current.summary.transport,'DISCONNECTED');
});
test('one failed listener registration cancels every previously subscribed leaf',()=>{
  const callbacks=[];
  const reports=[];
  let cancels=0;
  const subscribe=(path,ok,fail)=>{
    if(callbacks.length===4)throw Error('simulated setup denial');
    callbacks.push({path,ok,fail});
    return ()=>{cancels++;};
  };
  const a=createPublicLeafSubscriptionAdapterLab({subscribe,clock:()=>1000,onUpdate:s=>reports.push(s)});
  assert.deepEqual(a.start(),{started:false,reason:'SUBSCRIPTION_SETUP_FAILED'});
  assert.equal(cancels,4);
  assert.equal(a.isStarted,false);
  assert.equal(a.current.summary.transport,'DISCONNECTED');
  const before=reports.length;
  callbacks[0].ok('SAFE');
  assert.equal(reports.length,before);
});
test('copy-out state prevents external observer from mutating internal state',()=>{
  const h=harness();h.adapter.start();h.read('water/status','DANGER');
  const copy=h.adapter.current;
  copy.state.records[PREFIX+'water/status'].value='SAFE';
  assert.equal(h.adapter.current.state.records[PREFIX+'water/status'].value,'DANGER');
});
test('browser event times are receipt times; not authenticated sensor timestamps',()=>{
  const h=harness();h.adapter.start();h.read('water/status','WARNING');
  assert.equal(h.adapter.current.summary.sourceTrust,'UNVERIFIED');
  h.time(17001);
  assert.equal(h.adapter.current.summary.transport,'NO_RECENT_LEAVES');
  assert.equal(h.adapter.current.summary.floodClearance,'UNKNOWN');
});
test('lab contains no direct Firebase, network, credential, actuator or publisher APIs',()=>{
  const src=readFileSync('experiments/public-leaf-subscription-adapter-lab.mjs','utf8');
  assert.doesNotMatch(src,/firebase-admin|firebase\/database|fetch\s*\(|\.set\s*\(|\.update\s*\(|\.remove\s*\(|\.listen\s*\(|servo\.write|https?:\/\//);
});
