#pragma once
// FloodGuard R2 — review-only local exclusive-create observation protocol.
// NO filesystem implementation, mount, device write, signature, ACK, network,
// notification, or physical gate operation. This cannot prove flash durability.
// A real single-owner backend is NOT available in ESP8266 Arduino core 3.1.2.
// The original bytes must remain valid and unchanged through read-back.
#include <stddef.h>
#include <stdint.h>
#include <string.h>
#include "RetainedFrameCodec.h"

namespace floodguard_retained_review {

enum class ExclusiveOpen : uint8_t {
  Unsupported, AlreadyExists, StorageFault, Created
};

enum class ExclusiveObservation : uint8_t {
  Unsupported, ExistingUnacknowledged, StorageFault,
  CommitUncertain, LocalBytesMatched
};

class ExclusiveCreateLifecycle {
 public:
  ExclusiveCreateLifecycle()
      : phase_(Phase::Idle), outcome_(ExclusiveObservation::Unsupported),
        expected_(nullptr), count_(0) {}

  // The backend must provide ONE true exclusive-create result, never an
  // exists()-then-open("w") result or untrusted guessed absence.
  void opened(ExclusiveOpen event, const uint8_t *bytes, size_t count) {
    if (phase_ != Phase::Idle) {
      denyTransition();
      return;
    }
    if (event == ExclusiveOpen::Unsupported) {
      lock(ExclusiveObservation::Unsupported);
      return;
    }
    if (event == ExclusiveOpen::AlreadyExists) {
      lock(ExclusiveObservation::ExistingUnacknowledged);
      return;
    }
    if (event == ExclusiveOpen::StorageFault) {
      lock(ExclusiveObservation::StorageFault);
      return;
    }
    if (!bytes || count == 0 || count > kMaxRecord) {
      // The exclusive-open outcome already said Created. Even with invalid
      // input, it may have allocated metadata and cannot be retried.
      lock(ExclusiveObservation::CommitUncertain);
      return;
    }
    // The create may already have changed flash; from this point a failed
    // write/sync/close/read can NEVER be safely retried automatically.
    expected_ = bytes;
    count_ = count;
    phase_ = Phase::Opened;
    outcome_ = ExclusiveObservation::CommitUncertain;
  }

  void written(size_t bytesWritten, bool writeOk) {
    if (phase_ != Phase::Opened) { denyTransition(); return; }
    if (!writeOk || bytesWritten != count_) {
      lock(ExclusiveObservation::CommitUncertain);
      return;
    }
    phase_ = Phase::Written;
  }

  void synced(bool syncOk) {
    if (phase_ != Phase::Written) { denyTransition(); return; }
    if (!syncOk) { lock(ExclusiveObservation::CommitUncertain); return; }
    phase_ = Phase::Synced;
  }

  void closed(bool closeOk) {
    if (phase_ != Phase::Synced) { denyTransition(); return; }
    if (!closeOk) { lock(ExclusiveObservation::CommitUncertain); return; }
    phase_ = Phase::Closed;
  }

  // Exact read-back is local only. No claim of actual power-loss persistence,
  // authenticated sensor identity, cloud receipt, or human warning delivery.
  void readback(const uint8_t *actual, size_t length, bool readOk) {
    if (phase_ != Phase::Closed) { denyTransition(); return; }
    if (!readOk || !actual || length != count_ ||
        memcmp(expected_, actual, count_) != 0) {
      lock(ExclusiveObservation::CommitUncertain);
      return;
    }
    expected_ = nullptr;
    count_ = 0;
    phase_ = Phase::LocalMatch;
    outcome_ = ExclusiveObservation::LocalBytesMatched;
  }

  ExclusiveObservation outcome() const { return outcome_; }
  bool finished() const {
    return phase_ == Phase::Locked || phase_ == Phase::LocalMatch;
  }
  // No reset/retry or acknowledgement method by design.
  ExclusiveCreateLifecycle(const ExclusiveCreateLifecycle &) = delete;
  ExclusiveCreateLifecycle &operator=(const ExclusiveCreateLifecycle &) = delete;

 private:
  enum class Phase : uint8_t {
    Idle, Opened, Written, Synced, Closed, LocalMatch, Locked
  };

  void lock(ExclusiveObservation value) {
    phase_ = Phase::Locked;
    outcome_ = value;
    expected_ = nullptr;
    count_ = 0;
  }

  // Illegal ordering after an attempted create remains uncertain; a terminal
  // outcome cannot be turned into success by any additional event.
  void denyTransition() {
    if (phase_ == Phase::Locked || phase_ == Phase::LocalMatch) return;
    lock(ExclusiveObservation::CommitUncertain);
  }

  Phase phase_;
  ExclusiveObservation outcome_;
  const uint8_t *expected_;
  size_t count_;
};

}  // namespace floodguard_retained_review
