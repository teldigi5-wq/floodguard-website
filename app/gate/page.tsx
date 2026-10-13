"use client";

import dynamic from "next/dynamic";
import {
  Activity,
  BellRing,
  CircleGauge,
  Clock3,
  Cpu,
  Droplets,
  Gauge,
  Radio,
  ShieldCheck,
  Sparkles,
  Waves,
  Wifi,
} from "lucide-react";
import { useLive } from "@/hooks/use-live";
import { fmt, label } from "@/components/ui";
import { Metric, StatePanel } from "@/components/page-kit";

const DamScene = dynamic(() => import("@/components/dam-scene"), {
  ssr: false,
  loading: () => (
    <div className="scene scene-load final-gate-scene-loading">
      <div className="scene-load-card">
        <i />
        <strong>Preparing the live gate twin</strong>
        <span>The page remains available while 3D assets initialise.</span>
      </div>
    </div>
  ),
});

const reasons: Record<string, string> = {
  DAM_WARNING: "Reservoir distance crossed the warning threshold.",
  DAM_DANGER: "Reservoir distance entered the danger range.",
  WATER_DANGER: "The HC-SR04 air gap reached the danger zone.",
  NONE: "Current water conditions do not require a gate-opening action.",
};

export default function GatePage() {
  const { data, freshness, age } = useLive();
  const gate = data?.gate;
  const water = data?.water;

  const angle =
    typeof gate?.angle === "number" ? Math.max(0, Math.min(90, gate.angle)) : null;
  const countdown =
    typeof gate?.countdownSeconds === "number"
      ? Math.max(0, Math.round(gate.countdownSeconds))
      : 0;
  const lift = angle === null ? null : Math.round((angle / 90) * 100);

  // Display state is reconciled from the physical command position and countdown.
  // This prevents stale text fields from contradicting the Arduino/ESP gate angle.
  let gateState = (gate?.status ?? "UNKNOWN").toUpperCase();
  if (countdown > 0) gateState = "COUNTDOWN";
  else if (angle !== null && angle <= 2) gateState = "CLOSED";
  else if (angle !== null && angle >= 80) gateState = "OPEN";
  else if (angle !== null && angle > 2 && angle < 80) gateState = "MOVING";

  const releaseActive = gateState === "OPEN" && (lift ?? 0) >= 80;
  const waterState = (water?.status ?? "UNKNOWN").toUpperCase();
  const danger = waterState === "DANGER";
  const stateCopy =
    gateState === "COUNTDOWN"
      ? "Pre-open safety countdown"
      : gateState === "OPEN"
        ? "Center spillway open"
        : gateState === "MOVING"
          ? "Center spillway moving"
          : gateState === "CLOSED"
            ? "Center spillway sealed"
            : "Gate state unavailable";

  return (
    <main className="page final-gate-page">
      <section className="final-gate-hero">
        <div className="final-gate-copy">
          <p className="eyebrow"><Radio /> Live gate digital twin</p>
          <h1>One physical gate.<br /><span>One trusted live state.</span></h1>
          <p>
            The center spillway mirrors the SG90 gate reported through Firebase. The
            website is monitoring-only: Arduino remains the physical authority.
          </p>
          <div className="final-gate-state-row">
            <span className={`final-gate-pill ${gateState.toLowerCase()}`}>
              <i /> {label(gateState)}
            </span>
            <span><Gauge /> {angle === null ? "Angle unavailable" : `${Math.round(angle)}° servo angle`}</span>
            <span><Droplets /> {fmt(water?.levelCm, "cm", 1)} water level</span>
          </div>
        </div>

        <div className="final-gate-live-card">
          <div>
            <small>Field freshness</small>
            <strong>{freshness.toUpperCase()}</strong>
          </div>
          <div>
            <small>ESP8266</small>
            <strong>{label(data?.esp8266?.status ?? data?.esp8266?.connection)}</strong>
          </div>
          <div>
            <small>Updated</small>
            <strong>{age === null ? "—" : `${age}s ago`}</strong>
          </div>
          <div>
            <small>Risk</small>
            <strong>{label(data?.system?.overallRisk)}</strong>
          </div>
        </div>
      </section>

      <StatePanel />

      {countdown > 0 && (
        <section className="final-countdown" role="status" aria-live="polite">
          <div className="final-countdown-orbit"><Clock3 /></div>
          <div>
            <small>Automatic opening sequence</small>
            <strong>{countdown}</strong>
            <span>seconds remaining</span>
          </div>
          <p>Gate remains physically closed until the local Arduino countdown finishes.</p>
        </section>
      )}

      <section className={`final-gate-stage ${danger ? "danger" : ""} ${releaseActive ? "releasing" : "holding"}`}>
        <div className="final-stage-heading">
          <div>
            <p className="eyebrow"><Sparkles /> 3D spillway & reservoir</p>
            <h2>{stateCopy}</h2>
          </div>
          <div className="final-stage-key">
            <span><i className="key-center" /> Center bay = physical SG90 gate</span>
            <span><i /> Outer bays = visual dam structure</span>
          </div>
        </div>

        <div className="final-gate-layout">
          <div className="final-scene-wrap">
            <DamScene
              angle={angle}
              rain={data?.rain?.currentMm}
              waterDistance={water?.distanceCm}
            />
            <div className="final-gate-lift" aria-label="Gate lift position">
              <span>90°</span>
              <div><i style={{ height: `${lift ?? 0}%` }} /><b style={{ bottom: `calc(${lift ?? 0}% - 9px)` }} /></div>
              <span>0°</span>
            </div>
          </div>

          <aside className="final-telemetry-panel">
            <header>
              <div><Radio /><span><small>Firebase realtime</small><strong>Live telemetry</strong></span></div>
              <span className={`status-pulse ${freshness}`} />
            </header>

            <div className="final-telemetry-grid">
              <article>
                <Gauge /><small>Servo angle</small><strong>{angle === null ? "—" : `${Math.round(angle)}°`}</strong>
                <p>0° closed · 90° fully open</p>
              </article>
              <article>
                <CircleGauge /><small>Gate lift</small><strong>{lift === null ? "—" : `${lift}%`}</strong>
                <div className="final-mini-track"><i style={{ width: `${lift ?? 0}%` }} /></div>
              </article>
              <article>
                <Droplets /><small>Water level</small><strong>{fmt(water?.levelCm, "cm", 1)}</strong>
                <p>Actual reservoir level is calculated from the HC-SR04 air gap using the 25.0 cm sensor-to-bottom calibration.</p>
              </article>
              <article>
                <Waves /><small>Hydraulic visual</small><strong>{releaseActive ? "RELEASING" : "HELD"}</strong>
                <p>{releaseActive ? "Visual discharge follows the open gate." : "No discharge animation while sealed."}</p>
              </article>
              <article>
                <Clock3 /><small>Countdown</small><strong>{countdown > 0 ? `${countdown}s` : "0s"}</strong>
                <p>Only active before a confirmed opening.</p>
              </article>
              <article>
                <Wifi /><small>Network</small><strong>{label(data?.esp8266?.status ?? data?.esp8266?.connection)}</strong>
                <p>{fmt(data?.esp8266?.rssi, "dBm", 0)}</p>
              </article>
            </div>

            <div className="final-gate-reason">
              <ShieldCheck />
              <div>
                <small>Why is the gate in this state?</small>
                <strong>{label(gate?.reason ?? "NONE")}</strong>
                <p>{reasons[(gate?.reason ?? "NONE").toUpperCase()] ?? "The field controller published the current gate condition."}</p>
              </div>
            </div>
          </aside>
        </div>
      </section>

      <section className="final-response-flow">
        <div><span>01</span><Cpu /><strong>Sense</strong><p>HC-SR04 measures the sensor-to-water air gap.</p></div>
        <i />
        <div><span>02</span><Activity /><strong>Decide</strong><p>Arduino confirms SAFE, WARNING or DANGER locally.</p></div>
        <i />
        <div><span>03</span><BellRing /><strong>Warn</strong><p>A real countdown is published before the opening action.</p></div>
        <i />
        <div><span>04</span><Gauge /><strong>Move</strong><p>SG90 moves the center prototype gate to the commanded angle.</p></div>
        <i />
        <div><span>05</span><Radio /><strong>Stream</strong><p>ESP8266 publishes the reconciled state to Firebase.</p></div>
      </section>

      <section className="metric-grid final-gate-metrics">
        <Metric icon={<Gauge />} title="Gate state" value={label(gateState)} note={angle === null ? "Angle unavailable" : `${Math.round(angle)}° physical command`} />
        <Metric icon={<Droplets />} title="Water state" value={label(waterState)} note={fmt(water?.levelCm, "cm", 1)} />
        <Metric icon={<BellRing />} title="Gate warning" value={countdown > 0 ? "ACTIVE" : "CLEAR"} note={countdown > 0 ? `${countdown}s remaining` : "No pre-open countdown"} />
        <Metric icon={<ShieldCheck />} title="Control authority" value="ARDUINO" note="Website remains monitoring-only" />
      </section>
    </main>
  );
}
