// Runs one delivery parity case (#474) three ways, all against the synthetic git and gh of
// delivery-fake.js, and returns what a user and the forge could observe: the exit code, stdout, stderr
// and every git and gh call in order.
//   inProcess: the Node route with the fake as its tool runner (every OS);
//   command:   bin/mhw.js delivery (or ./mhw delivery) with the fake gh and git first on PATH (POSIX);
//   python:    a delivery.py with the same fake on PATH; used to record the golden transcripts.
// Each runs in a throwaway checkout-shaped directory: an empty .git, the fixture tests.yml and a
// .bumpversion.toml at 1.1.0. Line endings are normalised, as the parity harness does.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { answer, writeFakeBin } from './delivery-fake.js';
import { delivery } from '../../src/commands/delivery.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const FIXTURE_TESTS_YML = path.join(ROOT, 'test', 'golden', 'S03', 'tests.yml');

/**
 * @typedef {import('./delivery-cases.js').Case} Case
 * @typedef {{ code: number | null, stdout: string, stderr: string, calls: string[][] }} Run
 */

/** A throwaway checkout-shaped directory; returns it and its cleanup. */
export function tree() {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mhw-test-delivery-')));
  const root = path.join(dir, 'tree');
  fs.mkdirSync(path.join(root, '.git'), { recursive: true });
  fs.mkdirSync(path.join(root, '.github', 'workflows'), { recursive: true });
  fs.copyFileSync(FIXTURE_TESTS_YML, path.join(root, '.github', 'workflows', 'tests.yml'));
  fs.writeFileSync(path.join(root, '.bumpversion.toml'), '[tool.bumpversion]\ncurrent_version = "1.1.0"\n');
  return { dir, root, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

/** @param {string} s */
const lf = (s) => s.replace(/\r\n/g, '\n');

/** @param {Case} c @returns {Run} */
export function inProcess(c) {
  const t = tree();
  try {
    /** @type {string[][]} */
    const calls = [];
    const r = delivery(c.args, {
      cwd: t.root,
      exec: (tool, args) => {
        calls.push([tool, ...args]);
        return answer(c.scenario, tool, args);
      },
    });
    return { code: r.code, stdout: r.stdout, stderr: r.stderr, calls };
  } finally {
    t.cleanup();
  }
}

/**
 * @param {Case} c
 * @param {string} exe an absolute interpreter
 * @param {(root: string) => string[]} argvFor the interpreter's arguments before the case's
 * @param {(root: string) => void} [prepare]
 * @returns {Run}
 */
export function viaPath(c, exe, argvFor, prepare) {
  const t = tree();
  try {
    if (prepare) prepare(t.root);
    const bin = writeFakeBin(path.join(t.dir, 'bin'));
    const scenario = path.join(t.dir, 'scenario.json');
    const log = path.join(t.dir, 'calls.log');
    fs.writeFileSync(scenario, JSON.stringify(c.scenario));
    fs.writeFileSync(log, '');
    const env = { PATH: bin + path.delimiter + (process.env.PATH || ''), HOME: t.dir, LANG: 'C.UTF-8', MHW_FAKE_SCENARIO: scenario, MHW_FAKE_LOG: log };
    const p = spawnSync(exe, [...argvFor(t.root), ...c.args], { cwd: t.root, env, encoding: 'utf8', timeout: 60000 });
    const calls = fs.readFileSync(log, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
    return { code: p.status, stdout: lf(p.stdout || ''), stderr: lf(p.stderr || ''), calls };
  } finally {
    t.cleanup();
  }
}

/** bin/mhw.js delivery, through the CLI entry. @param {Case} c */
export const command = (c) => viaPath(c, process.execPath, () => [path.join(ROOT, 'bin', 'mhw.js'), 'delivery']);

/**
 * delivery.py from tree src (a base revision), copied into the throwaway checkout so its ROOT is there.
 * @param {Case} c @param {string} python @param {string} src
 */
export const python = (c, python, src) => viaPath(c, python, (root) => ['-B', path.join(root, 'workspace', 'delivery.py')], (root) => {
  fs.mkdirSync(path.join(root, 'workspace'), { recursive: true });
  fs.copyFileSync(path.join(src, 'workspace', 'delivery.py'), path.join(root, 'workspace', 'delivery.py'));
});
