import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const base='firmware/esp8266_review_diagnostic/';
const sketch=readFileSync(base+'esp8266_review_diagnostic.ino','utf8');
const parser=readFileSync(base+'V6SerialParser.h','utf8');
test('diagnostic firmware explicitly requires opt-in compile-only flag',()=>{
  assert.match(sketch,/#ifndef FG_DIAGNOSTIC_BUILD_ONLY\s*\n#error/);
  for(const flag of ['FG_ENABLE_UPLOAD','FG_ENABLE_FIREBASE','FG_ENABLE_GATE'])
    assert.ok(sketch.includes(flag),flag);
  assert.match(sketch,/WiFi\.mode\(WIFI_OFF\)/);
});
test('diagnostic firmware cannot upload, send insecure requests, provision secrets or actuate a gate',()=>{
  for(const text of [
    'setInsecure(', 'allowSelfSignedCerts(', 'setFingerprint(',
    'WiFi.begin(', 'HTTPClient', '.POST(', '.PATCH(', '.PUT(',
    '.connect(', 'FirebaseDatabase','firebase-admin',
    'WIFI_SSID', 'WIFI_PASSWORD', 'FIREBASE_URL', 'API_KEY',
    'privateKey', 'servo.write(', 'digitalWrite(',
    'BearSSL::PrivateKey', 'setClientRSACert('
  ]) assert.equal(sketch.includes(text),false,'unsafe call or setting: '+text);
});
test('future TLS API gate requires trusted anchor and plausibly synchronized clock',()=>{
  assert.match(sketch,/trustedCa == nullptr/);
  assert.match(sketch,/trustedUtcSeconds < 1700000000/);
  assert.match(sketch,/client\.setTrustAnchors\(trustedCa\)/);
  assert.match(sketch,/client\.setX509Time\(trustedUtcSeconds\)/);
  assert.doesNotMatch(sketch,/configureTlsTrustForFutureReview\s*\([^)]*\)\s*;/);
});
test('same exact header is consumed by sketch and host-side C++ firmware tests',()=>{
  const tests=readFileSync('tests/firmware_v6_esp8266_parser.cpp','utf8');
  assert.match(sketch,/#include "V6SerialParser\.h"/);
  assert.match(tests,/#include "\.\.\/firmware\/esp8266_review_diagnostic\/V6SerialParser\.h"/);
  assert.match(parser,/lastSequence/);
  assert.match(parser,/if \(d100 > 2500\) return rejected\(\)/);
  assert.match(parser,/Result::UntrustedSensorFault/);
});
