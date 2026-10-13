"use client";
import {useEffect} from "react";
import {Activity,CloudRain,Cpu,Droplets,Gauge,Radio,Wifi} from "lucide-react";
import {useLive} from "@/hooks/use-live";
import {fmt,label} from "@/components/ui";

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
 const items=[[Radio,"Network",freshness],[Droplets,"Water",fmt(data?.water?.levelCm,"cm")],[CloudRain,"Rain",fmt(data?.rain?.currentMm,"mm")],[Gauge,"Gate",label(data?.gate?.status)],[Wifi,"Updated",age===null?"Unavailable":age+"s ago"]] as const;
 return <div className="ribbon-group" aria-hidden={hidden}>{items.map(([Icon,name,value])=><span key={name}><Icon/><small>{name}</small><b>{value}</b><i/></span>)}</div>;
}

export function TelemetryRibbon(){
 return <section className="telemetry-ribbon" aria-label="Current FloodGuard telemetry"><div className="ribbon-track"><RibbonGroup/><RibbonGroup hidden/></div></section>;
}

export function NetworkScope(){
 const{data,freshness,age}=useLive();
 const live=freshness==="live";
 return <section className={"network-scope "+(live?"live":"")} aria-labelledby="scope-title"><div className="scope-copy"><p className="eyebrow"><Activity/> Realtime signal fabric</p><h2 id="scope-title">The field network, moving as one.</h2><p>Every illuminated path represents an active monitoring relationship. Values remain direct from Firebase; the animation visualizes connectivity, not invented history.</p><div className="scope-rows"><span><Droplets/><small>Reservoir</small><b>{fmt(data?.water?.levelCm,"cm")}</b><i/></span><span><Activity/><small>Alarm</small><b>{data?.alarm?.active?"ACTIVE":"CLEAR"}</b><i/></span><span><Gauge/><small>Gate servo</small><b>{fmt(data?.gate?.angle,"°",0)}</b><i/></span><span><Wifi/><small>ESP8266</small><b>{label(data?.esp8266?.status??data?.esp8266?.connection)}</b><i/></span></div></div><div className="scope-radar" aria-label={"Field network "+freshness}><div className="radar-sweep"/><div className="radar-ring one"/><div className="radar-ring two"/><span className="radar-hub"><Cpu/><b>ARDUINO</b><small>{live?"SYNCHRONIZED":freshness}</small></span>{[[Droplets,"water"],[Activity,"alarm"],[Gauge,"gate"],[Wifi,"wifi"]].map(([Icon,name],index)=>{const NodeIcon=Icon as typeof Activity;return <span className={"radar-node node-"+index} key={name as string}><NodeIcon/><i/></span>})}<em>{age===null?"Awaiting timestamp":"Signal age "+age+"s"}</em></div></section>;
}
