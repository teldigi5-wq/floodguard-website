// Compiles and runs the same byte codec included by the NodeMCU firmware.
// Simulates torn writes and tampering. NO flash writes or real power cycling.
#include <array>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>
#include "../firmware/esp8266_review_diagnostic/RetainedFrameCodec.h"
using namespace floodguard_retained_review;
static unsigned checks=0;
static void check(bool ok, const char *why) {
  if (!ok) { std::fprintf(stderr,"FAIL: %s\n",why); std::exit(1); }
  ++checks;
}
int main() {
  const std::string signedExample =
    std::string("{\"envelope\":{\"deviceId\":\"device-stage-a\",\"sequence\":1},")
      + "\"signature\":\"" + std::string(86,'A') + "\"}";
  std::array<uint8_t,kMaxRecord> encoded={};
  size_t n=0;
  check(encode(1,signedExample.c_str(),signedExample.size(),encoded.data(),
    encoded.size(),n)==Status::Valid,"persistable fixture");
  check(n==signedExample.size()+14,"exact bounded encoded length");
  check(encoded[0]=='F'&&encoded[1]=='G'&&encoded[2]=='P'&&encoded[3]=='1',
    "versioned magic");
  check(be32(encoded.data()+4)==1,"network-byte-order sequence");
  Frame recovered={};
  check(decode(encoded.data(),n,recovered)==Status::Valid,"full readback");
  check(recovered.sequence==1&&recovered.size==signedExample.size()&&
    signedExample==recovered.signedBody,"same original immutable signed bytes");
  check(mayStage(false,true)==Status::Valid,"empty healthy slot may stage");
  check(mayStage(true,true)==Status::ExistingUnacknowledged,
    "existing record is never overwritten even if re-sent");
  check(mayStage(false,false)==Status::StorageUncertain,
    "unknown filesystem status blocks writes");
  check(mayStage(true,false)==Status::StorageUncertain,
    "corrupt or unreadable storage blocks writes");
  for(size_t truncated=0;truncated<n;truncated++)
    check(decode(encoded.data(),truncated,recovered)==Status::DamagedOrPartial,
      "torn write must not be accepted");
  for(size_t i=0;i<n;i+=11) {
    auto mutated=encoded;
    mutated[i]^=0x01;
    check(decode(mutated.data(),n,recovered)==Status::DamagedOrPartial,
      "single bit damage must fail CRC or format");
  }
  auto malformed=encoded;
  malformed[7]=0; // zero sequence
  check(decode(malformed.data(),n,recovered)==Status::DamagedOrPartial,
    "zero sequence rejected");
  malformed=encoded;
  malformed[8]=0xff; malformed[9]=0xff;
  check(decode(malformed.data(),n,recovered)==Status::DamagedOrPartial,
    "impossible body length rejected");
  malformed=encoded;
  malformed[n-1]^=0xff;
  check(decode(malformed.data(),n,recovered)==Status::DamagedOrPartial,
    "tampered crc rejected");
  check(encode(0,signedExample.c_str(),signedExample.size(),encoded.data(),
    encoded.size(),n)==Status::InvalidInput,"sequence 0 rejected");
  check(encode(kMaxSequence+1,signedExample.c_str(),signedExample.size(),
    encoded.data(),encoded.size(),n)==Status::InvalidInput,
    "sequence overflow rejected");
  check(encode(1,signedExample.c_str(),signedExample.size(),
    encoded.data(),signedExample.size()+13,n)==Status::InvalidInput,
    "undersized output refused before write");
  check(encode(1,signedExample.c_str(),signedExample.size(),
    nullptr,kMaxRecord,n)==Status::InvalidInput,"null destination rejected");
  check(encode(1,signedExample.c_str(),signedExample.size(),
    encoded.data(),encoded.size(),n)==Status::Valid,"valid fixture again");
  std::string invalid=signedExample;
  invalid[1]='\n';
  check(encode(2,invalid.c_str(),invalid.size(),encoded.data(),
    encoded.size(),n)==Status::InvalidInput,"embedded newline refused");
  invalid=signedExample;
  invalid[0]='[';
  check(encode(2,invalid.c_str(),invalid.size(),encoded.data(),
    encoded.size(),n)==Status::InvalidInput,"non-object signed body refused");
  std::string tooLong="{"+std::string(1024,'a')+"}";
  check(encode(3,tooLong.c_str(),tooLong.size(),encoded.data(),
    encoded.size(),n)==Status::InvalidInput,"frame >1024 refused");
  check(decode(nullptr,130,recovered)==Status::DamagedOrPartial,
    "null flash read rejected");
  check(decode(encoded.data(),kMaxRecord+1,recovered)==Status::DamagedOrPartial,
    "oversized flash read rejected");
  std::printf("PASS %u retained-frame codec and power-cut simulation checks\n",checks);
  return 0;
}
