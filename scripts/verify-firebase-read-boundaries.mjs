// Anonymous GET-only RTDB access boundary auditor. Never writes,
// authenticates, follows redirects or reads/logs response bodies.
// PASS verifies access status, NOT contents of public leaves or write policy.
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
export const ALLOWED_PUBLIC_PATHS=Object.freeze([
  'floodguard/live/water','floodguard/live/rain',
  'floodguard/live/gate','floodguard/live/alarm',
  'floodguard/live/devices','floodguard/live/system',
  'floodguard/live/esp8266/connection',
  'floodguard/live/esp8266/rssi','floodguard/live/esp8266/status'
]);
export const MUST_DENY_PATHS=Object.freeze([
  '', 'floodguard','floodguard/live',
  'floodguard/live/esp8266','floodguard/live/esp8266/ip',
  'floodguard/live/esp8266/wifi','floodguard/bot',
  'floodguard/confirmedIngest','floodguard/staging',
  'floodguard/projectionControl','floodguard/evidenceLabAuthorization'
]);
const hostPattern=/^[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:firebasedatabase\.app|firebaseio\.com)$/;
export function validateFirebaseUrl(value){
  if(typeof value!=='string'||!value||value.trim()!==value)
    throw TypeError('A Firebase RTDB HTTPS origin is required');
  const url=new URL(value);
  if(url.protocol!=='https:'||!hostPattern.test(url.hostname.toLowerCase())||
    url.port||url.username||url.password||url.search||url.hash||
    (url.pathname!==''&&url.pathname!=='/'))
    throw Error('Expected a Firebase RTDB HTTPS origin without port, path, token, query or fragment');
  return url.origin;
}
export async function checkReadBoundaries({databaseUrl,fetcher=fetch,timeoutMs=8000}={}){
  const origin=validateFirebaseUrl(databaseUrl);
  if(typeof fetcher!=='function'||!Number.isSafeInteger(timeoutMs)||
     timeoutMs<100||timeoutMs>30000)
    throw TypeError('Invalid read-only boundary probe options');
  const results=[];
  for(const [path,expected] of [
    ...ALLOWED_PUBLIC_PATHS.map(p=>[p,'allow']),
    ...MUST_DENY_PATHS.map(p=>[p,'deny'])
  ]){
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),timeoutMs);
    try{
      const response=await fetcher(
        origin+'/'+(path?path+'.json':'.json'),{
          method:'GET',redirect:'manual',cache:'no-store',
          credentials:'omit',signal:controller.signal
        });
      try{await response.body?.cancel?.();}catch{/* already closed */}
      const code=response.status;
      const success=expected==='allow'?code===200:code===401||code===403;
      results.push({path:path||'(database root)',expected,status:code,success});
    }catch{
      results.push({path:path||'(database root)',expected,status:'NETWORK_ERROR',success:false});
    }finally{clearTimeout(timer);}
  }
  return {passed:results.every(row=>row.success),results};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const url=process.env.FG_RTDB_URL;
  if(!url){
    console.error('Set FG_RTDB_URL to a confirmed Firebase RTDB HTTPS root URL. No writes or authentication performed.');
    process.exitCode=2;
  }else{
    try{
      const report=await checkReadBoundaries({databaseUrl:url});
      for(const row of report.results)
        console.log((row.success?'PASS':'FAIL')+' '+row.path+' expected='+row.expected+' HTTP='+row.status);
      console.log(report.passed
        ?'Read access boundary statuses passed. Public contents, production writes and source authenticity NOT assessed.'
        :'Read boundary failure/unverified. No database records or security rules were modified.');
      process.exitCode=report.passed?0:1;
    }catch{
      console.error('Invalid Firebase origin or unsafe audit options.');
      process.exitCode=2;
    }
  }
}
