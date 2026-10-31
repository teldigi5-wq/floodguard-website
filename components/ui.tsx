"use client";import{Radio}from"lucide-react";import{motion,useReducedMotion}from"framer-motion";import{useLive}from"@/hooks/use-live";export const fmt=(v:number|null|undefined,u:string,d=1)=>typeof v==="number"?`${v.toFixed(d)} ${u}`:"Unavailable";export const label=(v:string|null|undefined)=>v?.replaceAll("_"," ")??"Unavailable";export function Reveal({children,className=""}:{children:React.ReactNode;className?:string}){const r=useReducedMotion();return <motion.div className={className} initial={r?false:{opacity:0,y:22}} whileInView={{opacity:1,y:0}} viewport={{once:true,amount:.12}} transition={{duration:.6}}>{children}</motion.div>}export function LiveBadge(){const{freshness}=useLive();return <span className={`live-badge ${freshness}`}><Radio/>{freshness==="stale"?"Last recorded":freshness==="live"?"Recent system update":freshness}</span>}export function Loading(){return <div className="skeleton" role="status" aria-label="Connecting to Firebase reports"><i/><i/><i/></div>}

export function ageLabel(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds)) return "Time unavailable";
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} hr ago`;
  const days = Math.floor(seconds / 86400);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}
export function lastSeenLabel(timestampMs: number | null): string {
  if (timestampMs === null || !Number.isFinite(timestampMs)) return "Timestamp unavailable";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Colombo", day: "numeric", month: "short",
    year: "numeric", hour: "numeric", minute: "2-digit", hour12: true,
  }).format(new Date(timestampMs)) + " (Sri Lanka)";
}
