// FloodGuard Stage 8 — isolated, synthetic-only signed receipt reconciliation.
// This file is NOT a deployed gateway, RTDB adapter, Firebase client, TLS
// endpoint, WhatsApp client, or real-device uploader. Explicit TEST DIRECTORY
// and ephemeral keys required. No network, production environment or hardware.
import * as fs from 'node:fs';
import * as path from 'node:path';
import {createHash,createHmac,randomBytes,sign,verify,timingSafeEqual,KeyObject} from 'node:crypto';
import {canonicalOfflineEnvelope} from './stage7-durable-ingress.mjs';

const DEVICE=/^device-stage-[a-z0-9-]{1,32}$/;
const DIGEST=/^[a-f0-9]{64}$/;
const SIG=/^[A-Za-z0-9_-]{86}$/;
const SCHEMA='floodguard-stage8-synthetic-receipts-v1';
const RECEIPT_VERSION='floodguard-offline-receipt-v1';
const QUERY_VERSION='floodguard-offline-reconcile-v1';
const LIMIT=65536;
const MAX_SEQUENCE=2147483647;
const isObject=x=>x!==null&&typeof x==='object'&&!Array.isArray(x)
  && (Object.getPrototypeOf(x)===Object.prototype||Object.getPrototypeOf(x)===null);
