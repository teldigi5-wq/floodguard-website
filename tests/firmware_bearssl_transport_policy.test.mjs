import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const base='firmware/esp8266_review_diagnostic/';
const sketch=readFileSync(base+'esp8266_review_diagnostic.ino','utf8');
const tls=readFileSync(base+'SecureIngressTransport.h','utf8');
const receipt=readFileSync(base+'LocalAdmissionReceipt.h','utf8');

test('real ESP8266 diagnostic sketch compiles the new BearSSL request code without invoking it',()=>{
  assert.match(sketch,/#include "SecureIngressTransport.h"/);
  assert.match(sketch,/WiFi\.mode\(WIFI_OFF\)/);
  assert.match(sketch,/#ifndef FG_DIAGNOSTIC_BUILD_ONLY/);
  assert.match(sketch,/static_assert\(sizeof\(floodguard_transport_review::Endpoint\)/);
  // There is no call from setup/loop, only the diagnostic serial reader.
  const active=sketch.slice(sketch.indexOf('void setup()'));
  assert.doesNotMatch(active,/submitPreparedFrame\s*\(/);
  assert.doesNotMatch(active,/WiFi\.begin\s*\(/);
  assert.doesNotMatch(active,/\.connect\s*\(/);
});

test('TLS request requires an injected CA, stable UTC and DNS hostname, never trust all',()=>{
  assert.match(tls,/endpoint\.trustedCa == nullptr/);
  assert.match(tls,/endpoint\.trustedUtc < static_cast<time_t>\(1700000000\)/);
  assert.match(tls,/client\.setTrustAnchors\(endpoint\.trustedCa\)/);
  assert.match(tls,/client\.setX509Time\(endpoint\.trustedUtc\)/);
  assert.match(tls,/client\.connect\(endpoint\.hostname, endpoint\.port\)/);
  assert.match(tls,/validHostname\(endpoint\.hostname\)/);
  assert.match(tls,/client\.setTimeout\(kTimeoutMs\)/);
  assert.match(tls,/#include "LocalAdmissionReceipt.h"/);
});

test('one bounded immutable signed frame is posted to scoped local-only route',()=>{
  assert.match(tls,/kMaxRequest = 1024/);
  assert.match(tls,/kMaxBody = 160/);
  assert.match(tls,/kTimeoutMs = 2500UL/);
  assert.match(tls,/kPath\[\] = "\/synthetic\/v1\/ingest"/);
  assert.match(tls,/Content-Length: /);
  assert.match(tls,/prepared\(frame\)/);
  assert.match(tls,/strnlen\(frame\.signedJson, kMaxRequest \+ 1\)/);
  assert.match(tls,/casePrefix\(line, "Content-Length: "\)/);
  assert.match(tls,/casePrefix\(line, "Content-Type: application\/json"\)/);
  assert.doesNotMatch(tls,/\.flush\s*\(\s*\);.*\.clear\s*\(/s);
});

test('never embeds Wifi credentials, TLS bypass, cloud proof or actuator actions',()=>{
  for(const [file,source] of [['sketch',sketch],['tls',tls],['receipt',receipt]]){
    for(const unsafe of ['setInsecure(', 'allowSelfSignedCerts(', 'setFingerprint(',
      'WiFi.begin(', 'FIREBASE_URL', 'WIFI_PASSWORD', 'WIFI_SSID',
      'serviceAccount', 'FirebaseDatabase','firebase-admin','servo.write(',
      'digitalWrite(', 'sendMessage(', 'process.env','acknowledge(']){
      assert.equal(source.includes(unsafe),false,file+': '+unsafe);
    }
  }
  assert.match(receipt,/cloudConfirmed/);
  assert.match(receipt,/canAcknowledge/);
  assert.match(receipt,/LocalAdmissionOnly/);
  assert.match(receipt,/UnverifiedResponse/);
});
