// FloodGuard R3 V2: browser-safe strict protocol, NOT a deployed client.
// A device signs OBSERVED data, never its server admission timestamp.
// The gateway signs an independent admission receipt after a clock read.
// Signature validity does not prove sensor accuracy, hardware clock truth,
// durable antirollback, RTDB commit or production service operation.
export const V2_OBSERVATION='floodguard-r3-observation-v2-lab';
export const V2_ADMISSION='floodguard-r3-server-admission-v2-lab';
const streams=['water','rain'];
const MINT=Date.UTC(2000,0,1);
const MAXT=Number.MAX_SAFE_INTEGER;
const obsFields=['version','stream','sourceAlias','epoch','sequence',
  'observedAtMs','sample'];
const admFields=['version','stream','sourceAlias','epoch','sequence',
  'reportDigest','admittedAtMs'];
const waterFields=['distanceCm','levelCm','reportedStatus'];
const rainFields=['currentMm','dailyMm','reportedStatus'];
const ws=new Set(['SAFE','WARNING','DANGER','SENSOR_ERROR']);
const rs=new Set(['NORMAL','HEAVY_RAIN','FLOOD_WARNING','EXTREME','CRITICAL',
  'SENSOR_ERROR','UNKNOWN']);
const plain=x=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&
  (Object.getPrototypeOf(x)===Object.prototype||
   Object.getPrototypeOf(x)===null);
const exact=(x,fields)=>plain(x)&&Object.keys(x).length===fields.length&&
  fields.every(f=>Object.hasOwn(x,f));
