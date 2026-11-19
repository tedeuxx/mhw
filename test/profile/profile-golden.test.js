// S08 parity (#479, convention 3 of #470): `mhw profile` against the deleted global/profile/profile.py.
//   golden: every case of test/profile/cases.js runs the Node command in this process (and, on the cases
//           marked cli, through bin/mhw.js and, POSIX, ./mhw); each run's stdout, stderr, exit code and
//           working-directory tree (path, kind, mode, sha256) is compared with the transcript recorded from
//           the Python original. The compile matrix (cases.js matrix()) compares the four generated files
//           of 160 valid profiles, compiled against a synthetic floor and locale, with the original's
//           sha256s. Runs on every OS; the symlink cases are POSIX only.
//   live:   where the base revision still holds profile.py (until this slice merges) and python3 is on
//           PATH, the original runs on the same directories beside the Node command. POSIX only.
//           MHW_UPDATE_GOLDEN=1 rewrites the golden transcripts from the Python side, never from the Node side.
// Normalised before comparing: the case directory (<BASE>), and in desktop-instructions.md the floor each
// side read from its own tree's global/AGENTS.md (<FLOOR>), so a later edit of the floor is not a parity
// failure while a change to anything around it still is; in clipboard.conf, likewise, the pt-BR locale
// text (<LOCALE>). The original runs under the program name
// `mhw profile`; the one other intended difference is in test/golden/S08/expected-differences.json.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { run, compileProfile, loadProfile, plain, readText } from '../../src/commands/profile.js';
import { isPyWs } from '../../src/lib/py.js';
import { readGolden, writeGolden, UPDATE } from '../helpers/golden.js';
import { which } from '../helpers/home.js';
import { extractRevision } from '../helpers/parity.js';
import { CASES, ROOT, POSIX, matrix, SYNTHETIC } from './cases.js';

const SLICE = 'S08';
const PY = which('python3');
const GIT = which('git');
const PY_AS_MHW = "import sys; script = sys.argv[1]; sys.argv = ['mhw profile'] + sys.argv[2:]; "
  + "exec(compile(open(script, 'rb').read(), script, 'exec'), {'__name__': '__main__', '__file__': script})";
// The original's compile_profile over the matrix, with ROOT and HERE pointed at the synthetic tree.
const PY_MATRIX = [
  'import hashlib, json, sys, pathlib',
  'sys.path.insert(0, sys.argv[1]); import profile as c',
  'c.ROOT = pathlib.Path(sys.argv[2]); c.HERE = c.ROOT / "global" / "profile"',
  'out = []',
  'for text in json.load(sys.stdin):',
  '    p = json.loads(text, object_pairs_hook=c.unique_object, parse_constant=c.reject_constant)',
  '    assert c.validate(p, json.loads((c.HERE / "profile.schema.json").read_text())) == []',
  '    k = c.compile_profile(p)',
  '    out.append({n: hashlib.sha256(v.encode()).hexdigest() for n, v in k.items()})',
  'print(json.dumps(out))',
].join('\n');

/** @type {Array<{ case: string[], stream: 'stdout' | 'stderr', base: string, replace: string, why: string }>} */
const expected = readGolden(SLICE, 'expected-differences.json');
const cleanups = /** @type {Array<() => void>} */ ([]);
after(() => cleanups.forEach((c) => c()));

/**
 * @typedef {{ code: number, stdout: string, stderr: string }} Result
 * @typedef {{ name: string, root: string, run: (args: string[], cwd: string, env: Record<string, string>) => Result }} Runner
 * @typedef {{ args: string[], cwd: string, code: number, stdout: string, stderr: string, tree: string[] }} Run
 */

function freshBase() {
  const dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'mhw-s08-')));
  cleanups.push(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** The base environment: no COLUMNS, no colour. */
function baseEnv() {
  /** @type {Record<string, string>} */
  const env = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && k !== 'COLUMNS' && k !== 'FORCE_COLOR') env[k] = v;
  return Object.assign(env, { NO_COLOR: '1', PYTHON_COLORS: '0', PYTHONDONTWRITEBYTECODE: '1' });
}

