#pragma once
// FloodGuard review-only bounded append journal: NO key issuance, ACK, erase,
// upload, flash mounting, notification or gate action. This class is portable,
// built using the same record codec as the dormant ESP8266 LittleFS module.
// A saved CRC is only DAMAGE DETECTION, not a signature or authenticated ACK.
#include <stddef.h>
#include <stdint.h>
#include "RetainedFrameCodec.h"

namespace floodguard_retained_review {
constexpr uint8_t kJournalSlots = 8;
enum class SlotPresence : uint8_t { Missing, Present, Uncertain };
enum class JournalResult : uint8_t {
  Available, Full, UnsafeStorage, CorruptOrGap, InvalidFrame,
  OutOfOrder, Committed, CommitUncertain
};
struct JournalSnapshot {
  JournalResult result;
  uint8_t count;
  uint32_t newestSequence;
};
inline JournalSnapshot snapshot(JournalResult result, uint8_t count,
                               uint32_t newestSequence) {
  return {result, count, newestSequence};
}
/**
 * Requires Store::ready(), Store::probe(slot), Store::read(slot,bytes,cap,out)
 * and Store::writeNew(slot,bytes,count). One writer, explicitly single-threaded.
 *
 * Every existing slot is read + CRC/sequence checked on EVERY append. A hole,
 * corrupt file, uncertain read/probe, or out-of-order history stops writing.
 * This does not recover data, clear slots or authorize earlier events to ACK.
 */
template <typename Store>
JournalSnapshot inspectJournal(Store &store) {
  if (!store.ready()) return snapshot(JournalResult::UnsafeStorage,0,0);
  bool gap = false;
  uint8_t count = 0;
  uint32_t latest = 0;
  for (uint8_t slot = 0; slot < kJournalSlots; ++slot) {
    const SlotPresence state = store.probe(slot);
    if (state == SlotPresence::Uncertain)
      return snapshot(JournalResult::UnsafeStorage,count,latest);
    if (state == SlotPresence::Missing) {
      gap = true;
      continue;
    }
    if (gap) return snapshot(JournalResult::CorruptOrGap,count,latest);
    uint8_t encoded[kMaxRecord] = {};
    size_t bytesRead = 0;
    if (!store.read(slot,encoded,sizeof(encoded),bytesRead))
      return snapshot(JournalResult::UnsafeStorage,count,latest);
    Frame restored = {};
    if (decode(encoded,bytesRead,restored) != Status::Valid ||
        restored.sequence <= latest)
      return snapshot(JournalResult::CorruptOrGap,count,latest);
    latest = restored.sequence;
    ++count;
  }
  return snapshot(count == kJournalSlots ? JournalResult::Full
                : JournalResult::Available,count,latest);
}
/**
 * A positive result means this lab's storage abstraction read back the bytes,
 * NOT that a real flash survived power interruption or that telemetry reached
 * Firebase. An uncertain write blocks operator-free retries by forcing a
 * complete re-scan; no slot is overwritten and no sequence is changed.
 */
template <typename Store>
JournalResult appendJournal(Store &store,uint32_t sequence,
                            const char *externallySignedBody,size_t size) {
  const JournalSnapshot before = inspectJournal(store);
  if (before.result != JournalResult::Available) return before.result;
  if (sequence == 0 || sequence > kMaxSequence ||
      sequence <= before.newestSequence)
    return JournalResult::OutOfOrder;
  uint8_t encoded[kMaxRecord] = {};
  size_t encodedSize = 0;
  if (encode(sequence,externallySignedBody,size,encoded,sizeof(encoded),
             encodedSize) != Status::Valid)
    return JournalResult::InvalidFrame;
  if (store.probe(before.count) != SlotPresence::Missing)
    return JournalResult::UnsafeStorage;
  // Do not retry if writing returns false. It might have persisted a prefix.
  if (!store.writeNew(before.count,encoded,encodedSize))
    return JournalResult::CommitUncertain;
  const JournalSnapshot after = inspectJournal(store);
  if ((after.result != JournalResult::Available &&
       after.result != JournalResult::Full) ||
      after.count != before.count + 1 ||
      after.newestSequence != sequence)
    return JournalResult::CommitUncertain;
  return JournalResult::Committed;
}
} // namespace floodguard_retained_review
