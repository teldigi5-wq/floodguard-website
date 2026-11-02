// FloodGuard R3 — LOCAL SQLITE TRANSACTIONAL AUTHORITY LAB ONLY.
// Real SQLite BEGIN IMMEDIATE, WAL + synchronous=FULL, one authorization,
// confirmation, revocation and signed issuance transaction boundary.
// NO Firebase, HTTP, device, alert, ACK, gate, rollback anchor or production key.
import * as fs from 'node:fs';
import * as path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {createHash,createPublicKey,KeyObject,sign} from 'node:crypto';
import {verifyStage8OfflineReceipt} from './stage8-ack-reconciliation.mjs';
import {canonicalSyntheticPublicationAttestation,
  verifySyntheticPublicationAttestation}
  from './synthetic-publication-attestation.mjs';

const VERSION='floodguard-r3-transactional-authority-lab-v1';
const ID=/^device-stage-[a-z0-9-]{1,32}$/;
const HEX=/^[a-f0-9]{64}$/;
const strict=(v,keys)=>v!==null&&typeof v==='object'&&
  !Array.isArray(v)&&Object.getPrototypeOf(v)===Object.prototype&&
  Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const integer=(n,min,max)=>Number.isSafeInteger(n)&&n>=min&&n<=max;
const edkey=(k,type)=>k instanceof KeyObject&&k.type===type&&
  k.asymmetricKeyType==='ed25519';
const fp=k=>createHash('sha256').update(k.export({
  format:'der',type:'spki'
})).digest('hex');
const deny=reason=>Object.freeze({
  issued:false,revoked:false,reason,canPublish:false,canAcknowledge:false,
  canSendAlert:false,canOperateGate:false,productionGo:false
});
const receiptFields=['version','deviceId','epoch','sequence','digest','acceptedAtMs'];
const confirmationFields=['deviceId','epoch','sequence','digest','acceptedAtMs','status'];
const spki=k=>k.export({format:'der',type:'spki'}).toString('base64');

