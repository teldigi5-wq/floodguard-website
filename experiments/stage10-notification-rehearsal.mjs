// Stage 10: purely synthetic notification orchestration / failure injection.
// This is not a WhatsApp bot, SMS sender, network server, Firebase adapter or
// alert controller. Only ephemeral TEST-directory records and mock providers.
import * as fs from 'node:fs';
import * as path from 'node:path';
import {createHmac,randomBytes,timingSafeEqual} from 'node:crypto';

const DEVICE=/^device-stage-[a-z0-9-]{1,32}$/;
const HASH=/^[a-f0-9]{64}$/;
const QUEUED='QUEUED_SYNTHETIC_ONLY';
const CONFIRMED='SIMULATED_PROVIDER_ACK_ONLY';
const allowedStatus=new Set([QUEUED,CONFIRMED]);
const mockProviders=new WeakSet();
const own=(x,keys)=>x!==null&&typeof x==='object'&&!Array.isArray(x)
  &&Object.getPrototypeOf(x)===Object.prototype&&Object.keys(x).length===keys.length
  &&keys.every(k=>Object.hasOwn(x,k));
const int=(n,a,b)=>Number.isSafeInteger(n)&&n>=a&&n<=b;
const identity=r=>r&&DEVICE.test(r.deviceId)&&int(r.epoch,1,10000)
  &&int(r.sequence,1,2147483647)&&typeof r.digest==='string'&&HASH.test(r.digest);
const equal=(a,b)=>a.deviceId===b.deviceId&&a.epoch===b.epoch
  &&a.sequence===b.sequence&&a.digest===b.digest;
const record=r=>own(r,['deviceId','epoch','sequence','digest','status'])
  &&identity(r)&&allowedStatus.has(r.status);
const event=e=>own(e,['deviceId','sequence','type','atMs'])
  &&DEVICE.test(e.deviceId)&&int(e.sequence,1,2147483647)
  &&['QUEUED','MOCK_ACK_RECORDED'].includes(e.type)
  &&int(e.atMs,0,Number.MAX_SAFE_INTEGER);
