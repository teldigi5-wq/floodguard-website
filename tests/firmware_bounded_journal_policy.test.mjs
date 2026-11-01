import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const dir='firmware/esp8266_review_diagnostic/';
const sketch=readFileSync(dir+'esp8266_review_diagnostic.ino','utf8');
const journal=readFileSync(dir+'BoundedFrameJournal.h','utf8');
const adapter=readFileSync(dir+'EightSlotLittleFsAdapter.h','utf8');
const health=readFileSync(dir+'JournalMountHealth.h','utf8');
const lifecycle=readFileSync(dir+'ExclusiveCreateLifecycle.h','utf8');
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

test('future exclusive-create lifecycle is local-only and cannot activate a device writer',()=>{
  assert.match(sketch,/#include "ExclusiveCreateLifecycle.h"/);
  assert.match(sketch,/static_assert\(sizeof\(floodguard_retained_review::ExclusiveCreateLifecycle\) > 0/);
  assert.match(lifecycle,/enum class ExclusiveObservation/);
  for(const name of ['Unsupported','ExistingUnacknowledged','StorageFault',
                     'CommitUncertain','LocalBytesMatched'])
    assert.ok(lifecycle.includes(name),name);
  assert.match(lifecycle,/void written\(size_t bytesWritten, bool writeOk\)/);
  assert.match(lifecycle,/void synced\(bool syncOk\)/);
  assert.match(lifecycle,/void closed\(bool closeOk\)/);
  assert.match(lifecycle,/memcmp\(expected_, actual, count_\) != 0/);
  assert.doesNotMatch(lifecycle,/\b(acknowledge|delete|erase|format|upload|firebase|servo)\s*\(/i);
  assert.doesNotMatch(lifecycle,/\b(getImpl|getFS|lfs_file_open|WiFi\.begin|LittleFS\.open)\s*\(/);
  // The only possible device backend remains explicitly disabled.
  assert.match(adapter,/bool writeNew\(uint8_t, const uint8_t \*,size_t\)\s*\{\s*return false;/);
  const active=sketch.slice(sketch.indexOf('void setup()'));
  assert.doesNotMatch(active,/ExclusiveCreateLifecycle|\.opened\s*\(|\.written\s*\(|\.readback\s*\(/);
});

test('core API overlay remains pinned, isolated and never invoked by operational diagnostic',()=>{
  const patch=readFileSync('experiments/esp8266-core-excl-review/patch_core.py','utf8');
  const witness=readFileSync('experiments/esp8266-core-excl-review/compile_only_review/compile_only_review.ino','utf8');
  const workflow=readFileSync('.github/workflows/nodemcu-no-truncation-storage.yml','utf8');
  assert.match(patch,/SOURCE[S]? = \{/);
  for(const path of ['cores/esp8266/FS.h','cores/esp8266/FSImpl.h',
                     'cores/esp8266/FS.cpp','libraries/LittleFS/src/LittleFS.h',
                     'libraries/LittleFS/src/LittleFS.cpp'])
    assert.ok(patch.includes('"'+path+'"'),path);
  assert.match(patch,/lfs_file_open\(/);
  assert.match(patch,/LFS_O_CREAT \| LFS_O_EXCL/);
  assert.match(patch,/opened == LFS_ERR_EXIST/);
  assert.match(patch,/lfs_file_sync/);
  assert.match(patch,/lfs_file_close/);
  assert.match(patch,/lfs_file_read/);
  assert.match(patch,/ExclusiveLocalResult::CommitUncertain/);
  assert.doesNotMatch(patch,/LFS_O_TRUNC|LFS_O_APPEND|LittleFS\.format/);
  assert.match(witness,/#ifndef FG_ISOLATED_CORE_OVERLAY_REVIEW/);
  assert.match(witness,/volatile bool fgNeverCallReviewApi = false/);
  assert.match(workflow,/python3 experiments\/esp8266-core-excl-review\/patch_core\.py "\$CORE"/);
  assert.match(workflow,/PINNED ESP8266 SINGLE_OWNER_CORE_API OVERLAY COMPILES WITHOUT FLASH/);
  assert.doesNotMatch(sketch,/createExclusiveLocal\s*\(/);
  assert.match(adapter,/bool writeNew\(uint8_t, const uint8_t \*,size_t\)\s*\{\s*return false;/);
});

test('core overlay exact-body host fault matrix and sticky error quarantine are mandatory',()=>{
  const patch=readFileSync('experiments/esp8266-core-excl-review/patch_core.py','utf8');
  const generator=readFileSync('experiments/esp8266-core-excl-review/generate_exact_overlay_host.py','utf8');
  const template=readFileSync('tests/firmware_core_overlay_exact_host.template.cpp','utf8');
  const workflow=readFileSync('.github/workflows/nodemcu-no-truncation-storage.yml','utf8');
  assert.match(patch,/if \(_fgExclusiveQuarantined\) return ExclusiveLocalResult::CommitUncertain;/);
  assert.match(patch,/_fgExclusiveQuarantined = true/);
  assert.match(patch,/bool\s+_fgExclusiveQuarantined = false;/);
  assert.match(generator,/runpy\.run_path/);
  assert.match(generator,/\["IMPLEMENTATION"\]/);
  assert.match(generator,/original\.replace\(MARKER, payload\)/);
  assert.match(template,/EXACT_IMPL_FROM_PINNED_OVERLAY/);
  assert.match(template,/case_exact_new_duplicate_and_remount/);
  assert.match(template,/case_write_fault_quarantines_and_blocks_retry/);
  assert.match(template,/case_sync_fault_quarantines/);
  assert.match(template,/case_read_fault_quarantines/);
  assert.match(workflow,/generate_exact_overlay_host\.py/);
  assert.match(workflow,/\/tmp\/fg-core-overlay-exact-host/);
  assert.match(adapter,/bool writeNew\(uint8_t, const uint8_t \*,size_t\)\s*\{\s*return false;/);
  const active=sketch.slice(sketch.indexOf('void setup()'));
  assert.doesNotMatch(active,/createExclusiveLocal\s*\(|mountExplicitly\s*\(/);
});

test('torn program and callback reentry must quarantine the exact core overlay method',()=>{
  const overlay=readFileSync('experiments/esp8266-core-excl-review/patch_core.py','utf8');
  const harness=readFileSync('tests/firmware_core_overlay_exact_host.template.cpp','utf8');
  const flow=readFileSync('.github/workflows/nodemcu-no-truncation-storage.yml','utf8');
  assert.match(overlay,/if \(_fgExclusiveBusy\) \{/);
  assert.match(overlay,/_fgExclusiveQuarantined = true;/);
  assert.match(overlay,/struct BusyRelease \{/);
  assert.match(overlay,/bool\s+_fgExclusiveBusy = false;/);
  assert.match(overlay,/!_fgExclusiveQuarantined\)/);
  assert.match(harness,/torn_prog_once/);
  assert.match(harness,/const lfs_size_t prefix = n\/2/);
  assert.match(harness,/case_torn_metadata_program_quarantines/);
  assert.match(harness,/case_reentrant_writer_refused/);
  assert.match(harness,/assert\(!fs\._fgExclusiveBusy\)/);
  assert.match(flow,/test\/r2-core-overlay-torn-write-reentry-20261101/);
  assert.match(adapter,/bool writeNew\(uint8_t, const uint8_t \*,size_t\)\s*\{\s*return false;/);
  const active=sketch.slice(sketch.indexOf('void setup()'));
  assert.doesNotMatch(active,/createExclusiveLocal\s*\(|LittleFS\.begin\s*\(|WiFi\.begin\s*\(/);
});

test('R2 reboot audit remains read-only and experimental core accepts eight exact slot paths only',()=>{
  const gate=readFileSync(dir+'JournalBootAudit.h','utf8');
  const patch=readFileSync('experiments/esp8266-core-excl-review/patch_core.py','utf8');
  const harness=readFileSync('tests/firmware_core_overlay_exact_host.template.cpp','utf8');
  const flow=readFileSync('.github/workflows/nodemcu-no-truncation-storage.yml','utf8');
  assert.match(sketch,/#include "JournalBootAudit.h"/);
  assert.match(sketch,/static_assert\(sizeof\(floodguard_retained_review::JournalBootAudit\) > 0/);
  assert.match(gate,/const JournalSnapshot verified = inspectJournal\(store\)/);
  assert.match(gate,/BootAuditDisposition::ReadOnlyInventory/);
  assert.match(gate,/BootAuditDisposition::Quarantined/);
  for(const name of ['mayAppend','mayRetire','maySendAcknowledgment','mayReportSafe'])
    assert.match(gate,new RegExp('bool '+name+'\\(\\) const \\{ return false; \\}'));
  for(let i=0;i<8;i++)
    assert.ok(patch.includes('"/fgq2_'+i+'.bin"'));
  assert.match(patch,/if \(!slotAllowed\) return ExclusiveLocalResult::InvalidInput/);
  assert.match(harness,/case_exact_slot_allowlist/);
  assert.match(flow,/tests\/firmware_journal_boot_audit\.cpp/);
  assert.match(adapter,/bool writeNew\(uint8_t, const uint8_t \*,size_t\)\s*\{\s*return false;/);
  const active=sketch.slice(sketch.indexOf('void setup()'));
  assert.doesNotMatch(active,/JournalBootAudit|createExclusiveLocal\s*\(|LittleFS\.begin\s*\(/);
});

test('R2 typed probe may never treat lfs_stat absence as permission to create',()=>{
  const patch=readFileSync('experiments/esp8266-core-excl-review/patch_core.py','utf8');
  const generator=readFileSync('experiments/esp8266-core-excl-review/generate_exact_overlay_host.py','utf8');
  const harness=readFileSync('tests/firmware_core_overlay_exact_host.template.cpp','utf8');
  assert.match(patch,/PROBE_IMPLEMENTATION = r"""/);
  assert.match(patch,/lfs_stat\(&_lfs, path, &info\)/);
  assert.match(patch,/status == LFS_ERR_NOENT/);
  assert.match(patch,/JournalSlotObservation::AbsenceUnverified/);
  assert.match(patch,/JournalSlotObservation::PresentUnverified/);
  assert.match(patch,/_fgExclusiveQuarantined = true/);
  assert.match(generator,/PROBE_IMPLEMENTATION/);
  assert.match(generator,/PROBE_MARKER/);
  assert.match(harness,/EXACT_PROBE_FROM_PINNED_OVERLAY/);
  assert.match(harness,/case_probe_absence_quarantines_even_if_no_io_error/);
  assert.match(harness,/case_probe_after_torn_program_is_denied_without_io/);
  assert.doesNotMatch(adapter,/probeJournalSlot\s*\(/);
  assert.match(adapter,/bool writeNew\(uint8_t, const uint8_t \*,size_t\)\s*\{\s*return false;/);
});
test('R2 single-consumer review queue is read-only, bounded and inactive in MCU loop',()=>{
  const queue=readFileSync(dir+'ReadOnlyOwnerQueue.h','utf8');
  const checks=readFileSync('tests/firmware_read_only_owner_queue.cpp','utf8');
  const workflow=readFileSync('.github/workflows/nodemcu-no-truncation-storage.yml','utf8');
  assert.match(sketch,/#include "ReadOnlyOwnerQueue.h"/);
  assert.match(sketch,/static_assert\(sizeof\(floodguard_retained_review::ReadOnlyOwnerQueue\) > 0/);
  assert.match(queue,/static constexpr uint8_t kCapacity = 4/);
  assert.match(queue,/if \(active_\) \{ quarantine\(\); return false; \}/);
  assert.match(queue,/bool mayWrite\(\) const \{ return false; \}/);
  assert.match(queue,/bool mayAcknowledge\(\) const \{ return false; \}/);
  assert.match(queue,/bool mayOperateGate\(\) const \{ return false; \}/);
  assert.match(checks,/nestedTakeQuarantines/);
  assert.match(checks,/overflowRefusedWithoutDroppingPending/);
  assert.match(workflow,/firmware_read_only_owner_queue\.cpp/);
  const active=sketch.slice(sketch.indexOf('void setup()'));
  assert.doesNotMatch(active,/ReadOnlyOwnerQueue|probeJournalSlot\s*\(|createExclusiveLocal\s*\(|LittleFS\.begin\s*\(/);
});

test('R2 host-only thread owner enforces guarded read dispatch, never device activation',()=>{
  const owner=readFileSync('experiments/esp8266-core-excl-review/HostOwnerReadDispatcher.h','utf8');
  const harness=readFileSync('tests/firmware_host_owner_read_dispatcher.cpp','utf8');
  const workflow=readFileSync('.github/workflows/nodemcu-no-truncation-storage.yml','utf8');
  assert.match(owner,/std::this_thread::get_id\(\) != owner_/);
  assert.match(owner,/std::lock_guard<std::mutex>/);
  assert.match(owner,/if \(id != 0 && id <= highestAcceptedId_\)/);
  assert.match(owner,/queue_\.take\(ticket\)/);
  assert.match(owner,/queue_\.complete\(ticket.requestId,readOk\)/);
  assert.match(owner,/catch \(\.\.\.\)/);
  assert.match(owner,/bool mayWrite\(\) const \{ return false; \}/);
  assert.match(owner,/bool maySendCloudAck\(\) const \{ return false; \}/);
  assert.match(owner,/bool mayOperateGate\(\) const \{ return false; \}/);
  assert.match(harness,/testConcurrentSameIdExactlyOneAccepted/);
  assert.match(harness,/testWrongThreadCannotInvokeReader/);
  assert.match(harness,/testCorruptCRCStopsAllFutureCallbacks/);
  assert.match(harness,/decode\(records\[t.slot\]/);
  assert.match(workflow,/g\+\+ -std=c\+\+11 -O2 -Wall -Wextra -Werror -pedantic -pthread/);
  assert.match(workflow,/firmware_host_owner_read_dispatcher\.cpp/);
  assert.match(adapter,/bool writeNew\(uint8_t, const uint8_t \*,size_t\)\s*\{\s*return false;/);
  const active=sketch.slice(sketch.indexOf('void setup()'));
  assert.doesNotMatch(active,/HostOwnerReadDispatcher|std::thread|std::mutex|createExclusiveLocal\s*\(/);
});

test('R2 ESP8266 loop and flash evidence are compile-only and never authorize device writes',()=>{
  const pump=readFileSync(dir+'CooperativeReadOnlyAuditPump.h','utf8');
  const flash=readFileSync(dir+'ReviewFlashInventory.h','utf8');
  const host=readFileSync('tests/firmware_cooperative_loop_flash_inventory.cpp','utf8');
  const workflow=readFileSync('.github/workflows/nodemcu-no-truncation-storage.yml','utf8');
  assert.match(sketch,/#include "CooperativeReadOnlyAuditPump.h"/);
  assert.match(sketch,/#include "ReviewFlashInventory.h"/);
  for(const name of ['getFlashChipRealSize','getFlashChipSize','getSketchSize','getFreeSketchSpace'])
    assert.match(sketch,new RegExp('sizeof\\(ESP\\.'+name+'\\(\\)\\)'));
  assert.match(pump,/queue_\.take\(ticket\)/);
  assert.match(pump,/queue_\.complete\(ticket.requestId,ok\)/);
  assert.match(pump,/bool mayWrite\(\) const \{ return false; \}/);
  assert.match(pump,/bool mayOperateGate\(\) const \{ return false; \}/);
  assert.match(flash,/FlashInventoryReview::RequiresPhysicalPartitionReview/);
  for(const name of ['flashInventoryAuthorizesMount','flashInventoryAuthorizesWrite','flashInventoryAuthorizesFirmwareUpload'])
    assert.match(flash,new RegExp('bool '+name+'\\(FlashInventoryReview\\)'));
  assert.match(host,/nestedInvocationCannotUpgradeOutcome/);
  assert.match(host,/flashEvidenceNeverAuthorizesAnything/);
  assert.match(workflow,/firmware_cooperative_loop_flash_inventory\.cpp/);
  assert.match(adapter,/bool writeNew\(uint8_t, const uint8_t \*,size_t\)\s*\{\s*return false;/);
  const active=sketch.slice(sketch.indexOf('void setup()'));
  assert.doesNotMatch(active,/CooperativeReadOnlyAuditPump|ReviewFlashInventory|inspectFlashInventory\s*\(|LittleFS\.begin\s*\(|createExclusiveLocal\s*\(/);
});

test('R2 pinned board layout evidence is offline, never flash authorization or production input',()=>{
  const script=readFileSync('experiments/esp8266-core-excl-review/r2_board_layout_evidence.py','utf8');
  const manifest=JSON.parse(readFileSync('experiments/esp8266-core-excl-review/board_evidence_template.json','utf8'));
  const workflow=readFileSync('.github/workflows/nodemcu-no-truncation-storage.yml','utf8');
  assert.match(script,/PINNED_BOARDS_GIT_BLOB = "[0-9a-f]{40}"/);
  assert.match(script,/BOARD = "nodemcuv2"/);
  assert.match(script,/PROFILE_IDS = \("4M1M", "4M2M", "4M3M", "4M"\)/);
  assert.match(script,/get_profiles\(.*verify_pin: bool = True/);
  assert.match(script,/if profile == "4M":/);
  assert.match(script,/SELECTED_MENU_HAS_NO_FILESYSTEM/);
  assert.match(script,/BACKUP_REPEATED_READ_MISMATCH/);
  assert.match(script,/"may_flash": False/);
  assert.match(script,/"may_write": False/);
  assert.match(script,/"may_operate_gate": False/);
  assert.match(script,/"production_go": False/);
  assert.equal(manifest.origin,'not-observed');
  assert.equal(manifest.selected_flash_menu,null);
  assert.equal(manifest.bench_isolated,false);
  assert.equal(manifest.backup.sha256,null);
  assert.match(workflow,/r2_board_layout_evidence\.py/);
  assert.match(workflow,/--sdk-only/);
  assert.match(workflow,/firmware_board_layout_evidence_test\.py/);
  assert.match(adapter,/bool writeNew\(uint8_t, const uint8_t \*,size_t\)\s*\{\s*return false;/);
  const active=sketch.slice(sketch.indexOf('void setup()'));
  assert.doesNotMatch(active,/r2_board_layout_evidence|flash_id|read_flash|write_flash|LittleFS\.begin\s*\(/);
});
