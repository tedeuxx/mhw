// S11 parity (#482, convention 3 of #470): src/render/kiro-permissions.js and src/lib/yaml-subset.js against
// the deleted global/kiro/kiro_permissions.py.
//   golden: units.json holds, for every input of test/render/kiro-cases.js, what the Python original
//           returned: the reader's document, its two serialisations and every refusal (READER), the
//           scalar reader on its own (SCALARS) and the floor loader (FLOORS). transcripts/<scenario>.json
//           holds each command-line scenario: per run of the renderer, its arguments, exit code, stdout,
//           stderr and the throwaway HOME's tree (path, kind, mode, sha256). Runs on every OS; the
//           scenarios marked posix (symbolic links, modes) on POSIX only, as they were recorded.
//   live:   where the base revision still holds kiro_permissions.py (until this slice merges) and python3
//           is on PATH, the original runs beside the Node renderer on the same inputs. POSIX only.
//           MHW_UPDATE_GOLDEN=1 rewrites the goldens from the Python side, never from the Node side.
// Normalised before comparing: the HOME directory (<HOME>), CRLF, and on Windows the path separators after
// <HOME>. The intended differences are test/golden/S11/expected-differences.json; each is applied to both
// sides, so everything around it is still compared.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parse, scalar, Refuse } from '../../src/lib/yaml-subset.js';
import { emit, loadFloor, FloorError, PyOSError } from '../../src/render/kiro-permissions.js';
import { readGolden, writeGolden, UPDATE } from '../helpers/golden.js';
import { which } from '../helpers/home.js';
import { extractRevision } from '../helpers/parity.js';
import { READER, SCALARS, FLOORS, SCENARIOS, STAMP, FLOOR } from './kiro-cases.js';

const SLICE = 'S11';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const POSIX = process.platform !== 'win32';
const PY = which('python3');
const GIT = which('git');
const NODE_SCRIPT = path.join(ROOT, 'src', 'render', 'kiro-permissions.js');

/** @type {Array<{ name: string, pattern: string, replace: string, why: string }>} */
const expected = readGolden(SLICE, 'expected-differences.json');
const cleanups = /** @type {Array<() => void>} */ ([]);
after(() => cleanups.forEach((c) => c()));

