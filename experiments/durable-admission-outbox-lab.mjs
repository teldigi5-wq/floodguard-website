// REVIEW ONLY — replacement-candidate admission/outbox journal, never production.
// This is deliberately NOT wired to the existing loopback HTTPS handler or Firebase.
// No routes, network, background workers, gate control, or enrollment endpoints.
import * as fs from 'node:fs';
import * as path from 'node:path';
import {createHash,createHmac,randomBytes,timingSafeEqual,verify,KeyObject} from 'node:crypto';
import {canonicalOfflineEnvelope} from './stage7-durable-ingress.mjs';

const SCHEMA='floodguard-durable-admission-outbox-lab-v1';
const FILE='durable-admission-outbox-lab.json';
const LOCK='durable-admission-outbox-lab.lock';
const UID=/^device-stage-[a-z0-9-]{1,32}$/;
const HEX=/^[a-f0-9]{64}$/;
const SIG=/^[A-Za-z0-9_-]{86}$/;
const MAX_BYTES=65536;
const MAX_DEVICES=8;
const MAX_PENDING=8;
const record=x=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&
  (Object.getPrototypeOf(x)===Object.prototype||Object.getPrototypeOf(x)===null);
const exact=(v,n)=>record(v)&&Object.keys(v).length===n.length&&n.every(k=>Object.hasOwn(v,k));
const integer=(x,min,max)=>Number.isSafeInteger(x)&&x>=min&&x<=max;
const fingerprint=key=>createHash('sha256').update(key.export({format:'der',type:'spki'})).digest('hex');
const deny=reason=>Object.freeze({accepted:false,reason});

function check(state) {
  if(!exact(state,['schema','revision','devices'])||state.schema!==SCHEMA||
     !integer(state.revision,1,Number.MAX_SAFE_INTEGER)||!record(state.devices)||
     Object.keys(state.devices).length>MAX_DEVICES)throw Error('Admission state unavailable');
  for(const [uid,entry] of Object.entries(state.devices)){
    if(!UID.test(uid)||!exact(entry,['epoch','fingerprint','lastSequence','pending'])||
       !integer(entry.epoch,1,10000)||!HEX.test(entry.fingerprint)||
       !integer(entry.lastSequence,1,2147483647)||!Array.isArray(entry.pending)||
       entry.pending.length<1||entry.pending.length>MAX_PENDING)
      throw Error('Admission record unavailable');
    let previous=0;
    for(const item of entry.pending){
      if(!exact(item,['sequence','digest','acceptedAtMs','canonical','signature'])||
         !integer(item.sequence,1,2147483647)||item.sequence<=previous||
         item.sequence>entry.lastSequence||!HEX.test(item.digest)||
         !integer(item.acceptedAtMs,0,Number.MAX_SAFE_INTEGER)||
         typeof item.canonical!=='string'||Buffer.byteLength(item.canonical)>512||
         typeof item.signature!=='string'||!SIG.test(item.signature))
        throw Error('Admission outbox unavailable');
      const parsed=JSON.parse(item.canonical);
      if(parsed.deviceId!==uid||parsed.epoch!==entry.epoch||
         parsed.frame?.sequence!==item.sequence||
         canonicalOfflineEnvelope(parsed)!==item.canonical||
         createHash('sha256').update(item.canonical).digest('hex')!==item.digest)
        throw Error('Admission payload integrity unavailable');
      previous=item.sequence;
    }
    // No acknowledgement API exists: lastSequence and the last pending record
    // must remain equal. A future handoff cannot drop data silently.
    if(previous!==entry.lastSequence)throw Error('Admission high-water unavailable');
  }
}

