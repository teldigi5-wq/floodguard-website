// Stage R2: private, HMAC-sealed, fsync-backed LOCAL checkpoint journal lab.
// NOT a cloud service, nonrollback hardware counter, key vault or real gateway.
// A replaced older VALID HMAC-sealed file can still be replayed: this journal
// protects integrity/restarts, not independently trusted monotonic history.
import * as fs from 'node:fs';
import * as path from 'node:path';
import {createHmac,randomBytes,timingSafeEqual,verify,KeyObject} from 'node:crypto';
import {canonicalR2RecoveryAnchor,reviewR2RecoveryAnchor}
  from './r2-recovery-anchor-lab.mjs';
import {reviewR2OperatorCatchup}
  from './r2-operator-catchup-lab.mjs';

const SCHEMA='floodguard-r2-local-anchor-journal-lab-v1';
const NAME='r2-operator-anchor-journal.json';
const LOCK='r2-operator-anchor-journal.lock';
const MAX_BYTES=32768;
const DIGEST=/^[a-f0-9]{64}$/;
const SIG=/^[A-Za-z0-9_-]{86}$/;
const streams=['water','rain'];
const isRecord=v=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&
  (Object.getPrototypeOf(v)===Object.prototype||
    Object.getPrototypeOf(v)===null);
const exact=(v,fields)=>isRecord(v)&&
  Object.keys(v).length===fields.length&&fields.every(f=>Object.hasOwn(v,f));
const trustedKey=k=>k instanceof KeyObject&&k.type==='public'&&
  k.asymmetricKeyType==='ed25519';
const signature=s=>typeof s==='string'&&SIG.test(s)&&
  Buffer.from(s,'base64url').length===64;
const reject=reason=>Object.freeze({advanced:false,reason});

function verifyAnchor(signed,stream,key) {
  if(!exact(signed,['anchor','signature'])||!signature(signed.signature))
    return false;
  try{
    const bytes=canonicalR2RecoveryAnchor(signed.anchor);
    return signed.anchor.stream===stream&&
      verify(null,Buffer.from(bytes,'utf8'),key,
        Buffer.from(signed.signature,'base64url'));
  }catch{return false;}
}
function signedState(state,keys) {
  if(!exact(state,['schema','generation','water','rain'])||
     state.schema!==SCHEMA||
     !Number.isSafeInteger(state.generation)||state.generation<0||
     state.generation>2147483647)
    throw Error('Invalid local anchor journal');
  for(const stream of streams)
    if(!verifyAnchor(state[stream],stream,keys[stream].anchor))
      throw Error('Invalid signed local journal anchor');
}
function keySet(keys) {
  if(!exact(keys,streams))throw new TypeError('Both pinned stream key sets required');
  const pins=new Set();
  for(const stream of streams){
    const entry=keys[stream];
    if(!exact(entry,['report','receipt','anchor','approval'])||
       !Object.values(entry).every(trustedKey))
      throw new TypeError('Four independent Ed25519 public keys required per stream');
    for(const publicKey of Object.values(entry)){
      const id=publicKey.export({type:'spki',format:'der'}).toString('base64');
      if(pins.has(id))throw new TypeError('Duplicate issuer/trust role key');
      pins.add(id);
    }
  }
}

/**
 * One process / trusted test directory only. A competing process uses an
 * exclusive OS file lock with "wx". Crash-left locks are never auto-cleared.
 * Require independently provisioned, ephemeral test-only MAC and public keys.
 */
