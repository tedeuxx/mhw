// S07 parity (#478, convention 3 of #470): `mhw funnel-review` against the deleted
// method/scripts/funnel-review.sh, on the cases of its own suite (funnel-review.test.sh, also deleted) and
// the edges of its parsing (test/golden/S07/cases.json). Every value is synthetic.
//   golden: the Node command in this process against the transcripts recorded from the shell original
//           (stdout, stderr, exit code; the case's tree must be unchanged by the run). Every OS.
//   live:   where the base revision still holds funnel-review.sh (until this slice merges) and bash is on
//           PATH, the shell original and the Node command side by side. POSIX only. MHW_UPDATE_GOLDEN=1
//           rewrites the golden transcripts from the shell side, never from the Node side.
//   cli:    the same cases through bin/mhw.js and ./mhw.
// Then the assertions of the deleted suite, over the Node command's output. Each run gets a throwaway HOME,
// git discovery is stopped at the case's directory (GIT_CEILING_DIRECTORIES), and on POSIX the network
// tools are stubbed to a recorder that must stay empty.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { run, MAX_FINDINGS } from '../../src/commands/funnel-review.js';
import { runAbsolute } from '../../src/lib/run.js';
import { readGolden, writeGolden, UPDATE } from '../helpers/golden.js';
import { which } from '../helpers/home.js';
import { extractRevision } from '../helpers/parity.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SLICE = 'S07';
const POSIX = process.platform !== 'win32';
const FIXTURES = path.join(ROOT, 'method', 'scripts', 'fixtures', 'funnel-review');
const RITE = path.join(ROOT, 'method', 'skills', 'funnel-review', 'SKILL.md');
const PLANNING = path.join(ROOT, 'method', 'skills', 'sprint-planning', 'SKILL.md');
const CONTRACT = path.join(ROOT, 'method', 'scripts', 'funnel-review-contract', 'README.md');
const SOURCE = path.join(ROOT, 'src', 'commands', 'funnel-review.js');
const NET_TOOLS = ['curl', 'wget', 'gh', 'nc', 'ssh', 'open', 'osascript'];
const spec = readGolden(SLICE, 'cases.json');
/** @type {Array<{ case: string, stream: 'stdout' | 'stderr', base: string | null, head: string, why: string }>} */
const expected = readGolden(SLICE, 'expected-differences.json');
const GIT = which('git');
const BASH = which('bash');
const cleanups = /** @type {Array<() => void>} */ ([]);
after(() => cleanups.forEach((c) => c()));

/**
 * @typedef {{ name: string, args: string[], cwd?: string, fixtures?: boolean, repo?: boolean,
 *   files?: Record<string, string>, dirs?: string[] }} Case
 * @typedef {{ name: string, code: number, stdout: string, stderr: string, treeUnchanged: boolean }} Transcript
 * @typedef {(args: string[], cwd: string, env: Record<string, string>) => { code: number, stdout: string, stderr: string }} Runner
 */

/** @type {Case[]} */
const CASES = spec.cases;

