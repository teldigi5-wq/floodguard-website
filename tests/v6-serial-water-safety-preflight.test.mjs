import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {inspectLegacyFgSerialLab} from '../experiments/v6-serial-water-safety-preflight.mjs';

const xor=s=>[...Buffer.from(s,'ascii')].reduce((a,b)=>a^b,0)
  .toString(16).toUpperCase().padStart(2,'0');
const fg=(sequence=1,distance='16.50',status='WARNING',opts={})=>{
  const {buzzer=0,gate='CLOSED',angle=0,countdown=0,rtc=1}=opts;
  const body=['FG',sequence,distance,status,buzzer,gate,angle,countdown,rtc].join(',');
  return body+','+xor(body)+'\r\n';
};
test('exact v6 Arduino FG checksum and decimals parse as untrusted candidate, not signed/cloud data',()=>{
  const r=inspectLegacyFgSerialLab({line:fg()});
  assert.equal(r.eligible,true,JSON.stringify(r));
  assert.deepEqual(r.candidate,{
    sequence:1,distanceCm:16.5,levelCm:8.5,risk:'WARNING'
  });
  assert.equal(r.authenticated,false);
  assert.equal(r.canPublish,false);
  assert.equal(r.canAcknowledge,false);
  assert.equal(r.floodClearance,'UNKNOWN');
  assert.equal(r.gatePositionVerified,false);
});
test('real v6 thresholds accepted at boundaries without reclassification',()=>{
  for(const [distance,risk] of [
    ['25.00','SAFE'],['16.51','SAFE'],['16.50','WARNING'],
    ['14.01','WARNING'],['14.00','DANGER'],['2.00','DANGER']
  ]){
    const result=inspectLegacyFgSerialLab({line:fg(1,distance,risk)});
    assert.equal(result.eligible,true,distance+' '+risk+' '+JSON.stringify(result));
  }
});
test('out-of-range ultrasonic distance cannot be clamped to SAFE',()=>{
  for(const distance of ['25.01','26.00','100.00','400.00']){
    const v=inspectLegacyFgSerialLab({line:fg(1,distance,'SAFE')});
    assert.equal(v.eligible,false);
    assert.equal(v.reason,'distance-outside-calibrated-depth-unknown-not-safe');
    assert.equal(v.floodClearance,'UNKNOWN');
  }
});
test('reported SAFE conflicting with a danger reading is never forwarded',()=>{
  const r=inspectLegacyFgSerialLab({line:fg(1,'13.00','SAFE')});
  assert.equal(r.eligible,false);
  assert.equal(r.reason,'conflicting-risk-and-water-level');
});
test('sensor error remains a visible fault but cannot be a numeric safe-water event',()=>{
  const r=inspectLegacyFgSerialLab({line:fg(1,'-1.00','SENSOR_ERROR')});
  assert.equal(r.eligible,false);
  assert.equal(r.fault,'SENSOR_ERROR');
  assert.equal(r.canPublish,false);
  assert.equal(r.floodClearance,'UNKNOWN');
  assert.equal(r.reason,'sensor-error-requires-local-failsafe-review');
});
test('real serial XOR detects corruption but is not device authentication',()=>{
  const valid=fg();
  const corrupt=valid.replace('16.50','16.49');
  assert.equal(inspectLegacyFgSerialLab({line:corrupt}).reason,'xor-checksum-mismatch');
  // XOR is trivial to recalculate. The parser NEVER grants signed identity.
  const forged=fg(8,'14.00','DANGER',{gate:'OPEN',angle:90,buzzer:1});
  const v=inspectLegacyFgSerialLab({line:forged});
  assert.equal(v.eligible,true);
  assert.equal(v.authenticated,false);
  assert.equal(v.canPublish,false);
});
test('duplicate, rollback and unsigned sequence overflow denied',()=>{
  assert.equal(inspectLegacyFgSerialLab({line:fg(1),priorSequence:1}).eligible,false);
  assert.equal(inspectLegacyFgSerialLab({line:fg(2),priorSequence:3}).eligible,false);
  assert.equal(inspectLegacyFgSerialLab({line:fg(0)}).eligible,false);
  assert.equal(inspectLegacyFgSerialLab({line:fg(2147483648)}).eligible,false);
  assert.equal(inspectLegacyFgSerialLab({line:fg(1),priorSequence:-1}).eligible,false);
});
test('unsafe numeric parsing, NaN and noncanonical packet fields denied',()=>{
  for(const d of ['NaN','1e2','0x11','-2.00','0.00','12.34x','12.345']){
    assert.equal(inspectLegacyFgSerialLab({line:fg(1,d,'DANGER')}).eligible,false,d);
  }
  for(const bad of [
    fg(1).replace('CLOSED','NONSENSE'),
    fg(1).replace(',0,CLOSED',',9,CLOSED'),
    fg(1).replace(',0,0,1,',',999,0,1,'),
    fg(1).replace(',1,',' ,'),
    fg(1)+'EXTRA',
    'RG,1,1,1,1,ONLINE,0,00\r\n'
  ]) assert.equal(inspectLegacyFgSerialLab({line:bad}).eligible,false);
});
test('unexpected gate status, impossible angle or countdown are rejected as untrusted',()=>{
  for(const opts of [
    {gate:'OPEN',angle:0},
    {gate:'CLOSED',angle:90},
    {gate:'COUNTDOWN',countdown:0},
    {gate:'OPENING_WARNING',countdown:0},
    {gate:'CLOSED',countdown:9}
  ]) assert.equal(inspectLegacyFgSerialLab({
    line:fg(1,'16.50','WARNING',opts)
  }).eligible,false,JSON.stringify(opts));
});
test('reject oversized serial lines, embedded control characters and multiple packets',()=>{
  for(const line of [
    'x'.repeat(128),fg(1).replace('\r\n','\nHELLO'),
    fg(1)+'\n'+fg(2),fg(1).replace('FG,','FG,\u0000')
  ])assert.equal(inspectLegacyFgSerialLab({line}).eligible,false);
});
test('fixture and source contain no firmware credentials, insecure TLS or live Firebase publisher',()=>{
  const src=readFileSync('experiments/v6-serial-water-safety-preflight.mjs','utf8');
  for(const s of [
    'setInsecure(', 'FirebaseDatabase', 'WiFiClientSecure',
    'FIREBASE_URL', 'WIFI_PASSWORD', 'WIFI_SSID',
    'serviceAccount', 'HTTPClient', 'servo.write',
    'createServer(', 'https.request(', 'process.env'
  ])assert.equal(src.includes(s),false,s);
});
