/*
 * FloodGuard ESP8266 — COMPILE-ONLY diagnostic sketch, NOT release firmware.
 * Built against ESP8266 Arduino core 3.1.2. Generic ESP8266 board assumed.
 *
 * Original confidential v6 firmware is NOT included or modified here.
 * This sketch only inspects Arduino UNO v6 FG UART packets. It cannot send
 * cloud traffic, create signed identities, flash itself, read Firebase,
 * actuate the servo, silence alarms, or attest physical water safety.
 *
 * GPIO14 (ESP D5) RX  <- UNO D3 TX via proper 5V->3.3V level divider.
 * GPIO12 (ESP D6) TX  -> UNO D2 RX (unused in this diagnostic).
 * Common GND. Bench wiring MUST be inspected before connecting hardware.
 */
#ifndef FG_DIAGNOSTIC_BUILD_ONLY
#error "Review-only diagnostic sketch. Supply FG_DIAGNOSTIC_BUILD_ONLY for CI build; never flash as a controller replacement."
#endif
#if defined(FG_ENABLE_UPLOAD) || defined(FG_ENABLE_FIREBASE) || defined(FG_ENABLE_GATE)
#error "Network publishing, legacy Firebase and physical gate control are prohibited in this review build."
#endif

#include <Arduino.h>
#include <ESP8266WiFi.h>
#include <SoftwareSerial.h>
#include <WiFiClientSecureBearSSL.h>
#include <time.h>
#include "V6SerialParser.h"
#include "SecureIngressTransport.h"
#include "OneFrameLittleFsStore.h"
#include "EightSlotLittleFsAdapter.h"
#include "ExclusiveCreateLifecycle.h"
#include "JournalBootAudit.h"
#include "ReadOnlyOwnerQueue.h"
#include "CooperativeReadOnlyAuditPump.h"
#include "ReviewFlashInventory.h"

// Compile-check the strictly local typed future-write observation protocol.
// No instance is constructed; no write API, direct core access or cloud ACK.
static_assert(sizeof(floodguard_retained_review::ExclusiveCreateLifecycle) > 0,
              "Local-only exclusive-create lifecycle must remain portable");

// The boot-audit type only inventories pre-existing records; it has no
// authorization to append or ACK after reboot. No object is instantiated.
static_assert(sizeof(floodguard_retained_review::JournalBootAudit) > 0,
              "Read-only reboot audit must compile without activation");

// A bounded, single-consumer audit request policy is compile-checked only.
// No owner task, filesystem action, credential or gate actuator is started.
static_assert(sizeof(floodguard_retained_review::ReadOnlyOwnerQueue) > 0,
              "Portable review-only audit queue must compile on NodeMCU");

// Actual pinned core 3.1.2 SDK declarations only; sizeof is unevaluated.
// These checks do NOT read or measure the attached board's flash geometry.
// Never log device identifiers, format, mount, or derive OTA/FS offsets here.
static_assert(sizeof(ESP.getFlashChipRealSize()) == sizeof(uint32_t),
              "Pinned core must expose detected flash byte count API");
static_assert(sizeof(ESP.getFlashChipSize()) == sizeof(uint32_t),
              "Pinned core must expose configured flash byte count API");
static_assert(sizeof(ESP.getSketchSize()) == sizeof(uint32_t),
              "Pinned core must expose compiled sketch size API");
static_assert(sizeof(ESP.getFreeSketchSpace()) == sizeof(uint32_t),
              "Pinned core must expose available sketch space API");
static_assert(sizeof(floodguard_retained_review::ReviewFlashInventory) > 0,
              "Host-only geometry evidence classification must compile");
static_assert(sizeof(floodguard_retained_review::CooperativeReadOnlyAuditPump) > 0,
              "Single-loop read-only pump must compile, never activate");

// Compile-only eight-slot journal; no filesystem mount, writes, ACK or uploads.
// Do NOT flash as the working flood-warning controller.
static_assert(sizeof(floodguard_retained_review::LittleFsEightSlots) > 0,
              "Bounded LittleFS adapter must compile and remain dormant");

