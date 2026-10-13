"use client";
import Link from "next/link";
import {motion,useMotionValue,useReducedMotion,useSpring,useTransform} from "framer-motion";
import {ArrowUpRight,BookOpen,CloudRain,Droplets,Gauge,ShieldCheck,TriangleAlert} from "lucide-react";
import {useLive} from "@/hooks/use-live";
import {fmt,label} from "@/components/ui";

type Card={title:string;eyebrow:string;copy:string;href:string;tone:string;Icon:typeof Droplets;value:string};

function ExperienceCard({card,duplicate=false}:{card:Card;duplicate?:boolean}){
 const reduced=useReducedMotion(),x=useMotionValue(0),y=useMotionValue(0),smoothX=useSpring(x,{stiffness:170,damping:22}),smoothY=useSpring(y,{stiffness:170,damping:22}),rotateY=useTransform(smoothX,[-.5,.5],[-7,7]),rotateX=useTransform(smoothY,[-.5,.5],[6,-6]);
 const move=(event:React.PointerEvent<HTMLElement>)=>{if(reduced||event.pointerType==="touch")return;const rect=event.currentTarget.getBoundingClientRect();x.set((event.clientX-rect.left)/rect.width-.5);y.set((event.clientY-rect.top)/rect.height-.5)};
 const reset=()=>{x.set(0);y.set(0)};
 const content=<><div className="rail-card-top"><span><card.Icon/></span><small>{card.eyebrow}</small><ArrowUpRight/></div><div className="rail-visual" aria-hidden><i/><i/><i/><b>{card.value}</b></div><div className="rail-card-copy"><h3>{card.title}</h3><p>{card.copy}</p><b>Explore view <ArrowUpRight/></b></div></>;
 return <motion.article className={`experience-card ${card.tone}`} style={reduced?undefined:{rotateX,rotateY,transformPerspective:1000}} onPointerMove={move} onPointerLeave={reset} aria-hidden={duplicate||undefined}>{duplicate?<div>{content}</div>:<Link href={card.href}>{content}</Link>}</motion.article>;
}

export function ExperienceRail(){
 const{data}=useLive();
 const cards:Card[]=[
  {title:"Reservoir intelligence",eyebrow:"Water level",copy:"See the actual reservoir level and understand why a smaller distance means higher water.",href:"/water",tone:"aqua",Icon:Droplets,value:fmt(data?.water?.levelCm,"cm")},
  {title:"Rain gauge",eyebrow:"Live collector sensor",copy:"View real rainfall calculated from collector water depth and the calibrated Arduino A0 sensor.",href:"/rainfall",tone:"blue",Icon:CloudRain,value:fmt(data?.rain?.currentMm,"mm")},
  {title:"Gate response",eyebrow:"3D control",copy:"Inspect the servo-driven gate and angle-responsive animated water discharge.",href:"/gate",tone:"amber",Icon:Gauge,value:label(data?.gate?.status)},
  {title:"The human story",eyebrow:"Saving lives",copy:"Explore Sri Lanka’s flood history and the purpose behind earlier warning.",href:"/impact",tone:"rose",Icon:BookOpen,value:"4 chapters"},
  {title:"Be ready before danger",eyebrow:"Safety centre",copy:"Save official contacts, prepare an emergency bag and print a family plan.",href:"/safety",tone:"green",Icon:ShieldCheck,value:data?.alarm?.active?"ALARM ACTIVE":"PREPARE NOW"},
  {title:"Live risk command",eyebrow:"Monitoring",copy:"Bring water, rain, gate, alarm and network state into one honest view.",href:"/dashboard",tone:"violet",Icon:TriangleAlert,value:(data?.system?.overallRisk??"Unavailable").toUpperCase()},
 ];
 return <section className="experience-section"><div className="experience-heading"><div><p className="eyebrow">Interactive experience</p><h2>Move through FloodGuard.</h2></div><p>Inspired by the cinematic motion in your reference: a continuous showcase rail, layered depth and responsive perspective—rebuilt around real FloodGuard features.</p></div><div className="experience-window"><div className="experience-track">{cards.map(card=><ExperienceCard card={card} key={card.href}/>) }{cards.map(card=><ExperienceCard card={card} duplicate key={"copy-"+card.href}/>)}</div></div><p className="rail-hint">Hover to pause · move your pointer for 3D depth · tap any panel to explore</p></section>;
}
