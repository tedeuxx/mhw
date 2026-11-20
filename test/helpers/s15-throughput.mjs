// S15 throughput (#486), beside ADR-0011's "about 3.2 s to scan 1,000,000 bytes": the cleaning core of
// src/lib/clean.js and of global/clipboard/clipboard_guard.py timed on the same 1,000,000 bytes of
// synthetic text (prose in English and Portuguese, numbers, and one synthetic finding per category
// every few lines), patterns only and with a one-term list, best of three, in process. Not a test.
//   node test/helpers/s15-throughput.mjs [PYTHON...]      each PYTHON an absolute path to a python3
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import * as clean from '../../src/lib/clean.js';
import { J } from '../clean/corpus.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const LINES = [
  'The deploy pipeline runs lint, typecheck and the regression suite before the merge; latency p95 is 120 ms.',
  'A revisão do código passou, mas o build de produção falhou na etapa de migração às 14h32 de ontem.',
  J('contact ', 'synthetic.person', '@', 'fixture-mail.dev', ' about key ', 'AKIA', 'IOSFODNN7', 'EXAMPLE', ' rotation'),
  J('cpf ', '123.456', '.789-09', ' and phone +55 (11) 9', '0000-0001 on file; CEP 01', '000-000'),
  J('salary ', 'US$', ' 90,000 per the contract; CID F', '32.1 noted; my colleague ', 'Quillo Zyxwer agreed'),
  'commit 3f1e2d4c5b6a79880f1e2d4c5b6a79880f1e2d4c, uuid 123e4567-e89b-12d3-a456-426614174000, port 8080.',
];
const cycle = LINES.map((l) => l + '\n').join('');
const full = Buffer.from(cycle.repeat(Math.ceil(1000000 / Buffer.byteLength(cycle, 'utf8'))), 'utf8');
// Cut at 1,000,000 bytes, stepping back off a continuation byte so no character is split.
let end = 1000000;
while ((full[end] & 0xc0) === 0x80) end--;
const text = full.subarray(0, end).toString('utf8');
const SALT = '5a'.repeat(32);
const TERM = 'Zyxw Quillon Synthetic';
const terms = new Set(clean.termForms(TERM).map((f) => clean.termHash(SALT, f)));
console.log(Buffer.byteLength(text, 'utf8') + ' bytes');
for (const [label, args] of /** @type {Array<[string, Parameters<typeof clean.findSpans>]>} */ ([['patterns only', [text]], ['with a one-term list', [text, terms, SALT, {}]]])) {
  let best = Infinity;
  let n = 0;
  for (let i = 0; i < 3; i++) {
    const t = performance.now();
    n = clean.findSpans(...args).length;
    best = Math.min(best, performance.now() - t);
  }
  console.log('node ' + process.version + ', ' + label + ': ' + (best / 1000).toFixed(2) + ' s, ' + n + ' spans');
}
const PY = `import sys, time
sys.path.insert(0, sys.argv[1])
import clipboard_guard as g
text, salt = sys.stdin.read(), "5a" * 32
terms = frozenset(g.term_hash(salt, f) for f in g.term_forms(sys.argv[2]))
for label, args in (("patterns only", (text,)), ("with a one-term list", (text, terms, salt, {}))):
    best = None
    for _ in range(3):
        t = time.perf_counter(); n = len(g.find_spans(*args)); d = time.perf_counter() - t
        best = d if best is None or d < best else best
    print("CPython %s, %s: %.2f s, %d spans" % (sys.version.split()[0], label, best, n))
`;
for (const py of process.argv.slice(2)) {
  const p = spawnSync(py, ['-B', '-c', PY, path.join(ROOT, 'global', 'clipboard'), TERM], { input: text, encoding: 'utf8', env: { ...process.env, PYTHONIOENCODING: 'utf-8' } });
  process.stdout.write(p.stdout + p.stderr);
}
