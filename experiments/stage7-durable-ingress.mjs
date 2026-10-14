// Stage 7: offline, isolated cryptographic contract + crash-aware ledger rehearsal.
// NOT a gateway, Firebase writer, TLS endpoint, device firmware or production library.
// The caller MUST provide a test directory and test-only MAC key. No defaults,
// sessions, credentials, sockets, remote endpoints or environment lookups exist.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash, createHmac, randomBytes, timingSafeEqual, verify, KeyObject } from 'node:crypto';
import { validateSyntheticFrame } from './offline-ingestion-gateway.mjs';

const DEVICE=/^device-stage-[a-z0-9-]{1,32}$/;
const VERSION='floodguard-offline-envelope-v1';
const SCHEMA='floodguard-stage7-dry-run-ledger-v1';
const MAX_FILE=65536;
function object(value){
  return value!==null&&typeof value==='object'&&!Array.isArray(value)
    && (Object.getPrototypeOf(value)===Object.prototype||Object.getPrototypeOf(value)===null);
}
function exact(value,fields){
  return object(value)&&Object.keys(value).length===fields.length
    && fields.every(field=>Object.hasOwn(value,field));
}
function validInteger(value,min,max){
  return Number.isSafeInteger(value)&&value>=min&&value<=max;
}
function fingerprint(key){
  return createHash('sha256').update(key.export({format:'der',type:'spki'})).digest('hex');
}
export function canonicalOfflineEnvelope(value){
  if(!exact(value,['version','deviceId','epoch','observedAtMs','frame'])
    ||value.version!==VERSION||!DEVICE.test(value.deviceId)
    ||!validInteger(value.epoch,1,10000)
    ||!validInteger(value.observedAtMs,0,9007199254740991))
    throw new TypeError('Invalid synthetic signed envelope');
  const checked=validateSyntheticFrame(value.frame);
  if(!checked.ok)throw new TypeError('Invalid synthetic telemetry frame');
  const normalized={
    version:VERSION,deviceId:value.deviceId,epoch:value.epoch,
    observedAtMs:value.observedAtMs,frame:checked.frame
  };
  const text=JSON.stringify(normalized);
  if(Buffer.byteLength(text,'utf8')>512)throw new TypeError('Synthetic frame exceeds maximum');
  return text;
}
function checkLedgerState(state){
  if(!exact(state,['schema','records'])||state.schema!==SCHEMA||!object(state.records))
    throw new Error('Corrupt offline replay ledger');
  const names=Object.keys(state.records);
  if(names.length>32)throw new Error('Offline ledger full');
  for(const uid of names){
    const r=state.records[uid];
    if(!DEVICE.test(uid)||!exact(r,['epoch','sequence','keyFingerprint'])
      ||!validInteger(r.epoch,1,10000)
      ||!validInteger(r.sequence,1,2147483647)
      ||typeof r.keyFingerprint!=='string'||!/^[0-9a-f]{64}$/.test(r.keyFingerprint))
      throw new Error('Invalid offline ledger entry');
  }
}
export function createStage7OfflineLedger({directory,integrityKey}={}){
  if(typeof directory!=='string'||!path.isAbsolute(directory))
    throw new TypeError('Absolute test-only directory is required');
  if(!Buffer.isBuffer(integrityKey)||integrityKey.length<32)
    throw new TypeError('Fresh test-only integrity key is required');
  const stat=fs.lstatSync(directory);
  if(!stat.isDirectory()||stat.isSymbolicLink())throw new Error('Unsafe offline directory');
  const location=path.join(directory,'stage7-synthetic-ledger.json');
  const lockPath=path.join(directory,'stage7-synthetic-ledger.lock');
  const seal=state=>createHmac('sha256',integrityKey).update(JSON.stringify(state)).digest('hex');
  const fresh=()=>({schema:SCHEMA,records:{}});
  function read(){
    if(!fs.existsSync(location))return fresh();
    if(!fs.lstatSync(location).isFile())throw new Error('Unsafe offline ledger file');
    if(fs.statSync(location).size>MAX_FILE)throw new Error('Oversized offline ledger');
    const payload=JSON.parse(fs.readFileSync(location,'utf8'));
    if(!exact(payload,['state','mac'])||typeof payload.mac!=='string'
      ||!/^[0-9a-f]{64}$/.test(payload.mac))throw new Error('Invalid offline ledger seal');
    const expected=Buffer.from(seal(payload.state),'hex');
    if(!timingSafeEqual(expected,Buffer.from(payload.mac,'hex')))
      throw new Error('Offline ledger integrity failure');
    checkLedgerState(payload.state);
    return payload.state;
  }
  function withLock(action){
    let fd;
    // A stale lock intentionally blocks operation. Never unlink an unrelated
    // lock: resolution must be an explicit operator recovery decision.
    fd=fs.openSync(lockPath,'wx',0o600);
    try{
      const state=read();
      const outcome=action(state);
      if(outcome?.write){
        checkLedgerState(state);
        const tmp=path.join(directory,'stage7-'+randomBytes(12).toString('hex')+'.tmp');
        try{
          const body=JSON.stringify({state,mac:seal(state)});
          if(Buffer.byteLength(body)>MAX_FILE)throw new Error('Offline ledger too large');
          const output=fs.openSync(tmp,'wx',0o600);
          try{fs.writeFileSync(output,body);fs.fsyncSync(output);}finally{fs.closeSync(output);}
          fs.renameSync(tmp,location);
          // Filesystem directory metadata sync where supported. An error is
          // fail-closed, possibly after the rename has already committed.
          const dirFd=fs.openSync(directory,'r');
          try{fs.fsyncSync(dirFd);}finally{fs.closeSync(dirFd);}
        }finally{if(fs.existsSync(tmp))fs.unlinkSync(tmp);}
      }
      return outcome?.result;
    }finally{
      fs.closeSync(fd);
      fs.unlinkSync(lockPath);
    }
  }
  return Object.freeze({
    // Integrity-checked read; never reports absent on a corrupted file.
    last(uid){
      if(!DEVICE.test(uid))throw new TypeError('Synthetic device ID required');
      return withLock(state=>({write:false,result:state.records[uid]?
        {...state.records[uid]}:null}));
    },
    commit({uid,epoch,sequence,keyFingerprint}){
      if(!DEVICE.test(uid)||!validInteger(epoch,1,10000)
        ||!validInteger(sequence,1,2147483647)||!/^[0-9a-f]{64}$/.test(keyFingerprint))
        throw new TypeError('Invalid offline ledger commit');
      return withLock(state=>{
        const previous=state.records[uid];
        if(previous&&(previous.epoch!==epoch||previous.keyFingerprint!==keyFingerprint))
          return {write:false,result:{accepted:false,reason:'identity-epoch-mismatch'}};
        if(previous&&sequence<=previous.sequence)
          return {write:false,result:{accepted:false,reason:'replay-or-out-of-order'}};
        state.records[uid]={epoch,sequence,keyFingerprint};
        return {write:true,result:{accepted:true,sequence}};
      });
    }
  });
}
export function createStage7OfflineContract({ledger,clock}={}){
  if(!ledger||typeof ledger.commit!=='function'||typeof clock!=='function')
    throw new TypeError('Offline ledger and injected clock required');
  const identities=new Map();
  const proofSet=new WeakSet();
  return Object.freeze({
    provision(uid,{publicKey,epoch=1,enabled=true,scope='prototype-ingest-v1'}={}){
      if(!DEVICE.test(uid)||!(publicKey instanceof KeyObject)
        ||publicKey.type!=='public'||publicKey.asymmetricKeyType!=='ed25519'
        ||!validInteger(epoch,1,10000))
        throw new TypeError('Synthetic Ed25519 identity required');
      identities.set(uid,{publicKey,epoch,enabled:enabled===true,scope,keyFingerprint:fingerprint(publicKey)});
    },
    revoke(uid){
      if(!DEVICE.test(uid))throw new TypeError('Synthetic device ID required');
      const old=identities.get(uid);
      if(old)identities.set(uid,{...old,enabled:false});
    },
    issueOfflineChannelProof(){
      // Opaque in-process marker: NOT proof of TLS/certificate verification.
      const proof=Object.freeze({kind:'SIMULATED_VERIFIED_CHANNEL_NOT_TLS'});
      proofSet.add(proof);return proof;
    },
    accept({envelope,signature,channelProof}={}){
      if(!proofSet.has(channelProof))return {accepted:false,reason:'transport-unverified'};
      let canonical;
      try{canonical=canonicalOfflineEnvelope(envelope);}
      catch{return {accepted:false,reason:'invalid-envelope'};}
      const identity=identities.get(envelope.deviceId);
      if(!identity?.enabled||identity.scope!=='prototype-ingest-v1'
        ||identity.epoch!==envelope.epoch)
        return {accepted:false,reason:'unprovisioned-or-revoked'};
      const now=clock();
      if(!validInteger(now,0,9007199254740991)
        ||envelope.observedAtMs>now+2000||envelope.observedAtMs<now-30000)
        return {accepted:false,reason:'timestamp-outside-window'};
      if(typeof signature!=='string'||!/^[A-Za-z0-9_-]{86}$/.test(signature))
        return {accepted:false,reason:'invalid-signature'};
      const bytes=Buffer.from(signature,'base64url');
      if(bytes.length!==64||!verify(null,Buffer.from(canonical,'utf8'),identity.publicKey,bytes))
        return {accepted:false,reason:'invalid-signature'};
      try{
        const result=ledger.commit({
          uid:envelope.deviceId,epoch:envelope.epoch,sequence:envelope.frame.sequence,
          keyFingerprint:identity.keyFingerprint
        });
        if(!result.accepted)return result;
        return {accepted:true,kind:'OFFLINE_LEDGER_COMMIT_ONLY',sequence:result.sequence};
      }catch{
        // No remote read/write and no logs of frames, credentials or file paths.
        return {accepted:false,reason:'ledger-unavailable'};
      }
    }
  });
}
