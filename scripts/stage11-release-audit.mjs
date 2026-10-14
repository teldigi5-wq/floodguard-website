// Stage 11 local-only release audit, NOT a deployment gate or a proof of live rules.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const document=p=>JSON.parse(fs.readFileSync(path.join(root,p),'utf8'));
const expected=['water','rain','gate','alarm','devices','system',
  'esp8266/connection','esp8266/rssi','esp8266/status'];
const deny=['esp8266/ip','esp8266/wifi'];
const getAt=(node,p)=>p.split('/').reduce((obj,key)=>obj?.[key],node);
export function inspectStage11({review,phaseA,phaseB}={}){
  if(!review||!phaseA||!phaseB)throw new TypeError('Local review, Phase A and B snapshots required');
  const paths=review.publicPaths;
  const equal=(a,b)=>Array.isArray(a)&&a.length===b.length&&a.every((v,i)=>v===b[i]);
  const parity=!!paths&&['website','bot','mobile'].every(k=>equal(paths[k],expected));
  const candidate=phaseA.rules?.floodguard?.live;
  const phaseBRoot=phaseB.rules?.floodguard;
  const publicReads=!!candidate&&expected.every(p=>getAt(candidate,p)?.['.read']===true
    ||(p.indexOf('/')<0&&candidate[p]?.['.read']===true));
  const privateReads=!!candidate&&candidate['.read']===false
    &&candidate.esp8266?.['.read']===false
    &&deny.every(p=>getAt(candidate,p)?.['.read']===false)
    &&phaseA.rules?.['.read']===false;
  const anonymousWrite=candidate?.['.write']===true;
  const phaseBIsPrototype=phaseBRoot?.live?.['.write']===false
    &&phaseBRoot?.staging?.ingestV1?.['.write']===false
    &&!!phaseBRoot?.staging?.ingestV1?.$deviceId;
  const approved=review.releaseStatus==='APPROVED'
    ||review.permissions?.productionChangeAuthorized===true;
  const blockers=[...(Array.isArray(review.blockers)?review.blockers:[])];
  if(!parity)blockers.push('PUBLIC_CHILD_PATH_REVIEW_DRIFT');
  if(!publicReads||!privateReads)blockers.push('PHASE_A_READ_BOUNDARY_MISMATCH');
  if(anonymousWrite)blockers.push('ANONYMOUS_PARENT_WRITE_CONFIRMED');
  if(!phaseBIsPrototype)blockers.push('PHASE_B_ISOLATION_NOT_VERIFIED');
  if(approved)blockers.push('INCONSISTENT_UNAUTHORIZED_APPROVAL_FLAG');
  if(review.permissions?.effectiveProductionRulesVerified!==true)
    blockers.push('EFFECTIVE_PRODUCTION_RULES_UNVERIFIED');
  if(review.evidence?.mobile?.private!==true)blockers.push('MOBILE_PRIVACY_UNKNOWN');
  return Object.freeze({
    status:'NO_GO',mode:'REVIEW_ONLY_NO_NETWORK',sourceDate:review.reviewDate,
    pathParity:parity,phaseAChildReadsVerified:publicReads&&privateReads,
    phaseAAnonymousParentWrites:anonymousWrite,phaseBPrototypeSeparated:phaseBIsPrototype,
    blockers:[...new Set(blockers)].sort()
  });
}
export function readLocalStage11(){
  return inspectStage11({
    review:document('docs/firebase/stage11-cross-repo-readiness.json'),
    phaseA:document('docs/firebase/phase-a-privacy-candidate.rules.json'),
    phaseB:document('docs/firebase/phase-b-authenticated-prototype.rules.json')
  });
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const result=readLocalStage11();
  console.log('FloodGuard Stage 11 review: '+result.status+' (not deployment authorization)');
  console.log('Reviewed nine public Firebase child paths: '+(result.pathParity?'match':'MISMATCH'));
  console.log('Candidate Phase A child privacy: '+(result.phaseAChildReadsVerified?'reviewed':'REQUIRES REVIEW'));
  console.log('Candidate anonymous writes: '+(result.phaseAAnonymousParentWrites?'STILL ALLOWED':'inspect manually'));
  console.log('Outstanding review blockers: '+result.blockers.length);
  for(const code of result.blockers)console.log(' - '+code);
}
