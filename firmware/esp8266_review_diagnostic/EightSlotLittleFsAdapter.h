#pragma once
// Dormant ESP8266 LittleFS adapter for BoundedFrameJournal.h.
// Does NOT run in diagnostic setup/loop. No flash format/removal/rename/ACK.
// A partially created slot remains occupied and can block all later writes.
// NOT power-fail proven; SDK filesystem and hardware need supervised tests.
#include <Arduino.h>
#include <LittleFS.h>
#include "BoundedFrameJournal.h"

namespace floodguard_retained_review {
class LittleFsEightSlots {
 public:
  LittleFsEightSlots() : mounted_(false) {}
  bool mountExplicitly() {
    if (mounted_) return true;
    // Never format or wipe flash to satisfy an experimental write.
    mounted_ = LittleFS.begin();
    return mounted_;
  }
  bool ready() const { return mounted_; }
  SlotPresence probe(uint8_t slot) {
    if (!mounted_ || slot >= kJournalSlots) return SlotPresence::Uncertain;
    // The SDK's exists() cannot reliably distinguish I/O failure from a
    // missing path: this remains a deployment blocker.
    return LittleFS.exists(path(slot)) ?
      SlotPresence::Present : SlotPresence::Missing;
  }
  bool read(uint8_t slot,uint8_t *dst,size_t capacity,size_t &out) {
    out = 0;
    if (!mounted_ || !dst || slot >= kJournalSlots ||
        capacity < kMaxRecord) return false;
    File file = LittleFS.open(path(slot),"r");
    if (!file) return false;
    const size_t size = static_cast<size_t>(file.size());
    if (size < 14 || size > capacity) { file.close(); return false; }
    const size_t n = file.read(dst,size);
    file.close();
    if (n != size) return false;
    out = n;
    return true;
  }
  bool writeNew(uint8_t slot,const uint8_t *data,size_t size) {
    if (!mounted_ || slot >= kJournalSlots || !data ||
        size < 14 || size > kMaxRecord ||
        probe(slot) != SlotPresence::Missing) return false;
    File file = LittleFS.open(path(slot),"w");
    if (!file) return false;
    const size_t written = file.write(data,size);
    file.flush();
    file.close();
    // If writes are torn or the size is uncertain, the slot is NOT deleted.
    // Caller must re-scan existing slots; no retry/overwrite from here.
    return written == size;
  }
 private:
  static const char *path(uint8_t slot) {
    static const char *const slots[kJournalSlots] = {
      "/fgq2_0.bin","/fgq2_1.bin","/fgq2_2.bin","/fgq2_3.bin",
      "/fgq2_4.bin","/fgq2_5.bin","/fgq2_6.bin","/fgq2_7.bin"
    };
    return slot < kJournalSlots ? slots[slot] : "";
  }
  bool mounted_;
};
} // namespace floodguard_retained_review
