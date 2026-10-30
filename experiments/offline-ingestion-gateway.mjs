// Stage 6: in-memory, synthetic-only SECURITY REHEARSAL.
// No listener, Firebase SDK, socket, credentials, real TLS handshake, device IO,
// runtime import, environment lookup, files or persistent records are present.
// Exports are deliberately named *Synthetic* to avoid deployment confusion.
const SCOPE='prototype-ingest-v1';
const FIELDS=Object.freeze(['sequence','distanceCm','levelCm','risk']);
const RISKS=new Set(['SAFE','WARNING','DANGER','SENSOR_ERROR']);
const TEST_DEVICE=/^device-stage-[a-z0-9-]{1,32}$/;
const MAX_FRAME_BYTES=256;
const MAX_LEGACY_BYTES=4096;

function record(value){
  return value!==null && typeof value==='object' && !Array.isArray(value)
    && (Object.getPrototypeOf(value)===Object.prototype||Object.getPrototypeOf(value)===null);
}
function fieldSet(value,fields){
  return record(value) && Object.keys(value).length===fields.length
    && fields.every(field=>Object.hasOwn(value,field));
}
function boundedJsonSize(value,maximum){
  try {return Buffer.byteLength(JSON.stringify(value),'utf8')<=maximum;}
  catch{return false;}
}
export function validateSyntheticFrame(frame){
  if(!fieldSet(frame,FIELDS)||!boundedJsonSize(frame,MAX_FRAME_BYTES))
    return {ok:false,reason:'schema-or-size'};
  if(!Number.isSafeInteger(frame.sequence)||frame.sequence<1||frame.sequence>2147483647)
    return {ok:false,reason:'invalid-sequence'};
  // This strict synthetic contract models the declared *installation*,
  // not the HC-SR04 transducer's larger nominal measurement envelope.
  // An exact zero air gap remains ambiguous until firmware is inspected;
  // do not accept it as authenticated evidence of either SAFE or DANGER.
  if(typeof frame.distanceCm!=='number'||!Number.isFinite(frame.distanceCm)
    ||frame.distanceCm<=0||frame.distanceCm>25)
    return {ok:false,reason:'invalid-distance'};
  if(typeof frame.levelCm!=='number'||!Number.isFinite(frame.levelCm)
    ||frame.levelCm<0||frame.levelCm>25)
    return {ok:false,reason:'invalid-level'};
  if(typeof frame.risk!=='string'||!RISKS.has(frame.risk))
    return {ok:false,reason:'invalid-risk'};
  // A signed but contradictory tuple is still bad telemetry: a valid
  // identity does not certify a self-consistent physical sensor reading.
  // 0.05 cm allows firmware decimal rounding, not physical calibration drift.
  if(Math.abs(frame.levelCm-(25-frame.distanceCm))>0.05)
    return {ok:false,reason:'inconsistent-installation-depth'};
  const assessed=frame.levelCm>=11?'DANGER'
    :frame.levelCm>=8.5?'WARNING':'SAFE';
  if(frame.risk!=='SENSOR_ERROR'&&frame.risk!==assessed)
    return {ok:false,reason:'inconsistent-water-risk'};
  return {ok:true,frame:Object.freeze(Object.fromEntries(FIELDS.map(k=>[k,frame[k]])))};
}
// Legacy shape inspection ONLY. In particular, never translate an anonymous
// parent PATCH/PUT into an authenticated write by merely stripping private data.
export function inspectSyntheticLegacyUpload({method,path,payload}={}){
  if(method!=='PUT'&&method!=='PATCH')return {shape:'unsupported',canForward:false,reason:'method'};
  if(path!=='/floodguard/live'||!record(payload)||!boundedJsonSize(payload,MAX_LEGACY_BYTES))
    return {shape:'unsupported',canForward:false,reason:'root-or-payload'};
  const keys=method==='PATCH'?Object.keys(payload):Object.keys(payload).flatMap(k=>{
    const subtree=payload[k];
    return record(subtree)?Object.keys(subtree).map(x=>k+'/'+x):[k];
  });
  const expected=['water/distanceCm','water/levelCm','water/status'];
  const present=expected.every(k=>keys.includes(k));
  const privateMetadata=keys.some(k=>k==='esp8266/ip'||k==='esp8266/wifi');
  const unsupported=keys.some(k=>!expected.includes(k));
  // The archived firmware variants produce extra fields, including network
  // metadata. No raw values are returned from this inspection utility.
  return Object.freeze({
    shape:method==='PATCH'?'legacy-root-patch':'legacy-whole-tree-put',
    canForward:false,authenticated:false,sequenceAvailable:false,
    requiredWaterFieldsPresent:present,privateMetadataPresent:privateMetadata,
    unreviewedFieldsPresent:unsupported,
    reason:'no-authenticated-ingestion-contract'
  });
}
export function calculateSyntheticBackoff({baseMs=250,maxMs=2000,attempts=4}={}){
  if(!Number.isSafeInteger(baseMs)||baseMs<50||baseMs>5000
    ||!Number.isSafeInteger(maxMs)||maxMs<baseMs||maxMs>60000
    ||!Number.isSafeInteger(attempts)||attempts<1||attempts>6)
    throw new RangeError('bounded synthetic retry settings required');
  return Object.freeze(Array.from({length:attempts},(_,i)=>Math.min(maxMs,baseMs*2**i)));
}
export function createSyntheticOfflineQueue({capacity=4}={}){
  if(!Number.isSafeInteger(capacity)||capacity<1||capacity>16)
    throw new RangeError('synthetic queue size must be bounded');
  const queued=[];
  return Object.freeze({
    enqueue(frame){
      const verified=validateSyntheticFrame(frame);
      if(!verified.ok)return {accepted:false,reason:verified.reason};
      if(queued.length>=capacity)return {accepted:false,reason:'queue-full'};
      if(queued.length && verified.frame.sequence<=queued[queued.length-1].sequence)
        return {accepted:false,reason:'out-of-order'};
      queued.push(verified.frame);
      return {accepted:true,depth:queued.length};
    },
    drainTo(gateway,credentials){
      if(!gateway||typeof gateway.accept!=='function')throw new TypeError('missing synthetic gateway');
      let processed=0;
      while(queued.length){
        const result=gateway.accept({...credentials,frame:queued[0]});
        if(!result.accepted)return {processed,remaining:queued.length,stopped:result.reason};
        queued.shift();processed++;
      }
      return {processed,remaining:0,stopped:null};
    },
    get depth(){return queued.length;}
  });
}
export function createSyntheticGatewayHarness({clock=()=>0}={}){
  if(typeof clock!=='function')throw new TypeError('Synthetic clock required');
  const registry=new Map();
  const credentials=new WeakMap();
  const proofs=new WeakSet();
  const lastSequence=new Map();
  const epochs=new Map();
  const evidence=()=>Object.freeze({kind:'SYNTHETIC_TRANSPORT_PROOF_NOT_REAL_TLS'});
  function assertDevice(uid){
    if(typeof uid!=='string'||!TEST_DEVICE.test(uid))throw new RangeError('Synthetic device UID only');
  }
  return Object.freeze({
    provision(uid,{enabled=true,scope=SCOPE}={}){
      assertDevice(uid);
      registry.set(uid,{enabled:enabled===true,scope});
      if(!epochs.has(uid))epochs.set(uid,0);
    },
    revoke(uid){
      assertDevice(uid);
      registry.set(uid,{enabled:false,scope:'revoked'});
      epochs.set(uid,(epochs.get(uid)||0)+1);
    },
    issueSyntheticToken(uid,{ttlMs=60000}={}){
      assertDevice(uid);
      const entry=registry.get(uid);
      const now=clock();
      if(!entry?.enabled||entry.scope!==SCOPE)throw new Error('Device not provisioned for synthetic ingestion');
      if(!Number.isSafeInteger(ttlMs)||ttlMs<1000||ttlMs>3600000
        ||!Number.isSafeInteger(now)||now<0)throw new RangeError('Invalid test-only TTL or clock');
      const token=Object.freeze({kind:'SYNTHETIC_TOKEN_NOT_A_FIREBASE_JWT'});
      credentials.set(token,{uid,epoch:epochs.get(uid),expiresAt:now+ttlMs});
      return token;
    },
    issueSyntheticTransportProof(){
      const proof=evidence();proofs.add(proof);return proof;
    },
    accept({token,transportProof,frame}={}){
      // No token or URL is ever serialized or logged.
      if(!proofs.has(transportProof))return {accepted:false,reason:'transport-unverified'};
      const claim=token && typeof token==='object'?credentials.get(token):undefined;
      if(!claim)return {accepted:false,reason:'untrusted-identity'};
      const reg=registry.get(claim.uid);
      if(!reg?.enabled||reg.scope!==SCOPE||claim.epoch!==epochs.get(claim.uid))
        return {accepted:false,reason:'revoked-or-unscoped'};
      const now=clock();
      if(!Number.isSafeInteger(now)||now<0||now>=claim.expiresAt)
        return {accepted:false,reason:'expired-identity'};
      const payload=validateSyntheticFrame(frame);
      if(!payload.ok)return {accepted:false,reason:payload.reason};
      const previous=lastSequence.get(claim.uid)||0;
      if(payload.frame.sequence<=previous)return {accepted:false,reason:'replay-or-out-of-order'};
      lastSequence.set(claim.uid,payload.frame.sequence);
      // No Firebase write, session mutation, physical command or network call.
      return {accepted:true,kind:'SYNTHETIC_ACCEPTANCE_ONLY',sequence:payload.frame.sequence};
    },
    lastAcceptedSequence(uid){assertDevice(uid);return lastSequence.get(uid)||0;}
  });
}
