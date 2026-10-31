// R3 browser-compatible proof reader. LAB-ONLY, not attached to the
// production FloodProvider. Uses injected SubtleCrypto; no Node crypto,
// Firebase import, network, secrets, signing operation or mutation here.
// A signed report is NOT proof of sensor accuracy, issued server receipt,
// durable replay protection, current hardware state or physical flood safety.
import {classifySourceBoundFreshness} from '../lib/telemetry-health.mjs';
import {reconcileCalibratedWaterMeasurement,reconcileReportedRainStatus}
  from '../lib/telemetry-safety.mjs';

const VERSION='floodguard-r2-public-proof-lab-v1';
const FIELDS=['version','stream','sourceAlias','epoch','sequence',
  'observedAtMs','receivedAtMs','sample'];
const WATER=['distanceCm','levelCm','reportedStatus'];
const RAIN=['currentMm','dailyMm','reportedStatus'];
const WATER_STATUS=new Set(['SAFE','WARNING','DANGER','SENSOR_ERROR']);
const RAIN_STATUS=new Set(['NORMAL','HEAVY_RAIN','FLOOD_WARNING','EXTREME',
  'CRITICAL','SENSOR_ERROR','UNKNOWN']);
const MINTIME=Date.UTC(2000,0,1);
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&
  (Object.getPrototypeOf(x)===Object.prototype||
   Object.getPrototypeOf(x)===null);
const exact=(x,fields)=>object(x)&&Object.keys(x).length===fields.length&&
  fields.every(k=>Object.hasOwn(x,k));
const integer=(v,min,max)=>Number.isSafeInteger(v)&&v>=min&&v<=max;
const measure=(v,min,max)=>typeof v==='number'&&Number.isFinite(v)&&
  v>=min&&v<=max;
const reject=reason=>Object.freeze({verified:false,reason});
const encoder=new TextEncoder();

