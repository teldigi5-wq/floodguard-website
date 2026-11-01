#pragma once
// FloodGuard — ESP8266 BearSSL transport implementation, COMPILE-ONLY REVIEW.
// NOT called from the diagnostic sketch. No Wi-Fi credentials, signing key,
// socket listener, default host, Firebase write, alert, ACK or gate control.
//
// A future owner-approved firmware port must supply all settings through a
// separately protected provisioning flow and persist the signed event safely.
// A local HTTP 201 is NOT cloud publication. No trust-all TLS fallback.
#include <Arduino.h>
#include <WiFiClientSecureBearSSL.h>
#include <stdint.h>
#include <string.h>
#include <time.h>

namespace floodguard_transport_review {
enum class Outcome : uint8_t {
  InvalidInput,
  TrustUnavailable,
  NetworkUncertain,
  LocalAdmissionOnly,
  DuplicateOrIdentityConflict,
  Rejected,
  UnverifiedResponse
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
struct Endpoint {
  const char *hostname;              // valid DNS name, not an HTTP URL
  uint16_t port;                      // intended 443; explicit bench port only
  const BearSSL::X509List *trustedCa; // owned by caller, valid for entire call
  time_t trustedUtc;                  // trusted clock, not derived from peer
};
struct PreparedFrame {
  const char *signedJson; // pre-signed Stage 7 envelope + signature; not created here
  size_t bytes;
};
// Hard bounded request/response sizes to constrain RAM on small ESP8266.
constexpr size_t kMaxRequest = 1024;
constexpr size_t kMaxBody = 160;
constexpr size_t kMaxLine = 160;
constexpr unsigned long kTimeoutMs = 2500UL;
constexpr char kPath[] = "/synthetic/v1/ingest";

inline bool validHostname(const char *host) {
  if (!host) return false;
  const size_t len = strlen(host);
  if (len < 1 || len > 120 || host[0] == '-' || host[len-1] == '-'
      || host[0] == '.' || host[len-1] == '.') return false;
  bool previousDot = false;
  for (size_t i = 0; i < len; ++i) {
    const char c = host[i];
    const bool alnum = (c >= 'a' && c <= 'z') ||
      (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9');
    if (!alnum && c != '.' && c != '-') return false;
    if (c == '.') {
      if (previousDot || host[i-1] == '-' || host[i+1] == '-') return false;
      previousDot = true;
    } else previousDot = false;
  }
  return true;
}
inline bool prepared(const PreparedFrame &frame) {
  if (!frame.signedJson || frame.bytes < 90 || frame.bytes > kMaxRequest)
    return false;
  // No automatic JSON canonicalization: preserve the immutable signed body.
  // Reject HTTP control characters and embedded NULs; never log payloads.
  for (size_t i = 0; i < frame.bytes; ++i) {
    const unsigned char c = static_cast<unsigned char>(frame.signedJson[i]);
    if (c < 0x20 || c > 0x7e) return false;
  }
  return strnlen(frame.signedJson, kMaxRequest + 1) == frame.bytes &&
    strncmp(frame.signedJson, "{\"envelope\":", 12) == 0 &&
    strstr(frame.signedJson, "\"signature\":\"") != nullptr;
}
inline bool readLine(BearSSL::WiFiClientSecure &client, char *dest,
                     size_t capacity, unsigned long started) {
  size_t used = 0;
  while (millis() - started <= kTimeoutMs) {
    if (client.available() <= 0) {
      if (!client.connected()) return false;
      delay(1);
      continue;
    }
    const int c = client.read();
    if (c < 0) continue;
    if (c == '\n') {
      if (used > 0 && dest[used-1] == '\r') --used;
      dest[used] = 0;
      return true;
    }
    if (used + 1 >= capacity || (c < 0x20 && c != '\r') || c > 0x7e)
      return false;
    dest[used++] = static_cast<char>(c);
  }
  return false;
}
inline bool casePrefix(const char *actual, const char *prefix) {
  if (!actual || !prefix) return false;
  for (size_t i = 0; prefix[i]; ++i) {
    if (!actual[i]) return false;
    char a = actual[i], b = prefix[i];
    if (a >= 'A' && a <= 'Z') a += 'a' - 'A';
    if (b >= 'A' && b <= 'Z') b += 'a' - 'A';
    if (a != b) return false;
  }
  return true;
}
inline bool parseContentLength(const char *raw, uint16_t &out) {
  if (!raw || !*raw) return false;
  uint16_t length = 0;
  for (const char *c = raw; *c; ++c) {
    if (*c < '0' || *c > '9') return false;
    const unsigned digit = static_cast<unsigned>(*c - '0');
    if (length > (kMaxBody - digit) / 10) return false;
    length = static_cast<uint16_t>(length * 10 + digit);
  }
  if (length == 0 || length > kMaxBody) return false;
  out = length;
  return true;
}
// Only a fixed local response protocol is accepted. This is NOT a cloud
// receipt, and arbitrary "success" or another HTTP 201 is unverified.
inline Outcome classify(uint16_t code, const char *body) {
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
/**
 * Not called by sketch. Produces a *local-only* preflight observation and
 * cannot authorize journal/flash deletion, cloud status or flood clearance.
 * A real ESP8266 signing and retained-outbox subsystem does not exist yet.
 *
 * Certificate validation happens in BearSSL::connect(hostname,...), using
 * the caller's CA trust anchors and sane trusted UTC clock. No insecure
 * fallback, certificate fingerprint shortcut or direct Firebase endpoint.
 */
inline Result submitPreparedFrame(
    const Endpoint &endpoint, const PreparedFrame &frame) {
  if (!validHostname(endpoint.hostname) || endpoint.port == 0 ||
      !prepared(frame)) return result(Outcome::InvalidInput);
  if (endpoint.trustedCa == nullptr ||
      endpoint.trustedUtc < static_cast<time_t>(1700000000))
    return result(Outcome::TrustUnavailable);

  BearSSL::WiFiClientSecure client;
  client.setTrustAnchors(endpoint.trustedCa);
  client.setX509Time(endpoint.trustedUtc);
  client.setTimeout(kTimeoutMs);
  if (!client.connect(endpoint.hostname, endpoint.port)) {
    client.stop();
    return result(Outcome::NetworkUncertain);
  }
  // HTTP/1.1 body is already signed elsewhere; do NOT reserialize/resequence.
  client.print(F("POST ")); client.print(kPath);
  client.print(F(" HTTP/1.1\r\nHost: "));
  client.print(endpoint.hostname);
  client.print(F("\r\nContent-Type: application/json\r\n"));
  client.print(F("Connection: close\r\nCache-Control: no-store\r\n"));
  client.print(F("Content-Length: "));
  client.print(frame.bytes);
  client.print(F("\r\n\r\n"));
  if (client.write(reinterpret_cast<const uint8_t *>(frame.signedJson),
                   frame.bytes) != frame.bytes) {
    client.stop();
    return result(Outcome::NetworkUncertain);
  }
  const unsigned long started = millis();
  char line[kMaxLine] = {};
  if (!readLine(client, line, sizeof(line), started) ||
      strncmp(line, "HTTP/1.1 ", 9) != 0 ||
      strlen(line) < 12 ||
      line[9] < '0' || line[9] > '9' ||
      line[10] < '0' || line[10] > '9' ||
      line[11] < '0' || line[11] > '9') {
    client.stop();
    return result(Outcome::UnverifiedResponse);
  }
  const uint16_t status = static_cast<uint16_t>(
      (line[9]-'0')*100 + (line[10]-'0')*10 + (line[11]-'0'));
  uint16_t expectedLength = 0;
  bool hasLength = false, hasJson = false;
  for (unsigned headers = 0; headers < 20; ++headers) {
    if (!readLine(client, line, sizeof(line), started)) {
      client.stop(); return result(Outcome::UnverifiedResponse);
    }
    if (line[0] == 0) break;
    if (casePrefix(line, "Content-Length: ")) {
      if (hasLength || !parseContentLength(line + 16, expectedLength)) {
        client.stop(); return result(Outcome::UnverifiedResponse);
      }
      hasLength = true;
    }
    if (casePrefix(line, "Content-Type: application/json")) {
      const size_t prefixLen = strlen("Content-Type: application/json");
      if (line[prefixLen] == 0 || line[prefixLen] == ';') hasJson = true;
    }
    if (headers == 19) { client.stop(); return result(Outcome::UnverifiedResponse); }
  }
  if (!hasLength || !hasJson) {
    client.stop(); return result(Outcome::UnverifiedResponse);
  }
  char body[kMaxBody + 1] = {};
  size_t received = 0;
  while (received < expectedLength && millis() - started <= kTimeoutMs) {
    if (client.available() <= 0) {
      if (!client.connected()) break;
      delay(1); continue;
    }
    const int byte = client.read();
    if (byte < 0) continue;
    if (byte < 0x20 && byte != '\r' && byte != '\n') break;
    body[received++] = static_cast<char>(byte);
  }
  client.stop();
  if (received != expectedLength) return result(Outcome::NetworkUncertain);
  body[received] = 0;
  return result(classify(status, body));
}
} // namespace floodguard_transport_review