/** @param {string} label */
function freshDir(label) {
  const dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'mhw-s07-' + label + '-')));
  cleanups.push(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** Every entry under dir: path, kind, mode and content hash, sorted. @param {string} dir */
function snapshot(dir) {
  /** @type {string[]} */
  const out = [];
  /** @param {string} d */
  const walk = (d) => {
    for (const name of fs.readdirSync(d).sort()) {
      const p = path.join(d, name);
      const st = fs.lstatSync(p);
      const rel = path.relative(dir, p);
      if (st.isDirectory()) {
        out.push(rel + ' dir ' + st.mode);
        if (name !== '.git') walk(p);
      } else {
        out.push(rel + ' ' + (st.isSymbolicLink() ? 'link' : 'file') + ' ' + st.mode + ' ' +
          (st.isFile() ? crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex') : ''));
      }
    }
  };
  walk(dir);
  return out.join('\n');
}

/**
 * Lay out one case: its directory, the placeholders, the environment and the network recorder.
 * @param {Case} c
 */
function setup(c) {
  const outer = freshDir('case');
  const base = path.join(outer, 'case');
  const root = path.join(base, 'root');
  const repo = path.join(base, 'repo');
  const trap = path.join(base, 'trap');
  for (const d of [base, root, trap, path.join(base, 'home')]) fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(trap, '12345'), '');
  fs.writeFileSync(path.join(trap, '345'), '');
  const subs = /** @type {Record<string, string>} */ ({ '{ROOT}': root, '{REPO}': repo, '{TRAP}': trap, '{BASE}': base });
  /** @param {string} s */
  const fill = (s) => Object.entries(subs).reduce((acc, [k, v]) => acc.split(k).join(v), s);
  if (c.fixtures) {
    const dest = path.join(root, 'docs', 'funnel-review', 'collected');
    fs.mkdirSync(dest, { recursive: true });
    for (const f of fs.readdirSync(FIXTURES)) if (f.endsWith('.tsv')) fs.copyFileSync(path.join(FIXTURES, f), path.join(dest, f));
  }
  for (const d of c.dirs || []) fs.mkdirSync(fill(d), { recursive: true });
  for (const [p, content] of Object.entries(c.files || {})) {
    const f = fill(p);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, content);
  }
  /** @type {Record<string, string>} */
  const env = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
  Object.assign(env, { HOME: path.join(base, 'home'), USERPROFILE: path.join(base, 'home'), GIT_CEILING_DIRECTORIES: base,
    GIT_CONFIG_NOSYSTEM: '1' });
  let commit = '';
  if (c.repo) {
    assert.ok(GIT, 'the case needs git');
    fs.mkdirSync(path.join(repo, 'docs', 'funnel-review', 'collected'), { recursive: true });
    fs.writeFileSync(path.join(repo, 'README.md'), 'seed\n');
    const g = (/** @type {string[]} */ a) => spawnSync(/** @type {string} */ (GIT), ['-C', repo, '-c', 'user.email=t@example.invalid', '-c', 'user.name=Tester', ...a], { env, encoding: 'utf8' });
    assert.equal(g(['init', '-q']).status, 0);
    assert.equal(g(['add', '-A']).status, 0);
    assert.equal(g(['commit', '-q', '-m', 'seed']).status, 0);
    commit = g(['rev-parse', 'HEAD']).stdout.trim();
  }
  // The recorder lives beside the case, outside the snapshotted tree.
  const calls = path.join(outer, 'calls');
  if (POSIX) {
    const bin = path.join(outer, 'bin');
    fs.mkdirSync(bin);
    for (const tool of NET_TOOLS) {
      fs.writeFileSync(path.join(bin, tool), '#!/bin/sh\nprintf "%s %s\\n" ' + tool + ' "$*" >> \'' + calls + '\'\nexit 0\n');
      fs.chmodSync(path.join(bin, tool), 0o755);
    }
    env.PATH = bin + ':' + env.PATH;
  }
  return { base, fill, env, commit, calls, cwd: fill(c.cwd || '{BASE}') };
}

/** @param {string} s @param {string} base @param {string} commit */
function norm(s, base, commit) {
  // No CRLF folding: a carriage return in a collection line reaches the report, and the edge-crlf case
  // holds that byte. Node writes the same bytes on every OS.
  let out = s.split(base).join('<BASE>');
  if (commit) out = out.split(commit).join('<COMMIT>');
  return out;
}

/**
 * Run c with runner; the transcript. Fails if the run reached a network tool.
 * @param {Case} c
 * @param {Runner} runner
 * @returns {Transcript}
 */
function transcript(c, runner) {
  const s = setup(c);
  const before = snapshot(s.base);
  const r = runner(c.args.map(s.fill), s.cwd, s.env);
  assert.ok(!fs.existsSync(s.calls), c.name + ': a network tool ran: ' + (fs.existsSync(s.calls) ? fs.readFileSync(s.calls, 'utf8') : ''));
  return { name: c.name, code: r.code, stdout: norm(r.stdout, s.base, s.commit), stderr: norm(r.stderr, s.base, s.commit),
    treeUnchanged: snapshot(s.base) === before };
}

/** The Node command in this process. @type {Runner} */
const nodeRunner = (args, cwd, env) => {
  let out = '';
  let err = '';
  const code = run(args, { cwd, env, out: (x) => { out += x; }, err: (x) => { err += x; } });
  return { code, stdout: out, stderr: err };
};

/**
 * @param {Transcript} original
 * @param {Transcript} head
 */
function differences(original, head) {
  const diffs = [];
  if (original.code !== head.code) diffs.push(head.name + ': exit ' + original.code + ' -> ' + head.code);
  if (original.treeUnchanged !== head.treeUnchanged || !head.treeUnchanged) diffs.push(head.name + ': the run changed its tree');
  for (const stream of /** @type {const} */ (['stdout', 'stderr'])) {
    const rules = expected.filter((e) => e.case === head.name && e.stream === stream);
    /** @param {string} text @param {'base' | 'head'} side */
    const keep = (text, side) => text.split('\n').filter((l) => !rules.some((r) => r[side] !== null && new RegExp(/** @type {string} */ (r[side])).test(l))).join('\n');
    if (keep(original[stream], 'base') !== keep(head[stream], 'head')) {
      diffs.push(head.name + ': ' + stream + ' differs\n--- original\n' + original[stream] + '\n--- head\n' + head[stream]);
    }
  }
  return diffs;
}

/** @param {string} name */
const goldenName = (name) => 'transcripts/' + name + '.json';

/** @param {Case} c */
const skipReason = (c) => (c.repo && !GIT ? 'needs git on PATH' : '');

test('every case has a golden transcript and every expected difference names a case or the help', () => {
  const names = new Set(CASES.map((c) => c.name));
  assert.equal(names.size, CASES.length, 'case names are unique');
  for (const c of CASES) assert.ok(fs.existsSync(path.join(ROOT, 'test', 'golden', SLICE, goldenName(c.name))), 'no golden for ' + c.name);
  for (const e of expected) {
    assert.ok(names.has(e.case) || (e.case === 'help' && e.base === null), 'unknown case ' + e.case);
    assert.ok(e.why && e.why.length > 20, 'an expected difference states why');
    if (e.base !== null) new RegExp(e.base);
    new RegExp(e.head);
  }
});

test('golden: the Node command matches the shell original\'s transcripts', { skip: UPDATE && 'MHW_UPDATE_GOLDEN=1' }, (t) => {
  const diffs = [];
  for (const c of CASES) {
    const why = skipReason(c);
    if (why) {
      t.diagnostic(c.name + ' skipped: ' + why);
      continue;
    }
    diffs.push(...differences(readGolden(SLICE, goldenName(c.name)), transcript(c, nodeRunner)));
  }
  assert.deepEqual(diffs, []);
});

/** The base revision's funnel-review.sh, or a reason it is not runnable here. @returns {string} */
function shellBase() {
  if (!POSIX) return 'POSIX only: the original is a bash script';
  if (!BASH || !GIT) return 'needs bash and git on PATH';
  const base = process.env.MHW_PARITY_BASE || (() => {
    const p = spawnSync(GIT, ['-C', ROOT, 'merge-base', 'HEAD', 'origin/' + (process.env.GITHUB_BASE_REF || 'rc/next')], { encoding: 'utf8' });
    return p.status === 0 ? p.stdout.trim() : '';
  })();
  if (!base) return 'no base revision (MHW_PARITY_BASE unset, no merge-base with origin/rc/next)';
  const dest = path.join(freshDir('base'), 'tree');
  if (!extractRevision(ROOT, base, dest)) return 'base revision ' + base + ' is not readable here';
  const script = path.join(dest, 'method', 'scripts', 'funnel-review.sh');
  if (!fs.existsSync(script)) return 'the base revision no longer holds funnel-review.sh (this slice has merged)';
  return script;
}

test('live: the shell original and the Node command side by side', (t) => {
  const script = shellBase();
  if (!path.isAbsolute(script)) {
    t.skip(script);
    return;
  }
  /** @type {Runner} */
  const shell = (args, cwd, env) => {
    const r = runAbsolute(/** @type {string} */ (BASH), [script, ...args], { cwd, env });
    return { code: r.code, stdout: r.stdout, stderr: r.stderr };
  };
  const diffs = [];
  for (const c of CASES) {
    const why = skipReason(c);
    if (why) {
      t.diagnostic(c.name + ' skipped: ' + why);
      continue;
    }
    const original = transcript(c, shell);
    if (UPDATE) writeGolden(SLICE, goldenName(c.name), original);
    diffs.push(...differences(original, transcript(c, nodeRunner)));
  }
  assert.deepEqual(diffs, []);
});

/**
 * Every runnable case through one entry, against the golden transcripts.
 * @param {(args: string[]) => [string, string[]]} entry
 */
function goldenThrough(entry) {
  /** @type {Runner} */
  const runner = (args, cwd, env) => {
    const [exe, a] = entry(args);
    // ./mhw finds node on PATH: the running node's directory goes after the recorder.
    const e = { ...env, PATH: path.dirname(process.execPath) + path.delimiter + env.PATH };
    if (POSIX) e.PATH = env.PATH.split(':')[0] + ':' + e.PATH;
    const p = spawnSync(exe, a, { cwd, env: e, encoding: 'utf8' });
    return { code: p.status ?? 1, stdout: p.stdout, stderr: p.stderr };
  };
  const diffs = [];
  for (const c of CASES) {
    if (skipReason(c)) continue;
    diffs.push(...differences(readGolden(SLICE, goldenName(c.name)), transcript(c, runner)));
  }
  return diffs;
}

test('cli: bin/mhw.js funnel-review runs the same command', () => {
  assert.deepEqual(goldenThrough((args) => [process.execPath, [path.join(ROOT, 'bin', 'mhw.js'), 'funnel-review', ...args]]), []);
});

test('./mhw funnel-review (a checkout) forwards to bin/mhw.js', { skip: !POSIX && './mhw is the POSIX entry' }, () => {
  assert.deepEqual(goldenThrough((args) => ['/bin/sh', [path.join(ROOT, 'mhw'), 'funnel-review', ...args]]), []);
  if (!fs.existsSync('/usr/bin/node') && !fs.existsSync('/bin/node')) {
    const p = spawnSync('/bin/sh', [path.join(ROOT, 'mhw'), 'funnel-review', '2000-02'], { env: { PATH: '/usr/bin:/bin' }, encoding: 'utf8' });
    assert.equal(p.status, 2);
    assert.equal(p.stderr, 'mhw: node (26 or later) is required for mhw funnel-review\n');
  }
});

test('help: -h and --help print the usage line on stdout and exit 0 (an added behaviour, declared)', () => {
  const rule = expected.find((e) => e.case === 'help');
  assert.ok(rule);
  for (const flag of ['-h', '--help']) {
    const r = nodeRunner([flag], ROOT, {});
    assert.equal(r.code, 0);
    assert.equal(r.stderr, '');
    assert.match(r.stdout.trimEnd(), new RegExp(rule.head));
  }
});

// ── The deleted suite's assertions, over the Node command's output ───────────────────────────────────

/** @param {string} name */
const out = (name) => {
  const c = CASES.find((x) => x.name === name);
  assert.ok(c, name);
  return transcript(c, nodeRunner).stdout;
};
const ran = out('fixture-2000-02-ran');
const nc = out('fixture-2000-03-collected-no');
const absent = out('absent-collection');
const first = out('fixture-2000-01-first-period');
const glob = out('fixture-2000-05-from-glob-trap');
const none = out('fixture-2000-06-internal-none');
const testing = out('fixture-2000-07-internal-testing');
const active = out('fixture-2000-08-internal-active');
const bogus = out('fixture-2000-09-internal-bogus');
/** @param {string} text */
const lines = (text) => text.split('\n');
/** @param {string} text @param {string} line */
const hasLine = (text, line) => lines(text).includes(line);
/** @param {string} text the report up to and including its RAN or NOT-COLLECTED literal */
const header = (text) => {
  const ls = lines(text);
  const i = ls.findIndex((l) => l.startsWith('FUNNEL-REVIEW-'));
  return ls.slice(0, i + 1);
};

test('literals: a collected period prints FUNNEL-REVIEW-RAN and only that; an absent one the other and only that', () => {
  assert.ok(hasLine(ran, 'FUNNEL-REVIEW-RAN'));
  assert.ok(!ran.includes('FUNNEL-REVIEW-NOT-COLLECTED'));
  assert.ok(hasLine(absent, 'FUNNEL-REVIEW-NOT-COLLECTED'));
  assert.ok(!absent.includes('FUNNEL-REVIEW-RAN'));
});

test('findings section: present when the surfaces were read, absent when they were not', () => {
  assert.ok(lines(ran).some((l) => l.startsWith('## Findings')));
  assert.ok(!lines(absent).some((l) => l.startsWith('## Findings')));
  assert.ok(!lines(nc).some((l) => l.startsWith('## Findings')));
});

test('collected: no wins, its reason is reported, and no figure below it is printed', () => {
  assert.ok(hasLine(nc, 'FUNNEL-REVIEW-NOT-COLLECTED'));
  assert.ok(nc.includes('chrome-not-authenticated'));
  assert.ok(!nc.includes('999'));
});

test('figures: every printed figure carries n=<digits> and a consent-ceiling clause', () => {
  const figs = lines(ran).filter((l) => l.startsWith('- ') && !l.startsWith('- figure:'));
  assert.ok(figs.length >= 3, 'only ' + figs.length + ' figure line(s) were read');
  for (const l of figs) {
    assert.match(l, / n=[0-9]/);
    assert.ok(l.includes('consent-ceiling:'), l);
  }
});

test('unusable lines: quoted verbatim under their own heading, never promoted to a figure', () => {
  assert.ok(hasLine(ran, '## Unusable collection lines'));
  assert.ok(hasLine(ran, '- figure: ga4 share-opens 5'));
  assert.ok(ran.includes('sample size is not a number'));
  assert.ok(!lines(ran).some((l) => /^- (ga4|linkedin) · (share-opens|reactions) /.test(l)));
});

test('prior period: read when it exists, and its absence is stated', () => {
  assert.ok(ran.includes('prior 2000-01 = 100 (n=100)'));
  assert.ok(ran.includes('not measured in 2000-01'));
  assert.ok(first.includes('no prior period on record'));
});

test('no network: the recorder is live, and every case above ran with it empty', { skip: !POSIX && 'the recorder is a shell script' }, () => {
  const s = setup({ name: 'probe', args: [] });
  assert.equal(spawnSync('curl', ['https://example.invalid'], { env: s.env }).status, 0);
  assert.ok(fs.existsSync(s.calls) && fs.readFileSync(s.calls, 'utf8').startsWith('curl '), 'the recorder never records');
});

test('cap: a number, stated in every RAN report, and no landed report under method/docs/funnel-review exceeds it', () => {
  assert.equal(MAX_FINDINGS, 2);
  assert.match(fs.readFileSync(SOURCE, 'utf8'), /^export const MAX_FINDINGS = 2;$/m);
  assert.ok(lines(ran).some((l) => l.startsWith('cap: ' + MAX_FINDINGS + ' findings')));
  // The shell suite read $ROOT/docs/funnel-review with ROOT = method/; mhw holds no store there, so this
  // loop is as vacuous here as it was there. A consumer repository's landed reports are not in this tree.
  const store = path.join(ROOT, 'method', 'docs', 'funnel-review');
  if (fs.existsSync(store)) {
    for (const f of fs.readdirSync(store)) {
      if (!f.endsWith('.md') || f === 'README.md') continue;
      const n = lines(fs.readFileSync(path.join(store, f), 'utf8')).filter((l) => /^## Finding( |$)/.test(l)).length;
      assert.ok(n <= MAX_FINDINGS, f + ' carries ' + n + ' findings');
    }
  }
});

test('no verdict: neither the command nor the rite declares a verdict literal or a decision field', () => {
  // Spelled in halves so this file does not carry the literals it forbids elsewhere.
  const lits = ['APPROVE-AND-' + 'MERGE', 'APPROVE-PENDING-' + 'HUMAN', 'APPROVE-EXECUTOR-' + 'BLOCKED', 'REQUEST-' + 'CHANGES',
    'gatekeeper-' + 'verdict', 'harness-lead-' + 'verdict', 'CONTENT-REVIEW-' + 'CLEAR', 'permission' + 'Decision'];
  for (const f of [SOURCE, RITE]) {
    const text = fs.readFileSync(f, 'utf8');
    for (const lit of lits) assert.ok(!text.includes(lit), path.relative(ROOT, f) + ' carries ' + lit);
    assert.ok(!/^[ \t]*(decision|"decision")[ \t]*[:=]/m.test(text), path.relative(ROOT, f) + ' declares a decision field');
  }
});

test('glob metacharacters: a * and a ? survive both splits verbatim, run from a directory where both expand', { skip: !POSIX && 'the control is a POSIX shell glob' }, () => {
  const s = setup({ name: 'trap', args: [] });
  const trap = path.join(s.base, 'trap');
  assert.equal(spawnSync('/bin/sh', ['-c', 'set -- 12*; printf %s "$1"'], { cwd: trap, encoding: 'utf8' }).stdout, '12345', 'the trap is not live');
  assert.equal(spawnSync('/bin/sh', ['-c', 'set -- 34?; printf %s "$1"'], { cwd: trap, encoding: 'utf8' }).stdout, '345', 'the trap is not live');
  assert.ok(glob.includes('click-through-rate = 34?'));
  assert.ok(glob.includes('prior 2000-04 = 12*'));
  assert.ok(!/(= |prior 2000-04 = )(12345|345)( |$)/m.test(glob));
});

test('ceiling default: a known surface keeps its true clause, an unknown one gets UNDECLARED', () => {
  const gsc = lines(glob).find((l) => l.includes('gsc · clicks'));
  assert.ok(gsc, 'the unknown-surface figure was not printed');
  assert.ok(gsc.includes('consent-ceiling: UNDECLARED'));
  assert.ok(!gsc.includes('gates nothing there'));
  assert.ok(lines(glob).some((l) => l.includes('ga4 · click-through-rate') && l.includes('consenting sessions only')));
});

test('candidate rule: its shape is printed under Findings when the surfaces were read, and nowhere when they were not', () => {
  assert.ok(lines(ran).some((l) => l.startsWith('    Candidate rule: ')));
  assert.ok(lines(ran).some((l) => l.startsWith('    Evidence: ')));
  assert.ok(!nc.includes('Candidate rule'));
  assert.ok(!absent.includes('Candidate rule'));
});

test('candidate queue: a generated report holds no column-0 candidate; the published selector finds an appended one', () => {
  const sel = '^(Candidate rule|Evidence|Ruled):';
  const re = new RegExp(sel);
  assert.ok(ran.includes('until /sprint-planning'));
  assert.equal(lines(ran).filter((l) => re.test(l)).length, 0);
  const appended = ran + 'Candidate rule: probe\nEvidence: figure: ga4 sessions 10 10\n';
  assert.equal(lines(appended).filter((l) => re.test(l)).length, 2);
  const pub = "grep -nE '" + sel + "' docs/funnel-review/*.md";
  for (const doc of [RITE, PLANNING]) assert.ok(fs.readFileSync(doc, 'utf8').includes(pub), path.relative(ROOT, doc) + ' does not publish the selector verbatim');
});

test('default root: the working directory\'s repository', { skip: !GIT && 'needs git on PATH' }, () => {
  const t = transcript(/** @type {Case} */ (CASES.find((x) => x.name === 'default-root-is-cwd-repository')), nodeRunner);
  assert.ok(hasLine(t.stdout, 'commit: <COMMIT>'), String(t.stdout.split('\n').find((l) => l.startsWith('commit:'))));
});

test('literal lookup: a metric carrying . does not take another metric\'s value as its baseline (regex control live)', () => {
  const control = fs.readFileSync(path.join(FIXTURES, '2000-06.tsv'), 'utf8').split('\n')
    .filter((l) => /^figure:[ \t]+ga4[ \t]+read.depth[ \t]/.test(l)).length;
  assert.equal(control, 1, 'the fixture no longer carries a metric a regex reading would confuse');
  const l = lines(testing).find((x) => x.includes('ga4 · read.depth'));
  assert.ok(l && l.includes('not measured in 2000-06') && !l.includes('prior 2000-06 = 7'), String(l));
});

test('language caveat: on a <metric>:<piece>:<language> figure, never on an unqualified one', () => {
  const caveat = 'locale-caveat: a link pinned to one language sets this value by the link, not by the reader';
  const q = lines(testing).find((l) => l.includes('ga4 · reads:piece-a:en '));
  assert.ok(q && q.includes(caveat) && q.includes('consent-ceiling:'));
  const u = lines(testing).find((l) => l.includes('ga4 · sessions '));
  assert.ok(u && !u.includes('locale-caveat:'));
  const four = out('row-four-part-metric');
  assert.ok(!lines(four).find((l) => l.includes('ga4 · reads:piece-a:en:extra '))?.includes('locale-caveat:'));
  assert.ok(lines(four).find((l) => l.includes('ga4 · reads:piece-a:en '))?.includes('locale-caveat:'));
  assert.ok(!lines(four).find((l) => l.includes('ga4 · reads::en '))?.includes('locale-caveat:'), 'an empty part is not the declared spelling');
});

test('internal traffic: three declared states print verbatim; absent, unknown or incomplete prints UNDECLARED', () => {
  const undeclared = 'internal-traffic: UNDECLARED — figures may include the owner\'s own sessions';
  assert.ok(header(none).includes('internal-traffic: none 2000-06-01 no internal-traffic marking exists on the property (synthetic)'));
  assert.ok(header(testing).includes('internal-traffic: testing-excluded-by-query 2000-07-01 the query excludes marked sessions while the filter is in Testing (synthetic)'));
  assert.ok(header(active).includes('internal-traffic: active 2000-08-15 the property\'s data filter excludes marked sessions (synthetic)'));
  assert.ok(header(ran).includes(undeclared));
  assert.ok(header(bogus).some((l) => l.startsWith(undeclared)));
  assert.ok(!header(bogus).some((l) => l.startsWith('internal-traffic: probably-filtered')));
  for (const o of [none, testing, active]) assert.ok(!header(o).join('\n').includes('UNDECLARED'));
  for (const name of ['row-state-without-date', 'row-state-without-how']) {
    assert.ok(header(out(name)).some((l) => l.startsWith('internal-traffic: UNDECLARED')), name);
  }
});

test('contract: it declares every line the command reads, and the rite cites it and names the CLI verb', () => {
  const contract = fs.readFileSync(CONTRACT, 'utf8');
  const rite = fs.readFileSync(RITE, 'utf8');
  assert.ok(rite.includes('method/scripts/funnel-review-contract/README.md'));
  assert.ok(!rite.includes('docs/funnel-review/README' + '.md'));
  for (const lit of ['collected:', 'figure:', 'internal-traffic:', 'locale-caveat:', '<metric>:<piece>:<language>',
    'testing-excluded-by-query', 'UNDECLARED', '2000-01']) assert.ok(contract.includes(lit), 'the contract does not declare ' + lit);
  for (const text of [rite, contract]) {
    assert.ok(text.includes('mhw funnel-review'), 'the CLI verb is not named');
    // A provenance note ("until mhw#478 the script ...") may name it; an invocation or the old suite may not.
    assert.ok(!/\{\{method-scripts\}\}\/funnel-review\.sh|bash [^\n]*funnel-review\.sh|funnel-review\.test\.sh/.test(text), 'the deleted script is still run or cited as the suite');
  }
});

test('the shell original and its suite are gone', () => {
  for (const f of ['funnel-review.sh', 'funnel-review.test.sh']) {
    assert.ok(!fs.existsSync(path.join(ROOT, 'method', 'scripts', f)), f + ' still exists');
  }
});
