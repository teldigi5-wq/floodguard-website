// FloodGuard R3 — isolated, explicitly seeded local issuance checkpoint.
// NO production DB, Firebase, service, network, credentials or device I/O.
// This synthetic HMAC-sealed local file is NOT a real authorization/rollback
// boundary. It cannot atomically coordinate external registry revocation.
// The signed attestation is returned ONLY AFTER local durable checkpoint fsync.
import * as fs from 'node:fs';
import * as path from 'node:path';
import {createHash,createHmac,randomBytes,timingSafeEqual,KeyObject}
  from 'node:crypto';
import {verifySyntheticPublicationAttestation}
  from './synthetic-publication-attestation.mjs';

const SCHEMA='floodguard-r3-local-issuance-checkpoint-v1';
const F='r3-local-issuance-checkpoint.json';
const M='r3-local-issuance-commissioned.marker';
const LOCK='r3-local-issuance-checkpoint.lock';
const MAX=16;
const UID=/^device-stage-[a-z0-9-]{1,32}$/;
const HEX=/^[a-f0-9]{64}$/;
const exact=(v,ks)=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&
  Object.getPrototypeOf(v)===Object.prototype&&
  Object.keys(v).length===ks.length&&ks.every(k=>Object.hasOwn(v,k));
const integer=(n,min,max)=>Number.isSafeInteger(n)&&n>=min&&n<=max;
const spki=k=>createHash('sha256').update(k.export({
  format:'der',type:'spki'
})).digest('hex');
const denial=reason=>Object.freeze({issued:false,reason,
  canPublish:false,canAcknowledge:false,canSendAlert:false,
  canOperateGate:false});
function witness(v){
  return exact(v,['sequence','digest','acceptedAtMs','confirmedAtMs'])&&
    integer(v.sequence,1,2147483647)&&
    typeof v.digest==='string'&&HEX.test(v.digest)&&
    integer(v.acceptedAtMs,946684800000,Number.MAX_SAFE_INTEGER)&&
    integer(v.confirmedAtMs,v.acceptedAtMs,Number.MAX_SAFE_INTEGER);
}
function stateValid(state){
  if(!exact(state,['schema','revision','deviceId','epoch','issuerFingerprint','entries'])||
     state.schema!==SCHEMA||!integer(state.revision,1,Number.MAX_SAFE_INTEGER)||
     !UID.test(state.deviceId)||!integer(state.epoch,1,10000)||
     typeof state.issuerFingerprint!=='string'||!HEX.test(state.issuerFingerprint)||
     !Array.isArray(state.entries)||state.entries.length<1||
     state.entries.length>MAX||state.revision!==state.entries.length)
    throw Error('Sealed issuance checkpoint unavailable');
  let prior;
  for(const entry of state.entries) {
    if(!witness(entry)||
       (prior&&(entry.sequence!==prior.sequence+1||
         entry.acceptedAtMs<prior.acceptedAtMs||
         entry.confirmedAtMs<prior.confirmedAtMs)))
      throw Error('Sealed issuance checkpoint invalid');
    prior=entry;
  }
}
function existing(file) {
  try { fs.lstatSync(file);return true; }
  catch(e) { if(e.code==='ENOENT')return false;throw e; }
}
function safeReadFile(file){
  const st=fs.lstatSync(file);
  if(!st.isFile()||st.isSymbolicLink()||st.size<1||st.size>16384)
    throw Error('Unsafe local checkpoint file');
  const fd=fs.openSync(file,fs.constants.O_RDONLY|
    fs.constants.O_NOFOLLOW|fs.constants.O_CLOEXEC);
  try {
    const before=fs.fstatSync(fd);
    const bytes=fs.readFileSync(fd);
    const after=fs.fstatSync(fd);
    if(!before.isFile()||bytes.length!==before.size||
       before.size!==after.size||before.mtimeMs!==after.mtimeMs)
      throw Error('Sealed checkpoint modified during read');
    return JSON.parse(bytes.toString('utf8'));
  }finally{fs.closeSync(fd);}
}
function replaceAtomic(directory,file,value) {
  const tmp=path.join(directory,'r3-issuer-'+randomBytes(12).toString('hex')+'.tmp');
  try {
    const fd=fs.openSync(tmp,'wx',0o600);
    try {fs.writeFileSync(fd,value);fs.fsyncSync(fd);}
    finally {fs.closeSync(fd);}
    fs.renameSync(tmp,file);
    const d=fs.openSync(directory,'r');
    try{fs.fsyncSync(d);}finally{fs.closeSync(d);}
  }finally{if(existing(tmp))fs.unlinkSync(tmp);}
}
/**
 * `issuer` MUST be created by the private offline harness from PR74's
 * verified local read-only Stage9 DB and independently commissioned registry.
 * A frozen injected issuer is still not a trusted production identity.
 * Test failPoint is *factory-only*, not accepted from an incoming receipt.
 */
