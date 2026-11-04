"use client";
import {useEffect} from "react";
import {Activity,CloudRain,Cpu,Droplets,Gauge,Radio,Wifi} from "lucide-react";
import {useLive} from "@/hooks/use-live";
import {fmt} from "@/components/ui";
import {describePublicMonitorView} from "@/lib/public-monitor-view.mjs";

export function MotionOrchestrator({route}:{route:string}){
 useEffect(()=>{
  if(matchMedia("(prefers-reduced-motion: reduce)").matches)return;
  const cards=Array.from(document.querySelectorAll<HTMLElement>(".metric,.telemetry-gauge,.step,.device,.about-grid article,.hardware-grid article"));
  cards.forEach(card=>card.classList.add("motion-card"));
  const sections=Array.from(document.querySelectorAll<HTMLElement>("main > section:not(.home-hero)"));
  const observer=new IntersectionObserver(entries=>entries.forEach(entry=>{if(entry.isIntersecting){entry.target.classList.add("motion-visible");observer.unobserve(entry.target)}}),{threshold:.08,rootMargin:"0px 0px -5% 0px"});
  sections.forEach((section,index)=>{section.classList.add("motion-section");section.style.setProperty("--motion-delay",Math.min(index,5)*35+"ms");observer.observe(section)});
  const pointer=(event:PointerEvent)=>{const target=event.target as Element|null,card=target?.closest<HTMLElement>(".motion-card");if(!card)return;const rect=card.getBoundingClientRect();card.style.setProperty("--spot-x",event.clientX-rect.left+"px");card.style.setProperty("--spot-y",event.clientY-rect.top+"px")};
  document.addEventListener("pointermove",pointer,{passive:true});
  return()=>{observer.disconnect();document.removeEventListener("pointermove",pointer);cards.forEach(card=>card.classList.remove("motion-card"));sections.forEach(section=>section.classList.remove("motion-section","motion-visible"))};
 },[route]);
 return <div className="motion-overlay" aria-hidden><i/><i/></div>;
}

function RibbonGroup({hidden=false}:{hidden?:boolean}){
 const{data,freshness,age}=useLive();
 const monitor=describePublicMonitorView({data,freshness});
 const items=[[Radio,"Source",monitor.freshnessLabel],[Droplets,"Water",monitor.waterLabel],[CloudRain,"Rain",monitor.rainLabel],[Gauge,"Gate",monitor.gateLabel],[Wifi,"Database age",age===null?"Timestamp unavailable":age+"s ago · unverified"]] as const;
 return <div className="ribbon-group" aria-hidden={hidden}>{items.map(([Icon,name,value])=><span key={name}><Icon/><small>{name}</small><b>{value}</b><i/></span>)}</div>;
}

export function TelemetryRibbon(){
 return <section className="telemetry-ribbon" aria-label="FloodGuard reported database observations"><div className="ribbon-track"><RibbonGroup/><RibbonGroup hidden/></div></section>;
}

export function NetworkScope(){
 const{data,freshness,age}=useLive();
 const live=freshness==="live";
 const monitor=describePublicMonitorView({data,freshness});
 return <section className={"network-scope "+(live?"live":"")} aria-labelledby="scope-title"><div className="scope-copy"><p className="eyebrow"><Activity/> Database observation preview</p><h2 id="scope-title">Recent readings, without claiming hardware verification.</h2><p>Animation depicts database observations only. It does not verify sensor identity, physical gate motion, or message delivery.</p><div className="scope-rows"><span><Droplets/><small>Reservoir</small><b>{fmt(monitor.waterLevelCm,"cm")} · {live?"UNVERIFIED":"NOT CURRENT"}</b><i/></span><span><Activity/><small>Alarm</small><b>{monitor.alarmLabel}</b><i/></span><span><Gauge/><small>Gate servo</small><b>{monitor.gateLabel}</b><i/></span><span><Wifi/><small>ESP8266</small><b>{monitor.espLabel}</b><i/></span></div></div><div className="scope-radar" aria-label={"Database observation "+freshness+"; physical source unverified"}><div className="radar-sweep"/><div className="radar-ring one"/><div className="radar-ring two"/><span className="radar-hub"><Cpu/><b>ARDUINO</b><small>{live?"RECENT · UNVERIFIED":freshness}</small></span>{[[Droplets,"water"],[Activity,"alarm"],[Gauge,"gate"],[Wifi,"wifi"]].map(([Icon,name],index)=>{const NodeIcon=Icon as typeof Activity;return <span className={"radar-node node-"+index} key={name as string}><NodeIcon/><i/></span>})}<em>{age===null?"Awaiting timestamp":"Signal age "+age+"s"}</em></div></section>;
}
