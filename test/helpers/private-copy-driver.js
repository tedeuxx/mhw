// One privateCopy call in its own process, so a form that opened a FIFO for writing blocks this child
// (killed by the caller's timeout) and not the test runner. Prints 0 on success, 1 on a refusal.
//   node private-copy-driver.js SRC DST PLANT   (PLANT '-' for none; else sh run when DST is checked)
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { privateCopy } from '../../src/lib/private-copy.js';

const [src, dst, plant] = process.argv.slice(2);
let planted = false;
/** @param {string} p */
const lexists = (p) => {
  if (p === dst && !planted) {
    planted = true;
    if (spawnSync('/bin/sh', ['-c', plant], { cwd: path.dirname(dst), env: { ...process.env, PC_DST: dst } }).status !== 0) process.exit(3);
    return false;
  }
  try {
    fs.lstatSync(p);
    return true;
  } catch {
    return false;
  }
};
try {
  privateCopy(src, dst, plant === '-' ? {} : { lexists });
  process.stdout.write('0\n');
} catch {
  process.stdout.write('1\n');
}
