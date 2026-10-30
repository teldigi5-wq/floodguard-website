// OFFLINE / TEST-ONLY: challenge-bound signed checkpoint client for a
// SEPARATELY OPERATED authority. This file contains NO private key, signer,
// production endpoint, Firebase Admin SDK, or deployable network client.
// A fake transport is supplied only by isolated regression tests.
import {randomBytes,verify,KeyObject} from 'node:crypto';

const DOMAIN='floodguard-revocation-checkpoint-v1';
const UID=/^ingest-(?:verifier|authority|observer)-stage-[a-z0-9-]{1,32}$/;
const ISSUER=/^[a-z][a-z0-9-]{3,63}$/;
const CHALLENGE=/^[0-9a-f]{32}$/;
const SIG=/^[A-Za-z0-9_-]{86}$/;
const keys=['domain','issuer','uid','roleGeneration','revokeTime',
  'challenge','issuedAtMs','expiresAtMs'];
const exact=(object,fields)=>object!==null&&typeof object==='object'&&
  !Array.isArray(object)&&Object.keys(object).length===fields.length&&
  fields.every(x=>Object.hasOwn(object,x));
const integer=x=>Number.isSafeInteger(x)&&x>=0;
const reject=reason=>Object.freeze({ok:false,reason});
export const externalRevocationProofDomain=DOMAIN;
// Caller may use this stable canonical format when implementing an
// independently hosted signer. Do NOT let callers supply arbitrary fields.
export function canonicalExternalRevocationProof(value){
  if(!exact(value,keys)||value.domain!==DOMAIN||
     !ISSUER.test(value.issuer)||!UID.test(value.uid)||
     !integer(value.roleGeneration)||value.roleGeneration<1||
     !integer(value.revokeTime)||!CHALLENGE.test(value.challenge)||
     !integer(value.issuedAtMs)||!integer(value.expiresAtMs)||
     value.expiresAtMs<=value.issuedAtMs||
     value.expiresAtMs>value.issuedAtMs+30000)
    throw new TypeError('Invalid signed authority checkpoint');
  return JSON.stringify(Object.fromEntries(keys.map(k=>[k,value[k]])));
}

export function createExternalRevocationProofClient({
  authorityId,authorityPublicKey,transport,clock
}={}){
  if(!ISSUER.test(authorityId)||!(authorityPublicKey instanceof KeyObject)||
     authorityPublicKey.type!=='public'||
     authorityPublicKey.asymmetricKeyType!=='ed25519'||
     !Object.isFrozen(transport)||typeof transport.read!=='function'||
     typeof transport.advanceCAS!=='function'||typeof clock!=='function')
    throw new TypeError('Pinned Ed25519 identity, frozen transport and clock required');
  let pending=false;
  const verifyResponse=(response,uid,challenge)=>{
    if(!response||typeof response!=='object'||!exact(response,['checkpoint','signature'])||
       typeof response.signature!=='string'||!SIG.test(response.signature))
      return reject('authority-response-invalid');
    let canonical;
    try{canonical=canonicalExternalRevocationProof(response.checkpoint);}
    catch{return reject('authority-record-invalid');}
    const r=response.checkpoint,now=clock();
    if(r.issuer!==authorityId||r.uid!==uid||r.challenge!==challenge)
      return reject('authority-identity-or-challenge-mismatch');
    if(!integer(now)||r.issuedAtMs>now+2000||r.issuedAtMs<now-30000||
       r.expiresAtMs<=now)
      return reject('authority-proof-expired');
    const sig=Buffer.from(response.signature,'base64url');
    if(sig.length!==64||!verify(null,Buffer.from(canonical),
      authorityPublicKey,sig))
      return reject('authority-signature-invalid');
    return Object.freeze({ok:true,uid,roleGeneration:r.roleGeneration,
      revokeTime:r.revokeTime});
  };
  const call=async(method,uid,request={})=>{
    if(process.env.FG_EXTERNAL_AUTHORITY_TEST!=='1'||
       process.env.FIREBASE_AUTH_EMULATOR_HOST!=='127.0.0.1:9099'||
       process.env.FIREBASE_DATABASE_EMULATOR_HOST!=='127.0.0.1:9000'||
       process.env.GCLOUD_PROJECT!=='demo-fg-auth-lifecycle')
      return reject('emulator-only');
    if(!UID.test(uid))return reject('invalid-uid');
    if(pending)return reject('authority-client-in-flight');
    pending=true;
    try{
      const challenge=randomBytes(16).toString('hex');
      let result;
      try{result=await transport[method]({uid,challenge,...request});}
      catch{return reject('authority-transport-unavailable');}
      return verifyResponse(result,uid,challenge);
    }finally{pending=false;}
  };
  return Object.freeze({
    snapshot:uid=>call('read',uid),
    async advance(uid,{expectedGeneration,expectedRevokeTime,
      nextGeneration,nextRevokeTime}={}){
      if(!integer(expectedGeneration)||expectedGeneration<1||
         !integer(expectedRevokeTime)||!integer(nextGeneration)||
         nextGeneration!==expectedGeneration+1||
         !integer(nextRevokeTime)||nextRevokeTime<expectedRevokeTime)
        return reject('invalid-advance-request');
      const out=await call('advanceCAS',uid,{
        expectedGeneration,expectedRevokeTime,
        nextGeneration,nextRevokeTime
      });
      if(!out.ok)return out;
      if(out.roleGeneration!==nextGeneration||
         out.revokeTime!==nextRevokeTime)
        return reject('authority-advance-not-confirmed');
      return out;
    }
  });
}
