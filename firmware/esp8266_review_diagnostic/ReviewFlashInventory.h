#pragma once
// FloodGuard R2: review-only evidence classification, not device interrogation.
// Input values come from future supervised hardware inspection; host fixtures
// are synthetic and must NOT be called a measured board geometry.
// No guessed filesystem offset, mount, format, OTA selection, write or gate.
#include <stdint.h>

namespace floodguard_retained_review {
struct FlashInventoryObservation {
  uint32_t detectedFlashBytes;
  uint32_t configuredFlashBytes;
  uint32_t sketchBytes;
  uint32_t freeSketchBytes;
};

enum class FlashInventoryReview : uint8_t {
  MissingMeasurement, InconsistentSize, RequiresPhysicalPartitionReview
};

inline FlashInventoryReview inspectFlashInventory(
    const FlashInventoryObservation &evidence) {
  if (evidence.detectedFlashBytes==0 ||
      evidence.configuredFlashBytes==0 ||
      evidence.sketchBytes==0 ||
      evidence.freeSketchBytes==0)
    return FlashInventoryReview::MissingMeasurement;
  if (evidence.detectedFlashBytes!=evidence.configuredFlashBytes ||
      evidence.sketchBytes>evidence.configuredFlashBytes ||
      evidence.freeSketchBytes>evidence.configuredFlashBytes)
    return FlashInventoryReview::InconsistentSize;
  // Even matching SDK-reported sizes do not identify real FS/OTA boundaries,
  // bootloader regions, power-loss behavior or sensor provenance.
  return FlashInventoryReview::RequiresPhysicalPartitionReview;
}
inline bool flashInventoryAuthorizesMount(FlashInventoryReview) {
  return false;
}
inline bool flashInventoryAuthorizesWrite(FlashInventoryReview) {
  return false;
}
inline bool flashInventoryAuthorizesFirmwareUpload(FlashInventoryReview) {
  return false;
}
} // namespace floodguard_retained_review
