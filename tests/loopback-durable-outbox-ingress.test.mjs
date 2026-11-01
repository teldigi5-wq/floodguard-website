// Real local TLS integration; all ephemeral keys and readings are synthetic.
// NO Firebase, public listener, firmware traffic, notifications or gate control.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import https from 'node:https';
import {once} from 'node:events';
import {spawnSync} from 'node:child_process';
import {generateKeyPairSync,randomBytes,sign} from 'node:crypto';
import {canonicalOfflineEnvelope} from '../experiments/stage7-durable-ingress.mjs';
import {createLoopbackSignedIngressHandler,LOOPBACK_INGEST_PATH}
  from '../experiments/loopback-signed-https-ingress.mjs';
import {createDurableAdmissionOutboxLab}
  from '../experiments/durable-admission-outbox-lab.mjs';

const UID='device-stage-a',NOW=1793450000500;
async function fixture(fn,{commissioned=true}={}) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'fg-loopback-outbox-'));
  const pair=generateKeyPairSync('ed25519');
  const registry=new Map([[UID,{
    enabled:true,epoch:1,scope:'prototype-ingest-v1',publicKey:pair.publicKey
  }]]);
  let now=NOW,online=true;
  const key=randomBytes(32);
  const journal=createDurableAdmissionOutboxLab({
    directory:dir,integrityKey:key,identities:registry,clock:()=>now
  });
  if(commissioned)journal.commission();
  const handler=createLoopbackSignedIngressHandler({
    identities:registry,admissionJournal:journal,ledgerAvailable:()=>online,
    clock:()=>now
  });
  let server;
  try {
    const openssl=spawnSync('openssl',[
      'req','-x509','-newkey','rsa:2048','-nodes','-days','1',
      '-keyout','localhost.key','-out','localhost.crt',
      '-subj','/CN=localhost','-addext','subjectAltName=DNS:localhost'
    ],{cwd:dir,encoding:'utf8',timeout:15000,stdio:'pipe'});
    assert.equal(openssl.status,0,'ephemeral TLS certificate generated');
    const ca=fs.readFileSync(path.join(dir,'localhost.crt'));
    server=https.createServer({
      key:fs.readFileSync(path.join(dir,'localhost.key')),cert:ca,
      minVersion:'TLSv1.2'
    },(req,res)=>void handler(req,res));
    server.listen(0,'127.0.0.1');await once(server,'listening');
    const port=server.address().port;
    const envelope=(sequence=1,overrides={})=>({
      version:'floodguard-offline-envelope-v1',deviceId:UID,epoch:1,
      observedAtMs:now-500,
      frame:{sequence,distanceCm:16.5,levelCm:8.5,risk:'WARNING',...overrides}
    });
    const signature=e=>sign(null,Buffer.from(canonicalOfflineEnvelope(e)),
      pair.privateKey).toString('base64url');
    const send=({input,signatureOverride,method='POST',
      url=LOOPBACK_INGEST_PATH,contentType='application/json',
      trusted=true,servername='localhost'}={})=>{
      const e=input??envelope();
      const data=JSON.stringify({envelope:e,signature:signatureOverride??signature(e)});
      return new Promise((resolve,reject)=>{
        const req=https.request({
          hostname:'127.0.0.1',port,path:url,method,servername,
          ca:trusted?ca:undefined,rejectUnauthorized:true,agent:false,
          timeout:3500,
          headers:{'content-type':contentType,'content-length':Buffer.byteLength(data)}
        },res=>{
          const chunks=[];
          res.on('data',v=>chunks.push(v));
          res.once('end',()=>{
            try{resolve({status:res.statusCode,
              result:JSON.parse(Buffer.concat(chunks).toString())});}
            catch(error){reject(error);}
          });
        });
        req.once('timeout',()=>req.destroy(Error('synthetic-test-timeout')));
        req.once('error',reject);
        req.end(data);
      });
    };
    await fn({dir,port,ca,registry,pair,key,journal,envelope,signature,send,
      setOnline:v=>{online=v;},setNow:v=>{now=v;},
      createAgain:()=>createDurableAdmissionOutboxLab({
        directory:dir,integrityKey:key,identities:registry,clock:()=>now
      })});
  }finally{
    if(server?.listening)await new Promise(resolve=>server.close(resolve));
    fs.rmSync(dir,{recursive:true,force:true});
  }
}

test('trusted loopback TLS returns local-only ACK after full signed frame fsync',async()=>{
  await fixture(async h=>{
    const e=h.envelope(),sig=h.signature(e);
    assert.deepEqual(await h.send({input:e}),{
      status:201,result:{accepted:true,status:'LOCAL_DURABLE_ADMISSION_ONLY'}
    });
    const pending=h.createAgain().pending(UID);
    assert.equal(pending.length,1);
    assert.deepEqual(pending[0].envelope,e);
    assert.equal(pending[0].signature,sig);
    assert.equal(pending[0].sequence,1);
    assert.equal(fs.existsSync(path.join(h.dir,'stage7-synthetic-ledger.json')),false,
      'new path must not double-commit to prior replay ledger');
  });
});

test('reboot retains complete frame, rejects duplicate and permits next sequence',async()=>{
  await fixture(async h=>{
    assert.equal((await h.send()).status,201);
    assert.equal((await h.send()).status,409);
    const two=h.envelope(2);
    assert.equal((await h.send({input:two})).status,201);
    assert.deepEqual(h.createAgain().pending(UID).map(x=>x.sequence),[1,2]);
  });
});

