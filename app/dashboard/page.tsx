"use client";
import{BellRing,Droplets,Radio,ShieldCheck,Wifi}from"lucide-react";
import{useLive}from"@/hooks/use-live";
import{ageLabel,fmt,label}from"@/components/ui";
import{Metric,PageHero,StatePanel}from"@/components/page-kit";
import{TelemetryGauge}from"@/components/telemetry";
import{NetworkScope}from"@/components/advanced-motion";import{reconcileDisplayedAlarmState}from"@/lib/telemetry-safety.mjs";
import{StatusSnapshot}from"@/components/status-snapshot";import{describePublicObservation}from"@/lib/public-observation-trust.mjs";
import{describeRiskObservation,describeWaterObservation}from"@/lib/dashboard-water-observation.mjs";
import{describeGateObservation}from"@/lib/gate-observation-view.mjs";import{describePublicMonitorView}from"@/lib/public-monitor-view.mjs";
const levels=["LOW","MODERATE","HIGH","SEVERE","CRITICAL"];
export default function Dashboard(){const{data,age,freshness}=useLive();
const riskView=describeRiskObservation({reportedRisk:data?.system?.overallRisk,freshness});
const waterView=describeWaterObservation({water:data?.water,freshness});
const gateView=describeGateObservation({gate:data?.gate,freshness});
const monitor=describePublicMonitorView({data,freshness});
const alarmState=reconcileDisplayedAlarmState({active:data?.alarm?.active,freshness});
const alarmDisplay=alarmState==="CLEAR"?"REPORTED OFF · UNVERIFIED":alarmState==="ACTIVE"?"REPORTED ACTIVE · UNVERIFIED":alarmState==="LAST ACTIVE"?"LAST REPORTED ACTIVE":alarmState;
const alarmGauge=alarmState==="ACTIVE"?1:null;
return <main className="page dashboard-page"><PageHero eyebrow="Unsigned field observation" title="Monitoring dashboard" copy="Database measurements are unverified reports. Current physical flood safety is UNKNOWN, even when the latest source reports LOW or SAFE. Follow official and independently verified warnings."/><StatePanel/>
<section className="command-overview"><div className="overview-copy"><span className={"status-pulse "+freshness}/><div><small>Operational overview</small><b>{describePublicObservation(freshness).label}</b></div></div><dl><div><dt>Physical risk</dt><dd>{riskView.currentPhysicalRisk}</dd></div><div><dt>Alarm report</dt><dd>{alarmDisplay}</dd></div><div><dt>Field update</dt><dd>{ageLabel(age)}</dd></div></dl></section>
<NetworkScope/>
<section className="telemetry-row"><TelemetryGauge label="Recent reservoir report · unverified" value={waterView.currentLevel} max={25} display={fmt(waterView.currentLevel,"cm")}/><TelemetryGauge label="Alarm report · unverified" value={alarmGauge} max={1} display={alarmDisplay} tone="blue"/><TelemetryGauge label="Gate angle report · unverified" value={gateView.angle} max={90} display={fmt(gateView.angle,"°",0)} tone="amber"/><TelemetryGauge label="Wi-Fi signal" value={monitor.espSignalDbm===null?null:monitor.espSignalDbm+100} max={70} display={fmt(monitor.espSignalDbm,"dBm",0)} tone="green"/></section>
<section className="risk-card"><div><small>Current physical flood risk</small><strong>{riskView.currentPhysicalRisk}</strong><p>{riskView.reportedRiskLabel} · {age===null?"Update time unavailable":"Database timestamp "+ageLabel(age)} · Reported risk only; field source unverified. Never interpret LOW as an all-clear.</p></div><div className="risk-spectrum" aria-label={"Unverified reported risk scale: "+riskView.reportedRiskLabel}>{levels.map(x=><span key={x} className={riskView.reportedElevation===x?"active":""}>{x}</span>)}</div></section>
<section className="metric-grid"><Metric icon={<Droplets/>} title="Water report" value={fmt(waterView.currentLevel,"cm")} note={waterView.reportStatusLabel+" · prototype bands: below 8.5 / 8.5–11 / 11+ cm; NOT physical safety clearance"}/><Metric icon={<ShieldCheck/>} title="Gate report" value={gateView.displayLabel} note={fmt(gateView.angle,"°",0)+" · physical position unverified"}/><Metric icon={<BellRing/>} title="Alarm report" value={alarmDisplay} note={freshness==="live"?label(data?.alarm?.type)+" · source unverified":"Historical or unavailable · not verified"}/><Metric icon={<Wifi/>} title="ESP8266" value={monitor.espLabel} note={fmt(monitor.espSignalDbm,"dBm",0)+" · unsigned database signal"}/><Metric icon={<Radio/>} title="Firebase readings" value={freshness==="live"?"RECENT · UNVERIFIED":data?"LAST RECORDED":"UNAVAILABLE"} note="Timestamp recency is not authenticated field evidence"/></section><StatusSnapshot/><section className="honesty"><h2>Trend history</h2><p>Historical time-series data is not present in the current live payload. Charts will appear only when timestamped history is recorded—this panel does not generate synthetic points.</p></section></main>}
