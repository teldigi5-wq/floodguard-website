/** H18 non-operational, unsigned browser observation. Never a release certificate. */
export interface PublicObservationExport {
  readonly schema: 'floodguard-browser-observation-v2';
  readonly purpose: 'NON_OPERATIONAL_OBSERVATION_ONLY';
  readonly generatedAt: string;
  readonly freshness: string;
  readonly ageSeconds: number | null;
  readonly lastRecordedAt: string | null;
  readonly sourceAssurance: 'UNSIGNED_FIREBASE · UNVERIFIED';
  readonly physicalFloodSafety: 'UNKNOWN · UNVERIFIED';
  readonly authenticatedFieldSource: false;
  readonly physicalConditionsVerified: false;
  readonly canDeclareSafe: false;
  readonly canOperateGate: false;
  readonly canSendAlert: false;
  readonly risk: Readonly<{
    currentPhysicalRisk: string;
    reportedLabel: string;
  }>;
  readonly water: Readonly<{
    levelCm: number | null;
    distanceCm: number | null;
    status: string | null;
    reportLabel: string;
    currentPhysicalLevelVerified: false;
  }>;
  readonly rain: Readonly<{
    currentMm: number | null;
    dailyMm: number | null;
    status: string | null;
    reportLabel: string;
  }>;
  readonly gate: Readonly<{
    status: string | null;
    angle: number | null;
    reason: string | null;
    reportLabel: string;
    physicalGateVerified: false;
  }>;
  readonly alarm: Readonly<{
    active: boolean | null;
    type: string | null;
    displayState: string;
    physicalAlarmVerified: false;
  }>;
  readonly esp8266: Readonly<{
    status: string | null;
    connection: string | null;
    rssi: number | null;
    reportLabel: string;
    physicalConnectivityVerified: false;
  }>;
}
export declare function buildPublicObservationExport(input?: Readonly<{
  data?: unknown;
  freshness?: string;
  ageSeconds?: number | null;
  lastUpdateMs?: number | null;
  generatedAt?: string;
}>): PublicObservationExport;
export declare function formatPublicObservationSummary(
  snapshot: PublicObservationExport
): string;
