// FloodGuard H15: tests for the actual website's presentation boundary.
// Uses synthetic records only; no Firebase, hardware or live gate command.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {describeGateObservation} from '../lib/gate-observation-view.mjs';

const checkNoAuthority=r=>{
  assert.equal(Object.isFrozen(r),true);
  for(const k of ['authenticatedSource','physicalGateVerified','physicalCountdownVerified',
    'physicalDischargeVerified','canDeclareClosed','canOperateGate'])
    assert.equal(r[k],false,k);
};
const view=(status,angle,countdownSeconds=0,freshness='live')=>
  describeGateObservation({gate:{status,angle,countdownSeconds},freshness});

test('contradictory OPEN/zero and CLOSED/90 cannot become confirmed CLOSED',()=>{
  for(const sample of [
    ['OPEN',0],['CLOSED',90],['OPEN',45],['CLOSED',45],
    ['UNKNOWN',0],['OPEN',null],['CLOSED',null]
  ]){
    const x=view(...sample);
    assert.equal(x.state,'UNKNOWN');
    assert.equal(x.angle,null);
    assert.equal(x.lift,null);
    assert.equal(x.countdown,null);
    checkNoAuthority(x);
  }
});
test('coherent recent gate state is only reported, not physical position',()=>{
  for(const [status,angle] of [['OPEN',90],['OPEN',80],['CLOSED',0],['CLOSED',2]]){
    const x=view(status,angle);
    assert.equal(x.state,status);
    assert.match(x.displayLabel,/REPORTED .* UNVERIFIED/);
    assert.equal(x.angle,angle);
    assert.equal(x.lift,Math.round(angle/90*100));
    checkNoAuthority(x);
  }
});
test('a stale, loading or unavailable gate becomes UNKNOWN even if records say CLOSED',()=>{
  for(const freshness of ['stale','loading','unavailable']){
    for(const status of ['CLOSED','OPEN']){
      const x=view(status,status==='OPEN'?90:0,0,freshness);
      assert.equal(x.state,'UNKNOWN');
      assert.equal(x.angle,null);
      assert.equal(x.lift,null);
      assert.equal(x.displayLabel,'CURRENT POSITION UNKNOWN');
      checkNoAuthority(x);
    }
  }
});
test('only a recent coherent COUNTDOWN can be shown as a controller report',()=>{
  const legitimate=view('COUNTDOWN',0,5);
  assert.equal(legitimate.state,'COUNTDOWN');
  assert.equal(legitimate.countdown,5);
  assert.equal(legitimate.recentCountdownReport,true);
  checkNoAuthority(legitimate);
  for(const sample of [
    ['CLOSED',0,5,'live'],['OPEN',90,5,'live'],
    ['COUNTDOWN',0,0,'live'],['COUNTDOWN',0,11,'live'],
    ['COUNTDOWN',0,5,'stale']
  ]){
    const v=view(...sample);
    assert.equal(v.recentCountdownReport,false);
    assert.equal(v.countdown,null);
    checkNoAuthority(v);
  }
});
test('gate visual and markup must not claim verified movement, closure or live physical status',()=>{
  const page=readFileSync('app/gate/page.tsx','utf8');
  const model=readFileSync('components/dam-scene.tsx','utf8');
  assert.match(page,/describeGateObservation/);
  assert.match(page,/SOURCE UNVERIFIED|UNVERIFIED/);
  assert.doesNotMatch(page,/One trusted live state|Center spillway sealed|Gate remains physically closed|No pre-open countdown/);
  assert.doesNotMatch(page,/gateState\s*=\s*"CLOSED"/);
  assert.match(model,/Illustrative model/i);
  assert.match(model,/physical gate position is not verified/i);
  assert.doesNotMatch(model,/>Gates sealed</);
});
