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

// JSON.parse silently retains the *last* duplicate property. For a privately
// supplied Rules snapshot that is unacceptable: two different parsers could
// interpret the same bytes differently. Scan every object scope before
// allowing a "matching candidate" result. JSON.parse has already validated
// the entire syntax; parseString reuses it to decode \u escapes in key names.
// Never include duplicate keys, paths or source bytes in errors or output.
function requireUniqueObjectKeys(raw){
  let i=0;
  const space=()=>{while(i<raw.length&&
    (raw[i]===' '||raw[i]==='\t'||raw[i]==='\r'||raw[i]==='\n'))i++;};
  function quoted(){
    const begin=i++;
    while(i<raw.length){
      if(raw[i]==='\\'){i+=2;continue;}
      if(raw[i]==='"'){
        i++;
        return JSON.parse(raw.slice(begin,i));
      }
      i++;
    }
    throw Error('invalid-json');
  }
  function value(){
    space();
    if(raw[i]==='{'){
      i++;
      space();
      const keys=new Set();
      if(raw[i]==='}'){i++;return;}
      for(;;){
        space();
        if(raw[i]!=='"')throw Error('invalid-json');
        const key=quoted();
        if(keys.has(key))throw Error('duplicate-json-key');
        keys.add(key);
        space();
        if(raw[i++]!==':')throw Error('invalid-json');
        value();
        space();
        if(raw[i]==='}'){i++;return;}
        if(raw[i++]!==',')throw Error('invalid-json');
      }
    }
    if(raw[i]==='['){
      i++;
      space();
      if(raw[i]===']'){i++;return;}
      for(;;){
        value();
        space();
        if(raw[i]===']'){i++;return;}
        if(raw[i++]!==',')throw Error('invalid-json');
      }
    }
    if(raw[i]==='"'){quoted();return;}
    const begin=i;
    while(i<raw.length&&![' ', '\t','\r','\n',',',']','}'].includes(raw[i]))i++;
    if(i===begin)throw Error('invalid-json');
  }
  value();
  space();
  if(i!==raw.length)throw Error('invalid-json');
}

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
    const raw=fs.readFileSync(fd,'utf8');
    const parsed=JSON.parse(raw);
    requireUniqueObjectKeys(raw);
    return parsed;
  }finally{
    if(fd!==undefined)fs.closeSync(fd);
  }
}
// Optional privateEvidenceDirectory permits in-memory/test clients to supply
// a disposable fixture root. The actual CLI always pins this to the repository
// root's Git-ignored .floodguard-private-evidence directory.
export function inspectExportFromFile(fileName,{candidateFile,manifestFile,
  privateEvidenceDirectory}={}){
  try{
    if(typeof fileName!=='string'||!fileName.trim()||
       typeof candidateFile!=='string'||typeof manifestFile!=='string')
      return safeResult('OPERATOR_EXPORT_INPUT_MISSING');
    const candidatePath=fs.realpathSync(candidateFile);
    const inputPath=fs.realpathSync(fileName);
    if(inputPath===candidatePath) return safeResult('REPO_CANDIDATE_IS_NOT_OPERATOR_EXPORT');
    if(privateEvidenceDirectory!==undefined){
      // Canonical paths reject ../ escapes and symlinked ancestors. Enforce
      // an actual, non-symlinked private directory and a DIRECT child file;
      // nested, tracked, temp, or arbitrarily symlinked external locations
      // are not acceptable operator evidence for the CLI.
      const privateInfo=fs.lstatSync(privateEvidenceDirectory);
      if(!privateInfo.isDirectory()||privateInfo.isSymbolicLink()||
         path.dirname(inputPath)!==fs.realpathSync(privateEvidenceDirectory))
        return safeResult('OPERATOR_EXPORT_OUTSIDE_PRIVATE_DIRECTORY');
    }
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
      manifestFile:'docs/firebase/R3_REAL_AUTHORITY_PREFLIGHT_20261102.json',
      privateEvidenceDirectory:'.floodguard-private-evidence'
    }):safeResult('OPERATOR_EXPORT_INPUT_MISSING');
  // Only finite, fixed codes and booleans: never echo input data, paths,
  // tokens, Rules expressions, private network fields or parse errors.
  console.log(JSON.stringify(result));
  if(!result.repoCandidateMatchesExport||
     !result.offlineRuleShapeReviewed)process.exitCode=2;
  // Exit 0 is only a successful *local comparison*, never deployment GO.
}
