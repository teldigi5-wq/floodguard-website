// R3 H7: offline coordinator preserving the already-reviewed H4 three-signer
// verification before an H7 monotonic witness reservation. NO I/O/real commit.
export function createH7OfflineCoordinator({issuer,witness}={}){
  if(!issuer||!Object.isFrozen(issuer)||typeof issuer.issue!=='function'||
     !witness||!Object.isFrozen(witness)||
     typeof witness.snapshot!=='function'||
     typeof witness.reserve!=='function')
    throw TypeError('Frozen H4 issuer and H7 witness capabilities required');
  return Object.freeze({
    async prepare(signedEvidence){
      try{
        const prior=witness.snapshot(); // externally anchored, fail closed
        if(prior.quarantined||prior.pending!==null)
          return Object.freeze({ok:false,reason:'incident-or-unresolved',
            releaseDecision:'NO_GO'});
        const result=await issuer.issue(signedEvidence); // mandatory Ed25519
        if(result?.issued!==true||result.canPublish!==false||
           result.canWriteFirebase!==false||
           result.releaseDecision!=='NO_GO')
          return Object.freeze({ok:false,reason:'three-signer-refused',
            releaseDecision:'NO_GO'});
        return witness.reserve({
          candidate:result,expected:{
            revision:prior.revision,head:prior.head
          }
        }); // holds witness file lock and CAS checks
      }catch{
        return Object.freeze({ok:false,reason:'unavailable-or-uncertain',
          releaseDecision:'NO_GO'});
      }
    }
  });
}
