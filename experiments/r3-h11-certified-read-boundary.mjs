// FloodGuard R3 H11: SYNTHETIC read-side containment of privileged DB forgery.
// A verified signature + exact DB record + separately supplied witness state
// is required to present even a lab-certified status. NEVER a physical SAFE.
// The signer/reader/witness are injected test doubles, not independent custody.
// No Firebase SDK, network, cloud credentials, filesystem, gate or alarm I/O.
import {KeyObject,sign,verify} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';

const ID='device-stage-a',VERSION='floodguard-r3-h11-water-certificate-v1';
const DOMAIN='floodguard-r3-h11-certified-view-v1\n';
const FIELDS=['version','deviceId','epoch','authorityRevision',
  'signerGeneration','sequence','digest','status','distanceCm','levelCm',
  'observedAtMs','issuedAtMs','expiresAtMs'];
const RISK=new Set(['SAFE','WARNING','DANGER','SENSOR_ERROR']);
const HEX=/^[0-9a-f]{64}$/;
const int=(v,min,max)=>Number.isSafeInteger(v)&&v>=min&&v<=max;
const obj=(v)=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&
  (Object.getPrototypeOf(v)===Object.prototype||
   Object.getPrototypeOf(v)===null);
const exact=(v,keys)=>obj(v)&&Object.keys(v).length===keys.length&&
  keys.every(k=>Object.hasOwn(v,k));
const key=(v,type)=>v instanceof KeyObject&&v.type===type&&
  v.asymmetricKeyType==='ed25519';
