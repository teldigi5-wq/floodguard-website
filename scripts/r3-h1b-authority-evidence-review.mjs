// FloodGuard R3-H1/B: local-only, read-only review of privately obtained
// Firebase RTDB Rules and Google Cloud PROJECT IAM allow policy exports.
// Never interprets inspected artifacts as a production GO decision.
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { assessAuthorityPreflight } from './r3-real-authority-preflight.mjs';

const plain = (x) => x !== null && typeof x === 'object' && !Array.isArray(x) &&
  Object.getPrototypeOf(x) === Object.prototype;
const HIGH_PRIVILEGE_ROLES = new Set([
  'roles/owner', 'roles/editor', 'roles/firebase.admin',
  'roles/firebasedatabase.admin', 'roles/iam.serviceAccountTokenCreator',
  'roles/iam.serviceAccountKeyAdmin', 'roles/iam.serviceAccountAdmin',
  'roles/iam.securityAdmin', 'roles/firebase.developAdmin',
  'roles/resourcemanager.projectIamAdmin'
]);
const DOCUMENTED_VIEWER_ROLES = new Set([
  'roles/viewer', 'roles/browser', 'roles/firebase.viewer',
  'roles/firebasedatabase.viewer'
]);
const PUBLIC_MEMBERS = new Set(['allUsers', 'allAuthenticatedUsers']);
const NO_GO = 'NO_GO';

// This compares *documents*, not effective production permissions or source
// provenance. Firestore and RTDB rules, resource-level IAM, inherited policies,
// backend Admin credentials and actual data shape require independent review.
function normalized(value) {
  if (Array.isArray(value)) return value.map(normalized);
  if (plain(value)) return Object.fromEntries(
    Object.keys(value).sort().map(k => [k, normalized(value[k])])
  );
  return value;
}

function iamSummary(policy) {
  if (!plain(policy) || !Array.isArray(policy.bindings) ||
      policy.bindings.length > 10000) return null;
  let broadMember = false;
  let highPrivilege = false;
  let customRole = false;
  let otherNonViewerRole = false;
  let conditional = false;
  let bindingWithMembers = false;
  for (const b of policy.bindings) {
    if (!plain(b) || typeof b.role !== 'string' || !b.role.length ||
        !Array.isArray(b.members) || b.members.length > 10000 ||
        b.members.some(m => typeof m !== 'string')) return null;
    if (b.members.length === 0) continue;
    bindingWithMembers = true;
    broadMember ||= b.members.some(m => PUBLIC_MEMBERS.has(m));
    highPrivilege ||= HIGH_PRIVILEGE_ROLES.has(b.role);
    customRole ||= !b.role.startsWith('roles/');
    otherNonViewerRole ||= !DOCUMENTED_VIEWER_ROLES.has(b.role);
    conditional ||= Object.hasOwn(b, 'condition');
  }
  return {broadMember, highPrivilege, customRole, otherNonViewerRole, conditional, bindingWithMembers};
}

export function assessPrivateAuthorityEvidence({manifest, sourceRules,
  effectiveRules, projectIam} = {}) {
  const source = assessAuthorityPreflight(manifest, sourceRules);
  const effective = assessAuthorityPreflight(manifest, effectiveRules);
  const iam = iamSummary(projectIam);
  const result = {
    schema: 'floodguard-r3-h1b-private-evidence-review-v1',
    releaseDecision: NO_GO,
    offlineOnly: true,
    sourceRulesPreflightValid: source.reviewValid === true,
    importedRulesPassedStrictSourceContract: effective.reviewValid === true,
    rulesDocumentsStructurallyMatch:
      plain(sourceRules) && plain(effectiveRules) &&
      JSON.stringify(normalized(sourceRules)) === JSON.stringify(normalized(effectiveRules)),
    projectIamExportWellFormed: iam !== null,
    // A valid but empty export is not sufficient evidence to mark review complete.
    projectIamHasNonemptyBindings: iam?.bindingWithMembers ?? null,
    publicIamMemberRequiresReview: iam?.broadMember ?? null,
    highPrivilegeIamRoleRequiresReview: iam?.highPrivilege ?? null,
    customIamRoleRequiresReview: iam?.customRole ?? null,
    nonViewerIamRoleRequiresReview: iam?.otherNonViewerRole ?? null,
    conditionalIamBindingRequiresReview: iam?.conditional ?? null,
    // Impossible to prove from unsigned local documents or project IAM alone.
    exportProvenanceVerified: false,
    inheritedAndResourceIamVerified: false,
    effectiveAdminRuntimeAndKeyCustodyVerified: false,
    publicDescendantsInventoryVerified: false,
    signedIngressAndIndependentWitnessVerified: false,
    hardwareAndDeliveryVerified: false,
    realWorldGatesUnverified: 11,
    approved: false, mayDeploy: false, mayMerge: false,
    mayChangeRules: false, mayPublish: false, mayAcknowledge: false,
    maySendAlert: false, mayFlash: false, mayOperateGate: false
  };
  return Object.freeze(result);
}

