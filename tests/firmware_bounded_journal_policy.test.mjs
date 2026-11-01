import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const dir='firmware/esp8266_review_diagnostic/';
const sketch=readFileSync(dir+'esp8266_review_diagnostic.ino','utf8');
const journal=readFileSync(dir+'BoundedFrameJournal.h','utf8');
const adapter=readFileSync(dir+'EightSlotLittleFsAdapter.h','utf8');
const health=readFileSync(dir+'JournalMountHealth.h','utf8');
const codec=readFileSync(dir+'RetainedFrameCodec.h','utf8');

test('NodeMCU diagnostic compiles bounded outbox, but runs no flash or cloud functions',()=>{
  assert.match(sketch,/#include "EightSlotLittleFsAdapter.h"/);
  assert.match(sketch,/WiFi\.mode\(WIFI_OFF\)/);
  assert.match(sketch,/#ifndef FG_DIAGNOSTIC_BUILD_ONLY/);
  const active=sketch.slice(sketch.indexOf('void setup()'));
  for(const regex of [
    /mountExplicitly\s*\(/,/appendJournal\s*\(/,
    /\.writeNew\s*\(/,/\.read\s*\(/,/LittleFS\.begin\s*\(/,
    /submitPreparedFrame\s*\(/,/WiFi\.begin\s*\(/
  ])assert.doesNotMatch(active,regex);
});

test('strict fixed eight slot layout and monotonic pre/post readback',()=>{
  assert.match(journal,/kJournalSlots = 8/);
  assert.match(journal,/if \(gap\) return snapshot\(JournalResult::CorruptOrGap/);
  assert.match(journal,/restored\.sequence <= latest/);
  assert.match(journal,/sequence <= before\.newestSequence/);
  assert.match(journal,/store\.probe\(before\.count\) != SlotPresence::Missing/);
  assert.match(journal,/if \(!store\.writeNew/);
  assert.match(journal,/const JournalSnapshot after = inspectJournal\(store\)/);
  assert.match(codec,/kMaxRecord = kMaxBody \+ 14/);
  assert.match(codec,/crc32\(/);
  assert.match(adapter,/\bfgq2_7\.bin\b/);
  assert.match(adapter,/\bfgq2_0\.bin\b/);
});

test('no format, removal, compact, ACK or live TLS in any journal module',()=>{
  for(const [name,src] of [['journal',journal],['adapter',adapter]]){
    for(const unsafe of [
      'LittleFS.format(', '.remove(', '.rename(', '.truncate(',
      'acknowledge(', 'cloudConfirmed = true',
      'setInsecure(', 'WiFi.begin(', 'FirebaseDatabase',
      'servo.write(', 'digitalWrite(', 'FIREBASE_URL',
      'WIFI_PASSWORD', 'serviceAccount'
    ])assert.equal(src.includes(unsafe),false,name+': '+unsafe);
  }
  assert.doesNotMatch(adapter,/\.format\s*\(/);
  assert.doesNotMatch(adapter,/\.remove\s*\(/);
});

test('NodeMCU adapter prevents implicit LittleFS auto-format even when mount fails',()=>{
  // ESP8266 core 3.1.2 defaults LittleFSConfig to autoFormat=true.
  // Reject failure to set the no-format configuration before begin().
  assert.match(adapter,/LittleFSConfig\s+config\s*\(\s*false\s*\)/);
  assert.match(adapter,/if\s*\(!LittleFS\.setConfig\(config\)\)\s*\{\s*health_\.finishMount\(false\);\s*return false;/);
  assert.ok(adapter.indexOf('LittleFS.setConfig(config)') < adapter.indexOf('LittleFS.begin()'));
  assert.ok(!adapter.includes('LittleFS.format('));
  assert.ok(!adapter.includes('setAutoFormat(true)'));
});

test('NodeMCU LittleFS adapter refuses ambiguous absence and cannot truncate existing journal data',()=>{
  assert.ok(adapter.includes('LittleFS.exists(path(slot))'));
  assert.ok(adapter.includes('return SlotPresence::Uncertain'));
  assert.ok(adapter.includes('bool writeNew(uint8_t, const uint8_t *,size_t)'));
  assert.ok(adapter.includes('return false;'));
  assert.ok(!adapter.includes('LittleFS.open(path(slot),"w")'));
  assert.ok(!adapter.includes('LittleFS.open(path(slot),"a")'));
  assert.ok(!adapter.includes('LittleFS.format('));
  assert.ok(adapter.includes('NO IMPLEMENTATION'));
  assert.ok(adapter.includes('if (!health_.ready() || !dst'));
  assert.ok(adapter.includes('file.close();'));
});

test('LittleFS storage faults latch quarantine and block all same-instance mount retries',()=>{
  assert.match(adapter,/#include "JournalMountHealth.h"/);
  assert.match(adapter,/JournalMountHealth health_/);
  assert.match(adapter,/if \(!health_\.beginMount\(\)\) return false;/);
  assert.match(adapter,/health_\.finishMount\(mounted\);/);
  assert.match(adapter,/if \(!health_\.ready\(\) \|\| slot >= kJournalSlots\)/);
  assert.match(adapter,/if \(LittleFS\.exists\(path\(slot\)\)\) return SlotPresence::Present;\s*\/\/[^\n]*\n\s*health_\.quarantine\(\);/);
  assert.match(adapter,/if \(!file\) \{ health_\.quarantine\(\); return false; \}/);
  assert.match(adapter,/if \(n != size\) \{ health_\.quarantine\(\); return false; \}/);
  assert.match(health,/bool beginMount\(\)/);
  assert.match(health,/void quarantine\(\)/);
  assert.ok(!/\breset\s*\(/.test(health));
  assert.match(adapter,/bool writeNew\(uint8_t, const uint8_t \*,size_t\)\s*\{\s*return false;/);
});

test('ESP8266 core access boundary must fail closed until a supported exclusive-create extension exists',()=>{
  const negative=readFileSync('tests/firmware_negative_core_abi/firmware_negative_core_abi.ino','utf8');
  assert.match(negative,/#ifndef FG_CORE_ABI_NEGATIVE_TEST/);
  assert.match(negative,/#if defined\(FG_NEGATIVE_GET_IMPL\) == defined\(FG_NEGATIVE_GET_FS\)/);
  assert.match(negative,/LittleFS\.getImpl\(\)/);
  assert.match(negative,/implementation->getFS\(\)/);
  // These internal pointers remain prohibited in production adapter code.
  for(const forbidden of [/\.getImpl\s*\(/,/->getFS\s*\(/,/\blfs_file_open\s*\(/,
                          /LittleFS\.open\s*\([^\n]*"wx"/]){
    assert.doesNotMatch(adapter,forbidden);
  }
  assert.match(adapter,/bool writeNew\(uint8_t, const uint8_t \*,size_t\)\s*\{\s*return false;/);
  const active=sketch.slice(sketch.indexOf('void setup()'));
  for(const forbidden of [/mountExplicitly\s*\(/,/appendJournal\s*\(/,
                          /lfs_file_open\s*\(/,/LittleFS\.begin\s*\(/,
                          /WiFi\.begin\s*\(/])
    assert.doesNotMatch(active,forbidden);
});
