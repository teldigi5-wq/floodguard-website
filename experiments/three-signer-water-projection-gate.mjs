// FloodGuard R3 — pure, OFFLINE-ONLY source/receipt/database attestation gate.
// The existing signed leaf planner accepts a caller-supplied DATABASE_CONFIRMED
// record; this stricter candidate requires THREE separate Ed25519 signers.
// No Firebase SDK, network, server, filesystem, secrets, alerts or actuators.
// Inputs are injected TEST evidence. A signature alone cannot prove that a
// real issuer independently queried a durable database or that the field
// sensor is physically authentic. This module never authorizes publishing.
import {createHash,KeyObject,verify} from 'node:crypto';
import {canonicalOfflineEnvelope} from './stage7-durable-ingress.mjs';
import {verifyStage8OfflineReceipt} from './stage8-ack-reconciliation.mjs';
import {verifySyntheticPublicationAttestation}
  from './synthetic-publication-attestation.mjs';
import {planSignedWaterLeafBridgeLab,SIGNED_WATER_LEAF_LAB_FIELDS,
  SIGNED_WATER_LEAF_LAB_ROOT} from './signed-water-leaf-bridge-lab.mjs';

const SIG=/^[A-Za-z0-9_-]{86}$/;
const HEX=/^[0-9a-f]{64}$/;
const obj=x=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&
  (Object.getPrototypeOf(x)===Object.prototype||Object.getPrototypeOf(x)===null);
const exact=(x,fields)=>obj(x)&&Object.keys(x).length===fields.length&&
  fields.every(k=>Object.hasOwn(x,k));
const pubkey=k=>k instanceof KeyObject&&k.type==='public'&&k.asymmetricKeyType==='ed25519';
const fingerprint=k=>createHash('sha256').update(k.export({format:'der',type:'spki'})).digest('hex');
const denial=reason=>Object.freeze({
  planned:false,reason,canPublish:false,canAcknowledge:false,
  canSendAlert:false,canOperateGate:false,physicalSourceVerified:false
});
const verifyBytes=(bytes,signature,key)=>typeof signature==='string'&&SIG.test(signature)&&
  Buffer.from(signature,'base64url').length===64&&
  verify(null,Buffer.from(bytes,'utf8'),key,Buffer.from(signature,'base64url'));

/**
 * THREE trust roots are supplied by a future independently commissioned
 * authority, never from the incoming telemetry request. The boolean flags
 * are NOT live credentials or a runtime authorization system.
 *
 * Local synthetic positive results are five scalar leaf *proposals* only.
 * They can never create a Firebase write, signed ACK, public SAFE clearance
 * or physical UNO/servo operation. Lost publication state is terminal NO-GO.
 */
export function planThreeSignerWaterProjectionGate({
  envelope,deviceSignature,sourceBinding,receipt,receiptSignature,
  trustedReceiptKey,attestation,attestationSignature,
  trustedDatabaseIssuerKey,databaseRecord,lastPublished,nowMs
}={}) {
  try {
    if(!Number.isSafeInteger(nowMs)||nowMs<946684800000)
      return denial('clock-unavailable');
    if(!exact(sourceBinding,['deviceId','epoch','enabled','scope','publicKey'])||
       sourceBinding.deviceId!==envelope?.deviceId||
       sourceBinding.epoch!==envelope?.epoch||
       sourceBinding.enabled!==true||
       sourceBinding.scope!=='prototype-ingest-v1'||
       !pubkey(sourceBinding.publicKey)||
       !pubkey(trustedReceiptKey)||
       !pubkey(trustedDatabaseIssuerKey))
      return denial('trusted-authority-unavailable');
    // Separation of simulated authority roles: one signer cannot self-issue
    // source frames, acceptance receipts AND persistence attestations.
    const identities=[
      fingerprint(sourceBinding.publicKey),fingerprint(trustedReceiptKey),
      fingerprint(trustedDatabaseIssuerKey)
    ];
    if(new Set(identities).size!==3)
      return denial('signer-role-confusion');
    // No auto-commissioning via {initialized:false}, and no fallback when a
    // process restart lost the last verified publication checkpoint.
    if(!exact(lastPublished,['initialized','epoch','sequence','digest'])||
       lastPublished.initialized!==true||
       lastPublished.epoch!==envelope.epoch||
       !Number.isSafeInteger(lastPublished.sequence)||
       lastPublished.sequence<1||
       typeof lastPublished.digest!=='string'||!HEX.test(lastPublished.digest))
      return denial('publication-history-not-authoritative');
    const canonical=canonicalOfflineEnvelope(envelope);
    if(!verifyBytes(canonical,deviceSignature,sourceBinding.publicKey))
      return denial('source-signature-unverified');
    const digest=createHash('sha256').update(canonical,'utf8').digest('hex');
    const expected={
      deviceId:envelope.deviceId,epoch:envelope.epoch,
      sequence:envelope.frame.sequence,digest
    };
    if(!verifyStage8OfflineReceipt({
      receipt,signature:receiptSignature,publicKey:trustedReceiptKey,expected
    }))return denial('signed-acceptance-unverified');
    if(!verifySyntheticPublicationAttestation({
      attestation,signature:attestationSignature,
      publicKey:trustedDatabaseIssuerKey,receipt,nowMs
    }))return denial('independent-db-attestation-unverified');
    if(!exact(databaseRecord,['deviceId','epoch','sequence','digest','acceptedAtMs','status'])||
       databaseRecord.status!=='DATABASE_CONFIRMED'||
       Object.entries(expected).some(([k,v])=>databaseRecord[k]!==v)||
       databaseRecord.acceptedAtMs!==receipt.acceptedAtMs)
      return denial('database-claim-mismatch');
    // A matching user-provided record is never independently authenticated.
    // The separately signed issuer attestation must bind these same claims.
    if(Object.entries(expected).some(([k,v])=>attestation[k]!==v)||
       attestation.acceptedAtMs!==databaseRecord.acceptedAtMs)
      return denial('attestation-binding-mismatch');
    const plan=planSignedWaterLeafBridgeLab({
      envelope,receipt,signature:receiptSignature,
      trustedReceiptKey,registryBinding:{
        deviceId:sourceBinding.deviceId,epoch:sourceBinding.epoch,
        enabled:sourceBinding.enabled,scope:sourceBinding.scope
      },
      databaseRecord,lastPublished,nowMs
    });
    if(plan?.planned!==true||
       plan.root!==SIGNED_WATER_LEAF_LAB_ROOT||
       Object.keys(plan.proposedLeaves??{}).join('|')!==
         SIGNED_WATER_LEAF_LAB_FIELDS.join('|'))
      return denial('underlying-projection-refused');
    return Object.freeze({
      planned:true,kind:'OFFLINE_THREE_SIGNER_LEAF_PROPOSAL_NOT_PUBLISHED',
      root:SIGNED_WATER_LEAF_LAB_ROOT,
      proposedLeaves:plan.proposedLeaves,
      nextCheckpoint:plan.nextCheckpoint,
      signedEvidence:'SYNTHETIC_AUTHORITIES_ONLY',
      canPublish:false,canAcknowledge:false,canSendAlert:false,
      canOperateGate:false,physicalSourceVerified:false,
      floodClearance:'UNKNOWN',physicalGatePosition:'UNVERIFIED'
    });
  }catch{
    return denial('invalid-evidence');
  }
}