/** @param {string} label */
function freshDir(label) {
  const dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'mhw-s11-' + label + '-')));
  cleanups.push(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** Each expected difference, applied to text from either side. @param {string} text */
const intended = (text) => expected.reduce((t, e) => t.replace(new RegExp(e.pattern, 'g'), e.replace), text);

/**
 * @param {string} text @param {string} home
 * @returns {string}
 */
function norm(text, home) {
  return intended(withBase(text.replaceAll('\r\n', '\n'), home, '<HOME>'));
}

/**
 * dir replaced by placeholder; on Windows also its repr() form (backslashes doubled, as a Python OSError
 * prints a file name), and the path separators after the placeholder made '/', as the goldens were recorded.
 * @param {string} text @param {string} dir @param {string} placeholder
 */
function withBase(text, dir, placeholder) {
  if (POSIX) return text.split(dir).join(placeholder);
  const t = text.split(dir.replaceAll('\\', '\\\\')).join(placeholder).split(dir).join(placeholder);
  return t.replace(new RegExp(placeholder + '[^\\s\'"():;,]*', 'g'), (m) => m.replace(/\\+/g, '/'));
}

// --- the units: reader, scalar reader, floor loader ---------------------------------------------------

const PY_UNITS = [
  'import base64, json, os, sys, tempfile',
  'sys.path.insert(0, sys.argv[1]); import kiro_permissions as kp',
  'stamp, cases = sys.argv[2], json.load(sys.stdin)',
  'reader, scal, floors = [], [], []',
  'for d in cases["reader"]:',
  '    try:',
  '        doc = kp.parse(d)',
  '        reader.append({"doc": doc, "emit": kp.emit(doc, stamp, "x"), "bare": kp.emit(doc, stamp, "x", header=False)})',
  '    except kp.Refuse as e:',
  '        reader.append({"refuse": str(e)})',
  'for t in cases["scalars"]:',
  '    try:',
  '        scal.append({"value": kp._scalar(t, 7)})',
  '    except kp.Refuse as e:',
  '        scal.append({"refuse": str(e)})',
  'tmp = os.path.realpath(tempfile.mkdtemp(dir=sys.argv[3]))',
  'for i, f in enumerate(cases["floors"]):',
  '    p = os.path.join(tmp, "f%d.conf" % i)',
  '    if f["b64"] is not None:',
  '        with open(p, "wb") as fh:',
  '            fh.write(base64.b64decode(f["b64"]))',
  '    try:',
  '        floors.append({"want": kp.load_floor(p)})',
  '    except (OSError, ValueError) as e:',
  '        floors.append({"error": str(e).replace(tmp, "<DIR>")})',
  'print(json.dumps({"reader": reader, "scalars": scal, "floors": floors}))',
].join('\n');

const INPUTS = { reader: READER, scalars: SCALARS, floors: FLOORS };

/** The Node side of units.json. */
function nodeUnits() {
  const reader = READER.map((d) => {
    try {
      const doc = parse(d);
      return { doc, emit: emit(doc, STAMP, 'x'), bare: emit(doc, STAMP, 'x', false) };
    } catch (e) {
      if (e instanceof Refuse) return { refuse: e.message };
      throw e;
    }
  });
  const scalars = SCALARS.map((t) => {
    try {
      return { value: scalar(t, 7) };
    } catch (e) {
      if (e instanceof Refuse) return { refuse: e.message };
      throw e;
    }
  });
  const tmp = freshDir('floors');
  const floors = FLOORS.map((f, i) => {
    const p = path.join(tmp, 'f' + i + '.conf');
    if (f.b64 !== null) fs.writeFileSync(p, Buffer.from(f.b64, 'base64'));
    try {
      return { want: loadFloor(p) };
    } catch (e) {
      if (e instanceof FloorError || e instanceof PyOSError) return { error: withBase(e.message, tmp, '<DIR>') };
      throw e;
    }
  });
  return { reader, scalars, floors };
}

/** The serialisations compared after the intended differences, on both sides. @param {any} units */
const comparable = (units) => ({
  ...units,
  reader: units.reader.map((/** @type {any} */ r) => (r.emit === undefined ? r : { ...r, emit: intended(r.emit), bare: intended(r.bare) })),
});

test('units.json was recorded over exactly the inputs kiro-cases.js holds', () => {
  assert.deepEqual(readGolden(SLICE, 'units.json').inputs, INPUTS);
});

test('golden: the reader, the scalar reader and the floor loader match the original, value and refusal', { skip: UPDATE && 'MHW_UPDATE_GOLDEN=1' }, () => {
  const golden = readGolden(SLICE, 'units.json').results;
  const node = comparable(nodeUnits());
  const want = comparable(golden);
  // One assertion per input, so a failure names the input.
  READER.forEach((d, i) => assert.deepEqual(node.reader[i], want.reader[i], 'reader ' + i + ': ' + JSON.stringify(d)));
  SCALARS.forEach((t, i) => assert.deepEqual(node.scalars[i], want.scalars[i], 'scalar ' + JSON.stringify(t)));
  FLOORS.forEach((f, i) => assert.deepEqual(node.floors[i], want.floors[i], 'floor ' + f.name));
});

// --- the command-line scenarios -----------------------------------------------------------------------

/**
 * @typedef {{ args: string[], code: number, stdout: string, stderr: string, tree: string[] }} Run
 * @typedef {{ name: string, exe: string, pre: string[] }} Impl
 */

/** The tree under dir, one line per entry. @param {string} dir @param {string} home */
function snapshot(dir, home) {
  /** @type {string[]} */
  const out = [];
  /** @param {string} rel */
  const walk = (rel) => {
    for (const name of fs.readdirSync(path.join(dir, rel)).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))) {
      const r = rel ? rel + '/' + name : name;
      const p = path.join(dir, r);
      const st = fs.lstatSync(p);
      const mode = POSIX ? (st.mode & 0o777).toString(8) : '-';
      if (st.isSymbolicLink()) out.push(r + ' link ' + norm(fs.readlinkSync(p), home));
      else if (st.isDirectory()) {
        out.push(r + ' dir ' + mode);
        if (st.mode & 0o400 || !POSIX) walk(r);
      } else {
        let data;
        try {
          data = fs.readFileSync(p);
        } catch {
          out.push(r + ' file ' + mode + ' unreadable');
          continue;
        }
        const text = data.toString('utf8');
        const body = Buffer.from(text, 'utf8').equals(data) ? Buffer.from(norm(text, home), 'utf8') : data;
        out.push(r + ' file ' + mode + ' ' + crypto.createHash('sha256').update(body).digest('hex'));
      }
    }
  };
  walk('');
  return out;
}

