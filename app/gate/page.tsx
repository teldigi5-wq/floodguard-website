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
import { describeGateObservation } from "@/lib/gate-observation-view.mjs";

const DamScene = dynamic(() => import("@/components/dam-scene"), {
  ssr: false,
  loading: () => (
    <div className="scene scene-load final-gate-scene-loading">
      <div className="scene-load-card">
        <i />
        <strong>Preparing an illustrative gate model</strong>
        <span>The page remains available while 3D assets initialise.</span>
      </div>
    </div>
  ),
});

const reasons: Record<string, string> = {
  DAM_WARNING: "Reservoir distance crossed the warning threshold.",
  DAM_DANGER: "Reservoir distance entered the danger range.",
  WATER_DANGER: "The HC-SR04 air gap reached the danger zone.",
  NONE: "No controller action reason was reported; physical conditions remain unverified.",
};

export default function GatePage() {
  const { data, freshness, age } = useLive();
  const gate = data?.gate;
  const water = data?.water;

  // A valid controller status and matching angle are required even to
  // show a *reported* position. No unsigned reading verifies actual motion.
  const observedGate = describeGateObservation({ gate, freshness });
  const { state: gateState, angle, countdown, lift } = observedGate;
  const activeCountdown = observedGate.recentCountdownReport;
  // Firebase has no witnessed physical discharge sensor. Disable the
  // operational-style discharge treatment; 3D is illustrative only.
  const releaseActive = false;
  const waterState = (water?.status ?? "UNKNOWN").toUpperCase();
  const danger = waterState === "DANGER";
  const stateCopy = observedGate.displayLabel;

  return (
    <main className="page final-gate-page">
      <section className="final-gate-hero">
        <div className="final-gate-copy">
          <p className="eyebrow"><Radio /> Unverified gate observation</p>
          <h1>Controller reports.<br /><span>Not physical confirmation.</span></h1>
          <p>
            This illustrative gate model follows unsigned Firebase reports only when
            timestamp-recent and internally consistent. Physical gate position, water
            discharge and countdown operation are not independently verified.
            Arduino remains the local control authority.
          </p>
          <div className="final-gate-state-row">
            <span className={`final-gate-pill ${gateState.toLowerCase()}`}>
              <i /> {observedGate.displayLabel}
            </span>
            <span><Gauge /> {angle === null ? "Angle unavailable" : `${Math.round(angle)}° reported servo angle`}</span>
            <span><Droplets /> {fmt(water?.levelCm, "cm", 1)} water level</span>
          </div>
        </div>

        <div className="final-gate-live-card">
          <div>
            <small>Database timestamp</small>
            <strong>{freshness === "live" ? "RECENT · UNVERIFIED" : freshness.toUpperCase()}</strong>
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
            <small>Reported risk · source unverified</small>
            <strong>{label(data?.system?.overallRisk)}</strong>
          </div>
        </div>
      </section>

      <StatePanel />

      {activeCountdown && (
        <section className="final-countdown" role="status" aria-live="polite">
          <div className="final-countdown-orbit"><Clock3 /></div>
          <div>
            <small>Unsigned controller countdown report</small>
            <strong>{countdown}</strong>
            <span>seconds reported · not a physical timer</span>
          </div>
          <p>Physical gate closure and countdown are not independently verified. Follow approved field safety procedures.</p>
        </section>
      )}

      <section className={`final-gate-stage ${danger ? "danger" : ""} ${releaseActive ? "releasing" : "holding"}`}>
        <div className="final-stage-heading">
          <div>
            <p className="eyebrow"><Sparkles /> 3D spillway & reservoir</p>
            <h2>{freshness==="live"?stateCopy:"Last recorded: "+stateCopy}</h2>
          </div>
          <div className="final-stage-key">
            <span><i className="key-center" /> Center bay = illustrative SG90 gate model</span>
            <span><i /> Outer bays = visual dam structure</span>
          </div>
        </div>

        <div className="final-gate-layout">
          <div className="final-scene-wrap">
            <DamScene
              angle={angle}
              rain={freshness === "live" ? data?.rain?.currentMm : null}
              waterDistance={freshness === "live" ? water?.distanceCm : null}
            />
            <div className="final-gate-lift" aria-label="Illustrative reported gate lift, physical position unverified">
              <span>90°</span>
              <div><i style={{ height: `${lift ?? 0}%` }} /><b style={{ bottom: `calc(${lift ?? 0}% - 9px)` }} /></div>
              <span>0°</span>
            </div>
          </div>

          <aside className="final-telemetry-panel">
            <header>
              <div><Radio /><span><small>Firebase observation</small><strong>Source unverified</strong></span></div>
              <span className={`status-pulse ${freshness}`} />
            </header>

            <div className="final-telemetry-grid">
              <article>
                <Gauge /><small>Servo angle</small><strong>{angle === null ? "—" : `${Math.round(angle)}°`}</strong>
                <p>Model angle only · not physical position verification</p>
              </article>
              <article>
                <CircleGauge /><small>Gate lift</small><strong>{lift === null ? "—" : `${lift}%`}</strong>
                <div className="final-mini-track"><i style={{ width: `${lift ?? 0}%` }} /></div>
              </article>
              <article>
                <Droplets /><small>Water level</small><strong>{fmt(water?.levelCm, "cm", 1)}</strong>
                <p>Prototype reservoir level estimate from unsigned HC-SR04 reports and a proposed 25.0 cm calibration; not verified.</p>
              </article>
              <article>
                <Waves /><small>Hydraulic visual</small><strong>MODEL ONLY</strong>
                <p>Illustrative flow is not evidence of actual discharge or physical gate position.</p>
              </article>
              <article>
                <Clock3 /><small>Countdown report</small><strong>{countdown === null ? "UNVERIFIED" : `${countdown}s reported`}</strong>
                <p>Database countdown is not proof of physical timer operation.</p>
              </article>
              <article>
                <Wifi /><small>Network</small><strong>{label(data?.esp8266?.status ?? data?.esp8266?.connection)}</strong>
                <p>{fmt(data?.esp8266?.rssi, "dBm", 0)}</p>
              </article>
            </div>

            <div className="final-gate-reason">
              <ShieldCheck />
              <div>
                <small>Controller-reported reason (unverified)</small>
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
        <Metric icon={<Gauge />} title="Gate report" value={observedGate.displayLabel} note={angle === null ? "Angle unavailable or stale" : `${Math.round(angle)}° controller report only`} />
        <Metric icon={<Droplets />} title="Water report" value={`REPORTED ${label(waterState)}`} note={fmt(water?.levelCm, "cm", 1)} />
        <Metric icon={<BellRing />} title="Gate warning" value={activeCountdown?"REPORTED · UNVERIFIED":"UNVERIFIED"} note={activeCountdown?`${countdown}s controller report only`:"No verified physical countdown evidence"} />
        <Metric icon={<ShieldCheck />} title="Control authority" value="LOCAL ARDUINO" note="Actual firmware and physical behavior not verified" />
      </section>
    </main>
  );
}
