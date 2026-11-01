#pragma once
// FloodGuard R2: read-only, fail-closed ESP8266 LittleFS journal adapter.
// DO NOT re-enable writes until a real exclusive-create primitive, verified
// error-aware absence probe and supervised flash/power-cut tests exist.
// LittleFS.exists() false can mean missing OR I/O failure; opening with "w"
// could truncate an existing signed reading. This adapter WILL NOT risk that.
#include <Arduino.h>
#include <LittleFS.h>
#include "BoundedFrameJournal.h"

namespace floodguard_retained_review {
class LittleFsEightSlots {
 public:
  LittleFsEightSlots() : mounted_(false) {}

  // Explicit review harness only; the WiFi-OFF diagnostic sketch never
  // calls this or writes flash.
  bool mountExplicitly() {
    if (mounted_) return true;
    // ESP8266 core 3.1.2 auto-formats on mount failure by default.
    // Explicitly disable it before touching a possibly historical volume.
    // setConfig() refuses changes after another component has mounted it;
    // treat that as a hard error rather than adopting unknown FS state.
    const LittleFSConfig config(false);
    if (!LittleFS.setConfig(config)) return false;
    mounted_ = LittleFS.begin();
    return mounted_;
  }
  bool ready() const { return mounted_; }

  SlotPresence probe(uint8_t slot) {
    if (!mounted_ || slot >= kJournalSlots) return SlotPresence::Uncertain;
    if (LittleFS.exists(path(slot))) return SlotPresence::Present;
    // A false exists() is ambiguous on this SDK. It is NOT proof of an
    // empty slot, even if the filesystem mounted successfully.
    return SlotPresence::Uncertain;
  }

  // Read existing records for possible operator-guided recovery and audit.
  // A corrupted record is never interpreted as an absent record.
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

  // NO IMPLEMENTATION: no exclusive-create / O_EXCL equivalent is established
  // for ESP8266 LittleFS 3.1.2. Never open an apparently absent path with
  // "w" because that may irreversibly truncate a previously retained event.
  // A caller always gets an uncertain result and must not retry blindly.
  bool writeNew(uint8_t, const uint8_t *,size_t) {
    return false;
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
