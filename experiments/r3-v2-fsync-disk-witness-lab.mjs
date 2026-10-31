// FloodGuard R3-D2b *local disk witness* rehearsal. NOT an independently
// rollback-resistant authority. A privileged actor can restore an older,
// fully valid journal or compromise the same-host signing capability.
// Never wire this module to production Firebase, real alerts or gate controls.
// FSYNC append-only log, exclusive local-process file lock, separate
// independently signed water/rain checkpoints. The signer is INJECTED:
// private keys and authentication must be isolated by a real trusted service.
import * as fs from 'node:fs';
import * as path from 'node:path';
import {createHash,KeyObject,verify} from 'node:crypto';
import {
  canonicalR3V2WitnessCheckpoint,reviewR3V2WitnessSignedState
} from './r3-v2-independent-witness-reconciliation-lab.mjs';

const STREAMS=['water','rain'];
const LOG='r3-v2-witness-journal.log';
const LOCK='r3-v2-witness-journal.lock';
const ZEROS='0'.repeat(64);
const MAX_LOG=512*1024;
const MAX_ENTRIES=4096;
const HEX=/^[a-f0-9]{64}$/;
const SIG=/^[A-Za-z0-9_-]{86}$/;
const obj=v=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&
  (Object.getPrototypeOf(v)===Object.prototype||
   Object.getPrototypeOf(v)===null);
const exact=(v,fields)=>obj(v)&&Object.keys(v).length===fields.length&&
  fields.every(f=>Object.hasOwn(v,f));
const sha=x=>createHash('sha256').update(x,'utf8').digest('hex');
const pin=x=>x instanceof KeyObject&&x.type==='public'&&
  x.asymmetricKeyType==='ed25519';
const fingerprint=k=>sha(k.export({format:'der',type:'spki'}).toString('base64'));
const clone=x=>JSON.parse(JSON.stringify(x));
const committedEntryFields=['index','operation','stream','signed','previousDigest','digest'];
const bodyFields=['index','operation','stream','signed','previousDigest'];
const signedFields=['checkpoint','signature'];

function verifySignature(stream,signed,trusted){
  const result=reviewR3V2WitnessSignedState({
    stream,signed,trustedWitnessKey:trusted.publicKey
  });
  return result.valid&&result.epoch===trusted.epoch;
}
function makeEntry(index,operation,stream,signed,previousDigest){
  const payload={index,operation,stream,signed,previousDigest};
  return {...payload,digest:sha(JSON.stringify(payload))};
}
function validateJournal(raw,keys){
  if(raw.length===0||raw.length>MAX_LOG||!raw.endsWith('\n'))
    throw Error('Witness journal missing, oversized or torn');
  const lines=raw.slice(0,-1).split('\n');
  if(lines.length<2||lines.length>MAX_ENTRIES)
    throw Error('Witness journal entry count invalid');
  const latest={};
  let previous=ZEROS;
  for(let index=0;index<lines.length;index++){
    let entry;
    try{entry=JSON.parse(lines[index]);}
    catch{throw Error('Witness journal has malformed entry');}
    const operation=index<2?'genesis':'advance';
    const stream=index===0?'water':index===1?'rain':entry?.stream;
    if(!exact(entry,committedEntryFields)||
       !Number.isSafeInteger(entry.index)||entry.index!==index+1||
       entry.operation!==operation||!STREAMS.includes(entry.stream)||
       entry.stream!==stream||
       !exact(entry.signed,signedFields)||
       typeof entry.signed.signature!=='string'||
       !SIG.test(entry.signed.signature)||
       !HEX.test(entry.previousDigest)||entry.previousDigest!==previous||
       !HEX.test(entry.digest))
      throw Error('Witness journal schema, order or chain invalid');
    const {digest,...body}=entry;
    if(!exact(body,bodyFields)||sha(JSON.stringify(body))!==digest)
      throw Error('Witness journal hash-chain mismatch');
    if(!verifySignature(stream,entry.signed,keys[stream]))
      throw Error('Witness journal signature or enrolled epoch invalid');
    const cp=entry.signed.checkpoint;
    if(index>=2){
      const last=latest[stream]?.checkpoint;
      if(!last||last.sourceAlias!==cp.sourceAlias||last.epoch!==cp.epoch||
         cp.sequence!==last.sequence+1||
         cp.envelopeDigest===last.envelopeDigest)
        throw Error('Witness journal history is not monotonic');
    }
    latest[stream]=entry.signed;
    previous=digest;
  }
  return {latest,tailDigest:previous,count:lines.length};
}

