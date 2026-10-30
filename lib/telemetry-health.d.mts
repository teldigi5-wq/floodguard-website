export declare function parseFieldTimestamp(value: unknown, nowMs?: number): number | null;
export declare function ageSeconds(timestampMs: number | null, nowMs?: number): number | null;
export declare function classifyTelemetryFreshness(state: {
  loading: boolean;
  hasData: boolean;
  connected: boolean | null;
  error: boolean;
  ageSeconds: number | null;
}): "loading" | "live" | "stale" | "unavailable";

export declare function createCriticalStreamHealthTracker(): Readonly<{
  update(key: string, healthy: boolean): boolean;
  readonly healthy: boolean;
  readonly failures: readonly string[];
}>;
