"use client";

import { AlertTriangle, Cpu, Database, Gauge, Radio, ShieldCheck } from "lucide-react";
import { useLive } from "@/hooks/use-live";
import { PageHero, StatePanel } from "@/components/page-kit";
import { ageLabel, fmt, label, lastSeenLabel } from "@/components/ui";

export default function Diagnostics() {
  const { data, freshness, age, lastUpdateMs, databaseConnected, error } = useLive();
  const groups = [
    { title:"Water level", path:"water", available:data?.water !== undefined,
      value:fmt(data?.water?.levelCm, "cm") },
    { title:"Collector rainfall", path:"rain", available:data?.rain !== undefined,
      value:fmt(data?.rain?.currentMm, "mm") },
    { title:"Gate state", path:"gate", available:data?.gate !== undefined,
      value:label(data?.gate?.status) },
    { title:"Alarm report", path:"alarm", available:data?.alarm !== undefined,
      value:data?.alarm?.active === true?"Reported active":data?.alarm?.active === false?"Reported clear":"Unavailable" },
    { title:"Devices", path:"devices", available:data?.devices !== undefined,
      value:data?.devices?"Status records present":"Unavailable" },
    { title:"Controller update", path:"system", available:data?.system !== undefined,
      value:lastSeenLabel(lastUpdateMs) },
    { title:"ESP8266 telemetry", path:"esp8266/{connection,rssi,status}", available:data?.esp8266 !== undefined,
      value:label(data?.esp8266?.status??data?.esp8266?.connection) },
  ];
  const streamCount=groups.filter(group=>group.available).length;

  return (
    <main className="page diagnostics-page">
      <PageHero
        eyebrow="Engineering observability"
        title="Field telemetry diagnostics"
        copy="Inspect the last reported measurements, Firebase connection state and data coverage without confusing cloud access with hardware health."
      />
      <StatePanel />
      <section className="diag-lead" aria-label="Observability summary">
        <article className="diag-panel">
          <Radio aria-hidden="true" />
          <small>Field observation</small>
          <strong>{freshness==="live"?"Recently updated":freshness==="stale"?"Last recorded":freshness==="loading"?"Loading":"Unavailable"}</strong>
          <p>{freshness==="live"?"The reported timestamp is recent, not a hardware health certification.":"Do not assume any hardware, gate or alarm is currently active from retained data."}</p>
        </article>
        <article className="diag-panel">
          <Database aria-hidden="true" />
          <small>Firebase client transport</small>
          <strong>{databaseConnected===true?"Connected":databaseConnected===false?"Disconnected":"Unverified"}</strong>
          <p>Cloud connection status is separate from ESP8266 and Arduino connectivity.</p>
        </article>
        <article className="diag-panel">
          <Gauge aria-hidden="true" />
          <small>Telemetry coverage</small>
          <strong>{streamCount} / {groups.length} groups</strong>
          <p>Counts groups with retained data; not active hardware nodes or guaranteed healthy sensors.</p>
        </article>
      </section>
      <section aria-labelledby="diag-field">
        <header className="diag-section-heading">
          <h2 id="diag-field">Last field report</h2>
          <p>Source timestamp: {lastSeenLabel(lastUpdateMs)} · Field data age: {ageLabel(age)}</p>
        </header>
        <div className="diag-lead">
          <article className="diag-panel"><Cpu aria-hidden="true"/><small>Reported risk</small>
            <strong>{label(data?.system?.overallRisk)}</strong><p>Historical classification when field data is stale.</p></article>
          <article className="diag-panel"><ShieldCheck aria-hidden="true"/><small>Reported gate</small>
            <strong>{label(data?.gate?.status)}</strong><p>Last recorded actuator position; not remote-control access.</p></article>
          <article className="diag-panel"><AlertTriangle aria-hidden="true"/><small>Subscription status</small>
            <strong>{error?"Read warning":"No reported read error"}</strong><p>{error??"Absence of a read error is not proof of working field hardware."}</p></article>
        </div>
      </section>
      <section aria-labelledby="diag-streams">
        <header className="diag-section-heading">
          <h2 id="diag-streams">Allowlisted telemetry groups</h2>
          <p>The browser subscribes only to permitted Firebase child paths. IP addresses, Wi-Fi details, credentials and actuator commands are not accessed by this view.</p>
        </header>
        <div className="diag-streams">
          {groups.map(group=><article className="diag-stream" key={group.title}>
            <b>{group.title}</b>
            <span>{group.available?"Last report available":"No usable report"}</span>
            <strong>{group.value}</strong>
            <code>floodguard/live/{group.path}</code>
          </article>)}
        </div>
      </section>
      <section className="diag-note" role="note">
        <strong>Operational boundary</strong>
        <p>This is a read-only engineering dashboard. Cloud data may outlive the powered-on prototype. For safe operation and calibration, verify readings on the local Arduino/LCD and physical equipment. FloodGuard is not a certified warning or dam-control system.</p>
      </section>
    </main>
  );
}