test('forgery, revoked device and contradictory measurements do not enter journal',async()=>{
  await fixture(async h=>{
    const e=h.envelope();
    assert.equal((await h.send({input:e,signatureOverride:'A'.repeat(86)})).status,403);
    assert.equal((await h.send({input:h.envelope(1,{risk:'SAFE'}),
      signatureOverride:'A'.repeat(86)})).status,422);
    const binding=h.registry.get(UID);
    h.registry.set(UID,{...binding,enabled:false});
    assert.equal((await h.send()).status,403);
    assert.deepEqual(h.journal.pending(UID),[]);
    h.registry.set(UID,binding);
    assert.equal((await h.send()).status,201);
  });
});

test('missing commission and independent outage block admission until operator restores',async()=>{
  await fixture(async h=>{
    assert.deepEqual(await h.send(),{
      status:503,result:{accepted:false,status:'replay-ledger-unavailable'}
    });
    h.journal.commission();
    h.setOnline(false);
    assert.equal((await h.send()).status,503);
    h.setOnline(true);
    assert.equal((await h.send()).status,201);
    assert.equal(h.journal.pending(UID).length,1);
  },{commissioned:false});
});

test('journal loss, corrupted marker and missing history return 503, not fresh ACK',async()=>{
  await fixture(async h=>{
    assert.equal((await h.send()).status,201);
    const file=path.join(h.dir,'durable-admission-outbox-lab.json');
    fs.unlinkSync(file);
    assert.equal((await h.send({input:h.envelope(2)})).status,503);
    assert.throws(()=>h.journal.commission());
    assert.equal(h.createAgain().ready(),false);
  });
  await fixture(async h=>{
    const marker=path.join(h.dir,'durable-admission-commissioned.marker.json');
    const state=fs.readFileSync(marker,'utf8');
    fs.writeFileSync(marker,state.replace('commission-v1','commission-v2'));
    assert.equal((await h.send()).status,503);
  });
});

test('bounded queue returns 503 rather than dropping any of eight admitted frames',async()=>{
  await fixture(async h=>{
    for(let n=1;n<=8;n++)
      assert.equal((await h.send({input:h.envelope(n)})).status,201);
    assert.equal((await h.send({input:h.envelope(9)})).status,503);
    assert.deepEqual(h.createAgain().pending(UID).map(x=>x.sequence),[1,2,3,4,5,6,7,8]);
  });
});

test('TLS CA and hostname mismatches cannot reach the journal',async()=>{
  await fixture(async h=>{
    await assert.rejects(h.send({trusted:false}),/certificate|verify|issuer|self.signed/i);
    await assert.rejects(h.send({servername:'wrong.invalid'}),/hostname|altname|certificate/i);
    assert.deepEqual(h.journal.pending(UID),[]);
  });
});

test('legacy route, unsupported media and aged reading do not enter journal',async()=>{
  await fixture(async h=>{
    assert.equal((await h.send({url:'/floodguard/live'})).status,404);
    assert.equal((await h.send({contentType:'text/plain'})).status,415);
    const old=h.envelope();
    h.setNow(NOW+40000);
    assert.equal((await h.send({input:old})).status,422);
    assert.deepEqual(h.journal.pending(UID),[]);
  });
});

test('operator revocation while a TLS body is incomplete denies without admitting',async()=>{
  await fixture(async h=>{
    const e=h.envelope();
    const data=JSON.stringify({envelope:e,signature:h.signature(e)});
    const mid=Math.floor(data.length/2);
    const response=new Promise((resolve,reject)=>{
      const req=https.request({
        hostname:'127.0.0.1',port:h.port,path:LOOPBACK_INGEST_PATH,
        method:'POST',servername:'localhost',ca:h.ca,
        rejectUnauthorized:true,agent:false,timeout:3500,
        headers:{'content-type':'application/json','content-length':Buffer.byteLength(data)}
      },res=>{
        res.resume();
        res.once('end',()=>resolve(res.statusCode));
      });
      req.once('error',reject);
      req.once('timeout',()=>req.destroy(Error('test-timeout')));
      req.write(data.slice(0,mid));
      // The server's post-body identity lookup must see this revocation.
      const original=h.registry.get(UID);
      h.registry.set(UID,{...original,enabled:false});
      req.end(data.slice(mid));
    });
    assert.equal(await response,403);
    assert.deepEqual(h.journal.pending(UID),[]);
  });
});

test('admission option rejects ambiguous dual-ledger setup and missing journal',async()=>{
  await fixture(async h=>{
    const ctor=()=>createLoopbackSignedIngressHandler({
      identities:h.registry,admissionJournal:h.journal,
      ledger:{last(){return null;},commit(){return {accepted:true};}},
      ledgerAvailable:()=>true,clock:()=>NOW
    });
    assert.throws(ctor,TypeError);
    assert.throws(()=>createLoopbackSignedIngressHandler({
      identities:h.registry,admissionJournal:{accept(){return {accepted:true};}},
      ledgerAvailable:()=>true
    }),TypeError);
  });
});

test('the TLS journal experiment contains no Firebase, public bind, notification or gate API',()=>{
  const code=fs.readFileSync('experiments/durable-admission-outbox-lab.mjs','utf8');
  assert.doesNotMatch(code,/firebase-admin|firebase\/database|https\.request|servo\.write|sendMessage\s*\(/);
  assert.doesNotMatch(code,/listen\s*\(|process\.env/);
});
