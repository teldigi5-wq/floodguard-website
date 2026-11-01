#pragma once
// FloodGuard R2: compiler-portable single-loop SCHEDULING POLICY ONLY.
// Callers must serialize submit/pumpOne via the same owner loop themselves.
// NOT a mutex/ISR queue/task guard; NEVER activated by the diagnostic.
// One callback maximum per tick; callback duration is UNBOUNDED and must
// be limited and audited before any physical device integration.
// NO filesystem mount, writes, cloud ACK, alert, or gate operation.
#include <stdint.h>
#include "ReadOnlyOwnerQueue.h"

namespace floodguard_retained_review {
enum class AuditTick : uint8_t {
  NoWork, OneLocalRead, StorageUncertain
};

class CooperativeReadOnlyAuditPump {
 public:
  CooperativeReadOnlyAuditPump() : highestAcceptedId_(0) {}

  QueueSubmit submit(uint8_t slot, uint32_t id) {
    if (queue_.quarantined()) return QueueSubmit::Quarantined;
    if (id != 0 && id <= highestAcceptedId_) return QueueSubmit::Duplicate;
    const QueueSubmit result=queue_.submit(slot,id);
    if (result==QueueSubmit::Accepted) highestAcceptedId_=id;
    return result;
  }

  // Called at most once per actual future loop() iteration, NOT from ISR,
  // timer, network task, callback or other concurrent context.
  // Reader is a trusted operator supplying bool operator()(ReadTicket).
  // Does not authenticate cryptographic signatures or receipts.
  template<typename Reader>
  AuditTick pumpOne(Reader &reader) {
    ReadTicket ticket={0,0};
    if (queue_.quarantined()) return AuditTick::StorageUncertain;
    if (!queue_.take(ticket))
      return queue_.quarantined() ? AuditTick::StorageUncertain
                                  : AuditTick::NoWork;
    const bool ok=reader(ticket);
    if (!queue_.complete(ticket.requestId,ok))
      return AuditTick::StorageUncertain;
    return AuditTick::OneLocalRead;
  }

  void quarantine() { queue_.quarantine(); }
  bool quarantined() const { return queue_.quarantined(); }
  bool active() const { return queue_.active(); }
  uint8_t pending() const { return queue_.pending(); }
  bool mayWrite() const { return false; }
  bool mayAcknowledge() const { return false; }
  bool mayReportFloodSafe() const { return false; }
  bool mayOperateGate() const { return false; }
  CooperativeReadOnlyAuditPump(const CooperativeReadOnlyAuditPump&)=delete;
  CooperativeReadOnlyAuditPump& operator=(const CooperativeReadOnlyAuditPump&)=delete;
 private:
  ReadOnlyOwnerQueue queue_;
  uint32_t highestAcceptedId_;
};
} // namespace floodguard_retained_review
