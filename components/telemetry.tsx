"use client";
import {motion,useReducedMotion} from "framer-motion";
export function TelemetryGauge({label,value,max,display,tone="cyan"}:{label:string;value:number|null|undefined;max:number;display:string;tone?:"cyan"|"blue"|"amber"|"green"}){
 const reduced=useReducedMotion(),available=typeof value==="number",percent=available?Math.max(0,Math.min(100,value/max*100)):0;
 return <motion.article className={"telemetry-gauge "+tone} initial={reduced?false:{opacity:0,scale:.94}} whileInView={{opacity:1,scale:1}} viewport={{once:true}} transition={{duration:.55}}><div className="gauge-ring" style={{"--gauge":percent*3.6+"deg"} as React.CSSProperties}><div><strong>{display}</strong><small>{available?Math.round(percent)+"% scale":"Waiting"}</small></div></div><span>{label}</span></motion.article>
}
