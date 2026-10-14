// Stage 17: display-only, non-operational candidate. It does NOT fetch data,
// change alerting, authenticate hardware, send messages or start servers.
import {assessStage16ProposedUi} from './stage16-uncertainty-policy.mjs';
const WATER={
  UNVERIFIED_WATER:['Water observation unverified','Sensor measurements conflict or require field verification.','warning'],
  UNAVAILABLE:['Water observation unavailable','No verified water measurement is available.','warning'],
  SAFE_REPORTED_ONLY:['SAFE reported — not verified','A stored reading reports SAFE; source identity and physical condition are unverified.','neutral'],
  WARNING_REPORTED_ONLY:['WARNING reported — not verified','A stored reading reports WARNING; do not treat it as a delivered warning.','warning'],
  DANGER_REPORTED_ONLY:['DANGER reported — not verified','A stored reading reports DANGER; physical conditions have not been independently confirmed.','warning']
};
const GATE={
  POSITION_CONFLICT:['Gate position conflict','Gate status and angle disagree; physical position is unknown.','warning'],
  UNVERIFIED_POSITION:['Gate position unverified','Available telemetry cannot establish physical gate position.','warning'],
  CLOSED_REPORTED_ONLY:['CLOSED reported — not verified','The reported gate position is not physical confirmation.','neutral'],
  OPEN_REPORTED_ONLY:['OPEN reported — not verified','The reported gate position is not physical confirmation.','warning'],
  COUNTDOWN_REPORTED_ONLY:['Countdown reported — not verified','A stored countdown does not mean gate movement occurred.','warning'],
  TRANSITION_REPORTED_ONLY:['Transition reported — not verified','Telemetry suggests a transition; physical gate position is unverified.','warning']
};
function card(key,lookup){
  const choice=lookup[key]||['Unverified observation','The source needs independent review.','warning'];
  return Object.freeze({
    heading:choice[0],detail:choice[1],tone:choice[2],
    evidence:'Synthetic review only — not live, not a safety decision.'
  });
}
export function buildStage17ReviewCards(input){
  const output=assessStage16ProposedUi(input);
  const freshness=output.freshnessDisplay==='RECENT_FIELD_TIMESTAMP_ONLY'
    ?['Recent field timestamp only','An apparently recent timestamp cannot verify the device or prove the reading is authentic.','neutral']
    :['Reading freshness unverified','The stored field timestamp or connection is stale, missing, invalid, or differs across client policies.','warning'];
  const risk=output.riskDisplay==='REVIEW_REQUIRED'
    ?['Overall risk requires review','Missing or conflicting sensor/risk reports cannot establish a safe condition.','warning']
    :[output.riskDisplay.replace('_REPORTED_ONLY',' reported — not verified'),
      'This reported risk is not an authenticated physical safety assessment.','neutral'];
  return Object.freeze({
    kind:'STAGE17_OFFLINE_DISPLAY_REVIEW_ONLY',approval:'NO_GO',
    cards:Object.freeze([
      Object.freeze({id:'water',...card(output.waterDisplay,WATER)}),
      Object.freeze({id:'gate',...card(output.gateDisplay,GATE)}),
      Object.freeze({id:'risk',heading:risk[0],detail:risk[1],tone:risk[2],
        evidence:'Synthetic review only — not live, not a safety decision.'}),
      Object.freeze({id:'freshness',heading:freshness[0],detail:freshness[1],tone:freshness[2],
        evidence:'Synthetic review only — not live, not a safety decision.'})
    ]),
    rawReasons:Object.freeze([...output.reviewReasons]),
    canSendAlerts:false,canControlGate:false
  });
}