/** str.rstrip() of the floor a tree's compile reads. @param {string} root */
function floorOf(root) {
  const cps = Array.from(readText(path.join(root, 'global', 'AGENTS.md')));
  let end = cps.length;
  while (end > 0 && isPyWs(cps[end - 1])) end--;
  return cps.slice(0, end).join('');
}

/**
 * The tree under dir, one line per entry: path, kind, mode (POSIX) and the content's sha256.
 * @param {string} dir
 * @param {string} floor
 * @param {string} locale
 */
function snapshot(dir, floor, locale) {
  /** @type {string[]} */
  const out = [];
  /** @param {string} rel */
  const walk = (rel) => {
    for (const name of fs.readdirSync(path.join(dir, rel)).sort()) {
      const r = rel ? rel + '/' + name : name;
      const p = path.join(dir, r);
      const st = fs.lstatSync(p);
      const mode = POSIX ? (st.mode & 0o777).toString(8) : '-';
      if (st.isSymbolicLink()) out.push(r + ' link ' + fs.readlinkSync(p));
      else if (st.isDirectory()) {
        out.push(r + ' dir ' + mode);
        walk(r);
      } else {
        let data = fs.readFileSync(p);
        if (name === 'desktop-instructions.md') data = Buffer.from(data.toString('utf8').split(floor).join('<FLOOR>'), 'utf8');
        if (name === 'clipboard.conf' && locale) data = Buffer.from(data.toString('utf8').split(locale).join('<LOCALE>'), 'utf8');
        out.push(r + ' file ' + mode + ' ' + crypto.createHash('sha256').update(data).digest('hex'));
      }
    }
  };
  walk('');
  return out;
}

/** One case directory; every run of a case goes through every runner on its own copy of the state. */
class Fixture {
  /** @param {Runner} runner */
  constructor(runner) {
    this.runner = runner;
    this.dir = freshBase();
    this.floor = floorOf(runner.root);
    this.locale = readText(path.join(runner.root, 'global', 'profile', 'locales', 'pt-BR', 'clipboard.conf'));
    /** @type {Run[]} */
    this.runs = [];
  }

  /** @param {string} rel @param {string | Uint8Array} data */
  write(rel, data) {
    fs.writeFileSync(path.join(this.dir, rel), data);
  }

  /** @param {string} rel @param {unknown} v */
  json(rel, v) {
    this.write(rel, JSON.stringify(v));
  }

  /** @param {string} rel */
  mkdir(rel) {
    fs.mkdirSync(path.join(this.dir, rel), { recursive: true });
  }

  /** @param {string} rel @param {string} target @param {boolean} [dir] */
  link(rel, target, dir = false) {
    fs.symlinkSync(target, path.join(this.dir, rel), dir ? 'dir' : 'file');
  }

  /** @param {string} rel */
  read(rel) {
    return fs.readFileSync(path.join(this.dir, rel), 'utf8');
  }

  /** @param {string} rel */
  exists(rel) {
    return fs.existsSync(path.join(this.dir, rel));
  }

  /** @param {string[]} args @param {{ env?: Record<string, string>, cwd?: string }} [o] */
  run(args, o = {}) {
    const cwd = o.cwd ? path.join(this.dir, o.cwd) : this.dir;
    const r = this.runner.run(args, cwd, { ...baseEnv(), ...(o.env || {}) });
    /** @param {string} s */
    const norm = (s) => s.replace(/\r\n/g, '\n').split(this.dir).join('<BASE>').split(ROOT).join('<ROOT>');
    this.runs.push({ args: args.map(norm), cwd: o.cwd || '', code: r.code, stdout: norm(r.stdout), stderr: norm(r.stderr),
      tree: snapshot(this.dir, this.floor, this.locale) });
  }
}

/** @type {Runner} */
const inProcess = { name: 'node', root: ROOT, run: (args, cwd, env) => {
  let out = '';
  let err = '';
  const code = run(args, { cwd, env, out: (x) => { out += x; }, err: (x) => { err += x; } });
  return { code, stdout: out, stderr: err };
} };