// Every injected role key and clock belongs to the OFFLINE test harness.
// mode: commission is explicit one-time synthetic provisioning. mode: open
// MUST find the previous database and commissioning marker, never reset.
export function createTransactionalSqliteAuthorityLab({
  databasePath,mode='open',devicePublicKey,receiptIssuerPublicKey,
  databaseIssuerPrivateKey,databaseIssuerPublicKey,clock,
  allowSyntheticConfirmationWrites=false,failPoint
}={}) {
  if(typeof databasePath!=='string'||!path.isAbsolute(databasePath)||
     !['commission','open'].includes(mode)||
     !edkey(devicePublicKey,'public')||
     !edkey(receiptIssuerPublicKey,'public')||
     !edkey(databaseIssuerPrivateKey,'private')||
     !edkey(databaseIssuerPublicKey,'public')||
     typeof clock!=='function'||
     typeof allowSyntheticConfirmationWrites!=='boolean'||
     ![undefined,'before-commit','after-commit-before-response'].includes(failPoint))
    throw TypeError('Offline SQLite, clock and distinct signer keys required');
  const fingerprints=[fp(devicePublicKey),fp(receiptIssuerPublicKey),
    fp(databaseIssuerPublicKey)];
  if(new Set(fingerprints).size!==3||
     fp(createPublicKey(databaseIssuerPrivateKey))!==fingerprints[2])
    throw TypeError('Signer role confusion or mismatched key pair');
  const parent=path.dirname(databasePath),marker=databasePath+'.commissioned';
  const dir=fs.lstatSync(parent);
  if(!dir.isDirectory()||dir.isSymbolicLink())
    throw Error('Unsafe local test directory');
  if(mode==='commission'){
    if(fs.existsSync(databasePath)||fs.existsSync(marker))
      throw Error('Already commissioned; refusing initialization');
    const fd=fs.openSync(marker,'wx',0o600);
    try{fs.writeFileSync(fd,VERSION);fs.fsyncSync(fd);}
    finally{fs.closeSync(fd);}
    const df=fs.openSync(parent,'r');
    try{fs.fsyncSync(df);}finally{fs.closeSync(df);}
  }else{
    const file=fs.lstatSync(databasePath),sidecar=fs.lstatSync(marker);
    if(!file.isFile()||file.isSymbolicLink()||!sidecar.isFile()||
       sidecar.isSymbolicLink()||fs.readFileSync(marker,'utf8')!==VERSION)
      throw Error('Commissioned test DB unavailable');
  }
  const db=new DatabaseSync(databasePath);
  try{
    db.exec('PRAGMA foreign_keys=ON');
    db.exec('PRAGMA busy_timeout=0');
    db.exec('PRAGMA journal_mode=WAL');
    db.exec('PRAGMA synchronous=FULL');
    if(mode==='commission'){
      db.exec('BEGIN IMMEDIATE');
      try{
        db.exec('CREATE TABLE meta (id INTEGER PRIMARY KEY CHECK(id=1), version TEXT NOT NULL, receipt_fp TEXT NOT NULL, signer_fp TEXT NOT NULL) STRICT');
        db.exec('CREATE TABLE device (device_id TEXT PRIMARY KEY,epoch INTEGER NOT NULL,enabled INTEGER NOT NULL CHECK(enabled IN (0,1)),public_spki TEXT NOT NULL,key_fp TEXT NOT NULL,last_sequence INTEGER NOT NULL,last_digest TEXT NOT NULL,revision INTEGER NOT NULL) STRICT');
        db.exec("CREATE TABLE confirmed (device_id TEXT NOT NULL,epoch INTEGER NOT NULL,sequence INTEGER NOT NULL,digest TEXT NOT NULL,accepted_at_ms INTEGER NOT NULL,status TEXT NOT NULL CHECK(status='DATABASE_CONFIRMED'),PRIMARY KEY(device_id,epoch,sequence),FOREIGN KEY(device_id) REFERENCES device(device_id)) STRICT");
        db.exec('CREATE TABLE issued (device_id TEXT NOT NULL,epoch INTEGER NOT NULL,sequence INTEGER NOT NULL,digest TEXT NOT NULL,accepted_at_ms INTEGER NOT NULL,confirmed_at_ms INTEGER NOT NULL,signature TEXT NOT NULL,PRIMARY KEY(device_id,epoch,sequence),FOREIGN KEY(device_id) REFERENCES device(device_id)) STRICT');
        db.prepare('INSERT INTO meta (id,version,receipt_fp,signer_fp) VALUES (1,?,?,?)')
          .run(VERSION,fingerprints[1],fingerprints[2]);
        db.exec('COMMIT');
      }catch(e){db.exec('ROLLBACK');throw e;}
    }else{
      const m=db.prepare('SELECT version,receipt_fp,signer_fp FROM meta WHERE id=1').get();
      if(m?.version!==VERSION||m.receipt_fp!==fingerprints[1]||
         m.signer_fp!==fingerprints[2])
        throw Error('Pinned issuer configuration changed');
    }
  }catch(e){db.close();throw e;}
  const device=id=>db.prepare('SELECT * FROM device WHERE device_id=?').get(id);
  const enabled=row=>row?.enabled===1&&row.epoch>=1&&
    row.key_fp===fingerprints[0]&&row.public_spki===spki(devicePublicKey);
  function transaction(callback){
    let active=false;
    try{
      db.exec('BEGIN IMMEDIATE');active=true;
      const value=callback();
      db.exec('COMMIT');active=false;
      return {ok:true,value};
    }catch{
      if(active)try{db.exec('ROLLBACK');}catch{}
      return {ok:false};
    }
  }
  const noChange=Object.freeze({stored:false,reason:'fixture-disabled-or-invalid'});
  return Object.freeze({
    commissionDevice(seed){
      if(mode!=='commission'||!strict(seed,[
        'deviceId','epoch','previousSequence','previousDigest'
      ])||typeof seed.deviceId!=='string'||!ID.test(seed.deviceId)||
         !integer(seed.epoch,1,10000)||
         !integer(seed.previousSequence,1,2147483646)||
         typeof seed.previousDigest!=='string'||!HEX.test(seed.previousDigest))
        return deny('explicit-operator-seed-required');
      const r=transaction(()=>{
        if(db.prepare('SELECT COUNT(*) AS n FROM device').get().n!==0)
          throw Error('Already commissioned');
        db.prepare('INSERT INTO device (device_id,epoch,enabled,public_spki,key_fp,last_sequence,last_digest,revision) VALUES (?,?,1,?,?,?,?,1)')
          .run(seed.deviceId,seed.epoch,spki(devicePublicKey),
            fingerprints[0],seed.previousSequence,seed.previousDigest);
        return Object.freeze({commissioned:true,productionGo:false});
      });
      return r.ok?r.value:deny('operator-commission-refused');
    },
    // TEST HARNESS FIXTURE ONLY: does not prove Firebase commit or identity.
    recordSyntheticConfirmationForTest(v){
      if(!allowSyntheticConfirmationWrites||
         !strict(v,confirmationFields)||v.status!=='DATABASE_CONFIRMED'||
         typeof v.deviceId!=='string'||!ID.test(v.deviceId)||
         !integer(v.epoch,1,10000)||
         !integer(v.sequence,1,2147483647)||
         typeof v.digest!=='string'||!HEX.test(v.digest)||
         !integer(v.acceptedAtMs,946684800000,Number.MAX_SAFE_INTEGER))
        return noChange;
      const r=transaction(()=>{
        const row=device(v.deviceId);
        if(!enabled(row)||row.epoch!==v.epoch)throw Error('Not commissioned');
        db.prepare('INSERT INTO confirmed (device_id,epoch,sequence,digest,accepted_at_ms,status) VALUES (?,?,?,?,?,?)')
          .run(v.deviceId,v.epoch,v.sequence,v.digest,v.acceptedAtMs,v.status);
        return Object.freeze({stored:true,physicalSourceVerified:false});
      });
      return r.ok?r.value:noChange;
    },
    attest(request){
      if(!strict(request,['receipt','receiptSignature'])||
         !strict(request.receipt,receiptFields))
        return deny('request-shape-invalid');
      const receipt=request.receipt;
      if(receipt.version!=='floodguard-offline-receipt-v1'||
         typeof receipt.deviceId!=='string'||!ID.test(receipt.deviceId)||
         !integer(receipt.epoch,1,10000)||
         !integer(receipt.sequence,1,2147483647)||
         typeof receipt.digest!=='string'||!HEX.test(receipt.digest)||
         !integer(receipt.acceptedAtMs,946684800000,Number.MAX_SAFE_INTEGER)||
         !verifyStage8OfflineReceipt({
           receipt,signature:request.receiptSignature,publicKey:receiptIssuerPublicKey
         }))
        return deny('signed-acceptance-invalid');
      // BEGIN IMMEDIATE fences all cooperating connections to THIS database.
      // Sign DURING the transaction; return signature ONLY AFTER COMMIT.
      let active=false,reason='transaction-unavailable',attestation,signature;
      try {
        db.exec('BEGIN IMMEDIATE');active=true;
        const row=device(receipt.deviceId);
        if(!enabled(row)||row.epoch!==receipt.epoch){
          reason='operator-not-authorized';throw Error(reason);
        }
        if(receipt.sequence!==row.last_sequence+1){
          reason='issuance-replay-or-gap';throw Error(reason);
        }
        const now=clock();
        if(!integer(now,946684800000,Number.MAX_SAFE_INTEGER)||
           now<receipt.acceptedAtMs||now-receipt.acceptedAtMs>5000){
          reason='confirmation-window-invalid';throw Error(reason);
        }
        const stored=db.prepare('SELECT * FROM confirmed WHERE device_id=? AND epoch=? AND sequence=?')
          .get(receipt.deviceId,receipt.epoch,receipt.sequence);
        if(!stored||stored.status!=='DATABASE_CONFIRMED'||
           stored.digest!==receipt.digest||stored.accepted_at_ms!==receipt.acceptedAtMs){
          reason='test-database-unconfirmed';throw Error(reason);
        }
        attestation={
          version:'floodguard-synthetic-persisted-attestation-v1',
          deviceId:receipt.deviceId,epoch:receipt.epoch,
          sequence:receipt.sequence,digest:receipt.digest,
          acceptedAtMs:receipt.acceptedAtMs,confirmedAtMs:now,
          scope:'prototype-ingest-v1',deviceEnabled:true,
          databaseState:'DATABASE_CONFIRMED'
        };
        signature=sign(null,Buffer.from(
          canonicalSyntheticPublicationAttestation(attestation)),
          databaseIssuerPrivateKey).toString('base64url');
        if(!verifySyntheticPublicationAttestation({
          attestation,signature,publicKey:databaseIssuerPublicKey,
          receipt,nowMs:now
        })){
          reason='signature-selfcheck-refused';throw Error(reason);
        }
        const change=db.prepare('UPDATE device SET last_sequence=?,last_digest=?,revision=revision+1 WHERE device_id=? AND epoch=? AND enabled=1 AND last_sequence=?')
          .run(receipt.sequence,receipt.digest,receipt.deviceId,
            receipt.epoch,row.last_sequence);
        if(change.changes!==1){
          reason='authority-cursor-conflict';throw Error(reason);
        }
        db.prepare('INSERT INTO issued (device_id,epoch,sequence,digest,accepted_at_ms,confirmed_at_ms,signature) VALUES (?,?,?,?,?,?,?)')
          .run(receipt.deviceId,receipt.epoch,receipt.sequence,receipt.digest,
            receipt.acceptedAtMs,now,signature);
        if(failPoint==='before-commit'){
          reason='simulated-pre-commit-crash';throw Error(reason);
        }
        db.exec('COMMIT');active=false;
        if(failPoint==='after-commit-before-response')
          return deny('simulated-response-lost-after-commit');
        return Object.freeze({
          issued:true,revoked:false,
          kind:'SYNTHETIC_SQLITE_TRANSACTIONAL_ATTESTATION_NOT_PUBLISHED',
          attestation:Object.freeze(attestation),signature,
          canPublish:false,canAcknowledge:false,canSendAlert:false,
          canOperateGate:false,productionGo:false,
          physicalSourceVerified:false
        });
      }catch{
        if(active)try{db.exec('ROLLBACK');}catch{}
        return deny(reason);
      }
    },
    revoke(deviceId){
      if(typeof deviceId!=='string'||!ID.test(deviceId))
        return deny('invalid-device-id');
      const r=transaction(()=>{
        const row=device(deviceId);
        if(!enabled(row))throw Error('Not enabled');
        const result=db.prepare('UPDATE device SET enabled=0,revision=revision+1 WHERE device_id=? AND enabled=1 AND revision=?')
          .run(deviceId,row.revision);
        if(result.changes!==1)throw Error('Revocation conflict');
        return Object.freeze({
          issued:false,revoked:true,deviceId,epoch:row.epoch,
          canPublish:false,canAcknowledge:false,canSendAlert:false,
          canOperateGate:false,productionGo:false
        });
      });
      return r.ok?r.value:deny('revocation-conflict-or-unavailable');
    },
    snapshot(id){
      try{
        const row=device(id);
        if(!row||row.key_fp!==fingerprints[0])return null;
        return Object.freeze({
          deviceId:row.device_id,epoch:row.epoch,enabled:row.enabled===1,
          sequence:row.last_sequence,digest:row.last_digest,
          revision:row.revision,productionGo:false
        });
      }catch{return null;}
    },
    close(){db.close();}
  });
}
