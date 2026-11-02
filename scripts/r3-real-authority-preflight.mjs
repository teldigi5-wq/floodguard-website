// FloodGuard R3: offline code-reviewed integration preflight, NOT a release
// approval tool. It can validate source/manifest consistency only.
// It cannot establish effective remote Firebase rules, actual IAM or hardware.
import fs from 'node:fs';
import {pathToFileURL} from 'node:url';
const FIELDS=['sensor','verifier','confirmer','publisher','witness','public-client'];
const PATHS=['/ingest/v1',
  '/floodguard/staging/ingestV1/device-stage-a',
  '/floodguard/staging/ingestV1/device-stage-a',
  '/floodguard/publicTelemetryLabV1','NONE','/floodguard/live'];
const OPS=['HTTPS_SIGNED_INGRESS_ONLY','VERIFY_SIGNED_FRAME_ONLY',
  'READ_BACK_VERIFIED_CONFIRMATION_ONLY',
  'WRITE_5_EXACT_PUBLIC_LAB_SCALARS_ONLY',
  'MONOTONIC_CAS_NO_FIREBASE','READ_ALLOWLISTED_CHILDREN_ONLY'];
const TRUST=[
  'DEVICE_KEY_NOT_VERIFIED','INDEPENDENT_PROCESS_NOT_DEPLOYED',
  'FIREBASE_CONFIRMATION_NOT_PROVEN','SCOPED_WRITER_NOT_DEPLOYED',
  'INDEPENDENT_DURABLE_WITNESS_MISSING',
  'FRESHNESS_ONLY_NOT_SOURCE_AUTHENTICATION'];
const GATES=[
  'effective-rtdb-rules-export-and-offline-backup',
  'firebase-admin-iam-and-rules-scoped-credentials',
  'authenticated-separate-issuer-and-witness-custody',
  'independent-firebase-durable-confirmation',
  'atomic-revocation-and-issuance-fencing',
  'rollback-resistant-witness-and-recovery',
  'field-esp8266-firmware-tls-provenance',
  'field-flash-backup-brownout-and-reset',
  'cross-client-stale-and-warning-delivery',
  'operator-supervised-uno-gate-alarm',
  'explicit-owner-release-approval'
];
const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&
  Object.getPrototypeOf(v)===Object.prototype;
const exact=(v,k)=>plain(v)&&Object.keys(v).length===k.length&&
  k.every(x=>Object.hasOwn(v,x));
const fail=code=>Object.freeze({
  reviewValid:false,releaseDecision:'NO_GO',reason:code,
  approved:false,mayDeploy:false,mayMerge:false,
  mayChangeRules:false,mayFlash:false,mayPublish:false,
  mayAcknowledge:false,maySendAlert:false,mayOperateGate:false
});
function reviewRules(ruleDoc){
  const root=ruleDoc?.rules;
  if(!plain(root)||root['.read']!==false||root['.write']!==false)
    return false;
  function noWriteGrant(node){
    if(!plain(node))return false;
    if(Object.hasOwn(node,'.write')&&node['.write']!==false)return false;
    return Object.entries(node).every(([k,v])=>
      k.startsWith('.')||typeof v!=='object'||noWriteGrant(v));
  }
  // Do not treat a local repo file as the effective deployed rules.
  // Nested write grants could override the apparent root-wide deny.
  if(!noWriteGrant(root))return false;
  const live=root.floodguard?.live;
  return live?.water?.['.read']===true&&
    live?.rain?.['.read']===true&&
    live?.gate?.['.read']===true&&
    live?.alarm?.['.read']===true&&
    live?.devices?.['.read']===true&&
    live?.system?.['.read']===true&&
    live?.esp8266?.connection?.['.read']===true&&
    live?.esp8266?.rssi?.['.read']===true&&
    live?.esp8266?.status?.['.read']===true&&
    live?.esp8266?.ip?.['.read']===false&&
    live?.esp8266?.wifi?.['.read']===false;
}
export function assessAuthorityPreflight(manifest,repoRules){
  if(!exact(manifest,['schema','mode','releaseDecision',
    'productionChangesAuthorized','deploymentTarget',
    'firebaseAdminCredentialAllowed','physicalDeviceAccessAuthorized',
    'roles','mandatoryGates'])||
     manifest.schema!=='floodguard-r3-operational-authority-preflight-v1'||
     manifest.mode!=='OFFLINE_DESIGN_REVIEW_ONLY'||
     manifest.releaseDecision!=='NO_GO'||
     manifest.productionChangesAuthorized!==false||
     manifest.deploymentTarget!=='NONE'||
     manifest.firebaseAdminCredentialAllowed!==false||
     manifest.physicalDeviceAccessAuthorized!==false)
    return fail('REVIEW_MANIFEST_REJECTED');
  if(!Array.isArray(manifest.roles)||manifest.roles.length!==FIELDS.length)
    return fail('AUTHORITY_ROLE_BOUNDARIES_INVALID');
  for(let i=0;i<FIELDS.length;i++){
    const role=manifest.roles[i];
    if(!exact(role,['id','operation','path','trust','live'])||
       role.id!==FIELDS[i]||role.operation!==OPS[i]||
       role.path!==PATHS[i]||role.trust!==TRUST[i]||role.live!==false)
      return fail('AUTHORITY_ROLE_BOUNDARIES_INVALID');
  }
  if(!Array.isArray(manifest.mandatoryGates)||
     manifest.mandatoryGates.length!==GATES.length)
    return fail('REQUIRED_REAL_WORLD_EVIDENCE_MISSING');
  for(let i=0;i<GATES.length;i++){
    const g=manifest.mandatoryGates[i];
    if(!exact(g,['id','status','evidence'])||g.id!==GATES[i]||
       !['UNVERIFIED','NOT_IMPLEMENTED','NOT_GRANTED'].includes(g.status)||
       g.evidence!=='NONE')
      return fail('REAL_WORLD_GATE_NOT_REVIEW_ONLY');
  }
  if(!reviewRules(repoRules))
    return fail('LOCAL_REPO_RULES_FAIL_CLOSED_REVIEW_FAILED');
  return Object.freeze({
    reviewValid:true,releaseDecision:'NO_GO',
    reason:'OFFLINE_SOURCE_REVIEW_ONLY_REAL_EVIDENCE_UNVERIFIED',
    unverifiedRealWorldGates:GATES.length,
    checkedDraftRoleBoundaries:FIELDS.length,
    localRulesCandidateReviewed:true,effectiveFirebaseRulesVerified:false,
    independentlyProtectedWitnessDeployed:false,
    realSensorIdentityVerified:false,approved:false,
    mayDeploy:false,mayMerge:false,mayChangeRules:false,mayFlash:false,
    mayPublish:false,mayAcknowledge:false,maySendAlert:false,
    mayOperateGate:false
  });
}
const calledFrom=process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href;
if(calledFrom){
  try{
    const m=JSON.parse(fs.readFileSync(
      'docs/firebase/R3_REAL_AUTHORITY_PREFLIGHT_20261102.json','utf8'));
    const rules=JSON.parse(fs.readFileSync('firebase.rules.json','utf8'));
    const result=assessAuthorityPreflight(m,rules);
    // Fixed harmless status codes only; never echo an unexpected path, IAM,
    // token, device ID, document body or secret.
    console.log(JSON.stringify(result));
    if(!result.reviewValid)process.exitCode=2;
  }catch{
    console.log(JSON.stringify(fail('OFFLINE_SOURCE_INPUT_UNAVAILABLE')));
    process.exitCode=2;
  }
}
