// Synthetic-only, separately signed database-confirmation attestation.
// Real issuer must independently verify durable DB commit and live operator
// authorization *before* signing; this module itself accesses no DB or network.
import {verify,KeyObject} from 'node:crypto';

const VERSION='floodguard-synthetic-persisted-attestation-v1';
const UID=/^device-stage-[a-z0-9-]{1,32}$/;
const DIGEST=/^[0-9a-f]{64}$/;
const SIG=/^[A-Za-z0-9_-]{86}$/;
const FRESH_MS=5000;
const FUTURE_MS=2000;
const fields=['version','deviceId','epoch','sequence','digest','acceptedAtMs',
  'confirmedAtMs','scope','deviceEnabled','databaseState'];
const obj=x=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&
  (Object.getPrototypeOf(x)===Object.prototype||Object.getPrototypeOf(x)===null);
const exact=x=>obj(x)&&Object.keys(x).length===fields.length&&
  fields.every(k=>Object.hasOwn(x,k));
const integer=(v,min,max)=>Number.isSafeInteger(v)&&v>=min&&v<=max;

export function canonicalSyntheticPublicationAttestation(value) {
  if(!exact(value)||value.version!==VERSION||!UID.test(value.deviceId)||
     !integer(value.epoch,1,10000)||!integer(value.sequence,1,2147483647)||
     typeof value.digest!=='string'||!DIGEST.test(value.digest)||
     !integer(value.acceptedAtMs,0,Number.MAX_SAFE_INTEGER)||
     !integer(value.confirmedAtMs,value.acceptedAtMs,Number.MAX_SAFE_INTEGER)||
     value.scope!=='prototype-ingest-v1'||value.deviceEnabled!==true||
     value.databaseState!=='DATABASE_CONFIRMED')
    throw new TypeError('Invalid synthetic persisted attestation');
  // FIXED canonical ordering, independent of input JS object property order.
  return JSON.stringify(Object.fromEntries(fields.map(k=>[k,value[k]])));
}

export function verifySyntheticPublicationAttestation({
  attestation,signature,publicKey,receipt,nowMs
}={}) {
  if(!(publicKey instanceof KeyObject)||publicKey.type!=='public'||
     publicKey.asymmetricKeyType!=='ed25519'||
     typeof signature!=='string'||!SIG.test(signature)||
     !integer(nowMs,0,Number.MAX_SAFE_INTEGER))return false;
  try{
    const canonical=canonicalSyntheticPublicationAttestation(attestation);
    if(!obj(receipt)||
       attestation.deviceId!==receipt.deviceId||
       attestation.epoch!==receipt.epoch||
       attestation.sequence!==receipt.sequence||
       attestation.digest!==receipt.digest||
       attestation.acceptedAtMs!==receipt.acceptedAtMs||
       attestation.confirmedAtMs<nowMs-FRESH_MS||
       attestation.confirmedAtMs>nowMs+FUTURE_MS)
      return false;
    const sig=Buffer.from(signature,'base64url');
    return sig.length===64&&verify(null,Buffer.from(canonical),publicKey,sig);
  }catch{return false;}
}
