// FloodGuard R3 private evidence raw JSON parser. No filesystem, cloud,
// credential, hardware, or publication authority. Fail on ambiguous keys.
// The scanner walks already JSON.parse-validated bytes; JSON.parse alone
// silently discards shadowed keys. Do NOT echo offending key names.
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

export function parsePrivateEvidenceJson(raw) {
  const parsed=JSON.parse(raw);
  requireUniqueObjectKeys(raw);
  return parsed;
}
