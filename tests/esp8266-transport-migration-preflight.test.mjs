// Real localhost HTTPS regression with disposable signed device identities.
// This is NOT flashed ESP8266 firmware, cloud publication or human alerting.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import https from 'node:https';
import {once} from 'node:events';
import {spawnSync} from 'node:child_process';
import {generateKeyPairSync,randomBytes,sign} from 'node:crypto';
import {canonicalOfflineEnvelope} from '../experiments/stage7-durable-ingress.mjs';
import {createDurableAdmissionOutboxLab}
  from '../experiments/durable-admission-outbox-lab.mjs';
import {createLoopbackSignedIngressHandler}
  from '../experiments/loopback-signed-https-ingress.mjs';
import {postSignedLoopbackFramePreflight}
  from '../experiments/esp8266-transport-migration-preflight.mjs';

const UID='device-stage-a',NOW=1793450000500;
async function fixture(callback,{wrongHostname=false,dropFirst201=false,
  fakeReply=false}={}){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'fg-esp-transport-preflight-'));
  let server;
  try{
    const certName=wrongHostname?'not-localhost.invalid':'localhost';
    const cmd=spawnSync('openssl',[
      'req','-x509','-newkey','rsa:2048','-nodes','-days','1',
      '-keyout','server.key','-out','server.crt',
      '-subj','/CN='+certName,
      '-addext','subjectAltName=DNS:'+certName
    ],{cwd:dir,encoding:'utf8',timeout:15000,stdio:'pipe'});
    assert.equal(cmd.status,0,'generate ephemeral local trust anchor');
    const ca=fs.readFileSync(path.join(dir,'server.crt'),'utf8');
    const wrong=spawnSync('openssl',[
      'req','-x509','-newkey','rsa:2048','-nodes','-days','1',
      '-keyout','untrusted.key','-out','untrusted.crt',
      '-subj','/CN=untrusted.invalid',
      '-addext','subjectAltName=DNS:untrusted.invalid'
    ],{cwd:dir,encoding:'utf8',timeout:15000,stdio:'pipe'});
    assert.equal(wrong.status,0,'generate unrelated disposable CA');
    const untrustedCa=fs.readFileSync(path.join(dir,'untrusted.crt'),'utf8');
    const device=generateKeyPairSync('ed25519');
    const registry=new Map([[UID,{enabled:true,epoch:1,
      scope:'prototype-ingest-v1',publicKey:device.publicKey}]]);
    const journal=createDurableAdmissionOutboxLab({
      directory:dir,integrityKey:randomBytes(32),
      identities:registry,clock:()=>NOW
    });
    journal.commission();
    let online=true;
    const handler=createLoopbackSignedIngressHandler({
      identities:registry,admissionJournal:journal,
      ledgerAvailable:()=>online,clock:()=>NOW
    });
    let first=dropFirst201;
    server=https.createServer({
      key:fs.readFileSync(path.join(dir,'server.key')),
      cert:ca,minVersion:'TLSv1.2'
    },(req,res)=>{
      if(fakeReply){
        res.writeHead(201,{'content-type':'application/json'});
        res.end(JSON.stringify({accepted:true,status:'CLOUD_CONFIRMED'}));return;
      }
      if(first){
        const original=res.end.bind(res);
        res.end=(...args)=>{
          if(first&&res.statusCode===201){
            first=false;
            req.socket.destroy(); // after the signed journal has fsynced
            return res;
          }
          return original(...args);
        };
      }
      void handler(req,res);
    });
    server.listen(0,'127.0.0.1');
    await once(server,'listening');
    const port=server.address().port;
    const envelope=(sequence=1,observedAtMs=NOW-500)=>({
      version:'floodguard-offline-envelope-v1',
      deviceId:UID,epoch:1,observedAtMs,
      frame:{sequence,distanceCm:16.5,levelCm:8.5,risk:'WARNING'}
    });
    const signature=e=>sign(null,Buffer.from(canonicalOfflineEnvelope(e)),
      device.privateKey).toString('base64url');
    const send=(e=envelope(),sig=signature(e),options={})=>
      postSignedLoopbackFramePreflight({
        port,caPem:ca,envelope:e,signature:sig,timeoutMs:2000,...options
      });
    await callback({send,envelope,signature,ca,untrustedCa,port,journal,registry,
      setOnline:x=>{online=x;},device,dir});
  }finally{
    if(server?.listening)await new Promise(resolve=>server.close(resolve));
    fs.rmSync(dir,{recursive:true,force:true});
  }
}
function assertNoCloudReceipt(result){
  assert.equal(result.cloudConfirmed,false);
  assert.equal(result.canAcknowledge,false);
  assert.equal(result.canDequeue,false);
  assert.equal(result.notificationDelivered,false);
  assert.equal(result.gatePositionVerified,false);
}
test('trusted TLS locally admits original device-signed frame but not cloud delivery',async()=>{
  await fixture(async h=>{
    const e=h.envelope();
    const r=await h.send(e);
    assert.equal(r.outcome,'LOCAL_DURABLE_ONLY');
    assert.equal(r.httpStatus,201);
    assert.equal(r.localAdmissionOnly,true);
    assertNoCloudReceipt(r);
    const pending=h.journal.pending(UID);
    assert.equal(pending.length,1);
    assert.deepEqual(pending[0].envelope,e);
    assert.equal(pending[0].signature,h.signature(e));
  });
});
test('repeated signed sequence gets conflict, never an ACK or silent re-sequence',async()=>{
  await fixture(async h=>{
    const e=h.envelope();
    assert.equal((await h.send(e)).outcome,'LOCAL_DURABLE_ONLY');
    const conflict=await h.send(e);
    assert.equal(conflict.outcome,'DUPLICATE_OR_IDENTITY_CONFLICT');
    assert.equal(conflict.httpStatus,409);
    assertNoCloudReceipt(conflict);
    assert.deepEqual(h.journal.pending(UID).map(x=>x.sequence),[1]);
  });
});
test('lost HTTP response after journal fsync stays uncertain; duplicate retry cannot clear queue',async()=>{
  await fixture(async h=>{
    const e=h.envelope();
    const first=await h.send(e);
    assert.equal(first.outcome,'RETRY_UNCERTAIN');
    assertNoCloudReceipt(first);
    assert.deepEqual(h.journal.pending(UID).map(x=>x.sequence),[1]);
    const second=await h.send(e);
    assert.equal(second.outcome,'DUPLICATE_OR_IDENTITY_CONFLICT');
    assertNoCloudReceipt(second);
    assert.deepEqual(h.journal.pending(UID).map(x=>x.sequence),[1]);
  },{dropFirst201:true});
});
test('device TLS rejects an untrusted self-signed server without inserting a frame',async()=>{
  await fixture(async h=>{
    const result=await h.send(h.envelope(),undefined,{
      caPem:h.untrustedCa
    });
    assert.equal(result.outcome,'TLS_TRUST_FAILURE');
    assertNoCloudReceipt(result);
    assert.deepEqual(h.journal.pending(UID),[]);
  });
});
test('device TLS rejects wrong SAN even when the server cert is trusted',async()=>{
  await fixture(async h=>{
    const result=await h.send();
    assert.equal(result.outcome,'TLS_TRUST_FAILURE');
    assertNoCloudReceipt(result);
    assert.deepEqual(h.journal.pending(UID),[]);
  },{wrongHostname:true});
});
test('invalid or revoked device signature never enters durable admission',async()=>{
  await fixture(async h=>{
    const fake=await h.send(h.envelope(), 'A'.repeat(86));
    assert.equal(fake.outcome,'REJECTED_NO_FORWARD');
    assert.equal(fake.httpStatus,403);
    h.registry.get(UID).enabled=false;
    const revoked=await h.send();
    assert.equal(revoked.outcome,'REJECTED_NO_FORWARD');
    assertNoCloudReceipt(revoked);
    assert.deepEqual(h.journal.pending(UID),[]);
  });
});
test('unready journal is an uncertain outage, never a positive receipt',async()=>{
  await fixture(async h=>{
    h.setOnline(false);
    const r=await h.send();
    assert.equal(r.outcome,'RETRY_UNCERTAIN');
    assert.equal(r.httpStatus,503);
    assertNoCloudReceipt(r);
    assert.deepEqual(h.journal.pending(UID),[]);
  });
});
test('stale signed reading is rejected instead of being silently refreshed or re-signed',async()=>{
  await fixture(async h=>{
    const e=h.envelope(1,NOW-31000);
    const rejected=await h.send(e);
    assert.equal(rejected.outcome,'REJECTED_NO_FORWARD');
    assert.equal(rejected.httpStatus,422);
    assertNoCloudReceipt(rejected);
    assert.deepEqual(h.journal.pending(UID),[]);
  });
});
test('unknown claimed cloud confirmation from arbitrary TLS server is not trusted',async()=>{
  await fixture(async h=>{
    const r=await h.send();
    assert.equal(r.outcome,'UNVERIFIED_RESPONSE');
    assertNoCloudReceipt(r);
    assert.deepEqual(h.journal.pending(UID),[]);
  },{fakeReply:true});
});
test('invalid transport parameters and unsigned frame are denied before any socket',async()=>{
  await fixture(async h=>{
    const e=h.envelope();
    for(const config of [
      {port:0},{port:65536},{timeoutMs:1},{caPem:''}
    ]){
      const r=await h.send(e,h.signature(e),config);
      assert.equal(r.outcome,'INVALID_PREFLIGHT_CONFIGURATION');
      assertNoCloudReceipt(r);
    }
    const r=await h.send(e,'invalid-signature');
    assert.equal(r.outcome,'INVALID_PREFLIGHT_CONFIGURATION');
    assert.deepEqual(h.journal.pending(UID),[]);
  });
});
test('no public hostname, untrusted TLS, Firebase writes, keys or firmware changes',()=>{
  const src=fs.readFileSync('experiments/esp8266-transport-migration-preflight.mjs','utf8');
  assert.match(src,/rejectUnauthorized:true/);
  assert.match(src,/servername:'localhost'/);
  assert.match(src,/host:'127.0.0.1'/);
  for(const needle of ['setInsecure(', 'rejectUnauthorized:false','firebase-admin',
    'FirebaseDatabase','serviceAccount','WiFiClientSecure','servo.write',
    'HTTPClient','process.env','setInterval(','createServer('])
    assert.equal(src.includes(needle),false,needle);
});
