// A tiny stdio MCP server for the connection check (#485): the deleted mcp_render_test.py's STUB_SERVER in
// Node. It reads one request and answers by its mode, writes a canary to stderr (never printed by the check)
// and its pid to a file (so a test can show the check killed it). Synthetic only; it reads no credential,
// and of its environment it reads only SYNTH_CANARY, SYNTH_E and whether SYNTH_TOKEN is set.
//   ok          a log line, a reply to another id, then the reply to the initialize; then waits
//   error       as ok, but the reply is an error
//   exit        exits 3 before reading
//   hang        reads the request and never answers
//   needenv     exits 4 unless SYNTH_TOKEN is set, else as ok
//   argcheck    exits 5 unless its next argument and SYNTH_E are both "expanded-value", else as ok
//   fork-ok     starts a child that waits (its pid in <pidfile>.child) and holds stdout, then as ok
//   fork-exit   starts that child, then exits 3 (the child keeps stdout open)
//   sigterm     kills itself with SIGTERM before reading
//   eof         closes stdout and keeps running
//   eof-exit    closes stdout, then exits 7 a moment later
//   float-id    answers with "id": 1.0 and a NaN in the result (CPython's JSON reads both)
import fs from 'node:fs';
import { spawn } from 'node:child_process';

const [mode, pidfile, ...rest] = process.argv.slice(2);
fs.writeFileSync(pidfile, String(process.pid));
fs.writeSync(2, 'STDERR-CANARY-' + (process.env.SYNTH_CANARY || '') + '\n');
const wait = () => setInterval(() => {}, 1 << 30);
/** @param {string} s */
const say = (s) => fs.writeSync(1, s + '\n');

if (mode.startsWith('fork-')) {
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1 << 30)'], { stdio: ['ignore', 'inherit', 'ignore'] });
  fs.writeFileSync(pidfile + '.child', String(child.pid));
  child.unref();
  if (mode === 'fork-exit') process.exit(3);
}
if (mode === 'argcheck' && (rest[0] !== 'expanded-value' || process.env.SYNTH_E !== 'expanded-value')) process.exit(5);
if (mode === 'exit') process.exit(3);
if (mode === 'sigterm') process.kill(process.pid, 'SIGTERM');
if (mode === 'eof') {
  fs.closeSync(1);
  wait();
} else if (mode === 'eof-exit') {
  fs.closeSync(1);
  setTimeout(() => process.exit(7), 300);
} else {
  let buf = '';
  process.stdin.on('data', (b) => {
    buf += b;
    const nl = buf.indexOf('\n');
    if (nl < 0) return;
    const req = JSON.parse(buf.slice(0, nl));
    process.stdin.pause();
    if (mode === 'hang') return wait();
    if (mode === 'needenv' && !process.env.SYNTH_TOKEN) process.exit(4);
    say('not json, a log line a server prints first');
    say(JSON.stringify({ jsonrpc: '2.0', id: 99, result: {} }));
    if (mode === 'error') say(JSON.stringify({ jsonrpc: '2.0', id: req.id, error: { code: -32603, message: 'x' } }));
    else if (mode === 'float-id') say('{"jsonrpc": "2.0", "id": 1.0, "result": {"x": NaN}}');
    else say(JSON.stringify({ jsonrpc: '2.0', id: req.id, result: { protocolVersion: '2025-06-18', capabilities: {}, serverInfo: { name: 'synth', version: '0' } } }));
    wait();
  });
}
