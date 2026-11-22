// No live document tells the owner to run an installer script that is not in the tree (#503, QA B1 on PR
// #546): the breaking-glass runbook still ran `sh global/install.sh` after this slice deleted it. Every
// tracked text under docs/ (the decision records, the archive and the grooming records excepted: they
// record history), method/, workspace/, overlay/, README.md and AGENTS.md is read; a line that runs
// global/<file>.sh or .ps1 through a shell (sh, bash, zsh, pwsh, powershell, /bin/sh, or ./ and .\) must
// name a file that exists. Every `mhw install-user ...` or `./mhw install-user ...` command written there
// must be one the installer accepts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { which } from '../helpers/home.js';
import { parseArgs } from '../../src/commands/install-user.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
/** Exempt by name: the owner's personal overlay; its dead entries are his to remove (PR #546 QA). */
const EXEMPT = new Map([['overlay/allow-list.conf', "the owner's own allow list: its entry for the deleted global/install.test.sh is an owner residual, never edited by an agent"]]);
const SKIP_DIRS = ['docs/adr/', 'docs/archive/', 'docs/backlog-grooming/'];

/** The installer scripts a line runs: [path, ...]. Backslashes read as slashes. @param {string} line */
export function runs(line) {
  const l = line.replaceAll('\\', '/');
  const re = /(?:(?:^|[\s`'"(])(?:\/bin\/)?(?:sh|bash|zsh|pwsh|powershell)(?:\s+-\S+)*\s+["'`]?(?:\$\{?[A-Za-z_]+\}?\/|<[a-z-]+>\/)?|(?:^|[\s`'"(])\.\/)(global\/[A-Za-z0-9_./-]+\.(?:sh|ps1))/g;
  return [...l.matchAll(re)].map((m) => m[1]);
}

/** Tracked files in scope. */
function files() {
  const git = which('git');
  assert.ok(git, 'needs git');
  const p = spawnSync(git, ['-C', ROOT, 'ls-files', '-z', '--', 'docs', 'method', 'workspace', 'overlay', 'README.md', 'AGENTS.md'], { encoding: 'utf8' });
  assert.equal(p.status, 0, p.stderr);
  return p.stdout.split('\0').filter((f) => f && !SKIP_DIRS.some((d) => f.startsWith(d)) && /\.(md|conf|json|txt|ya?ml)$|^[^.]+$/.test(f));
}

test('the detector finds a run of an installer script, present or not (calibration)', () => {
  assert.deepEqual(runs('3. `sh global/install-managed.sh --check` and `./mhw install-user --check` both exit 0.'), ['global/install-managed.sh']);
  assert.deepEqual(runs('Keep `sh global/install.sh --hooks=managed`'), ['global/install.sh']);
  assert.deepEqual(runs('sudo /bin/sh "<checkout>/global/install-managed.sh" --remove'), ['global/install-managed.sh']);
  assert.deepEqual(runs('wide runner sh global/install.test.sh'), ['global/install.test.sh']);
  assert.deepEqual(runs('.\\global\\install.ps1 -Overlay none -DryRun'), ['global/install.ps1']);
  assert.deepEqual(runs('it was `global/install.sh` until #503'), [], 'a mention that runs nothing is history, not an instruction');
  // The known hit at the base revision: the runbook line this test was written for.
  const base = 'user-level copy stays when `install.sh` installed it; check with `sh global/install.sh --check';
  assert.ok(runs(base).length === 1 && !fs.existsSync(path.join(ROOT, runs(base)[0])), 'the known hit is not flagged');
});

test('no live document runs an installer script that is not in the tree', () => {
  /** @type {string[]} */
  const dead = [];
  let seen = 0;
  for (const f of files()) {
    if (EXEMPT.has(f)) continue;
    const text = fs.readFileSync(path.join(ROOT, f), 'utf8');
    text.split(/\r?\n/).forEach((line, i) => {
      for (const p of runs(line)) {
        seen++;
        if (!fs.existsSync(path.join(ROOT, p))) dead.push(f + ':' + (i + 1) + ' runs ' + p);
      }
    });
  }
  assert.deepEqual(dead, []);
  assert.ok(seen > 0, 'the detector read no run at all: the scope or the pattern is dead');
  for (const [f, why] of EXEMPT) assert.ok(fs.existsSync(path.join(ROOT, f)) && why.length > 40, f);
});

test('every mhw install-user command in a live document is one the installer accepts', () => {
  /** @type {string[]} */
  const bad = [];
  let seen = 0;
  for (const f of files()) {
    const text = fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\n\s*/g, ' ');
    for (const m of text.matchAll(/(?:\.\/)?mhw install-user((?: --[a-z-]+(?:=(?:"[^"]*"|[^\s`'")]*))?)*)/g)) {
      seen++;
      const args = m[1].trim().split(/ +/).filter(Boolean).map((a) => a.replaceAll('"', ''));
      const r = parseArgs(args.map((a) => a.replace('$HOME', '/h')), {}, '/repo');
      if (Array.isArray(r) && r[0] !== 0) bad.push(f + ': ' + m[0] + ' -> ' + r[1]);
    }
  }
  assert.deepEqual(bad, []);
  assert.ok(seen > 0, 'no install-user command was read');
});

