"use client";
import{ArrowDown,Droplets,Ruler,TriangleAlert}from"lucide-react";
import{useLive}from"@/hooks/use-live";
import{fmt}from"@/components/ui";
import{Metric,PageHero,StatePanel}from"@/components/page-kit";
import{describeWaterObservation}from"@/lib/dashboard-water-observation.mjs";

export default function Water(){
 const{data,freshness}=useLive();
 const observation=describeWaterObservation({water:data?.water,freshness});
 const level=observation.currentLevel;
 const gap=observation.currentAirGap;
 // Historical unsigned readings cannot fill a gauge as a current reading.
 const fill=typeof level==="number"?Math.max(3,Math.min(100,level/25*100)):0;
 return <main className="page">
  <PageHero eyebrow="Unsigned prototype observation" title="Reported reservoir water level" copy="A timestamp-recent Firebase measurement is not authenticated physical flood evidence. The 25.0 cm sensor-to-bottom value is a prototype installation assumption, not a verified calibration or safety clearance."/>
  <StatePanel/>
  <section className="water-stage">
   <div className="reservoir"><div className="water-fill" style={{height:`${fill}%`}}><i/><i/></div><span className="sensor"><ArrowDown/> Unsigned HC-SR04 report</span><strong>{fmt(level,"cm")}</strong><small>{observation.reportStatusLabel}</small></div>
   <div className="thresholds">
    <div className={observation.safeBandActive?"active":""}><b>Prototype low band</b><span>below 8.5 cm · NOT a physical all-clear</span></div>
    <div className={observation.warningBandActive?"active":""}><b>Possible WARNING</b><span>8.5 to below 11 cm · unverified report</span></div>
    <div className={observation.dangerBandActive?"active":""}><b>Possible DANGER</b><span>11 cm or higher · investigate independently</span></div>
   </div>
  </section>
  <section className="metric-grid">
   <Metric icon={<Droplets/>} title="Recent level report" value={fmt(level,"cm")} note={observation.reportStatusLabel}/>
   <Metric icon={<Ruler/>} title="Recent air-gap report" value={fmt(gap,"cm")} note="Unsigned Firebase value · no physical sensor attestation"/>
   <Metric icon={<TriangleAlert/>} title="Prototype gate threshold" value="≥ 11 cm" note="Local firmware behavior and real gate motion are NOT verified"/>
  </section>
  <section className="explain"><Droplets/><div><h2>Prototype threshold design — not verified field behavior</h2><p>Below 8.5 cm is the prototype LOW band, 8.5 to below 11 cm is the proposed WARNING band, and 11 cm or higher is the proposed DANGER band. Neither a low reading nor an unsigned SAFE flag confirms physical flood safety. Countdown and gate operation require supervised hardware tests.</p><p>{observation.lastRecordedLevel===null?"No retained historical level is being treated as current.":"Last recorded historical level: "+fmt(observation.lastRecordedLevel,"cm")+" · NOT CURRENT."}</p></div></section>
 </main>
}