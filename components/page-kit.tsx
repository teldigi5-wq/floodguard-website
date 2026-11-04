"use client";import Link from"next/link";import{Activity,CloudRain,Droplets,ShieldCheck,TriangleAlert,Wifi}from"lucide-react";import{useLive}from"@/hooks/use-live";import{ageLabel,fmt,lastSeenLabel,LiveBadge,Loading,Reveal}from"@/components/ui";import{reconcileDisplayedAlarmState}from"@/lib/telemetry-safety.mjs";import{describePublicObservation}from"@/lib/public-observation-trust.mjs";import{describeWaterObservation}from"@/lib/dashboard-water-observation.mjs";import{describeGateObservation}from"@/lib/gate-observation-view.mjs";import{describePublicMonitorView}from"@/lib/public-monitor-view.mjs";
export function PageHero({eyebrow,title,copy}:{eyebrow:string;title:string;copy:string}){return <header className="page-hero"><div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1><p>{copy}</p></div><LiveBadge/></header>}
export function StatePanel(){const{freshness,age,lastUpdateMs,error}=useLive();if(freshness==="loading")return <Loading/>;if(freshness==="live"){const disclosure=describePublicObservation(freshness);return <div className="state-panel source-review" role="status"><TriangleAlert/><div><strong>Recent database reading — sensor authenticity unverified</strong><p>{disclosure.summary}</p></div></div>;}const retained=freshness==="stale";return <div className={`state-panel ${freshness}`} role="status"><TriangleAlert/><div><strong>{retained?"Last recorded readings — not live":"Live monitoring data unavailable"}</strong><p>{retained?`Saved in Firebase: ${lastSeenLabel(lastUpdateMs)} (${ageLabel(age)}). The hardware may be offline; these measurements are historical and must not be used as current safety or gate conditions.${error?" Connection warning: "+error:""}`:(error??"Waiting for verified Firebase readings. Check database connectivity and read permissions.")}</p></div></div>}
export function QuickMetrics(){
  const{data,freshness}=useLive();
  const waterView=describeWaterObservation({water:data?.water,freshness});
  const gateView=describeGateObservation({gate:data?.gate,freshness});
  const alarmState=reconcileDisplayedAlarmState({active:data?.alarm?.active,freshness});
  const alarmDisplay=alarmState==="CLEAR"?"REPORTED OFF · UNVERIFIED":alarmState==="ACTIVE"?"REPORTED ACTIVE · UNVERIFIED":alarmState==="LAST ACTIVE"?"LAST REPORTED ACTIVE":"UNAVAILABLE";
  const monitor=describePublicMonitorView({data,freshness});
  const espDisplay=monitor.espLabel;
  return <div className="metric-grid">
    <Metric icon={<Droplets/>} title="Water report" value={fmt(waterView.currentLevel,"cm")} note={waterView.reportStatusLabel+" · not a field safety clearance"}/>
    <Metric icon={<Activity/>} title="Gate report" value={gateView.displayLabel} note="Physical gate position not verified"/>
    <Metric icon={<Wifi/>} title="ESP8266 report" value={espDisplay} note="Unsigned database fields · no device identity attestation"/>
    <Metric icon={<Activity/>} title="Alarm report" value={alarmDisplay} note="No independent physical alarm verification"/>
  </div>;
}
export function Metric({icon,title,value,note,children}:{icon?:React.ReactNode;title:string;value:string;note?:string;children?:React.ReactNode}){return <Reveal className="metric"><span className="metric-icon">{icon}</span><small>{title}</small><strong>{value}</strong>{note&&<p>{note}</p>}{children}</Reveal>}
export function CTA(){return <section className="cta"><ShieldCheck/><div><p className="eyebrow">Monitor · Predict · Protect</p><h2>See the whole prototype respond in real time.</h2></div><Link className="button" href="/dashboard">Open dashboard</Link></section>}
