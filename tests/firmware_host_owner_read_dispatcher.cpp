// FloodGuard R2 — actual std::mutex/std::thread host-only dispatch rehearsal.
// No device firmware integration, LittleFS mount, cloud delivery, or gate.
#include <array>
#include <atomic>
#include <cassert>
#include <cstdio>
#include <cstring>
#include <exception>
#include <stdexcept>
#include <string>
#include <thread>
#include <vector>
#include "../experiments/esp8266-core-excl-review/HostOwnerReadDispatcher.h"
#include "../firmware/esp8266_review_diagnostic/RetainedFrameCodec.h"

using namespace floodguard_host_review;
using namespace floodguard_retained_review;

static std::vector<uint8_t> encoded(uint32_t seq) {
  const std::string body = "{\"opaque\":\"" + std::string(132,'A') + "\"}";
  uint8_t out[kMaxRecord] = {};
  size_t count=0;
  assert(encode(seq,body.c_str(),body.size(),out,sizeof(out),count)
         ==Status::Valid);
  return std::vector<uint8_t>(out,out+count);
}

struct HostVerifiedReader {
  std::array<std::vector<uint8_t>,kJournalSlots> records = {};
  std::array<uint32_t,kJournalSlots> expected = {};
  std::thread::id owner;
  unsigned invoked=0;
  bool operator()(const ReadTicket &t) {
    assert(std::this_thread::get_id()==owner);
    ++invoked;
    if(t.slot>=kJournalSlots || records[t.slot].empty()) return false;
    Frame decoded={};
    return decode(records[t.slot].data(),records[t.slot].size(),decoded)
      ==Status::Valid && decoded.sequence==expected[t.slot];
  }
};

static void testWrongThreadCannotInvokeReader() {
  HostOwnerReadDispatcher d;
  HostVerifiedReader rd;
  rd.owner=std::this_thread::get_id();
  rd.records[0]=encoded(1);
  rd.expected[0]=1;
  assert(d.enqueue(0,1)==QueueSubmit::Accepted);
  PollOutcome result=PollOutcome::Empty;
  std::thread intruder([&]{result=d.processOne(rd);});
  intruder.join();
  assert(result==PollOutcome::WrongThread && rd.invoked==0);
  assert(d.snapshot().pending==1 && !d.snapshot().quarantined);
  assert(d.processOne(rd)==PollOutcome::ReadVerifiedLocally);
  assert(rd.invoked==1);
  assert(d.processOne(rd)==PollOutcome::Empty);
  assert(d.enqueue(0,1)==QueueSubmit::Duplicate);
  assert(!d.mayWrite() && !d.maySendCloudAck());
  assert(!d.mayReportFloodSafe() && !d.mayOperateGate());
}

static void testConcurrentSameIdExactlyOneAccepted() {
  HostOwnerReadDispatcher d;
  std::atomic<int> accepted{0}, duplicate{0};
  std::vector<std::thread> senders;
  for(unsigned i=0;i<12;++i) {
    senders.emplace_back([&] {
      const QueueSubmit result=d.enqueue(0,19);
      if(result==QueueSubmit::Accepted) ++accepted;
      else if(result==QueueSubmit::Duplicate) ++duplicate;
      else assert(false && "unexpected concurrent admission status");
    });
  }
  for(auto &sender:senders) sender.join();
  assert(accepted==1 && duplicate==11);
  assert(d.snapshot().pending==1);
  HostVerifiedReader rd;
  rd.owner=std::this_thread::get_id();
  rd.records[0]=encoded(9);
  rd.expected[0]=9;
  assert(d.processOne(rd)==PollOutcome::ReadVerifiedLocally);
  assert(rd.invoked==1 && d.snapshot().pending==0);
}

static void testEnqueueDuringReadIsSafeAndOnlyOwnerReads() {
  HostOwnerReadDispatcher d;
  assert(d.enqueue(0,100)==QueueSubmit::Accepted);
  HostVerifiedReader backend;
  backend.owner=std::this_thread::get_id();
  backend.records[0]=encoded(12);
  backend.expected[0]=12;
  backend.records[1]=encoded(13);
  backend.expected[1]=13;
  bool admitted=false;
  auto inFlightRead=[&](const ReadTicket &t)->bool {
    const DispatcherSnapshot state=d.snapshot();
    assert(state.busy);
    std::thread producer([&] {
      admitted=d.enqueue(1,101)==QueueSubmit::Accepted;
    });
    producer.join();
    assert(admitted);
    assert(d.snapshot().pending==1);
    return backend(t);
  };
  assert(d.processOne(inFlightRead)==PollOutcome::ReadVerifiedLocally);
  assert(d.processOne(backend)==PollOutcome::ReadVerifiedLocally);
  assert(backend.invoked==2);
  assert(d.enqueue(0,100)==QueueSubmit::Duplicate);
  assert(d.enqueue(0,101)==QueueSubmit::Duplicate);
  assert(d.processOne(backend)==PollOutcome::Empty);
}

