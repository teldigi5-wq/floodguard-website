// FloodGuard Stage 13: SECURITY DESIGN REVIEW ONLY.
// No networking, Firebase, keys, provisioning, firmware, signing, or deployment.
// Booleans are synthetic planning assertions, NEVER operational attestations.
import {parseFieldTimestamp,ageSeconds,classifyTelemetryFreshness} from '../lib/telemetry-health.mjs';

const WINDOW=Object.freeze({website:10,bot:15,mobile:30});
const DISALLOWED=new Set(['legacy-anonymous-parent-put','legacy-anonymous-root-patch']);
const ROUTES=new Set(['direct-firebase-device-identity','trusted-local-ingestion-gateway']);
const required=[
  'deviceIdentityBound','peerCertificateVerified','credentialRenewalReviewed',
  'revocationReviewed','replayAfterRebootReviewed',
  'offlineRetryReviewed','privateFieldIsolationReviewed'
];
const gatewayRequired=[
  'independentGatewayAuthorizationReviewed','adminSdkBypassRiskReviewed',
  'rateAndPayloadLimitsReviewed','idempotentDownstreamReviewed',
  'auditedGatewayHostingReviewed'
];
const isRecord=x=>x!==null&&typeof x==='object'&&!Array.isArray(x)
  &&Object.getPrototypeOf(x)===Object.prototype;
function issuesFrom(input,fields,prefix){
  return fields.filter(field=>input?.[field]!==true).map(field=>prefix+field);
}
export function reviewStage13SyntheticAuthMigration(input={}){
  if(!isRecord(input))throw new TypeError('Planning assertions must be a synthetic object');
  const issues=[];
  const route=input.route;
  if(!ROUTES.has(route))issues.push('UNSUPPORTED_OR_UNKNOWN_MIGRATION_ROUTE');
  if(DISALLOWED.has(input.legacyTransport)||input.legacyParentWritesRetained===true)
    issues.push('LEGACY_ANONYMOUS_PARENT_WRITE_CANNOT_BE_TRUSTED');
  issues.push(...issuesFrom(input,required,'UNPROVEN_'));
  if(route==='trusted-local-ingestion-gateway')
    issues.push(...issuesFrom(input,gatewayRequired,'UNPROVEN_GATEWAY_'));
  if(input.currentFlashedDeviceCompatibilityVerified!==true)
    issues.push('ACTUAL_FLASHED_DEVICE_COMPATIBILITY_NOT_PROVEN');
  if(input.fieldTestsWithExplicitOwnerConsent!==true)
    issues.push('OWNER_APPROVED_FIELD_VERIFICATION_ABSENT');
  return Object.freeze({
    kind:'SYNTHETIC_MIGRATION_DECISION_RECORD',
    route:ROUTES.has(route)?route:'UNSUPPORTED',
    releaseDecision:'NO_GO',
    realProductionAuthVerified:false,
    fieldHardwareTested:false,
    canWriteProduction:false,
    canReflashHardware:false,
    canStartWhatsApp:false,
    blockers:Object.freeze([...new Set([
      ...issues,
      'CURRENT_EFFECTIVE_PRODUCTION_RULES_UNVERIFIED',
      'NO_REAL_CREDENTIALS_OR_TLS_FIELD_EVIDENCE',
      'SEPARATE_OWNER_DEPLOYMENT_APPROVAL_REQUIRED'
    ])].sort())
  });
}
export function compareStage13SyntheticFreshness({timestamp,nowMs,connected,hasData=true,error=false}={}){
  if(!Number.isSafeInteger(nowMs)||nowMs<0)throw new TypeError('Synthetic nowMs required');
  const parsed=parseFieldTimestamp(timestamp,nowMs);
  const seconds=parsed===null?null:ageSeconds(parsed,nowMs);
  const classification={};
  for(const [client,window] of Object.entries(WINDOW)){
    // Comparison of source-declared windows only. Bot/mobile UI behavior
    // requires independent runtime/physical confirmation.
    classification[client]=classifyTelemetryFreshness({
      loading:false,hasData:hasData===true,connected:connected===true,
      error:error===true,ageSeconds:seconds
    })==='unavailable'?'unavailable'
      :connected!==true||error===true||seconds===null?'stale'
      :seconds<=window?'within-window':'stale';
  }
  const statuses=Object.values(classification);
  return Object.freeze({
    kind:'SYNTHETIC_WINDOW_COMPARISON_NOT_UI_OUTPUT',
    ageSeconds:seconds,
    observedFieldTimestampMs:parsed,
    windowsSeconds:{...WINDOW},
    windowClassification:classification,
    clientsDisagree:statuses.some(x=>x!==statuses[0]),
    showsRealHardwareLive:false,
    clearedSafetyThresholdApproval:false
  });
}
const requiredRollout=[
  'effectiveRulesInspectedPrivately','privateDescendantsInventoried',
  'currentRulesBackupVerified','rollBackPlanDryRunReviewed',
  'childReadClientsAcceptedOnIsolatedTarget',
  'mobileDeviceAcceptanceEvidence',
  'deviceIdentityAndTlsFieldEvidence',
  'operatorWindowAndMonitoringApproved',
  'explicitOwnerRulesPublicationApproval'
];
export function reviewStage13SyntheticRollout(input={}){
  if(!isRecord(input))throw new TypeError('Rollout checklist must be an object');
  const remaining=requiredRollout.filter(k=>input[k]!==true);
  return Object.freeze({
    kind:'SYNTHETIC_ROLLOUT_CHECKLIST',
    remainingSyntheticChecklistFields:remaining,
    syntheticChecklistFullyClaimed:remaining.length===0,
    result:'NO_GO',
    effectiveRulesRetrieved:false,
    productionRulePublicationApproved:false,
    canDeploy:false,
    needsIndependentHumanEvidence:true
  });
}
export const STAGE13_WINDOWS=WINDOW;
