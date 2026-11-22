// runtime-guard (#502, S32 of #470, ADR-0045): mhw runs one runtime, Node. This check fails while the
// tracked tree holds a program for another one, or a workflow runs one:
//   1. any tracked file named *.py, *.sh, *.bash, *.zsh, *.ps1, *.psm1 or *.psd1 (case-insensitive);
//   2. any tracked regular file whose first line is a #! naming sh, bash, dash, zsh, ksh, python (any
//      version), pwsh or powershell, directly or through env (the extension glob alone fails open on an
//      extensionless script, such as ./mhw and global/security.test.stub once were);
//   3. any line of .github/workflows/*.yml or *.yaml that uses actions/setup-python, or names python, pip,
//      pwsh, powershell or bump-my-version as a word (comment lines are skipped).
// The bound of 3, stated in ADR-0045: a `run:` block still runs in the runner's own shell (bash on Linux and
// macOS, pwsh by default on Windows), so a `shell:` key that selects that shell is not an invocation and is
// not flagged. What a step's shell runs is checked; which shell the runner provides is not.
// The exceptions are an explicit list, .github/runtime-guard-allowance.json, each with its reason. An entry
// that no longer names a tracked file, a workflow line that is no longer there, or an entry the check would
// not flag anyway is stale, and stale is red: an exemption with nothing to exempt hides the next one.
// Usage: node .github/scripts/runtime-guard.js [--root=DIR] [--allowance=FILE]. Exit 0 clean, 1 findings,
// 2 the tree or the allowance cannot be read. node: modules only; git is found on PATH by absolute entry.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { onPath } from '../../src/lib/onpath.js';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const ALLOWANCE = path.join('.github', 'runtime-guard-allowance.json');
export const EXTENSIONS = Object.freeze(['.py', '.sh', '.bash', '.zsh', '.ps1', '.psm1', '.psd1']);
const INTERPRETER = /^(?:sh|bash|dash|zsh|ksh|python(?:\d+(?:\.\d+)*)?|pwsh|powershell(?:\.exe)?)$/i;
// A command word in a workflow line: one of the names, between a start or a shell separator and an end or
// a separator. `python@sha256:...` (a container image name) and `install.ps1` (a path) are not words here.
const WORD = /(?:^|[\s;&|(`'"=])(python(?:\d+(?:\.\d+)*)?|pip\d*(?:\.\d+)*|pwsh|powershell(?:\.exe)?|bump-my-version)(?=$|[\s;&|)`'"])/i;
const SETUP_PYTHON = /\buses:\s*['"]?actions\/setup-python@/i;
const SHELL_KEY = /^\s*shell:\s*\S+\s*$/;

/** @typedef {{ path: string, reason: string }} FileEntry */
/** @typedef {{ path: string, line: string, reason: string }} LineEntry */
/** @typedef {{ files: FileEntry[], workflow_lines: LineEntry[] }} Allowance */

/**
 * The interpreter a first line names, or ''.
 * @param {string} first
 */
export function shebangInterpreter(first) {
  const m = /^#!\s*(\S+)(.*)$/.exec(first.replace(/^﻿/, ''));
  if (!m) return '';
  const prog = m[1].split(/[\\/]/).pop() || '';
  if (prog !== 'env') return INTERPRETER.test(prog) ? prog : '';
  // env [-S] [-i] [-u NAME] [NAME=VALUE]... PROGRAM: the first word that is none of those.
  const words = m[2].trim().split(/\s+/).filter(Boolean);
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (w === '-u' || w === '--unset') {
      i++;
      continue;
    }
    if (w.startsWith('-') || w.includes('=')) continue;
    const name = w.split(/[\\/]/).pop() || '';
    return INTERPRETER.test(name) ? name : '';
  }
  return '';
}

/**
 * Why a tracked file is another runtime's program, or ''.
 * @param {string} rel the path git lists (forward slashes)
 * @param {string} root
 */
export function fileFinding(rel, root) {
  const ext = path.posix.extname(rel).toLowerCase();
  if (EXTENSIONS.includes(ext)) return 'a tracked ' + ext + ' file';
  let st;
  try {
    st = fs.lstatSync(path.join(root, rel));
  } catch {
    return '';
  }
  if (!st.isFile()) return '';
  const fd = fs.openSync(path.join(root, rel), 'r');
  const buf = Buffer.alloc(256);
  let n;
  try {
    n = fs.readSync(fd, buf, 0, buf.length, 0);
  } finally {
    fs.closeSync(fd);
  }
  const first = buf.subarray(0, n).toString('utf8').split(/\r?\n/)[0];
  const interp = shebangInterpreter(first);
  return interp ? 'a #! line naming ' + interp : '';
}

/**
 * Why one workflow line runs another runtime, or ''.
 * @param {string} line
 */
export function lineFinding(line) {
  const t = line.trim();
  if (!t || t.startsWith('#') || SHELL_KEY.test(line)) return '';
  if (SETUP_PYTHON.test(line)) return 'uses actions/setup-python';
  const m = WORD.exec(line);
  return m ? 'names ' + m[1] : '';
}

/** The tracked files of root, or null when git cannot list them. @param {string} root */
export function tracked(root) {
  const git = onPath('git', process.env);
  if (!git) return null;
  const p = spawnSync(git, ['-C', root, 'ls-files', '-z'], { encoding: 'utf8', maxBuffer: 64 << 20 });
  if (p.status !== 0) return null;
  return p.stdout.split('\0').filter(Boolean).sort((a, b) => (a < b ? -1 : Number(a > b)));
}

/**
 * The allowance, checked for shape. Throws on a file that is not the declared shape.
 * @param {string} file
 * @returns {Allowance}
 */
export function readAllowance(file) {
  const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
  const ok = (/** @type {any} */ e, /** @type {string[]} */ keys) => e && typeof e === 'object' && keys.every((k) => typeof e[k] === 'string' && e[k].trim());
  if (!Array.isArray(doc.files) || !doc.files.every((/** @type {any} */ e) => ok(e, ['path', 'reason']))) throw new Error('files: a list of { path, reason }');
  if (!Array.isArray(doc.workflow_lines) || !doc.workflow_lines.every((/** @type {any} */ e) => ok(e, ['path', 'line', 'reason']))) throw new Error('workflow_lines: a list of { path, line, reason }');
  return { files: doc.files, workflow_lines: doc.workflow_lines };
}

/**
 * Every finding and every stale allowance entry of a tree.
 * @param {string} root
 * @param {Allowance} allowance
 * @param {string[]} files the tracked files
 * @returns {{ findings: string[], stale: string[], exempted: string[] }}
 */
export function check(root, allowance, files) {
  /** @type {string[]} */
  const findings = [];
  /** @type {string[]} */
  const stale = [];
  /** @type {string[]} */
  const exempted = [];
  const allowedFiles = new Map(allowance.files.map((e) => [e.path, e]));
  for (const e of allowance.files) {
    if (!files.includes(e.path)) stale.push(e.path + ': listed in the allowance but not a tracked file');
    else if (!fileFinding(e.path, root)) stale.push(e.path + ': listed in the allowance but the check does not flag it');
  }
  for (const rel of files) {
    const why = fileFinding(rel, root);
    if (!why) continue;
    if (allowedFiles.has(rel)) exempted.push(rel + ' (' + why + ')');
    else findings.push(rel + ': ' + why);
  }
  /** @type {Map<string, number>} */
  const lineHits = new Map(allowance.workflow_lines.map((e) => [e.path + '\0' + e.line.trim(), 0]));
  const workflows = files.filter((f) => /^\.github\/workflows\/[^/]+\.ya?ml$/.test(f));
  for (const wf of workflows) {
    const lines = fs.readFileSync(path.join(root, wf), 'utf8').split(/\r?\n/);
    lines.forEach((line, i) => {
      const why = lineFinding(line);
      if (!why) return;
      const key = wf + '\0' + line.trim();
      const hit = lineHits.get(key);
      if (hit === undefined) findings.push(wf + ':' + (i + 1) + ': ' + why);
      else {
        lineHits.set(key, hit + 1);
        exempted.push(wf + ':' + (i + 1) + ' (' + why + ')');
      }
    });
  }
  for (const e of allowance.workflow_lines) {
    if (!lineFinding(e.line)) stale.push(e.path + ': the allowance line "' + e.line + '" is not one the check flags');
    else if (!lineHits.get(e.path + '\0' + e.line.trim())) stale.push(e.path + ': the allowance line "' + e.line + '" is not in that workflow');
  }
  return { findings, stale, exempted };
}

/** @param {string[]} argv @returns {number} */
export function main(argv) {
  let root = ROOT;
  let allowanceFile = '';
  for (const a of argv) {
    if (a.startsWith('--root=')) root = path.resolve(a.slice('--root='.length));
    else if (a.startsWith('--allowance=')) allowanceFile = path.resolve(a.slice('--allowance='.length));
    else {
      process.stderr.write('runtime-guard: unknown argument ' + a + '\n');
      return 2;
    }
  }
  const files = tracked(root);
  if (!files) {
    process.stderr.write('runtime-guard: cannot list the tracked files of ' + root + ' with git\n');
    return 2;
  }
  let allowance;
  try {
    allowance = readAllowance(allowanceFile || path.join(root, ALLOWANCE));
  } catch (e) {
    process.stderr.write('runtime-guard: the allowance cannot be read: ' + (e instanceof Error ? e.message : String(e)) + '\n');
    return 2;
  }
  const { findings, stale, exempted } = check(root, allowance, files);
  for (const x of exempted) process.stdout.write('ALLOWED ' + x + '\n');
  for (const x of findings) process.stdout.write('FAIL    ' + x + '\n');
  for (const x of stale) process.stdout.write('STALE   ' + x + '\n');
  const bad = findings.length + stale.length;
  process.stdout.write((bad ? 'FAIL' : 'OK') + '      runtime-guard: ' + files.length + ' tracked files, ' + findings.length + ' findings, '
    + stale.length + ' stale allowance entries, ' + exempted.length + ' allowed\n');
  return bad ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv.slice(2));