export function createR3V2DiskWitnessLab({
  directory,enrollment,signCheckpoint,onFault=()=>{}
}={}){
  if(process.env.FG_R3_DISK_WITNESS_LAB_TEST!=='1')
    throw Error('Disk witness is disabled outside isolated laboratory');
  if(typeof directory!=='string'||!path.isAbsolute(directory))
    throw TypeError('Absolute private test directory required');
  const root=fs.lstatSync(directory);
  if(!root.isDirectory()||root.isSymbolicLink()||
     (root.mode&0o077)!==0)
    throw Error('Witness directory must be a private real directory');
  if(!exact(enrollment,STREAMS)||
     typeof signCheckpoint!=='function'||typeof onFault!=='function')
    throw TypeError('Independent signer and pinned witness enrollment required');
  const trust={},identities=[];
  for(const s of STREAMS){
    const x=enrollment[s];
    if(!exact(x,['epoch','publicKey'])||
       !Number.isSafeInteger(x.epoch)||x.epoch<1||x.epoch>10000||
       !pin(x.publicKey))
      throw TypeError('Invalid operator-enrolled witness identity');
    trust[s]={epoch:x.epoch,publicKey:x.publicKey};
    identities.push(fingerprint(x.publicKey));
  }
  if(identities[0]===identities[1])
    throw TypeError('Witness identities must remain separate per stream');
  const journal=path.join(directory,LOG),lock=path.join(directory,LOCK);
  let closed=false;
  function acquire(fn){
    if(closed)throw Error('Disk witness closed');
    // Crash-left lock is never silently reclaimed by a subsequent process.
    // This is single-host coordination, NOT a distributed lease/fence.
    const fd=fs.openSync(lock,'wx',0o600);
    try{return fn();}
    finally{fs.closeSync(fd);fs.unlinkSync(lock);}
  }
  function validatedFile(){
    const fd=fs.openSync(journal,fs.constants.O_RDONLY|
      (fs.constants.O_NOFOLLOW||0));
    try{
      const stat=fs.fstatSync(fd);
      if(!stat.isFile()||stat.nlink!==1||(stat.mode&0o077)!==0||
         stat.size===0||stat.size>MAX_LOG)
        throw Error('Unsafe or missing witness journal file');
      return validateJournal(fs.readFileSync(fd,'utf8'),trust);
    }finally{fs.closeSync(fd);}
  }
  function signOwn(stream,checkpoint){
    const canonical=canonicalR3V2WitnessCheckpoint(checkpoint);
    if(checkpoint.stream!==stream||
       checkpoint.epoch!==trust[stream].epoch)
      throw Error('Untrusted witness checkpoint');
    const response=signCheckpoint(stream,canonical);
    if(typeof response!=='string'||!SIG.test(response)||
       Buffer.from(response,'base64url').length!==64||
       !verify(null,Buffer.from(canonical,'utf8'),
         trust[stream].publicKey,Buffer.from(response,'base64url')))
      throw Error('Independent witness signature not verified');
    return {checkpoint:clone(checkpoint),signature:response};
  }
  function append(entries,{initial=false}={}){
    const bytes=entries.map(e=>JSON.stringify(e)+'\n').join('');
    const wasExisting=fs.existsSync(journal);
    if(initial){
      // Never bootstrap over an existing file, even corrupt/empty.
      const prior=fs.lstatSync(journal,{throwIfNoEntry:false});
      if(prior)throw Error('Witness journal already initialized');
    }else if(!wasExisting)
      throw Error('Witness journal missing; no auto-bootstrap');
    let fd;
    try{
      fd=initial
        ?fs.openSync(journal,fs.constants.O_WRONLY|fs.constants.O_CREAT|
          fs.constants.O_EXCL|(fs.constants.O_NOFOLLOW||0),0o600)
        :fs.openSync(journal,fs.constants.O_WRONLY|fs.constants.O_APPEND|
          (fs.constants.O_NOFOLLOW||0));
      const stat=fs.fstatSync(fd);
      if(!stat.isFile()||stat.nlink!==1||(stat.mode&0o077)!==0||
         stat.size+Buffer.byteLength(bytes)>MAX_LOG)
        throw Error('Unsafe or oversized witness append');
      onFault('before-write');
      const data=Buffer.from(bytes,'utf8');
      let offset=0;
      while(offset<data.length){
        const wrote=fs.writeSync(fd,data,offset,data.length-offset);
        if(wrote<=0)throw Error('Failed witness append');
        offset+=wrote;
      }
      fs.fsyncSync(fd);
      if(initial){
        const dir=fs.openSync(directory,'r');
        try{fs.fsyncSync(dir);}finally{fs.closeSync(dir);}
      }
      // An exception here is an UNKNOWN COMMIT OUTCOME, not a rollback.
      onFault('after-fsync');
    }finally{if(fd!==undefined)fs.closeSync(fd);}
  }
  function initialize({water,rain}={}){
    return acquire(()=>{
      const supplied={water,rain};
      const entries=[];
      let previous=ZEROS;
      for(const stream of STREAMS){
        const signed=supplied[stream];
        if(!exact(signed,signedFields)||
           !verifySignature(stream,signed,trust[stream]))
          throw Error('Both independently signed genesis checkpoints required');
        const entry=makeEntry(entries.length+1,'genesis',stream,
          clone(signed),previous);
        entries.push(entry);previous=entry.digest;
      }
      append(entries,{initial:true});
      return Object.freeze({initialized:true,entries:2,
        durableLocalFsyncAttempted:true,rollbackResistant:false});
    });
  }
  function readSigned(stream){
    if(!STREAMS.includes(stream))throw TypeError('Unknown witness stream');
    return acquire(()=>clone(validatedFile().latest[stream]));
  }
  function compareAndSwap(request={}){
    return acquire(()=>{
      if(!exact(request,['stream','expectedCheckpoint','nextCheckpoint']))
        throw TypeError('Exact CAS request required');
      const {stream,expectedCheckpoint,nextCheckpoint}=request;
      if(!STREAMS.includes(stream))throw TypeError('Unknown witness stream');
      const state=validatedFile();
      if(state.count>=MAX_ENTRIES)throw Error('Witness log needs manual rotation');
      const current=state.latest[stream].checkpoint;
      let expectedBytes;
      try{
        expectedBytes=canonicalR3V2WitnessCheckpoint(expectedCheckpoint);
        canonicalR3V2WitnessCheckpoint(nextCheckpoint);
      }catch{throw Error('Invalid CAS checkpoint contract');}
      if(expectedBytes!==canonicalR3V2WitnessCheckpoint(current))
        throw Error('Witness CAS expected checkpoint stale');
      if(nextCheckpoint.stream!==stream||
         nextCheckpoint.sourceAlias!==current.sourceAlias||
         nextCheckpoint.epoch!==current.epoch||
         nextCheckpoint.sequence!==current.sequence+1||
         nextCheckpoint.envelopeDigest===current.envelopeDigest)
        throw Error('Witness CAS violates one-step monotonic history');
      const signed=signOwn(stream,nextCheckpoint);
      append([makeEntry(state.count+1,'advance',stream,signed,
        state.tailDigest)]);
      return clone(signed);
    });
  }
  return Object.freeze({
    initialize,readSigned,compareAndSwap,
    close(){closed=true;}
  });
}
