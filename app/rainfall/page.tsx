"use client";

import { CloudRain, Droplets, Gauge, Radio, Ruler, ShieldCheck } from "lucide-react";
import { useLive } from "@/hooks/use-live";
import { ageLabel, fmt } from "@/components/ui";
import { Metric, PageHero, StatePanel } from "@/components/page-kit";
import { describePublicRainObservation } from "@/lib/public-health-observation.mjs";

function categoryNote(status: string) {
  switch (status) {
    case "HEAVY_RAIN": return "Possible heavy accumulated rainfall · source unverified";
    case "FLOOD_WARNING": return "Possible flood-warning rainfall · source unverified";
    case "EXTREME": return "Possible extreme accumulated rainfall · source unverified";
    case "CRITICAL": return "Possible critical accumulated rainfall · source unverified";
    case "NORMAL": return "Reported normal category is not an all-clear";
    default: return "Rain sensor health or measurements are unavailable; no all-clear";
  }
}

export default function Rainfall() {
  const { data, freshness, age } = useLive();
  const view = describePublicRainObservation({
    rain:data?.rain,device:data?.devices?.rainGauge,freshness
  });

  return (
    <main className="page rainfall-page">
      <PageHero
        eyebrow="Unsigned collector observation"
        title="Rainfall monitoring"
        copy="Reported rainfall comes from the prototype collector model. Unsigned Firebase numbers do not verify the installed sensor, physical calibration, actual rainfall, or flood safety. Missing or contradictory health fields withhold measurements."
      />
      <StatePanel />

      <section className="command-overview">
        <div className="overview-copy">
          <span className={"status-pulse " + freshness} />
          <div><small>Rain-gauge sensor</small><b>{view.gaugeLabel}</b></div>
        </div>
        <dl>
          <div><dt>Category</dt><dd>{view.categoryLabel}</dd></div>
          <div><dt>Database update</dt><dd>{ageLabel(age)} · timestamp unverified</dd></div>
          <div><dt>Calibration</dt><dd>{view.calibrationLabel}</dd></div>
        </dl>
      </section>

      <section className="metric-grid">
        <Metric icon={<CloudRain />} title="Current rainfall report" value={fmt(view.currentMm, "mm")} note={categoryNote(view.category)} />
        <Metric icon={<Gauge />} title="Accumulated rainfall report" value={fmt(view.dailyMm, "mm")} note={view.categoryLabel+" · cannot establish a physical all-clear"} />
        <Metric icon={<Ruler />} title="Collector water-depth report" value={fmt(view.waterDepthCm, "cm")} note="Unsigned A0 collector estimate · calibration unverified" />
        <Metric icon={<Radio />} title="Reported sensor ADC" value={fmt(view.adcValue, "", 0)} note="Unsigned Arduino A0 report · not independently calibrated" />
        <Metric icon={<ShieldCheck />} title="Rain gauge" value={view.gaugeLabel} note={view.sensorLabel} />
        <Metric icon={<Droplets />} title="Gauge weight" value={fmt(view.gaugeWeightGrams, "g")} note="Unavailable by design — current prototype does not use HX711" />
      </section>

      {view.calibrationLimited && (
        <section className="honesty">
          <h2>Reported calibration limit reached</h2>
          <p>The unsigned collector report indicates a calibration boundary. It is not independently verified; do not extrapolate a physical rainfall depth without reviewed hardware calibration evidence.</p>
        </section>
      )}

      <section className="honesty">
        <h2>Prototype measurement method</h2>
        <p>The proposed collector design estimates rainfall from water depth and an A0 reading rather than load-cell weight. These public reports are not field-authenticated, and historical charts remain unavailable without real timestamped measurements.</p>
      </section>
    </main>
  );
}
