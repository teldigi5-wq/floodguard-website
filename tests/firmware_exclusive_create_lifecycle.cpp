// FloodGuard R2 — pure C++11 host state-machine tests (not a device writer).
// Scripted outcomes are test inputs, not real filesystem or cloud evidence.
#include <cassert>
#include <cstdio>
#include <cstdint>
#include "../firmware/esp8266_review_diagnostic/ExclusiveCreateLifecycle.h"

using namespace floodguard_retained_review;
static const uint8_t bytes[] = {0x46, 0x47, 0x50, 0x31, 0x00, 0x00, 0x00, 0x08};
static const size_t size = sizeof(bytes);

static void unsupportedDoesNotClaimSuccess() {
  ExclusiveCreateLifecycle x;
  assert(!x.finished());
  assert(x.outcome() == ExclusiveObservation::Unsupported);
  x.opened(ExclusiveOpen::Unsupported, bytes, size);
  assert(x.finished());
  assert(x.outcome() == ExclusiveObservation::Unsupported);
  x.readback(bytes, size, true);
  assert(x.outcome() == ExclusiveObservation::Unsupported);
}
static void existingRetainedRecordNeverACKs() {
  ExclusiveCreateLifecycle x;
  x.opened(ExclusiveOpen::AlreadyExists, bytes, size);
  assert(x.finished());
  assert(x.outcome() == ExclusiveObservation::ExistingUnacknowledged);
  x.written(size, true);
  assert(x.outcome() == ExclusiveObservation::ExistingUnacknowledged);
}
static void openingStorageFailureQuarantines() {
  ExclusiveCreateLifecycle x;
  x.opened(ExclusiveOpen::StorageFault, bytes, size);
  assert(x.finished());
  assert(x.outcome() == ExclusiveObservation::StorageFault);
  x.opened(ExclusiveOpen::Created, bytes, size);
  assert(x.outcome() == ExclusiveObservation::StorageFault);
}
static void completeLocalByteMatchIsNotRemoteACK() {
  ExclusiveCreateLifecycle x;
  x.opened(ExclusiveOpen::Created, bytes, size);
  assert(!x.finished());
  assert(x.outcome() == ExclusiveObservation::CommitUncertain);
  x.written(size, true);
  x.synced(true);
  x.closed(true);
  x.readback(bytes, size, true);
  assert(x.finished());
  assert(x.outcome() == ExclusiveObservation::LocalBytesMatched);
}
static void partialWriteIsUncertain() {
  ExclusiveCreateLifecycle x;
  x.opened(ExclusiveOpen::Created, bytes, size);
  x.written(size-1, true);
  assert(x.finished());
  assert(x.outcome() == ExclusiveObservation::CommitUncertain);
}
static void failedWriteIsUncertain() {
  ExclusiveCreateLifecycle x;
  x.opened(ExclusiveOpen::Created, bytes, size);
  x.written(size, false);
  assert(x.finished());
  assert(x.outcome() == ExclusiveObservation::CommitUncertain);
}
static void failedSyncIsUncertain() {
  ExclusiveCreateLifecycle x;
  x.opened(ExclusiveOpen::Created, bytes, size);
  x.written(size, true);
  x.synced(false);
  assert(x.finished());
  assert(x.outcome() == ExclusiveObservation::CommitUncertain);
}
static void failedCloseIsUncertain() {
  ExclusiveCreateLifecycle x;
  x.opened(ExclusiveOpen::Created, bytes, size);
  x.written(size, true);
  x.synced(true);
  x.closed(false);
  assert(x.finished());
  assert(x.outcome() == ExclusiveObservation::CommitUncertain);
}
static void alteredReadbackIsUncertain() {
  ExclusiveCreateLifecycle x;
  const uint8_t wrong[] = {0x46, 0x47, 0x50, 0x30, 0, 0, 0, 8};
  x.opened(ExclusiveOpen::Created, bytes, size);
  x.written(size, true);
  x.synced(true);
  x.closed(true);
  x.readback(wrong, size, true);
  assert(x.finished());
  assert(x.outcome() == ExclusiveObservation::CommitUncertain);
}
static void shortReadbackIsUncertain() {
  ExclusiveCreateLifecycle x;
  x.opened(ExclusiveOpen::Created, bytes, size);
  x.written(size, true);
  x.synced(true);
  x.closed(true);
  x.readback(bytes, size-1, true);
  assert(x.outcome() == ExclusiveObservation::CommitUncertain);
}
static void readFailureIsUncertain() {
  ExclusiveCreateLifecycle x;
  x.opened(ExclusiveOpen::Created, bytes, size);
  x.written(size, true);
  x.synced(true);
  x.closed(true);
  x.readback(nullptr, 0, false);
  assert(x.outcome() == ExclusiveObservation::CommitUncertain);
}
static void wrongPhaseCannotBeMadeSuccess() {
  ExclusiveCreateLifecycle x;
  x.opened(ExclusiveOpen::Created, bytes, size);
  x.synced(true); // No validated write.
  x.written(size, true);
  x.closed(true);
  x.readback(bytes, size, true);
  assert(x.finished());
  assert(x.outcome() == ExclusiveObservation::CommitUncertain);
}
static void fakeReadbackWithoutOpenCannotBeMadeSuccess() {
  ExclusiveCreateLifecycle x;
  x.readback(bytes, size, true);
  assert(x.finished());
  assert(x.outcome() == ExclusiveObservation::CommitUncertain);
  x.opened(ExclusiveOpen::Created, bytes, size);
  assert(x.outcome() == ExclusiveObservation::CommitUncertain);
}
static void invalidCreatedRecordIsStillUncertain() {
  ExclusiveCreateLifecycle a;
  a.opened(ExclusiveOpen::Created, nullptr, size);
  assert(a.outcome() == ExclusiveObservation::CommitUncertain);
  ExclusiveCreateLifecycle b;
  b.opened(ExclusiveOpen::Created, bytes, kMaxRecord+1);
  assert(b.outcome() == ExclusiveObservation::CommitUncertain);
  ExclusiveCreateLifecycle c;
  c.opened(ExclusiveOpen::Created, bytes, 0);
  assert(c.outcome() == ExclusiveObservation::CommitUncertain);
}
static void duplicateOpenAfterStartedIsUncertain() {
  ExclusiveCreateLifecycle x;
  x.opened(ExclusiveOpen::Created, bytes, size);
  x.opened(ExclusiveOpen::Created, bytes, size);
  x.written(size, true);
  assert(x.outcome() == ExclusiveObservation::CommitUncertain);
}
int main() {
  unsupportedDoesNotClaimSuccess();
  existingRetainedRecordNeverACKs();
  openingStorageFailureQuarantines();
  completeLocalByteMatchIsNotRemoteACK();
  partialWriteIsUncertain();
  failedWriteIsUncertain();
  failedSyncIsUncertain();
  failedCloseIsUncertain();
  alteredReadbackIsUncertain();
  shortReadbackIsUncertain();
  readFailureIsUncertain();
  wrongPhaseCannotBeMadeSuccess();
  fakeReadbackWithoutOpenCannotBeMadeSuccess();
  invalidCreatedRecordIsStillUncertain();
  duplicateOpenAfterStartedIsUncertain();
  std::puts("PASS 15 exclusive-create lifecycle host safety scenarios (NO FLASH/NO CLOUD ACK)");
  return 0;
}
