// The S27 parity harness (#497): assemble a scenario directory, run a scenario on one side (install.ps1 under
// a PowerShell, or mhw install-windows), normalise it, and apply the declared differences. Used by
// test/install/windows-golden.test.js; see its header for what is compared and normalised. The working
// method rendered there is a frozen three-file stand-in (test/golden/S27/inputs/method), so a change to
// method/ cannot move a golden that nothing can re-record once install.ps1 is gone.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readGolden, goldenPath } from './golden.js';
import { toPowerShell } from '../install/windows-cases.js';

export const SLICE = 'S27';
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const INPUTS = goldenPath(SLICE, 'inputs');
export const WIN = process.platform === 'win32';
const cleanups = /** @type {Array<() => void>} */ ([]);
/** Remove every scenario directory made so far. */ export const cleanupAll = () => cleanups.splice(0).forEach((c) => c());

/** @param {string} label */
function freshDir(label) {
  const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 's27-' + label + '-')));
  cleanups.push(() => fs.rmSync(d, { recursive: true, force: true }));
  return d;
}

/**
 * A scenario directory: tree/ (this checkout's code and the frozen inputs; install.ps1 when given), home/
 * and ov/ (the overlays a step can name).
 * @param {string} label @param {Buffer | null} ps1
 */
export function assemble(label, ps1) {
  const t = freshDir(label);
  const tree = path.join(t, 'tree');
  for (const p of ['src', 'bin', 'package.json']) fs.cpSync(path.join(ROOT, p), path.join(tree, p), { recursive: true });
  fs.cpSync(path.join(INPUTS, 'method'), path.join(tree, 'method'), { recursive: true });
  fs.cpSync(path.join(INPUTS, 'global'), path.join(tree, 'global'), { recursive: true });
  fs.copyFileSync(path.join(INPUTS, '.bumpversion.toml'), path.join(tree, '.bumpversion.toml'));
  fs.cpSync(path.join(INPUTS, 'overlay'), path.join(tree, 'overlay'), { recursive: true });
  if (ps1) fs.writeFileSync(path.join(tree, 'global', 'install.ps1'), ps1);
  const ov = path.join(t, 'ov');
  fs.cpSync(path.join(INPUTS, 'overlay'), path.join(ov, 'repo'), { recursive: true });
  fs.mkdirSync(path.join(ov, 'models-off'), { recursive: true });
  for (const f of ['AGENTS.md', 'deny-floor.conf']) fs.copyFileSync(path.join(INPUTS, 'overlay', f), path.join(ov, 'models-off', f));
  fs.mkdirSync(path.join(ov, 'models-only'), { recursive: true });
  fs.copyFileSync(path.join(INPUTS, 'overlay', 'model-defaults.json'), path.join(ov, 'models-only', 'model-defaults.json'));
  fs.cpSync(path.join(INPUTS, 'overlay-profile'), path.join(ov, 'profile'), { recursive: true });
  fs.mkdirSync(path.join(t, 'home'));
  return t;
}

/** The overlay argument of a step, or none. @param {string} t @param {string | undefined} ov */
function overlayArg(t, ov) {
  if (ov === undefined) return [];
  if (ov === 'none') return ['--overlay=none'];
  if (ov === 'missing') return ['--overlay=' + path.join(t, 'no-such-overlay')];
  return ['--overlay=' + path.join(t, 'ov', ov)];
}

/** The environment of a step: the runner's own, minus every variable an installer reads, plus the profile. @param {string} t @param {import('../install/windows-cases.js').Step} step */
function stepEnv(t, step) {
  /** @type {Record<string, string | undefined>} */
  const env = { ...process.env };
  for (const k of ['CODEX_HOME', 'XDG_DATA_HOME', 'MHW_NODE', 'MHW_CMD', 'WORKSTATION_OVERLAY', 'WORKSTATION_LAUNCHER_PLATFORM', 'NODE_OPTIONS']) delete env[k];
  const home = path.join(t, 'home');
  env.USERPROFILE = home;
  env.HOME = home;
  if (step.codexHome) env.CODEX_HOME = path.join(t, 'codex-home');
  if (step.node === 'bogus') env.MHW_NODE = path.join(t, 'no-such-node.exe');
  if (step.node === 'node') env.MHW_NODE = process.execPath;
  if (step.path === 'no-node') {
    const sys = WIN ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32') : '/usr/sbin';
    delete env.Path;
    env.PATH = sys;
  }
  return env;
}

/** A JSON text as its parsed value, re-serialised with its key order kept; anything else unchanged. @param {string} text */
function canonical(text) {
  try {
    return JSON.stringify(JSON.parse(text.replace(/^\uFEFF/, '')), null, 2);
  } catch {
    return text;
  }
}

