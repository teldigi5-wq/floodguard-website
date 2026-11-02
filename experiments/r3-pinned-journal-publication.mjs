// Offline-only composition: authenticated incident journal + existing synthetic
// dual-signature publication verifier. No publisher, network or key custody.
import {KeyObject} from 'node:crypto';
import {verifyExternallyPinnedSyntheticIncidentJournal}
  from './r3-anchored-incident-journal.mjs';
import {verifyWitnessGatedSyntheticPublication}
  from './r3-witness-gated-publication.mjs';

const validKey=k=>k instanceof KeyObject&&k.type==='public'&&
  k.asymmetricKeyType==='ed25519';
const distinct=keys=>keys.every((a,i)=>keys.every((b,j)=>i===j||
  !a.export({type:'spki',format:'der'}).equals(
    b.export({type:'spki',format:'der'}))));

export function verifyPinnedJournalGatedSyntheticPublication({
  journal,publication
}={}) {
  if(!journal||!publication||typeof journal!=='object'||
     typeof publication!=='object')return false;
  try {
    const keys=[journal.journalPublicKey,journal.checkpointPublicKey,
      publication.attestorPublicKey,publication.witnessPublicKey];
    if(!keys.every(validKey)||!distinct(keys))return false;
    const proof=verifyExternallyPinnedSyntheticIncidentJournal(journal);
    if(!proof||proof.quarantined||
       publication.incidentWitness?.deviceId!==proof.deviceId||
       publication.incidentWitness?.currentEpoch!==proof.trustedMinimumEpoch||
       publication.incidentWitness?.revision!==proof.trustedMinimumRevision||
       publication.incidentWitness?.quarantined!==false||
       publication.nowMs!==journal.nowMs)return false;
    return verifyWitnessGatedSyntheticPublication({
      ...publication,
      trustedMinimumEpoch:proof.trustedMinimumEpoch,
      trustedMinimumRevision:proof.trustedMinimumRevision
    });
  }catch{return false;}
}
