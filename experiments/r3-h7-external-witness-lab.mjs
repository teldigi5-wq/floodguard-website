// FloodGuard R3 H7 — OFFLINE SYNTHETIC WITNESS EXPERIMENT, NOT A SERVICE.
// Extends Stage7/8's sealed-ledger concepts with an injected external anchor,
// signed operator incident events and separately signed commit acknowledgments.
// External anchor and signer custody are TEST DOUBLES, not independent hardware.
// No Firebase/HTTP/alert/physical gate APIs. All outcomes retain NO_GO.
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  createHash,createHmac,randomBytes,timingSafeEqual,verify,KeyObject
} from 'node:crypto';

const SCHEMA='floodguard-r3-h7-offline-witness-v1';
const DEVICE='device-stage-a';
const ZERO='0'.repeat(64);
const FILE='r3-h7-synthetic-witness.json';
const LOCK='r3-h7-synthetic-witness.lock';
const HEX=/^[0-9a-f]{64}$/;
const SIG=/^[A-Za-z0-9_-]{86}$/;
const LIMIT=32768;
const exact=(x,keys)=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&
  (Object.getPrototypeOf(x)===Object.prototype||
   Object.getPrototypeOf(x)===null)&&
  Object.keys(x).length===keys.length&&
  keys.every(k=>Object.hasOwn(x,k));
const int=(v,lo,hi)=>Number.isSafeInteger(v)&&v>=lo&&v<=hi;
const hash=x=>createHash('sha256').update(x).digest('hex');
const trustedKey=x=>x instanceof KeyObject&&x.type==='public'&&
  x.asymmetricKeyType==='ed25519';
