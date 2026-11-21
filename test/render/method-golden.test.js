// S18 parity (#489, convention 3 of #470): src/render/method.js against the deleted
// global/method/method_render.py, on the cases of test/helpers/s18-cases.js (a synthetic method source and
// throwaway homes). Every run is on a throwaway directory: HOME, CODEX_HOME, XDG_DATA_HOME and every path
// the renderer can reach are under it.
//   golden: the Node renderer in this process against the transcripts recorded from the Python original
//           (exit code, stdout, stderr and every entry under the case's directory after each run: path,
//           kind, mode, content). Every OS; the cases marked posix (symbolic links) on POSIX only.
//   live:   where the base revision still holds method_render.py and the recorded CPython is on PATH, the
//           Python original and the Node renderer side by side, on the golden cases and on this
//           repository's own method/. POSIX only. MHW_UPDATE_GOLDEN=1 rewrites the golden transcripts from
//           the Python side, never from the Node side.
//   entry:  cases through `node src/render/method.js`, the form install.sh and install.ps1 run.
// The intended differences are test/golden/S18/expected-differences.json; each is applied to both sides,
// so everything around it is still compared.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { run, asUri } from '../../src/render/method.js';
import { readGolden, writeGolden, UPDATE } from '../helpers/golden.js';
import { which } from '../helpers/home.js';
import { extractRevision } from '../helpers/parity.js';
import { CASES, FIXTURE, STAMP } from '../helpers/s18-cases.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SLICE = 'S18';
const POSIX = process.platform !== 'win32';
const WIN = !POSIX;
const SCRIPT = path.join(ROOT, 'src', 'render', 'method.js');
const declared = readGolden(SLICE, 'expected-differences.json');
/** @type {Array<{ case: string, stream: string, pattern?: string, flags?: string, replace?: string, path?: string, node?: { code: number, stderr: string }, why: string }>} */
const expected = declared.differences;
const recordedFrom = readGolden(SLICE, 'recorded-from.json');
const GIT = which('git');
const cleanups = /** @type {Array<() => void>} */ ([]);
after(() => cleanups.forEach((c) => c()));

/**
 * @typedef {{ run?: string, args?: string[], optIn?: boolean, home?: string, stamp?: string, env?: Record<string, string>,
 *   write?: string, text?: string, bytes?: string, hex?: string, edit?: string, from?: string, to?: string, rm?: string,
 *   mkdir?: string, symlink?: string, target?: string, crlf?: boolean }} Step
 * @typedef {{ name: string, posix?: boolean, steps: Step[] }} Case
 * @typedef {{ path: string, kind: string, mode: string, text?: string, hex?: string, link?: string }} Entry
 * @typedef {{ code: number, stdout: string, stderr: string, tree: Entry[] }} Run
 * @typedef {{ name: string, runs: Run[] }} Transcript
 * @typedef {(args: string[], env: Record<string, string>, cwd: string) => { code: number, stdout: string, stderr: string }} Runner
 */

