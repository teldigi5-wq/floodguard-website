// Synthetic-only tests: no user firmware or credentials are included in CI.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, writeFileSync, symlinkSync, rmSync, readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {
  assessPrivateFirmwareSource, privateFirmwareAudit,
} from '../scripts/r3-private-firmware-ingress-preflight.mjs';

const scriptPath=fileURLToPath(
  new URL('../scripts/r3-private-firmware-ingress-preflight.mjs', import.meta.url));
const snippet=[
  '#include <WiFiClientSecure.h>',
  'void sendTelemetry() {',
  '  WiFiClientSecure client;',
  '  client.setInsecure();',
  '  HTTPClient http;',
  '  String route = "/floodguard/live.json";',
  '  http.PATCH("{}");',
  '}',
].join('\n');
test('detect insecure anonymous root REST writer with no release approval',()=>{
  const x=assessPrivateFirmwareSource(snippet);
  assert.equal(x.insecureTLS,true);
  assert.equal(x.directRestWriteIndicator,true);
  assert.equal(x.livePathIndicator,true);
  assert.equal(x.restAuthIndicator,false);
  assert.equal(x.hasTLSValidationIndicator,false);
  assert.equal(x.firmwareFlashedVerified,false);
  assert.equal(x.authenticatedWriteVerified,false);
  assert.equal(x.physicalSensorVerified,false);
  assert.equal(x.releaseDecision,'NO_GO');
});
test('presence of certificate/auth indicators is not security attestation',()=>{
  const x=assessPrivateFirmwareSource(
    'client.setTrustAnchors(&ca); http.addHeader("Authorization", "Bearer token"); http.PUT("{}");');
  assert.equal(x.hasTLSValidationIndicator,true);
  assert.equal(x.directRestWriteIndicator,true);
  assert.equal(x.releaseDecision,'NO_GO');
  assert.equal(x.authenticatedWriteVerified,false);
});
test('a sketch with no identified write method is NOT falsely accepted',()=>{
  const x=assessPrivateFirmwareSource('void setup(){} void loop(){}');
  assert.equal(x.directRestWriteIndicator,false);
  assert.equal(x.releaseDecision,'NO_GO');
  assert.equal(x.firmwareFlashedVerified,false);
});
test('CLI redacts input content, absolute path and embedded marker',()=>{
  const root=mkdtempSync(join(tmpdir(),'floodguard-offline-preflight-'));
  try {
    const path=join(root,'private-sketch.ino');
    const secret='SYNTHETIC_DO_NOT_PRINT_6A9F';
    writeFileSync(path, snippet+'\n// '+secret, {mode:0o600});
    const run=spawnSync(process.execPath,[scriptPath,path],{encoding:'utf8',timeout:5000});
    assert.equal(run.status,2,'static review must never count as production approval');
    assert.match(run.stdout,/insecureTLS=YES/);
    assert.match(run.stdout,/releaseDecision=NO_GO/);
    assert.doesNotMatch(run.stdout+run.stderr,/SYNTHETIC_DO_NOT_PRINT_6A9F/);
    assert.equal((run.stdout+run.stderr).includes(path),false);
  } finally {rmSync(root,{recursive:true,force:true});}
});
test('CLI refuses symlink and oversized source without printing their contents',()=>{
  const root=mkdtempSync(join(tmpdir(),'floodguard-reject-'));
  try {
    const target=join(root,'real.ino');
    const link=join(root,'linked.ino');
    const oversized=join(root,'large.ino');
    writeFileSync(target,snippet,{mode:0o600});
    symlinkSync(target,link);
    writeFileSync(oversized,'X'.repeat(512*1024+1),{mode:0o600});
    assert.throws(()=>privateFirmwareAudit(link),/audit_refused/);
    assert.throws(()=>privateFirmwareAudit(oversized),/audit_refused/);
  } finally {rmSync(root,{recursive:true,force:true});}
});
test('preflight tool itself has no networking, uploads, Firebase writes or device controls',()=>{
  const code=readFileSync(scriptPath,'utf8');
  assert.doesNotMatch(code,/\bfetch\s*\(|http\.request\s*\(|https\.request\s*\(|Serial\.write\s*\(/);
  assert.doesNotMatch(code,/\bwriteFileSync\s*\(|\bexecSync\s*\(|\bspawnSync\s*\(/);
  assert.match(code,/releaseDecision: 'NO_GO'/);
});
