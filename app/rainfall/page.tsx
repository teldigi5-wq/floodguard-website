"use client";

import { CloudRain, Droplets, Gauge, Radio, Ruler, ShieldCheck } from "lucide-react";
import { useLive } from "@/hooks/use-live";
import { fmt, label } from "@/components/ui";
import { Metric, PageHero, StatePanel } from "@/components/page-kit";

function categoryNote(status: string) {
  switch (status) {
    case "HEAVY_RAIN": return "Heavy accumulated rainfall";
    case "FLOOD_WARNING": return "Flood-warning rainfall range";
    case "EXTREME": return "Extreme accumulated rainfall";
    case "CRITICAL": return "Critical accumulated rainfall";
    case "NORMAL": return "Rainfall remains in the normal range";
    default: return "Waiting for a trustworthy rain measurement";
  }
}

export default function Rainfall() {
  const { data, freshness, age } = useLive();
  const rain = data?.rain;
  const device = label(data?.devices?.rainGauge);
  const category = label(rain?.status);
  const installed = device === "ONLINE" || label(rain?.sensorStatus) === "ONLINE";
  const limited = rain?.calibrationLimited === true;

  return (
    <main className="page rainfall-page">
      <PageHero
        eyebrow="Live collector rain gauge"
        title="Rainfall monitoring"
        copy="Real rainfall is calculated from the physical collector water depth. Missing fields stay unavailable; FloodGuard does not invent load-cell weight or historical rain values."
      />
      <StatePanel />

      <section className="command-overview">
        <div className="overview-copy">
          <span className={"status-pulse " + freshness} />
          <div><small>Rain-gauge sensor</small><b>{installed ? "Physical sensor online" : "Sensor unavailable"}</b></div>
        </div>
        <dl>
          <div><dt>Category</dt><dd>{category}</dd></div>
          <div><dt>Freshness</dt><dd>{age == null ? "—" : age + " sec"}</dd></div>
          <div><dt>Calibration</dt><dd>{limited ? "LIMITED" : "ACTIVE"}</dd></div>
        </dl>
      </section>

      <section className="metric-grid">
        <Metric icon={<CloudRain />} title="Current rainfall" value={fmt(rain?.currentMm, "mm")} note={categoryNote(category)} />
        <Metric icon={<Gauge />} title="Accumulated rainfall" value={fmt(rain?.dailyMm, "mm")} note="Real collector accumulation; no synthetic history" />
        <Metric icon={<Ruler />} title="Collector water depth" value={fmt(rain?.waterDepthCm, "cm")} note="Measured from the direct A0 depth sensor" />
        <Metric icon={<Radio />} title="Sensor ADC" value={fmt(rain?.rawValue, "", 0)} note="Raw Arduino A0 reading" />
        <Metric icon={<ShieldCheck />} title="Rain gauge" value={device} note={label(rain?.sensorStatus)} />
        <Metric icon={<Droplets />} title="Gauge weight" value={fmt(rain?.weightGrams, "g")} note="Unavailable by design — current gauge does not use HX711" />
      </section>

      {limited && (
        <section className="honesty">
          <h2>Calibration limit reached</h2>
          <p>The collector has reached the highest currently calibrated sensor range. FloodGuard keeps the last calibrated value instead of extrapolating a fake rainfall depth. Add more physical calibration points before trusting higher depths.</p>
        </section>
      )}

      <section className="honesty">
        <h2>Measurement method</h2>
        <p>The current prototype uses collector water depth rather than load-cell weight. Rainfall is derived from the real collector geometry and calibrated A0 sensor readings. Historical charts remain unavailable until timestamped history is actually stored.</p>
      </section>
    </main>
  );
}
