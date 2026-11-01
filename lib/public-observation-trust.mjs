/**
 * FloodGuard public-facing source-provenance disclosure.
 *
 * A recently updated RTDB child and client database connectivity cannot
 * authenticate ESP8266 physical provenance, sensor calibration, or UNO gate
 * behavior. Our current public client has NO verified, authority-bound
 * source attestation input; never silently promote recent data to trusted.
 * Pure read-only policy: no Firebase, keys, network, or control operations.
 */
export function describePublicObservation(freshness) {
  switch (freshness) {
    case "live":
      return Object.freeze({
        label: "Recent database record · source unverified",
        summary: "Firebase has a recent field timestamp. Sensor identity and physical readings have not been independently authenticated; do not use this display as a safety clearance or gate command.",
        observationRecentlyUpdated: true,
        authenticatedFieldSource: false,
        physicalConditionsVerified: false,
        canDeclareSafe: false,
        canOperateGate: false,
        canSendAlert: false,
      });
    case "stale":
      return Object.freeze({
        label: "Last recorded · not current",
        summary: "These readings are historical. They do not establish present water level, current flood safety, or physical gate position.",
        observationRecentlyUpdated: false,
        authenticatedFieldSource: false,
        physicalConditionsVerified: false,
        canDeclareSafe: false,
        canOperateGate: false,
        canSendAlert: false,
      });
    case "loading":
      return Object.freeze({
        label: "Connecting · source unverified",
        summary: "Waiting for database observations. No current physical sensor status is established.",
        observationRecentlyUpdated: false,
        authenticatedFieldSource: false,
        physicalConditionsVerified: false,
        canDeclareSafe: false,
        canOperateGate: false,
        canSendAlert: false,
      });
    default:
      return Object.freeze({
        label: "Field observation unavailable",
        summary: "Current monitoring information is unavailable. Treat safety and actuator conditions as unknown.",
        observationRecentlyUpdated: false,
        authenticatedFieldSource: false,
        physicalConditionsVerified: false,
        canDeclareSafe: false,
        canOperateGate: false,
        canSendAlert: false,
      });
  }
}