/** @param {string} s @param {string} home */
const fill = (s, home) => s.split('{HOME}').join(home);

/**
 * Run a scenario with one implementation on a fresh HOME, umask 022.
 * @param {import('./kiro-cases.js').Scenario} sc @param {Impl} impl
 * @returns {Run[]}
 */
function runScenario(sc, impl) {
  const home = path.join(freshDir('home'), 'home');
  fs.mkdirSync(home);
  fs.writeFileSync(path.join(home, 'floor.conf'), FLOOR);
  /** @type {Record<string, string>} */
  const env = { PATH: process.env.PATH || '', HOME: home, USERPROFILE: home, LANG: 'C.UTF-8', PYTHONIOENCODING: 'utf-8', PYTHONDONTWRITEBYTECODE: '1' };
  if (process.env.SystemRoot) env.SystemRoot = process.env.SystemRoot;
  for (const [k, v] of Object.entries(sc.env || {})) env[k] = fill(v, home);
  /** @type {Run[]} */
  const runs = [];
  const at = (/** @type {string | number} */ rel) => path.join(home, String(rel));
  const old = POSIX ? process.umask(0o022) : 0;
  try {
    for (const step of sc.steps) {
      const [op, a, b, c] = step;
      switch (op) {
        case 'run': {
          const argv = step.slice(1).map((x) => fill(String(x), home));
          const p = spawnSync(impl.exe, [...impl.pre, ...argv], { cwd: home, env, encoding: 'utf8', timeout: 180000 });
          if (p.status === null) throw new Error(impl.name + ' ' + sc.name + ' ' + JSON.stringify(argv) + ': no exit status (' + (p.signal || '') + ' ' + (p.error ? p.error.message : '') + ')\n' + p.stdout + p.stderr);
          runs.push({ args: argv.map((x) => norm(x, home)), code: p.status ?? -1, stdout: norm(p.stdout, home), stderr: norm(p.stderr, home), tree: snapshot(home, home) });
          break;
        }
        case 'write':
          fs.mkdirSync(path.dirname(at(a)), { recursive: true });
          fs.writeFileSync(at(a), String(b));
          if (c !== undefined) fs.chmodSync(at(a), Number(c));
          break;
        case 'bytes':
          fs.mkdirSync(path.dirname(at(a)), { recursive: true });
          fs.writeFileSync(at(a), Buffer.from(String(b), 'base64'));
          break;
        case 'mkdir': fs.mkdirSync(at(a), { recursive: true }); break;
        case 'rmdir': fs.rmdirSync(at(a)); break;
        case 'rm': fs.unlinkSync(at(a)); break;
        case 'chmod': fs.chmodSync(at(a), Number(b)); break;
        case 'symlink': fs.symlinkSync(fill(String(b), home), at(a)); break;
        default: throw new Error('unknown step ' + op);
      }
    }
  } finally {
    if (POSIX) process.umask(old);
  }
  return runs;
}

/** @param {string} name */
const goldenName = (name) => 'transcripts/' + name + '.json';
/** @param {import('./kiro-cases.js').Scenario} sc */
const skipReason = (sc) => (sc.posix && !POSIX ? 'symbolic links and modes, POSIX only as recorded' : '');

/**
 * Each run compared with the original's.
 * @param {string} name @param {Run[]} original @param {Run[]} head
 */
function differences(name, original, head) {
  if (original.length !== head.length) return [name + ': run count ' + original.length + ' -> ' + head.length];
  /** @type {string[]} */
  const diffs = [];
  original.forEach((o, i) => {
    const h = head[i];
    const where = name + ' run ' + (i + 1) + ' ' + JSON.stringify(h.args);
    if (JSON.stringify(o.args) !== JSON.stringify(h.args)) diffs.push(where + ': args differ');
    if (o.code !== h.code) diffs.push(where + ': exit ' + o.code + ' -> ' + h.code);
    for (const s of /** @type {const} */ (['stdout', 'stderr'])) {
      // The golden was recorded normalised; an expected difference added later (#496) is applied to it here too.
      const was = intended(o[s]);
      if (was !== h[s]) diffs.push(where + ': ' + s + ' differs\n--- original\n' + was + '\n--- head\n' + h[s]);
    }
    /** @param {string[]} t */
    const cmp = (t) => (POSIX ? t : t.map((l) => l.replace(/^(\S+ (?:file|dir)) \S+/, '$1 -')));
    if (JSON.stringify(cmp(o.tree)) !== JSON.stringify(cmp(h.tree))) {
      diffs.push(where + ': tree differs\n--- original\n' + cmp(o.tree).join('\n') + '\n--- head\n' + cmp(h.tree).join('\n'));
    }
  });
  return diffs;
}

