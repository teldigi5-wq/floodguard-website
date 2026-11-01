// FloodGuard HOST-ONLY reference for safe exclusive slot creation.
// Linux POSIX O_CREAT|O_EXCL|O_NOFOLLOW and fsync are not ESP8266 LittleFS APIs.
// No producer credentials, Firebase, network, ACK, erase, compaction or gate.
// The binary FGP1 CRC detects accidental damage, NOT signing authenticity.
import * as fs from 'node:fs';
import path from 'node:path';

const CAPACITY=8,MAX_BODY=1024,HEADER=10,TRAILER=4;
const MAX_RECORD=HEADER+MAX_BODY+TRAILER;
const goodSlot=s=>Number.isSafeInteger(s)&&s>=0&&s<CAPACITY;
const recordPath=(directory,slot)=>path.join(directory,'fgq2_'+slot+'.bin');
const result=(status,extra={})=>Object.freeze({
  status,cloudConfirmed:false,canAcknowledge:false,
  canDelete:false,warningDelivered:false,gatePositionVerified:false,...extra
});
function safeDirectory(directory){
  if(typeof directory!=='string'||!path.isAbsolute(directory))return false;
  try {
    const meta=fs.lstatSync(directory);
    // A strict private operator-owned test directory only; no symlink.
    return meta.isDirectory() && !meta.isSymbolicLink() &&
      (meta.mode&0o077)===0 &&
      (typeof process.getuid!=='function'||meta.uid===process.getuid());
  } catch {return false;}
}
function crc32(bytes){
  let c=0xffffffff;
  for(const byte of bytes){
    c^=byte;
    for(let i=0;i<8;i++)
      c=(c>>>1)^((c&1)?0xedb88320:0);
  }
  return (c^0xffffffff)>>>0;
}
function decode(bytes){
  if(!Buffer.isBuffer(bytes)||bytes.length<HEADER+TRAILER||
     bytes.length>MAX_RECORD||bytes.toString('ascii',0,4)!=='FGP1')
    return null;
  const seq=bytes.readUInt32BE(4),length=bytes.readUInt16BE(8);
  if(seq<1||seq>2147483647||length<90||length>MAX_BODY||
     bytes.length!==length+HEADER+TRAILER||
     crc32(bytes.subarray(0,10+length))!==bytes.readUInt32BE(10+length))
    return null;
  const body=bytes.subarray(10,10+length);
  if(body[0]!==123||body.at(-1)!==125||
     body.some(c=>c<0x20||c>0x7e))return null;
  return {sequence:seq,body:Buffer.from(body)};
}
export function encodeExclusiveRecordLab({sequence,signedJson}={}){
  if(!Number.isSafeInteger(sequence)||sequence<1||sequence>2147483647||
     typeof signedJson!=='string')return null;
  const body=Buffer.from(signedJson,'utf8');
  if(body.length<90||body.length>MAX_BODY||
     body[0]!==123||body.at(-1)!==125||
     body.some(c=>c<0x20||c>0x7e))return null;
  const buffer=Buffer.alloc(14+body.length);
  buffer.write('FGP1',0,'ascii');
  buffer.writeUInt32BE(sequence,4);
  buffer.writeUInt16BE(body.length,8);
  body.copy(buffer,10);
  buffer.writeUInt32BE(crc32(buffer.subarray(0,10+body.length)),10+body.length);
  return buffer;
}
// lstat on an existing slot is not enough to authorize a write; O_EXCL
// atomically refuses replacement even if another process creates the slot.
// Errors other than ENOENT must NOT be mistaken for an available slot.
function inspectSlot(directory,slot){
  const file=recordPath(directory,slot);
  let meta;
  try{meta=fs.lstatSync(file);}catch(e){
    if(e?.code==='ENOENT')return {status:'MISSING'};
    return {status:'UNCERTAIN'};
  }
  if(!meta.isFile()||meta.isSymbolicLink()||meta.nlink!==1||
     meta.size<14||meta.size>MAX_RECORD)return {status:'DAMAGED'};
  let fd;
  try{
    fd=fs.openSync(file,fs.constants.O_RDONLY|
      fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);
    const m=fs.fstatSync(fd);
    if(!m.isFile()||m.nlink!==1||m.dev!==meta.dev||m.ino!==meta.ino||
       m.size!==meta.size)return {status:'UNCERTAIN'};
    const bytes=Buffer.alloc(m.size);
    let offset=0;
    while(offset<bytes.length){
      const n=fs.readSync(fd,bytes,offset,bytes.length-offset,offset);
      if(n<=0)return {status:'UNCERTAIN'};
      offset+=n;
    }
    const decoded=decode(bytes);
    return decoded?{status:'VALID',...decoded}:{status:'DAMAGED'};
  }catch{return {status:'UNCERTAIN'};}
  finally{if(fd!==undefined)try{fs.closeSync(fd);}catch{}}
}
export function inspectExclusiveJournalLab({directory}={}){
  if(!safeDirectory(directory))return result('UNSAFE_DIRECTORY');
  let gap=false,count=0,newestSequence=0;
  for(let slot=0;slot<CAPACITY;slot++){
    const item=inspectSlot(directory,slot);
    if(item.status==='MISSING'){gap=true;continue;}
    if(item.status==='UNCERTAIN')return result('STORAGE_UNCERTAIN');
    if(item.status!=='VALID'||gap||item.sequence<=newestSequence)
      return result('DAMAGED_OR_GAP');
    count++;
    newestSequence=item.sequence;
  }
  return result(count===CAPACITY?'FULL':'AVAILABLE',
    {count,newestSequence});
}
export function appendExclusiveJournalLab({directory,sequence,signedJson}={}){
  const before=inspectExclusiveJournalLab({directory});
  if(before.status!=='AVAILABLE')return before;
  if(!goodSlot(before.count))return result('FULL');
  if(!Number.isSafeInteger(sequence)||sequence<=before.newestSequence)
    return result('OUT_OF_ORDER');
  const encoded=encodeExclusiveRecordLab({sequence,signedJson});
  if(!encoded)return result('INVALID_FRAME');
  // The sole create operation. It MUST be atomic and exclusive. A partial
  // failed write remains on disk, blocking subsequent appends.
  let fd;
  try{
    fd=fs.openSync(recordPath(directory,before.count),
      fs.constants.O_WRONLY|fs.constants.O_CREAT|
      fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);
    let written=0;
    while(written<encoded.length){
      const n=fs.writeSync(fd,encoded,written,encoded.length-written,written);
      if(n<=0)throw Error('short write');
      written+=n;
    }
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd=undefined;
    // The directory entry must be synced after the file is closed.
    const dirFd=fs.openSync(directory,fs.constants.O_RDONLY|
      fs.constants.O_DIRECTORY|fs.constants.O_NOFOLLOW);
    try{fs.fsyncSync(dirFd);}finally{fs.closeSync(dirFd);}
  }catch{
    if(fd!==undefined)try{fs.closeSync(fd);}catch{}
    return result('COMMIT_UNCERTAIN');
  }
  const after=inspectExclusiveJournalLab({directory});
  if((after.status!=='AVAILABLE'&&after.status!=='FULL')||
     after.count!==before.count+1||after.newestSequence!==sequence)
    return result('COMMIT_UNCERTAIN');
  const readBack=inspectSlot(directory,before.count);
  if(readBack.status!=='VALID'||!readBack.body.equals(
    Buffer.from(signedJson,'utf8')))
    return result('COMMIT_UNCERTAIN');
  return result('COMMITTED_HOST_ONLY',{count:after.count,
    newestSequence:after.newestSequence});
}