const integer=(x,lo,hi)=>Number.isSafeInteger(x)&&x>=lo&&x<=hi;
const measure=(x,max)=>typeof x==='number'&&Number.isFinite(x)&&x>=0&&x<=max;
const alias=s=>s+'-primary';
const code=new TextEncoder();
export function canonicalR3V2Observation(p){
  if(!exact(p,obsFields)||p.version!==V2_OBSERVATION||
     !streams.includes(p.stream)||p.sourceAlias!==alias(p.stream)||
     !integer(p.epoch,1,10000)||!integer(p.sequence,1,2147483647)||
     !integer(p.observedAtMs,MINT,MAXT))
    throw TypeError('Invalid V2 observed report');
  const s=p.sample;
  if(p.stream==='water'){
    if(!exact(s,waterFields)||!measure(s.distanceCm,25)||
       !measure(s.levelCm,25)||
       Math.abs(s.distanceCm+s.levelCm-25)>0.001||
       !ws.has(s.reportedStatus))throw TypeError('Invalid water sample');
  }else if(!exact(s,rainFields)||!measure(s.currentMm,10000)||
    !measure(s.dailyMm,10000)||!rs.has(s.reportedStatus))
    throw TypeError('Invalid rain sample');
  const canonical=JSON.stringify({
    version:V2_OBSERVATION,stream:p.stream,sourceAlias:p.sourceAlias,
    epoch:p.epoch,sequence:p.sequence,observedAtMs:p.observedAtMs,
    sample:p.stream==='water'?{
      distanceCm:s.distanceCm,levelCm:s.levelCm,
      reportedStatus:s.reportedStatus
    }:{
      currentMm:s.currentMm,dailyMm:s.dailyMm,
      reportedStatus:s.reportedStatus
    }
  });
  if(code.encode(canonical).byteLength>512)throw TypeError('Oversized report');
  return canonical;
}
export function canonicalR3V2Admission(p){
  if(!exact(p,admFields)||p.version!==V2_ADMISSION||
     !streams.includes(p.stream)||p.sourceAlias!==alias(p.stream)||
     !integer(p.epoch,1,10000)||!integer(p.sequence,1,2147483647)||
     typeof p.reportDigest!=='string'||
     !/^[a-f0-9]{64}$/.test(p.reportDigest)||
     !integer(p.admittedAtMs,MINT,MAXT))
    throw TypeError('Invalid V2 server admission');
  return JSON.stringify({
    version:V2_ADMISSION,stream:p.stream,sourceAlias:p.sourceAlias,
    epoch:p.epoch,sequence:p.sequence,reportDigest:p.reportDigest,
    admittedAtMs:p.admittedAtMs
  });
}
function binary(text,max=256){
  if(typeof text!=='string'||text.length>max||
    !/^[A-Za-z0-9_-]+$/.test(text)||text.length%4===1)
    throw TypeError('Malformed base64url');
  const x=Uint8Array.from(atob(text.replace(/-/g,'+').replace(/_/g,'/')+
    '='.repeat((4-text.length%4)%4)),z=>z.charCodeAt(0));
  const encoded=btoa(String.fromCharCode(...x)).replace(/\+/g,'-')
    .replace(/\//g,'_').replace(/=+$/,'');
  if(encoded!==text)throw TypeError('Noncanonical base64url');
  return x;
}
const shaHex=bytes=>Array.from(new Uint8Array(bytes),
  x=>x.toString(16).padStart(2,'0')).join('');
const fail=reason=>Object.freeze({verified:false,reason});
export async function verifyR3V2Envelope({
  stream,envelope,pins,subtle,nowMs,connected=false,prior=null
}={}){
  if(!streams.includes(stream))return fail('stream-unrecognized');
  if(connected!==true||!integer(nowMs,MINT,MAXT))
    return fail('observer-unavailable');
  if(!subtle||typeof subtle.importKey!=='function'||
     typeof subtle.verify!=='function'||typeof subtle.digest!=='function')
    return fail('browser-crypto-unavailable');
  if(!exact(envelope,['report','admission'])||
     !exact(envelope.report,['payload','signature'])||
     !exact(envelope.admission,['receipt','signature'])||
     !plain(pins)||typeof pins.report!=='string'||
     typeof pins.issuer!=='string')
    return fail('envelope-or-trust-shape-invalid');
  let observed,issued,pkey,ikey,rsig,isig;
  try{
    observed=canonicalR3V2Observation(envelope.report.payload);
    issued=canonicalR3V2Admission(envelope.admission.receipt);
    pkey=binary(pins.report);ikey=binary(pins.issuer);
    rsig=binary(envelope.report.signature);
    isig=binary(envelope.admission.signature);
    if(pkey.length!==44||ikey.length!==44||
      rsig.length!==64||isig.length!==64||
      pkey.every((x,i)=>x===ikey[i]))
      return fail('invalid-or-shared-signing-key');
  }catch{return fail('invalid-canonical-evidence');}
  const p=envelope.report.payload,q=envelope.admission.receipt;
  if(p.stream!==stream||q.stream!==stream||
    p.sourceAlias!==q.sourceAlias||p.epoch!==q.epoch||
    p.sequence!==q.sequence)return fail('report-admission-binding-invalid');
  // Admission is a gateway signing event, NOT proof of RTDB commit time.
  if(q.admittedAtMs<p.observedAtMs-2000||
     q.admittedAtMs>p.observedAtMs+10000||
     q.admittedAtMs>nowMs+2000||
     p.observedAtMs>nowMs+2000||
     nowMs-Math.max(p.observedAtMs,q.admittedAtMs)>10000)
    return fail('unverifiable-source-or-admission-time');
  if(prior!==null){
    if(!exact(prior,['sourceAlias','epoch','sequence','observedAtMs',
      'admittedAtMs'])||prior.sourceAlias!==p.sourceAlias||
       prior.epoch!==p.epoch||p.sequence<=prior.sequence||
       p.observedAtMs<prior.observedAtMs||
       q.admittedAtMs<=prior.admittedAtMs)
      return fail('replay-or-clock-rollback');
  }
  let digest;
  try{digest=shaHex(await subtle.digest('SHA-256',code.encode(observed)));}
  catch{return fail('browser-digest-unavailable');}
  if(digest!==q.reportDigest)return fail('report-digest-mismatch');
  try{
    const reportKey=await subtle.importKey('spki',pkey,{name:'Ed25519'},
      false,['verify']);
    if(!await subtle.verify('Ed25519',reportKey,rsig,code.encode(observed)))
      return fail('report-signature-invalid');
    const issuerKey=await subtle.importKey('spki',ikey,{name:'Ed25519'},
      false,['verify']);
    if(!await subtle.verify('Ed25519',issuerKey,isig,code.encode(issued)))
      return fail('admission-signature-invalid');
  }catch{return fail('signature-verifier-unavailable');}
  const s=p.sample;
  return Object.freeze({
    verified:true,kind:'V2_DUAL_SIGNED_LAB_NOT_PHYSICAL_OR_COMMIT_PROOF',
    sourceAlias:p.sourceAlias,epoch:p.epoch,sequence:p.sequence,
    observedAtMs:p.observedAtMs,serverAdmittedAtMs:q.admittedAtMs,
    sample:Object.freeze(p.stream==='water'?{
      distanceCm:s.distanceCm,levelCm:s.levelCm,
      reportedStatus:s.reportedStatus
    }:{
      currentMm:s.currentMm,dailyMm:s.dailyMm,
      reportedStatus:s.reportedStatus
    }),
    physicalSafetyVerified:false,productionBackendVerified:false,
    durableAntirollbackVerified:false
  });
}
