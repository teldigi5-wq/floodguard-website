// FloodGuard LOCAL revocation high-water witness lab ONLY. This independent
// HMAC-sealed file detects a restored/stale RTDB session checkpoint IF this
// file and its key were not also rolled back. It CANNOT constrain direct RTDB
// clients or detect a coordinated rollback of both records.
import {
  lstatSync,readFileSync,openSync,writeFileSync,fsyncSync,closeSync,
  renameSync,unlinkSync,constants
} from 'node:fs';
import {join,resolve} from 'node:path';
import {createHmac,randomUUID,timingSafeEqual} from 'node:crypto';

const SCHEMA='floodguard-offline-revocation-witness-v1';
const ROLE=/^ingest-(?:verifier|authority|observer)-stage-[a-z0-9-]{1,32}$/;
const integer=v=>Number.isSafeInteger(v)&&v>=0;
const exact=(object,keys)=>object&&typeof object==='object'&&!Array.isArray(object)&&
  Object.keys(object).length===keys.length&&keys.every(x=>Object.hasOwn(object,x));
const canonical=v=>JSON.stringify({
  schema:SCHEMA,uid:v.uid,roleGeneration:v.roleGeneration,revokeTime:v.revokeTime
});
const valid=v=>exact(v,['schema','uid','roleGeneration','revokeTime'])&&
  v.schema===SCHEMA&&ROLE.test(v.uid)&&integer(v.roleGeneration)&&
  v.roleGeneration>=1&&integer(v.revokeTime);
const assertFields=({uid,roleGeneration,revokeTime})=>{
  const data={schema:SCHEMA,uid,roleGeneration,revokeTime};
  if(!valid(data))throw TypeError('Invalid witness identity or monotonic bounds');
  return data;
};

export function createOfflineRevocationWitness({directory,integrityKey}={}){
  if(typeof directory!=='string'||!directory.startsWith('/')||
     !Buffer.isBuffer(integrityKey)||integrityKey.length<32)
    throw TypeError('Dedicated absolute directory and independent >=32-byte HMAC key required');
  const folder=resolve(directory);
  const dirInfo=lstatSync(folder);
  if(!dirInfo.isDirectory()||(dirInfo.mode&0o077)!==0)
    throw Error('Witness directory must be a private real directory (0700)');
  const file=join(folder,'floodguard-revocation-witness-lab.json');
  // Only one coordinating process may own this directory. Atomic rename
  // protects crash consistency but is NOT a cross-process distributed CAS.
  const seal=data=>createHmac('sha256',integrityKey)
    .update(canonical(data),'utf8').digest('hex');
  const read=()=>{
    const info=lstatSync(file);
    if(!info.isFile()||(info.mode&0o077)!==0||
       info.size<100||info.size>2048)
      throw Error('Witness file is missing, unsafe or corrupted');
    const obj=JSON.parse(readFileSync(file,'utf8'));
    if(!exact(obj,['schema','uid','roleGeneration','revokeTime','mac'])||
       !valid({schema:obj.schema,uid:obj.uid,
         roleGeneration:obj.roleGeneration,revokeTime:obj.revokeTime})||
       typeof obj.mac!=='string'||!/^[0-9a-f]{64}$/.test(obj.mac))
      throw Error('Witness schema invalid');
    const expected=Buffer.from(seal(obj),'hex');
    const supplied=Buffer.from(obj.mac,'hex');
    if(!timingSafeEqual(expected,supplied))throw Error('Witness seal mismatch');
    return Object.freeze({
      uid:obj.uid,roleGeneration:obj.roleGeneration,revokeTime:obj.revokeTime
    });
  };
  const persist=(data,{initial=false}={})=>{
    const value=JSON.stringify({...data,mac:seal(data)})+'\n';
    let fd=null;
    const tmp=join(folder,'.revocation-witness-'+randomUUID()+'.tmp');
    try{
      if(initial){
        // Prevent silent overwrite/re-enrollment after checkpoint loss.
        try{lstatSync(file);throw Error('Witness already commissioned');}
        catch(e){if(e.code!=='ENOENT')throw e;}
      }
      fd=openSync(tmp,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL,0o600);
      writeFileSync(fd,value,'utf8');fsyncSync(fd);closeSync(fd);fd=null;
      renameSync(tmp,file);
      const d=openSync(folder,constants.O_RDONLY);
      try{fsyncSync(d);}finally{closeSync(d);}
    }finally{
      if(fd!==null)closeSync(fd);
      try{unlinkSync(tmp);}catch(e){if(e.code!=='ENOENT')throw e;}
    }
  };
  return Object.freeze({
    bootstrap({uid,roleGeneration,revokeTime}={}){
      if(process.env.FG_REVOCATION_SAGA_TEST!=='1')
        throw Error('Local witness gate required');
      const data=assertFields({uid,roleGeneration,revokeTime});
      persist(data,{initial:true});
      return read();
    },
    snapshot(uid){
      if(process.env.FG_REVOCATION_SAGA_TEST!=='1'||!ROLE.test(uid))
        throw Error('Local witness gate or identity invalid');
      const record=read();
      if(record.uid!==uid)throw Error('Witness bound to another identity');
      return record;
    },
    advance(uid,{expectedGeneration,expectedRevokeTime,nextGeneration,
      nextRevokeTime}={}){
      if(process.env.FG_REVOCATION_SAGA_TEST!=='1'||!ROLE.test(uid))
        throw Error('Local witness gate or identity invalid');
      const before=this.snapshot(uid);
      if(before.roleGeneration!==expectedGeneration||
         before.revokeTime!==expectedRevokeTime||
         !integer(nextGeneration)||nextGeneration!==expectedGeneration+1||
         !integer(nextRevokeTime)||nextRevokeTime<before.revokeTime)
        return false;
      const data=assertFields({uid,roleGeneration:nextGeneration,
        revokeTime:nextRevokeTime});
      persist(data);
      const after=read();
      return after.roleGeneration===nextGeneration&&
        after.revokeTime===nextRevokeTime;
    }
  });
}
