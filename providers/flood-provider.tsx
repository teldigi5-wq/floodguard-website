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

const shortText = z.string().max(80);
const optionalNumber = (min: number, max: number) =>
  z.number().finite().min(min).max(max).nullable().optional();

const WATER_SENSOR_TO_BOTTOM_CM = 25;
const WATER_WARNING_MIN_CM = 8.5;
const WATER_DANGER_MIN_CM = 11;

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

function normalizeWaterStatus(value: unknown): string {
  const state = upper(value);
  if (["SAFE", "WARNING", "DANGER"].includes(state ?? "")) return state!;
  if (["SENSOR_ERROR", "ERROR", "OFFLINE", "INVALID"].includes(state ?? "")) return "SENSOR_ERROR";
  return "UNKNOWN";
}

function normalizeWaterGroup(source: Record<string, unknown>) {
  const distance = typeof source.distanceCm === "number" && Number.isFinite(source.distanceCm)
    ? source.distanceCm : null;
  const providedLevel = typeof source.levelCm === "number" && Number.isFinite(source.levelCm)
    ? source.levelCm : null;

  // Website-authoritative display rule: whenever the real HC-SR04 air-gap
  // measurement exists, calculate level locally from that same value. This
  // prevents a stale levelCm field from disagreeing with a fresh distanceCm.
  const levelCm = distance !== null
    ? Math.max(0, Math.min(WATER_SENSOR_TO_BOTTOM_CM, WATER_SENSOR_TO_BOTTOM_CM - distance))
    : providedLevel;

  const incomingStatus = normalizeWaterStatus(source.status);
  if (incomingStatus === "SENSOR_ERROR" && distance === null) {
    return { ...source, distanceCm: null, levelCm: null, status: "SENSOR_ERROR" };
  }

  // Derive the website status from the exact level shown on screen so the
  // number, threshold card and status can never contradict each other.
  const status = levelCm === null
    ? incomingStatus
    : levelCm >= WATER_DANGER_MIN_CM ? "DANGER"
    : levelCm >= WATER_WARNING_MIN_CM ? "WARNING"
    : "SAFE";

  return { ...source, distanceCm: distance, levelCm, status };
}

function normalizeRainStatus(value: unknown, dailyMm?: unknown): string {
  const state = upper(value);
  if (["NORMAL", "HEAVY_RAIN", "FLOOD_WARNING", "EXTREME", "CRITICAL"].includes(state ?? "")) {
    return state!;
  }
  // Compatibility for the brief firmware version that used ONLINE as the
  // rain category. Derive a category only from a real numeric measurement.
  if (state === "ONLINE" && typeof dailyMm === "number" && Number.isFinite(dailyMm)) {
    if (dailyMm >= 300) return "CRITICAL";
    if (dailyMm >= 200) return "EXTREME";
    if (dailyMm >= 150) return "FLOOD_WARNING";
    if (dailyMm >= 100) return "HEAVY_RAIN";
    return "NORMAL";
  }
  if (["NOT_INSTALLED", "NOT INSTALLED", "REMOVED", "DISABLED"].includes(state ?? "")) {
    return "NOT_INSTALLED";
  }
  return "UNKNOWN";
}

function normalizeGateStatus(value: unknown): string {
  const state = upper(value);
  if (["CLOSED", "COUNTDOWN", "OPENING", "OPEN", "CLOSING"].includes(state ?? "")) return state!;
  if (state === "OPENING_WARNING") return "COUNTDOWN";
  return "UNKNOWN";
}

function normalizeGateGroup(source: Record<string, unknown>) {
  const rawStatus = normalizeGateStatus(source.status);
  const angle = typeof source.angle === "number" && Number.isFinite(source.angle) ? source.angle : null;
  const countdown =
    typeof source.countdownSeconds === "number" && Number.isFinite(source.countdownSeconds)
      ? Math.max(0, source.countdownSeconds)
      : null;

  // Physical gate position/countdown wins over stale legacy status strings.
  // This prevents old OPENING_WARNING/COUNTDOWN values from showing while the
  // Arduino reports a closed 0-degree gate with no active countdown.
  let status = rawStatus;
  if ((countdown ?? 0) > 0) {
    status = "COUNTDOWN";
  } else if (angle !== null && angle <= 2) {
    status = "CLOSED";
  } else if (angle !== null && angle >= 80) {
    status = "OPEN";
  } else if (angle !== null && angle > 2 && angle < 80) {
    // Current Arduino sends direct target angles, but tolerate intermediate values.
    status = status === "CLOSING" ? "CLOSING" : "OPENING";
  } else if (status === "COUNTDOWN" || status === "OPENING_WARNING") {
    status = "CLOSED";
  }

  const reason = status === "CLOSED" ? "NONE" : source.reason;
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
    const status = normalizeRainStatus(source.status, source.dailyMm);
    if (status === "UNKNOWN" || status === "NOT_INSTALLED") {
      return { ...source, status, currentMm: null, dailyMm: null, weightGrams: null };
    }
    return { ...source, status };
  }
  if (key === "gate") return normalizeGateGroup(source);
  if (key === "system") return { ...source, overallRisk: normalizeRisk(source.overallRisk) };
  return source;
}

function millis(value: unknown) {
  if (typeof value === "number") return value < 1e12 ? value * 1000 : value;
  if (typeof value === "string") {
    const n = Number(value);
    if (Number.isFinite(n)) return n < 1e12 ? n * 1000 : n;
    const d = Date.parse(value);
    return Number.isNaN(d) ? null : d;
  }
  return null;
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
                console.warn(`FloodGuard ignored invalid ${key} payload`, parsed.error.issues);
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
                if (parsed.success && raw !== null) setError(null);
              }
              release();
            },
            () => {
              if (key === "water" || key === "system") {
                setError("Live monitoring data is currently unavailable.");
              }
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

  const stamp = millis(data?.system?.lastUpdate);
  const age = stamp === null ? null : Math.max(0, Math.floor((now - stamp) / 1000));

  // A stopped ESP8266 does not erase its last measurements from Firebase.
  // Connection to Firebase is not proof that the hardware is updating.
  let freshness: LiveState["freshness"] = "unavailable";
  if (loading) freshness = "loading";
  else if (data) {
    freshness = connected === true && !error && age !== null && age <= 10
      ? "live"
      : "stale";
  }

  const value = useMemo(
    () => ({ data, freshness, age, lastUpdateMs: stamp, error }),
    [data, freshness, age, stamp, error],
  );
  return <LiveContext.Provider value={value}>{children}</LiveContext.Provider>;
}