// Compile-check LittleFS record preservation; do NOT mount the flash or
// create/write any file in setup() or loop(). The live device remains untouched.
static_assert(sizeof(floodguard_retained_review::LittleFsOneFrame) > 0,
              "LittleFS retaining module must compile but remain dormant");

// The transport implementation is COMPILED but NEVER called: there is no
// signed event, device secret, trusted CA, gateway or approved bench Wi-Fi.
// A build passing does not constitute a real MCU-side TLS handshake.
static_assert(sizeof(floodguard_transport_review::Endpoint) > 0,
              "ESP8266 BearSSL transport contract must compile");

namespace {
constexpr uint8_t kUartRxGpio = 14;
constexpr uint8_t kUartTxGpio = 12;
constexpr unsigned long kUnoTimeoutMs = 5000UL;
constexpr size_t kMaxUartBytes = 127;
SoftwareSerial unoSerial(kUartRxGpio, kUartTxGpio);
char line[kMaxUartBytes + 1] = {};
size_t lineLength = 0;
bool discardUntilNewline = false;
uint32_t highestSequenceThisBoot = 0; // NOT a durable replay anchor
unsigned long lastValidPacketMs = 0;
bool receivedPacketThisBoot = false;
uint32_t invalidPackets = 0;
uint32_t reportedFaults = 0;

// Compile-check BearSSL trust-anchor APIs. Deliberately never called:
// there is NO externally provisioned CA, signed identity, secure clock,
// real authenticated gateway hostname, or reviewed TLS endpoint yet.
bool configureTlsTrustForFutureReview(
  BearSSL::WiFiClientSecure &client,
  const BearSSL::X509List *trustedCa,
  time_t trustedUtcSeconds
) {
  if (trustedCa == nullptr || trustedUtcSeconds < 1700000000) return false;
  client.setX509Time(trustedUtcSeconds);
  client.setTrustAnchors(trustedCa);
  return true;
}

void inspectLine() {
  if (lineLength == 0) return;
  const auto result = floodguard_review::inspect(
    line, lineLength, highestSequenceThisBoot
  );
  if (result.result == floodguard_review::Result::Rejected) {
    ++invalidPackets;
    Serial.println(F("FG_DIAGNOSTIC_REJECTED_UNTRUSTED"));
    return;
  }
  highestSequenceThisBoot = result.sequence;
  lastValidPacketMs = millis();
  receivedPacketThisBoot = true;
  if (result.result == floodguard_review::Result::UntrustedSensorFault) {
    ++reportedFaults;
    Serial.println(F("FG_DIAGNOSTIC_SENSOR_FAULT_NO_SAFE_ASSERTION"));
    return;
  }
  // Never label source as trusted or safe; no device signature/receipt exists.
  Serial.println(F("FG_DIAGNOSTIC_WATER_UNTRUSTED_NOT_PUBLISHABLE"));
}

void pollSerial() {
  while (unoSerial.available() > 0) {
    const int raw = unoSerial.read();
    if (raw < 0) break;
    const char c = static_cast<char>(raw);
    if (c == '\n') {
      if (!discardUntilNewline) inspectLine();
      discardUntilNewline = false;
      lineLength = 0;
      continue;
    }
    if (discardUntilNewline) continue;
    if (c == '\r') continue;
    if (lineLength >= kMaxUartBytes) {
      ++invalidPackets;
      lineLength = 0;
      discardUntilNewline = true;
      continue;
    }
    line[lineLength++] = c;
  }
}
} // namespace

void setup() {
  Serial.begin(115200);
  unoSerial.begin(9600);
  WiFi.mode(WIFI_OFF); // Never connect, even with previously saved credentials.
  WiFi.persistent(false);
  Serial.println(F("FLOODGUARD_DIAGNOSTIC_ONLY_NO_CLOUD_NO_ACTUATION"));
  // Do not access real UNO while firmware/board-specific bench wiring is
  // unverified. Even reading a serial line is not evidence of sensor safety.
}
void loop() {
  pollSerial();
  if (receivedPacketThisBoot &&
      millis() - lastValidPacketMs > kUnoTimeoutMs) {
    receivedPacketThisBoot = false;
    Serial.println(F("FG_DIAGNOSTIC_UNO_STALE_UNKNOWN"));
  }
  yield();
}