function safeStore({directory,integrityKey,kind}){
  if(typeof directory!=='string'||!path.isAbsolute(directory))throw new TypeError('Absolute TEST directory required');
  if(!Buffer.isBuffer(integrityKey)||integrityKey.length<32)throw new TypeError('Fresh TEST integrity key required');
  const dir=fs.lstatSync(directory);
  if(!dir.isDirectory()||dir.isSymbolicLink())throw new Error('Unsafe synthetic directory');
  const filename=path.join(directory,'stage10-'+kind+'.json');
  const lock=path.join(directory,'stage10-'+kind+'.lock');
  const schema='stage10-synthetic-'+kind+'-v1';
  const mac=state=>createHmac('sha256',integrityKey).update(JSON.stringify(state)).digest('hex');
  const empty=()=>({schema,entries:{},events:[]});
  function validate(state){
    if(!own(state,['schema','entries','events'])||state.schema!==schema
      ||state.entries===null||typeof state.entries!=='object'||Array.isArray(state.entries)
      ||Object.keys(state.entries).length>32
      ||Object.entries(state.entries).some(([key,item])=>!DEVICE.test(key)||!record(item)||item.deviceId!==key)
      ||!Array.isArray(state.events)||state.events.length>64||state.events.some(e=>!event(e)))
      throw new Error('Invalid synthetic state');
  }
  function read(){
    if(!fs.existsSync(filename))return empty();
    const stat=fs.lstatSync(filename);
    if(!stat.isFile()||stat.isSymbolicLink()||stat.size>65536)throw new Error('Invalid synthetic state file');
    const doc=JSON.parse(fs.readFileSync(filename,'utf8'));
    if(!own(doc,['state','mac'])||typeof doc.mac!=='string'||!HASH.test(doc.mac))
      throw new Error('Invalid synthetic integrity seal');
    const expected=Buffer.from(mac(doc.state),'hex');
    if(!timingSafeEqual(expected,Buffer.from(doc.mac,'hex')))
      throw new Error('Synthetic ledger integrity failure');
    validate(doc.state);return doc.state;
  }
  function transact(fn){
    const fd=fs.openSync(lock,'wx',0o600); // crash lock is operator-reviewed, never auto-removed
    try{
      const state=read(),result=fn(state);
      if(result.write){
        validate(state);
        const bytes=JSON.stringify({state,mac:mac(state)});
        if(Buffer.byteLength(bytes,'utf8')>65536)throw new Error('Synthetic ledger full');
        const temp=path.join(directory,'stage10-'+randomBytes(12).toString('hex')+'.tmp');
        try{
          const out=fs.openSync(temp,'wx',0o600);
          try{fs.writeFileSync(out,bytes);fs.fsyncSync(out);}finally{fs.closeSync(out);}
          fs.renameSync(temp,filename);
          const folder=fs.openSync(directory,'r');
          try{fs.fsyncSync(folder);}finally{fs.closeSync(folder);}
        }finally{if(fs.existsSync(temp))fs.unlinkSync(temp);}
      }
      return result.value;
    }finally{fs.closeSync(fd);fs.unlinkSync(lock);}
  }
  function note(state,r,type,clock){
    const atMs=clock();
    if(!int(atMs,0,Number.MAX_SAFE_INTEGER))throw new Error('Invalid synthetic clock');
    state.events.push({deviceId:r.deviceId,sequence:r.sequence,type,atMs});
    if(state.events.length>64)state.events.shift(); // bounded, explicitly truncated
  }
  return Object.freeze({transact,note});
}
function checkUpstream(outbox,database,id,expected){
  try{
    const recorded=outbox.pending(id),persisted=database.get(id);
    if(!recorded||recorded.status!=='DATABASE_CONFIRMED'
      ||!persisted||persisted.status!=='DATABASE_CONFIRMED')return null;
    if(!identity(recorded)||!identity(persisted)||!equal(recorded,persisted))return null;
    const candidate={deviceId:id,epoch:recorded.epoch,
      sequence:recorded.sequence,digest:recorded.digest};
    if(expected&&!equal(candidate,expected))return null;
    return candidate;
  }catch{return null;} // fail closed on corrupt or unavailable dependencies
}
export function createStage10SyntheticProvider({directory,integrityKey,clock=()=>0}={}){
  if(typeof clock!=='function')throw new TypeError('Synthetic clock required');
  const store=safeStore({directory,integrityKey,kind:'provider'});
  const provider=Object.freeze({
    put(item){
      if(!identity(item))return {status:'invalid-synthetic-request'};
      return store.transact(state=>{
        const existing=state.entries[item.deviceId];
        if(existing){
          if(existing.epoch!==item.epoch)return {write:false,value:{status:'epoch-conflict'}};
          if(existing.sequence>item.sequence)return {write:false,value:{status:'stale-sequence'}};
          if(existing.sequence===item.sequence)return {write:false,value:{
            status:equal(existing,item)?'already-simulated':'digest-conflict'}};
        }
        state.entries[item.deviceId]={deviceId:item.deviceId,epoch:item.epoch,
          sequence:item.sequence,digest:item.digest,status:CONFIRMED};
        store.note(state,item,'MOCK_ACK_RECORDED',clock);
        return {write:true,value:{status:'simulated'}};
      });
    },
    get(id){
      if(!DEVICE.test(id))throw new TypeError('Synthetic test identity only');
      return store.transact(state=>({write:false,value:state.entries[id]?{...state.entries[id]}:null}));
    },
    audit(){
      return store.transact(state=>({write:false,value:state.events.map(e=>({...e}))}));
    }
  });
  mockProviders.add(provider);
  return provider;
}
export function createStage10SyntheticNotificationLab({directory,integrityKey,outbox,database,clock=()=>0}={}){
  if(!outbox||typeof outbox.pending!=='function'
    ||!database||typeof database.get!=='function'
    ||typeof clock!=='function')throw new TypeError('Synthetic outbox, database and clock required');
  const store=safeStore({directory,integrityKey,kind:'notifications'});
  function readNotificationEntry(id){
    if(!DEVICE.test(id))throw new TypeError('Synthetic test identity only');
    return store.transact(state=>({write:false,value:state.entries[id]?{...state.entries[id]}:null}));
  }
  return Object.freeze({
    queue(id){
      if(!DEVICE.test(id))throw new TypeError('Synthetic test identity only');
      const verified=checkUpstream(outbox,database,id);
      if(!verified)return {status:'blocked-no-database-confirmation'};
      return store.transact(state=>{
        const existing=state.entries[id];
        if(existing){
          if(existing.epoch!==verified.epoch)return {write:false,value:{status:'identity-epoch-conflict'}};
          if(existing.sequence>verified.sequence)return {write:false,value:{status:'stale-sequence'}};
          if(existing.sequence===verified.sequence)return {write:false,value:{
            status:equal(existing,verified)?'already-queued':'digest-conflict'}};
          if(existing.status!==CONFIRMED)return {write:false,value:{status:'prior-mock-notification-unresolved'}};
        }
        state.entries[id]={...verified,status:QUEUED};
        store.note(state,verified,'QUEUED',clock);
        return {write:true,value:{status:'queued-simulation-only'}};
      });
    },
    dispatch({deviceId,provider,failPoint}={}){
      if(!mockProviders.has(provider))return {status:'unapproved-mock-provider'};
      const existing=readNotificationEntry(deviceId);
      if(!existing)return {status:'not-queued'};
      if(existing.status===CONFIRMED)return {status:'already-simulated'};
      if(!checkUpstream(outbox,database,deviceId,existing))
        return {status:'blocked-no-database-confirmation'};
      if(failPoint==='before-mock-provider')return {status:'simulated-before-mock'};
      let result;
      try{result=provider.put(existing);}catch{return {status:'mock-provider-unavailable'};}
      if(result.status!=='simulated'&&result.status!=='already-simulated')
        return {status:'mock-provider-'+result.status};
      if(failPoint==='after-mock-provider-before-confirm')
        return {status:'simulated-provider-outcome-unknown'};
      try{return store.transact(state=>{
        const current=state.entries[deviceId];
        if(!current||!equal(current,existing))return {write:false,value:{status:'notification-record-conflict'}};
        if(current.status===CONFIRMED)return {write:false,value:{status:'already-simulated'}};
        current.status=CONFIRMED;
        store.note(state,current,'MOCK_ACK_RECORDED',clock);
        return {write:true,value:{status:'mock-notification-confirmed'}};
      });}catch{return {status:'notification-ledger-unavailable'};}
    },
    status(id){
      const entry=readNotificationEntry(id);
      if(!entry)return {kind:'OFFLINE_SIMULATION',database:'NOT_VERIFIED',notification:'NOT_QUEUED'};
      if(!checkUpstream(outbox,database,id,entry))
        return {kind:'OFFLINE_SIMULATION',database:'NOT_VERIFIED',notification:'NOT_VERIFIED'};
      return {kind:'OFFLINE_SIMULATION',database:'SYNTHETIC_DATABASE_CONFIRMED',
        notification:entry.status};
    },
    audit(){
      return store.transact(state=>({write:false,value:state.events.map(e=>({...e}))}));
    }
  });
}
