// S24 parity (#495, convention 3 of #470): mhw install, update, uninstall, postinstall and the usage text in
// Node (src/commands/lifecycle.js, install.js, update.js, uninstall.js, postinstall.js) against the deleted
// global/workstation.py, reached through the shell ./mhw. Throwaway HOMEs, a throwaway admin root
// (WORKSTATION_MANAGED_ROOT, so no sudo ever runs) and a stand-in npm (MHW_NPM) only; an update runs on the
// case's own git origin and clone, never on this checkout.
// Each case (test/lifecycle/cases.js) runs its steps on a fresh HOME through `node <tree>/bin/mhw.js`, on a
// copy of the tree with a synthetic provenance stamp (.workstation-archive), so both sides print the same.
// Each step records its exit code, stdout and stderr, and the case ends with the written file tree of the
// HOME and the admin root (content, mode, link-ness), all normalised. The live arm compares it all; the
// golden keeps the tree without content (forGolden below).
//   golden: each case runs on the head and is compared with the transcript recorded from the original
//           (macOS, where the transcripts were recorded: the installers' target lists differ per OS).
//   live:   where the base revision still holds global/workstation.py, the original runs beside the head on
//           the same case (macOS and Linux). MHW_UPDATE_GOLDEN=1 rewrites the transcripts from the original
//           side only. MHW_S24_LIVE_REQUIRED=1 turns a skip into a failure while the base still holds it.
// The intended differences are in test/golden/S24/expected-differences.json, with reasons.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { readGolden, writeGolden, UPDATE } from '../helpers/golden.js';
import { throwawayHome, which } from '../helpers/home.js';
import { copyWorkingTree, snapshotTree } from '../helpers/parity.js';
import { goldenName, differences as diffsOf, baseTree } from '../helpers/mcp-golden.js';
import { CASES, git } from './cases.js';
import { stubInstallers, stubEnv } from './stub-installers.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SLICE = 'S24';
const POSIX = process.platform !== 'win32';
const DARWIN = process.platform === 'darwin';
const NODE = process.execPath;
/** @type {Array<{ case: string[], stream: string[], base?: string, head: string, replace: string, why: string, observed?: boolean, pinned_by?: any }>} */
const expected = readGolden(SLICE, 'expected-differences.json');
const RECORDED = readGolden(SLICE, 'recorded-from.json');
const COMMIT = 'c'.repeat(40);
const TOOLS = ['node', 'python3', 'jq', 'git'];
const h = throwawayHome('lifecycle-golden');
// Development only: MHW_S24_ONLY=<case,...> plays (and with MHW_UPDATE_GOLDEN=1 records) those cases.
const ONLY = (process.env.MHW_S24_ONLY || '').split(',').filter(Boolean);
const PLAYED = CASES.filter((c) => !ONLY.length || ONLY.includes(c.name));
after(() => h.cleanup());

/** Why the cases cannot run here, or ''. */
export function missing() {
  if (!POSIX) return 'POSIX only: on Windows install is mhw install-windows (#497), update is answered by src/cli.js, and uninstall does not exist';
  for (const t of TOOLS) if (!which(t)) return t + ' is not on PATH';
  return '';
}

/** @param {string} tree */
function archive(tree) {
  fs.writeFileSync(path.join(tree, '.workstation-archive'), 'commit: ' + COMMIT + '\ndescribe: v3.1.0\n');
}

/** A copy of a tree, stamped v3.1.0. @param {string} from @param {string} dest */
function copyTree(from, dest) {
  if (from === ROOT) copyWorkingTree(ROOT, dest);
  else fs.cpSync(from, dest, { recursive: true, verbatimSymlinks: true });
  fs.rmSync(path.join(dest, '.git'), { recursive: true, force: true });
  archive(dest);
}

/** @param {string} text @param {Array<[string, string]>} subs */
function normalise(text, subs) {
  let t = text.replaceAll('\r\n', '\n');
  for (const [a, b] of [...subs].sort((x, y) => y[0].length - x[0].length)) if (a) t = t.replaceAll(a, b);
  // The two sides' trees are different commits of the case's own repository.
  return t.replaceAll(/(release: [^;\n]*; commit: )[0-9a-f]{40}/g, '$1<COMMIT>').replaceAll(/\(detached; was [0-9a-f]{7,40}\)/g, '(detached; was <COMMIT>)');
}

/** The PATH directory of a case: links to its tools and the stand-in npm. @param {string} dir */
function binDir(dir) {
  const bin = path.join(dir, 'bin');
  fs.mkdirSync(bin, { recursive: true });
  for (const t of TOOLS) fs.symlinkSync(t === 'node' ? NODE : /** @type {string} */ (which(t)), path.join(bin, t));
  const npm = path.join(dir, 'npm-stand-in');
  fs.writeFileSync(npm, '#!/bin/sh\nfor a in "$@"; do printf \'%s\\n\' "$a" >> "$NPM_LOG"; done\nexit "${NPM_EXIT:-0}"\n');
  fs.chmodSync(npm, 0o700);
  return bin;
}

