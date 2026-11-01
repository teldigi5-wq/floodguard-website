// FloodGuard R2 — policy-only; no threads, disk access, key, network, or gate.
#include <cassert>
#include <cstdio>
#include "../firmware/esp8266_review_diagnostic/ReadOnlyOwnerQueue.h"
using namespace floodguard_retained_review;
static void startingBlockedForWrites() {
  ReadOnlyOwnerQueue q;
  assert(!q.mayWrite() && !q.mayAcknowledge() && !q.mayOperateGate());
  assert(q.pending()==0 && !q.active() && !q.quarantined());
}
static void orderedAudits() {
  ReadOnlyOwnerQueue q;
  assert(q.submit(1,100)==QueueSubmit::Accepted);
  assert(q.submit(7,101)==QueueSubmit::Accepted);
  ReadTicket t={0,0};
  assert(q.take(t) && t.slot==1 && t.requestId==100);
  assert(q.complete(100,true));
  assert(q.take(t) && t.slot==7 && t.requestId==101);
  assert(q.complete(101,true));
  assert(!q.take(t) && !q.quarantined());
}
static void duplicateRequestRejected() {
  ReadOnlyOwnerQueue q;
  assert(q.submit(0,1)==QueueSubmit::Accepted);
  assert(q.submit(1,1)==QueueSubmit::Duplicate);
  ReadTicket t={0,0};
  assert(q.take(t));
  assert(q.submit(2,1)==QueueSubmit::Duplicate);
  assert(q.complete(1,true));
  assert(q.pending()==0);
}
static void malformedAndOutOfRangeRejected() {
  ReadOnlyOwnerQueue q;
  assert(q.submit(kJournalSlots,22)==QueueSubmit::Invalid);
  assert(q.submit(0,0)==QueueSubmit::Invalid);
  assert(q.pending()==0 && !q.quarantined());
}
static void overflowRefusedWithoutDroppingPending() {
  ReadOnlyOwnerQueue q;
  for(uint32_t i=1;i<=ReadOnlyOwnerQueue::kCapacity;++i)
    assert(q.submit(static_cast<uint8_t>(i-1),i)==QueueSubmit::Accepted);
  assert(q.submit(6,9)==QueueSubmit::Full);
  assert(q.pending()==ReadOnlyOwnerQueue::kCapacity);
  ReadTicket t={0,0};
  for(uint32_t i=1;i<=ReadOnlyOwnerQueue::kCapacity;++i) {
    assert(q.take(t) && t.requestId==i);
    assert(q.complete(i,true));
  }
}
static void nestedTakeQuarantines() {
  ReadOnlyOwnerQueue q;
  assert(q.submit(0,1)==QueueSubmit::Accepted);
  ReadTicket t={0,0};
  assert(q.take(t));
  assert(!q.take(t));
  assert(q.quarantined() && q.pending()==0 && !q.active());
  assert(!q.complete(1,true));
  assert(q.submit(1,2)==QueueSubmit::Quarantined);
}
static void failureQuarantines() {
  ReadOnlyOwnerQueue q;
  assert(q.submit(0,1)==QueueSubmit::Accepted);
  ReadTicket t={0,0};
  assert(q.take(t));
  assert(!q.complete(1,false));
  assert(q.quarantined() && !q.take(t));
}
static void mismatchedCompletionQuarantines() {
  ReadOnlyOwnerQueue q;
  assert(q.submit(0,3)==QueueSubmit::Accepted);
  ReadTicket t={0,0};
  assert(q.take(t));
  assert(!q.complete(4,true));
  assert(q.quarantined());
}
static void unsolicitedCompletionQuarantines() {
  ReadOnlyOwnerQueue q;
  assert(!q.complete(1,true));
  assert(q.quarantined() && q.submit(0,2)==QueueSubmit::Quarantined);
}
static void manualQuarantineTerminal() {
  ReadOnlyOwnerQueue q;
  assert(q.submit(0,1)==QueueSubmit::Accepted);
  q.quarantine();
  assert(q.pending()==0 && q.quarantined());
  assert(q.submit(1,2)==QueueSubmit::Quarantined);
  ReadTicket t={0,0};
  assert(!q.take(t));
}
int main() {
  startingBlockedForWrites();
  orderedAudits();
  duplicateRequestRejected();
  malformedAndOutOfRangeRejected();
  overflowRefusedWithoutDroppingPending();
  nestedTakeQuarantines();
  failureQuarantines();
  mismatchedCompletionQuarantines();
  unsolicitedCompletionQuarantines();
  manualQuarantineTerminal();
  std::puts("PASS 10 single-consumer review-only audit queue host scenarios (NO THREADS / NO IO)");
}
