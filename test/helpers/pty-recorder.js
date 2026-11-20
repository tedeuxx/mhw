// The fake CLI of test/clipboard/paste-wrapper.test.js (#487): it writes every byte it receives to a file
// and its events to another, and never touches the real HOME, a shell rc or the clipboard. It plays the
// part of claude, codex or kiro-cli behind the paste wrapper.
//   node pty-recorder.js <received file> <events file> <mode> <exit code>
// mode: bp (raw, enables bracketed paste), nobp (raw, never enables it), cooked (no raw mode, so the
// terminal's Ctrl-C becomes SIGINT; enables bracketed paste).
// Input commands, each after Ctrl+] twice: TYPED (answers <TYPED>), OFF (turns bracketed paste off),
// STOP (stops itself, as Ctrl+Z does), EXIT (exits with the given code).
import fs from 'node:fs';

const [rec, ev, mode, codeArg] = process.argv.slice(2);
const code = Number(codeArg);
/** @param {string} line */
const event = (line) => fs.appendFileSync(ev, line + '\n');
const size = () => process.stdout.rows + 'x' + process.stdout.columns;
if (mode !== 'cooked') process.stdin.setRawMode(true);
process.on('SIGWINCH', () => {
  // process.stdout's size is refreshed on the same signal; read it on the next tick.
  setImmediate(() => event('WINCH ' + size()));
});
// A forwarded SIGTERM is recorded before the exit, so a test can tell forwarding apart from the wrapper
// dying on its own (PR #521 QA pw12).
process.on('SIGTERM', () => {
  event('SIGNAL SIGTERM');
  process.exit(143);
});
event('START ' + size());
event('MARKER ' + JSON.stringify(process.env.PMHWC_PASTE_WRAPPER ?? null));
if (mode !== 'nobp') fs.writeSync(1, '\x1b[?2004h');
fs.writeSync(1, 'READY\r\n');
let seen = Buffer.alloc(0);
let acks = 0;
const END = Buffer.from('\x1b[201~', 'latin1');
/** @param {string} word */
const take = (word) => {
  const cmd = Buffer.from('\x1d\x1d' + word, 'latin1');
  const i = seen.indexOf(cmd);
  if (i < 0) return false;
  seen = Buffer.concat([seen.subarray(0, i), seen.subarray(i + cmd.length)]);
  return true;
};
process.stdin.on('data', (chunk) => {
  const d = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
  fs.appendFileSync(rec, d);
  event('READ ' + d.length);
  seen = Buffer.concat([seen, d]);
  let n = 0;
  for (let i = seen.indexOf(END); i >= 0; i = seen.indexOf(END, i + 1)) n++;
  while (n > acks) {
    acks++;
    fs.writeSync(1, '<ACK' + acks + '>');
  }
  if (take('TYPED')) fs.writeSync(1, '<TYPED>');
  if (take('OFF')) fs.writeSync(1, '\x1b[?2004l<OFF>');
  if (take('STOP')) process.kill(process.pid, 'SIGSTOP');
  if (take('EXIT')) {
    if (mode !== 'nobp') fs.writeSync(1, '\x1b[?2004l');
    event('EXITING');
    process.exit(code);
  }
});
