#pragma once
// FloodGuard R2: strictly READ-ONLY reboot audit policy.
// One pass over the existing bounded journal through inspectJournal(Store).
// NO mount, format, write, ACK, erase, cloud receipt, or gate operation.
// A complete inventory is NOT evidence that a power-loss-interrupted
// exclusive create is safe to retry, and no resume/write API exists.
#include <stdint.h>
#include "BoundedFrameJournal.h"

namespace floodguard_retained_review {

enum class BootAuditDisposition : uint8_t {
  BlockedBeforeAudit, ReadOnlyInventory, Quarantined
};

class JournalBootAudit {
 public:
  JournalBootAudit()
      : disposition_(BootAuditDisposition::BlockedBeforeAudit),
        inspected_(false), count_(0), newestSequence_(0) {}

  template<typename Store>
  BootAuditDisposition inspectOnce(Store &store) {
    // A retry after a bad read/mount is not independent evidence.
    if (inspected_) {
      quarantine();
      return disposition_;
    }
    inspected_ = true;
    const JournalSnapshot verified = inspectJournal(store);
    // Even when the host reports a valid empty or full inventory, the
    // hardware restart/recovery decision is read-only, never write-enabled.
    if (verified.result != JournalResult::Available &&
        verified.result != JournalResult::Full) {
      quarantine();
      return disposition_;
    }
    disposition_ = BootAuditDisposition::ReadOnlyInventory;
    count_ = verified.count;
    newestSequence_ = verified.newestSequence;
    return disposition_;
  }

  void quarantine() {
    disposition_ = BootAuditDisposition::Quarantined;
    count_ = 0;
    newestSequence_ = 0;
  }

  BootAuditDisposition disposition() const { return disposition_; }
  uint8_t inventoryCount() const { return count_; }
  uint32_t newestSequence() const { return newestSequence_; }
  bool mayAppend() const { return false; }
  bool mayRetire() const { return false; }
  bool maySendAcknowledgment() const { return false; }
  bool mayReportSafe() const { return false; }
  JournalBootAudit(const JournalBootAudit &) = delete;
  JournalBootAudit &operator=(const JournalBootAudit &) = delete;

 private:
  BootAuditDisposition disposition_;
  bool inspected_;
  uint8_t count_;
  uint32_t newestSequence_;
};
} // namespace floodguard_retained_review
