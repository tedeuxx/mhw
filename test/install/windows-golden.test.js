// S27 parity (#497, convention 3 of #470): the Windows user-layer installer, global/install.ps1 until this
// slice and `mhw install-windows` (src/commands/install-windows.js) since, on throwaway profile directories.
//   golden: transcripts/<scenario>.json holds, per run of each scenario in windows-cases.js, the exit code,
//           stdout, stderr and the profile's tree (path, kind, and each file's text, or its sha256 past
//           2 KiB), recorded from the base revision's install.ps1 under PowerShell 7 on a Windows runner.
//           The head's runs must match it on every OS once the declared differences are applied to it.
//   live:   on Windows, while the base revision still holds install.ps1, both run the same scenarios, under
//           each PowerShell in MHW_S27_POWERSHELL (absolute paths, ';'-separated; default pwsh 7 and Windows
//           PowerShell 5.1 where installed). MHW_S27_LIVE_REQUIRED=1 turns a skip into a failure.
//           MHW_S27_PRINT_GOLDEN=1 prints each PowerShell 7 transcript as one 'S27-GOLDEN <name> <json>' line,
//           the way the goldens were taken from the runner's log (nothing on a Windows runner can commit them).
// Both sides run a tree assembled from this checkout's src/, bin/ and package.json and the frozen
// inputs of test/golden/S27/inputs (the global brief, the floor, the retired allows, the overlays, a method and
// .bumpversion.toml), so a later change to those sources does not move the goldens; the base side adds the
// base revision's global/install.ps1, which runs this tree's renderers exactly as it ran its own.
// Normalised: CRLF to LF and every backslash to a slash in stdout and stderr (PowerShell writes CRLF; the
// paths are Windows paths on one side), the scenario directory (<T>), the node (<NODE>), and each JSON file's
// formatting (install.ps1 wrote ConvertTo-Json's, which differs between PowerShell 5.1 and 7; the head writes
// two-space JSON): a JSON file is compared as its parsed value, key order kept. Directories PowerShell
// itself creates under the profile (AppData/Local/Microsoft/...) are left out.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { readGolden, goldenPath } from '../helpers/golden.js';
import { baseRevision } from '../helpers/install-golden.js';
import { which } from '../helpers/home.js';
import { SCENARIOS } from './windows-cases.js';
import { ROOT, SLICE, WIN, expected, declared, runScenario, cleanupAll } from '../helpers/s27-windows.js';

after(cleanupAll);

test('every scenario has a golden transcript, and every transcript a scenario', () => {
  const files = fs.readdirSync(goldenPath(SLICE, 'transcripts')).sort((a, b) => (a < b ? -1 : Number(a > b)));
  assert.deepEqual(files, SCENARIOS.map((s) => s.name + '.json').sort((a, b) => (a < b ? -1 : Number(a > b))));
});

test('every declared difference is named and says why', () => {
  for (const e of expected) {
    assert.ok(e.name && e.why && e.why.length > 40, JSON.stringify(e).slice(0, 80));
    if (e.pattern) {
      assert.doesNotThrow(() => new RegExp(e.pattern));
      assert.equal(typeof e.replace, 'string', e.name);
    }
  }
});

test('every declared pattern changes at least one golden line (none is stale)', () => {
  for (const e of expected.filter((/** @type {any} */ x) => x.pattern)) {
    const hit = SCENARIOS.some((s) => {
      if (e.case && e.case !== s.name) return false;
      return readGolden(SLICE, 'transcripts/' + s.name + '.json').runs.some((/** @type {any} */ r) => new RegExp(e.pattern, 'm').test(r[e.stream]));
    });
    assert.ok(hit, 'the declared difference matches no golden line: ' + e.name);
  }
});

for (const sc of SCENARIOS) {
  test('golden: ' + sc.name + ': mhw install-windows matches install.ps1, declared differences applied', () => {
    const head = runScenario(sc, null, null);
    assert.deepEqual(head, declared(readGolden(SLICE, 'transcripts/' + sc.name + '.json')));
  });
}

/** The PowerShells the live arm runs install.ps1 under. */
function powershells() {
  if (process.env.MHW_S27_POWERSHELL) return process.env.MHW_S27_POWERSHELL.split(';').filter((p) => path.isAbsolute(p));
  return [which('pwsh'), path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')]
    .filter((p) => p && fs.existsSync(p)).map(String);
}

test('live: install.ps1 at the base revision against mhw install-windows, on every scenario', (t) => {
  const required = process.env.MHW_S27_LIVE_REQUIRED === '1';
  const skip = (/** @type {string} */ why) => {
    if (required) assert.fail('MHW_S27_LIVE_REQUIRED=1, but: ' + why);
    t.skip(why);
  };
  if (!WIN) return skip('install.ps1 runs on Windows only');
  const base = baseRevision(ROOT);
  if (!base) return skip('no base revision (MHW_PARITY_BASE unset and no merge-base with origin/rc/next)');
  const git = which('git');
  const shown = git ? spawnSync(git, ['-C', ROOT, 'show', base + ':global/install.ps1']) : null;
  if (!shown || shown.status !== 0) return skip('the base revision holds no global/install.ps1');
  const pss = powershells();
  if (!pss.length) return skip('no PowerShell found');
  /** @type {string[]} */
  const failed = [];
  for (const ps of pss) {
    for (const sc of SCENARIOS) {
      const original = runScenario(sc, ps, shown.stdout);
      if (process.env.MHW_S27_PRINT_GOLDEN === '1' && /pwsh/i.test(path.basename(ps))) {
        process.stdout.write('S27-GOLDEN ' + sc.name + ' ' + JSON.stringify(original) + '\n');
      }
      try {
        assert.deepEqual(runScenario(sc, null, null), declared(original));
      } catch (e) {
        failed.push(ps + ': ' + sc.name + ': ' + (e instanceof Error ? e.message : String(e)).slice(0, 4000));
      }
    }
  }
  assert.deepEqual(failed, []);
});
