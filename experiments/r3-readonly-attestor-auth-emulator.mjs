// FloodGuard R3 — local Auth Emulator read-only attestation DB adapter.
// This module offers ONLY GET on three exact synthetic paths and cannot
// publish, confirm, issue credentials, operate a gate, or send any alert.
// A distinct read-only Auth Emulator principal is the authorization boundary
// tested by RTDB Rules; this code is NOT a secure production enclave.
const PROJECT='demo-r3-isolated-service-confirmer';
const DB='http://127.0.0.1:9000';
const NS=PROJECT+'-default-rtdb';
const ID='device-stage-a';
const ALLOWED=new Set([
  '/floodguard/attestorLabAuthorization/attestor-stage',
  '/floodguard/deviceAuthorization/'+ID,
  '/floodguard/confirmedLab/records/'+ID+'/2'
]);
export function createReadOnlyAttestorEmulatorDatabase({idToken}={}){
  if(process.env.FG_R3_READONLY_ATTESTOR_TEST!=='1'||
     process.env.GCLOUD_PROJECT!==PROJECT||
     process.env.FIREBASE_AUTH_EMULATOR_HOST!=='127.0.0.1:9099'||
     process.env.FIREBASE_DATABASE_EMULATOR_HOST!=='127.0.0.1:9000'||
     typeof idToken!=='string'||idToken.length<50||idToken.length>8192)
    throw Error('Read-only attestor requires pinned localhost Auth+RTDB Emulators');
  return Object.freeze({
    ref(path){
      if(!ALLOWED.has(path))throw Error('Read-only attestor denied path');
      return Object.freeze({
        async get(){
          const url=new URL(DB+path+'.json');
          url.searchParams.set('ns',NS);
          url.searchParams.set('auth',idToken);
          const response=await fetch(url,{method:'GET',
            signal:AbortSignal.timeout(5000)});
          if(!response.ok)throw Error('Read-only attestor RTDB Rules denied');
          const value=await response.json();
          return Object.freeze({val:()=>value});
        }
      });
    }
  });
}
