// FloodGuard PUBLIC PROJECTION DESIGN LAB ONLY.
// A deterministic, whitelist-only copy from an ALREADY authenticated
// publisher's verified observations. This function does NOT authenticate,
// sign, determine sensor freshness, publish or control hardware.
// Never pass its return directly to the existing /floodguard/live paths.
const schemas=Object.freeze({
  water:Object.freeze({
    distanceCm:['number',0,400],levelCm:['number',0,25],
    status:['enum','SAFE','WARNING','DANGER','SENSOR_ERROR','UNKNOWN']
  }),
  rain:Object.freeze({
    currentMm:['number',0,10000],dailyMm:['number',0,10000],
    status:['enum','NORMAL','HEAVY_RAIN','FLOOD_WARNING',
      'EXTREME','CRITICAL','NOT_INSTALLED','UNKNOWN']
  }),
  gate:Object.freeze({
    status:['enum','CLOSED','COUNTDOWN','OPENING','OPEN','CLOSING','UNKNOWN'],
    angle:['number',0,90],countdownSeconds:['int',0,3600],
    reason:['string',40]
  }),
  alarm:Object.freeze({
    active:['boolean'],type:['string',40]
  }),
  devices:Object.freeze(Object.fromEntries(
    ['arduino','gsm','microSD','rainGauge','rtc','servo','ultrasonic']
      .map(x=>[x,['enum','ONLINE','OFFLINE','ERROR','NOT_INSTALLED','UNKNOWN']])
  )),
  system:Object.freeze({
    // A system heartbeat is NOT independently verified sensor freshness.
    lastUpdate:['timestamp'],
    overallRisk:['enum','LOW','MODERATE','HIGH','SEVERE','CRITICAL','UNKNOWN']
  }),
  esp8266:Object.freeze({
    connection:['enum','ONLINE','OFFLINE','UNKNOWN'],
    rssi:['number',-130,0],
    status:['enum','ONLINE','OFFLINE','ERROR','UNKNOWN']
  })
});
export const PUBLIC_TELEMETRY_LAB_ROOT='/floodguard/publicTelemetryLabV1';
export const PUBLIC_TELEMETRY_LAB_FIELDS=Object.freeze(
  Object.fromEntries(Object.entries(schemas).map(([group,fields])=>[
    group,Object.freeze(Object.keys(fields))
  ]))
);
function plain(v){
  return v!==null&&typeof v==='object'&&!Array.isArray(v)&&
    (Object.getPrototypeOf(v)===Object.prototype||
     Object.getPrototypeOf(v)===null);
}
function valid(v,spec){
  if(spec[0]==='number')return typeof v==='number'&&Number.isFinite(v)&&
    v>=spec[1]&&v<=spec[2];
  if(spec[0]==='int')return Number.isSafeInteger(v)&&
    v>=spec[1]&&v<=spec[2];
  if(spec[0]==='string')return typeof v==='string'&&v.length<=spec[1]&&
    /^[a-zA-Z0-9 _-]*$/.test(v);
  if(spec[0]==='boolean')return typeof v==='boolean';
  if(spec[0]==='enum')return typeof v==='string'&&spec.slice(1).includes(v);
  if(spec[0]==='timestamp')return (Number.isSafeInteger(v)&&v>=946684800000&&
    v<=8640000000000000)||
    (typeof v==='string'&&v.length<=40&&!Number.isNaN(Date.parse(v))&&
      /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(v));
  return false;
}
/**
 * Project a private/inbound snapshot to STRICT public primitive fields only.
 * Unknown keys (including nested secrets) are NEVER copied or traversed.
 * Invalid allowlisted fields FAIL the whole projection; caller must not
 * publish partial frame or substitute a supposedly "safe" status.
 *
 * @param {unknown} source
 * @returns {Record<string,Record<string,string|number|boolean>>}
 */
export function projectPublicTelemetryLabV1(source){
  if(!plain(source))throw Error('Invalid private telemetry source');
  const out=Object.create(null);
  for(const [group,fields] of Object.entries(schemas)){
    if(!Object.hasOwn(source,group))continue;
    const input=source[group];
    if(!plain(input))throw Error('Invalid telemetry group: '+group);
    const projected=Object.create(null);
    for(const [field,spec] of Object.entries(fields)){
      if(!Object.hasOwn(input,field))continue;
      const value=input[field];
      if(!valid(value,spec))throw Error('Invalid public field: '+group+'.'+field);
      projected[field]=value;
    }
    if(Object.keys(projected).length)out[group]=projected;
  }
  if(!Object.keys(out).length)throw Error('No public telemetry fields supplied');
  return out;
}
