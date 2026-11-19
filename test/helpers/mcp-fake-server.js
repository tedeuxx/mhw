// A fake MCP server for the launcher suite (#483). Synthetic only; it never reads a real credential.
//   env OUT NAME...     write {argv, env: {NAME: sha256 of its value, or null}} as JSON to OUT (- for stdout)
//   echo                copy stdin to stdout byte for byte until end of input, then exit 0
//   exit N              exit with status N
//   signal SIG          kill itself with SIG
//   wait OUT            write {pid, argv} to OUT, then wait (no handler: a signal ends it by default)
//   trap OUT            like wait, but on SIGINT, SIGTERM, SIGHUP or SIGUSR1 append the signal's name to OUT+'.sig'
//                       and exit 0
import fs from 'node:fs';
import crypto from 'node:crypto';

const [mode, ...rest] = process.argv.slice(2);
/** @param {string} s */
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

/** Keep the process alive until a signal ends it. */
function idle() {
  setInterval(() => {}, 1 << 30);
}

if (mode === 'env') {
  const [out, ...names] = rest;
  /** @type {Record<string, string | null>} */
  const env = {};
  for (const n of names) env[n] = process.env[n] === undefined ? null : sha(String(process.env[n]));
  const text = JSON.stringify({ argv: process.argv.slice(1), env });
  if (out === '-') fs.writeSync(1, text + '\n');
  else fs.writeFileSync(out, text);
} else if (mode === 'echo') {
  process.stdin.on('data', (/** @type {Buffer} */ b) => fs.writeSync(1, b));
} else if (mode === 'exit') {
  process.exitCode = Number(rest[0]);
} else if (mode === 'signal') {
  process.kill(process.pid, /** @type {NodeJS.Signals} */ (rest[0]));
  idle();
} else if (mode === 'wait' || mode === 'trap') {
  const out = rest[0];
  if (mode === 'trap') {
    for (const s of /** @type {NodeJS.Signals[]} */ (['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGUSR1'])) {
      process.on(s, () => {
        fs.appendFileSync(out + '.sig', s + '\n');
        process.exit(0);
      });
    }
  }
  fs.writeFileSync(out, JSON.stringify({ pid: process.pid, argv: process.argv.slice(1) }));
  idle();
} else {
  process.stderr.write('fake server: unknown mode ' + mode + '\n');
  process.exitCode = 64;
}