/** @param {string} label */
function freshDir(label) {
  const dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'mhw-s18-' + label + '-')));
  cleanups.push(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** @param {string} a @param {string} b */
const byName = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Every entry under dir but its src/ (the source the case edits), after norm: path, kind, mode (POSIX),
 * content as text when it is UTF-8, a link's target.
 * @param {string} dir
 * @param {(s: string) => string} norm
 * @returns {Entry[]}
 */
function snapshot(dir, norm) {
  /** @type {Entry[]} */
  const out = [];
  /** @param {string} rel */
  const walk = (rel) => {
    for (const name of fs.readdirSync(path.join(dir, rel)).sort(byName)) {
      const r = rel ? rel + '/' + name : name;
      if (r === 'src') continue;
      const p = path.join(dir, r);
      const st = fs.lstatSync(p);
      const mode = POSIX ? (st.mode & 0o777).toString(8) : '-';
      if (st.isSymbolicLink()) {
        out.push({ path: r, kind: 'link', mode: '-', link: norm(fs.readlinkSync(p)) });
        continue;
      }
      if (st.isDirectory()) {
        out.push({ path: r, kind: 'dir', mode });
        walk(r);
        continue;
      }
      /** @type {Entry} */
      const e = { path: r, kind: 'file', mode };
      const raw = fs.readFileSync(p);
      const text = raw.toString('utf8');
      if (Buffer.from(text, 'utf8').equals(raw)) e.text = norm(WIN ? text.replaceAll('\r\n', '\n') : text);
      else e.hex = raw.toString('hex');
      out.push(e);
    }
  };
  walk('');
  return out;
}

/**
 * The normaliser: the case directory becomes <BASE> (also in its file-URI and JSON-escaped forms); on
 * Windows the separators of a path under it become /, so one golden serves every OS.
 * @param {string} base
 */
function normaliser(base) {
  const uri = asUri(base, process.platform);
  return (/** @type {string} */ s) => {
    let out = s.split(uri).join('file://<BASE>');
    if (WIN) {
      out = out.split(base.replaceAll('\\', '\\\\')).join('<BASE>').split(base).join('<BASE>');
      out = out.replace(/<BASE>[^\s"',;()`]*/g, (p) => p.replaceAll('\\\\', '/').replaceAll('\\', '/'));
    } else {
      out = out.split(base).join('<BASE>');
    }
    return out;
  };
}

/** Write the fixture source under dir. @param {string} dir */
function writeFixture(dir) {
  for (const [rel, text] of Object.entries(FIXTURE)) {
    const f = path.join(dir, ...rel.split('/'));
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, text);
  }
}

/** Every regular file under dir, recursively. @param {string} dir @returns {string[]} */
function filesUnder(dir) {
  /** @type {string[]} */
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...filesUnder(p));
    else if (e.isFile()) out.push(p);
  }
  return out;
}

/**
 * Run every step of c with runner; the transcript.
 * @param {Case} c
 * @param {Runner} runner
 * @param {string} [sourceDir] the method source to copy instead of the fixture
 * @returns {Transcript}
 */
function transcript(c, runner, sourceDir) {
  const base = path.join(freshDir('case'), 'case');
  const home = path.join(base, 'home');
  const src = path.join(base, 'src', 'method');
  fs.mkdirSync(home, { recursive: true });
  if (sourceDir) fs.cpSync(sourceDir, src, { recursive: true });
  else writeFixture(src);
  /** @param {string} s */
  const fill = (s) => s.split('{BASE}').join(base).split('{HOME}').join(home).split('{SRC}').join(src).split('/').join(path.sep);
  /** @param {string} s */
  const fillText = (s) => s.split('{BASE}').join(base).split('{HOME}').join(home);
  const norm = normaliser(base);
  /** @type {Run[]} */
  const runs = [];
  for (const s of c.steps) {
    if (s.write !== undefined) {
      const f = fill(s.write);
      fs.mkdirSync(path.dirname(f), { recursive: true });
      fs.writeFileSync(f, fillText(/** @type {string} */ (s.text)));
    } else if (s.bytes !== undefined) {
      const f = fill(s.bytes);
      fs.mkdirSync(path.dirname(f), { recursive: true });
      fs.writeFileSync(f, Buffer.from(/** @type {string} */ (s.hex), 'hex'));
    } else if (s.edit !== undefined) {
      const f = fill(s.edit);
      const text = fs.readFileSync(f, 'utf8');
      // In the file's own line ends: on Windows the renderer wrote \r\n.
      const crlf = text.includes('\r\n');
      const fix = (/** @type {string} */ x) => (crlf ? x.replaceAll('\n', '\r\n') : x);
      const from = fix(/** @type {string} */ (s.from));
      assert.ok(text.includes(from), c.name + ': the edit found nothing in ' + s.edit);
      fs.writeFileSync(f, text.replace(from, fix(/** @type {string} */ (s.to))));
    } else if (s.rm !== undefined) {
      fs.rmSync(fill(s.rm), { force: true });
    } else if (s.mkdir !== undefined) {
      fs.mkdirSync(fill(s.mkdir), { recursive: true });
    } else if (s.symlink !== undefined) {
      const f = fill(s.symlink);
      fs.mkdirSync(path.dirname(f), { recursive: true });
      fs.symlinkSync(fill(/** @type {string} */ (s.target)), f);
    } else if (s.crlf !== undefined) {
      for (const f of filesUnder(src)) {
        const t = fs.readFileSync(f, 'utf8').replaceAll('\r\n', '\n');
        fs.writeFileSync(f, s.crlf ? t.replaceAll('\n', '\r\n') : t);
      }
    } else {
      const args = s.args
        ? s.args.map(fill)
        : [
          '--mode=' + s.run, '--stamp=' + (s.stamp || STAMP), '--source=' + src,
          ...(s.optIn === false ? [] : ['--opt-in']), ...(s.home === undefined ? [] : ['--home=' + fill(s.home)]),
        ];
      /** @type {Record<string, string>} */
      const env = { PATH: process.env.PATH || '', HOME: home, USERPROFILE: home };
      if (process.env.SystemRoot) env.SystemRoot = process.env.SystemRoot;
      for (const [k, v] of Object.entries(s.env || {})) env[k] = fill(v);
      const r = runner(args, env, base);
      runs.push({ code: r.code, stdout: norm(r.stdout), stderr: norm(r.stderr), tree: snapshot(base, norm) });
    }
  }
  return { name: c.name, runs };
}

