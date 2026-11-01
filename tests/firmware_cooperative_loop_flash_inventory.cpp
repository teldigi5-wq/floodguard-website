// FloodGuard R2 host-only deterministic loop scheduling and flash evidence.
#include <cassert>
#include <cstdio>
#include "../firmware/esp8266_review_diagnostic/CooperativeReadOnlyAuditPump.h"
#include "../firmware/esp8266_review_diagnostic/ReviewFlashInventory.h"
using namespace floodguard_retained_review;

struct ReadOK {
  unsigned called=0;
  uint32_t last=0;
  bool operator()(const ReadTicket &ticket) {
    ++called; last=ticket.requestId; return true;
  }
};
static void initiallyNoIOAndNoAuthority() {
  CooperativeReadOnlyAuditPump q;
  ReadOK r;
  assert(q.pumpOne(r)==AuditTick::NoWork);
  assert(r.called==0);
  assert(!q.mayWrite() && !q.mayAcknowledge());
  assert(!q.mayReportFloodSafe() && !q.mayOperateGate());
}
static void exactlyOneReadPerManualTickAndReplayDenial() {
  CooperativeReadOnlyAuditPump q;
  ReadOK r;
  assert(q.submit(0,1)==QueueSubmit::Accepted);
  assert(q.submit(1,2)==QueueSubmit::Accepted);
  assert(q.submit(2,3)==QueueSubmit::Accepted);
  assert(q.pumpOne(r)==AuditTick::OneLocalRead);
  assert(r.called==1 && r.last==1 && q.pending()==2);
  assert(q.submit(0,1)==QueueSubmit::Duplicate);
  assert(q.submit(0,2)==QueueSubmit::Duplicate);
  assert(q.pumpOne(r)==AuditTick::OneLocalRead);
  assert(r.called==2 && r.last==2 && q.pending()==1);
  assert(q.pumpOne(r)==AuditTick::OneLocalRead);
  assert(r.called==3 && r.last==3);
  assert(q.pumpOne(r)==AuditTick::NoWork);
}
static void queueCapacityAndInvalidInputs() {
  CooperativeReadOnlyAuditPump q;
  ReadOK r;
  assert(q.submit(0,0)==QueueSubmit::Invalid);
  assert(q.submit(kJournalSlots,1)==QueueSubmit::Invalid);
  for(uint32_t i=1;i<=4;++i)
    assert(q.submit(static_cast<uint8_t>(i-1),i)==QueueSubmit::Accepted);
  assert(q.submit(7,5)==QueueSubmit::Full);
  assert(q.pending()==4);
  assert(q.pumpOne(r)==AuditTick::OneLocalRead);
  assert(q.submit(7,5)==QueueSubmit::Accepted);
  assert(q.pending()==4);
}
struct FailRead {
  unsigned called=0;
  bool operator()(const ReadTicket&) { ++called; return false; }
};
static void unsuccessfulReadPermanentQuarantine() {
  CooperativeReadOnlyAuditPump q;
  assert(q.submit(0,1)==QueueSubmit::Accepted);
  FailRead fail;
  assert(q.pumpOne(fail)==AuditTick::StorageUncertain);
  assert(fail.called==1 && q.quarantined());
  assert(q.pumpOne(fail)==AuditTick::StorageUncertain);
  assert(fail.called==1);
  assert(q.submit(1,2)==QueueSubmit::Quarantined);
}
static void nestedInvocationCannotUpgradeOutcome() {
  CooperativeReadOnlyAuditPump q;
  assert(q.submit(0,1)==QueueSubmit::Accepted);
  ReadOK shouldNotRun;
  auto nested=[&](const ReadTicket &)->bool {
    assert(q.pumpOne(shouldNotRun)==AuditTick::StorageUncertain);
    return true;
  };
  assert(q.pumpOne(nested)==AuditTick::StorageUncertain);
  assert(shouldNotRun.called==0 && q.quarantined());
}
static void explicitQuarantineNoRearm() {
  CooperativeReadOnlyAuditPump q;
  ReadOK r;
  q.quarantine();
  assert(q.submit(0,1)==QueueSubmit::Quarantined);
  assert(q.pumpOne(r)==AuditTick::StorageUncertain);
  assert(r.called==0 && q.quarantined());
}
static void flashEvidenceNeverAuthorizesAnything() {
  auto checkNoAuthority=[](const FlashInventoryObservation &e,
                           FlashInventoryReview expected) {
    auto r=inspectFlashInventory(e);
    assert(r==expected);
    assert(!flashInventoryAuthorizesMount(r));
    assert(!flashInventoryAuthorizesWrite(r));
    assert(!flashInventoryAuthorizesFirmwareUpload(r));
  };
  checkNoAuthority({0,4194304,500000,1000000},
                   FlashInventoryReview::MissingMeasurement);
  checkNoAuthority({4194304,0,500000,1000000},
                   FlashInventoryReview::MissingMeasurement);
  checkNoAuthority({4194304,2097152,500000,1000000},
                   FlashInventoryReview::InconsistentSize);
  checkNoAuthority({4194304,4194304,5000000,1000000},
                   FlashInventoryReview::InconsistentSize);
  checkNoAuthority({4194304,4194304,500000,5000000},
                   FlashInventoryReview::InconsistentSize);
  // These are SYNTHETIC measurements. Matching sizes still lack an
  // independently verified filesystem partition and therefore stay NO-GO.
  checkNoAuthority({4194304,4194304,500000,1000000},
                   FlashInventoryReview::RequiresPhysicalPartitionReview);
}
int main() {
  initiallyNoIOAndNoAuthority();
  exactlyOneReadPerManualTickAndReplayDenial();
  queueCapacityAndInvalidInputs();
  unsuccessfulReadPermanentQuarantine();
  nestedInvocationCannotUpgradeOutcome();
  explicitQuarantineNoRearm();
  flashEvidenceNeverAuthorizesAnything();
  std::puts("PASS 7 cooperative-loop and synthetic flash-evidence scenario groups (NO IO)");
}
