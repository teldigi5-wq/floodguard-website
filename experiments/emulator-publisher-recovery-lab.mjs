// FloodGuard R2/R3 — ACTUAL RTDB EMULATOR publishing/recovery orchestration.
// This module has no Firebase SDK, auth credentials, network endpoints, key
// issuer, external witness writer, queue ACK/dequeue, notifications or gate API.
// Its injected database adapter must be a disposable EMULATOR test fixture;
// never wire into an Admin production root transaction.
import {KeyObject} from 'node:crypto';
import {deriveHistoricalAtomicWaterStateLab}
  from './immutable-publication-history-lab.mjs';
import {observeHistoricalOutboxRecordLab}
  from './historical-outbox-observer-lab.mjs';

const UID=/^device-stage-[a-z0-9-]{1,32}$/;
const deny=(status,reason)=>Object.freeze({
  status,reason,canAcknowledge:false,publicationDelivery:'NOT_PROVEN',
  notificationDelivery:'NOT_VERIFIED',physicalGatePosition:'UNVERIFIED'
});
const positive=(status,pending)=>Object.freeze({
  status,sequence:pending.sequence,digest:pending.digest,
  canAcknowledge:false,publicationDelivery:'EMULATOR_READBACK_ONLY',
  notificationDelivery:'NOT_VERIFIED',physicalGatePosition:'UNVERIFIED'
});
const key=k=>k instanceof KeyObject&&k.type==='public'&&
  k.asymmetricKeyType==='ed25519';

/**
 * Intended call order: validate source outbox -> independent DB read ->
 * transaction candidate -> INDEPENDENT DB readback. No returned "committed"
 * flag, signing assertion or transaction callback result is trusted as proof.
 *
 * database.readRoot must use an independently protected emulator read;
 * database.transactionRoot must atomically commit only if it accepts the
 * callback output. The adapter methods are NOT accepted from HTTP clients.
 *
 * No outbox acknowledgment, cleanup, compaction, witness issuance or
 * unrelated private field modification is authorized.
 */
export async function attemptRetainedPublicationLab({
  outbox,deviceId,sourceBinding,trustedReceiptKey,
  receipt,receiptSignature,database,nowMs
}={}) {
  if(typeof deviceId!=='string'||!UID.test(deviceId)||
     !outbox||typeof outbox.pending!=='function'||
     !database||database.disposableEmulatorOnly!==true||
     typeof database.readRoot!=='function'||
     typeof database.transactionRoot!=='function'||
     !key(sourceBinding?.publicKey)||!key(trustedReceiptKey)||
     !Number.isSafeInteger(nowMs)||nowMs<946684800000)
    return deny('DENIED','untrusted-or-non-emulator-dependencies');

  let pending;
  try {
    const entries=outbox.pending(deviceId);
    if(!Array.isArray(entries)||entries.length===0)
      return deny('DENIED','no-retained-signed-source');
    pending=entries[0]; // the oldest retained reading, never skip it
    if(!pending||pending.envelope?.deviceId!==deviceId)
      return deny('DENIED','retained-device-mismatch');
  }catch{return deny('UNAVAILABLE','local-outbox-unavailable');}

  const proof=root=>observeHistoricalOutboxRecordLab({
    pending,root,sourceBinding,trustedReceiptKey,nowMs
  });
  // Protect against replay after ambiguous prior commits before attempting
  // a second write. An old already-published record is still observable even
  // when the current public state has advanced.
  try {
    const original=await database.readRoot();
    if(proof(original).observed===true)
      return positive('ALREADY_RECORDED_NO_ACK',pending);
  }catch{return deny('UNAVAILABLE','database-preflight-read-unavailable');}

  let transactionResult=null,ambiguous=false,denial='candidate-rejected';
  try {
    transactionResult=await database.transactionRoot(current=>{
      const candidate=deriveHistoricalAtomicWaterStateLab({
        current,envelope:pending.envelope,receipt,
        signature:receiptSignature,trustedReceiptKey,nowMs
      });
      denial=candidate.reason||'candidate-rejected';
      return candidate.allowed===true?candidate.next:undefined;
    });
    if(!transactionResult||
       typeof transactionResult.committed!=='boolean')
      ambiguous=true;
  }catch{ambiguous=true;}

  // The only success criterion is independent matching read-back of signed,
  // source-authorized historical data, NOT a library commit flag. If the DB
  // response was lost after commit, the journal is preserved and a retry
  // safely observes the already recorded entry.
  let verification;
  try{verification=proof(await database.readRoot());}
  catch{return deny('UNAVAILABLE','database-readback-unavailable');}
  if(verification.observed===true)
    return positive(ambiguous?
      'AMBIGUOUS_COMMIT_READBACK_MATCH_NO_ACK':
      'PUBLISHED_READBACK_MATCH_NO_ACK',pending);
  if(ambiguous)
    return deny('UNCERTAIN','commit-result-ambiguous-and-unverified');
  if(transactionResult.committed===true)
    return deny('UNCERTAIN','transaction-claimed-commit-but-no-proof');
  return deny('DENIED',denial);
}
