// runtime-guard (#502, S32 of #470, ADR-0045): the one-runtime check, .github/scripts/runtime-guard.js.
//   tree:        this repository passes, and every allowance entry names a tracked file or workflow line
//                the check flags (a stale exemption is red).
//   calibration: in throwaway git repositories, a planted file of each kind (*.py, *.sh, *.ps1, each
//                interpreter's #! line, direct and through env) and a workflow line of each kind (python,
//                pip, pwsh, bump-my-version, setup-python) turns the check red, alone; the clean control
//                beside them stays green.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ROOT, ALLOWANCE, check, readAllowance, tracked, shebangInterpreter, lineFinding, fileFinding } from '../../.github/scripts/runtime-guard.js';
import { which } from '../helpers/home.js';

const SCRIPT = path.join(ROOT, '.github', 'scripts', 'runtime-guard.js');
const GIT = which('git');
const work = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'mhw-s32-guard-')));
after(() => fs.rmSync(work, { recursive: true, force: true }));
const EMPTY = JSON.stringify({ files: [], workflow_lines: [] });

/** A throwaway repository holding files (path -> text), every one added to the index. @param {Record<string, string>} files */
function repo(files) {
  const dir = fs.mkdtempSync(path.join(work, 'r-'));
  assert.equal(spawnSync(/** @type {string} */ (GIT), ['init', '-q', dir]).status, 0);
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), text);
  }
  assert.equal(spawnSync(/** @type {string} */ (GIT), ['-C', dir, 'add', '-A'], { encoding: 'utf8' }).status, 0);
  return dir;
}

/** The guard run as CI runs it. @param {string} root @param {string} [allowance] */
function guard(root, allowance = EMPTY) {
  const file = path.join(root, ALLOWANCE);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, allowance);
  const p = spawnSync(process.execPath, [SCRIPT, '--root=' + root], { encoding: 'utf8' });
  return { code: p.status, out: p.stdout + p.stderr };
}

const CLEAN = {
  'bin/tool.js': '#!/usr/bin/env node\nconsole.log(1);\n',
  'README.md': '# not a script\n',
  'notes.txt': 'python is mentioned in prose, not run\n',
  '.github/workflows/ok.yml': [
    'jobs:', '  a:', '    runs-on: windows-latest', '    steps:',
    '      # python3 in a comment is not a step', '      - name: a step on the runner\'s own shell', '        shell: pwsh',
    '        run: node --version', '      - run: echo install.ps1 is a path, not a word',
    '        env:', '          IMAGE: python@sha256:0123', '',
  ].join('\n'),
};

test('this repository passes, and the run names its allowed exceptions', { skip: !GIT && 'needs git' }, () => {
  const p = spawnSync(process.execPath, [SCRIPT], { encoding: 'utf8' });
  assert.equal(p.status, 0, p.stdout + p.stderr);
  assert.match(p.stdout, /^OK {6}runtime-guard: \d+ tracked files, 0 findings, 0 stale allowance entries, \d+ allowed$/m);
});

test('every allowance entry names a tracked file, or a workflow line, that the check flags', { skip: !GIT && 'needs git' }, () => {
  const allowance = readAllowance(path.join(ROOT, ALLOWANCE));
  const files = /** @type {string[]} */ (tracked(ROOT));
  for (const e of allowance.files) {
    assert.ok(fs.existsSync(path.join(ROOT, e.path)), 'the listed path does not exist: ' + e.path);
    assert.ok(files.includes(e.path), 'not tracked: ' + e.path);
    assert.ok(fileFinding(e.path, ROOT), 'the check does not flag ' + e.path);
    assert.ok(e.reason.length > 40, 'a reason: ' + e.path);
  }
  for (const e of allowance.workflow_lines) {
    assert.ok(fs.existsSync(path.join(ROOT, e.path)), 'the listed workflow does not exist: ' + e.path);
    const lines = fs.readFileSync(path.join(ROOT, e.path), 'utf8').split(/\r?\n/).map((l) => l.trim());
    assert.ok(lines.includes(e.line.trim()), 'the line is not in ' + e.path + ': ' + e.line);
    assert.ok(lineFinding(e.line), 'the check does not flag ' + e.line);
  }
  assert.deepEqual(check(ROOT, allowance, files).stale, []);
});

test('a stale allowance entry is red: a missing path, an unflagged path, a line that is gone', { skip: !GIT && 'needs git' }, () => {
  const dir = repo(CLEAN);
  assert.equal(guard(dir).code, 0);
  for (const allowance of [
    { files: [{ path: 'gone.py', reason: 'r' }], workflow_lines: [] },
    { files: [{ path: 'README.md', reason: 'r' }], workflow_lines: [] },
    { files: [], workflow_lines: [{ path: '.github/workflows/ok.yml', line: 'run: python3 x.py', reason: 'r' }] },
    { files: [], workflow_lines: [{ path: '.github/workflows/ok.yml', line: 'run: node --version', reason: 'r' }] },
  ]) {
    const r = guard(dir, JSON.stringify(allowance));
    assert.equal(r.code, 1, JSON.stringify(allowance) + '\n' + r.out);
    assert.match(r.out, /^STALE /m);
  }
  assert.equal(guard(dir, '{"files": "x"}').code, 2, 'an allowance of the wrong shape cannot be read');
});

