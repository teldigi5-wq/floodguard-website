"use client";
import{ArrowDown,Droplets,Ruler,TriangleAlert}from"lucide-react";
import{useLive}from"@/hooks/use-live";
import{fmt,label}from"@/components/ui";
import{Metric,PageHero,StatePanel}from"@/components/page-kit";

export default function Water(){
 const{data}=useLive();
 const level=data?.water?.levelCm;
 const gap=data?.water?.distanceCm;
 const fill=typeof level==="number"?Math.max(3,Math.min(100,level/25*100)):0;
 return <main className="page">
  <PageHero eyebrow="Reservoir monitoring" title="Actual dam water level" copy="FloodGuard converts the live HC-SR04 air gap into actual reservoir level using the 25.0 cm sensor-to-bottom calibration."/>
  <StatePanel/>
  <section className="water-stage">
   <div className="reservoir"><div className="water-fill" style={{height:`${fill}%`}}><i/><i/></div><span className="sensor"><ArrowDown/> HC-SR04</span><strong>{fmt(level,"cm")}</strong></div>
   <div className="thresholds">
    <div className={typeof level==="number"&&level<8.5?"active":""}><b>SAFE</b><span>below 8.5 cm</span></div>
    <div className={typeof level==="number"&&level>=8.5&&level<11?"active":""}><b>WARNING</b><span>8.5 cm to below 11 cm</span></div>
    <div className={typeof level==="number"&&level>=11?"active":""}><b>DANGER</b><span>11 cm or higher · gate sequence</span></div>
   </div>
  </section>
  <section className="metric-grid">
   <Metric icon={<Droplets/>} title="Actual water level" value={fmt(level,"cm")} note={label(data?.water?.status)}/>
   <Metric icon={<Ruler/>} title="HC-SR04 air gap" value={fmt(gap,"cm")} note="Raw sensor measurement"/>
   <Metric icon={<TriangleAlert/>} title="Gate trigger" value="≥ 11 cm" note="10-second countdown then 90° open"/>
  </section>
  <section className="explain"><Droplets/><div><h2>Final controller rules</h2><p>Below 8.5 cm is SAFE. From 8.5 cm to below 11 cm is WARNING with the gate closed. At 11 cm or higher the controller confirms DANGER, starts the real countdown and opens the SG90 gate.</p></div></section>
 </main>
}