const stamp=(x,key)=>{
  if(!trustedKey(key)||typeof x.signature!=='string'||!SIG.test(x.signature))
    return false;
  try{return verify(null,Buffer.from(x.canonical),key,
    Buffer.from(x.signature,'base64url'));}catch{return false;}
};
function canonical(payload,fields,domain){
  if(!exact(payload,fields)||payload.deviceId!==DEVICE||
    !int(payload.epoch,1,10000)||
    !int(payload.revision,1,2147483647)||
    !int(payload.sequence,1,2147483647)||
    typeof payload.digest!=='string'||!HEX.test(payload.digest)||
    !int(payload.atMs,946684800000,Number.MAX_SAFE_INTEGER))
    throw new TypeError('Invalid operator/witness event');
  return domain+'\n'+JSON.stringify(payload);
}
export function canonicalH7OperatorEvent(event){
  if(!['BOOTSTRAP','QUARANTINE','RECOVER'].includes(event?.kind))
    throw new TypeError('Unknown incident operation');
  return canonical(event,['kind','deviceId','epoch','revision','sequence',
    'digest','atMs'],'floodguard-r3-h7-operator-v1');
}
export function canonicalH7Acknowledgement(ack){
  if(ack?.kind!=='SIGNED_PUBLICATION_CONFIRMED'||!exact(ack,[
    'kind','deviceId','epoch','revision','sequence','digest','reservationId','atMs'
  ])||typeof ack.reservationId!=='string'||
     !/^[a-f0-9]{32}$/.test(ack.reservationId))
    throw new TypeError('Invalid signed publication acknowledgement');
  return canonical(ack,['kind','deviceId','epoch','revision','sequence',
    'digest','reservationId','atMs'],'floodguard-r3-h7-ack-v1');
}
function validateState(s){
  if(!exact(s,['schema','revision','epoch','quarantined','sequence',
    'digest','pending','head'])||
    s.schema!==SCHEMA||!int(s.revision,1,2147483647)||
    !int(s.epoch,1,10000)||typeof s.quarantined!=='boolean'||
    !int(s.sequence,1,2147483647)||
    typeof s.digest!=='string'||!HEX.test(s.digest)||
    typeof s.head!=='string'||!HEX.test(s.head))
    throw Error('Witness state invalid');
  if(s.pending!==null&&(!exact(s.pending,[
    'reservationId','epoch','sequence','digest','observedAtMs'
  ])||typeof s.pending.reservationId!=='string'||
    !/^[a-f0-9]{32}$/.test(s.pending.reservationId)||
    !int(s.pending.epoch,1,10000)||
    !int(s.pending.sequence,2,2147483647)||
    typeof s.pending.digest!=='string'||!HEX.test(s.pending.digest)||
    !int(s.pending.observedAtMs,946684800000,Number.MAX_SAFE_INTEGER)))
    throw Error('Witness pending state invalid');
}
function anchorValue(x){
  if(!exact(x,['revision','head'])||!int(x.revision,0,2147483647)||
     typeof x.head!=='string'||!HEX.test(x.head))
    throw Error('Independent anchor unavailable or invalid');
  return x;
}
const stop=reason=>Object.freeze({
  ok:false,reason,releaseDecision:'NO_GO',
  canPublish:false,canOperateGate:false,physicalSourceVerified:false
});
export function createH7OfflineWitness({
  directory,integrityKey,operatorPublicKey,confirmationPublicKey,
  externalAnchor,clock
}={}){
  if(typeof directory!=='string'||!path.isAbsolute(directory)||
    !Buffer.isBuffer(integrityKey)||integrityKey.length<32||
    !trustedKey(operatorPublicKey)||!trustedKey(confirmationPublicKey)||
    operatorPublicKey.export({format:'der',type:'spki'}).equals(
      confirmationPublicKey.export({format:'der',type:'spki'}))||
    !externalAnchor||!Object.isFrozen(externalAnchor)||
    typeof externalAnchor.read!=='function'||
    typeof externalAnchor.compareAndAdvance!=='function'||
    typeof clock!=='function')
    throw new TypeError('Independent, explicit test-only witness dependencies required');
  const directoryStat=fs.lstatSync(directory);
  if(!directoryStat.isDirectory()||directoryStat.isSymbolicLink())
    throw Error('Unsafe witness directory');
  const location=path.join(directory,FILE),lock=path.join(directory,LOCK);
  const mac=state=>createHmac('sha256',integrityKey)
    .update(JSON.stringify(state)).digest('hex');
  const time=()=>{const n=clock();if(!int(n,946684800000,
    Number.MAX_SAFE_INTEGER))throw Error('Witness clock unavailable');return n;};
  const verifySigned=(data,signature,key,serialize)=>{
    let canonical;
    try{canonical=serialize(data);}catch{return false;}
    return stamp({canonical,signature},key)&&
      Math.abs(time()-data.atMs)<=5000;
  };
  function withLock(op){
    const fd=fs.openSync(lock,'wx',0o600); // Crash lock stays: no silent takeover.
    try{
      const anchor=anchorValue(externalAnchor.read());
      let state=null;
      if(fs.existsSync(location)){
        const stat=fs.lstatSync(location);
        if(!stat.isFile()||stat.isSymbolicLink()||
          stat.size===0||stat.size>LIMIT)
          throw Error('Unsafe witness state file');
        const payload=JSON.parse(fs.readFileSync(location,'utf8'));
        if(!exact(payload,['state','mac'])||typeof payload.mac!=='string'||
           !HEX.test(payload.mac))
          throw Error('Malformed witness seal');
        const expected=Buffer.from(mac(payload.state),'hex');
        if(!timingSafeEqual(expected,Buffer.from(payload.mac,'hex')))
          throw Error('Witness integrity failure');
        validateState(payload.state);
        state=payload.state;
      }
      if(state===null){
        if(anchor.revision!==0||anchor.head!==ZERO)
          throw Error('Witness rollback or missing local state');
      }else if(anchor.revision!==state.revision||
          anchor.head!==state.head)
        throw Error('Witness/independent anchor mismatch — fail closed');
      return op(state,anchor);
    }finally{
      fs.closeSync(fd);fs.unlinkSync(lock);
    }
  }
  function mutate(state,anchor,next){
    next.revision=anchor.revision+1;
    next.schema=SCHEMA;
    // Hash chains each durable transition. Anchor must be independent in a
    // real deployment; same-host test doubles do NOT protect against collusion.
    next.head=hash(anchor.head+'\n'+JSON.stringify({
      revision:next.revision,epoch:next.epoch,
      quarantined:next.quarantined,sequence:next.sequence,
      digest:next.digest,pending:next.pending
    }));
    validateState(next);
    const data=JSON.stringify({state:next,mac:mac(next)});
    if(Buffer.byteLength(data)>LIMIT)throw Error('Witness full');
    const tmp=path.join(directory,'r3-h7-'+randomBytes(12).toString('hex')+'.tmp');
    try{
      const f=fs.openSync(tmp,'wx',0o600);
      try{fs.writeFileSync(f,data);fs.fsyncSync(f);}finally{fs.closeSync(f);}
      fs.renameSync(tmp,location);
      const df=fs.openSync(directory,'r');
      try{fs.fsyncSync(df);}finally{fs.closeSync(df);}
    }finally{if(fs.existsSync(tmp))fs.unlinkSync(tmp);}
    // Local durable record is written FIRST. If external advancement fails,
    // mismatch intentionally blocks all future operations pending inspection.
    if(externalAnchor.compareAndAdvance(anchor,{
      revision:next.revision,head:next.head
    })!==true)
      throw Error('External anchor advancement uncertain — halted');
    return Object.freeze({revision:next.revision,head:next.head});
  }
  const snapshot=()=>withLock((s,a)=>{
    if(!s)throw Error('Witness not explicitly initialized');
    return Object.freeze({
      revision:s.revision,head:s.head,epoch:s.epoch,
      quarantined:s.quarantined,sequence:s.sequence,
      digest:s.digest,pending:s.pending?Object.freeze({...s.pending}):null,
      releaseDecision:'NO_GO'
    });
  });
  const operator=(event,signature)=>withLock((state,anchor)=>{
    if(!verifySigned(event,signature,operatorPublicKey,
        canonicalH7OperatorEvent))return stop('operator-signature-refused');
    if(event.revision!==anchor.revision+1)
      return stop('operator-revision-conflict');
    const kind=event.kind;
    if(kind==='BOOTSTRAP'){
      if(state!==null||event.epoch!==1)
        return stop('explicit-bootstrap-refused');
      const next={
        epoch:1,quarantined:true,sequence:event.sequence,
        digest:event.digest,pending:null
      };
      mutate(state,anchor,next);
      return Object.freeze({ok:true,action:kind,quarantined:true,
        releaseDecision:'NO_GO'});
    }
    if(!state||event.epoch!==state.epoch+1||
       event.sequence!==state.sequence||event.digest!==state.digest)
      return stop('incident-state-mismatch');
    if(kind==='RECOVER'&&(!state.quarantined||state.pending!==null))
      return stop('recovery-requires-clean-independent-reconciliation');
    if(kind==='QUARANTINE'&&state.quarantined)
      return stop('already-quarantined');
    mutate(state,anchor,{
      epoch:event.epoch,quarantined:kind==='QUARANTINE',
      sequence:state.sequence,digest:state.digest,pending:state.pending
    });
    return Object.freeze({ok:true,action:kind,
      epoch:event.epoch,releaseDecision:'NO_GO'});
  });
  const reserve=({candidate,expected}={})=>withLock((state,anchor)=>{
    if(!state||state.quarantined||state.pending!==null)
      return stop('quarantined-or-unresolved-publication');
    if(!exact(expected,['revision','head'])||
       expected.revision!==anchor.revision||expected.head!==anchor.head)
      return stop('witness-revision-or-epoch-stale');
    const t=candidate?.ticket,c=candidate?.candidate;
    if(candidate?.issued!==true||candidate?.releaseDecision!=='NO_GO'||
       candidate?.canPublish!==false||candidate?.canWriteFirebase!==false||
       !exact(t,['enabled','deviceId','epoch','sequence','digest',
         'observedAtMs','distanceCm','levelCm','status','issuedAtMs','expiresAtMs'])||
       t.enabled!==true||t.deviceId!==DEVICE||t.epoch!==1||
       !int(t.sequence,2,2147483647)||!HEX.test(t.digest)||
       !exact(c,['current','checkpoint'])||
       c.checkpoint.sequence!==t.sequence||
       c.checkpoint.digest!==t.digest||
       c.checkpoint.epoch!==t.epoch||
       c.current.status!==t.status||
       c.current.observedAtMs!==t.observedAtMs||
       state.epoch!==t.epoch||t.sequence!==state.sequence+1||
       t.digest===state.digest||time()>t.expiresAtMs)
      return stop('signed-candidate-or-epoch-untrusted');
    const reservationId=randomBytes(16).toString('hex');
    mutate(state,anchor,{
      epoch:state.epoch,quarantined:false,
      sequence:state.sequence,digest:state.digest,
      pending:{reservationId,epoch:t.epoch,sequence:t.sequence,
        digest:t.digest,observedAtMs:t.observedAtMs}
    });
    return Object.freeze({ok:true,reservationId,
      sequence:t.sequence,digest:t.digest,
      releaseDecision:'NO_GO',canPublish:false});
  });
  const acknowledge=(ack,signature)=>withLock((state,anchor)=>{
    if(!state||state.quarantined||state.pending===null)
      return stop('no-safe-pending-publication');
    if(!verifySigned(ack,signature,confirmationPublicKey,
        canonicalH7Acknowledgement))
      return stop('independent-publication-proof-refused');
    if(ack.revision!==anchor.revision+1||
       ack.epoch!==state.epoch||
       ack.reservationId!==state.pending.reservationId||
       ack.sequence!==state.pending.sequence||
       ack.digest!==state.pending.digest)
      return stop('acknowledgement-not-bound-to-pending');
    mutate(state,anchor,{
      epoch:state.epoch,quarantined:false,
      sequence:ack.sequence,digest:ack.digest,pending:null
    });
    return Object.freeze({ok:true,
      sequence:ack.sequence,releaseDecision:'NO_GO',
      canPublish:false,physicalSourceVerified:false});
  });
  return Object.freeze({snapshot,operator,reserve,acknowledge});
}
