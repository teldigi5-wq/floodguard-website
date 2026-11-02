// FloodGuard R3 — OFFLINE TEST CONTRACT ONLY: signed incident witness gate.
// This verifier has NO issuance/signing key, Firebase client, network, write,
// hardware, public publishing, gate control, or message-sending capability.
// A caller must supply an EXTERNALLY TRUSTED monotonic minimum epoch/revision.
// Values supplied from the same rollbackable Firebase node are NOT trusted floors.
import {verify, KeyObject} from 'node:crypto';
import {verifySyntheticPublicationAttestation}
  from './synthetic-publication-attestation.mjs';

const VERSION='floodguard-synthetic-incident-witness-v1';
const FIELDS=['version','deviceId','currentEpoch','revision','quarantined',
  'issuedAtMs','expiresAtMs','scope'];
const DEV=/^device-stage-[a-z0-9-]{1,32}$/;
const SIG=/^[A-Za-z0-9_-]{86}$/;
const MAX_TTL_MS=15000, FUTURE_MS=2000;
const integer=(x,min,max)=>Number.isSafeInteger(x)&&x>=min&&x<=max;
const obj=x=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&
  (Object.getPrototypeOf(x)===Object.prototype||
   Object.getPrototypeOf(x)===null);
const exact=x=>obj(x)&&Object.keys(x).length===FIELDS.length&&
  FIELDS.every(k=>Object.hasOwn(x,k));
const validKey=k=>k instanceof KeyObject&&k.type==='public'&&
  k.asymmetricKeyType==='ed25519';
const equalKey=(a,b)=>a.export({type:'spki',format:'der'})
  .equals(b.export({type:'spki',format:'der'}));

export function canonicalSyntheticIncidentWitness(value) {
  if(!exact(value)||value.version!==VERSION||
     typeof value.deviceId!=='string'||!DEV.test(value.deviceId)||
     !integer(value.currentEpoch,1,10000)||
     !integer(value.revision,1,2147483647)||
     typeof value.quarantined!=='boolean'||
     !integer(value.issuedAtMs,0,Number.MAX_SAFE_INTEGER)||
     !integer(value.expiresAtMs,value.issuedAtMs+1,
       Number.MAX_SAFE_INTEGER)||
     value.expiresAtMs-value.issuedAtMs>MAX_TTL_MS||
     value.scope!=='SYNTHETIC_INCIDENT_READ_ONLY')
    throw new TypeError('Invalid offline incident witness claim');
  return JSON.stringify(Object.fromEntries(FIELDS.map(k=>[k,value[k]])));
}

/**
 * Checks the existing signed database attestation AND an independently signed
 * incident claim against caller-owned anti-rollback floors. Fail closed.
 * This does NOT independently obtain/persist trusted floors or guarantee
 * separate key custody, live physical telemetry or safe cloud publication.
 */
export function verifyWitnessGatedSyntheticPublication({
  attestation,attestationSignature,attestorPublicKey,receipt,
  incidentWitness,incidentSignature,witnessPublicKey,
  trustedMinimumEpoch,trustedMinimumRevision,nowMs
}={}) {
  if(process.env.FG_R3_WITNESS_CONTRACT_TEST!=='1'||
     !integer(nowMs,0,Number.MAX_SAFE_INTEGER)||
     !integer(trustedMinimumEpoch,1,10000)||
     !integer(trustedMinimumRevision,1,2147483647)||
     !validKey(attestorPublicKey)||!validKey(witnessPublicKey)||
     equalKey(attestorPublicKey,witnessPublicKey)||
     typeof incidentSignature!=='string'||!SIG.test(incidentSignature))
    return false;
  try {
    const signed=canonicalSyntheticIncidentWitness(incidentWitness);
    if(incidentWitness.quarantined!==false||
       incidentWitness.currentEpoch<trustedMinimumEpoch||
       incidentWitness.revision<trustedMinimumRevision||
       incidentWitness.issuedAtMs>nowMs+FUTURE_MS||
       incidentWitness.issuedAtMs<nowMs-MAX_TTL_MS||
       incidentWitness.expiresAtMs<=nowMs||
       !obj(attestation)||
       attestation.deviceId!==incidentWitness.deviceId||
       attestation.epoch!==incidentWitness.currentEpoch)
      return false;
    const decoded=Buffer.from(incidentSignature,'base64url');
    if(decoded.length!==64||
       !verify(null,Buffer.from(signed),witnessPublicKey,decoded))
      return false;
    return verifySyntheticPublicationAttestation({
      attestation,signature:attestationSignature,publicKey:attestorPublicKey,
      receipt,nowMs
    });
  }catch {return false;}
}