function decodeBase64Url(text) {
  if(typeof text!=='string'||text.length>256||!(/^[A-Za-z0-9_-]+$/).test(text)||
      text.length%4===1)throw new TypeError('Invalid base64url');
  const raw=text.replace(/-/g,'+').replace(/_/g,'/');
  const padded=raw+'='.repeat((4-raw.length%4)%4);
  const binary=atob(padded);
  const bytes=Uint8Array.from(binary,char=>char.charCodeAt(0));
  // No ambiguous noncanonical base64 encodings accepted.
  const canonical=btoa(String.fromCharCode(...bytes)).replace(/\+/g,'-')
    .replace(/\//g,'_').replace(/=+$/,'');
  if(canonical!==text)throw new TypeError('Noncanonical base64url');
  return bytes;
}

export function canonicalR3BrowserPublicEvidence(payload) {
  if(!exact(payload,FIELDS)||payload.version!==VERSION||
     (payload.stream!=='water'&&payload.stream!=='rain')||
     payload.sourceAlias!==(payload.stream==='water'
       ?'water-primary':'rain-primary')||
     !integer(payload.epoch,1,10000)||
     !integer(payload.sequence,1,2147483647)||
     !integer(payload.observedAtMs,MINTIME,Number.MAX_SAFE_INTEGER)||
     !integer(payload.receivedAtMs,MINTIME,Number.MAX_SAFE_INTEGER)||
     payload.receivedAtMs<payload.observedAtMs)
    throw new TypeError('Invalid R3 public report contract');
  const s=payload.sample;
  if(payload.stream==='water'){
    if(!exact(s,WATER)||!measure(s.distanceCm,0,25)||
      !measure(s.levelCm,0,25)||
      Math.abs(s.distanceCm+s.levelCm-25)>0.001||
      !WATER_STATUS.has(s.reportedStatus))
      throw new TypeError('Invalid R3 water report');
  }else if(!exact(s,RAIN)||!measure(s.currentMm,0,10000)||
       !measure(s.dailyMm,0,10000)||
       !RAIN_STATUS.has(s.reportedStatus))
    throw new TypeError('Invalid R3 rain report');
  const normalized={
    version:VERSION,stream:payload.stream,sourceAlias:payload.sourceAlias,
    epoch:payload.epoch,sequence:payload.sequence,
    observedAtMs:payload.observedAtMs,receivedAtMs:payload.receivedAtMs,
    sample:payload.stream==='water'
      ?{distanceCm:s.distanceCm,levelCm:s.levelCm,
        reportedStatus:s.reportedStatus}
      :{currentMm:s.currentMm,dailyMm:s.dailyMm,
        reportedStatus:s.reportedStatus}
  };
  const bytes=JSON.stringify(normalized);
  if(encoder.encode(bytes).byteLength>512)
    throw new TypeError('Oversized R3 public report');
  return bytes;
}

function reportDisplay(p) {
  // Only allowlisted scalar fields: NEVER device IDs, IPs, contacts,
  // actuator commands, private receipts or Firebase paths in display state.
  const s=p.sample;
  if(p.stream==='water'){
    const derived=reconcileCalibratedWaterMeasurement({
      distanceCm:s.distanceCm,levelCm:s.levelCm,status:s.reportedStatus
    });
    return Object.freeze({
      stream:'water',sourceAlias:p.sourceAlias,epoch:p.epoch,
      sequence:p.sequence,observedAtMs:p.observedAtMs,
      receivedAtMs:p.receivedAtMs,reportedStatus:s.reportedStatus,
      interpretedStatus:derived.status,
      distanceCm:derived.distanceCm,levelCm:derived.levelCm
    });
  }
  return Object.freeze({
    stream:'rain',sourceAlias:p.sourceAlias,epoch:p.epoch,
    sequence:p.sequence,observedAtMs:p.observedAtMs,
    receivedAtMs:p.receivedAtMs,reportedStatus:s.reportedStatus,
    interpretedStatus:reconcileReportedRainStatus({
      status:s.reportedStatus,dailyMm:s.dailyMm
    }),currentMm:s.currentMm,dailyMm:s.dailyMm
  });
}

/**
 * spkiBase64url comes from a pinned operator config OUTSIDE the RTDB record.
 * Do not trust a public key shipped in the record or fetched from its branch.
 * Ed25519 SubtleCrypto support depends on the client runtime; lack of support
 * fails closed. No cryptographic operation signs data or mutates anything.
 */
export async function verifyR3BrowserPublicReport({
  stream,record,spkiBase64url,subtle,connected=false,nowMs,prior=null
}={}) {
  if(stream!=='water'&&stream!=='rain')return reject('stream-unrecognized');
  if(connected!==true||!integer(nowMs,MINTIME,Number.MAX_SAFE_INTEGER))
    return reject('observer-unavailable');
  if(!subtle||typeof subtle.importKey!=='function'||
     typeof subtle.verify!=='function')
    return reject('browser-ed25519-unavailable');
  if(!exact(record,['payload','signature'])||
     record.payload?.stream!==stream||
     typeof record.signature!=='string'||
     !/^[A-Za-z0-9_-]{86}$/.test(record.signature))
    return reject('report-shape-invalid');
  let canonical,signature,spki;
  try{
    canonical=canonicalR3BrowserPublicEvidence(record.payload);
    signature=decodeBase64Url(record.signature);
    spki=decodeBase64Url(spkiBase64url);
    if(signature.length!==64||spki.length!==44)
      return reject('signature-or-key-invalid');
  }catch{return reject('report-or-trust-pin-invalid');}
  try{
    const key=await subtle.importKey('spki',spki,{name:'Ed25519'},
      false,['verify']);
    if(!await subtle.verify({name:'Ed25519'},key,signature,
      encoder.encode(canonical)))return reject('report-signature-unverified');
  }catch{return reject('browser-ed25519-unavailable');}

  const p=record.payload;
  const reading={
    stream,sourceId:p.sourceAlias,epoch:p.epoch,sequence:p.sequence,
    observedAt:p.observedAtMs,receivedAt:p.receivedAtMs
  };
  const previous=prior===null?null:{
    sourceId:prior.sourceAlias,epoch:prior.epoch,sequence:prior.sequence,
    observedAt:prior.observedAtMs,receivedAt:prior.receivedAtMs
  };
  if(classifySourceBoundFreshness({
    stream,observation:reading,prior:previous,
    connected:true,loading:false,hasData:true,error:false,nowMs
  })!=='live')return reject('source-not-current');
  return Object.freeze({
    verified:true,kind:'SIGNED_REPORT_ONLY_NOT_INGESTION_OR_PHYSICAL_PROOF',
    report:reportDisplay(p)
  });
}

const PATHS=Object.freeze({
  water:'/floodguard/evidenceLabV1/water',
  rain:'/floodguard/evidenceLabV1/rain'
});
const STREAMS=['water','rain'];
const empty=()=>({status:'unavailable',reason:'no-report',report:null});

/**
 * In-memory observer over an INJECTED read-only subscription adapter.
 * Subscription paths fixed here; it never accepts arbitrary RTDB paths.
 * subscribe(path, onValue, onError) must return an unsubscribe function.
 * Async signature verification is revision-fenced to prevent stale crypto
 * results from overwriting newer callbacks. State resets on disconnect.
 *
 * No callback can emit a physical SAFE/LOW claim. The report is explicitly
 * advisory and can never be the site's existing source of safety truth.
 */
export function createR3ReadOnlyEvidenceObserver({
  subscribe,spkiPins,subtle,clock,onChange
}={}) {
  if(typeof subscribe!=='function'||typeof clock!=='function'||
     typeof onChange!=='function'||
     !object(spkiPins)||typeof spkiPins.water!=='string'||
     typeof spkiPins.rain!=='string')
    throw new TypeError('Explicit read-only adapter and pinned keys required');
  const entries={water:empty(),rain:empty()};
  const accepted={water:null,rain:null};
  const revisions={water:0,rain:0};
  let connected=false,closed=false,started=false;
  const unsubs=[];
  function snapshot() {
    return Object.freeze({
      connected,kind:'R3_LAB_SIGNED_REPORTS_NOT_PHYSICAL_PROOF',
      water:Object.freeze({...entries.water}),
      rain:Object.freeze({...entries.rain}),
      physicalSafetyVerified:false,
      backendReceiptVerified:false,
      productionCutoverApproved:false
    });
  }
  const emit=()=>{if(!closed)onChange(snapshot());};
  const set=(stream,status,reason,report=null)=>{
    entries[stream]={status,reason,report};
    emit();
  };
  async function ingest(stream,value) {
    const revision=++revisions[stream];
    if(!connected){
      set(stream,'stale','database-disconnected');
      return;
    }
    if(value===null||value===undefined){
      set(stream,'unavailable','report-missing');
      return;
    }
    set(stream,'checking','signature-pending');
    const result=await verifyR3BrowserPublicReport({
      stream,record:value,spkiBase64url:spkiPins[stream],
      subtle,connected,nowMs:clock(),prior:accepted[stream]
    });
    if(closed||revision!==revisions[stream]||!connected)return;
    if(!result.verified){
      set(stream,'invalid',result.reason);
      return;
    }
    accepted[stream]={
      sourceAlias:result.report.sourceAlias,epoch:result.report.epoch,
      sequence:result.report.sequence,observedAtMs:result.report.observedAtMs,
      receivedAtMs:result.report.receivedAtMs
    };
    set(stream,'report-only','signed-report-not-physical-proof',result.report);
  }
  function start() {
    if(started||closed)throw Error('R3 lab observer cannot restart');
    started=true;
    const attach=(path,onValue,onError)=>{
      const stop=subscribe(path,onValue,onError);
      if(typeof stop!=='function')throw TypeError('Missing unsubscribe');
      unsubs.push(stop);
    };
    try {
      attach('.info/connected',value=>{
        if(closed)return;
        const next=value===true;
        connected=next;
        if(!next){
          for(const stream of STREAMS){
            ++revisions[stream];
            set(stream,'stale','database-disconnected');
          }
        }else emit();
      },()=>{
        connected=false;
        for(const stream of STREAMS){
          ++revisions[stream];
          set(stream,'stale','connection-state-unavailable');
        }
      });
      for(const stream of STREAMS)attach(PATHS[stream],
        value=>{if(!closed)void ingest(stream,value);},
        ()=>{if(!closed){
          ++revisions[stream];
          set(stream,'unavailable','read-denied-or-disconnected');
        }});
    }catch(e){close();throw e;}
    emit();
    return Object.freeze({snapshot,refresh,close});
  }
  function refresh(){
    if(closed)return snapshot();
    for(const stream of STREAMS){
      const state=entries[stream];
      if(state.status==='report-only'){
        const nowMs=clock(),r=state.report;
        if(!connected||!r||!integer(nowMs,MINTIME,Number.MAX_SAFE_INTEGER)||
           nowMs-r.observedAtMs>10000||nowMs<r.observedAtMs-2000){
          set(stream,'stale','report-age-or-clock-unverified',r);
        }
      }
    }
    return snapshot();
  }
  function close(){
    if(closed)return;
    closed=true;
    for(const stream of STREAMS)++revisions[stream];
    for(const stop of unsubs.splice(0))stop();
  }
  return Object.freeze({start,snapshot,refresh,close});
}
