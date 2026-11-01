// FloodGuard R2: deterministic native checks for the EXACT header compiled by
// the dormant ESP8266 diagnostic adapter. No flash, credentials, queue writes,
// automatic recovery, telemetry ACK, network, notifications or gate actions.
#include <cassert>
#include <cstdio>
#include "../firmware/esp8266_review_diagnostic/JournalMountHealth.h"

using floodguard_retained_review::JournalMountHealth;

static void initiallyBlocked() {
  JournalMountHealth gate;
  assert(!gate.ready());
  assert(!gate.quarantined());
  assert(!gate.attempted());
  assert(gate.beginMount());
  assert(gate.attempted());
  assert(!gate.ready());
  assert(!gate.beginMount());
  gate.finishMount(true);
  assert(gate.ready());
  assert(!gate.quarantined());
  assert(!gate.beginMount());
}

static void mountFailurePermanentlyBlocksThisInstance() {
  JournalMountHealth gate;
  assert(gate.beginMount());
  gate.finishMount(false);
  assert(!gate.ready());
  assert(gate.quarantined());
  assert(!gate.beginMount());
  gate.finishMount(true); // A later reported success cannot override failure.
  assert(gate.quarantined());
  assert(!gate.ready());
}

static void readFailureQuarantinesEvenAfterEarlierSuccess() {
  JournalMountHealth gate;
  assert(gate.beginMount());
  gate.finishMount(true);
  assert(gate.ready());
  gate.quarantine(); // Wrong absent/read error/short record.
  assert(gate.quarantined());
  assert(!gate.ready());
  assert(!gate.beginMount());
  gate.finishMount(true);
  assert(!gate.ready());
}

static void unpairedMountResultCannotEnableTrust() {
  JournalMountHealth gate;
  gate.finishMount(true);
  assert(gate.quarantined());
  assert(!gate.ready());
  assert(!gate.beginMount());
}

static void duplicateMountResultQuarantines() {
  JournalMountHealth gate;
  assert(gate.beginMount());
  gate.finishMount(true);
  gate.finishMount(true);
  assert(gate.quarantined());
  assert(!gate.ready());
}

static void failureIsIdempotent() {
  JournalMountHealth gate;
  gate.quarantine();
  gate.quarantine();
  assert(gate.quarantined());
  assert(!gate.ready());
  assert(!gate.beginMount());
}

int main() {
  initiallyBlocked();
  mountFailurePermanentlyBlocksThisInstance();
  readFailureQuarantinesEvenAfterEarlierSuccess();
  unpairedMountResultCannotEnableTrust();
  duplicateMountResultQuarantines();
  failureIsIdempotent();
  std::puts("PASS 6 native LittleFS health-state fault scenarios (no flash)");
  return 0;
}
