// Child process for a genuine same-slot O_EXCL filesystem race test.
// Synthetic signed-looking fixture only; never real device key or cloud.
import {appendExclusiveJournalLab} from '../../experiments/exclusive-device-journal-fs-lab.mjs';
const directory=process.argv[2],signedJson=process.argv[3],seq=Number(process.argv[4]);
const output=appendExclusiveJournalLab({directory,sequence:seq,signedJson});
process.stdout.write(JSON.stringify(output));
