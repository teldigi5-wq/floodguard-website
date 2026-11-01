// FloodGuard R2: test EXACT portable boot audit policy on a synthetic store.
// No MCU flash, cloud, credential, ACK, alerts or gate operation.
#include <array>
#include <vector>
#include <string>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <type_traits>
#include "../firmware/esp8266_review_diagnostic/JournalBootAudit.h"
using namespace floodguard_retained_review;
static unsigned checks = 0;
static void must(bool truth,const char *why) {
  if (!truth) { std::fprintf(stderr,"FAIL boot audit: %s\n",why); std::exit(1); }
  ++checks;
}
struct FakeStore {
  bool mounted=true;
  int badProbe=-1, badRead=-1;
  unsigned writeCalls=0;
  std::array<std::vector<uint8_t>,kJournalSlots> slots = {};
  bool ready() const { return mounted; }
  SlotPresence probe(uint8_t slot) const {
    if (!mounted || slot>=kJournalSlots || static_cast<int>(slot)==badProbe)
      return SlotPresence::Uncertain;
    return slots[slot].empty()?SlotPresence::Missing:SlotPresence::Present;
  }
  bool read(uint8_t slot,uint8_t *bytes,size_t capacity,size_t &out) const {
    out=0;
    if (!mounted || slot>=kJournalSlots || static_cast<int>(slot)==badRead ||
        slots[slot].empty() || slots[slot].size()>capacity) return false;
    out=slots[slot].size();
    std::memcpy(bytes,slots[slot].data(),out);
    return true;
  }
  bool writeNew(uint8_t,const uint8_t *,size_t) {
    ++writeCalls; return false;
  }
};
static std::vector<uint8_t> record(uint32_t sequence) {
  const std::string body="{\"opaque\":\"" + std::string(130,'A') + "\"}";
  uint8_t out[kMaxRecord]={};
  size_t n=0;
  must(encode(sequence,body.c_str(),body.size(),out,sizeof(out),n)
      ==Status::Valid,"prepare host-only signed-shaped fixture");
  return std::vector<uint8_t>(out,out+n);
}
static void noSideEffects(const JournalBootAudit &gate,const FakeStore &s) {
  must(!gate.mayAppend(),"reboot cannot append");
  must(!gate.mayRetire(),"reboot cannot retire queue");
  must(!gate.maySendAcknowledgment(),"reboot cannot ACK cloud");
  must(!gate.mayReportSafe(),"reboot cannot claim flood SAFE");
  must(s.writeCalls==0,"boot audit did not call writer");
}
static void case_initial_blocked() {
  JournalBootAudit gate;
  FakeStore s;
  must(gate.disposition()==BootAuditDisposition::BlockedBeforeAudit,
       "fresh boot starts blocked");
  noSideEffects(gate,s);
}
static void case_empty_read_only() {
  JournalBootAudit gate;
  FakeStore s;
  must(gate.inspectOnce(s)==BootAuditDisposition::ReadOnlyInventory,
       "typed host empty inventory becomes read-only");
  must(gate.inventoryCount()==0 && gate.newestSequence()==0,
       "empty count is zero");
  noSideEffects(gate,s);
}
static void case_one_valid_read_only() {
  FakeStore s;
  s.slots[0]=record(8);
  JournalBootAudit gate;
  must(gate.inspectOnce(s)==BootAuditDisposition::ReadOnlyInventory,
       "well formed one-record inventory is read-only");
  must(gate.inventoryCount()==1 && gate.newestSequence()==8,
       "audit records the existing sequence");
  noSideEffects(gate,s);
}
static void case_full_read_only() {
  FakeStore s;
  for (uint32_t i=0;i<kJournalSlots;++i) s.slots[i]=record(i+1);
  JournalBootAudit gate;
  must(gate.inspectOnce(s)==BootAuditDisposition::ReadOnlyInventory,
       "full eight-slot journal can only be audited");
  must(gate.inventoryCount()==kJournalSlots &&
       gate.newestSequence()==kJournalSlots,"all eight slots preserved");
  noSideEffects(gate,s);
}
static void case_uncertain_probe_quarantine() {
  FakeStore s;
  s.badProbe=0;
  JournalBootAudit gate;
  must(gate.inspectOnce(s)==BootAuditDisposition::Quarantined,
       "uncertain existence rejects restart");
  noSideEffects(gate,s);
}
static void case_read_failure_quarantine() {
  FakeStore s;
  s.slots[0]=record(1);
  s.badRead=0;
  JournalBootAudit gate;
  must(gate.inspectOnce(s)==BootAuditDisposition::Quarantined,
       "read failure rejects restart");
  noSideEffects(gate,s);
}
static void case_damaged_record_quarantine() {
  FakeStore s;
  s.slots[0]=record(1);
  s.slots[0][10]^=1;
  JournalBootAudit gate;
  must(gate.inspectOnce(s)==BootAuditDisposition::Quarantined,
       "CRC-damaged record rejects restart");
  noSideEffects(gate,s);
}
static void case_gap_quarantine() {
  FakeStore s;
  s.slots[0]=record(1);
  s.slots[2]=record(3);
  JournalBootAudit gate;
  must(gate.inspectOnce(s)==BootAuditDisposition::Quarantined,
       "hole before present slot rejects restart");
  noSideEffects(gate,s);
}
static void case_sequence_replay_quarantine() {
  FakeStore s;
  s.slots[0]=record(2);
  s.slots[1]=record(2);
  JournalBootAudit gate;
  must(gate.inspectOnce(s)==BootAuditDisposition::Quarantined,
       "duplicate sequence rejects restart");
  noSideEffects(gate,s);
}
static void case_mount_failure_quarantine() {
  FakeStore s;
  s.mounted=false;
  JournalBootAudit gate;
  must(gate.inspectOnce(s)==BootAuditDisposition::Quarantined,
       "unmounted store rejects restart");
  noSideEffects(gate,s);
}
static void case_reinspection_quarantines() {
  FakeStore s;
  s.slots[0]=record(1);
  JournalBootAudit gate;
  must(gate.inspectOnce(s)==BootAuditDisposition::ReadOnlyInventory,
       "first inventory verified");
  must(gate.inspectOnce(s)==BootAuditDisposition::Quarantined,
       "second attempt is no new independent evidence");
  must(gate.inventoryCount()==0 && gate.newestSequence()==0,
       "quarantine clears reported facts");
  noSideEffects(gate,s);
}
static void case_preexisting_quarantine_terminal() {
  FakeStore s;
  JournalBootAudit gate;
  gate.quarantine();
  must(gate.inspectOnce(s)==BootAuditDisposition::Quarantined,
       "preexisting quarantine cannot be cleared by audit");
  noSideEffects(gate,s);
}
int main() {
  static_assert(!std::is_copy_constructible<JournalBootAudit>::value,
                "audit must not copy mutable recovery authority");
  case_initial_blocked();
  case_empty_read_only();
  case_one_valid_read_only();
  case_full_read_only();
  case_uncertain_probe_quarantine();
  case_read_failure_quarantine();
  case_damaged_record_quarantine();
  case_gap_quarantine();
  case_sequence_replay_quarantine();
  case_mount_failure_quarantine();
  case_reinspection_quarantines();
  case_preexisting_quarantine_terminal();
  std::printf("PASS 12 read-only boot audit scenarios / %u assertions (NO FLASH, NO WRITES)\n",checks);
  return 0;
}
