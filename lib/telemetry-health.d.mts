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


/** Three allowlisted public ESP children are required after each failure/reset.
 * A complete snapshot is still only unsigned RTDB-reported device state.
 */
export declare function createEspChildObservationTracker(): Readonly<{
  record(
    key: "connection" | "status" | "rssi",
    value: string | number | null,
    valid: boolean
  ): Readonly<{
    connection: string | null;
    status: string | null;
    rssi: number | null;
  }> | null;
  fail(): null;
  readonly complete: boolean;
}>;