export function createDurableAdmissionOutboxLab({directory,integrityKey,identities,clock=Date.now}={}) {
  if(typeof directory!=='string'||!path.isAbsolute(directory)||
     !Buffer.isBuffer(integrityKey)||integrityKey.length<32||
     !identities||typeof identities.get!=='function'||typeof clock!=='function')
    throw TypeError('Explicit local directory, integrity key, identity provider and clock required');
  const stat=fs.lstatSync(directory);
  if(!stat.isDirectory()||stat.isSymbolicLink()||(stat.mode&0o022)!==0)
    throw Error('Unsafe admission directory');
  const file=path.join(directory,FILE),lock=path.join(directory,LOCK);
  const seal=state=>createHmac('sha256',integrityKey).update(JSON.stringify(state)).digest('hex');
  const read=()=>{
    // Never interpret a lost file, symlink, or tampering as a fresh journal.
    const st=fs.lstatSync(file);
    if(!st.isFile()||st.isSymbolicLink()||st.size>MAX_BYTES||st.size===0||
       (st.mode&0o077)!==0)throw Error('Admission journal unavailable');
    const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
    let payload;
    try {
      const openStat=fs.fstatSync(fd);
      if(!openStat.isFile()||openStat.ino!==st.ino||openStat.dev!==st.dev)
        throw Error('Admission journal changed during read');
      payload=JSON.parse(fs.readFileSync(fd,'utf8'));
    }finally{fs.closeSync(fd);}
    if(!exact(payload,['state','mac'])||typeof payload.mac!=='string'||!HEX.test(payload.mac))
      throw Error('Admission seal unavailable');
    const expected=Buffer.from(seal(payload.state),'hex');
    if(!timingSafeEqual(expected,Buffer.from(payload.mac,'hex')))
      throw Error('Admission journal integrity unavailable');
    check(payload.state);
    return payload.state;
  };
  const write=state=>{
    check(state);
    const body=JSON.stringify({state,mac:seal(state)});
    if(Buffer.byteLength(body)>MAX_BYTES)throw Error('Admission journal capacity exceeded');
    const tmp=path.join(directory,'admission-'+randomBytes(12).toString('hex')+'.tmp');
    try {
      const fd=fs.openSync(tmp,'wx',0o600);
      try{fs.writeFileSync(fd,body);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
      fs.renameSync(tmp,file);
      const dirFd=fs.openSync(directory,'r');
      try{fs.fsyncSync(dirFd);}finally{fs.closeSync(dirFd);}
    }finally{if(fs.existsSync(tmp))fs.unlinkSync(tmp);}
  };
  const locked=fn=>{
    const fd=fs.openSync(lock,'wx',0o600);
    try{return fn();}finally{fs.closeSync(fd);fs.unlinkSync(lock);}
  };
  return Object.freeze({
    // Only a verified existing commissioned journal is usable as admission
    // history. This is an internal readiness probe, NOT device enrollment.
    ready(){
      try {
        return locked(()=>{read();return true;});
      }catch{return false;}
    },
    commission(){
      return locked(()=>{
        if(fs.existsSync(file))throw Error('Admission journal already commissioned');
        write({schema:SCHEMA,revision:1,devices:{}});
        return Object.freeze({commissioned:true});
      });
    },
    accept({envelope,signature}={}) {
      // Validation and permission are reread while holding the lock. This
      // cannot make a separate operator-registry revocation atomic: that is
      // explicitly a production blocker, not a simulated guarantee.
      try{return locked(()=>{
        const state=read();
        let canonical;
        try{canonical=canonicalOfflineEnvelope(envelope);}catch{return deny('invalid-source-frame');}
        const uid=envelope.deviceId;
        if(!UID.test(uid)||uid==='device-stage-bootstrap')return deny('identity-not-authorized');
        let binding;
        try{binding=identities.get(uid);}catch{return deny('operator-registry-unavailable');}
        if(!binding||binding.enabled!==true||binding.scope!=='prototype-ingest-v1'||
           binding.epoch!==envelope.epoch||!(binding.publicKey instanceof KeyObject)||
           binding.publicKey.type!=='public'||binding.publicKey.asymmetricKeyType!=='ed25519')
          return deny('identity-not-authorized');
        const now=clock();
        if(!integer(now,0,Number.MAX_SAFE_INTEGER))return deny('clock-unavailable');
        if(envelope.observedAtMs<now-30000||envelope.observedAtMs>now+2000)
          return deny('source-clock-unverified');
        if(typeof signature!=='string'||!SIG.test(signature))return deny('signature-invalid');
        const sig=Buffer.from(signature,'base64url');
        if(sig.length!==64||!verify(null,Buffer.from(canonical),binding.publicKey,sig))
          return deny('signature-invalid');
        const fp=fingerprint(binding.publicKey),seq=envelope.frame.sequence;
        const previous=state.devices[uid];
        if(previous&&(previous.epoch!==envelope.epoch||previous.fingerprint!==fp))
          return deny('identity-rotation-requires-operator');
        if(previous&&seq<=previous.lastSequence)return deny('replay-or-out-of-order');
        if(previous&&previous.pending.length>=MAX_PENDING)return deny('outbox-capacity-reached');
        if(!previous&&Object.keys(state.devices).length>=MAX_DEVICES)
          return deny('journal-device-capacity-reached');
        const digest=createHash('sha256').update(canonical).digest('hex');
        const entry={sequence:seq,digest,acceptedAtMs:now,canonical,signature};
        state.devices[uid]={epoch:envelope.epoch,fingerprint:fp,lastSequence:seq,
          pending:[...(previous?.pending??[]),entry]};
        state.revision++;
        write(state);
        // The response is only emitted after file and directory fsync.
        return Object.freeze({accepted:true,kind:'LOCAL_DURABLE_ADMISSION_ONLY',sequence:seq,digest});
      });}catch{return deny('admission-journal-unavailable');}
    },
    pending(deviceId){
      if(!UID.test(deviceId))throw TypeError('Valid synthetic device identity required');
      return locked(()=>{
        const state=read(),device=state.devices[deviceId];
        return Object.freeze((device?.pending??[]).map(x=>Object.freeze({
          sequence:x.sequence,digest:x.digest,acceptedAtMs:x.acceptedAtMs,
          envelope:JSON.parse(x.canonical),signature:x.signature,
        })));
      });
    },
    // Deliberately NO acknowledge/dequeue method: database-confirmation and
    // crash-recovery authority are not yet wired, so dropping is unsafe.
  });
}
