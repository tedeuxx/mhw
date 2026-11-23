// S24 (#495): the one root command line the owner's `mhw install` runs for the admin layer, held on a golden
// recorded from the deleted global/workstation.py (the Issue's main risk: any drift in its quoting is an
// owner act going wrong). Nothing here runs sudo, an installer or any process: adminApply() and asRoot()
// take a recording runner, and the scenarios feed them a synthetic render of the admin-layer installer
// (mhw install-admin since #496; global/install-managed.sh before).
//   golden: src/lib/lifecycle.js against test/golden/S24/admin-lines.json, on every OS.
//   The golden is frozen: the live arm and its recorder (test/helpers/s24-admin-line.py) were deleted by
//           #502 (S32 of #470, one Node runtime).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readGolden } from '../helpers/golden.js';
import { allow } from '../helpers/mcp-golden.js';
import { adminApply, asRoot, ADMIN, MHW_JS, NODE, SUDO } from '../../src/lib/lifecycle.js';

const SLICE = 'S24';
const expected = readGolden(SLICE, 'expected-differences.json');

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
