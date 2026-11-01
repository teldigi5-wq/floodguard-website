import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const base='firmware/esp8266_review_diagnostic/';
const sketch=readFileSync(base+'esp8266_review_diagnostic.ino','utf8');
const store=readFileSync(base+'OneFrameLittleFsStore.h','utf8');
const codec=readFileSync(base+'RetainedFrameCodec.h','utf8');

test('original diagnostic remains WiFi-disabled and never mounts flash or sends data',()=>{
  assert.match(sketch,/#include "OneFrameLittleFsStore.h"/);
  assert.match(sketch,/WiFi\.mode\(WIFI_OFF\)/);
  assert.match(sketch,/#ifndef FG_DIAGNOSTIC_BUILD_ONLY/);
  const active=sketch.slice(sketch.indexOf('void setup()'));
  for(const dangerous of [/LittleFS\.begin\s*\(/,
    /\.storeOnce\s*\(/,/\.mount\s*\(/,/submitPreparedFrame\s*\(/,
    /\.connect\s*\(/,/WiFi\.begin\s*\(/,/servo\.write\s*\(/])
    assert.doesNotMatch(active,dangerous);
});

test('retained-frame is a non-overwriting, one-event blocked queue by design',()=>{
  assert.match(store,/if \(LittleFS\.exists\(path\(\)\)\) return Status::ExistingUnacknowledged/);
  assert.match(store,/const Status restored = load\(verify\)/);
  assert.match(store,/memcmp\(verify\.signedBody, signedBody, bodyLength\)/);
  assert.match(codec,/kMaxRecord = kMaxBody \+ 14/);
  assert.match(codec,/crc32\(/);
  assert.match(codec,/ExistingUnacknowledged/);
  assert.match(codec,/StorageUncertain/);
  assert.match(codec,/DamagedOrPartial/);
});

test('no formatting, recovery deletion, compaction, secrets, TLS bypass or actuation',()=>{
  for(const [name,source] of [['sketch',sketch],['store',store],['codec',codec]]){
    for(const unsafe of [
      'LittleFS.format(','.remove(','.rename(','.truncate(','.clear(',
      'setInsecure(', 'allowSelfSignedCerts(', 'WIFI_PASSWORD',
      'WIFI_SSID', 'FIREBASE_URL', 'serviceAccount', 'acknowledge(',
      'sendMessage(', 'servo.write(', 'digitalWrite(', 'privateKey'
    ]) assert.equal(source.includes(unsafe),false,name+': '+unsafe);
  }
});

test('ESP8266 writes require explicit mount and never consider damaged file empty',()=>{
  assert.match(store,/if \(!mounted_\) return Status::StorageUncertain/);
  assert.match(store,/if \(count < 14 \|\| count > kMaxRecord\)/);
  assert.match(store,/if \(read != count\) return Status::StorageUncertain/);
  assert.match(store,/return decode\(bytes, count, frame\)/);
  assert.match(store,/if \(LittleFS\.exists\(path\(\)\)\) return Status::ExistingUnacknowledged/);
  assert.doesNotMatch(store,/LittleFS\.format/);
});
