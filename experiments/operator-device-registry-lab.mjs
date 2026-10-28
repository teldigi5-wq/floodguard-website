// OPERATOR-ONLY synthetic device identity lifecycle experiment.
// No network endpoints, Firebase, env-key loading, real-device credentials,
// automatic enrollment or production provisioning. Public keys only.
import * as fs from 'node:fs';
import * as path from 'node:path';
import {createHash,createHmac,createPublicKey,randomBytes,timingSafeEqual,KeyObject} from 'node:crypto';

const SCHEMA='floodguard-operator-device-registry-lab-v1';
const FILE='operator-device-registry-lab.json';
const LOCK='operator-device-registry-lab.lock';
const ID=/^device-stage-[a-z0-9-]{1,32}$/;
const HEX=/^[0-9a-f]{64}$/;
const MAX_BYTES=32768;
const MAX_DEVICES=16;
const SCOPE='prototype-ingest-v1';
const exact=(x,k)=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&
  (Object.getPrototypeOf(x)===Object.prototype||Object.getPrototypeOf(x)===null)&&
  Object.keys(x).length===k.length&&k.every(key=>Object.hasOwn(x,key));
const pub=x=>x instanceof KeyObject&&x.type==='public'&&x.asymmetricKeyType==='ed25519';
const fingerprint=k=>createHash('sha256').update(
  k.export({format:'der',type:'spki'})
).digest('hex');
function keyRecord(key){
  if(!pub(key))throw TypeError('Synthetic Ed25519 public key required');
  const bytes=key.export({format:'der',type:'spki'});
  return {spki:bytes.toString('base64'),fingerprint:fingerprint(key)};
}
function parseKey(entry){
  if(typeof entry.spki!=='string'||entry.spki.length>128||
     !/^[A-Za-z0-9+/]+={0,2}$/.test(entry.spki))throw Error('Malformed public key');
  const bytes=Buffer.from(entry.spki,'base64');
  const key=createPublicKey({key:bytes,type:'spki',format:'der'});
  if(!pub(key)||key.export({format:'der',type:'spki'}).compare(bytes)!==0||
     fingerprint(key)!==entry.fingerprint)throw Error('Public key fingerprint mismatch');
  return key;
}
function validate(state){
  if(!exact(state,['schema','revision','devices'])||state.schema!==SCHEMA||
     !Number.isSafeInteger(state.revision)||state.revision<1||
     !exactDevices(state.devices))throw Error('Invalid synthetic operator registry');
  const seen=new Set();
  for(const [id,entry] of Object.entries(state.devices)){
    if(!ID.test(id)||
       !exact(entry,['enabled','scope','epoch','spki','fingerprint'])||
       typeof entry.enabled!=='boolean'||entry.scope!==SCOPE||
       !Number.isSafeInteger(entry.epoch)||entry.epoch<1||entry.epoch>10000||
       typeof entry.fingerprint!=='string'||!HEX.test(entry.fingerprint)||
       seen.has(entry.fingerprint))throw Error('Invalid device identity record');
    parseKey(entry);
    seen.add(entry.fingerprint);
  }
}
function exactDevices(devices){
  return devices!==null&&typeof devices==='object'&&!Array.isArray(devices)&&
    (Object.getPrototypeOf(devices)===Object.prototype||
     Object.getPrototypeOf(devices)===null)&&
    Object.keys(devices).length<=MAX_DEVICES;
}
export function createOperatorDeviceRegistryLab({directory,integrityKey}={}){
  if(typeof directory!=='string'||!path.isAbsolute(directory)||
     !Buffer.isBuffer(integrityKey)||integrityKey.length<32)
    throw TypeError('Explicit test-only absolute directory and integrity key required');
  const dir=fs.lstatSync(directory);
  if(!dir.isDirectory()||dir.isSymbolicLink())throw Error('Unsafe operator registry directory');
  const file=path.join(directory,FILE),lock=path.join(directory,LOCK);
  const mac=state=>createHmac('sha256',integrityKey)
    .update(JSON.stringify(state)).digest('hex');
  const read=()=>{
    // Missing history, a symlink, altered MAC or an unknown field is NOT
    // equivalent to an empty registry. Never auto-enroll after data loss.
    const st=fs.lstatSync(file);
    if(!st.isFile()||st.isSymbolicLink()||st.size>MAX_BYTES)
      throw Error('Operator registry unavailable');
    const record=JSON.parse(fs.readFileSync(file,'utf8'));
    if(!exact(record,['state','mac'])||typeof record.mac!=='string'||
       !HEX.test(record.mac))throw Error('Invalid operator registry seal');
    const expected=Buffer.from(mac(record.state),'hex');
    if(!timingSafeEqual(expected,Buffer.from(record.mac,'hex')))
      throw Error('Operator registry integrity failure');
    validate(record.state);
    return record.state;
  };
  const write=state=>{
    validate(state);
    const payload=JSON.stringify({state,mac:mac(state)});
    if(Buffer.byteLength(payload)>MAX_BYTES)throw Error('Operator registry full');
    const tmp=path.join(directory,'operator-'+randomBytes(12).toString('hex')+'.tmp');
    try{
      const fd=fs.openSync(tmp,'wx',0o600);
      try{fs.writeFileSync(fd,payload);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
      fs.renameSync(tmp,file);
      const df=fs.openSync(directory,'r');
      try{fs.fsyncSync(df);}finally{fs.closeSync(df);}
    }finally{if(fs.existsSync(tmp))fs.unlinkSync(tmp);}
  };
  const locked=action=>{
    const fd=fs.openSync(lock,'wx',0o600);
    try{return action();}finally{fs.closeSync(fd);fs.unlinkSync(lock);}
  };
  const change=fn=>locked(()=>{
    const state=read();
    const value=fn(state);
    state.revision++;
    write(state);
    return value;
  });
  const uniqueKey=(state,id,key)=>Object.entries(state.devices).every(
    ([other,entry])=>other===id||entry.fingerprint!==key.fingerprint
  );
  return Object.freeze({
    commission(){
      // Intentionally one-time operator-only setup; no HTTP path calls this.
      return locked(()=>{
        if(fs.existsSync(file))throw Error('Operator registry already commissioned');
        write({schema:SCHEMA,revision:1,devices:{}});
        return Object.freeze({commissioned:true,revision:1});
      });
    },
    enroll(deviceId,publicKey){
      if(!ID.test(deviceId))throw TypeError('Synthetic device ID required');
      const key=keyRecord(publicKey);
      return change(state=>{
        if(Object.hasOwn(state.devices,deviceId)||!uniqueKey(state,deviceId,key))
          throw Error('Device identity already allocated');
        if(Object.keys(state.devices).length>=MAX_DEVICES)
          throw Error('Operator registry capacity exceeded');
        state.devices[deviceId]={enabled:true,scope:SCOPE,epoch:1,...key};
        return Object.freeze({enrolled:true,deviceId,epoch:1});
      });
    },
    revoke(deviceId){
      if(!ID.test(deviceId))throw TypeError('Synthetic device ID required');
      return change(state=>{
        const binding=state.devices[deviceId];
        if(!binding||!binding.enabled)throw Error('No enabled identity to revoke');
        binding.enabled=false;
        return Object.freeze({revoked:true,deviceId,epoch:binding.epoch});
      });
    },
    stageRotation(deviceId,newPublicKey){
      if(!ID.test(deviceId))throw TypeError('Synthetic device ID required');
      const key=keyRecord(newPublicKey);
      return change(state=>{
        const binding=state.devices[deviceId];
        if(!binding||binding.enabled||binding.epoch>=10000||
           binding.fingerprint===key.fingerprint||
           !uniqueKey(state,deviceId,key))
          throw Error('Rotation requires revoked identity and distinct approved key');
        binding.epoch++;
        binding.spki=key.spki;binding.fingerprint=key.fingerprint;
        // Remains disabled until separate operator activation. The old
        // Stage 7 replay ledger cannot automatically migrate epochs.
        return Object.freeze({staged:true,deviceId,epoch:binding.epoch,enabled:false});
      });
    },
    activateStaged(deviceId,expectedEpoch){
      if(!ID.test(deviceId)||!Number.isSafeInteger(expectedEpoch))
        throw TypeError('Explicit device and epoch required');
      return change(state=>{
        const b=state.devices[deviceId];
        if(!b||b.enabled||b.epoch<=1||b.epoch!==expectedEpoch)
          throw Error('Staged identity or approval epoch mismatch');
        b.enabled=true;
        return Object.freeze({activated:true,deviceId,epoch:b.epoch});
      });
    },
    get(deviceId){
      if(!ID.test(deviceId))return undefined;
      return locked(()=>{
        const state=read();
        const b=state.devices[deviceId];
        if(!b)return undefined;
        return Object.freeze({enabled:b.enabled,scope:b.scope,epoch:b.epoch,
          publicKey:parseKey(b)});
      });
    },
    status(){
      return locked(()=>{
        const state=read();
        return Object.freeze({revision:state.revision,devices:Object.freeze(
          Object.entries(state.devices).map(([id,b])=>Object.freeze({
            deviceId:id,epoch:b.epoch,enabled:b.enabled
          }))
        )});
      });
    }
  });
}
