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
import { ageLabel, fmt, label } from "@/components/ui";
import { Metric, StatePanel } from "@/components/page-kit";

const DamScene = dynamic(() => import("@/components/dam-scene"), {
  ssr: false,
  loading: () => (
    <div className="scene scene-load final-gate-scene-loading">
      <div className="scene-load-card">
        <i />
        <strong>Preparing the illustrative gate twin</strong>
        <span>The page remains available while 3D assets initialise.</span>
      </div>
    </div>
  ),
});

const reasons: Record<string, string> = {
  DAM_WARNING: "Reservoir distance crossed the warning threshold.",
  DAM_DANGER: "Reservoir distance entered the danger range.",
  WATER_DANGER: "The HC-SR04 air gap reached the danger zone.",
  NONE: "No controller reason recorded; current conditions are not independently verified.",
};

export default function GatePage() {
  const { data, freshness, age } = useLive();
  const gate = data?.gate;
  const water = data?.water;

  // The provider already reconciles reported status, angle and countdown.
  // Never override a rejected/conflicting state with angle-only inference.
  const gateState = (gate?.status ?? "UNKNOWN").toUpperCase();
  const angle = gateState !== "UNKNOWN" && typeof gate?.angle === "number"
    && Number.isInteger(gate.angle) && gate.angle >= 0 && gate.angle <= 90
      ? gate.angle : null;
  const countdown =
    typeof gate?.countdownSeconds === "number"
      ? Math.max(0, Math.round(gate.countdownSeconds))
      : 0;
  // A retained countdown must not be presented as an active timer.
  const recordedCountdown = gateState === "COUNTDOWN" && countdown > 0;
  const lift = angle === null ? null : Math.round((angle / 90) * 100);

  // An RTDB system heartbeat is not proof of current gate position or flow.
  // The scene can illustrate reported values, never actual discharge.
  const waterState = (water?.status ?? "UNKNOWN").toUpperCase();
  const danger = waterState === "DANGER";
  const stateCopy =
    gateState === "COUNTDOWN"
      ? "Reported pre-open countdown · not a live timer"
      : gateState === "OPEN"
        ? "Reported OPEN · physical position unverified"
        : gateState === "MOVING"
          ? "Reported MOVING · physical position unverified"
          : gateState === "CLOSED"
            ? "Reported CLOSED · physical position unverified"
            : "Gate state unavailable";

  return (
    <main className="page final-gate-page">
      <section className="final-gate-hero">
        <div className="final-gate-copy">
          <p className="eyebrow"><Radio /> Illustrative gate telemetry</p>
          <h1>One prototype gate.<br /><span>Reported state, not physical proof.</span></h1>
          <p>
            This visualization illustrates unverified SG90 controller reports stored in Firebase.
            A recent system timestamp cannot verify the gate position or water discharge.
            Arduino remains the local control authority.
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
            <small>System timestamp freshness</small>
            <strong>{freshness.toUpperCase()}</strong>
          </div>
          <div>
            <small>ESP8266</small>
            <strong>{label(data?.esp8266?.status ?? data?.esp8266?.connection)}</strong>
          </div>
          <div>
            <small>Updated</small>
            <strong>{ageLabel(age)}</strong>
          </div>
          <div>
            <small>Risk</small>
            <strong>{label(data?.system?.overallRisk)}</strong>
          </div>
        </div>
      </section>

      <StatePanel />

      {recordedCountdown && (
        <section className="final-countdown" role="status" aria-live="polite">
          <div className="final-countdown-orbit"><Clock3 /></div>
          <div>
            <small>Recorded opening sequence · not verified live</small>
            <strong>{countdown}</strong>
            <span>seconds in last recorded countdown</span>
          </div>
          <p>The reported countdown is not proof of a running timer or a physically closed gate.</p>
        </section>
      )}

      <section className={`final-gate-stage ${danger ? "danger" : ""} holding`}>
        <div className="final-stage-heading">
          <div>
            <p className="eyebrow"><Sparkles /> 3D spillway & reservoir</p>
            <h2>{freshness==="live"?"Recent report: "+stateCopy:"Last recorded: "+stateCopy}</h2>
          </div>
          <div className="final-stage-key">
            <span><i className="key-center" /> Center bay = illustrative SG90 gate</span>
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
              <div><Radio /><span><small>Firebase stored reports</small><strong>Source not independently verified</strong></span></div>
              <span className={`status-pulse ${freshness}`} />
            </header>

            <div className="final-telemetry-grid">
              <article>
                <Gauge /><small>Servo angle</small><strong>{angle === null ? "—" : `${Math.round(angle)}°`}</strong>
                <p>0°/90° are controller angle conventions, not physical proof</p>
              </article>
              <article>
                <CircleGauge /><small>Gate lift</small><strong>{lift === null ? "—" : `${lift}%`}</strong>
                <div className="final-mini-track"><i style={{ width: `${lift ?? 0}%` }} /></div>
              </article>
              <article>
                <Droplets /><small>Water level</small><strong>{fmt(water?.levelCm, "cm", 1)}</strong>
                <p>Illustrative level derived from the reported HC-SR04 air gap and the assumed 25.0 cm mounting height.</p>
              </article>
              <article>
                <Waves /><small>Hydraulic visual</small><strong>ILLUSTRATIVE</strong>
                <p>Animated flow represents the last reported servo angle; real discharge is unverified.</p>
              </article>
              <article>
                <Clock3 /><small>Countdown</small><strong>{recordedCountdown?`Recorded ${countdown}s`:"Unverified"}</strong>
                <p>This is not a running physical countdown.</p>
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
                <p>{reasons[(gate?.reason ?? "NONE").toUpperCase()] ?? "The source reported this reason; current conditions are unverified."}</p>
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
        <Metric icon={<Gauge />} title="Gate state" value={label(gateState)} note={angle === null ? "Angle unavailable" : `${Math.round(angle)}° reported servo angle · unverified`} />
        <Metric icon={<Droplets />} title="Water state" value={label(waterState)} note={fmt(water?.levelCm, "cm", 1)} />
        <Metric icon={<BellRing />} title="Gate warning" value={recordedCountdown?"REPORTED COUNTDOWN":"UNVERIFIED"} note="No independent timer or gate-position proof" />
        <Metric icon={<ShieldCheck />} title="Control authority" value="ARDUINO" note="Website remains monitoring-only" />
      </section>
    </main>
  );
}
