// Host C++11 tests compile the exact firmware BoundedFrameJournal.h;
// no emulator, physical flash, credential, cloud delivery or queue retirement.
#include <algorithm>
#include <array>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>
#include <vector>
#include "../firmware/esp8266_review_diagnostic/BoundedFrameJournal.h"
using namespace floodguard_retained_review;
static unsigned checks=0;
static void check(bool b,const char *why){
  if(!b){std::fprintf(stderr,"FAIL: %s\n",why);std::exit(1);} ++checks;
}
struct FakeStore {
  bool healthy=true;
  int unknownAt=-1,failedReadAt=-1,tornWriteAt=-1,uncertainAfterFullAt=-1;
  std::array<std::vector<uint8_t>,kJournalSlots> slots={};
  bool ready() const {return healthy;}
  SlotPresence probe(uint8_t idx) const {
    if(!healthy||idx >= kJournalSlots||idx==unknownAt)
      return SlotPresence::Uncertain;
    return slots[idx].empty()?SlotPresence::Missing:SlotPresence::Present;
  }
  bool read(uint8_t idx,uint8_t *out,size_t capacity,size_t &size) const {
    size=0;
    if(!healthy||idx>=kJournalSlots||idx==failedReadAt||
       slots[idx].empty()||slots[idx].size()>capacity) return false;
    size=slots[idx].size();
    std::memcpy(out,slots[idx].data(),size);
    return true;
  }
  bool writeNew(uint8_t idx,const uint8_t *bytes,size_t n){
    if(!healthy||idx>=kJournalSlots||
       !slots[idx].empty()||!bytes||n>kMaxRecord) return false;
    if(idx==tornWriteAt){
      slots[idx].assign(bytes,bytes+n/2);
      return false;
    }
    slots[idx].assign(bytes,bytes+n);
    if(idx==uncertainAfterFullAt) return false;
    return true;
  }
};
static std::string frame(int seq){
  return std::string("{\"envelope\":{\"version\":\"floodguard-offline-envelope-v1\",")
    + "\"deviceId\":\"device-stage-a\",\"sequence\":" +
    std::to_string(seq) + "},\"signature\":\"" + std::string(86,'A') + "\"}";
}
static JournalResult add(FakeStore &s,uint32_t seq){
  auto body=frame(static_cast<int>(seq));
  return appendJournal(s,seq,body.c_str(),body.size());
}
int main(){
  FakeStore s;
  auto empty=inspectJournal(s);
  check(empty.result==JournalResult::Available&&empty.count==0&&
    empty.newestSequence==0,"empty journal is available");
  check(add(s,1)==JournalResult::Committed,"first append commits only if readback matches");
  check(inspectJournal(s).count==1,"one frame retained");
  check(add(s,1)==JournalResult::OutOfOrder,"replay does not overwrite");
  check(add(s,0)==JournalResult::OutOfOrder,"zero sequence refused");
  check(add(s,kMaxSequence+1)==JournalResult::OutOfOrder,"overflow refused");
  check(add(s,2)==JournalResult::Committed,"second append does not block after first");
  check(inspectJournal(s).newestSequence==2,"monotonic sequence");
  check(add(s,10)==JournalResult::Committed,"gapped but increasing device seq accepted");
  for(uint32_t seq=11;seq<=15;seq++)
    check(add(s,seq)==JournalResult::Committed,"bounded append until eighth");
  auto full=inspectJournal(s);
  check(full.result==JournalResult::Full&&full.count==8&&
        full.newestSequence==15,"eighth entry fills journal");
  auto saved=s.slots;
  check(add(s,16)==JournalResult::Full,"ninth rejected without overwriting");
  check(s.slots==saved,"every previously written record is byte identical");
  FakeStore restarted=s;
  auto afterReboot=inspectJournal(restarted);
  check(afterReboot.result==JournalResult::Full&&
    afterReboot.newestSequence==15,"reboot rescan preserves full order");
  check(add(restarted,15)==JournalResult::Full,
    "full retained journal does not allow replay or overwrites");

  FakeStore torn;
  torn.tornWriteAt=0;
  check(add(torn,1)==JournalResult::CommitUncertain,
    "power cut partial write is never success");
  check(!torn.slots[0].empty(),"partial record stays present");
  check(inspectJournal(torn).result==JournalResult::CorruptOrGap,
    "truncated record permanently blocks autonomous writes");
  check(add(torn,2)==JournalResult::CorruptOrGap,
    "no overwrite or sequence skip after torn write");
  FakeStore rebootTorn=torn;
  check(inspectJournal(rebootTorn).result==JournalResult::CorruptOrGap,
    "simulated reboot still detects torn slot");

  FakeStore writtenButReplyLost;
  writtenButReplyLost.uncertainAfterFullAt=0;
  check(add(writtenButReplyLost,1)==JournalResult::CommitUncertain,
    "response lost after complete write is uncertain");
  auto verified=inspectJournal(writtenButReplyLost);
  check(verified.count==1&&verified.newestSequence==1&&
        verified.result==JournalResult::Available,
        "readback after uncertain full write sees retained event");
  check(add(writtenButReplyLost,1)==JournalResult::OutOfOrder,
        "retry never duplicates a complete event");

  FakeStore hole;
  check(add(hole,1)==JournalResult::Committed,"setup gap fixture");
  const auto two=frame(2);
  uint8_t tmp[kMaxRecord]={};
  size_t n=0;
  check(encode(2,two.c_str(),two.size(),tmp,sizeof(tmp),n)==Status::Valid,
        "prepare synthetic unexpected future slot");
  hole.slots[2].assign(tmp,tmp+n);
  check(inspectJournal(hole).result==JournalResult::CorruptOrGap,
        "presence after a missing slot is rejected");
  check(add(hole,3)==JournalResult::CorruptOrGap,
        "gap stops further writes");

  FakeStore corrupted;
  check(add(corrupted,1)==JournalResult::Committed,"setup corruption");
  for(size_t pos=0;pos<corrupted.slots[0].size();pos+=7){
    FakeStore m=corrupted;
    m.slots[0][pos]^=1;
    check(inspectJournal(m).result==JournalResult::CorruptOrGap,
          "bitflip in header/payload/crc blocks journal");
  }
  for(size_t prefix=1;prefix<corrupted.slots[0].size();prefix++){
    FakeStore m=corrupted;
    m.slots[0].resize(prefix);
    check(inspectJournal(m).result==JournalResult::CorruptOrGap,
          "every torn prefix is fail-closed");
  }

  FakeStore unknown;
  unknown.healthy=false;
  check(inspectJournal(unknown).result==JournalResult::UnsafeStorage,
        "unmounted storage is not empty");
  check(add(unknown,1)==JournalResult::UnsafeStorage,
        "unmounted storage never writes");
  unknown.healthy=true;unknown.unknownAt=0;
  check(add(unknown,1)==JournalResult::UnsafeStorage,
        "unknown probe does not become missing");
  unknown.unknownAt=-1;
  check(add(unknown,1)==JournalResult::Committed,"setup uncertain read");
  unknown.failedReadAt=0;
  check(inspectJournal(unknown).result==JournalResult::UnsafeStorage,
        "read failure blocks journal");
  check(add(unknown,2)==JournalResult::UnsafeStorage,
        "cannot skip failed read");

  FakeStore invalid;
  const std::string shortBody="{}";
  check(appendJournal(invalid,1,shortBody.c_str(),shortBody.size())==
        JournalResult::InvalidFrame,"short or unsigned-shaped frame refused");
  check(inspectJournal(invalid).count==0,"invalid frame never touches storage");
  std::printf("PASS %u bounded-journal host corruption/replay checks\n",checks);
  return 0;
}