/**
 * One case on one side: every step's exit code, stdout and stderr, and the written tree at the end.
 * @param {import('./cases.js').Case} c @param {string} from the mhw tree (the head's ROOT, or the base's)
 */
function play(c, from) {
  const base = fs.mkdtempSync(path.join(h.dir, 'case-'));
  const home = path.join(base, 'home');
  const root = path.join(base, 'root');
  const tmp = path.join(base, 'tmp');
  for (const d of [home, root, tmp]) fs.mkdirSync(d, { recursive: true });
  const gitExe = /** @type {string} */ (which('git'));
  let tree = path.join(base, 'tree');
  /** @type {import('./cases.js').Where} */
  const w = { home, root, dir: base, tree, git: gitExe };
  if (c.layout === 'git') {
    const origin = path.join(base, 'origin');
    copyTree(from, origin);
    fs.rmSync(path.join(origin, '.workstation-archive'));
    git(w, origin, 'init', '-q');
    git(w, origin, 'add', '-A');
    git(w, origin, 'commit', '-q', '-m', 'base');
    git(w, origin, 'tag', 'v9.0.0');
    fs.appendFileSync(path.join(origin, 'global', 'AGENTS.md'), '\nline added in 9.1\n');
    git(w, origin, 'commit', '-q', '-am', 'next');
    git(w, origin, 'tag', 'v9.1.0');
    tree = path.join(base, 'clone');
    w.tree = tree;
    git(w, base, 'clone', '-q', origin, tree);
    git(w, tree, 'checkout', '-q', 'v9.0.0');
  } else {
    copyTree(from, tree);
    // A checkout to mhw (package.json and .git), no repository to git.
    if (c.layout === 'checkout') fs.mkdirSync(path.join(tree, '.git'));
  }
  if (c.stub) stubInstallers(tree);
  fs.mkdirSync(path.join(base, 'overlay'));
  const bin = binDir(base);
  c.setup?.(w);
  /** @type {Array<[string, string]>} */
  const subs = [[fs.realpathSync(tree), '<ROOT>'], [tree, '<ROOT>'], [home, '<HOME>'], [root, '<ADMIN>'], [base, '<TMP>'], [NODE, '<NODE>'], [bin, '<BIN>']];
  /** @type {Record<string, unknown>} */
  const out = {};
  for (const [i, step] of c.steps.entries()) {
    step.pre?.(w);
    /** @type {Record<string, string>} */
    const env = { PATH: bin + ':/usr/bin:/bin', HOME: home, TMPDIR: tmp, WORKSTATION_MANAGED_ROOT: root, LANG: 'C.UTF-8', SHELL: '/bin/sh',
      NPM_LOG: path.join(base, 'npm-args'), GIT_CONFIG_NOSYSTEM: '1',
      // git never looks for a repository above the case's directory, so no step can reach another checkout.
      GIT_CEILING_DIRECTORIES: base };
    if (c.stub) Object.assign(env, stubEnv(base));
    for (const [k, v] of Object.entries({ ...(c.env || {}), ...(step.env || {}) })) env[k] = v.replaceAll('<NPM>', path.join(base, 'npm-stand-in'));
    const args = step.args.map((a) => (a === '<OVERLAY>' ? '--overlay=' + path.join(base, 'overlay') : a));
    const p = spawnSync(NODE, [path.join(tree, 'bin', 'mhw.js'), ...args], { env, cwd: base, encoding: 'utf8', timeout: 600000 });
    const label = 'step' + i + ' ' + step.args.join(' ');
    out[label] = { code: p.status };
    out[label + ' stdout'] = normalise(p.stdout, subs);
    out[label + ' stderr'] = normalise(p.stderr, subs);
    const recorded = step.post?.(w);
    if (recorded !== undefined) out[label + ' recorded'] = normalise(recorded, subs);
  }
  /** @type {Record<string, string>} */
  const files = {};
  for (const [label, dir] of /** @type {const} */ ([['home', home], ['admin', root]])) {
    for (const e of snapshotTree(dir, subs)) {
      // npm's and the installers' own backups carry a timestamp in their name; their content is compared.
      files[label + '/' + e.path.replaceAll(/\d{8}T?\d{6}(\.\d+)?/g, '<STAMP>')] = e.kind + ' ' + e.mode + ' ' + e.data;
    }
  }
  out.files = files;
  // Each case copies the tree (a git case three times): free it now, not at the end of the file.
  fs.rmSync(base, { recursive: true, force: true });
  return out;
}

