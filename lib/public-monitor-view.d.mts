/** H19 homepage/ribbon/network view. Read-only unsigned Firebase reports. */
export interface PublicMonitorView {
  readonly physicalFloodSafety: 'UNKNOWN · UNVERIFIED';
  readonly freshnessLabel: string;
  readonly waterLevelCm: number | null;
  readonly waterDistanceCm: number | null;
  readonly waterLabel: string;
  readonly gateAngleDeg: number | null;
  readonly gateLabel: string;
  readonly alarmLabel: string;
  readonly espLabel: string;
  readonly espState: string;
  readonly espSignalDbm: number | null;
  readonly rainCurrentMm: number | null;
  readonly rainLabel: string;
  readonly authenticatedFieldSource: false;
  readonly physicalGateVerified: false;
  readonly canDeclareSafe: false;
  readonly canOperateGate: false;
  readonly canSendAlert: false;
}
export declare function describePublicMonitorView(input?: Readonly<{
  data?: unknown;
  freshness?: string;
}>): PublicMonitorView;