/** @param {string} name @param {string} root @param {string} exe @param {string[]} pre @returns {Runner} */
const spawned = (name, root, exe, pre) => ({ name, root, run: (args, cwd, env) => {
  const p = spawnSync(exe, [...pre, ...args], { cwd, env, encoding: 'utf8' });
  return { code: p.status ?? 1, stdout: p.stdout, stderr: p.stderr };
} });
const binRunner = spawned('bin/mhw.js', ROOT, process.execPath, [path.join(ROOT, 'bin', 'mhw.js'), 'profile']);
const shRunner = spawned('./mhw', ROOT, '/bin/sh', [path.join(ROOT, 'mhw'), 'profile']);

/** @param {import('./cases.js').Case} c */
const runnersFor = (c) => (c.cli ? [inProcess, binRunner, ...(POSIX ? [shRunner] : [])] : [inProcess]);
/** @param {import('./cases.js').Case} c */
const skipReason = (c) => (c.posix && !POSIX ? 'symlinks, POSIX only as the original ran them' : '');

/** @param {import('./cases.js').Case} c @param {Runner} r */
function runCase(c, r) {
  const f = new Fixture(r);
  c.build(/** @type {any} */ (f));
  return f.runs;
}

/**
 * Each head run compared with the original's, after the expected differences rewrite both.
 * @param {string} name @param {Run[]} original @param {Run[]} head @param {string} runner
 */
function differences(name, original, head, runner) {
  if (original.length !== head.length) return [name + ' (' + runner + '): run count ' + original.length + ' -> ' + head.length];
  /** @type {string[]} */
  const diffs = [];
  original.forEach((o, i) => {
    const h = head[i];
    const where = name + ' (' + runner + ') run ' + (i + 1) + ' ' + JSON.stringify(h.args).slice(0, 200);
    if (JSON.stringify([o.args, o.cwd]) !== JSON.stringify([h.args, h.cwd])) diffs.push(where + ': args differ');
    if (o.code !== h.code) diffs.push(where + ': exit ' + o.code + ' -> ' + h.code);
    for (const stream of /** @type {const} */ (['stdout', 'stderr'])) {
      let a = o[stream];
      let b = h[stream];
      for (const e of expected.filter((x) => x.case.includes(name) && x.stream === stream)) {
        a = a.replace(new RegExp(e.base, 'gm'), e.replace);
        b = b.replace(new RegExp(e.base, 'gm'), e.replace);
      }
      if (a !== b) diffs.push(where + ': ' + stream + ' differs\n--- original\n' + a + '\n--- head\n' + b);
    }
    if (JSON.stringify(o.tree) !== JSON.stringify(h.tree)) {
      diffs.push(where + ': tree differs\n--- original\n' + o.tree.join('\n') + '\n--- head\n' + h.tree.join('\n'));
    }
  });
  return diffs;
}

/** @param {string} name */
const goldenName = (name) => 'transcripts/' + name + '.json';

test('every case has a golden transcript, every golden a case, and every expected difference names a case', () => {
  const names = new Set(CASES.map((c) => c.name));
  assert.equal(names.size, CASES.length, 'case names are unique');
  for (const c of CASES) assert.ok(fs.existsSync(path.join(ROOT, 'test', 'golden', SLICE, goldenName(c.name))), 'no golden for ' + c.name);
  for (const f of fs.readdirSync(path.join(ROOT, 'test', 'golden', SLICE, 'transcripts'))) assert.ok(names.has(f.replace(/\.json$/, '')), 'golden without a case: ' + f);
  for (const e of expected) {
    for (const n of e.case) assert.ok(names.has(n), 'unknown case ' + n);
    assert.ok(e.why && e.why.length > 20, 'an expected difference states why');
    new RegExp(e.base);
  }
});

test('golden: the Node command, in process, through bin/mhw.js and ./mhw, matches the original\'s transcripts', { skip: UPDATE && 'MHW_UPDATE_GOLDEN=1' }, (t) => {
  /** @type {string[]} */
  const diffs = [];
  for (const c of CASES) {
    const why = skipReason(c);
    if (why) {
      t.diagnostic(c.name + ' skipped: ' + why);
      continue;
    }
    const golden = readGolden(SLICE, goldenName(c.name)).runs;
    for (const r of runnersFor(c)) diffs.push(...differences(c.name, golden, runCase(c, r), r.name));
  }
  assert.deepEqual(diffs, []);
});

