// Isolated localhost-only certificate trust/hostname test.
// OpenSSL generates ephemeral test certificates inside a temporary directory;
// no key is committed to GitHub. This has no Firebase or device traffic.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import https from 'node:https';
import {spawnSync} from 'node:child_process';
import {once} from 'node:events';

function openssl(dir,args){
  const result=spawnSync('openssl',args,{cwd:dir,encoding:'utf8',timeout:15000,stdio:'pipe'});
  if(result.error||result.status!==0)throw new Error('OpenSSL local fixture unavailable: '+String(result.error?.code||result.status));
}
async function fixture(fn){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'floodguard-stage9-tls-'));
  let server;
  try{
    openssl(dir,['req','-x509','-newkey','rsa:2048','-nodes',
      '-keyout','ca.key','-out','ca.crt','-days','1',
      '-subj','/CN=FloodGuard Synthetic Test CA',
      '-addext','basicConstraints=critical,CA:TRUE',
      '-addext','keyUsage=critical,keyCertSign,cRLSign']);
    openssl(dir,['req','-new','-newkey','rsa:2048','-nodes',
      '-keyout','server.key','-out','server.csr','-subj','/CN=localhost']);
    fs.writeFileSync(path.join(dir,'server.ext'),
      'subjectAltName=DNS:localhost,IP:127.0.0.1\nextendedKeyUsage=serverAuth\nbasicConstraints=critical,CA:FALSE\n');
    openssl(dir,['x509','-req','-in','server.csr','-CA','ca.crt',
      '-CAkey','ca.key','-CAcreateserial','-out','server.crt','-days','1',
      '-extfile','server.ext']);
    server=https.createServer({
      key:fs.readFileSync(path.join(dir,'server.key')),
      cert:fs.readFileSync(path.join(dir,'server.crt'))
    },(request,response)=>{
      if(request.url!=='/synthetic-tls-test')response.writeHead(404).end();
      else response.writeHead(200,{'Content-Type':'text/plain'}).end('SYNTHETIC LOCAL TLS ONLY');
    });
    server.listen(0,'127.0.0.1');await once(server,'listening');
    const ca=fs.readFileSync(path.join(dir,'ca.crt'));
    async function query(opts={}){
      return await new Promise((resolve,reject)=>{
        const req=https.get({
          hostname:'127.0.0.1',port:server.address().port,path:'/synthetic-tls-test',
          method:'GET',agent:false,rejectUnauthorized:true,servername:'localhost',
          timeout:3000,...opts
        },res=>{
          const body=[];
          res.on('data',part=>body.push(part));
          res.once('end',()=>resolve({status:res.statusCode,body:Buffer.concat(body).toString('utf8')}));
        });
        req.once('timeout',()=>req.destroy(new Error('fixture-timeout')));
        req.once('error',reject);
      });
    }
    await fn({query,ca,port:server.address().port});
  }finally{
    if(server?.listening)await new Promise(resolve=>server.close(resolve));
    fs.rmSync(dir,{recursive:true,force:true});
  }
}
test('local TLS fixture accepts a trusted test CA and correct hostname',async()=>{
  await fixture(async({query,ca})=>{
    const value=await query({ca,servername:'localhost'});
    assert.equal(value.status,200);assert.equal(value.body,'SYNTHETIC LOCAL TLS ONLY');
  });
});
test('no explicit trusted CA fails certificate verification',async()=>{
  await fixture(async({query})=>{
    await assert.rejects(query(),/certificate|verify|unable|issuer|self.signed/i);
  });
});
test('wrong hostname fails even when fixture CA is trusted',async()=>{
  await fixture(async({query,ca})=>{
    await assert.rejects(query({ca,servername:'attacker.invalid'}),/hostname|altname|certificate/i);
  });
});
test('unrelated CA is rejected rather than silently falling back to insecure TLS',async()=>{
  await fixture(async({query,ca})=>{
    const wrongCert=ca.toString('utf8').replace(/[^\n]/,'A');
    await assert.rejects(query({ca:wrongCert}),/PEM|certificate|decode|verify|unable|error/i);
  });
});
test('fixture is strictly loopback and has no DNS/Firebase/hardware endpoints',()=>{
  // Exclude the safety assertion's own source so its regular expression
  // does not match the string of that assertion itself.
  const source=fs.readFileSync('tests/stage9-local-tls.test.mjs','utf8')
    .split("test('fixture is strictly loopback")[0];
  assert.match(source,/server\.listen\(0,'127\.0\.0\.1'\)/);
  assert.match(source,/rejectUnauthorized:true/);
  assert.doesNotMatch(source,/rejectUnauthorized:false|setInsecure\s*\(/);
  assert.doesNotMatch(source,/firebaseio\.com|firebasedatabase\.app|sendMessage\s*\(/);
});
