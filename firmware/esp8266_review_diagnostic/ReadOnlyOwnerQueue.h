#pragma once
// FloodGuard R2: bounded SINGLE-CONSUMER scheduling POLICY, not a mutex.
// C++11 host-tested; the diagnostic never instantiates/drains this queue.
// Queue contents are ONLY read-only slot audits, not writes/ACKs/actuators.
// This type is not thread-safe: enqueue/dequeue must be driven by the same
// designated application event loop in a future independently reviewed port.
#include <stdint.h>
#include "BoundedFrameJournal.h"

namespace floodguard_retained_review {
enum class QueueSubmit : uint8_t {
  Accepted, Invalid, Duplicate, Full, Quarantined
};
struct ReadTicket {
  uint8_t slot;
  uint32_t requestId;
};
class ReadOnlyOwnerQueue {
 public:
  static constexpr uint8_t kCapacity = 4;
  ReadOnlyOwnerQueue()
      : head_(0), count_(0), active_(false), quarantined_(false),
        current_{0,0}, waiting_{} {}

  QueueSubmit submit(uint8_t slot, uint32_t id) {
    if (quarantined_) return QueueSubmit::Quarantined;
    if (slot >= kJournalSlots || id == 0) return QueueSubmit::Invalid;
    if (active_ && current_.requestId == id) return QueueSubmit::Duplicate;
    for (uint8_t i=0; i<count_; ++i)
      if (waiting_[(head_+i)%kCapacity].requestId == id)
        return QueueSubmit::Duplicate;
    // Full means rejected, not silently dropped.
    if (count_ == kCapacity) return QueueSubmit::Full;
    waiting_[(head_+count_)%kCapacity]={slot,id};
    ++count_;
    return QueueSubmit::Accepted;
  }

  bool take(ReadTicket &out) {
    if (quarantined_) return false;
    if (active_) { quarantine(); return false; }
    if (count_==0) return false;
    current_=waiting_[head_];
    head_=(head_+1)%kCapacity;
    --count_;
    active_=true;
    out=current_;
    return true;
  }

  // The executor reports completion; this class never accesses storage.
  // A failed read or mismatched ticket latches quarantine.
  bool complete(uint32_t id,bool readSucceeded) {
    if (quarantined_) return false;
    if (!active_ || id==0 || current_.requestId!=id || !readSucceeded) {
      quarantine(); return false;
    }
    current_={0,0};
    active_=false;
    return true;
  }

  void quarantine() {
    quarantined_=true;
    active_=false;
    count_=0;
    current_={0,0};
  }
  bool quarantined() const { return quarantined_; }
  bool active() const { return active_; }
  uint8_t pending() const { return count_; }
  bool mayWrite() const { return false; }
  bool mayAcknowledge() const { return false; }
  bool mayOperateGate() const { return false; }
  ReadOnlyOwnerQueue(const ReadOnlyOwnerQueue&) = delete;
  ReadOnlyOwnerQueue &operator=(const ReadOnlyOwnerQueue&) = delete;
 private:
  uint8_t head_;
  uint8_t count_;
  bool active_;
  bool quarantined_;
  ReadTicket current_;
  ReadTicket waiting_[kCapacity];
};
} // namespace floodguard_retained_review
