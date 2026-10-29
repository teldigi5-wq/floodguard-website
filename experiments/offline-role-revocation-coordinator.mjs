// FloodGuard OFFLINE revocation coordinator. No network or Admin SDK here.
// Caller supplies test-only adapters; never import this as production service.
// Order matters: deny access in RTDB Rules BEFORE revoking refresh tokens.
// A crashed/incomplete operation never enables the role automatically.
const UID=/^ingest-(?:verifier|authority|observer)-stage-[a-z0-9-]{1,32}$/;
const fail=(step)=>Object.freeze({completed:false,manualRecoveryRequired:true,step});
const safeInt=x=>Number.isSafeInteger(x)&&x>=0;
const safeState=s=>s&&typeof s==='object'&&typeof s.enabled==='boolean'&&
  safeInt(s.roleGeneration)&&s.roleGeneration>0&&safeInt(s.revokeTime);

export function createOfflineRoleRevocationCoordinator({
  uid,roleStore,auth,clock
}={}){
  if(!UID.test(uid)||!Object.isFrozen(roleStore)||!Object.isFrozen(auth)||
     typeof roleStore.read!=='function'||
     typeof roleStore.disableRoleCAS!=='function'||
     typeof roleStore.advanceSessionCAS!=='function'||
     typeof auth.revokeRefreshTokens!=='function'||
     typeof auth.getUser!=='function'||typeof clock!=='function')
    throw TypeError('Explicit frozen emulator-only role and Auth adapters required');
  let pending=false;
  return Object.freeze({
    async revoke({expectedGeneration,resumeDisabled=false}={}){
      if(process.env.FG_REVOCATION_SAGA_TEST!=='1'||
         process.env.FIREBASE_AUTH_EMULATOR_HOST!=='127.0.0.1:9099'||
         process.env.FIREBASE_DATABASE_EMULATOR_HOST!=='127.0.0.1:9000'||
         process.env.GCLOUD_PROJECT!=='demo-fg-auth-lifecycle')
        return fail('local-emulator-only');
      if(!Number.isSafeInteger(expectedGeneration)||expectedGeneration<1||
         expectedGeneration>=2147483647||typeof resumeDisabled!=='boolean')
        return fail('operator-approval-invalid');
      if(pending)return fail('already-in-progress');
      pending=true;
      try{
        let initial;
        try{initial=await roleStore.read(uid);}catch{return fail('initial-state-unavailable');}
        if(!safeState(initial)||initial.roleGeneration!==expectedGeneration)
          return fail('initial-state-mismatch');
        if(initial.enabled){
          if(resumeDisabled)return fail('resume-requires-disabled-role');
          let disabled;
          try{disabled=await roleStore.disableRoleCAS(uid,expectedGeneration);}
          catch{return fail('disable-write-uncertain');}
          if(disabled!==true)return fail('disable-cas-conflict');
        }else if(!resumeDisabled){
          return fail('role-already-disabled-manual-resume');
        }
        // Verify the database state AFTER the potentially ambiguous write.
        // Refuse to contact Auth until the role is definitely disabled.
        let gated;
        try{gated=await roleStore.read(uid);}catch{return fail('disabled-state-unverified');}
        if(!safeState(gated)||gated.enabled||
           gated.roleGeneration!==expectedGeneration||
           gated.revokeTime<initial.revokeTime)
          return fail('disabled-state-unverified');
        try{await auth.revokeRefreshTokens(uid);}
        catch{return fail('auth-revocation-uncertain');}
        let record;
        try{record=await auth.getUser(uid);}
        catch{return fail('auth-cutoff-unavailable');}
        const timestamp=record?.tokensValidAfterTime;
        const millis=typeof timestamp==='string'?Date.parse(timestamp):NaN;
        const observedMs=clock();
        if(!Number.isFinite(millis)||!safeInt(observedMs)||
           millis<1000||millis>observedMs+300000)
          return fail('auth-cutoff-unverified');
        // Round UP so second-resolution auth_time cannot equal a revoked
        // millisecond boundary and accidentally pass the strict > rule.
        const cutoff=Math.max(initial.revokeTime,Math.ceil(millis/1000));
        if(!safeInt(cutoff))return fail('auth-cutoff-unverified');
        let committed;
        try{committed=await roleStore.advanceSessionCAS(uid,{
          expectedGeneration,cutoffSeconds:cutoff,
          nextGeneration:expectedGeneration+1
        });}catch{return fail('session-commit-uncertain');}
        if(committed!==true)return fail('session-cas-conflict');
        let verified;
        try{verified=await roleStore.read(uid);}catch{return fail('cutoff-persistence-unverified');}
        if(!safeState(verified)||verified.enabled||
           verified.roleGeneration!==expectedGeneration+1||
           verified.revokeTime<cutoff)
          return fail('cutoff-persistence-unverified');
        return Object.freeze({
          completed:true,roleDisabled:true,
          roleGeneration:verified.roleGeneration,
          revokeTime:verified.revokeTime,
          kind:'LOCAL_EMULATOR_REVOCATION_ONLY'
        });
      }finally{pending=false;}
    }
  });
}