static void testCorruptCRCStopsAllFutureCallbacks() {
  HostOwnerReadDispatcher d;
  HostVerifiedReader rd;
  rd.owner=std::this_thread::get_id();
  rd.records[0]=encoded(2);
  rd.records[0][15]^=1; // Tamper with CRC-covered bytes.
  rd.expected[0]=2;
  rd.records[1]=encoded(3);
  rd.expected[1]=3;
  assert(d.enqueue(0,1)==QueueSubmit::Accepted);
  assert(d.enqueue(1,2)==QueueSubmit::Accepted);
  assert(d.processOne(rd)==PollOutcome::Quarantined);
  assert(rd.invoked==1);
  assert(d.snapshot().quarantined && d.snapshot().pending==0);
  assert(d.processOne(rd)==PollOutcome::Quarantined);
  assert(rd.invoked==1);
  assert(d.enqueue(2,3)==QueueSubmit::Quarantined);
}

static void testSequenceMismatchAndMissingRecordFailClosed() {
  for(int mode=0;mode<2;++mode) {
    HostOwnerReadDispatcher d;
    HostVerifiedReader rd;
    rd.owner=std::this_thread::get_id();
    if(mode==0) {rd.records[2]=encoded(3);rd.expected[2]=4;}
    assert(d.enqueue(2,1)==QueueSubmit::Accepted);
    assert(d.processOne(rd)==PollOutcome::Quarantined);
    assert(d.snapshot().quarantined);
  }
}

static void testThrownCallbackAndReentrantDrainFailClosed() {
  {
    HostOwnerReadDispatcher d;
    assert(d.enqueue(0,1)==QueueSubmit::Accepted);
    auto thrower=[](const ReadTicket&)->bool {
      throw std::runtime_error("synthetic read failure");
    };
    assert(d.processOne(thrower)==PollOutcome::Quarantined);
    assert(d.snapshot().quarantined);
  }
  {
    HostOwnerReadDispatcher d;
    assert(d.enqueue(0,1)==QueueSubmit::Accepted);
    auto reentrant=[&](const ReadTicket&)->bool {
      auto innocent=[](const ReadTicket&)->bool {assert(false);return false;};
      assert(d.processOne(innocent)==PollOutcome::Quarantined);
      return true; // Outer success must NOT override nested quarantine.
    };
    assert(d.processOne(reentrant)==PollOutcome::Quarantined);
    assert(d.snapshot().quarantined);
  }
}

static void testCapacityAndStaleRequestRemainDenied() {
  HostOwnerReadDispatcher d;
  for(uint32_t id=1;id<=4;++id)
    assert(d.enqueue(static_cast<uint8_t>(id-1),id)==QueueSubmit::Accepted);
  assert(d.enqueue(5,5)==QueueSubmit::Full);
  assert(d.enqueue(0,0)==QueueSubmit::Invalid);
  assert(d.snapshot().pending==4);
  HostVerifiedReader rd;
  rd.owner=std::this_thread::get_id();
  for(uint32_t i=0;i<4;++i){rd.records[i]=encoded(i+1);rd.expected[i]=i+1;}
  assert(d.processOne(rd)==PollOutcome::ReadVerifiedLocally);
  assert(d.enqueue(2,3)==QueueSubmit::Duplicate);
  assert(d.enqueue(5,5)==QueueSubmit::Accepted);
  for(int i=0;i<3;++i)
    assert(d.processOne(rd)==PollOutcome::ReadVerifiedLocally);
  // Fifth ticket remains queued; absent record must quarantine on execution.
  assert(d.processOne(rd)==PollOutcome::Quarantined);
}
int main() {
  testWrongThreadCannotInvokeReader();
  testConcurrentSameIdExactlyOneAccepted();
  testEnqueueDuringReadIsSafeAndOnlyOwnerReads();
  testCorruptCRCStopsAllFutureCallbacks();
  testSequenceMismatchAndMissingRecordFailClosed();
  testThrownCallbackAndReentrantDrainFailClosed();
  testCapacityAndStaleRequestRemainDenied();
  std::puts("PASS 7 host-only owner-thread concurrency/CRC scenarios (NO DEVICE IO)");
}
