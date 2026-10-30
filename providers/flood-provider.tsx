"use client";

import {
  createContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { onValue, ref, type Unsubscribe } from "firebase/database";
import { z } from "zod";
import { database, LIVE_PATH } from "@/lib/firebase";
import { ageSeconds, classifyTelemetryFreshness, parseFieldTimestamp, createCriticalStreamHealthTracker } from "@/lib/telemetry-health.mjs";
import { reconcileCalibratedWaterMeasurement, reconcileReportedGateStatus, reconcileReportedRainStatus, reconcileDisplayedFloodRisk } from "@/lib/telemetry-safety.mjs";

const shortText = z.string().max(80);
const optionalNumber = (min: number, max: number) =>
  z.number().finite().min(min).max(max).nullable().optional();

const waterSchema = z.object({
  distanceCm: optionalNumber(0, 400),
  levelCm: optionalNumber(0, 100),
  status: shortText.nullable().optional(),
});
const rainSchema = z.object({
  currentMm: optionalNumber(0, 10000),
  dailyMm: optionalNumber(0, 10000),
  weightGrams: optionalNumber(0, 100000),
  waterDepthCm: optionalNumber(0, 20),
  rawValue: optionalNumber(0, 1023),
  calibrationLimited: z.boolean().nullable().optional(),
  measurementType: shortText.nullable().optional(),
  sensorStatus: shortText.nullable().optional(),
  status: shortText.nullable().optional(),
});
const gateSchema = z.object({
  status: shortText.nullable().optional(),
  angle: optionalNumber(0, 180),
  countdownSeconds: optionalNumber(0, 3600),
  reason: shortText.nullable().optional(),
});
const alarmSchema = z.object({
  active: z.boolean().nullable().optional(),
  type: shortText.nullable().optional(),
});
const deviceValue = z
  .union([
    z.string().max(32),
    z.boolean(),
    z.object({
      status: z.string().max(32).optional(),
      state: z.string().max(32).optional(),
      online: z.boolean().optional(),
      installed: z.boolean().optional(),
    }),
  ])
  .nullable();
const devicesSchema = z.object({
  arduino: deviceValue.optional(),
  gsm: deviceValue.optional(),
  microSD: deviceValue.optional(),
  rainGauge: deviceValue.optional(),
  rtc: deviceValue.optional(),
  servo: deviceValue.optional(),
  ultrasonic: deviceValue.optional(),
});
const systemSchema = z.object({
  lastUpdate: z.union([z.string().max(80), z.number().finite()]).nullable().optional(),
  overallRisk: shortText.nullable().optional(),
});
const espConnection = z.string().max(40).nullable();
const espRssi = z.number().finite().min(-130).max(0).nullable();
const espStatus = z.string().max(40).nullable();

export type LiveData = {
  water?: z.infer<typeof waterSchema>;
  rain?: z.infer<typeof rainSchema>;
  gate?: z.infer<typeof gateSchema>;
  alarm?: z.infer<typeof alarmSchema>;
  devices?: z.infer<typeof devicesSchema>;
  esp8266?: { connection?: string | null; rssi?: number | null; status?: string | null };
  system?: z.infer<typeof systemSchema>;
};

export type LiveState = {
  data: LiveData | null;
  freshness: "loading" | "live" | "stale" | "unavailable";
  age: number | null;
  lastUpdateMs: number | null;
  databaseConnected: boolean | null;
  error: string | null;
};

export const LiveContext = createContext<LiveState | null>(null);

function upper(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toUpperCase();
  return normalized || null;
}

function normalizeDeviceState(value: unknown): unknown {
  if (typeof value === "boolean") return value ? "ONLINE" : "OFFLINE";
  if (value && typeof value === "object") {
    const source = value as Record<string, unknown>;
    const raw = source.status ?? source.state ?? source.online ?? source.installed;
    return normalizeDeviceState(raw);
  }
  const state = upper(value);
  if (["ONLINE", "CONNECTED", "ACTIVE"].includes(state ?? "")) return "ONLINE";
  if (["OFFLINE", "DISCONNECTED", "INACTIVE"].includes(state ?? "")) return "OFFLINE";
  if (["ERROR", "FAULT"].includes(state ?? "")) return "ERROR";
  if (["NOT_INSTALLED", "NOT INSTALLED", "REMOVED", "DISABLED"].includes(state ?? "")) {
    return "NOT_INSTALLED";
  }
  return "UNKNOWN";
}

function normalizeWaterGroup(source: Record<string, unknown>) {
  // The pure safety contract validates the calibrated air gap before deriving
  // a displayed level. Invalid values cannot become SAFE via clamping.
  return { ...source, ...reconcileCalibratedWaterMeasurement(source) };
}

 function normalizeGateStatus(value: unknown): string {
  const state = upper(value);
  if (["CLOSED", "COUNTDOWN", "OPENING", "OPEN", "CLOSING"].includes(state ?? "")) return state!;
  if (state === "OPENING_WARNING") return "COUNTDOWN";
  return "UNKNOWN";
}

function normalizeGateGroup(source: Record<string, unknown>) {
  const rawStatus = normalizeGateStatus(source.status);
  // Preserve malformed raw values for the safety reconciler BEFORE sanitizing
  // output for the validated public model. Coercing negatives to zero could
  // otherwise fabricate a CLOSED state or a completed countdown.
  const status = reconcileReportedGateStatus({
    status: rawStatus,
    angle: source.angle,
    countdownSeconds: source.countdownSeconds,
  });
  const angle = typeof source.angle === "number" && Number.isInteger(source.angle)
    && source.angle >= 0 && source.angle <= 90 ? source.angle : null;
  const countdown = typeof source.countdownSeconds === "number"
    && Number.isInteger(source.countdownSeconds)
    && source.countdownSeconds >= 0 && source.countdownSeconds <= 10
      ? source.countdownSeconds : null;
  const reason = status === "CLOSED" ? "NONE" : status === "UNKNOWN" ? null : source.reason;
  return { ...source, status, angle, countdownSeconds: countdown, reason };
}

function normalizeRisk(value: unknown): string {
  const risk = upper(value);
  if (["LOW", "MODERATE", "HIGH", "SEVERE", "CRITICAL"].includes(risk ?? "")) return risk!;
  return "UNAVAILABLE";
}

function normalizeGroup(key: keyof Omit<LiveData, "esp8266">, value: unknown): unknown {
  if (!value || typeof value !== "object") return value;
  const source = value as Record<string, unknown>;
  if (key === "devices") {
    return Object.fromEntries(
      Object.entries(source).map(([device, state]) => [device, normalizeDeviceState(state)]),
    );
  }
  if (key === "water") return normalizeWaterGroup(source);
  if (key === "rain") {
    const status = reconcileReportedRainStatus({status:source.status,dailyMm:source.dailyMm});
    if (status === "UNKNOWN" || status === "NOT_INSTALLED") {
      return { ...source, status, currentMm: null, dailyMm: null, weightGrams: null };
    }
    return { ...source, status };
  }
  if (key === "gate") return normalizeGateGroup(source);
  if (key === "system") return { ...source, overallRisk: normalizeRisk(source.overallRisk) };
  return source;
}

export function FloodProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<LiveData | null>(null);
  const [connected, setConnected] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    const unsubscribers: Unsubscribe[] = [];
    const criticalStreams = createCriticalStreamHealthTracker();
    const updateCriticalStatus = (key: string, healthy: boolean) => {
      // Independent child listeners may succeed in an arbitrary order.
      // Neither a healthy unrelated stream nor a partial recovery may
      // erase a failed water/system stream and imply current safety.
      if (key === "water" || key === "system") {
        const allHealthy = criticalStreams.update(key, healthy);
        setError(allHealthy ? null : "Critical water or system telemetry is unavailable or invalid.");
      }
    };
    let released = false;

    const release = () => {
      if (released) return;
      released = true;
      setLoading(false);
    };

    // Loader guard: the shell must become usable even if Firebase is slow.
    const guard = window.setTimeout(release, 3000);

    try {
      const db = database();

      unsubscribers.push(
        onValue(
          ref(db, ".info/connected"),
          (snapshot) => setConnected(snapshot.val() === true),
          () => setConnected(false),
        ),
      );

      // Firebase RTDB does not inherit child .read grants upward. A public
      // listener on LIVE_PATH would fail under rules that hide /esp8266/ip and
      // /esp8266/wifi. Subscribe only to explicitly public telemetry branches.
      // A missing optional sensor never blocks the dashboard shell.
      const publicSchemas = {
        water: waterSchema,
        rain: rainSchema,
        gate: gateSchema,
        alarm: alarmSchema,
        devices: devicesSchema,
        system: systemSchema,
      } as const;

      for (const key of Object.keys(publicSchemas) as Array<keyof typeof publicSchemas>) {
        unsubscribers.push(
          onValue(
            ref(db, `${LIVE_PATH}/${key}`),
            (snapshot) => {
              const raw = snapshot.val();
              const parsed = publicSchemas[key].safeParse(normalizeGroup(key, raw));
              if (!parsed.success && raw !== null) {
                console.warn(`FloodGuard rejected invalid ${key} payload`, parsed.error.issues);
                // A malformed update must NOT retain an old CLEAR, SAFE,
                // or CLOSED report while other branches keep updating.
                setData((previous) => {
                  if (previous === null || !Object.hasOwn(previous, key)) return previous;
                  const next: LiveData = { ...previous };
                  delete (next as Record<string, unknown>)[key];
                  return Object.keys(next).length ? next : null;
                });
                updateCriticalStatus(key, false);
              } else {
                setData((previous) => {
                  const next: LiveData = { ...previous };
                  if (parsed.success && raw !== null) {
                    (next as Record<string, unknown>)[key] = parsed.data;
                  } else if (raw === null) {
                    delete (next as Record<string, unknown>)[key];
                  }
                  return Object.keys(next).length ? next : null;
                });
                updateCriticalStatus(key, parsed.success && raw !== null);
              }
              release();
            },
            () => {
              // Permission/network denial must not leave a cached alarm CLEAR
              // (or prior water SAFE) presented beside newer group updates.
              setData((previous) => {
                if (previous === null || !Object.hasOwn(previous, key)) return previous;
                const next: LiveData = { ...previous };
                delete (next as Record<string, unknown>)[key];
                return Object.keys(next).length ? next : null;
              });
              updateCriticalStatus(key, false);
              release();
            },
          ),
        );
      }

      // The ESP node contains potentially private network details. Never
      // subscribe to the parent: read only these allowlisted public children.
      const espSchemas = {
        connection: espConnection,
        rssi: espRssi,
        status: espStatus,
      } as const;
      for (const key of Object.keys(espSchemas) as Array<keyof typeof espSchemas>) {
        unsubscribers.push(
          onValue(
            ref(db, `${LIVE_PATH}/esp8266/${key}`),
            (snapshot) => {
              const raw = snapshot.val();
              const normalized = key === "rssi" ? raw : normalizeDeviceState(raw);
              const parsed = espSchemas[key].safeParse(normalized);
              if (!parsed.success) {
                if (raw !== null) console.warn(`FloodGuard ignored invalid ESP ${key} payload`);
                return;
              }
              setData((previous) => ({
                ...previous,
                esp8266: { ...previous?.esp8266, [key]: parsed.data },
              }));
              release();
            },
            () => release(),
          ),
        );
      }
    } catch {
      // Defer the initial error update: effects should not synchronously
      // trigger a React render while they are still being initialized.
      queueMicrotask(() => {
        setError("Live monitoring data is currently unavailable.");
        release();
      });
    }

    return () => {
      window.clearTimeout(guard);
      unsubscribers.forEach((unsubscribe) => unsubscribe());
    };
  }, []);

  const stamp = parseFieldTimestamp(data?.system?.lastUpdate, now);
  const age = ageSeconds(stamp, now);
  // A connected browser is not evidence of a connected field controller.
  const freshness = classifyTelemetryFreshness({
    loading,
    hasData: data !== null,
    connected,
    error: error !== null,
    ageSeconds: age,
  });

  // Merge source observations for display instead of trusting a standalone
  // Firebase overallRisk=LOW. Never describe a stale snapshot as current.
  const value = useMemo(() => {
    const displayed: LiveData | null = data === null ? null : {
      ...data,
      system: {
        ...(data.system ?? {}),
        overallRisk: reconcileDisplayedFloodRisk({
          waterStatus: data.water?.status,
          rainStatus: data.rain?.status,
          reportedRisk: data.system?.overallRisk,
          freshness,
        }),
      },
    };
    return { data: displayed, freshness, age, lastUpdateMs: stamp, databaseConnected: connected, error };
  }, [data, freshness, age, stamp, connected, error]);
  return <LiveContext.Provider value={value}>{children}</LiveContext.Provider>;
}
