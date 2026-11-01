#pragma once
// FloodGuard v6 ESP8266 migration: secret-free *diagnostic* serial parser.
// Mirrors recovered UNO: FG,seq,distance,water,buzzer,gate,angle,countdown,rtc,XX
// XX is XOR of all bytes before the last comma. XOR IS NOT AUTHENTICATION.
// No heap, Arduino API, TLS, cloud, or actuator dependency.
#include <stddef.h>
#include <stdint.h>
#include <string.h>

namespace floodguard_review {
enum class Result : uint8_t {
  Rejected = 0,
  UntrustedWater = 1,
  UntrustedSensorFault = 2
};
enum class Risk : uint8_t { Unknown, Safe, Warning, Danger, SensorError };
struct Observation {
  Result result;
  Risk risk;
  uint32_t sequence;
  int32_t distance100;
  int32_t level100;
  bool reportedBuzzer;
  bool reportedRtc;
  uint8_t reportedAngle;
  uint8_t reportedCountdown;
  // No proof of gate position exists in v6. This field is ONLY a claim.
  char reportedGate[17];
};
inline Observation rejected() {
  Observation o = {};
  o.result = Result::Rejected;
  o.risk = Risk::Unknown;
  return o;
}
inline bool equals(const char *a, const char *b) {
  return strcmp(a, b) == 0;
}
inline bool parseUnsigned(const char *s, uint32_t maxValue, uint32_t &out) {
  if (!s || !*s || (*s == '0' && s[1])) return false;
  uint32_t n = 0;
  for (const char *p = s; *p; ++p) {
    if (*p < '0' || *p > '9') return false;
    const uint32_t d = static_cast<uint32_t>(*p - '0');
    if (n > (maxValue - d) / 10) return false;
    n = n * 10 + d;
  }
  out = n;
  return true;
}
inline bool parseCentimeters100(const char *s, int32_t &out) {
  // The recovered UNO emits dtostrf(..., 1, 2). Reject coercion, exponent,
  // negative zero, excess precision and values outside 2..400 cm.
  if (!s || !*s || *s == '-') return false;
  uint32_t whole = 0, fraction = 0;
  const char *dot = strchr(s, '.');
  if (!dot || dot == s || strlen(dot + 1) != 2) return false;
  char digits[8] = {};
  const size_t wholeLen = static_cast<size_t>(dot - s);
  if (wholeLen >= sizeof(digits)) return false;
  memcpy(digits, s, wholeLen);
  if (!parseUnsigned(digits, 400, whole)) return false;
  if (!parseUnsigned(dot + 1, 99, fraction)) {
    // A two-digit fractional value such as "00" is canonical on UNO.
    if (dot[1] < '0' || dot[1] > '9' ||
        dot[2] < '0' || dot[2] > '9' || dot[3] != 0) return false;
    fraction = static_cast<uint32_t>((dot[1] - '0') * 10 + (dot[2] - '0'));
  }
  const uint32_t centimeters100 = whole * 100U + fraction;
  if (centimeters100 < 200U || centimeters100 > 40000U) return false;
  out = static_cast<int32_t>(centimeters100);
  return true;
}
inline int nibble(char c) {
  if (c >= '0' && c <= '9') return c - '0';
  if (c >= 'a' && c <= 'f') return c - 'a' + 10;
  if (c >= 'A' && c <= 'F') return c - 'A' + 10;
  return -1;
}
inline bool gateMatches(const char *name, uint32_t angle, uint32_t remaining) {
  if (equals(name, "CLOSED")) return angle <= 2 && remaining == 0;
  if (equals(name, "OPEN")) return angle >= 80 && remaining == 0;
  if (equals(name, "COUNTDOWN") || equals(name, "OPENING_WARNING"))
    return remaining >= 1;
  return false;
}
inline Observation inspect(const char *line, size_t len, uint32_t lastSequence) {
  Observation out = rejected();
  if (!line || len == 0 || len > 127 || lastSequence > 2147483647UL)
    return out;
  size_t lastComma = 0;
  for (size_t i = 0; i < len; ++i) {
    const unsigned char b = static_cast<unsigned char>(line[i]);
    if (b < 0x20 || b > 0x7e) return out;
    if (line[i] == ',') lastComma = i;
  }
  if (lastComma == 0 || len != lastComma + 3) return out;
  const int high = nibble(line[lastComma + 1]);
  const int low = nibble(line[lastComma + 2]);
  if (high < 0 || low < 0) return out;
  uint8_t xorChecksum = 0;
  for (size_t i = 0; i < lastComma; ++i)
    xorChecksum ^= static_cast<uint8_t>(line[i]);
  if (xorChecksum != static_cast<uint8_t>((high << 4) | low)) return out;
  char body[128] = {};
  memcpy(body, line, lastComma);
  const char *fields[9] = {};
  fields[0] = body;
  uint8_t count = 1;
  for (size_t i = 0; i < lastComma; ++i) {
    if (body[i] != ',') continue;
    if (count >= 9) return out;
    body[i] = 0;
    fields[count++] = body + i + 1;
  }
  if (count != 9 || !equals(fields[0], "FG")) return out;
  for (uint8_t i = 0; i < 9; ++i) if (!fields[i] || !*fields[i]) return out;
  uint32_t sequence = 0, buzzer = 0, angle = 0, remaining = 0, rtc = 0;
  if (!parseUnsigned(fields[1], 2147483647UL, sequence) ||
      sequence == 0 || sequence <= lastSequence ||
      !parseUnsigned(fields[4], 1, buzzer) ||
      !parseUnsigned(fields[6], 180, angle) ||
      !parseUnsigned(fields[7], 60, remaining) ||
      !parseUnsigned(fields[8], 1, rtc) ||
      !gateMatches(fields[5], angle, remaining)) return out;
  Risk risk = Risk::Unknown;
  if (equals(fields[3], "SAFE")) risk = Risk::Safe;
  else if (equals(fields[3], "WARNING")) risk = Risk::Warning;
  else if (equals(fields[3], "DANGER")) risk = Risk::Danger;
  else if (equals(fields[3], "SENSOR_ERROR")) risk = Risk::SensorError;
  else return out;
  if (strlen(fields[5]) >= sizeof(out.reportedGate)) return out;
  out.sequence = sequence;
  out.risk = risk;
  out.reportedBuzzer = (buzzer == 1);
  out.reportedRtc = (rtc == 1);
  out.reportedAngle = static_cast<uint8_t>(angle);
  out.reportedCountdown = static_cast<uint8_t>(remaining);
  memcpy(out.reportedGate, fields[5], strlen(fields[5]) + 1);
  if (risk == Risk::SensorError) {
    // The archived UNO usually emits -1.00. Never publish numeric SAFE.
    if (!equals(fields[2], "-1.00")) return rejected();
    out.result = Result::UntrustedSensorFault;
    return out;
  }
  int32_t d100 = 0;
  if (!parseCentimeters100(fields[2], d100)) return rejected();
  // Physical installation measured from 25 cm above reservoir bottom.
  // >25cm is uncalibrated, NOT automatically SAFE.
  if (d100 > 2500) return rejected();
  out.distance100 = d100;
  out.level100 = 2500 - d100;
  const Risk calculated = out.level100 >= 1100 ? Risk::Danger
      : out.level100 >= 850 ? Risk::Warning : Risk::Safe;
  if (risk != calculated) return rejected();
  out.result = Result::UntrustedWater;
  return out;
}
} // namespace floodguard_review