/** The Node renderer in this process. @type {Runner} */
const nodeRunner = (args, env, cwd) => {
  let out = '';
  let err = '';
  const code = run(args, { env, cwd, out: (x) => { out += x; }, err: (x) => { err += x; } });
  return { code, stdout: out, stderr: err };
};

/**
 * The declared differences of one case and stream, applied to text from either side.
 * @param {string} name @param {string} stream @param {string} text
 */
function fold(name, stream, text) {
  let out = text;
  for (const e of expected) {
    if ((e.case === name || e.case === '*') && e.stream === stream && e.pattern) {
      out = out.replace(new RegExp(e.pattern, e.flags || 'g'), e.replace ?? '<DECLARED>');
    }
  }
  return out;
}

/** The tree without the entries a declared difference names. @param {string} name @param {Entry[]} tree */
function foldTree(name, tree) {
  const drop = expected.filter((e) => e.case === name && e.stream === 'tree' && e.path).map((e) => new RegExp(/** @type {string} */ (e.path)));
  return tree.filter((e) => !drop.some((r) => r.test(e.path)));
}

/**
 * @param {Transcript} original
 * @param {Transcript} head
 */
function differences(original, head) {
  /** @type {string[]} */
  const diffs = [];
  const override = expected.find((e) => e.case === head.name && e.node);
  if (override && override.node) {
    // A case whose Node outcome is declared, not compared: the declared exit and refusal, and nothing written.
    const last = head.runs[head.runs.length - 1];
    if (last.code !== override.node.code) diffs.push(head.name + ': exit ' + last.code + ', declared ' + override.node.code);
    if (!last.stderr.includes(override.node.stderr)) diffs.push(head.name + ': stderr lacks the declared refusal\n' + last.stderr);
    if (last.tree.some((e) => e.path.startsWith('home/'))) diffs.push(head.name + ': the refused run wrote under home/');
    return diffs;
  }
  if (original.runs.length !== head.runs.length) return [head.name + ': ' + original.runs.length + ' runs -> ' + head.runs.length];
  original.runs.forEach((o, i) => {
    const h = head.runs[i];
    const at = head.name + ' run ' + (i + 1);
    if (o.code !== h.code) diffs.push(at + ': exit ' + o.code + ' -> ' + h.code);
    for (const stream of /** @type {const} */ (['stdout', 'stderr'])) {
      if (fold(head.name, stream, o[stream]) !== fold(head.name, stream, h[stream])) {
        diffs.push(at + ': ' + stream + ' differs\n--- original\n' + o[stream] + '\n--- head\n' + h[stream]);
      }
    }
    /** @param {Entry[]} t */
    const tree = (t) => JSON.stringify(foldTree(head.name, t).map((e) => (WIN ? { ...e, mode: '-' } : e)), null, 1);
    if (tree(o.tree) !== tree(h.tree)) diffs.push(at + ': tree differs\n--- original\n' + tree(o.tree) + '\n--- head\n' + tree(h.tree));
  });
  return diffs;
}