const denied=reason=>Object.freeze({
  verified:false,reason,releaseDecision:'NO_GO',
  canDeclareSafe:false,canOperateGate:false,canSendAlert:false,
  physicalSourceVerified:false
});
const nowValue=clock=>{
  const n=clock();
  if(!int(n,946684800000,Number.MAX_SAFE_INTEGER))
    throw Error('unreliable-clock');
  return n;
};
function validateCertificate(c){
  if(!exact(c,FIELDS)||c.version!==VERSION||c.deviceId!==ID||
    c.epoch!==1||!int(c.authorityRevision,1,2147483647)||
    !int(c.signerGeneration,1,10000)||
    !int(c.sequence,2,2147483647)||!HEX.test(c.digest)||
    !RISK.has(c.status)||
    typeof c.distanceCm!=='number'||!Number.isFinite(c.distanceCm)||
    c.distanceCm<=0||c.distanceCm>25||
    typeof c.levelCm!=='number'||!Number.isFinite(c.levelCm)||
    c.levelCm<0||c.levelCm>25||
    !int(c.observedAtMs,946684800000,Number.MAX_SAFE_INTEGER)||
    !int(c.issuedAtMs,946684800000,Number.MAX_SAFE_INTEGER)||
    !int(c.expiresAtMs,c.issuedAtMs+1,c.issuedAtMs+4000))
    throw Error('noncanonical-certificate');
  return c;
}
export function canonicalH11Certificate(c){
  validateCertificate(c);
  return DOMAIN+JSON.stringify(Object.fromEntries(FIELDS.map(k=>[k,c[k]])));
}
function validNode(node){
  return exact(node,['control','current','checkpoint'])&&
    exact(node.control,['epoch','blocked','revision','device','publisher','issuer'])&&
    node.control.epoch===1&&node.control.blocked===false&&
    int(node.control.revision,1,2147483647)&&
    exact(node.control.device,['enabled','scope'])&&
    node.control.device.enabled===true&&
    node.control.device.scope==='prototype-ingest-v1'&&
    exact(node.control.publisher,['enabled','deviceId','epoch','scope'])&&
    node.control.publisher.enabled===true&&
    node.control.publisher.deviceId===ID&&
    node.control.publisher.epoch===1&&
    node.control.publisher.scope==='publication-lab-water-v1'&&
    exact(node.control.issuer,['enabled','generation','scope'])&&
    node.control.issuer.enabled===true&&
    int(node.control.issuer.generation,1,10000)&&
    node.control.issuer.scope==='lab-signed-admission-v1'&&
    exact(node.current,['distanceCm','levelCm','status','observedAtMs','overallRisk'])&&
    node.current.overallRisk==='UNKNOWN'&&
    exact(node.checkpoint,['initialized','deviceId','epoch','sequence','digest','observedAtMs'])&&
    node.checkpoint.initialized===true&&node.checkpoint.deviceId===ID&&
    node.checkpoint.epoch===1&&int(node.checkpoint.sequence,2,2147483647)&&
    typeof node.checkpoint.digest==='string'&&HEX.test(node.checkpoint.digest)&&
    node.checkpoint.observedAtMs===node.current.observedAtMs;
}
function binds(c,node){
  return c.epoch===node.control.epoch&&
    c.authorityRevision===node.control.revision&&
    c.signerGeneration===node.control.issuer.generation&&
    c.sequence===node.checkpoint.sequence&&
    c.digest===node.checkpoint.digest&&
    c.status===node.current.status&&
    c.distanceCm===node.current.distanceCm&&
    c.levelCm===node.current.levelCm&&
    c.observedAtMs===node.current.observedAtMs;
}
function fresh(c,now){
  return c.issuedAtMs<=now+2000&&now<=c.expiresAtMs&&
    c.observedAtMs>=now-30000&&c.observedAtMs<=now+2000&&
    c.observedAtMs<=c.issuedAtMs+2000;
}
// This certifier is an offline rehearsal. Only a separately protected
// signer AND trusted H4 issuer could make its certificates authoritative.
export function createH11LabCertifier({
  issuer,readPublication,signerPrivateKey,clock
}={}){
  if(!issuer||!Object.isFrozen(issuer)||typeof issuer.issue!=='function'||
    typeof readPublication!=='function'||!key(signerPrivateKey,'private')||
    typeof clock!=='function')
    throw TypeError('Trusted H4 issuer, read-only observation and separate signing key required');
  return Object.freeze({
    async certify(evidence){
      try{
        const before=await readPublication();
        if(!validNode(before))return denied('canonical-control-or-record-invalid');
        const approved=await issuer.issue(evidence); // existing 3 signatures
        if(approved?.issued!==true||approved.releaseDecision!=='NO_GO'||
          approved.canWriteFirebase!==false||approved.canPublish!==false||
          !exact(approved.candidate,['current','checkpoint']))
          return denied('three-signer-refused');
        const after=await readPublication();
        if(!isDeepStrictEqual(after,before)||!validNode(after))
          return denied('publication-or-authorization-changed');
        if(!isDeepStrictEqual(after.current,approved.candidate.current)||
          !isDeepStrictEqual(after.checkpoint,approved.candidate.checkpoint))
          return denied('publication-not-bound-to-signed-source');
        const at=nowValue(clock);
        const c=Object.freeze({
          version:VERSION,deviceId:ID,
          epoch:after.control.epoch,
          authorityRevision:after.control.revision,
          signerGeneration:after.control.issuer.generation,
          sequence:after.checkpoint.sequence,digest:after.checkpoint.digest,
          status:after.current.status,
          distanceCm:after.current.distanceCm,
          levelCm:after.current.levelCm,
          observedAtMs:after.current.observedAtMs,
          issuedAtMs:at,expiresAtMs:at+4000
        });
        if(!fresh(c,at))return denied('observation-stale');
        const signature=sign(null,Buffer.from(canonicalH11Certificate(c)),
          signerPrivateKey).toString('base64url');
        return Object.freeze({certified:true,certificate:c,signature,
          kind:'SYNTHETIC_SIGNED_VIEW_ONLY',releaseDecision:'NO_GO',
          canDeclareSafe:false,canSendAlert:false,canOperateGate:false,
          physicalSourceVerified:false});
      }catch{return denied('certification-unavailable-or-uncertain');}
    }
  });
}
function validAnchor(anchor){
  return exact(anchor,['witness','signer'])&&
    exact(anchor.witness,['revision','head','epoch','quarantined',
      'sequence','digest','pending','releaseDecision'])&&
    int(anchor.witness.revision,1,2147483647)&&
    typeof anchor.witness.head==='string'&&HEX.test(anchor.witness.head)&&
    anchor.witness.epoch===1&&anchor.witness.quarantined===false&&
    anchor.witness.pending===null&&
    int(anchor.witness.sequence,1,2147483647)&&
    typeof anchor.witness.digest==='string'&&HEX.test(anchor.witness.digest)&&
    anchor.witness.releaseDecision==='NO_GO'&&
    exact(anchor.signer,['enabled','generation','scope'])&&
    anchor.signer.enabled===true&&
    int(anchor.signer.generation,1,10000)&&
    anchor.signer.scope==='h11-signed-readback-v1';
}
export function createH11LabConsumer({
  verifierPublicKey,readPublication,readIndependentAnchor,clock
}={}){
  if(!key(verifierPublicKey,'public')||typeof readPublication!=='function'||
    typeof readIndependentAnchor!=='function'||typeof clock!=='function')
    throw TypeError('Pinned verification key, read-only publication and external witness required');
  return Object.freeze({
    async inspect(proof){
      try{
        if(!exact(proof,['certificate','signature'])||
          typeof proof.signature!=='string'||
          !/^[A-Za-z0-9_-]{86}$/.test(proof.signature))
          return denied('certificate-shape-invalid');
        const c=validateCertificate(proof.certificate);
        if(!verify(null,Buffer.from(canonicalH11Certificate(c)),
          verifierPublicKey,Buffer.from(proof.signature,'base64url')))
          return denied('certificate-signature-invalid');
        const before=await readIndependentAnchor();
        if(!validAnchor(before)||before.witness.epoch!==c.epoch||
          before.witness.sequence!==c.sequence||
          before.witness.digest!==c.digest||
          before.signer.generation!==c.signerGeneration)
          return denied('independent-witness-or-key-refused');
        const n=nowValue(clock);
        if(!fresh(c,n))return denied('expired-or-stale-observation');
        const node=await readPublication();
        if(!validNode(node)||!binds(c,node))
          return denied('privileged-database-value-untrusted');
        const after=await readIndependentAnchor();
        const later=nowValue(clock);
        if(!isDeepStrictEqual(before,after)||!validAnchor(after)||
          later<n||later>n+2000||!fresh(c,later))
          return denied('authority-changed-during-read');
        // Even a correctly signed SAFE *label* does not establish real sensor
        // calibration, current physical safety, or permission to move a gate.
        return Object.freeze({
          verified:true,kind:'LAB_SIGNED_TELEMETRY_NOT_PHYSICAL_SAFETY',
          signedStatus:c.status,sequence:c.sequence,digest:c.digest,
          releaseDecision:'NO_GO',canDeclareSafe:false,
          canSendAlert:false,canOperateGate:false,
          physicalSourceVerified:false
        });
      }catch{return denied('verification-unavailable-or-uncertain');}
    }
  });
}
