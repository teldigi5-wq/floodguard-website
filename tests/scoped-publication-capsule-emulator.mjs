// Actual security-rules-enforced RTDB Emulator: NO rules-disabled publishing.
// The only privileged setup is synthetic test fixture seeding before tests.
import {before,after,beforeEach,afterEach,test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {generateKeyPairSync,randomBytes,sign,createHash} from 'node:crypto';
import {initializeTestEnvironment,assertFails,assertSucceeds}
  from '@firebase/rules-unit-testing';
import {canonicalOfflineEnvelope} from '../experiments/stage7-durable-ingress.mjs';
import {createDurableAdmissionOutboxLab}
  from '../experiments/durable-admission-outbox-lab.mjs';
import {CAPSULE_ROOT,deriveScopedPublicationCapsuleLab,
  observeScopedPublicationCapsuleLab}
  from '../experiments/scoped-publication-capsule-lab.mjs';

const UID='device-stage-a',NOW=1793450000500,HOST='127.0.0.1:9000';
if(process.env.FG_SCOPED_CAPSULE_LAB!=='1'||
   process.env.FIREBASE_DATABASE_EMULATOR_HOST!==HOST)
  throw Error('Disposable loopback RTDB Emulator required');
let env,dir,source,issuer,sourceBinding,outbox,publisher,guest;
const digest=x=>createHash('sha256').update(x).digest('hex');
const capsuleInitial=()=>({
  public:{
    water:{distanceCm:18.5,levelCm:6.5,status:'SAFE'},
    system:{lastUpdate:NOW-2500,overallRisk:'UNKNOWN'}
  },
  checkpoint:{initialized:false,epoch:1}
});
const lastReading=()=>outbox.pending(UID).at(-1);
const get=()=>publisher.ref(CAPSULE_ROOT).get();
async function elevated(callback){
  let val;await env.withSecurityRulesDisabled(async c=>{
    val=await callback(c.database());
  });return val;
}
function signed(sequence=1,changes={}){
  const envelope={version:'floodguard-offline-envelope-v1',deviceId:UID,
    epoch:1,observedAtMs:NOW-1200+sequence*300,
    frame:{sequence,distanceCm:16.5,levelCm:8.5,risk:'WARNING',...changes}};
  const deviceSignature=sign(null,Buffer.from(canonicalOfflineEnvelope(envelope)),
    source.privateKey).toString('base64url');
  const local=outbox.accept({envelope,signature:deviceSignature});
  assert.equal(local.accepted,true,JSON.stringify(local));
  const pending=lastReading();
  const receipt={version:'floodguard-offline-receipt-v1',
    deviceId:UID,epoch:1,sequence,digest:pending.digest,acceptedAtMs:NOW+50};
  const signature=sign(null,Buffer.from(JSON.stringify(receipt)),
    issuer.privateKey).toString('base64url');
  return {pending,receipt,signature};
}
async function transaction(packet,{binding=sourceBinding,receiptKey=issuer.publicKey}={}){
  let candidate=null;
  const ref=publisher.ref(CAPSULE_ROOT);
  // Fetch a server-authorized snapshot, not just an empty local cache event.
  const initial=(await assertSucceeds(ref.get())).val();
  assert.ok(initial?.public?.water&&initial?.checkpoint,
    'scoped publication capsule must be readable before transaction');
  // RTDB transaction reads root using its authenticated scoped capability.
  await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(Error('publisher scoped listener timeout')),4000);
    const onValue=()=>{clearTimeout(timer);ref.off('value',onValue);resolve();};
    ref.on('value',onValue,e=>{clearTimeout(timer);reject(e);});
  });
  const result=await ref.transaction(current=>{
    candidate=deriveScopedPublicationCapsuleLab({
      current,pending:packet.pending,
      receipt:packet.receipt,receiptSignature:packet.signature,
      sourceBinding:binding,trustedReceiptKey:receiptKey,nowMs:NOW+100
    });
    return candidate.allowed===true?candidate.next:undefined;
  },undefined,false);
  return {committed:result.committed,reason:candidate?.reason,
    capsule:(await get()).val()};
}
async function readback(pending){
  const current=(await get()).val();
  return observeScopedPublicationCapsuleLab({
    current,pending,sourceBinding,trustedReceiptKey:issuer.publicKey,
    nowMs:NOW+100
  });
}
before(async()=>{
  env=await initializeTestEnvironment({
    projectId:'demo-fg-scoped-capsule',
    database:{host:'127.0.0.1',port:9000,
      rules:readFileSync('tests/fixtures/scoped-publication-capsule-lab.rules.json','utf8')}
  });
});
after(async()=>{if(env)await env.cleanup();});
beforeEach(async()=>{
  await env.clearDatabase();
  dir=mkdtempSync(path.join(os.tmpdir(),'fg-scoped-capsule-'));
  source=generateKeyPairSync('ed25519');
  issuer=generateKeyPairSync('ed25519');
  sourceBinding={deviceId:UID,epoch:1,enabled:true,
    scope:'prototype-ingest-v1',publicKey:source.publicKey};
  outbox=createDurableAdmissionOutboxLab({
    directory:dir,clock:()=>NOW,integrityKey:randomBytes(32),
    identities:new Map([[UID,sourceBinding]])
  });
  outbox.commission();
  await elevated(db=>db.ref('/').set({
    floodguard:{privateIngest:{esp8266:{wifi:'SYNTHETIC_PRIVATE_WIFI',ip:'127.0.0.2'}},
      deviceAuthorization:{[UID]:{enabled:true,scope:'prototype-ingest-v1'}}},
    floodguardPublicationLabV2:capsuleInitial()
  }));
  publisher=env.authenticatedContext('publisher-stage-a',{fgCapsulePublisher:true}).database();
  guest=env.unauthenticatedContext().database();
});
afterEach(()=>{if(dir)rmSync(dir,{recursive:true,force:true});});

