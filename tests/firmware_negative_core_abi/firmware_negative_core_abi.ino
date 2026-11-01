/*
 * FloodGuard R2 — COMPILE-FAIL NEGATIVE TEST for ESP8266 Arduino core 3.1.2.
 * Do not flash this test sketch; it intentionally accesses protected APIs.
 * Its sole purpose is to prove that direct access to the mounted LittleFS
 * internals is NOT a supported firmware integration option.
 */
#ifndef FG_CORE_ABI_NEGATIVE_TEST
#error "Never build or flash this intentionally broken ABI test as a device program."
#endif
#include <Arduino.h>
#include <LittleFS.h>

#if defined(FG_NEGATIVE_GET_IMPL) == defined(FG_NEGATIVE_GET_FS)
#error "Select exactly one protected-access negative test."
#endif

void verifyInaccessibleFilesystemInternals() {
#if defined(FG_NEGATIVE_GET_IMPL)
  // FS::getImpl() is protected in pinned cores/esp8266/FS.h.
  // Must produce a compiler error, not a valid firmware build.
  fs::FSImplPtr implementation = LittleFS.getImpl();
  (void)implementation;
#elif defined(FG_NEGATIVE_GET_FS)
  // LittleFSImpl::getFS() is protected in pinned LittleFS.h.
  // Never create a second mount or an unsupported lfs_t access path.
  littlefs_impl::LittleFSImpl *implementation = nullptr;
  lfs_t *internal = implementation->getFS();
  (void)internal;
#endif
}
void setup() {}
void loop() {}
