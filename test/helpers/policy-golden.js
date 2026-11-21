// The parity harness of the two project-policy ports (convention 3 of #470): S28's `mhw policy`
// (test/project-policy/project-policy-golden.test.js) and S29's `mhw delivery-gate`
// (test/project-policy/delivery-gate-golden.test.js). Both compare a Node command with a deleted Python
// original, on cases run in throwaway directories, against golden transcripts recorded from it:
//   golden: the Node command against the transcripts. Every OS; a case the slice's skip names is skipped.
//   live:   where the base revision still holds the original and the recorded CPython is on PATH, both
//           side by side on every case. POSIX only. MHW_UPDATE_GOLDEN=1 rewrites the transcripts from the
//           Python side, never the Node side. MHW_S<nn>_LIVE_REQUIRED=1 turns a skip into a failure while
//           the base still holds the original.
// The slice's test/golden/S<nn>/expected-differences.json is applied to both sides of each comparison.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { readGolden, writeGolden, UPDATE } from './golden.js';
import { which } from './home.js';
import { extractRevision } from './parity.js';

export const POSIX = process.platform !== 'win32';
/** Code-unit order, explicit. @param {string} a @param {string} b */
const byString = (a, b) => Number(a > b) - Number(a < b);

/**
 * @typedef {{ code: number | null, stdout: string, stderr: string }} Run
 * @typedef {{ name: string, args: string[], run: Run }} Transcript
 * @typedef {(args: string[], env: Record<string, string>, cwd: string) => Run} Runner
 * @typedef {{ name: string, args: string[] }} Case
 */

/**
 * @typedef {{ doc?: any, text?: string, hex?: string, dir?: true, link?: string, mode?: number }} CaseFile
 *   `doc` is written as JSON (two-space indent), `text` verbatim (UTF-8), `hex` as bytes; `dir` is a
 *   directory and `link` a symbolic link to that path under the case directory (POSIX); `mode` is set
 *   after the write and put back to 0600 by restoreModes.
 */

/** @param {string} base @param {string} rel */
export const under = (base, rel) => path.join(base, ...rel.split('/'));

/**
 * Write a case's files under base; the paths whose mode was changed.
 * @param {string} base @param {Record<string, CaseFile>} files @returns {string[]}
 */
