// S24 (#495): the one root command line the owner's `mhw install` runs for the admin layer, held on a golden
// recorded from the deleted global/workstation.py (the Issue's main risk: any drift in its quoting is an
// owner act going wrong). Nothing here runs sudo, an installer or any process: adminApply() and asRoot()
// take a recording runner, and the scenarios feed them a synthetic render of the admin-layer installer
// (mhw install-admin since #496; global/install-managed.sh before).
//   golden: src/lib/lifecycle.js against test/golden/S24/admin-lines.json, on every OS.
//   live:   the base revision's workstation.py through test/helpers/s24-admin-line.py, on the recorded
//           CPython, while the base still holds it. MHW_UPDATE_GOLDEN=1 rewrites the golden from that side.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { readGolden, writeGolden, UPDATE } from '../helpers/golden.js';
import { throwawayHome, which } from '../helpers/home.js';
import { allow, baseTree } from '../helpers/mcp-golden.js';
import { adminApply, asRoot, ADMIN, MHW_JS, NODE, SUDO } from '../../src/lib/lifecycle.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SLICE = 'S24';
const RECORDED = readGolden(SLICE, 'recorded-from.json');
const expected = readGolden(SLICE, 'expected-differences.json');
const h = throwawayHome('admin-line');
after(() => h.cleanup());

const HERE = '<INSTALL_MANAGED>';
const STAGE = '/Users/someone/Library/Caches/mhw stage/admin-stage.ABC123';
const SHA = '0123456789abcdef'.repeat(4);
/** @type {Record<string, [number, string[]]>} */
const RENDERS = {
  rendered: [0, ['STAGED  admin layer in ' + STAGE, 'RUN     sudo /bin/sh "' + HERE + '" --apply="' + STAGE + '" --sha256=' + SHA,
    'THEN    mhw install   (detects the admin layer and removes the user-level duplicates), then open fresh sessions']],
  'rendered-with-root': [0, ['RUN     sudo /bin/sh "' + HERE + '" --apply="' + STAGE + '" --sha256=' + SHA + ' --root="/tmp/r"']],
  'verbose-lines': [0, ['OK      something', 'DRIFT   other', 'CHANGED x -> y', 'RUN     sudo /bin/sh "' + HERE + '" --apply="' + STAGE + '" --sha256=' + SHA, 'THEN    next']],
  'no-run-line': [0, ['STAGED  admin layer in ' + STAGE]],
  'upper-case-hash': [0, ['RUN     sudo /bin/sh "' + HERE + '" --apply="' + STAGE + '" --sha256=ABCDEF']],
  'render-failed': [4, ['REFUSE  the stage could not be written']],
};

/** The same scenarios on the Node side, in the recorder's shape. */
function head() {
  /** @type {Record<string, unknown>} */
  const result = {};
  for (const name of Object.keys(RENDERS)) {
    for (const [label, root] of /** @type {Array<[string, string | null]>} */ ([['sudo', null], ['managed-root', '/tmp/throwaway root']])) {
      for (const verbose of [false, true]) {
        /** @type {string[][]} */
        const calls = [];
        let stdout = '';
        const env = root === null ? {} : { WORKSTATION_MANAGED_ROOT: root };
        const [code, lines] = adminApply(verbose, env, { out: (t) => { stdout += t; }, err: () => {}, tty: false }, (exe, args) => {
          calls.push([exe, ...args]);
          return calls.length === 1 ? RENDERS[name] : [0, ['APPLIED fine', 'THEN    after']];
        });
        result[name + ' ' + label + ' ' + (verbose ? 'verbose' : 'quiet')] = { calls, code, lines, stdout };
      }
    }
  }
  const [exe, args] = asRoot([NODE, ...ADMIN, '--remove'], {});
  result['as_root remove sudo'] = [exe, ...args];
  const [exe2, args2] = asRoot([NODE, ...ADMIN, '--remove'], { WORKSTATION_MANAGED_ROOT: '/tmp/throwaway root' });
  result['as_root remove managed-root'] = [exe2, ...args2];
  return JSON.parse(JSON.stringify(result, null, 2).replaceAll(JSON.stringify(MHW_JS).slice(1, -1), '<MHW_JS>')
    .replaceAll(JSON.stringify(NODE).slice(1, -1), '<NODE>'));
}

/** Object keys in sorted order at every depth, as the recorder's json.dumps(sort_keys=True). @param {unknown} v @returns {unknown} */
const canonical = (v) => {
  if (Array.isArray(v)) return v.map(canonical);
  if (v && typeof v === 'object') {
    return Object.fromEntries(Object.keys(v).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)).map((k) => [k, canonical(/** @type {Record<string, unknown>} */ (v)[k])]));
  }
  return v;
};
/** The expected differences (case '*', stream 'admin-line render') applied to one side. @param {unknown} doc @param {'base' | 'head'} side */
const allowed = (doc, side) => allow(expected, 'admin-line', 'admin-line render', JSON.stringify(canonical(doc), null, 1), side);

test('golden: the admin-layer root command line is the one workstation.py ran, quoting included', { skip: process.platform === 'win32' && 'the admin layer and its sudo line are macOS and Linux only' }, () => {
  const golden = readGolden(SLICE, 'admin-lines.json');
  assert.equal(allowed(head(), 'head'), allowed(golden, 'base'));
  // The line the owner meets, spelled out: one sudo that asks for the password itself, never -n or -v.
  const owner = /** @type {Record<string, { calls: string[][] }>} */ (golden)['rendered sudo quiet'].calls[1];
  assert.deepEqual(owner, [SUDO, '-k', '-p', 'Password for %u: ', '/bin/sh', HERE, '--apply=' + STAGE, '--sha256=' + SHA]);
  // Since #496 (S26) the admin layer is `mhw install-admin`, on the node running mhw: the same one sudo call.
  const now = /** @type {Record<string, { calls: string[][] }>} */ (head())['rendered sudo quiet'].calls[1];
  assert.deepEqual(now, [SUDO, '-k', '-p', 'Password for %u: ', '<NODE>', '<MHW_JS>', 'install-admin', '--apply=' + STAGE, '--sha256=' + SHA]);
});

test('live: the base revision\'s workstation.py records the same admin-layer line', (t) => {
  const py = process.platform === 'win32' ? null : which('python3');
  const version = py ? spawnSync(py, ['-c', 'import platform; print(platform.python_version())'], { encoding: 'utf8' }).stdout.trim() : '';
  const holds = (!py && 'needs python3 (POSIX)') || (version !== RECORDED.cpython && 'needs CPython ' + RECORDED.cpython + ' (found ' + (version || 'none') + ')') || '';
  const base = holds || baseTree({ root: ROOT, dir: h.dir, holds: path.join('global', 'workstation.py') });
  if (!path.isAbsolute(base)) {
    if (process.env.MHW_S24_LIVE_REQUIRED === '1' && !base.includes('has merged')) assert.fail('the live arm is required here: ' + base);
    t.skip(base);
    return;
  }
  const p = spawnSync(/** @type {string} */ (py), ['-I', '-B', path.join(ROOT, 'test', 'helpers', 's24-admin-line.py'), base], { encoding: 'utf8', env: { PATH: '/usr/bin:/bin' } });
  assert.equal(p.status, 0, p.stderr);
  const was = JSON.parse(p.stdout);
  if (UPDATE) writeGolden(SLICE, 'admin-lines.json', was);
  assert.equal(allowed(head(), 'head'), allowed(was, 'base'));
  assert.ok(fs.existsSync(path.join(base, 'global', 'workstation.py')));
});
