// FloodGuard device-transport migration PREFLIGHT, not ESP8266 firmware.
// Sends an externally PRE-SIGNED synthetic envelope to a real, localhost-only
// certificate-validated TLS endpoint. Does not sign, provision keys, open a
// public listener, write Firebase, issue a cloud ACK, delete a queue item,
// control an alarm/gate, or perform a background retry.
import https from 'node:https';
import {canonicalOfflineEnvelope} from './stage7-durable-ingress.mjs';
import {LOOPBACK_INGEST_PATH} from './loopback-signed-https-ingress.mjs';

const SIG=/^[A-Za-z0-9_-]{86}$/;
const MAX_RESPONSE=512;
const success=(kind,httpStatus)=>Object.freeze({
  outcome:kind,httpStatus,localAdmissionOnly:true,
  cloudConfirmed:false,canAcknowledge:false,canDequeue:false,
  notificationDelivered:false,gatePositionVerified:false
});
const notSuccess=(outcome,httpStatus=null)=>Object.freeze({
  outcome,httpStatus,localAdmissionOnly:false,
  cloudConfirmed:false,canAcknowledge:false,canDequeue:false,
  notificationDelivered:false,gatePositionVerified:false
});
const exact=(v,fields)=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&
  Object.getPrototypeOf(v)===Object.prototype&&
  Object.keys(v).length===fields.length&&
  fields.every(k=>Object.hasOwn(v,k));
/**
 * No automatic retry: the same immutable signed frame and sequence MUST be
 * retained until an independent operator-approved recovery protocol exists.
 * In particular, a 409 could mean an accepted prior upload but is not a
 * durable cloud confirmation. 201 is a durable *local* receipt only.
 *
 * Fixed 127.0.0.1 transport/localhost SAN for test certificates. Do NOT
 * change to a public host or port without designing a separate production
 * endpoint, credential provisioning, CA rotation and rate limits.
 */
export async function postSignedLoopbackFramePreflight({
  port,caPem,envelope,signature,timeoutMs=2000
}={}){
  if(!Number.isSafeInteger(port)||port<1||port>65535||
     !(typeof caPem==='string'||Buffer.isBuffer(caPem))||
     !String(caPem).includes('-----BEGIN CERTIFICATE-----')||
     !Number.isSafeInteger(timeoutMs)||timeoutMs<100||timeoutMs>10000||
     typeof signature!=='string'||!SIG.test(signature))
    return notSuccess('INVALID_PREFLIGHT_CONFIGURATION');
  let canonical;
  try{canonical=canonicalOfflineEnvelope(envelope);}
  catch{return notSuccess('INVALID_SIGNED_FRAME');}
  const body=JSON.stringify({envelope:JSON.parse(canonical),signature});
  if(Buffer.byteLength(body)>1024)return notSuccess('INVALID_SIGNED_FRAME');
  return new Promise(resolve=>{
    let settled=false;
    const finish=result=>{
      if(settled)return;
      settled=true;
      resolve(result);
    };
    const req=https.request({
      host:'127.0.0.1',port,servername:'localhost',
      method:'POST',path:LOOPBACK_INGEST_PATH,
      ca:caPem,rejectUnauthorized:true,agent:false,
      minVersion:'TLSv1.2',
      headers:{
        'content-type':'application/json',
        'content-length':Buffer.byteLength(body),
        'cache-control':'no-store'
      }
    },res=>{
      let total=0;
      const chunks=[];
      res.on('data',chunk=>{
        total+=chunk.length;
        if(total>MAX_RESPONSE){
          // An oversized response is never treated as an admission receipt.
          req.destroy();
          finish(notSuccess('UNVERIFIED_RESPONSE',res.statusCode));
          return;
        }
        chunks.push(chunk);
      });
      res.once('aborted',()=>finish(notSuccess('RETRY_UNCERTAIN')));
      res.once('end',()=>{
        let payload;
        try{payload=JSON.parse(Buffer.concat(chunks).toString('utf8'));}
        catch{finish(notSuccess('UNVERIFIED_RESPONSE',res.statusCode));return;}
        if(!exact(payload,['accepted','status'])||
           typeof payload.accepted!=='boolean'||
           typeof payload.status!=='string'){
          finish(notSuccess('UNVERIFIED_RESPONSE',res.statusCode));return;
        }
        if(res.statusCode===201&&payload.accepted===true&&
           payload.status==='LOCAL_DURABLE_ADMISSION_ONLY'){
          finish(success('LOCAL_DURABLE_ONLY',201));return;
        }
        if(res.statusCode===409&&payload.accepted===false&&
           payload.status==='replay-or-identity-mismatch'){
          // A replay response DOES NOT authorize deleting an old reading.
          finish(notSuccess('DUPLICATE_OR_IDENTITY_CONFLICT',409));return;
        }
        if([400,403,404,413,415,422].includes(res.statusCode)&&
           payload.accepted===false){
          finish(notSuccess('REJECTED_NO_FORWARD',res.statusCode));return;
        }
        if(res.statusCode===503&&payload.accepted===false){
          finish(notSuccess('RETRY_UNCERTAIN',503));return;
        }
        finish(notSuccess('UNVERIFIED_RESPONSE',res.statusCode));
      });
    });
    req.on('error',e=>{
      // Never expose raw TLS diagnostics or certificate content to UIs/logs.
      const code=String(e?.code||'');
      const tlsErrors=new Set([
        'DEPTH_ZERO_SELF_SIGNED_CERT','SELF_SIGNED_CERT_IN_CHAIN',
        'UNABLE_TO_VERIFY_LEAF_SIGNATURE','UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
        'ERR_TLS_CERT_ALTNAME_INVALID','CERT_HAS_EXPIRED',
        'ERR_TLS_INVALID_PROTOCOL_VERSION','ERR_SSL_WRONG_VERSION_NUMBER'
      ]);
      finish(notSuccess(tlsErrors.has(code)?'TLS_TRUST_FAILURE':'RETRY_UNCERTAIN'));
    });
    req.setTimeout(timeoutMs,()=>req.destroy(Error('local-preflight-deadline')));
    req.end(body);
  });
}