test('authenticated scoped publisher commits signed capsule without root Admin permission',async()=>{
  const packet=signed();
  const result=await transaction(packet);
  assert.equal(result.committed,true,result.reason);
  assert.equal(result.capsule.public.water.status,'WARNING');
  assert.equal(result.capsule.checkpoint.digest,packet.pending.digest);
  assert.equal(result.capsule.history.entries.s_1.receiptSignature,packet.signature);
  const proof=await readback(packet.pending);
  assert.equal(proof.observed,true,JSON.stringify(proof));
  assert.equal(proof.canAcknowledge,false);
  assert.equal(outbox.pending(UID).length,1);
  const sensitive=await elevated(async db=>(await db.ref('/floodguard/privateIngest/esp8266').get()).val());
  assert.equal(sensitive.wifi,'SYNTHETIC_PRIVATE_WIFI');
});

test('publisher cannot read or modify unrelated legacy tree, private network metadata or root',async()=>{
  for(const p of ['/','/floodguard','/floodguard/privateIngest',
    '/floodguard/privateIngest/esp8266/wifi',
    '/floodguard/deviceAuthorization/'+UID]){
    await assertFails(publisher.ref(p).get());
    await assertFails(publisher.ref(p).set('FORGED'));
  }
  await assertFails(guest.ref(CAPSULE_ROOT).get());
  await assertFails(guest.ref(CAPSULE_ROOT).set('FORGED'));
});

test('anonymous and impersonated publisher identities have no capsule read/write',async()=>{
  const wrongClaim=env.authenticatedContext('publisher-stage-a').database();
  const wrongUid=env.authenticatedContext('wrong-stage-user',{fgCapsulePublisher:true}).database();
  for(const db of [guest,wrongClaim,wrongUid]){
    await assertFails(db.ref(CAPSULE_ROOT).get());
    await assertFails(db.ref(CAPSULE_ROOT).set(capsuleInitial()));
  }
  const pub=env.authenticatedContext('publisher-stage-a',{fgCapsulePublisher:true}).database();
  await assertSucceeds(pub.ref(CAPSULE_ROOT).get());
});