export function writeFiles(base, files) {
  const modes = [];
  for (const [rel, f] of Object.entries(files)) {
    const p = under(base, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.rmSync(p, { force: true });
    if (f.dir) fs.mkdirSync(p, { recursive: true });
    else if (f.link !== undefined) fs.symlinkSync(under(base, f.link), p);
    else if (f.doc !== undefined) fs.writeFileSync(p, JSON.stringify(f.doc, null, 2) + '\n');
    else if (f.hex !== undefined) fs.writeFileSync(p, Buffer.from(f.hex, 'hex'));
    else fs.writeFileSync(p, /** @type {string} */ (f.text));
    if (f.mode !== undefined) {
      fs.chmodSync(p, f.mode);
      modes.push(p);
    }
  }
  return modes;
}

/** @param {string[]} modes */
export const restoreModes = (modes) => modes.forEach((p) => fs.chmodSync(p, 0o600));

/**
 * The case's arguments ({BASE} is its directory, / the platform's separator) and its environment (base
 * is its HOME). With onlyPaths, only an argument naming {BASE} has its separators converted, so a value
 * such as --repository=owner/name keeps its slash on Windows.
 * @param {string[]} args @param {string} base @param {{ onlyPaths?: boolean }} [opts]
 * @returns {{ args: string[], env: Record<string, string> }}
 */
export function caseRun(args, base, opts = {}) {
  /** @type {Record<string, string>} */
  const env = { PATH: process.env.PATH || '', HOME: base, USERPROFILE: base, LANG: 'en_US.UTF-8' };
  if (process.env.SystemRoot) env.SystemRoot = process.env.SystemRoot;
  /** @param {string} a */
  const convert = (a) => !POSIX && (!opts.onlyPaths || a.includes('{BASE}'));
  return { args: args.map((a) => (convert(a) ? a.split('/').join(path.sep) : a).split('{BASE}').join(base)), env };
}

/** The run, the case directory written <BASE>. @param {Run} r @param {string} base @returns {Run} */
export function normalised(r, base) {
  /** @param {string} s */
  const norm = (s) => s.split(base).join('<BASE>');
  return { code: r.code, stdout: norm(r.stdout), stderr: norm(r.stderr) };
}

/**
 * @param {{ root: string, slice: string, original: string, baseCheck?: () => string | null }} o
 *   original: the deleted file, relative to the repository; baseCheck: one more precondition of the live
 *   arm, its reason when it is unmet
 */
export function harness(o) {
  const { root, slice } = o;
  const declared = readGolden(slice, 'expected-differences.json');
  /** @type {Array<{ case: string, stream: string, pattern: string, flags?: string, replace?: string, why: string }>} */
  const expected = declared.differences;
  const recordedFrom = readGolden(slice, 'recorded-from.json');
  const cleanups = /** @type {Array<() => void>} */ ([]);
  after(() => cleanups.forEach((c) => c()));
  const liveRequired = process.env['MHW_' + slice + '_LIVE_REQUIRED'] === '1';

  /** @param {string} label */
  function freshDir(label) {
    const dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'mhw-' + slice.toLowerCase() + '-' + label + '-')));
    cleanups.push(() => {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {
        // a mode-000 file under a read-only parent; the next chmod pass removes it
      }
    });
    return dir;
  }

  /** On Windows every backslash compares as /, on both sides: the recordings are macOS. @param {string} s */
  const separators = (s) => (POSIX ? s : s.replaceAll('\\', '/'));

  /** @param {string} name @param {string} stream @param {string} textIn */
  function fold(name, stream, textIn) {
    let out = textIn;
    for (const e of expected) {
      if ((e.case === name || e.case === '*') && e.stream === stream) {
        out = out.replace(new RegExp(e.pattern, e.flags || 'g'), e.replace ?? '<DECLARED>');
      }
    }
    return out;
  }

  /** @param {Transcript} original @param {Transcript} head */
  function differences(original, head) {
    /** @type {string[]} */
    const diffs = [];
    if (original.run.code !== head.run.code) diffs.push(head.name + ': exit ' + original.run.code + ' -> ' + head.run.code);
    for (const stream of /** @type {const} */ (['stdout', 'stderr'])) {
      if (separators(fold(head.name, stream, original.run[stream])) !== separators(fold(head.name, stream, head.run[stream]))) {
        diffs.push(head.name + ': ' + stream + ' differs\n--- original\n' + original.run[stream] + '\n--- head\n' + head.run[stream]);
      }
    }
    return diffs;
  }

  /** @param {string} name */
  const goldenName = (name) => 'transcripts/' + name + '.json';

  /** The inventory: a golden per case, none without its case, and every declared difference well formed. @param {Case[]} cases */
  function inventoryTest(cases) {
    test('every case has a golden transcript and every expected difference names a case', () => {
      const names = new Set(cases.map((c) => c.name));
      assert.equal(names.size, cases.length, 'case names are unique');
      for (const c of cases) assert.ok(fs.existsSync(path.join(root, 'test', 'golden', slice, goldenName(c.name))), 'no golden for ' + c.name);
      for (const e of expected) {
        assert.ok(e.case === '*' || names.has(e.case), 'unknown case ' + e.case);
        assert.ok(e.why && e.why.length > 40, 'an expected difference states why');
        assert.doesNotThrow(() => new RegExp(e.pattern, e.flags || 'g'), 'a valid pattern: ' + e.pattern);
      }
      for (const r of declared.residuals) assert.ok(r.what && r.why && r.why.length > 40, 'a residual states why');
      const golden = fs.readdirSync(path.join(root, 'test', 'golden', slice, 'transcripts')).sort(byString);
      assert.deepEqual(golden, [...names].map((n) => n + '.json').sort(byString), 'no golden without its case');
    });
  }

  /**
   * @template {Case} C
   * @param {C[]} cases @param {(c: C, runner: Runner) => Transcript} transcript @param {Runner} nodeRunner
   * @param {(c: C) => string} skipReason
   */
  function goldenTest(cases, transcript, nodeRunner, skipReason) {
    test('golden: the Node command matches the Python original\'s transcripts', { skip: UPDATE && 'MHW_UPDATE_GOLDEN=1' }, (t) => {
      const diffs = [];
      for (const c of cases) {
        const why = skipReason(c);
        if (why) {
          t.diagnostic(c.name + ' skipped: ' + why);
          continue;
        }
        const recorded = readGolden(slice, goldenName(c.name));
        assert.deepEqual(recorded.args, c.args, c.name + ': the case still has the arguments it was recorded with');
        diffs.push(...differences(recorded, transcript(c, nodeRunner)));
      }
      assert.deepEqual(diffs, []);
    });
  }

  /**
   * The base revision's tree and the recorded CPython; or why they are not here, and whether that is a
   * failure (MHW_S<nn>_LIVE_REQUIRED=1 and the base still holds the original).
   * @returns {{ py?: string, tree?: string, why?: string, fail?: boolean }}
   */
  function pythonBase() {
    if (!POSIX) return { why: 'POSIX only' };
    const git = which('git');
    if (!git) return { why: 'needs git on PATH', fail: liveRequired };
    const base = process.env.MHW_PARITY_BASE || (() => {
      const p = spawnSync(git, ['-C', root, 'merge-base', 'HEAD', 'origin/' + (process.env.GITHUB_BASE_REF || 'rc/next')], { encoding: 'utf8' });
      return p.status === 0 ? p.stdout.trim() : '';
    })();
    if (!base) return { why: 'no base revision (MHW_PARITY_BASE unset, no merge-base with origin/rc/next)', fail: liveRequired };
    const tree = path.join(freshDir('base'), 'tree');
    if (!extractRevision(root, base, tree)) return { why: 'base revision ' + base + ' is not readable here', fail: liveRequired };
    if (!fs.existsSync(path.join(tree, ...o.original.split('/')))) {
      return { why: 'the base revision no longer holds ' + path.basename(o.original) + ' (this slice has merged)' };
    }
    const py = which('python3');
    if (!py) return { why: 'needs python3 on PATH', fail: liveRequired };
    const version = spawnSync(py, ['-c', 'import platform; print(platform.python_version())'], { encoding: 'utf8' }).stdout.trim();
    if (version !== recordedFrom.cpython) {
      return { why: 'the goldens were recorded from CPython ' + recordedFrom.cpython + ', python3 here is ' + version, fail: liveRequired };
    }
    const unmet = o.baseCheck ? o.baseCheck() : null;
    if (unmet) return { why: unmet, fail: liveRequired };
    return { py, tree };
  }

  /**
   * @template {Case} C
   * @param {C[]} cases @param {(c: C, runner: Runner) => Transcript} transcript @param {Runner} nodeRunner
   * @param {(py: string, tree: string) => Runner} pythonRunner @param {(c: C) => string} skipReason
   */
  function liveTest(cases, transcript, nodeRunner, pythonRunner, skipReason) {
    test('live: the Python original and the Node command side by side', (t) => {
      const b = pythonBase();
      if (!b.tree || !b.py) {
        if (b.fail) assert.fail('MHW_' + slice + '_LIVE_REQUIRED=1: ' + b.why);
        t.skip(b.why);
        return;
      }
      const python = pythonRunner(b.py, b.tree);
      const diffs = [];
      for (const c of cases) {
        if (skipReason(c)) continue;
        const recorded = transcript(c, python);
        if (UPDATE) writeGolden(slice, goldenName(c.name), recorded);
        diffs.push(...differences(recorded, transcript(c, nodeRunner)));
      }
      assert.deepEqual(diffs, []);
    });
  }

  /** Every recorded run, for a slice's own coverage test. @param {Case[]} cases @returns {Run[]} */
  const runs = (cases) => cases.map((c) => readGolden(slice, goldenName(c.name)).run);

  return { freshDir, separators, differences, inventoryTest, goldenTest, liveTest, runs };
}