/** @type {Impl} */
const NODE = { name: 'node', exe: process.execPath, pre: [NODE_SCRIPT] };

test('every scenario has a golden transcript, every transcript a scenario, and every expected difference states why', () => {
  const names = new Set(SCENARIOS.map((s) => s.name));
  assert.equal(names.size, SCENARIOS.length, 'scenario names are unique');
  const dir = path.join(ROOT, 'test', 'golden', SLICE, 'transcripts');
  for (const s of SCENARIOS) assert.ok(fs.existsSync(path.join(ROOT, 'test', 'golden', SLICE, goldenName(s.name))), 'no golden for ' + s.name);
  for (const f of fs.readdirSync(dir)) assert.ok(names.has(f.replace(/\.json$/, '')), 'golden without a scenario: ' + f);
  for (const e of expected) {
    assert.ok(e.why && e.why.length > 40, 'an expected difference states why: ' + e.name);
    assert.ok(new RegExp(e.pattern).source, e.name);
  }
});

test('golden: every command-line scenario of the Node renderer matches the original\'s transcript', { skip: UPDATE && 'MHW_UPDATE_GOLDEN=1' }, (t) => {
  /** @type {string[]} */
  const diffs = [];
  for (const sc of SCENARIOS) {
    const why = skipReason(sc);
    if (why) {
      t.diagnostic(sc.name + ' skipped: ' + why);
      continue;
    }
    diffs.push(...differences(sc.name, readGolden(SLICE, goldenName(sc.name)).runs, runScenario(sc, NODE)));
  }
  assert.deepEqual(diffs, []);
});

// --- the live arm ---------------------------------------------------------------------------------------

/** The base revision's tree when it still holds kiro_permissions.py, or a reason. */
function pythonBase() {
  if (!POSIX) return 'POSIX only, as the earlier slices\' live arms';
  if (!PY || !GIT) return 'needs python3 and git on PATH';
  const base = process.env.MHW_PARITY_BASE || (() => {
    const p = spawnSync(GIT, ['-C', ROOT, 'merge-base', 'HEAD', 'origin/' + (process.env.GITHUB_BASE_REF || 'rc/next')], { encoding: 'utf8' });
    return p.status === 0 ? p.stdout.trim() : '';
  })();
  if (!base) return 'no base revision (MHW_PARITY_BASE unset, no merge-base with origin/rc/next)';
  const dest = path.join(freshDir('base'), 'tree');
  if (!extractRevision(ROOT, base, dest)) return 'base revision ' + base + ' is not readable here';
  if (!fs.existsSync(path.join(dest, 'global', 'kiro', 'kiro_permissions.py'))) return 'the base revision no longer holds kiro_permissions.py (this slice has merged)';
  return dest;
}

test('live: the Python original and the Node renderer side by side on the same inputs', (t) => {
  const tree = pythonBase();
  if (!path.isAbsolute(tree)) {
    t.skip(tree);
    return;
  }
  const p = spawnSync(/** @type {string} */ (PY), ['-B', '-c', PY_UNITS, path.join(tree, 'global', 'kiro'), STAMP, freshDir('pyunits')],
    { input: JSON.stringify(INPUTS), encoding: 'utf8', maxBuffer: 1 << 26 });
  assert.equal(p.status, 0, p.stderr);
  const pyUnits = JSON.parse(p.stdout);
  if (UPDATE) writeGolden(SLICE, 'units.json', { inputs: INPUTS, results: pyUnits });
  assert.deepEqual(comparable(nodeUnits()), comparable(pyUnits));
  /** @type {Impl} */
  const python = { name: 'python', exe: /** @type {string} */ (PY), pre: ['-B', path.join(tree, 'global', 'kiro', 'kiro_permissions.py')] };
  /** @type {string[]} */
  const diffs = [];
  for (const sc of SCENARIOS) {
    const original = runScenario(sc, python);
    if (UPDATE) writeGolden(SLICE, goldenName(sc.name), { name: sc.name, runs: original });
    diffs.push(...differences(sc.name, original, runScenario(sc, NODE)));
  }
  assert.deepEqual(diffs, []);
});