/** @param {string} name */
const goldenName = (name) => 'transcripts/' + name + '.json';

/** @param {Case} c */
const skipReason = (c) => (c.posix && !POSIX ? 'POSIX only (symbolic links, or a path the Windows normaliser cannot fold)' : '');

test('every case has a golden transcript and every expected difference names a case', () => {
  const names = new Set(CASES.map((c) => c.name));
  assert.equal(names.size, CASES.length, 'case names are unique');
  for (const c of CASES) assert.ok(fs.existsSync(path.join(ROOT, 'test', 'golden', SLICE, goldenName(c.name))), 'no golden for ' + c.name);
  for (const e of expected) {
    assert.ok(e.case === '*' || names.has(e.case), 'unknown case ' + e.case);
    assert.ok(e.why && e.why.length > 40, 'an expected difference states why');
    if (e.pattern) new RegExp(e.pattern, e.flags || 'g');
  }
  for (const r of declared.residuals) assert.ok(r.what && r.why && r.why.length > 40, 'a residual states why');
});

test('golden: the Node renderer matches the Python original\'s transcripts', { skip: UPDATE && 'MHW_UPDATE_GOLDEN=1' }, (t) => {
  const diffs = [];
  for (const c of /** @type {Case[]} */ (CASES)) {
    const why = skipReason(c);
    if (why) {
      t.diagnostic(c.name + ' skipped: ' + why);
      continue;
    }
    diffs.push(...differences(readGolden(SLICE, goldenName(c.name)), transcript(c, nodeRunner)));
  }
  assert.deepEqual(diffs, []);
});

test('golden: the declared difference is real in the recording, so it is not masking a no-op', () => {
  // The Python original installed a source script and accepted a token naming it; the Node renderer does neither.
  const held = readGolden(SLICE, goldenName('a-source-that-holds-scripts'));
  assert.ok(held.runs[0].tree.some((/** @type {Entry} */ e) => e.path.endsWith('/method/scripts/tool.py') && e.mode === '700'));
  assert.ok(held.runs[0].stdout.includes('; 2 scripts in '));
  const named = readGolden(SLICE, goldenName('a-token-naming-a-shipped-script'));
  assert.equal(named.runs[0].code, 0);
});

// CI sets MHW_S18_LIVE_REQUIRED=1 in a step that installs the recorded CPython: there, a base that still
// holds method_render.py with any other python3 (or none) is a failure, not a skip.
const LIVE_REQUIRED = process.env.MHW_S18_LIVE_REQUIRED === '1';

/**
 * The base revision's method_render.py and the recorded CPython; or why they are not here, and whether
 * that is a failure (MHW_S18_LIVE_REQUIRED=1 and the base still holds the script).
 * @returns {{ py?: string, script?: string, why?: string, fail?: boolean }}
 */
