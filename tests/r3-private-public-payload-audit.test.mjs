// Synthetic fixtures only. Never commit live exported JSON, IPs, tokens or Wi-Fi.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync,symlinkSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {auditPrivateExport,auditPrivateFile} from '../scripts/r3-private-public-payload-audit.mjs';

const SCRIPT=fileURLToPath(new URL('../scripts/r3-private-public-payload-audit.mjs',import.meta.url));
const NOW=1700000005000;
const sample=()=>({
  floodguard:{live:{
    water:{distanceCm:15.35,levelCm:9.65,status:'WARNING'},
    rain:{calibrationLimited:true,currentMm:35,dailyMm:35,
      measurementType:'COLLECTOR_ACCUMULATED',rawValue:665.5,
      sensorStatus:'ONLINE',status:'NORMAL',waterDepthCm:1.9},
    gate:{angle:0,countdownSeconds:0,reason:'NONE',status:'CLOSED'},
    alarm:{active:false,type:'DAM_WARNING'},
    devices:{arduino:'ONLINE',gsm:'NOT_INSTALLED',microSD:'NOT_INSTALLED',
      rainGauge:'ONLINE',rtc:'ONLINE',servo:'ONLINE',ultrasonic:'ONLINE'},
    system:{lastUpdate:1690000000000,overallRisk:'MODERATE',waterSensorToBottomCm:25},
    esp8266:{connection:'CONNECTED',rssi:-57,status:'ONLINE',
      ip:'SYNTHETIC_PRIVATE_CANARY_1',wifi:'SYNTHETIC_PRIVATE_CANARY_2'}
  },bot:{secret:'SYNTHETIC_PRIVATE_CANARY_3'}}
});
test('reviewed flat export schema passes but never certifies production',()=>{
  const report=auditPrivateExport(sample(),NOW);
  assert.equal(report.schemaShapePass,true);
  assert.equal(report.publicBranchesInspected,7);
  assert.equal(report.publicScalarFieldsInspected,30);
  assert.equal(report.snapshotRecentAtAuditTime,false);
  assert.deepEqual(report.issueCounts,{unknown:0,missing:0,invalid:0,nested:0});
  assert.equal(report.publicDataPrivacyCertified,false);
  assert.equal(report.liveDataSourceVerified,false);
  assert.equal(report.liveWriteAuthorizationVerified,false);
  assert.equal(report.releaseDecision,'NO_GO');
});
test('historical timestamp may not certify recent physical telemetry',()=>{
  const old=auditPrivateExport(sample(),NOW);
  assert.equal(old.snapshotRecentAtAuditTime,false);
  const sample2=sample();sample2.floodguard.live.system.lastUpdate=NOW-1000;
  const recent=auditPrivateExport(sample2,NOW);
  assert.equal(recent.snapshotRecentAtAuditTime,true);
  assert.equal(recent.liveDataSourceVerified,false);
  assert.equal(recent.releaseDecision,'NO_GO');
});
test('reject added private descendant and unknown scalar in readable branches',()=>{
  const data=sample();
  data.floodguard.live.devices.extraPrivate={token:'DO_NOT_PRINT'};
  data.floodguard.live.system.secret='DO_NOT_PRINT';
  const r=auditPrivateExport(data,NOW);
  assert.equal(r.schemaShapePass,false);
  assert.equal(r.issueCounts.unknown,2);
  assert.equal(r.releaseDecision,'NO_GO');
});
test('reject nested objects inside known public fields',()=>{
  const data=sample();
  data.floodguard.live.devices.arduino={state:'ONLINE',password:'DO_NOT_PRINT'};
  const r=auditPrivateExport(data,NOW);
  assert.equal(r.schemaShapePass,false);
  assert.equal(r.issueCounts.nested,1);
});
test('reject missing core fields and malformed types or overly broad values',()=>{
  const data=sample();
  delete data.floodguard.live.water.levelCm;
  data.floodguard.live.rain.rawValue=1024;
  data.floodguard.live.gate.angle=0.5;
  data.floodguard.live.devices.gsm='WIFI_PASSWORD=DO_NOT_PRINT';
  data.floodguard.live.esp8266.rssi='-57';
  const r=auditPrivateExport(data,NOW);
  assert.equal(r.schemaShapePass,false);
  assert.equal(r.issueCounts.missing,1);
  assert.equal(r.issueCounts.invalid,4);
});
test('output never contains user path, secrets, field names or raw JSON',()=>{
  const dir=mkdtempSync(join(tmpdir(),'floodguard-private-values-'));
  try{
    const path=join(dir,'owner-private.json');
    const value=sample();
    value.floodguard.live.esp8266.wifi='SYNTHETIC_CREDENTIAL_UNPRINTABLE';
    writeFileSync(path,JSON.stringify(value),{mode:0o600});
    const run=spawnSync(process.execPath,[SCRIPT,path],{encoding:'utf8',timeout:5000});
    assert.equal(run.status,0);
    assert.match(run.stdout,/schemaShapePass=true/);
    assert.match(run.stdout,/releaseDecision=NO_GO/);
    assert.doesNotMatch(run.stdout+run.stderr,/SYNTHETIC_CREDENTIAL|owner-private|password|connection:|lastUpdate/);
    assert.equal(run.stderr,'');
    const link=join(dir,'link.json');
    symlinkSync(path,link);
    assert.throws(()=>auditPrivateFile(link,NOW),/audit_refused/);
  }finally{rmSync(dir,{recursive:true,force:true});}
});
test('refuse malformed, oversized and non-JSON input without spilling content',()=>{
  const dir=mkdtempSync(join(tmpdir(),'floodguard-bad-export-'));
  try{
    const malformed=join(dir,'bad.json');
    writeFileSync(malformed,'SUPER_SECRET_NOT_TO_PRINT: {', {mode:0o600});
    const run=spawnSync(process.execPath,[SCRIPT,malformed],{encoding:'utf8',timeout:5000});
    assert.equal(run.status,2);
    assert.equal(run.stdout,'');
    assert.match(run.stderr,/audit_refused/);
    assert.doesNotMatch(run.stderr,/SUPER_SECRET_NOT_TO_PRINT/);
    const big=join(dir,'big.json');
    writeFileSync(big,'X'.repeat(128*1024+1),{mode:0o600});
    assert.throws(()=>auditPrivateFile(big,NOW),/audit_refused/);
  }finally{rmSync(dir,{recursive:true,force:true});}
});
test('private audit implementation itself has no network or write operations',()=>{
  const code=readFileSync(SCRIPT,'utf8');
  assert.doesNotMatch(code,/\bfetch\s*\(|https?\.request\s*\(|\bwriteFile\s*\(|\bexecFile\s*\(|\bspawnSync\s*\(/);
  assert.match(code,/publicDataPrivacyCertified:false/);
  assert.match(code,/releaseDecision:'NO_GO'/);
});
