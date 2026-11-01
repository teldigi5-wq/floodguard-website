// Runs the EXACT parser header compiled into the ESP8266 diagnostic sketch.
// Independent of Node.js reimplementation: host g++ -std=c++11 -Werror.
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <string>
#include "../firmware/esp8266_review_diagnostic/V6SerialParser.h"
using floodguard_review::Result;
using floodguard_review::Risk;

static unsigned passed = 0;
static void check(bool truth, const char *message) {
  if (!truth) {
    fprintf(stderr, "FAIL: %s\n", message);
    exit(1);
  }
  ++passed;
}
static std::string packet(
  const char *seq = "1", const char *distance = "16.50",
  const char *risk = "WARNING", const char *buzzer = "0",
  const char *gate = "CLOSED", const char *angle = "0",
  const char *seconds = "0", const char *rtc = "1"
) {
  std::string body = std::string("FG,") + seq + "," + distance + "," +
    risk + "," + buzzer + "," + gate + "," + angle + "," +
    seconds + "," + rtc;
  uint8_t crc = 0;
  for (size_t i = 0; i < body.size(); ++i)
    crc ^= static_cast<uint8_t>(body[i]);
  char suffix[4] = {};
  snprintf(suffix, sizeof(suffix), ",%02X", crc);
  return body + suffix;
}
static floodguard_review::Observation parse(const std::string &s,
                                             uint32_t previous = 0) {
  return floodguard_review::inspect(s.data(), s.size(), previous);
}
static bool rejected(const std::string &s, uint32_t previous = 0) {
  return parse(s, previous).result == Result::Rejected;
}
int main() {
  const auto warning = parse(packet());
  check(warning.result == Result::UntrustedWater,"valid original FG UART shape");
  check(warning.risk == Risk::Warning, "warning enum");
  check(warning.sequence == 1 && warning.distance100 == 1650 &&
        warning.level100 == 850, "exact fixed-point reservoir conversion");
  check(!warning.reportedBuzzer && warning.reportedRtc,
        "reported buzzer/RTC not authoritative");
  check(strcmp(warning.reportedGate,"CLOSED") == 0,
        "gate is observed status string, never servo position proof");
  for (const auto &sample : {
    packet("1","25.00","SAFE"),
    packet("1","16.51","SAFE"),
    packet("1","16.50","WARNING"),
    packet("1","14.01","WARNING"),
    packet("1","14.00","DANGER"),
    packet("1","2.00","DANGER")
  }) check(parse(sample).result == Result::UntrustedWater,
    "UNO real 8.5 / 11.0 thresholds");
  for (const auto &sample : {
    packet("1","25.01","SAFE"),packet("1","26.00","SAFE"),
    packet("1","100.00","SAFE"),packet("1","400.00","SAFE"),
    packet("1","13.00","SAFE"),packet("1","15.00","DANGER")
  }) check(rejected(sample),"uncalibrated or contradictory SAFE/DANGER denied");
  const auto fault = parse(packet("2","-1.00","SENSOR_ERROR"));
  check(fault.result == Result::UntrustedSensorFault &&
        fault.risk == Risk::SensorError, "fault segregated; no numeric SAFE");
  check(rejected(packet("1","-1.00","SAFE")), "negative distance denied");
  check(rejected(packet("1","16.50","SENSOR_ERROR")),
        "numeric fault conflation denied");
  for (const auto &sample : {
    packet("0"),packet("2147483648"),packet("01"),packet("4","NaN"),
    packet("4","1e2"),packet("4","0x11"),packet("4","12.345"),
    packet("4","00.01"),packet("4","1.00"),packet("4","16.50","BAD"),
    packet("4","16.50","WARNING","2"),packet("4","16.50",
      "WARNING","0","OPEN","0"),
    packet("4","16.50","WARNING","0","CLOSED","90"),
    packet("4","16.50","WARNING","0","COUNTDOWN","0"),
    packet("4","16.50","WARNING","0","CLOSED","0","1"),
    packet("4","16.50","WARNING","0","CLOSED","0","0","9"),
    packet("4","16.50","WARNING","0","CLOSED","0","0","00")
  }) check(rejected(sample),"unsafe legacy coercion/enum/gate denied");
  const auto good = packet("9","14.00","DANGER","1","OPEN","90");
  check(parse(good).result == Result::UntrustedWater,"forged but valid XOR is NOT authenticated");
  check(rejected(good,9), "source sequence replay denied");
  check(rejected(good,10), "source sequence rollback denied");
  auto corrupt = good;
  corrupt[corrupt.find("14.00")] = '1';
  corrupt[corrupt.find("14.00")+1] = '5';
  check(rejected(corrupt),"checksum mismatch denied");
  check(rejected(good + "\r\n"),"parser requires framed packet length without CRLF");
  check(rejected(std::string(128,'x')),"bounded 127 byte Arduino receive frame");
  check(rejected(std::string("FG,1,") + std::string(1,'\0') +
      ",SAFE,0,CLOSED,0,0,1,00"),"embedded NUL denied");
  check(rejected(packet("4","16.50","WARNING").substr(0,8)),
    "truncated packet denied");
  check(rejected(std::string("RG,") + packet()),
    "rain protocol not silently converted to water");
  const auto wrap = packet("5","16.50","WARNING");
  check(parse(wrap,2147483648UL).result==Result::Rejected,
        "invalid prior high-water refused");
  printf("PASS %u ESP8266 header-level checks\n",passed);
  return 0;
}
