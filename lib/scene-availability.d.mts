/** Display-only H20 precondition for a simulated, unsigned 3D model. */
export interface SceneAvailability {
  readonly mode: 'unavailable' | 'reduced-motion' | 'illustrative-3d';
  readonly render3D: boolean;
  readonly gateAngleDeg: number | null;
  readonly waterDistanceCm: number | null;
  readonly physicalGateVerified: false;
  readonly waterLevelVerified: false;
  readonly physicalFloodSafety: 'UNKNOWN · UNVERIFIED';
  readonly gateLabel: string;
  readonly waterLabel: string;
}
export declare function describeSceneAvailability(
  input?: Readonly<{
    angle?: unknown;
    waterDistance?: unknown;
    reducedMotion?: boolean;
  }>
): SceneAvailability;
