#pragma once
// Portable, allocation-free response contract, shared with ESP8266 BearSSL
// transport. A signed LOCAL journal admission is never Firebase publication,
// independent witness, human warning delivery, or permission to clear queues.
#include <stdint.h>
#include <string.h>
namespace floodguard_transport_review {
enum class Outcome : uint8_t {
  InvalidInput, TrustUnavailable, NetworkUncertain, LocalAdmissionOnly,
  DuplicateOrIdentityConflict, Rejected, UnverifiedResponse
};
struct Result {
  Outcome outcome;
  bool cloudConfirmed;
  bool canAcknowledge;
  bool canDequeue;
  bool warningDelivered;
  bool physicalGateVerified;
};
inline Result result(Outcome outcome) {
  return {outcome, false, false, false, false, false};
}
// Fixed protocol from local loopback signer. No dynamic JSON inference and
// no token, clock or signature may be introduced through response content.
// Do NOT interpret a replay response as safe retransmission or cloud ACK.
inline Outcome classify(uint16_t code, const char *body) {
  if (!body) return Outcome::UnverifiedResponse;
  if (code == 201 &&
      strcmp(body, "{\"accepted\":true,\"status\":\"LOCAL_DURABLE_ADMISSION_ONLY\"}") == 0)
    return Outcome::LocalAdmissionOnly;
  if (code == 409 &&
      strcmp(body, "{\"accepted\":false,\"status\":\"replay-or-identity-mismatch\"}") == 0)
    return Outcome::DuplicateOrIdentityConflict;
  if (code == 503) return Outcome::NetworkUncertain;
  if (code == 400 || code == 403 || code == 404 || code == 413 ||
      code == 415 || code == 422) return Outcome::Rejected;
  return Outcome::UnverifiedResponse;
}
} // namespace floodguard_transport_review
