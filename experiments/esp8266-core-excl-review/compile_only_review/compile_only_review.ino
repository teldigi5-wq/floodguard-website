/*
 * FloodGuard R2: version-pinned isolated CI compiler witness.
 * NEVER flash. This sample does not mount, read, write or operate hardware.
 * It deliberately references the proposed extension through the FS public API.
 */
#ifndef FG_ISOLATED_CORE_OVERLAY_REVIEW
#error "Compile only using temporary ESP8266 3.1.2 core overlay in isolated CI"
#endif
#include <Arduino.h>
#include <LittleFS.h>
#include <type_traits>
#include <utility>

using Result = decltype(std::declval<fs::FS&>().createExclusiveLocal(
    static_cast<const char*>(nullptr),
    static_cast<const uint8_t*>(nullptr),
    static_cast<size_t>(0)));
static_assert(std::is_same<Result, fs::ExclusiveLocalResult>::value,
              "Expected typed experimental public FS exclusive-create API");
static_assert(sizeof(littlefs_impl::LittleFSImpl) > 0,
              "Pinned LittleFS core implementation must be linked");

// This function is intentionally never invoked. The volatile guard keeps a
// linker-visible, compile-checked reference without performing flash I/O.
volatile bool fgNeverCallReviewApi = false;
__attribute__((used, noinline))
void reviewApiLinkReferenceOnly() {
  if (fgNeverCallReviewApi) {
    const uint8_t example[] = {0x46, 0x47, 0x50, 0x31};
    volatile auto outcome = LittleFS.createExclusiveLocal(
        "/fg-compile-only.bin", example, sizeof(example));
    (void)outcome;
  }
}
void setup() {}
void loop() {}
