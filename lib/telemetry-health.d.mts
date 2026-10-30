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

/** R2 lab only. Expects attested per-stream metadata, not system heartbeat. */
export declare function classifySourceBoundFreshness(state?: {
  loading?: boolean;
  hasData?: boolean;
  connected?: boolean | null;
  error?: boolean;
  stream?: "water" | "rain";
  observation?: {
    stream?: string;
    sourceId?: string;
    epoch?: number;
    sequence?: number;
    observedAt?: unknown;
    receivedAt?: unknown;
  } | null;
  prior?: { sourceId: string; epoch: number; sequence: number } | null;
  nowMs?: number;
}): "loading" | "live" | "stale" | "unavailable";