/** A synthetic tree for the matrix: the floor, the locale and the real schema. */
function syntheticRoot() {
  const root = path.join(freshBase(), 'root');
  fs.mkdirSync(path.join(root, 'global', 'profile', 'locales', 'pt-BR'), { recursive: true });
  fs.writeFileSync(path.join(root, 'global', 'AGENTS.md'), SYNTHETIC.floor);
  fs.writeFileSync(path.join(root, 'global', 'profile', 'locales', 'pt-BR', 'clipboard.conf'), SYNTHETIC.locale);
  fs.copyFileSync(path.join(ROOT, 'global', 'profile', 'profile.schema.json'), path.join(root, 'global', 'profile', 'profile.schema.json'));
  return root;
}

/** The Node side of the matrix: sha256 of each generated file, per profile text. */
function nodeMatrix() {
  const root = syntheticRoot();
  return matrix().map((text) => {
    const dir = freshBase();
    fs.writeFileSync(path.join(dir, 'p.json'), text);
    const k = compileProfile(plain(loadProfile('p.json', { cwd: dir, platform: process.platform })), root);
    return Object.fromEntries(Object.entries(k).map(([n, v]) => [n, crypto.createHash('sha256').update(v, 'utf8').digest('hex')]));
  });
}

test('golden: the compile matrix (160 profiles, every choice) matches the original byte for byte', { skip: UPDATE && 'MHW_UPDATE_GOLDEN=1' }, () => {
  assert.deepEqual(nodeMatrix(), readGolden(SLICE, 'compile-matrix.json'));
});

/** The base revision's tree when it still holds profile.py, or a reason. */
function pythonBase() {
  if (!POSIX) return 'POSIX only, as the S04 live arm';
  if (!PY || !GIT) return 'needs python3 and git on PATH';
  const base = process.env.MHW_PARITY_BASE || (() => {
    const p = spawnSync(GIT, ['-C', ROOT, 'merge-base', 'HEAD', 'origin/' + (process.env.GITHUB_BASE_REF || 'rc/next')], { encoding: 'utf8' });
    return p.status === 0 ? p.stdout.trim() : '';
  })();
  if (!base) return 'no base revision (MHW_PARITY_BASE unset, no merge-base with origin/rc/next)';
  const dest = path.join(freshBase(), 'tree');
  if (!extractRevision(ROOT, base, dest)) return 'base revision ' + base + ' is not readable here';
  if (!fs.existsSync(path.join(dest, 'global', 'profile', 'profile.py'))) return 'the base revision no longer holds profile.py (this slice has merged)';
  return dest;
}

test('live: the Python original and the Node command side by side on the same cases', (t) => {
  const tree = pythonBase();
  if (!path.isAbsolute(tree)) {
    t.skip(tree);
    return;
  }
  const python = spawned('python', tree, /** @type {string} */ (PY), ['-B', '-c', PY_AS_MHW, path.join(tree, 'global', 'profile', 'profile.py')]);
  /** @type {string[]} */
  const diffs = [];
  for (const c of CASES) {
    if (skipReason(c)) continue;
    const original = runCase(c, python);
    if (UPDATE) writeGolden(SLICE, goldenName(c.name), { name: c.name, runs: original });
    for (const r of runnersFor(c)) diffs.push(...differences(c.name, original, runCase(c, r), r.name));
  }
  const p = spawnSync(/** @type {string} */ (PY), ['-B', '-c', PY_MATRIX, path.join(tree, 'global', 'profile'), syntheticRoot()],
    { input: JSON.stringify(matrix()), encoding: 'utf8', maxBuffer: 1 << 26 });
  assert.equal(p.status, 0, p.stderr);
  const pyMatrix = JSON.parse(p.stdout);
  if (UPDATE) writeGolden(SLICE, 'compile-matrix.json', pyMatrix);
  assert.deepEqual(diffs, []);
  assert.deepEqual(nodeMatrix(), pyMatrix);
});
