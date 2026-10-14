// Stage 9 — OFFLINE-ONLY downstream outbox and test database.
// No network client, Firebase Admin SDK, WhatsApp, device command or alert sender.
// Stores only signed Stage 8 receipt metadata in a caller-created TEST directory.
import * as fs from 'node:fs';
import * as path from 'node:path';
import {createHmac,randomBytes,timingSafeEqual} from 'node:crypto';
import {verifyStage8OfflineReceipt} from './stage8-ack-reconciliation.mjs';

const DEVICE=/^device-stage-[a-z0-9-]{1,32}$/;
const HASH=/^[a-f0-9]{64}$/;
const STATUSES=new Set(['ACCEPTED_ONLY','DATABASE_CONFIRMED']);
const exact=(value,keys)=>value!==null&&typeof value==='object'&&!Array.isArray(value)
  && Object.getPrototypeOf(value)===Object.prototype
  && Object.keys(value).length===keys.length&&keys.every(k=>Object.hasOwn(value,k));
const sequence=value=>Number.isSafeInteger(value)&&value>=1&&value<=2147483647;
function recordValid(value){
  return exact(value,['deviceId','epoch','sequence','digest','acceptedAtMs','status'])
    &&DEVICE.test(value.deviceId)&&sequence(value.sequence)
    &&sequence(value.epoch)&&value.epoch<=10000
    &&HASH.test(value.digest)&&Number.isSafeInteger(value.acceptedAtMs)
    &&value.acceptedAtMs>=0&&STATUSES.has(value.status);
}
function createStore({directory,integrityKey,kind}){
  if(typeof directory!=='string'||!path.isAbsolute(directory))throw new TypeError('An absolute test directory is required');
  if(!Buffer.isBuffer(integrityKey)||integrityKey.length<32)throw new TypeError('Test integrity key required');
  const dir=fs.lstatSync(directory);
  if(!dir.isDirectory()||dir.isSymbolicLink())throw new Error('Unsafe synthetic directory');
  const file=path.join(directory,'stage9-'+kind+'.json');
  const lock=path.join(directory,'stage9-'+kind+'.lock');
  const schema='stage9-offline-'+kind+'-v1';
  function validState(s){
    if(!exact(s,['schema','entries'])||s.schema!==schema
      ||s.entries===null||typeof s.entries!=='object'||Array.isArray(s.entries)
      ||Object.keys(s.entries).length>32
      ||Object.entries(s.entries).some(([key,value])=>!DEVICE.test(key)||!recordValid(value)||value.deviceId!==key))
      throw new Error('Malformed synthetic '+kind+' ledger');
  }
  const mac=value=>createHmac('sha256',integrityKey).update(JSON.stringify(value)).digest('hex');
  function load(){
    if(!fs.existsSync(file))return {schema,entries:{}};
    const stat=fs.lstatSync(file);
    if(!stat.isFile()||stat.isSymbolicLink()||stat.size>65536)throw new Error('Unsafe synthetic ledger file');
    const payload=JSON.parse(fs.readFileSync(file,'utf8'));
    if(!exact(payload,['state','mac'])||typeof payload.mac!=='string'||!HASH.test(payload.mac))
      throw new Error('Invalid synthetic seal');
    if(!timingSafeEqual(Buffer.from(mac(payload.state),'hex'),Buffer.from(payload.mac,'hex')))
      throw new Error('Synthetic ledger integrity mismatch');
    validState(payload.state);return payload.state;
  }
  function transaction(fn){
    const fd=fs.openSync(lock,'wx',0o600); // Abandoned lock fails closed; never auto-clear.
    try{
      const state=load(),out=fn(state);
      if(out.write){
        validState(state);
        const content=JSON.stringify({state,mac:mac(state)});
        if(Buffer.byteLength(content,'utf8')>65536)throw new Error('Synthetic ledger full');
        const temp=path.join(directory,'stage9-'+randomBytes(12).toString('hex')+'.tmp');
        try{
          const output=fs.openSync(temp,'wx',0o600);
          try{fs.writeFileSync(output,content);fs.fsyncSync(output);}finally{fs.closeSync(output);}
          fs.renameSync(temp,file);
          const d=fs.openSync(directory,'r');
          try{fs.fsyncSync(d);}finally{fs.closeSync(d);}
        }finally{if(fs.existsSync(temp))fs.unlinkSync(temp);}
      }
      return out.value;
    }finally{fs.closeSync(fd);fs.unlinkSync(lock);}
  }
  return Object.freeze({transaction});
}
const same=(a,b)=>a.deviceId===b.deviceId&&a.epoch===b.epoch
  &&a.sequence===b.sequence&&a.digest===b.digest;
