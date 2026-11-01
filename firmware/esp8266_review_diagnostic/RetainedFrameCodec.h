#pragma once
// FloodGuard ESP8266 — compile-only, one-frame retained record codec.
// This does NOT sign or authenticate a reading. CRC32 detects accidental
// corruption; it is not a MAC and must not authorize device identity.
// No filesystem writes, network, RTC, gate or alarm control in this header.
#include <stddef.h>
#include <stdint.h>
#include <string.h>
namespace floodguard_retained_review {
constexpr size_t kMaxBody = 1024;
constexpr size_t kMaxRecord = kMaxBody + 14; // magic4 + seq4 + len2 + crc4
constexpr uint32_t kMaxSequence = 2147483647UL;
enum class Status : uint8_t {
  Valid, InvalidInput, DamagedOrPartial, ExistingUnacknowledged, StorageUncertain
};
struct Frame {
  uint32_t sequence;
  uint16_t size;
  char signedBody[kMaxBody + 1];
};
inline uint32_t be32(const uint8_t *p) {
  return (static_cast<uint32_t>(p[0]) << 24) |
         (static_cast<uint32_t>(p[1]) << 16) |
         (static_cast<uint32_t>(p[2]) << 8) | p[3];
}
inline void put32(uint8_t *p, uint32_t v) {
  p[0] = static_cast<uint8_t>(v >> 24);
  p[1] = static_cast<uint8_t>(v >> 16);
  p[2] = static_cast<uint8_t>(v >> 8);
  p[3] = static_cast<uint8_t>(v);
}
inline uint32_t crc32(const uint8_t *src, size_t len) {
  uint32_t crc = 0xffffffffUL;
  for (size_t i = 0; i < len; ++i) {
    crc ^= src[i];
    for (unsigned j = 0; j < 8; ++j)
      crc = (crc >> 1) ^ ((crc & 1U) ? 0xedb88320UL : 0U);
  }
  return ~crc;
}
inline bool validateBody(const char *body, size_t length) {
  if (!body || length < 90 || length > kMaxBody) return false;
  if (body[0] != '{' || body[length-1] != '}') return false;
  // The JSON body must already have been signed elsewhere. This just checks
  // transport-shaped bytes; signatures are NOT verified by this device codec.
  for (size_t i = 0; i < length; ++i) {
    const unsigned char c = static_cast<unsigned char>(body[i]);
    if (c < 0x20 || c > 0x7e) return false;
  }
  return true;
}
inline Status encode(uint32_t seq, const char *body, size_t bodyLength,
                     uint8_t *dest, size_t capacity, size_t &written) {
  written = 0;
  if (seq == 0 || seq > kMaxSequence || !dest ||
      !validateBody(body, bodyLength) ||
      capacity < bodyLength + 14) return Status::InvalidInput;
  dest[0] = 'F'; dest[1] = 'G'; dest[2] = 'P'; dest[3] = '1';
  put32(dest + 4, seq);
  dest[8] = static_cast<uint8_t>(bodyLength >> 8);
  dest[9] = static_cast<uint8_t>(bodyLength);
  memcpy(dest + 10, body, bodyLength);
  put32(dest + 10 + bodyLength, crc32(dest, bodyLength + 10));
  written = bodyLength + 14;
  return Status::Valid;
}
inline Status decode(const uint8_t *src, size_t sourceLength, Frame &frame) {
  frame = {};
  if (!src || sourceLength < 14 || sourceLength > kMaxRecord)
    return Status::DamagedOrPartial;
  if (src[0] != 'F' || src[1] != 'G' ||
      src[2] != 'P' || src[3] != '1')
    return Status::DamagedOrPartial;
  const uint32_t seq = be32(src + 4);
  const size_t bodyLength = static_cast<size_t>(
      (static_cast<uint16_t>(src[8]) << 8) | src[9]);
  if (seq == 0 || seq > kMaxSequence || bodyLength > kMaxBody ||
      bodyLength < 90 || sourceLength != bodyLength + 14 ||
      be32(src + 10 + bodyLength) != crc32(src, bodyLength + 10))
    return Status::DamagedOrPartial;
  memcpy(frame.signedBody, src + 10, bodyLength);
  frame.signedBody[bodyLength] = 0;
  if (!validateBody(frame.signedBody, bodyLength)) {
    frame = {};
    return Status::DamagedOrPartial;
  }
  frame.sequence = seq;
  frame.size = static_cast<uint16_t>(bodyLength);
  return Status::Valid;
}
// On any nonempty storage state, a second reading must never overwrite the
// previous signed event. There is intentionally no ACK/erase operation.
inline Status mayStage(bool recordExists, bool storageHealthy) {
  if (!storageHealthy) return Status::StorageUncertain;
  return recordExists ? Status::ExistingUnacknowledged : Status::Valid;
}
} // namespace floodguard_retained_review
