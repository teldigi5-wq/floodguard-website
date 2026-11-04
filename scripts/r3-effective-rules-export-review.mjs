// FloodGuard R3 — compare a privately supplied RTDB Rules export to the
// reviewed repository candidate. OFFLINE ONLY: no cloud, credentials,
// database data, network, writes, or release authorization.
// A matching file is NOT proof that Firebase actually served these Rules.
import fs from 'node:fs';
import {constants} from 'node:fs';
import path from 'node:path';
import {isDeepStrictEqual} from 'node:util';
import {pathToFileURL} from 'node:url';
import {assessAuthorityPreflight} from './r3-real-authority-preflight.mjs';

const MAX_EXPORT_BYTES=128*1024;
const deny=(reason,candidateMatches=false,reviewed=false)=>Object.freeze({
  reason,
  releaseDecision:'NO_GO',
  operatorExportProvided:true,
  authenticatedCloudExport:false,
  effectiveFirebaseRulesVerified:false,
  realAuthorizationVerified:false,
  repoCandidateMatchesExport:candidateMatches,
  offlineRuleShapeReviewed:reviewed,
  mayDeploy:false,mayChangeRules:false,maySendAlert:false,
  mayOperateGate:false,mayApproveRelease:false
});
export function assessOperatorRulesExport(operatorExport,repositoryCandidate,manifest){
  if(!operatorExport||typeof operatorExport!=='object'||
     Array.isArray(operatorExport)||!Object.hasOwn(operatorExport,'rules'))
    return deny('OPERATOR_RULES_EXPORT_INVALID');
  // Reuse the H10 offline rule-scope review, not a second, less restrictive
  // interpretation. This is structural analysis, NOT evaluated Auth/IAM.
  const inspected=assessAuthorityPreflight(manifest,operatorExport);
  if(inspected.reviewValid!==true)
    return deny('OPERATOR_EXPORT_FAILS_REVIEWED_RULE_SCOPE');
  if(!isDeepStrictEqual(operatorExport,repositoryCandidate))
    return deny('OPERATOR_EXPORT_DIFFERS_FROM_REPO_CANDIDATE',false,true);
  return deny('MATCHES_REPO_CANDIDATE_BUT_CLOUD_PROVENANCE_UNVERIFIED',true,true);
}
const safeResult=(reason)=>Object.freeze({
  reason,releaseDecision:'NO_GO',operatorExportProvided:false,
  authenticatedCloudExport:false,effectiveFirebaseRulesVerified:false,
  realAuthorizationVerified:false,repoCandidateMatchesExport:false,
  offlineRuleShapeReviewed:false,mayDeploy:false,mayChangeRules:false,
  maySendAlert:false,mayOperateGate:false,mayApproveRelease:false
});
function readPrivateFile(fileName){
  let fd;
  try{
    // Refuse symbolic links; never read files from implicit default paths.
    const info=fs.lstatSync(fileName);
    // A hard link to firebase.rules.json has another pathname but the same
    // inode. Treat any multiply-linked file as untrusted export evidence.
    if(!info.isFile()||info.nlink!==1||
       info.size<2||info.size>MAX_EXPORT_BYTES)
      throw Error('invalid-file');
    fd=fs.openSync(fileName,constants.O_RDONLY|
      (constants.O_NOFOLLOW||0));
    const current=fs.fstatSync(fd);
    if(!current.isFile()||current.nlink!==1||current.size<2||
       current.size>MAX_EXPORT_BYTES||
       current.dev!==info.dev||current.ino!==info.ino)
      throw Error('changed-file');
    return JSON.parse(fs.readFileSync(fd,'utf8'));
  }finally{
    if(fd!==undefined)fs.closeSync(fd);
  }
}
export function inspectExportFromFile(fileName,{candidateFile,manifestFile}={}){
  try{
    if(typeof fileName!=='string'||!fileName.trim()||
       typeof candidateFile!=='string'||typeof manifestFile!=='string')
      return safeResult('OPERATOR_EXPORT_INPUT_MISSING');
    const candidatePath=fs.realpathSync(candidateFile);
    const inputPath=fs.realpathSync(fileName);
    if(inputPath===candidatePath) return safeResult('REPO_CANDIDATE_IS_NOT_OPERATOR_EXPORT');
    const operatorExport=readPrivateFile(fileName);
    const candidate=JSON.parse(fs.readFileSync(candidateFile,'utf8'));
    const manifest=JSON.parse(fs.readFileSync(manifestFile,'utf8'));
    return assessOperatorRulesExport(operatorExport,candidate,manifest);
  }catch{return safeResult('OPERATOR_EXPORT_UNAVAILABLE_OR_MALFORMED');}
}
const calledFrom=process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href;
if(calledFrom){
  const result=process.argv.length===3?
    inspectExportFromFile(process.argv[2],{
      candidateFile:'firebase.rules.json',
      manifestFile:'docs/firebase/R3_REAL_AUTHORITY_PREFLIGHT_20261102.json'
    }):safeResult('OPERATOR_EXPORT_INPUT_MISSING');
  // Only finite, fixed codes and booleans: never echo input data, paths,
  // tokens, Rules expressions, private network fields or parse errors.
  console.log(JSON.stringify(result));
  if(!result.repoCandidateMatchesExport||
     !result.offlineRuleShapeReviewed)process.exitCode=2;
  // Exit 0 is only a successful *local comparison*, never deployment GO.
}