/** Every directory PowerShell writes under the profile it starts with. @param {string} rel */
const powershellOwn = (rel) => /^AppData(\/|$)/.test(rel);

/**
 * The profile's tree (and CODEX_HOME's): path, kind, and text (sha256 past 2 KiB), JSON compared as its value.
 * @param {string} t @param {(s: string) => string} norm
 */
function tree(t, norm) {
  /** @type {Array<{ path: string, kind: string, data: string }>} */
  const out = [];
  /** @param {string} base @param {string} rel */
  const walk = (base, rel) => {
    const dir = path.join(t, base, rel);
    if (!fs.existsSync(dir)) return;
    for (const name of fs.readdirSync(dir).sort((a, b) => (a < b ? -1 : Number(a > b)))) {
      const r = rel ? rel + '/' + name : name;
      if (powershellOwn(r)) continue;
      const st = fs.lstatSync(path.join(dir, name));
      if (st.isDirectory()) {
        out.push({ path: base + '/' + r, kind: 'dir', data: '' });
        walk(base, r);
      } else {
        // CRLF to LF and a backslash to a slash: the renderers write CRLF and Windows paths on Windows (as
        // Python's text mode did), on both sides alike, so one golden serves every OS. In a JSON file only
        // an escaped backslash (a path separator) becomes a slash; the JSON escapes stay.
        let text = fs.readFileSync(path.join(dir, name), 'utf8').replaceAll('\r\n', '\n');
        if (/\.json($|\.)/.test(name)) text = norm(canonical(text)).replaceAll('\\\\', '/');
        else text = norm(text).replaceAll('\\', '/');
        out.push({ path: base + '/' + r, kind: 'file', data: text.length > 2048 ? 'sha256:' + crypto.createHash('sha256').update(text).digest('hex') : text });
      }
    }
  };
  walk('home', '');
  walk('codex-home', '');
  return out;
}

/** The normaliser of one scenario directory. @param {string} t */
function normaliser(t) {
  const subs = [[t, '<T>'], [t.replaceAll('\\', '/'), '<T>'], [t.replaceAll('\\', '\\\\'), '<T>'],
    [process.execPath, '<NODE>'], [process.execPath.replaceAll('\\', '/'), '<NODE>'], [process.execPath.replaceAll('\\', '\\\\'), '<NODE>']]
    .sort((a, b) => b[0].length - a[0].length);
  return (/** @type {string} */ s) => {
    let o = s;
    for (const [from, to] of subs) o = o.replaceAll(from, to);
    return o;
  };
}

/** @param {string} s */
const streamText = (s) => s.replaceAll('\r\n', '\n').replaceAll('\\', '/');

/**
 * Run a scenario on one side: 'node' (this tree's mhw install-windows) or a PowerShell executable (install.ps1).
 * @param {import('../install/windows-cases.js').Scenario} sc @param {string | null} ps @param {Buffer | null} ps1
 */
export function runScenario(sc, ps, ps1) {
  const t = assemble(sc.name, ps1);
  const norm = normaliser(t);
  const runs = [];
  for (const step of sc.steps) {
    if (step.setup) step.setup(path.join(t, 'home'), t);
    const args = [...step.args, ...overlayArg(t, step.ov)];
    const env = stepEnv(t, step);
    const tree0 = path.join(t, 'tree');
    const p = ps
      ? spawnSync(ps, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(tree0, 'global', 'install.ps1'), ...toPowerShell(args)], { env, cwd: t, encoding: 'utf8' })
      : spawnSync(process.execPath, [path.join(tree0, 'bin', 'mhw.js'), 'install-windows', ...args], { env, cwd: t, encoding: 'utf8' });
    runs.push({
      args: [...step.args, ...(step.ov ? ['<ov:' + step.ov + '>'] : [])],
      code: p.status,
      stdout: norm(streamText(p.stdout)),
      stderr: norm(streamText(p.stderr)),
      tree: tree(t, norm),
    });
  }
  return { name: sc.name, runs };
}

export const expected = readGolden(SLICE, 'expected-differences.json');

/**
 * The golden with each declared difference applied: a pattern on a stream is replaced, line by line, with
 * its replacement (what the head prints instead).
 * @param {{ name: string, runs: any[] }} golden
 */
export function declared(golden) {
  const rules = expected.filter((/** @type {any} */ e) => e.pattern && (!e.case || e.case === golden.name));
  return {
    ...golden,
    runs: golden.runs.map((r) => {
      const o = { ...r };
      for (const e of rules) {
        const re = new RegExp(e.pattern, 'gm');
        if (e.stream === 'stdout' || e.stream === 'stderr') o[e.stream] = o[e.stream].replace(re, e.replace);
      }
      return o;
    }),
  };
}