const exact=(x,keys)=>isObject(x)&&Object.keys(x).length===keys.length&&keys.every(k=>Object.hasOwn(x,k));
const number=(v,minimum,maximum)=>Number.isSafeInteger(v)&&v>=minimum&&v<=maximum;
const publicKey=k=>k instanceof KeyObject&&k.type==='public'&&k.asymmetricKeyType==='ed25519';
const privateKey=k=>k instanceof KeyObject&&k.type==='private'&&k.asymmetricKeyType==='ed25519';
const digestOf=bytes=>createHash('sha256').update(bytes).digest('hex');
const fingerprintOf=k=>digestOf(k.export({type:'spki',format:'der'}));
const validSignature=x=>typeof x==='string'&&SIG.test(x)&&Buffer.from(x,'base64url').length===64;
const safeClock=now=>number(now,0,Number.MAX_SAFE_INTEGER);
function canonicalReceipt(receipt){
  if(!exact(receipt,['version','deviceId','epoch','sequence','digest','acceptedAtMs'])
     ||receipt.version!==RECEIPT_VERSION||!DEVICE.test(receipt.deviceId)
     ||!number(receipt.epoch,1,10000)||!number(receipt.sequence,1,MAX_SEQUENCE)
     ||typeof receipt.digest!=='string'||!DIGEST.test(receipt.digest)
     ||!number(receipt.acceptedAtMs,0,Number.MAX_SAFE_INTEGER))
    throw new TypeError('Invalid synthetic receipt');
  return JSON.stringify({
    version:RECEIPT_VERSION,deviceId:receipt.deviceId,epoch:receipt.epoch,
    sequence:receipt.sequence,digest:receipt.digest,acceptedAtMs:receipt.acceptedAtMs
  });
}
function canonicalQuery(query){
  if(!exact(query,['version','deviceId','epoch','sequence','digest','requestedAtMs'])
    ||query.version!==QUERY_VERSION||!DEVICE.test(query.deviceId)
    ||!number(query.epoch,1,10000)||!number(query.sequence,1,MAX_SEQUENCE)
    ||typeof query.digest!=='string'||!DIGEST.test(query.digest)
    ||!number(query.requestedAtMs,0,Number.MAX_SAFE_INTEGER))
    throw new TypeError('Invalid synthetic reconciliation query');
  return JSON.stringify({
    version:QUERY_VERSION,deviceId:query.deviceId,epoch:query.epoch,
    sequence:query.sequence,digest:query.digest,requestedAtMs:query.requestedAtMs
  });
}
function matchesReceipt(receipt,wanted){
  return receipt.deviceId===wanted.deviceId&&receipt.epoch===wanted.epoch
    &&receipt.sequence===wanted.sequence&&receipt.digest===wanted.digest;
}
export function makeStage8ReconciliationQuery({deviceId,epoch,sequence,digest,requestedAtMs}={}){
  const query={version:QUERY_VERSION,deviceId,epoch,sequence,digest,requestedAtMs};
  canonicalQuery(query);
  return Object.freeze(query);
}
export function verifyStage8OfflineReceipt({receipt,signature,publicKey:trustedKey,expected}={}){
  try{
    if(!publicKey(trustedKey)||!validSignature(signature))return false;
    const canonical=canonicalReceipt(receipt);
    if(expected&&!matchesReceipt(receipt,expected))return false;
    return verify(null,Buffer.from(canonical),trustedKey,Buffer.from(signature,'base64url'));
  }catch{return false;}
}
function validEntry(deviceId,entry){
  if(!DEVICE.test(deviceId)
    ||!exact(entry,['keyFingerprint','receipt','signature'])
    ||typeof entry.keyFingerprint!=='string'||!DIGEST.test(entry.keyFingerprint)
    ||entry.receipt?.deviceId!==deviceId||!validSignature(entry.signature))return false;
  try{canonicalReceipt(entry.receipt);return true;}catch{return false;}
}
export function createStage8OfflineReceiptLedger({directory,integrityKey}={}){
  if(typeof directory!=='string'||!path.isAbsolute(directory))throw new TypeError('Absolute test-only directory required');
  if(!Buffer.isBuffer(integrityKey)||integrityKey.length<32)throw new TypeError('Ephemeral test-only integrity key required');
  const dirStat=fs.lstatSync(directory);
  if(!dirStat.isDirectory()||dirStat.isSymbolicLink())throw new Error('Unsafe synthetic ledger directory');
  const file=path.join(directory,'stage8-offline-receipts.json');
  const lock=path.join(directory,'stage8-offline-receipts.lock');
  const seal=state=>createHmac('sha256',integrityKey).update(JSON.stringify(state)).digest('hex');
  function read(){
    if(!fs.existsSync(file))return {schema:SCHEMA,devices:{}};
    const st=fs.lstatSync(file);
    if(!st.isFile()||st.isSymbolicLink()||st.size>LIMIT)throw new Error('Unsafe synthetic ledger');
    const document=JSON.parse(fs.readFileSync(file,'utf8'));
    if(!exact(document,['state','mac'])||typeof document.mac!=='string'||!DIGEST.test(document.mac))
      throw new Error('Malformed synthetic ledger seal');
    const computed=Buffer.from(seal(document.state),'hex');
    if(!timingSafeEqual(computed,Buffer.from(document.mac,'hex')))throw new Error('Synthetic ledger integrity mismatch');
    const state=document.state;
    if(!exact(state,['schema','devices'])||state.schema!==SCHEMA||!isObject(state.devices)
      ||Object.keys(state.devices).length>32
      ||Object.entries(state.devices).some(([id,entry])=>!validEntry(id,entry)))
      throw new Error('Malformed synthetic ledger state');
    return state;
  }
  function locked(update){
    const fd=fs.openSync(lock,'wx',0o600); // Stale crash locks never auto-removed.
    try{
      const state=read();
      const outcome=update(state);
      if(outcome.write){
        const contents=JSON.stringify({state,mac:seal(state)});
        if(Buffer.byteLength(contents,'utf8')>LIMIT)throw new Error('Synthetic receipt ledger full');
        const tmp=path.join(directory,'stage8-'+randomBytes(12).toString('hex')+'.tmp');
        try{
          const out=fs.openSync(tmp,'wx',0o600);
          try{fs.writeFileSync(out,contents);fs.fsyncSync(out);}finally{fs.closeSync(out);}
          fs.renameSync(tmp,file);
          const dir=fs.openSync(directory,'r');
          try{fs.fsyncSync(dir);}finally{fs.closeSync(dir);}
        }finally{if(fs.existsSync(tmp))fs.unlinkSync(tmp);}
      }
      return outcome.result;
    }finally{fs.closeSync(fd);fs.unlinkSync(lock);}
  }
  return Object.freeze({
    commit({keyFingerprint,receipt,signature}={}){
      if(typeof keyFingerprint!=='string'||!DIGEST.test(keyFingerprint)
         ||!validSignature(signature))throw new TypeError('Invalid synthetic acceptance record');
      canonicalReceipt(receipt);
      return locked(state=>{
        const before=state.devices[receipt.deviceId];
        if(before){
          if(before.keyFingerprint!==keyFingerprint||before.receipt.epoch!==receipt.epoch)
            return {write:false,result:{status:'identity-mismatch'}};
          if(before.receipt.sequence>receipt.sequence)return {write:false,result:{status:'older-sequence'}};
          if(before.receipt.sequence===receipt.sequence){
            return {write:false,result:{status:matchesReceipt(before.receipt,receipt)?'already-committed':'sequence-conflict'}};
          }
        }
        state.devices[receipt.deviceId]={keyFingerprint,receipt,signature};
        return {write:true,result:{status:'committed'}};
      });
    },
    lookup({deviceId,epoch,sequence,digest,keyFingerprint}={}){
      if(!DEVICE.test(deviceId)||!number(epoch,1,10000)||!number(sequence,1,MAX_SEQUENCE)
        ||typeof digest!=='string'||!DIGEST.test(digest)
        ||typeof keyFingerprint!=='string'||!DIGEST.test(keyFingerprint))
        throw new TypeError('Invalid synthetic receipt lookup');
      return locked(state=>{
        const entry=state.devices[deviceId];
        if(!entry||entry.keyFingerprint!==keyFingerprint||!matchesReceipt(entry.receipt,{deviceId,epoch,sequence,digest}))
          return {write:false,result:null};
        return {write:false,result:{receipt:{...entry.receipt},signature:entry.signature}};
      });
    }
  });
}
export function createStage8OfflineReceiptContract({ledger,clock,serverPrivateKey,serverPublicKey}={}){
  if(!ledger||typeof ledger.commit!=='function'||typeof ledger.lookup!=='function'
    ||typeof clock!=='function'||!privateKey(serverPrivateKey)||!publicKey(serverPublicKey))
    throw new TypeError('Synthetic receipt ledger, clock and Ed25519 server keys required');
  const registry=new Map(),channels=new WeakSet();
  const verifyChannel=p=>p!==null&&typeof p==='object'&&channels.has(p);
  function authenticate(deviceId,epoch,channelProof){
    if(!verifyChannel(channelProof))return {error:'transport-unverified'};
    const identity=registry.get(deviceId);
    if(!identity?.enabled||identity.scope!=='prototype-ingest-v1'||identity.epoch!==epoch)
      return {error:'unprovisioned-or-revoked'};
    return {identity};
  }
  function validTime(t,now){
    return safeClock(now)&&t>=now-30000&&t<=now+2000;
  }
  return Object.freeze({
    provision(deviceId,{devicePublicKey,epoch=1,enabled=true,scope='prototype-ingest-v1'}={}){
      if(!DEVICE.test(deviceId)||!publicKey(devicePublicKey)||!number(epoch,1,10000))
        throw new TypeError('Synthetic device public key required');
      registry.set(deviceId,{key:devicePublicKey,fingerprint:fingerprintOf(devicePublicKey),epoch,
        enabled:enabled===true,scope});
    },
    revoke(deviceId){
      if(!DEVICE.test(deviceId))throw new TypeError('Synthetic UID required');
      const identity=registry.get(deviceId);
      if(identity)registry.set(deviceId,{...identity,enabled:false});
    },
    issueSyntheticChannelProof(){
      const proof=Object.freeze({kind:'SIMULATED_CHANNEL_NOT_REAL_TLS'});
      channels.add(proof);return proof;
    },
    ingest({envelope,signature,channelProof,failPoint}={}){
      let bytes;
      try{bytes=canonicalOfflineEnvelope(envelope);}
      catch{return {accepted:false,reason:'invalid-envelope'};}
      const {identity,error}=authenticate(envelope.deviceId,envelope.epoch,channelProof);
      if(error)return {accepted:false,reason:error};
      const now=clock();
      if(!validTime(envelope.observedAtMs,now))return {accepted:false,reason:'expired-or-future-frame'};
      if(!validSignature(signature)||!verify(null,Buffer.from(bytes),identity.key,Buffer.from(signature,'base64url')))
        return {accepted:false,reason:'invalid-signature'};
      if(failPoint==='before-commit')return {accepted:false,reason:'simulated-before-commit'};
      const receipt={
        version:RECEIPT_VERSION,deviceId:envelope.deviceId,epoch:envelope.epoch,
        sequence:envelope.frame.sequence,digest:digestOf(bytes),acceptedAtMs:now
      };
      const receiptSignature=sign(null,Buffer.from(canonicalReceipt(receipt)),serverPrivateKey).toString('base64url');
      try{
        const outcome=ledger.commit({keyFingerprint:identity.fingerprint,receipt,signature:receiptSignature});
        if(outcome.status!=='committed')
          return {accepted:false,reason:outcome.status==='already-committed'
            ?'already-committed-reconcile':outcome.status};
      }catch{return {accepted:false,reason:'ledger-unavailable'};}
      if(failPoint==='after-commit-before-ack')return {accepted:false,reason:'ack-lost-outcome-unknown'};
      return {accepted:true,receipt:Object.freeze(receipt),signature:receiptSignature};
    },
    reconcile({query,signature,channelProof}={}){
      let bytes;
      try{bytes=canonicalQuery(query);}catch{return {found:false,reason:'invalid-query'};}
      const {identity,error}=authenticate(query.deviceId,query.epoch,channelProof);
      if(error)return {found:false,reason:error};
      const now=clock();
      if(!validTime(query.requestedAtMs,now))return {found:false,reason:'expired-or-future-query'};
      if(!validSignature(signature)||!verify(null,Buffer.from(bytes),identity.key,Buffer.from(signature,'base64url')))
        return {found:false,reason:'invalid-signature'};
      try{
        const stored=ledger.lookup({deviceId:query.deviceId,epoch:query.epoch,
          sequence:query.sequence,digest:query.digest,keyFingerprint:identity.fingerprint});
        if(!stored)return {found:false,reason:'not-found-or-not-current'};
        if(!verifyStage8OfflineReceipt({...stored,publicKey:serverPublicKey,expected:query}))
          return {found:false,reason:'receipt-signature-invalid'};
        return {found:true,kind:'SYNTHETIC_RECOVERED_ACK_ONLY',...stored};
      }catch{return {found:false,reason:'ledger-unavailable'};}
    }
  });
}
