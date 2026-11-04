"use client";
import {useState} from "react";
import {Check,Clipboard,Download,FileJson,TriangleAlert} from "lucide-react";
import {useLive} from "@/hooks/use-live";
import {ageLabel,lastSeenLabel} from "@/components/ui";
import {describePublicObservation} from "@/lib/public-observation-trust.mjs";
import {buildPublicObservationExport,formatPublicObservationSummary} from "@/lib/public-observation-export.mjs";

export function StatusSnapshot(){
  const {data,age,freshness,lastUpdateMs}=useLive();
  const [notice,setNotice]=useState("");
  const snapshot=()=>buildPublicObservationExport({
    data,ageSeconds:age,freshness,lastUpdateMs,
    generatedAt:new Date().toISOString()
  });
  const summary=()=>formatPublicObservationSummary(snapshot());
  const flash=(message:string)=>{
    setNotice(message);
    window.setTimeout(()=>setNotice(""),2200);
  };
  const copy=async()=>{
    try {
      await navigator.clipboard.writeText(summary());
      flash("Observation summary copied");
    } catch {
      flash("Copy unavailable");
    }
  };
  const download=()=>{
    const blob=new Blob([JSON.stringify(snapshot(),null,2)],{type:"application/json"});
    const url=URL.createObjectURL(blob);
    const link=document.createElement("a");
    link.href=url;
    link.download=`floodguard-unverified-observation-${new Date().toISOString().replaceAll(":","-")}.json`;
    link.click();
    URL.revokeObjectURL(url);
    flash("Unverified observation JSON downloaded");
  };
  return <section className="snapshot-panel">
    <div className="snapshot-icon"><FileJson/></div>
    <div className="snapshot-copy">
      <p className="eyebrow">Unsigned demonstration evidence</p>
      <h2>Export a non-operational observation.</h2>
      <p>
        The copy and JSON export preserve allowlisted Firebase reports and
        timestamp context, but explicitly mark the source unverified and
        physical flood safety UNKNOWN. They are not a warning clearance,
        gate inspection, signed source record or production release certificate.
        Private network details, credentials and raw unfiltered payloads
        are excluded.
      </p>
      <div className="snapshot-state">
        <span className={`status-pulse ${freshness}`}/>
        <b>{describePublicObservation(freshness).label}</b>
        <span>{lastSeenLabel(lastUpdateMs)} · {ageLabel(age)}</span>
      </div>
    </div>
    <div className="snapshot-actions">
      <button className="button ghost" onClick={copy}><Clipboard/> Copy qualified summary</button>
      <button className="button" onClick={download}><Download/> Download observation JSON</button>
      <span role="status" aria-live="polite">
        {notice&&(notice.includes("unavailable")?<TriangleAlert/>:<Check/>)} {notice}
      </span>
    </div>
  </section>;
}