export function createDurableOfflineIssuerCheckpointLab({
  directory,integrityKey,issuer,issuerPublicKey,clock,failPoint
}={}) {
  if(typeof directory!=='string'||!path.isAbsolute(directory)||
     !Buffer.isBuffer(integrityKey)||integrityKey.length<32||
     !issuer||!Object.isFrozen(issuer)||typeof issuer.attest!=='function'||
     !(issuerPublicKey instanceof KeyObject)||issuerPublicKey.type!=='public'||
     issuerPublicKey.asymmetricKeyType!=='ed25519'||
     typeof clock!=='function'||(failPoint!==undefined&&
       !['before-commit','after-commit-before-return'].includes(failPoint)))
    throw TypeError('Explicit test-only issuer, key, absolute directory and clock required');
  const root=fs.lstatSync(directory);
  if(!root.isDirectory()||root.isSymbolicLink())
    throw Error('Unsafe synthetic issuance directory');
  const file=path.join(directory,F),marker=path.join(directory,M);
  const lock=path.join(directory,LOCK),issuerFingerprint=spki(issuerPublicKey);
  const mac=state=>createHmac('sha256',integrityKey)
    .update(JSON.stringify(state)).digest('hex');
  function locked(callback) {
    const fd=fs.openSync(lock,'wx',0o600);
    try {return callback();}
    finally {fs.closeSync(fd);fs.unlinkSync(lock);}
  }
  function load() {
    if(!existing(marker)||!existing(file))
      throw Error('Missing commissioned issuance history');
    const mst=fs.lstatSync(marker);
    if(!mst.isFile()||mst.isSymbolicLink()||
       safeReadFile(marker).magic!=='FG_R3_LOCAL_SEED_ONLY')
      throw Error('Invalid commissioning marker');
    const obj=safeReadFile(file);
    if(!exact(obj,['state','mac'])||typeof obj.mac!=='string'||
       !HEX.test(obj.mac))throw Error('Invalid sealed issuance payload');
    const expected=mac(obj.state);
    if(!timingSafeEqual(Buffer.from(expected,'hex'),Buffer.from(obj.mac,'hex')))
      throw Error('Sealed issuance HMAC mismatch');
    stateValid(obj.state);
    if(obj.state.issuerFingerprint!==issuerFingerprint)
      throw Error('Issuance signer binding mismatch');
    return obj.state;
  }
  function write(state){
    stateValid(state);
    replaceAtomic(directory,file,JSON.stringify({state,mac:mac(state)}));
  }
  return Object.freeze({
    commission(seed){
      return locked(()=>{
        if(existing(file)||existing(marker))
          throw Error('Issuer checkpoint already commissioned');
        if(!exact(seed,['deviceId','epoch','sequence','digest','acceptedAtMs'])||
           !UID.test(seed.deviceId)||!integer(seed.epoch,1,10000)||
           !integer(seed.sequence,1,2147483646)||
           typeof seed.digest!=='string'||!HEX.test(seed.digest)||
           !integer(seed.acceptedAtMs,946684800000,Number.MAX_SAFE_INTEGER))
          throw TypeError('Explicit operator prior checkpoint required');
        // Create marker first; if the ledger write is interrupted, the
        // surviving marker refuses re-commissioning rather than resetting.
        const m=fs.openSync(marker,'wx',0o600);
        try{fs.writeFileSync(m,JSON.stringify({magic:'FG_R3_LOCAL_SEED_ONLY'}));fs.fsyncSync(m);}
        finally{fs.closeSync(m);}
        const d=fs.openSync(directory,'r');
        try{fs.fsyncSync(d);}finally{fs.closeSync(d);}
        write({schema:SCHEMA,revision:1,deviceId:seed.deviceId,
          epoch:seed.epoch,issuerFingerprint,entries:[{
            sequence:seed.sequence,digest:seed.digest,
            acceptedAtMs:seed.acceptedAtMs,confirmedAtMs:seed.acceptedAtMs
          }]});
        return Object.freeze({commissioned:true,releaseAuthorized:false});
      });
    },
    checkpoint(){
      return locked(()=>{
        const state=load(),last=state.entries.at(-1);
        return Object.freeze({deviceId:state.deviceId,epoch:state.epoch,
          sequence:last.sequence,digest:last.digest,revision:state.revision,
          releaseAuthorized:false});
      });
    },
    attest(request){
      try {
        return locked(()=>{
          const state=load();
          // Require exactly one next sequence and same identity/epoch; no
          // automatic epoch rotation, first-issue bootstrap or holes.
          const receipt=request?.receipt,last=state.entries.at(-1);
          if(!exact(request,['receipt','receiptSignature'])||
             !exact(receipt,['version','deviceId','epoch','sequence','digest','acceptedAtMs'])||
             receipt.deviceId!==state.deviceId||receipt.epoch!==state.epoch||
             !integer(receipt.sequence,1,2147483647)||
             receipt.sequence!==last.sequence+1||
             typeof receipt.digest!=='string'||!HEX.test(receipt.digest)||
             !integer(receipt.acceptedAtMs,last.acceptedAtMs,Number.MAX_SAFE_INTEGER))
            return denial('issuance-replay-gap-or-identity-conflict');
          if(state.entries.length>=MAX)return denial('issuance-ledger-capacity');
          const response=issuer.attest(request);
          if(response?.issued!==true)
            return denial(response?.reason||'underlying-issuer-denied');
          const a=response.attestation,now=clock();
          if(!integer(now,946684800000,Number.MAX_SAFE_INTEGER)||
             a?.deviceId!==receipt.deviceId||a.epoch!==receipt.epoch||
             a.sequence!==receipt.sequence||a.digest!==receipt.digest||
             a.acceptedAtMs!==receipt.acceptedAtMs||
             a.confirmedAtMs<last.confirmedAtMs||
             !verifySyntheticPublicationAttestation({
               attestation:a,signature:response.signature,
               publicKey:issuerPublicKey,receipt,nowMs:now
             }))return denial('signed-issuance-evidence-invalid');
          if(failPoint==='before-commit')return denial('simulated-before-durable-commit');
          state.entries.push({sequence:a.sequence,digest:a.digest,
            acceptedAtMs:a.acceptedAtMs,confirmedAtMs:a.confirmedAtMs});
          state.revision++;
          write(state);
          // A simulated crash after durable commit MUST refuse returning
          // the generated signature and reject a retry on restart.
          if(failPoint==='after-commit-before-return')
            return denial('simulated-response-lost-after-commit');
          return Object.freeze({...response,
            kind:'LOCAL_SYNTHETIC_DURABLY_RECORDED_ATTESTATION',
            releaseAuthorized:false});
        });
      }catch{
        return denial('sealed-issuance-history-unavailable');
      }
    }
  });
}