// This exit code reflects ONLY a narrow local document comparison. NO_GO stays fixed.
export function isOfflineReviewReady(finding) {
  return plain(finding) &&
    finding.sourceRulesPreflightValid === true &&
    finding.importedRulesPassedStrictSourceContract === true &&
    finding.rulesDocumentsStructurallyMatch === true &&
    finding.projectIamExportWellFormed === true &&
    finding.projectIamHasNonemptyBindings === true &&
    finding.publicIamMemberRequiresReview === false &&
    finding.highPrivilegeIamRoleRequiresReview === false &&
    finding.customIamRoleRequiresReview === false &&
    finding.nonViewerIamRoleRequiresReview === false &&
    finding.conditionalIamBindingRequiresReview === false &&
    finding.releaseDecision === NO_GO && finding.approved === false;
}

// Refuse symlinks, oversized exports, and local files readable by other users.
// Never print file paths, rule bodies, IAM members, identifiers, or input errors.
export function readPrivateJson(path) {
  if (typeof path !== 'string' || !path || path.startsWith('-'))
    throw Error('PRIVATE_EVIDENCE_INPUT_UNAVAILABLE');
  const flags = fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0);
  let fd;
  try {
    fd = fs.openSync(path, flags);
    const st = fs.fstatSync(fd);
    if (!st.isFile() || st.size <= 0 || st.size > 1024 * 1024 ||
        (process.platform !== 'win32' && (st.mode & 0o077) !== 0))
      throw Error('PRIVATE_EVIDENCE_INPUT_UNAVAILABLE');
    return JSON.parse(fs.readFileSync(fd, 'utf8'));
  } catch {
    throw Error('PRIVATE_EVIDENCE_INPUT_UNAVAILABLE');
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

const invoked = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invoked) {
  try {
    // Only two private inputs; source baseline and manifest are loaded from
    // the current disposable checkout. This script has no network/API code.
    if (process.argv.length !== 6 || process.argv[2] !== '--effective-rules' ||
        process.argv[4] !== '--project-iam')
      throw Error('PRIVATE_EVIDENCE_INPUT_UNAVAILABLE');
    const effectiveRules = readPrivateJson(process.argv[3]);
    const projectIam = readPrivateJson(process.argv[5]);
    const manifest = JSON.parse(fs.readFileSync(
      'docs/firebase/R3_REAL_AUTHORITY_PREFLIGHT_20261102.json','utf8'));
    const sourceRules = JSON.parse(fs.readFileSync('firebase.rules.json','utf8'));
    const finding = assessPrivateAuthorityEvidence({manifest, sourceRules,
      effectiveRules, projectIam});
    console.log(JSON.stringify(finding));
    process.exitCode = isOfflineReviewReady(finding) ? 0 : 2;
  } catch {
    console.log(JSON.stringify({
      schema: 'floodguard-r3-h1b-private-evidence-review-v1',
      releaseDecision: NO_GO, reason: 'PRIVATE_EVIDENCE_INPUT_UNAVAILABLE',
      approved: false, mayDeploy: false, mayMerge: false,
      mayChangeRules: false, mayPublish: false, mayOperateGate: false
    }));
    process.exitCode = 2;
  }
}
