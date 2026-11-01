#pragma once
// FloodGuard R2 — HOST-ONLY concurrency reference (std::mutex/thread).
// This is NEVER included by the ESP8266 sketch, and is NOT a device mutex,
// firmware scheduler, authenticated device owner, storage writer or cloud ACK.
// Owner thread construction + read-only backend callback are host test inputs.
#include <stdint.h>
#include <mutex>
#include <thread>
#include "../../firmware/esp8266_review_diagnostic/ReadOnlyOwnerQueue.h"

namespace floodguard_host_review {

using namespace floodguard_retained_review;

enum class PollOutcome : uint8_t {
  Empty, ReadVerifiedLocally, WrongThread, ReadFailed, Quarantined
};

struct DispatcherSnapshot {
  uint8_t pending;
  bool busy;
  bool quarantined;
};

class HostOwnerReadDispatcher {
 public:
  HostOwnerReadDispatcher()
      : owner_(std::this_thread::get_id()), highestAcceptedId_(0) {}

  QueueSubmit enqueue(uint8_t slot, uint32_t id) {
    const std::lock_guard<std::mutex> guard(mutex_);
    if (queue_.quarantined()) return QueueSubmit::Quarantined;
    // Prevent same-boot replay after a previously completed request. A new
    // process starts over and is NOT a durable/reboot-safe replay anchor.
    if (id != 0 && id <= highestAcceptedId_) return QueueSubmit::Duplicate;
    const QueueSubmit result = queue_.submit(slot,id);
    if (result == QueueSubmit::Accepted) highestAcceptedId_ = id;
    return result;
  }

  // The ONLY path to a backend callback. Reader is a host-supplied function
  // with bool operator()(const ReadTicket&), expected to verify CRC/sequence.
  // A malicious callback is not sandboxed: this proves dispatch sequencing,
  // not that arbitrary code or other FS handles cannot perform I/O.
  template<typename Reader>
  PollOutcome processOne(Reader &reader) {
    if (std::this_thread::get_id() != owner_)
      return PollOutcome::WrongThread;
    ReadTicket ticket = {0,0};
    {
      const std::lock_guard<std::mutex> guard(mutex_);
      if (queue_.quarantined()) return PollOutcome::Quarantined;
      if (!queue_.take(ticket))
        return queue_.quarantined() ? PollOutcome::Quarantined
                                    : PollOutcome::Empty;
    }
    bool readOk = false;
    try {
      readOk = reader(ticket);
    } catch (...) {
      // A thrown host callback never unlocks future dispatch of uncertain data.
      readOk = false;
    }
    const std::lock_guard<std::mutex> guard(mutex_);
    if (!queue_.complete(ticket.requestId,readOk))
      return PollOutcome::Quarantined;
    return PollOutcome::ReadVerifiedLocally;
  }

  DispatcherSnapshot snapshot() const {
    const std::lock_guard<std::mutex> guard(mutex_);
    return {queue_.pending(),queue_.active(),queue_.quarantined()};
  }

  bool mayWrite() const { return false; }
  bool maySendCloudAck() const { return false; }
  bool mayReportFloodSafe() const { return false; }
  bool mayOperateGate() const { return false; }

  HostOwnerReadDispatcher(const HostOwnerReadDispatcher&) = delete;
  HostOwnerReadDispatcher &operator=(const HostOwnerReadDispatcher&) = delete;

 private:
  const std::thread::id owner_;
  mutable std::mutex mutex_;
  ReadOnlyOwnerQueue queue_;
  uint32_t highestAcceptedId_;
};

} // namespace floodguard_host_review