// #497 (PR #547 lens F1): a live instruction may not name a deleted installer file or one of the deleted
// install.ps1's PowerShell parameters (-Overlay, -Method, -DryRun, -Check; mhw's are --overlay=, --method,
// --dry-run, --check). A struck span (~~...~~) is history and is not read; a line that names the old route
// as history says so in one of these words: until, was, were, deleted, retired, removed, replaced, formerly.
const HISTORY = /\b(until|was|were|deleted|retired|removed|replaced|formerly)\b/i;
const PS_PARAM = /(?:^|[\s`'"(])(-(?:Overlay|Method|DryRun|Check))\b/g;
const INSTALLER = /global[\\/][A-Za-z0-9_.-]+\.(?:sh|ps1)\b/g;
/** Exempt by name from the stale-name check only. */
const STALE_EXEMPT = new Map([['docs/mhw-product-requirements-document-node-runtime.md',
  "the Node runtime migration's requirements: its 'Current state' lists the installers the migration deletes, as they were when it was agreed"]]);

/** The stale names a line carries: a missing installer path, or a PowerShell parameter. @param {string} line */
export function staleNames(line) {
  const live = line.replace(/~~[^~]*~~/g, '');
  if (HISTORY.test(live)) return [];
  const paths = [...live.matchAll(INSTALLER)].map((m) => m[0].replaceAll('\\', '/')).filter((p) => !fs.existsSync(path.join(ROOT, p)));
  return [...paths, ...[...live.matchAll(PS_PARAM)].map((m) => m[1])];
}

test('the stale-name detector finds a deleted installer or a PowerShell parameter, and skips history (calibration)', () => {
  assert.deepEqual(staleNames('Windows: `.\\global\\install.ps1 -Overlay none`'), ['global/install.ps1', '-Overlay']);
  assert.deepEqual(staleNames('`--overlay=PATH` or `-Overlay PATH`'), ['-Overlay']);
  assert.deepEqual(staleNames('tested by `global/install.test.ps1` on Windows'), ['global/install.test.ps1']);
  assert.deepEqual(staleNames('~~`global/install.ps1 -Method`~~ `mhw install-windows --method`'), []);
  assert.deepEqual(staleNames('`install.ps1` until #497 ran `global/install.ps1 -Check`'), []);
  assert.deepEqual(staleNames('`mhw install --overlay=none --method`'), []);
});

test('no live document names a deleted installer file or a PowerShell parameter of install.ps1', () => {
  const git = which('git');
  assert.ok(git, 'needs git');
  const extra = spawnSync(git, ['-C', ROOT, 'ls-files', '-z', '--', 'global/profile/README.md'], { encoding: 'utf8' }).stdout.split('\0').filter(Boolean);
  /** @type {string[]} */
  const stale = [];
  for (const f of [...files(), ...extra]) {
    if (EXEMPT.has(f) || STALE_EXEMPT.has(f)) continue;
    // A struck span may run across lines: it is blanked first, its line breaks kept, so numbers still hold.
    const text = fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/~~[^~]*~~/g, (m) => m.replace(/[^\n]/g, ''));
    text.split(/\r?\n/).forEach((line, i) => {
      for (const s of staleNames(line)) stale.push(f + ':' + (i + 1) + ' names ' + s);
    });
  }
  assert.deepEqual(stale, []);
  for (const [f, why] of STALE_EXEMPT) assert.ok(fs.existsSync(path.join(ROOT, f)) && why.length > 40, f);
});
