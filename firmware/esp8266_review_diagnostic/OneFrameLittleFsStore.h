#pragma once
// FloodGuard one-frame LittleFS staging EXPERIMENT — never invoked by the
// diagnostic firmware. No auto-format, no erase, no queue ACK, no cloud claim.
// Only ONE record can ever be staged; any persisted bytes (even damaged)
// block writing another record until a separately reviewed recovery process.
// This is not a usable continuous flood telemetry outbox.
#include <Arduino.h>
#include <LittleFS.h>
#include "RetainedFrameCodec.h"

namespace floodguard_retained_review {
class LittleFsOneFrame {
 public:
  LittleFsOneFrame() : mounted_(false) {}
  // Explicit owner/operator-only initialization in a future firmware port.
  // Never perform filesystem formatting when mounting or reading fails.
  bool mount() {
    if (mounted_) return true;
    mounted_ = LittleFS.begin();
    return mounted_;
  }
  Status load(Frame &frame) {
    frame = {};
    if (!mounted_) return Status::StorageUncertain;
    if (!LittleFS.exists(path())) return Status::InvalidInput; // no record
    File file = LittleFS.open(path(), "r");
    if (!file) return Status::StorageUncertain;
    const size_t count = static_cast<size_t>(file.size());
    if (count < 14 || count > kMaxRecord) {
      file.close();
      return Status::DamagedOrPartial;
    }
    uint8_t bytes[kMaxRecord] = {};
    const size_t read = file.read(bytes, count);
    file.close();
    if (read != count) return Status::StorageUncertain;
    return decode(bytes, count, frame);
  }
  Status storeOnce(uint32_t sequence, const char *signedBody,
                   size_t bodyLength) {
    if (!mounted_) return Status::StorageUncertain;
    // A damaged record is *not* an empty queue. Never reset a record in place.
    if (LittleFS.exists(path())) return Status::ExistingUnacknowledged;
    uint8_t bytes[kMaxRecord] = {};
    size_t total = 0;
    const Status built = encode(sequence, signedBody, bodyLength,
                                bytes, sizeof(bytes), total);
    if (built != Status::Valid) return built;
    File file = LittleFS.open(path(), "w");
    if (!file) return Status::StorageUncertain;
    const size_t wrote = file.write(bytes, total);
    file.flush();
    file.close();
    if (wrote != total) return Status::StorageUncertain;
    Frame verify = {};
    const Status restored = load(verify);
    if (restored != Status::Valid || verify.sequence != sequence ||
        verify.size != bodyLength ||
        memcmp(verify.signedBody, signedBody, bodyLength) != 0)
      return Status::StorageUncertain;
    return Status::Valid;
  }
  // Deliberately no remove, format, clear, compact, rotate or ACK method.
 private:
  static const char *path() { return "/fg_pending_v1.dat"; }
  bool mounted_;
};
} // namespace floodguard_retained_review
