// Isolated LOCALHOST-ONLY HTTPS ingress adapter for authenticated transport tests.
// Does not create a listener, provision production identity, connect Firebase,
// publish a reading, actuate hardware, or send notifications.
// Callers MUST bind a separately reviewed TLS server to 127.0.0.1/::1 only.
import {createHash,verify,KeyObject} from 'node:crypto';
import {canonicalOfflineEnvelope} from './stage7-durable-ingress.mjs';

const PATH='/synthetic/v1/ingest';
const MAX_BODY=1024;
const MAX_SEQUENCE=2147483647;
const DEVICE=/^device-stage-[a-z0-9-]{1,32}$/;
// A deliberately precommitted HMAC-sealed record makes prior ledger loss
// distinguishable from a legitimate first device reading after restart.
export const REPLAY_LEDGER_BOOTSTRAP_DEVICE='device-stage-bootstrap';
export const REPLAY_LEDGER_BOOTSTRAP_FINGERPRINT='f'.repeat(64);
const SIG=/^[A-Za-z0-9_-]{86}$/;
const local=address=>address==='127.0.0.1'||address==='::1'
  ||address==='::ffff:127.0.0.1';
const record=x=>x!==null&&typeof x==='object'&&!Array.isArray(x)
  &&Object.getPrototypeOf(x)===Object.prototype;
const exact=(x,names)=>record(x)&&Object.keys(x).length===names.length
  &&names.every(k=>Object.hasOwn(x,k));
const validClock=ms=>Number.isSafeInteger(ms)&&ms>=0;
function respond(res,status,kind){
  if(res.headersSent||res.destroyed)return;
  const payload=JSON.stringify({accepted:status===201,status:kind});
  res.writeHead(status,{'content-type':'application/json; charset=utf-8',
    'cache-control':'no-store','content-length':Buffer.byteLength(payload)});
  res.end(payload);
}
function fingerprint(publicKey){
  return createHash('sha256').update(publicKey.export({format:'der',type:'spki'})).digest('hex');
}
/**
 * identities: operator-supplied Map UID -> {publicKey,epoch,scope,enabled}.
 * No HTTP route can create/revoke a binding. Registry MUST come from an
 * independently secured, durable operator store before real-world use.
 * ledger: Stage 7 synthetic HMAC-sealed offline sequence ledger.
 * ledgerAvailable: independently supplied readiness check; when it cannot
 * establish that replay history exists, all ingress must fail closed.
 */
