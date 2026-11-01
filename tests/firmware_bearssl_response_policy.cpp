// Compiles same response policy header used by ESP8266 BearSSL client.
// Strictly local admission semantics, no cloud confirmation or ACK.
#include <stdio.h>
#include <stdlib.h>
#include "../firmware/esp8266_review_diagnostic/LocalAdmissionReceipt.h"
using namespace floodguard_transport_review;
static unsigned checks=0;
static void check(bool ok, const char *message) {
  if (!ok) { fprintf(stderr, "FAIL: %s\n", message); exit(1); }
  ++checks;
}
static void noCloud(Outcome outcome) {
  const auto r=result(outcome);
  check(!r.cloudConfirmed,"cannot assert cloud confirmation");
  check(!r.canAcknowledge && !r.canDequeue,"cannot retire local/remote queue");
  check(!r.warningDelivered,"cannot assert warning delivery");
  check(!r.physicalGateVerified,"cannot assert gate position");
}
int main() {
  const char *local="{\"accepted\":true,\"status\":\"LOCAL_DURABLE_ADMISSION_ONLY\"}";
  const char *duplicate="{\"accepted\":false,\"status\":\"replay-or-identity-mismatch\"}";
  const char *fake="{\"accepted\":true,\"status\":\"CLOUD_CONFIRMED\"}";
  check(classify(201,local)==Outcome::LocalAdmissionOnly,"exact signed ingress local 201");
  check(classify(200,local)==Outcome::UnverifiedResponse,"HTTP 200 never local receipt");
  check(classify(202,local)==Outcome::UnverifiedResponse,"HTTP 202 never local receipt");
  check(classify(409,duplicate)==Outcome::DuplicateOrIdentityConflict,
    "replay conflict not admitted as new event");
  check(classify(201,fake)==Outcome::UnverifiedResponse,"fake 201 cloud claim rejected");
  check(classify(201,"{\"accepted\":true}")==Outcome::UnverifiedResponse,
    "missing receipt fields rejected");
  check(classify(201,"{\"status\":\"LOCAL_DURABLE_ADMISSION_ONLY\",\"accepted\":true}")==
    Outcome::UnverifiedResponse,"unexpected JSON representation is unverified");
  check(classify(409,local)==Outcome::UnverifiedResponse,"409 no successful local receipt");
  check(classify(403,duplicate)==Outcome::Rejected,"source revoked is denied");
  check(classify(422,duplicate)==Outcome::Rejected,"stale envelope is denied");
  check(classify(503,local)==Outcome::NetworkUncertain,"unready backend not confirmed");
  check(classify(0,local)==Outcome::UnverifiedResponse,"missing HTTP response unverified");
  check(classify(201,nullptr)==Outcome::UnverifiedResponse,"null response unverified");
  for (auto outcome : {
    Outcome::InvalidInput,Outcome::TrustUnavailable,Outcome::NetworkUncertain,
    Outcome::LocalAdmissionOnly,Outcome::DuplicateOrIdentityConflict,
    Outcome::Rejected,Outcome::UnverifiedResponse
  }) noCloud(outcome);
  printf("PASS %u BearSSL response policy checks\n",checks);
  return 0;
}