/** @param {string} name @param {Record<string, any>} base @param {Record<string, any>} head */
const differences = (name, base, head) => diffsOf(expected, name, base, head);

/**
 * A transcript as the golden keeps it. The live arm compares the written files' content between the two
 * sides; the golden keeps each file's path, kind and mode, and a rendered file's sha256 as a placeholder,
 * so a later change to what the installers render (a deny-floor rule, the brief) does not read as a
 * change of mhw install, which a deleted original could no longer re-record.
 * @param {Record<string, any>} t
 */
export function forGolden(t) {
  /** @type {Record<string, any>} */
  const out = {};
  for (const [k, v] of Object.entries(t)) {
    if (k === 'files') out.files = Object.fromEntries(Object.entries(v).map(([f, e]) => [f, String(e).split(' ').slice(0, 2).join(' ')]));
    else out[k] = typeof v === 'string' ? v.replaceAll(/sha256: [0-9a-f]{64}/g, 'sha256: <SHA256>') : v;
  }
  return out;
}
// Development only: MHW_S24_DIFF_FILE=<path> also writes the differences found there, in full.
/** @param {string[]} diffs */
const report = (diffs) => {
  if (process.env.MHW_S24_DIFF_FILE && diffs.length) fs.writeFileSync(process.env.MHW_S24_DIFF_FILE, diffs.join('\n\n=====\n\n'));
  assert.equal(diffs.length, 0, diffs.map((d) => d.split('\n')[0]).join('; '));
};

test('every case has a golden transcript, every golden a case, and every expected difference names a case and says why', () => {
  const names = new Set(CASES.map((c) => c.name));
  assert.equal(names.size, CASES.length, 'case names are unique');
  const dir = path.join(ROOT, 'test', 'golden', SLICE, 'transcripts');
  for (const n of names) assert.ok(fs.existsSync(path.join(dir, n + '.json')), 'no golden for ' + n);
  for (const f of fs.readdirSync(dir)) assert.ok(names.has(f.replace(/\.json$/, '')), 'golden without a case: ' + f);
  for (const e of expected) {
    for (const n of e.case) assert.ok(n === '*' || names.has(n), 'unknown case ' + n);
    assert.ok(e.why && e.why.length > 40, 'an expected difference states why');
    assert.doesNotThrow(() => new RegExp(e.head));
    // A residual (observed: false) is a difference no transcript shows; it names the test that pins it.
    if (e.observed === false) {
      assert.deepEqual(e.stream, ['residual'], 'a residual matches no stream');
      const file = path.join(ROOT, e.pinned_by.file);
      assert.ok(fs.existsSync(file), 'no such test file ' + e.pinned_by.file);
      assert.ok(fs.readFileSync(file, 'utf8').includes("test('" + e.pinned_by.test + "'"), 'no test named ' + e.pinned_by.test + ' in ' + e.pinned_by.file);
    }
  }
  assert.equal(expected.filter((e) => e.observed === false).length, 4, 'the four residuals of PR #542');
});

test('golden: the Node lifecycle commands match the transcripts of workstation.py', { skip: (!DARWIN && 'the transcripts were recorded on macOS; the live arm runs on Linux') || missing() || (UPDATE && 'MHW_UPDATE_GOLDEN=1') }, () => {
  /** @type {string[]} */
  const diffs = [];
  for (const c of PLAYED) diffs.push(...differences(c.name, readGolden(SLICE, goldenName(c.name)), forGolden(play(c, ROOT))));
  report(diffs);
});

test('live: the lifecycle commands of the base revision\'s workstation.py, side by side with the head', (t) => {
  const why = missing();
  const py = which('python3');
  const version = py ? spawnSync(py, ['-c', 'import platform; print(platform.python_version())'], { encoding: 'utf8' }).stdout.trim() : '';
  const holds = why || (version !== RECORDED.cpython && 'needs CPython ' + RECORDED.cpython + ' (found ' + (version || 'none') + ')') || '';
  const base = holds || baseTree({ root: ROOT, dir: h.dir, holds: path.join('global', 'workstation.py') });
  if (!path.isAbsolute(base)) {
    if (process.env.MHW_S24_LIVE_REQUIRED === '1' && !base.includes('has merged')) assert.fail('the live arm is required here: ' + base);
    t.skip(base);
    return;
  }
  /** @type {string[]} */
  const diffs = [];
  for (const c of PLAYED) {
    const was = play(c, base);
    if (UPDATE) {
      assert.ok(DARWIN, 'the transcripts are recorded on macOS');
      writeGolden(SLICE, goldenName(c.name), forGolden(was));
    }
    diffs.push(...differences(c.name, was, play(c, ROOT)));
  }
  report(diffs);
});