test('public readers access individual scalars, never groups/checkpoint/history',async()=>{
  await transaction(signed());
  assert.equal((await assertSucceeds(
    guest.ref(CAPSULE_ROOT+'/public/water/status').get())).val(),'WARNING');
  for(const p of [CAPSULE_ROOT,CAPSULE_ROOT+'/public',
    CAPSULE_ROOT+'/public/water',CAPSULE_ROOT+'/checkpoint',
    CAPSULE_ROOT+'/history',CAPSULE_ROOT+'/history/entries/s_1'])
    await assertFails(guest.ref(p).get());
  await assertFails(guest.ref(CAPSULE_ROOT+'/public/water/status').set('SAFE'));
});

test('Firebase rules refuse nested public objects and unexpected public fields even for scoped publisher',async()=>{
  await transaction(signed());
  const before=(await get()).val();
  await assertFails(publisher.ref(CAPSULE_ROOT+'/public/water/status').set({
    wifi:'SYNTHETIC_PRIVATE'
  }));
  await assertFails(publisher.ref(CAPSULE_ROOT+'/public/water/privateWifi').set('SECRET'));
  await assertFails(publisher.ref(CAPSULE_ROOT+'/privateIngest').set({secret:'PRIVATE'}));
  assert.deepEqual((await get()).val(),before);
});

test('rules prohibit deletion of required public fields and invalid enum/ranges',async()=>{
  await transaction(signed());
  await assertFails(publisher.ref(CAPSULE_ROOT+'/public/water/status').remove());
  await assertFails(publisher.ref(CAPSULE_ROOT+'/public/water/status').set('UNCERTAIN_PENDING'));
  await assertFails(publisher.ref(CAPSULE_ROOT+'/public/water/distanceCm').set(-1));
  await assertFails(publisher.ref(CAPSULE_ROOT+'/public/system/overallRisk').set('LOW'));
});

test('replay after a valid transaction produces no new private history entry',async()=>{
  const packet=signed();
  assert.equal((await transaction(packet)).committed,true);
  const again=await transaction(packet);
  assert.equal(again.committed,false);
  assert.equal(again.reason,'replay-or-out-of-order');
  assert.deepEqual(Object.keys((await get()).val().history.entries),['s_1']);
  assert.equal((await readback(packet.pending)).observed,true);
});

test('revoked source, forged server signature and malformed device data fail closed',async()=>{
  const packet=signed();
  const disabled={...sourceBinding,enabled:false};
  assert.equal((await transaction(packet,{binding:disabled})).committed,false);
  assert.equal((await transaction({...packet,signature:'A'.repeat(86)})).committed,false);
  assert.equal((await get()).val().history,undefined);
  const dev=generateKeyPairSync('ed25519');
  assert.equal((await transaction(packet,{binding:{...sourceBinding,publicKey:dev.publicKey}})).committed,false);
});

test('second signed publication atomically extends history and replaces only approved scalars',async()=>{
  assert.equal((await transaction(signed(1))).committed,true);
  const old=(await get()).val().history.entries.s_1;
  const second=signed(2,{distanceCm:13.5,levelCm:11.5,risk:'DANGER'});
  assert.equal((await transaction(second)).committed,true);
  const current=(await get()).val();
  assert.deepEqual(current.history.entries.s_1,old);
  assert.equal(current.history.entries.s_2.digest,second.pending.digest);
  assert.equal(current.public.water.status,'DANGER');
  assert.equal((await readback(outbox.pending(UID)[0])).observed,true);
  assert.equal(outbox.pending(UID).length,2);
});

test('test-only source and rules do not expose legacy data or carry live credentials',()=>{
  const src=readFileSync('experiments/scoped-publication-capsule-lab.mjs','utf8');
  assert.equal(src.includes('firebase-admin'),false);
  assert.equal(src.includes('serviceAccount'),false);
  assert.equal(src.includes('node:https'),false);
  assert.doesNotMatch(src,/\.acknowledge\s*\(|\.delete\s*\(|\.remove\s*\(/);
});
