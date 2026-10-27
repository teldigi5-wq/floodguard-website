// Real loopback-only TLS request round trips; all keys, certs and frames synthetic.
// NO Firebase/WhatsApp, actual firmware, public endpoint or physical gate.
import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import https from 'node:https';
import {spawnSync} from 'node:child_process';
import {generateKeyPairSync,sign,randomBytes} from 'node:crypto';
import {once} from 'node:events';
import {createStage7OfflineLedger,canonicalOfflineEnvelope} from '../experiments/stage7-durable-ingress.mjs';
import {createLoopbackSignedIngressHandler,LOOPBACK_INGEST_PATH} from '../experiments/loopback-signed-https-ingress.mjs';

let dir,server,port,ca;
let ledger,registry,device,clock,ready=true;
const uid='device-stage-a',now=1700000000500;
const frame=seq=>({
  version:'floodguard-offline-envelope-v1',deviceId:uid,epoch:1,
  observedAtMs:now-500,
  frame:{sequence:seq,distanceCm:15,levelCm:10,risk:'WARNING'}
});
const signature=env=>sign(null,Buffer.from(canonicalOfflineEnvelope(env)),device.privateKey).toString('base64url');
function openssl(args){
  const v=spawnSync('openssl',args,{cwd:dir,encoding:'utf8',timeout:15000,stdio:'pipe'});
  assert.equal(v.status,0,'ephemeral OpenSSL fixture must be generated locally');
}
before(async()=>{
  dir=fs.mkdtempSync(path.join(os.tmpdir(),'floodguard-tls-ingress-'));
  openssl(['req','-x509','-newkey','rsa:2048','-nodes','-days','1',
    '-keyout','fixture.key','-out','fixture.crt',
    '-subj','/CN=localhost','-addext','subjectAltName=DNS:localhost']);
  ca=fs.readFileSync(path.join(dir,'fixture.crt'));
  device=generateKeyPairSync('ed25519');
  ledger=createStage7OfflineLedger({directory:dir,integrityKey:randomBytes(32)});
  registry=new Map([[uid,{
    enabled:true,scope:'prototype-ingest-v1',epoch:1,publicKey:device.publicKey
  }]]);
  clock=()=>now;
  const handler=createLoopbackSignedIngressHandler({
    identities:registry,ledger,clock,
    ledgerAvailable:()=>ready
  });
  server=https.createServer({
    key:fs.readFileSync(path.join(dir,'fixture.key')),cert:ca,
    minVersion:'TLSv1.2'
  },(req,res)=>void handler(req,res));
  server.listen(0,'127.0.0.1');await once(server,'listening');
  port=server.address().port;
});
after(async()=>{
  if(server?.listening)await new Promise(resolve=>server.close(resolve));
  if(dir)fs.rmSync(dir,{recursive:true,force:true});
});
function request({input,overrideSignature,method='POST',url=LOOPBACK_INGEST_PATH,
  contentType='application/json',servername='localhost',trusted=true}={}){
  const env=input??frame(1),body=JSON.stringify({
    envelope:env,signature:overrideSignature??signature(env)
  });
  return new Promise((resolve,reject)=>{
    const req=https.request({
      hostname:'127.0.0.1',port,path:url,method,servername,
      ca:trusted?ca:undefined,rejectUnauthorized:true,agent:false,
      timeout:3000,headers:{'content-type':contentType,'content-length':Buffer.byteLength(body)}
    },res=>{
      const chunks=[];
      res.on('data',v=>chunks.push(v));
      res.once('end',()=>{
        try{resolve({status:res.statusCode,payload:JSON.parse(Buffer.concat(chunks).toString())});}
        catch(err){reject(err);}
      });
    });
    req.once('timeout',()=>req.destroy(new Error('test-timeout')));
    req.once('error',reject);
    req.end(body);
  });
}
test('real trusted TLS handshake accepts a signed synthetic device frame into replay ledger',async()=>{
  const received=await request();
  assert.equal(received.status,201);
  assert.deepEqual(received.payload,{accepted:true,status:'LOCAL_LEDGER_ACCEPTED_ONLY'});
  assert.equal(ledger.last(uid).sequence,1);
  assert.equal(fs.existsSync(path.join(dir,'stage7-synthetic-ledger.json')),true);
});
test('valid repeated delivery is blocked and preserves durable sequence',async()=>{
  const rejected=await request();
  assert.equal(rejected.status,409);
  assert.equal(ledger.last(uid).sequence,1);
  const updated=await request({input:frame(2)});
  assert.equal(updated.status,201);
  assert.equal(ledger.last(uid).sequence,2);
});
test('forgery, wrong identity and revoked identity fail before replay commit',async()=>{
  const unsigned=await request({input:frame(3),overrideSignature:'A'.repeat(86)});
  assert.equal(unsigned.status,403);
  const wrong=frame(3);wrong.deviceId='device-stage-b';
  const bad=await request({input:wrong,overrideSignature:signature(frame(3))});
  assert.equal(bad.status,403);
  registry.get(uid).enabled=false;
  assert.equal((await request({input:frame(3)})).status,403);
  registry.get(uid).enabled=true;
  assert.equal(ledger.last(uid).sequence,2);
});
test('stale/future frames and unapproved firmware fields fail closed',async()=>{
  const expired={...frame(3),observedAtMs:now-30001};
  const future={...frame(3),observedAtMs:now+2001};
  assert.equal((await request({input:expired})).status,422);
  assert.equal((await request({input:future})).status,422);
  const command=frame(3);command.frame.gateCommand='OPEN';
  assert.equal((await request({input:command,overrideSignature:'A'.repeat(86)})).status,422);
  assert.equal(ledger.last(uid).sequence,2);
});
test('missing durable replay readiness blocks any signed device message',async()=>{
  ready=false;
  assert.deepEqual(await request({input:frame(3)}),{
    status:503,payload:{accepted:false,status:'replay-ledger-unavailable'}
  });
  ready=true;
  assert.equal(ledger.last(uid).sequence,2);
});
test('TLS trust and hostname are verified rather than bypassed',async()=>{
  await assert.rejects(request({trusted:false,input:frame(3)}),
    /certificate|verify|self.signed|issuer/i);
  await assert.rejects(request({servername:'attacker.invalid',input:frame(3)}),
    /hostname|altname|certificate/i);
  assert.equal(ledger.last(uid).sequence,2);
});
test('wrong route and content type do not accept signed data',async()=>{
  assert.equal((await request({url:'/floodguard/live',input:frame(3)})).status,404);
  assert.equal((await request({contentType:'text/plain',input:frame(3)})).status,415);
  assert.equal(ledger.last(uid).sequence,2);
});
test('restart with same HMAC key is required for replay history, not an anonymous fallback',()=>{
  const source=fs.readFileSync('experiments/loopback-signed-https-ingress.mjs','utf8');
  assert.doesNotMatch(source,/firebase-admin|FirebaseDatabase|FIREBASE_DATABASE_URL|process\.env|sendMessage\s*\(/);
  assert.doesNotMatch(source,/setInsecure|rejectUnauthorized\s*:\s*false/);
  assert.match(source,/req\.socket\.encrypted!==true/);
  assert.match(source,/ledgerAvailable\(\)/);
  assert.match(source,/ledger\.commit\(/);
  assert.equal(ledger.last(uid).sequence,2);
});