function pythonBase() {
  if (!POSIX) return { why: 'POSIX only' };
  if (!GIT) return { why: 'needs git on PATH', fail: LIVE_REQUIRED };
  const base = process.env.MHW_PARITY_BASE || (() => {
    const p = spawnSync(GIT, ['-C', ROOT, 'merge-base', 'HEAD', 'origin/' + (process.env.GITHUB_BASE_REF || 'rc/next')], { encoding: 'utf8' });
    return p.status === 0 ? p.stdout.trim() : '';
  })();
  if (!base) return { why: 'no base revision (MHW_PARITY_BASE unset, no merge-base with origin/rc/next)', fail: LIVE_REQUIRED };
  const dest = path.join(freshDir('base'), 'tree');
  if (!extractRevision(ROOT, base, dest)) return { why: 'base revision ' + base + ' is not readable here', fail: LIVE_REQUIRED };
  const script = path.join(dest, 'global', 'method', 'method_render.py');
  if (!fs.existsSync(script)) return { why: 'the base revision no longer holds method_render.py (this slice has merged)' };
  const py = which('python3');
  if (!py) return { why: 'needs python3 on PATH', fail: LIVE_REQUIRED };
  const version = spawnSync(py, ['-c', 'import platform; print(platform.python_version())'], { encoding: 'utf8' }).stdout.trim();
  if (version !== recordedFrom.cpython) {
    return { why: 'the goldens were recorded from CPython ' + recordedFrom.cpython + ', python3 here is ' + version, fail: LIVE_REQUIRED };
  }
  return { py, script };
}

/** @param {string} py @param {string} script @returns {Runner} */
const pythonRunner = (py, script) => (args, env, cwd) => {
  const p = spawnSync(py, ['-B', script, ...args], { env: { ...env, PYTHONIOENCODING: 'utf-8' }, cwd, encoding: 'utf8' });
  return { code: p.status ?? 1, stdout: p.stdout, stderr: p.stderr };
};

test('live: the Python original and the Node renderer side by side', (t) => {
  const b = pythonBase();
  if (!b.script || !b.py) {
    if (b.fail) assert.fail('MHW_S18_LIVE_REQUIRED=1: ' + b.why);
    t.skip(b.why);
    return;
  }
  const python = pythonRunner(b.py, b.script);
  const diffs = [];
  for (const c of /** @type {Case[]} */ (CASES)) {
    if (skipReason(c)) continue;
    const original = transcript(c, python);
    if (UPDATE) writeGolden(SLICE, goldenName(c.name), original);
    diffs.push(...differences(original, transcript(c, nodeRunner)));
  }
  assert.deepEqual(diffs, []);
});

test('live: this repository\'s method/ renders the same tree from both', (t) => {
  const b = pythonBase();
  if (!b.script || !b.py) {
    if (b.fail) assert.fail('MHW_S18_LIVE_REQUIRED=1: ' + b.why);
    t.skip(b.why);
    return;
  }
  const python = pythonRunner(b.py, b.script);
  /** @type {Case} */
  const c = {
    name: 'the-repository-method',
    steps: [{ run: 'install' }, { run: 'check' }, { run: 'dry-run' }, { run: 'uninstall', args: ['--mode=uninstall'] }],
  };
  const original = transcript(c, python, path.join(ROOT, 'method'));
  const head = transcript(c, nodeRunner, path.join(ROOT, 'method'));
  assert.ok(original.runs[0].tree.length > 100, 'the Python original rendered the method');
  assert.deepEqual(differences(original, head), []);
});

test('entry: node src/render/method.js runs the same renderer', () => {
  /** @type {Runner} */
  const entry = (args, env, cwd) => {
    const p = spawnSync(process.execPath, [SCRIPT, ...args], { env, cwd, encoding: 'utf8' });
    return { code: p.status ?? 1, stdout: p.stdout, stderr: p.stderr };
  };
  const diffs = [];
  for (const name of ['dry-run-install-check', 'usage-errors', 'check-names-each-difference', 'invalid-source-no-front-matter']) {
    const c = /** @type {Case} */ (CASES.find((x) => x.name === name));
    diffs.push(...differences(readGolden(SLICE, goldenName(name)), transcript(c, entry)));
  }
  assert.deepEqual(diffs, []);
});
