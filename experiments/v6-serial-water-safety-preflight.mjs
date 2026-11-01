// Review-only bridge for ACTUAL archived Arduino UNO v6 "FG" serial packets.
// No live Serial port, no Firebase, no network, no signing keys, no firmware
// flash, no relay/servo/buzzer commands and NO authenticated telemetry claims.
// UART's XOR checksum detects accidental errors but offers NO authenticity.
import {validateSyntheticFrame} from './offline-ingestion-gateway.mjs';

const MAX_LEN=127; // Archived ESP8266 uses char rxBuffer[128].
const SERIAL_FIELDS=10;
const UINT=/^(?:0|[1-9][0-9]*)$/;
const POS_DEC=/^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,2})?$/;
const SIGNED_DEC=/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]{1,2})?$/;
const STATUS=new Set(['SAFE','WARNING','DANGER','SENSOR_ERROR']);
const GATES=new Set(['CLOSED','COUNTDOWN','OPEN','OPENING_WARNING']);
const bad=reason=>Object.freeze({
  eligible:false,reason,authenticated:false,canPublish:false,
  canAcknowledge:false,floodClearance:'UNKNOWN'
});
const number=(raw,re,max,min)=>re.test(raw)&&Number.isFinite(Number(raw))&&
  Number(raw)>=min&&Number(raw)<=max;
function xor(text){
  let sum=0;
  for(const ch of Buffer.from(text,'ascii'))sum^=ch;
  return sum;
}
/**
 * This intentionally does not "repair" old v6 data by mapping distances
 * greater than the calibrated 25-cm reservoir depth to SAFE=level0.
 * That legacy clamp can produce misleading SAFE observations.
 *
 * The output is an untrusted candidate for a FUTURE device-signing review.
 * Successful parsing NEVER implies Ed25519 verification, freshness at server,
 * safe gate position or Firebase delivery.
 */
export function inspectLegacyFgSerialLab({line,priorSequence=0}={}){
  if(typeof line!=='string'||line.length===0||line.length>MAX_LEN||
     /[^\x20-\x7e\r\n]/.test(line))return bad('serial-frame-size-or-ascii');
  // Only one bounded packet; remove the single CR/LF terminator produced by
  // Arduino println. Do not accept embedded control codes or concatenations.
  const text=line.replace(/\r?\n$/,'');
  if(text.includes('\r')||text.includes('\n'))return bad('serial-framing');
  const parts=text.split(',');
  if(parts.length!==SERIAL_FIELDS||parts[0]!=='FG'||
     !/^[0-9a-fA-F]{2}$/.test(parts[9]))return bad('serial-field-count-or-checksum');
  const body=parts.slice(0,-1).join(',');
  if(xor(body)!==Number.parseInt(parts[9],16))return bad('xor-checksum-mismatch');
  if(!Number.isSafeInteger(priorSequence)||priorSequence<0||
     priorSequence>2147483647)return bad('untrusted-prior-sequence');
  if(!number(parts[1],UINT,2147483647,1))return bad('invalid-sequence');
  const sequence=Number(parts[1]);
  if(sequence<=priorSequence)return bad('serial-replay-or-out-of-order');
  const [distanceRaw,risk,buzzer,gate,angleRaw,countdownRaw,rtc]=parts.slice(2,9);
  if(!STATUS.has(risk)||!GATES.has(gate)||
     !number(buzzer,UINT,1,0)||
     !number(angleRaw,UINT,180,0)||
     !number(countdownRaw,UINT,60,0)||
     !number(rtc,UINT,1,0))return bad('invalid-status-or-actuator-observation');
  const angle=Number(angleRaw),countdown=Number(countdownRaw);
  if(risk==='SENSOR_ERROR'){
    // A sensor failure must be reported through a dedicated fault channel,
    // not squeezed into the current "safe numeric water" envelope.
    return Object.freeze({
      eligible:false,reason:'sensor-error-requires-local-failsafe-review',
      fault:'SENSOR_ERROR',sequence,authenticated:false,canPublish:false,
      canAcknowledge:false,floodClearance:'UNKNOWN',
      buzzerReportedOn:buzzer==='1',gateReported:gate
    });
  }
  if(!number(distanceRaw,POS_DEC,400,2))
    return bad('invalid-distance');
  const distanceCm=Number(distanceRaw);
  if(distanceCm>25)return bad('distance-outside-calibrated-depth-unknown-not-safe');
  const levelCm=Math.round((25-distanceCm)*100)/100;
  const computed=levelCm>=11?'DANGER':levelCm>=8.5?'WARNING':'SAFE';
  if(risk!==computed)return bad('conflicting-risk-and-water-level');
  if(!((gate==='CLOSED'&&angle<=2&&countdown===0)||
       (gate==='OPEN'&&angle>=80&&countdown===0)||
       (gate==='COUNTDOWN'&&countdown>=1)||
       (gate==='OPENING_WARNING'&&countdown>=1)))
    return bad('inconsistent-reported-gate-state');
  // Status is a claim from untrusted serial, NOT independently sensed gate
  // position. The source v6 sketches have no gate position feedback device.
  const candidate={sequence,distanceCm,levelCm,risk};
  if(validateSyntheticFrame(candidate).ok!==true)
    return bad('canonical-water-frame-rejected');
  return Object.freeze({
    eligible:true,kind:'UNTRUSTED_V6_SERIAL_CANDIDATE_ONLY',
    candidate:Object.freeze(candidate),reported:{
      buzzerOn:buzzer==='1',gate,angle,countdown,rtcOnline:rtc==='1'
    },
    authenticated:false,canPublish:false,canAcknowledge:false,
    floodClearance:'UNKNOWN',gatePositionVerified:false
  });
}
