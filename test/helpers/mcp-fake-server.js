// A fake MCP server for the launcher suite (#483). Synthetic only; it never reads a real credential.
//   env OUT NAME...     write {argv, env: {NAME: sha256 of its value, or null}} as JSON to OUT (- for stdout)
//   envall OUT NAME...  as env, plus keys: every variable name the server got, sorted (values never)
//   echo                copy stdin to stdout byte for byte until end of input, then exit 0
//   exit N              exit with status N
//   signal SIG          kill itself with SIG
//   wait OUT            write {pid, argv} to OUT, then wait (no handler: a signal ends it by default)
//   trap OUT            like wait, but on any signal the launcher forwards append the signal's name to
//                       OUT+'.sig' and exit 0
//   stubborn OUT        like wait, but SIGTERM is ignored (only SIGKILL ends it)
// A variable is read as an OWN entry of the environment, so a name like __proto__ or constructor is the
// variable of that name, never a property of Object.prototype.
import fs from 'node:fs';
import crypto from 'node:crypto';

const [mode, ...rest] = process.argv.slice(2);
/** @param {string} s */
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
/** @param {string} n */
const own = (n) => {
  const d = Object.getOwnPropertyDescriptor(process.env, n);
  return d === undefined ? null : sha(String(d.value));
};
const TRAPPED = /** @type {NodeJS.Signals[]} */ (['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGQUIT', 'SIGUSR1', 'SIGUSR2', 'SIGWINCH', 'SIGALRM', 'SIGPIPE']);

/** Keep the process alive until a signal ends it. */
function idle() {
  setInterval(() => {}, 1 << 30);
}

/** @param {string} out @param {string} text */
const emit = (out, text) => (out === '-' ? fs.writeSync(1, text + '\n') : fs.writeFileSync(out, text));

if (mode === 'env' || mode === 'envall') {
  const [out, ...names] = rest;
  /** @type {Record<string, string | null>} */
  const env = Object.create(null);
  for (const n of names) env[n] = own(n);
  /** @type {Record<string, unknown>} */
  const doc = { argv: process.argv.slice(1), env };
  if (mode === 'envall') doc.keys = Object.keys(process.env).sort((a, b) => (a < b ? -1 : Number(a > b)));
  emit(out, JSON.stringify(doc));
} else if (mode === 'echo') {
  process.stdin.on('data', (/** @type {Buffer} */ b) => fs.writeSync(1, b));
} else if (mode === 'exit') {
  process.exitCode = Number(rest[0]);
} else if (mode === 'signal') {
  process.kill(process.pid, /** @type {NodeJS.Signals} */ (rest[0]));
  idle();
} else if (mode === 'wait' || mode === 'trap' || mode === 'stubborn') {
  const out = rest[0];
  if (mode === 'trap') {
    for (const s of TRAPPED) {
      process.on(s, () => {
        fs.appendFileSync(out + '.sig', s + '\n');
        process.exit(0);
      });
    }
  }
  if (mode === 'stubborn') process.on('SIGTERM', () => {});
  fs.writeFileSync(out, JSON.stringify({ pid: process.pid, argv: process.argv.slice(1) }));
  idle();
} else {
  process.stderr.write('fake server: unknown mode ' + mode + '\n');
  process.exitCode = 64;
}