export function createLoopbackSignedIngressHandler({
  identities,ledger,ledgerAvailable,clock=Date.now,bodyReadDeadlineMs=10000
}={}) {
  if(!(identities instanceof Map)||!ledger||
     typeof ledger.commit!=='function'||typeof ledger.last!=='function'||
     typeof ledgerAvailable!=='function'||typeof clock!=='function')
    throw new TypeError('Explicit identity, sequence ledger and readiness required');
  if(!Number.isSafeInteger(bodyReadDeadlineMs)||
     bodyReadDeadlineMs<50||bodyReadDeadlineMs>30000)
    throw new RangeError('Bounded synthetic body-read deadline required');

  return async function localIngress(req,res){
    // No reliance on X-Forwarded-For, X-Forwarded-Proto or request body for TLS.
    if(req.socket.encrypted!==true||!local(req.socket.localAddress)||
       !local(req.socket.remoteAddress)){
      respond(res,403,'local-tls-required');return;
    }
    if(req.method!=='POST'||req.url!==PATH){
      respond(res,404,'unsupported-route');return;
    }
    if(req.headers['content-type']!=='application/json'){
      respond(res,415,'unsupported-media-type');return;
    }
    const len=req.headers['content-length'];
    if(len!==undefined&&(!/^\d+$/.test(len)||Number(len)>MAX_BODY)){
      respond(res,413,'request-too-large');return;
    }
    const now=clock();
    if(!validClock(now)){
      respond(res,503,'clock-unavailable');return;
    }
    try{
      if(await ledgerAvailable()!==true){
        respond(res,503,'replay-ledger-unavailable');return;
      }
      const bootstrap=ledger.last(REPLAY_LEDGER_BOOTSTRAP_DEVICE);
      if(!bootstrap||bootstrap.epoch!==1||bootstrap.sequence!==1||
         bootstrap.keyFingerprint!==REPLAY_LEDGER_BOOTSTRAP_FINGERPRINT){
        respond(res,503,'replay-ledger-unavailable');return;
      }
    }catch{
      respond(res,503,'replay-ledger-unavailable');return;
    }

    let total=0,body;
    // A verified TLS client can still stall an incomplete chunked upload.
    // Enforce an absolute body-read deadline, not a resettable idle timeout.
    // On deadline close the incomplete socket; no ledger commit is possible.
    const deadline=setTimeout(()=>{
      if(!req.destroyed)req.destroy(new Error('synthetic-body-read-deadline'));
    },bodyReadDeadlineMs);
    try{
      const chunks=[];
      for await(const chunk of req){
        total+=chunk.length;
        if(total>MAX_BODY){
          respond(res,413,'request-too-large');return;
        }
        chunks.push(chunk);
      }
      body=JSON.parse(Buffer.concat(chunks).toString('utf8'));
    }catch{
      // Destroyed requests cannot reliably receive an HTTP error response.
      // The client must treat a connection reset as an unacknowledged write.
      respond(res,400,'invalid-request');return;
    }finally{
      clearTimeout(deadline);
    }
    if(!exact(body,['envelope','signature'])||typeof body.signature!=='string'||
       !SIG.test(body.signature)){
      respond(res,400,'invalid-request');return;
    }
    let canonical;
    try{canonical=canonicalOfflineEnvelope(body.envelope);}
    catch{respond(res,422,'invalid-frame');return;}
    const deviceId=body.envelope.deviceId;
    if(!DEVICE.test(deviceId)||deviceId===REPLAY_LEDGER_BOOTSTRAP_DEVICE){
      respond(res,403,'device-not-authorized');return;
    }
    const binding=identities.get(deviceId);
    if(!binding||binding.enabled!==true||
       binding.scope!=='prototype-ingest-v1'||
       binding.epoch!==body.envelope.epoch||
       !(binding.publicKey instanceof KeyObject)||
       binding.publicKey.type!=='public'||
       binding.publicKey.asymmetricKeyType!=='ed25519'){
      respond(res,403,'device-not-authorized');return;
    }
    if(body.envelope.observedAtMs<now-30000 ||
       body.envelope.observedAtMs>now+2000){
      respond(res,422,'field-clock-unverified');return;
    }
    const signature=Buffer.from(body.signature,'base64url');
    if(signature.length!==64||
      !verify(null,Buffer.from(canonical,'utf8'),binding.publicKey,signature)){
      respond(res,403,'device-signature-invalid');return;
    }
    // At this point only source signature, frame shape, bounded clock and
    // test replay ledger are verified. No Firebase/database commitment exists.
    try{
      const previous=ledger.last(deviceId); // fail on corrupt/unreadable ledger
      if(previous&&(
        previous.epoch!==binding.epoch||
        previous.keyFingerprint!==fingerprint(binding.publicKey)||
        body.envelope.frame.sequence<=previous.sequence)){
        respond(res,409,'replay-or-identity-mismatch');return;
      }
      if(!Number.isSafeInteger(body.envelope.frame.sequence)||
         body.envelope.frame.sequence<1||
         body.envelope.frame.sequence>MAX_SEQUENCE){
        respond(res,422,'invalid-sequence');return;
      }
      const committed=ledger.commit({
        uid:deviceId,epoch:binding.epoch,
        sequence:body.envelope.frame.sequence,
        keyFingerprint:fingerprint(binding.publicKey)
      });
      if(!committed.accepted){
        respond(res,409,'replay-or-identity-mismatch');return;
      }
      respond(res,201,'LOCAL_LEDGER_ACCEPTED_ONLY');
    }catch{
      respond(res,503,'replay-ledger-unavailable');
    }
  };
}
export const LOOPBACK_INGEST_PATH=PATH;
