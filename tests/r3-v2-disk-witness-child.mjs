// Child-process read-only proof of witness journal continuity. Synthetic only.
import {createPublicKey} from 'node:crypto';
import {createR3V2DiskWitnessLab}
  from '../experiments/r3-v2-fsync-disk-witness-lab.mjs';
if(process.env.FG_R3_DISK_WITNESS_LAB_TEST!=='1')
  throw Error('Test-only witness process disabled');
const keys=JSON.parse(process.env.FG_CHILD_KEYS);
const enrollment=Object.fromEntries(['water','rain'].map(s=>[s,{
  epoch:1,publicKey:createPublicKey({
    key:Buffer.from(keys[s],'base64url'),format:'der',type:'spki'
  })
}]));
const lab=createR3V2DiskWitnessLab({
  directory:process.env.FG_CHILD_DIRECTORY,enrollment,
  signCheckpoint:()=>{throw Error('Read-only child cannot sign');}
});
process.stdout.write(JSON.stringify({
  water:lab.readSigned('water').checkpoint.sequence,
  rain:lab.readSigned('rain').checkpoint.sequence
}));