function publicResult(value){return value?{...value}:null;}
export function createStage9OfflineOutbox({directory,integrityKey,stage8Ledger,stage8PublicKey}={}){
  if(!stage8Ledger||typeof stage8Ledger.lookup!=='function'||!stage8PublicKey)
    throw new TypeError('A verified synthetic Stage 8 source is required');
  const store=createStore({directory,integrityKey,kind:'outbox'});
  return Object.freeze({
    enqueue({receipt,signature,keyFingerprint}={}){
      if(!receipt||typeof keyFingerprint!=='string'||!HASH.test(keyFingerprint)
        ||!verifyStage8OfflineReceipt({receipt,signature,publicKey:stage8PublicKey}))
        return {status:'unverified-source'};
      let source;
      try{source=stage8Ledger.lookup({...receipt,keyFingerprint});}
      catch{return {status:'source-unavailable'};}
      if(!source||source.signature!==signature)return {status:'source-not-committed'};
      const value={deviceId:receipt.deviceId,epoch:receipt.epoch,
        sequence:receipt.sequence,digest:receipt.digest,
        acceptedAtMs:receipt.acceptedAtMs,status:'ACCEPTED_ONLY'};
      return store.transaction(state=>{
        const existing=state.entries[value.deviceId];
        if(existing){
          if(existing.epoch!==value.epoch)return {write:false,value:{status:'epoch-conflict'}};
          if(existing.sequence>value.sequence)return {write:false,value:{status:'stale-sequence'}};
          if(existing.sequence===value.sequence)return {write:false,
            value:{status:same(existing,value)?'already-enqueued':'digest-conflict'}};
          if(existing.status!=='DATABASE_CONFIRMED')
            return {write:false,value:{status:'prior-delivery-unresolved'}};
        }
        state.entries[value.deviceId]=value;
        return {write:true,value:{status:'enqueued'}};
      });
    },
    pending(deviceId){
      if(!DEVICE.test(deviceId))throw new TypeError('Synthetic device ID only');
      return store.transaction(state=>({write:false,value:publicResult(state.entries[deviceId])}));
    },
    confirmDatabase(record){
      if(!recordValid(record))throw new TypeError('Valid synthetic record required');
      return store.transaction(state=>{
        const stored=state.entries[record.deviceId];
        if(!stored||!same(stored,record))return {write:false,value:{status:'outbox-mismatch'}};
        if(stored.status==='DATABASE_CONFIRMED')return {write:false,value:{status:'already-confirmed'}};
        stored.status='DATABASE_CONFIRMED';
        return {write:true,value:{status:'database-confirmed'}};
      });
    },
    deliverOne({deviceId,sink,failPoint}={}){
      if(!sink||typeof sink.put!=='function')throw new TypeError('Synthetic sink required');
      const current=this.pending(deviceId);
      if(!current)return {status:'nothing-to-deliver'};
      if(current.status==='DATABASE_CONFIRMED')return {status:'already-confirmed'};
      if(failPoint==='before-sink')return {status:'simulated-before-database'};
      let downstream;
      try{downstream=sink.put(current);}
      catch{return {status:'downstream-unavailable'};}
      if(downstream.status!=='persisted'&&downstream.status!=='already-persisted')
        return {status:'downstream-'+downstream.status};
      if(failPoint==='after-sink-before-confirm')return {status:'database-outcome-unknown'};
      try{return this.confirmDatabase(current);}
      catch{return {status:'outbox-unavailable'};}
    }
  });
}
export function createStage9SyntheticDatabase({directory,integrityKey}={}){
  const store=createStore({directory,integrityKey,kind:'database'});
  return Object.freeze({
    put(record){
      if(!recordValid(record))return {status:'invalid-record'};
      return store.transaction(state=>{
        const existing=state.entries[record.deviceId];
        if(existing){
          if(existing.epoch!==record.epoch)return {write:false,value:{status:'epoch-conflict'}};
          if(existing.sequence>record.sequence)return {write:false,value:{status:'stale-sequence'}};
          if(existing.sequence===record.sequence)return {write:false,value:{
            status:same(existing,record)?'already-persisted':'digest-conflict'}};
        }
        state.entries[record.deviceId]={...record,status:'DATABASE_CONFIRMED'};
        return {write:true,value:{status:'persisted'}};
      });
    },
    get(deviceId){
      if(!DEVICE.test(deviceId))throw new TypeError('Synthetic device ID only');
      return store.transaction(state=>({write:false,value:publicResult(state.entries[deviceId])}));
    }
  });
}
