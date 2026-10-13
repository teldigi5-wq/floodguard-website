"use client";
import {useState} from "react";
import {Check,Clipboard,Download,FileJson,TriangleAlert} from "lucide-react";
import {useLive} from "@/hooks/use-live";

export function StatusSnapshot(){
 const{data,age,freshness}=useLive(),[notice,setNotice]=useState("");
 const snapshot=()=>({
  generatedAt:new Date().toISOString(),freshness,ageSeconds:age,
  water:{levelCm:data?.water?.levelCm??null,distanceCm:data?.water?.distanceCm??null,status:data?.water?.status??null},
  rain:{currentMm:data?.rain?.currentMm??null,dailyMm:data?.rain?.dailyMm??null,status:data?.rain?.status??null},
  gate:{status:data?.gate?.status??null,angle:data?.gate?.angle??null,reason:data?.gate?.reason??null},
  alarm:{active:data?.alarm?.active??null,type:data?.alarm?.type??null},
  esp8266:{status:data?.esp8266?.status??data?.esp8266?.connection??null,rssi:data?.esp8266?.rssi??null},
 });
 const summary=()=>{const s=snapshot();return `FloodGuard observation — ${s.generatedAt}\nFreshness: ${s.freshness} (${s.ageSeconds??"unknown"}s old)\nWater level: ${s.water.levelCm??"unavailable"} cm · ${s.water.status??"unavailable"}\nRain: ${s.rain.currentMm??"unavailable"} mm current · ${s.rain.dailyMm??"unavailable"} mm daily\nGate: ${s.gate.status??"unavailable"} · ${s.gate.angle??"unavailable"}°\nAlarm: ${s.alarm.active===true?"ACTIVE":s.alarm.active===false?"CLEAR":"unavailable"}\nESP8266: ${s.esp8266.status??"unavailable"} · ${s.esp8266.rssi??"unavailable"} dBm`};
 const flash=(message:string)=>{setNotice(message);window.setTimeout(()=>setNotice(""),2200)};
 const copy=async()=>{try{await navigator.clipboard.writeText(summary());flash("Summary copied")}catch{flash("Copy unavailable")}};
 const download=()=>{const blob=new Blob([JSON.stringify(snapshot(),null,2)],{type:"application/json"}),url=URL.createObjectURL(blob),link=document.createElement("a");link.href=url;link.download=`floodguard-observation-${new Date().toISOString().replaceAll(":","-")}.json`;link.click();URL.revokeObjectURL(url);flash("JSON downloaded")};
 return <section className="snapshot-panel"><div className="snapshot-icon"><FileJson/></div><div className="snapshot-copy"><p className="eyebrow">Project demo tool</p><h2>Export the current observation.</h2><p>Create a clean summary for a demonstration or project record. This captures only the current browser observation—not historical data—and excludes network addresses, credentials and raw payload fields.</p><div className="snapshot-state"><span className={`status-pulse ${freshness}`}/><b>{freshness}</b><span>{age===null?"Update age unavailable":`${age} seconds old`}</span></div></div><div className="snapshot-actions"><button className="button ghost" onClick={copy}><Clipboard/> Copy summary</button><button className="button" onClick={download}><Download/> Download JSON</button><span role="status" aria-live="polite">{notice&&(notice.includes("unavailable")?<TriangleAlert/>:<Check/>)} {notice}</span></div></section>;
}