export function createR2LocalAnchorJournalLab({
  directory,integrityKey,trustedKeys
}={}) {
  if(process.env.FG_R2_LOCAL_JOURNAL_LAB_TEST!=='1')
    throw Error('Local R2 journal disabled outside isolated tests');
  if(typeof directory!=='string'||!path.isAbsolute(directory))
    throw new TypeError('Absolute test directory required');
  if(!Buffer.isBuffer(integrityKey)||integrityKey.length<32)
    throw new TypeError('External test-only integrity key required');
  keySet(trustedKeys);
  const st=fs.lstatSync(directory);
  if(!st.isDirectory()||st.isSymbolicLink()||(st.mode&0o077)!==0)
    throw Error('Unsafe local journal directory permissions');
  const file=path.join(directory,NAME);
  const lock=path.join(directory,LOCK);
  const mac=state=>createHmac('sha256',integrityKey)
    .update(JSON.stringify(state),'utf8').digest('hex');
  function readUnsealed() {
    // Missing checkpoint never looks like an empty, re-enrollable ledger.
    const fd=fs.openSync(file,fs.constants.O_RDONLY|
      (fs.constants.O_NOFOLLOW||0));
    try{
      const stat=fs.fstatSync(fd);
      if(!stat.isFile()||stat.nlink!==1||stat.size>MAX_BYTES||
         (stat.mode&0o077)!==0)throw Error('Unsafe local journal file');
      const document=JSON.parse(fs.readFileSync(fd,'utf8'));
      if(!exact(document,['state','mac'])||
         typeof document.mac!=='string'||!DIGEST.test(document.mac))
        throw Error('Malformed local journal seal');
      const expected=Buffer.from(mac(document.state),'hex');
      if(!timingSafeEqual(expected,Buffer.from(document.mac,'hex')))
        throw Error('Local journal integrity mismatch');
      signedState(document.state,trustedKeys);
      return document.state;
    }finally{fs.closeSync(fd);}
  }
  function persist(state){
    signedState(state,trustedKeys);
    const body=JSON.stringify({state,mac:mac(state)});
    if(Buffer.byteLength(body,'utf8')>MAX_BYTES)
      throw Error('Local journal size limit');
    const tmp=path.join(directory,'r2-anchor-'+
      randomBytes(12).toString('hex')+'.tmp');
    try{
      const fd=fs.openSync(tmp,'wx',0o600);
      try{fs.writeFileSync(fd,body,'utf8');fs.fsyncSync(fd);}
      finally{fs.closeSync(fd);}
      fs.renameSync(tmp,file);
      const dirFd=fs.openSync(directory,'r');
      try{fs.fsyncSync(dirFd);}finally{fs.closeSync(dirFd);}
    }finally{if(fs.existsSync(tmp))fs.unlinkSync(tmp);}
  }
  function locked(operation) {
    const fd=fs.openSync(lock,'wx',0o600);
    try{return operation();}
    finally{
      fs.closeSync(fd);
      fs.unlinkSync(lock);
    }
  }
  const clone=value=>JSON.parse(JSON.stringify(value));
  return Object.freeze({
    // Explicit operator bootstrap only. This intentionally requires BOTH
    // streams at once and refuses to silently reset an existing file.
    initialize({water,rain}={}){
      return locked(()=>{
        const prior=fs.lstatSync(file,{throwIfNoEntry:false});
        if(prior){
          if(prior.isSymbolicLink()||!prior.isFile())
            throw Error('Unsafe existing local journal path');
          throw Error('Local journal already initialized');
        }
        for(const [stream,item] of Object.entries({water,rain})){
          if(!exact(item,['signedAnchor','publicRecord']))
            throw new TypeError('Signed source bootstrap proof required');
          if(!reviewR2RecoveryAnchor({
            stream,publicRecord:item.publicRecord,
            signedAnchor:item.signedAnchor,
            trustedAnchorKey:trustedKeys[stream].anchor,
            trustedReportKey:trustedKeys[stream].report
          }).matches)
            throw Error('Unverified initial signed anchor');
        }
        const state={
          schema:SCHEMA,generation:0,
          water:clone(water.signedAnchor),rain:clone(rain.signedAnchor)
        };
        persist(state);
        return Object.freeze({initialized:true,generation:0});
      });
    },
    snapshot(){
      return locked(()=>clone(readUnsealed()));
    },
    // A signed operator catch-up is mandatory. An independently signed NEW
    // anchor is supplied, verified and fsync-committed by this journal; the
    // journal never generates an operator signature or uses a private key.
    advance({
      stream,publicRecord,receipt,receiptSignature,
      signedApproval,signedNextAnchor
    }={}){
      if(!streams.includes(stream))return reject('stream-unrecognized');
      return locked(()=>{
        const state=readUnsealed(); // MAC+signatures checked on EVERY update
        const keys=trustedKeys[stream];
        const result=reviewR2OperatorCatchup({
          stream,publicRecord,signedAnchor:state[stream],
          receipt,receiptSignature,signedApproval,
          trustedReportKey:keys.report,trustedReceiptKey:keys.receipt,
          trustedAnchorKey:keys.anchor,trustedApprovalKey:keys.approval
        });
        if(!result.approved)return reject(result.reason);
        if(!verifyAnchor(signedNextAnchor,stream,keys.anchor))
          return reject('replacement-anchor-signature-unverified');
        const proposed=result.proposedAnchor;
        if(canonicalR2RecoveryAnchor(signedNextAnchor.anchor)!==
           canonicalR2RecoveryAnchor(proposed))
          return reject('replacement-anchor-binding-mismatch');
        const next={...state,generation:state.generation+1,
          [stream]:clone(signedNextAnchor)};
        persist(next);
        return Object.freeze({
          advanced:true,generation:next.generation,
          kind:'FSYNC_LOCAL_JOURNAL_ONLY_NOT_NONROLLBACK'
        });
      });
    }
  });
}
