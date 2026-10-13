"use client";
import {Cable,CloudRain,Cpu,RotateCw,Signal,Timer,Wifi} from "lucide-react";
import {useLive} from "@/hooks/use-live";
import {fmt,label} from "@/components/ui";
import {PageHero,StatePanel} from "@/components/page-kit";

const inventory = [
  ["arduino","Arduino Uno",Cpu],
  ["esp8266","ESP8266",Wifi],
  ["ultrasonic","HC-SR04",Signal],
  ["rtc","RTC",Timer],
  ["servo","Servo",RotateCw],
  ["rainGauge","Rain Gauge",CloudRain],
] as const;

function normalize(raw: unknown) {
  if (raw && typeof raw === "object") {
    const r=raw as Record<string,unknown>;
    raw=r.status??r.state??r.online??r.installed;
  }
  const text=typeof raw === "string" ? raw.trim().toUpperCase() : raw===true ? "ONLINE" : raw===false ? "OFFLINE" : "UNKNOWN";
  if (["CONNECTED","ACTIVE"].includes(String(text))) return "ONLINE";
  if (["DISCONNECTED","INACTIVE"].includes(String(text))) return "OFFLINE";
  if (["ERROR","FAULT"].includes(String(text))) return "ERROR";
  if (["NOT_INSTALLED","REMOVED","DISABLED"].includes(String(text))) return "NOT INSTALLED";
  return ["ONLINE","OFFLINE"].includes(String(text)) ? String(text) : "UNKNOWN";
}

export default function Devices(){
  const {data,freshness}=useLive();
  const deviceData=data?.devices as Record<string,unknown>|undefined;
  return <main className="page">
    <PageHero eyebrow="Field inventory" title="Device health" copy="Device states reported by the field system. Historical statuses are never presented as proof that equipment is online now."/>
    <StatePanel/>
    <section className="device-grid current-only">
      {inventory.map(([key,name,Icon])=>{
        const raw = key === "esp8266"
          ? (data?.esp8266?.status ?? data?.esp8266?.connection)
          : deviceData?.[key];
        const s=normalize(raw);
        const historical=freshness!=="live";
        return <article key={key} className={`device ${historical?"stale":s.toLowerCase()}`}>
          <div className="device-top"><span className="device-icon"><Icon/></span><span className="device-state">{freshness==="live"?s:`LAST REPORTED: ${s}`}</span></div>
          <div className="device-copy"><h2>{name}</h2><p>{freshness==="live"?"Reported field status":"Historical record · physical connectivity unverified"}</p></div>
        </article>;
      })}
    </section>
    <section className="network">
      <div><Cable/><h2>ESP8266 network</h2><p>The ESP8266 status comes from the dedicated <code>esp8266</code> Firebase branch, so it no longer appears UNKNOWN just because it is not duplicated inside the devices object.</p></div>
      <dl><dt>Status</dt><dd>{freshness==="live"?label(data?.esp8266?.status??data?.esp8266?.connection):"Last recorded: "+label(data?.esp8266?.status??data?.esp8266?.connection)}</dd><dt>Signal</dt><dd>{fmt(data?.esp8266?.rssi,"dBm",0)}</dd><dt>Transport</dt><dd>Firebase Realtime Database</dd></dl>
    </section>
  </main>;
}