const PLANTED = /** @type {Array<[string, Record<string, string>]>} */ ([
  ['a .py file', { 'tools/x.py': 'print(1)\n' }],
  ['a .sh file', { 'x.sh': 'echo 1\n' }],
  ['a .ps1 file', { 'win/X.PS1': 'Write-Output 1\n' }],
  ['a .psm1 file', { 'win/m.psm1': '\n' }],
  ['a .bash file', { 'x.bash': 'echo\n' }],
  ['an extensionless sh script', { mhw: '#!/bin/sh\nexec node bin/mhw.js "$@"\n' }],
  ['an extensionless bash script through env', { 'global/security.test.stub': '#!/usr/bin/env bash\necho\n' }],
  ['a python script through env -S', { 'bin/run': '#!/usr/bin/env -S python3 -I\nprint(1)\n' }],
  ['a versioned python', { 'bin/p': '#! /usr/local/bin/python3.14\n' }],
  ['a pwsh script', { 'bin/w': '#!/usr/bin/pwsh\n' }],
  ['a script with a byte-order mark and CRLF', { 'bin/b': '\uFEFF#!/bin/dash\r\necho\r\n' }],
  ['a workflow step running python', { '.github/workflows/p.yml': 'jobs:\n  a:\n    steps:\n      - run: python3 -B x\n' }],
  ['a workflow step running pip', { '.github/workflows/p.yml': 'jobs:\n  a:\n    steps:\n      - run: |\n          pip install x\n' }],
  ['a workflow step running pwsh', { '.github/workflows/p.yaml': 'jobs:\n  a:\n    steps:\n      - run: pwsh -c "Get-Date"\n' }],
  ['a workflow step running bump-my-version', { '.github/workflows/v.yml': 'jobs:\n  a:\n    steps:\n      - run: bump-my-version bump patch\n' }],
  ['a workflow using setup-python', { '.github/workflows/s.yml': 'jobs:\n  a:\n    steps:\n      - uses: actions/setup-python@0123456789abcdef\n' }],
]);

for (const [name, files] of PLANTED) {
  test('calibration: ' + name + ' turns the check red', { skip: !GIT && 'needs git' }, () => {
    const r = guard(repo({ ...CLEAN, ...files }));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /^FAIL {4}\S/m);
    assert.match(r.out, /1 findings/);
  });
}

test('calibration: the clean control and an allowed file are green, and an untracked script is not the tree', { skip: !GIT && 'needs git' }, () => {
  const dir = repo({ ...CLEAN, 'fixture/app.py': 'x = 1\n' });
  fs.writeFileSync(path.join(dir, 'untracked.sh'), 'echo\n');
  const r = guard(dir, JSON.stringify({ files: [{ path: 'fixture/app.py', reason: 'a fixture' }], workflow_lines: [] }));
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /^ALLOWED fixture\/app\.py/m);
});

test('no golden carries a recording machine\'s interpreter path (S05 carry-along, PR #510)', { skip: !GIT && 'needs git' }, () => {
  // A Homebrew, framework, pyenv or /usr/local Python install path is where the recording ran, not what the
  // code answered. /usr/bin/python3 in a golden is fixture data (old hook command lines), so it is not one.
  const RECORDING_PATH = /\/opt\/homebrew|\/Cellar\/|Python\.framework|\.pyenv\/|\/usr\/local\/(?:bin|opt)\/python/;
  const hits = /** @type {string[]} */ (tracked(ROOT)).filter((f) => f.startsWith('test/golden/'))
    .filter((f) => RECORDING_PATH.test(fs.readFileSync(path.join(ROOT, f), 'latin1')));
  assert.deepEqual(hits, []);
});

test('the #! reading: interpreters directly and through env, and what is not one', () => {
  const cases = /** @type {Array<[string, string]>} */ ([
    ['#!/bin/sh', 'sh'], ['#!/bin/bash -eu', 'bash'], ['#!/usr/bin/env python3', 'python3'], ['#!/usr/bin/env -S python3 -I -B', 'python3'],
    ['#!/usr/bin/env -i PATH=/x python', 'python'], ['#!/usr/bin/env -u FOO zsh', 'zsh'], ['#!/opt/pwsh/pwsh', 'pwsh'], ['#!C:\\x\\powershell.exe', 'powershell.exe'],
    ['#!/usr/bin/env node', ''], ['#!/usr/bin/node', ''], ['# not a shebang', ''], ['', ''], ['#!/usr/bin/env', ''], ['#!/bin/shellcheck', ''],
  ]);
  for (const [line, want] of cases) assert.equal(shebangInterpreter(line), want, line);
});

test('the workflow line reading: words, not substrings, and the runner\'s shell key', () => {
  for (const l of ['run: python3 x', '  run: python x', 'run: sudo pip3 install x', 'run: x && pwsh -c y', 'run: "bump-my-version" bump', 'X=python3.14 y', '- uses: actions/setup-python@v6']) {
    assert.ok(lineFinding(l), l);
  }
  for (const l of ['  shell: pwsh', '  shell: bash', '# python3', '   # pip install', 'container-image: python@sha256:0', 'run: echo install.ps1', 'run: pythonic', 'run: node pip.js', '']) {
    assert.equal(lineFinding(l), '', l);
  }
});
