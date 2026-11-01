#pragma once
// FloodGuard R2 diagnostic-only storage-health state machine.
// An ambiguous mount or read permanently quarantines this adapter instance.
// No reset, retry, flash write, delete, cloud ACK or gate operation is provided.
// Reboot / reprovisioning is NOT proof of durable recovery.
namespace floodguard_retained_review {
class JournalMountHealth {
 public:
  JournalMountHealth() : attempted_(false), ready_(false),
                         quarantined_(false) {}

  // Only a single mount attempt may be initiated on this instance.
  bool beginMount() {
    if (attempted_ || quarantined_) return false;
    attempted_ = true;
    return true;
  }

  // Must follow beginMount; failure blocks all retries on this instance.
  void finishMount(bool success) {
    if (!attempted_ || quarantined_ || ready_) {
      quarantine();
      return;
    }
    if (!success) {
      quarantine();
      return;
    }
    ready_ = true;
  }

  // Any ambiguous absence, read failure, invalid stored length or short read
  // makes this mount unusable for subsequent automatic operations.
  void quarantine() {
    ready_ = false;
    quarantined_ = true;
  }

  bool ready() const { return attempted_ && ready_ && !quarantined_; }
  bool quarantined() const { return quarantined_; }
  bool attempted() const { return attempted_; }

 private:
  bool attempted_;
  bool ready_;
  bool quarantined_;
};
} // namespace floodguard_retained_review
