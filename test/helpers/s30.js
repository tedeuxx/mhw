// The S30 harness (#500, convention 3 of #470): one case of the method issue sync laid out in a fresh
// directory (a stub gh on PATH, the Issues in a state file, the sync directory), its steps run in order by
// one implementation, and what a reader can observe recorded: each step's exit code, stdout and stderr,
// every gh call with the token it carried (by name), the Issues afterwards, and the files written. The
// case directory is replaced by <D>. Every value is synthetic; no network, no account, no real token.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { snapshotTree } from './parity.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, '..', '..');
export const SCRIPT = path.join(ROOT, '.github', 'scripts', 'method-issue-sync.js');
export const STUB = path.join(HERE, 's30-stub-gh.js');

/**
 * @typedef {{ run: string[], issue?: string, env?: Record<string, string | null> }
 *   | { twin: { state?: string, number?: number, author?: string } }
 *   | { reset: { mhw_state: string, skills?: unknown[], comments?: unknown[] } }
 *   | { write: string, text: string }
 *   | { json: string, value: unknown }
 *   | { mkdir: string, mode?: number }
 *   | { symlink: string, target: string }} Step
 * @typedef {{ name: string, steps: Step[], why?: string }} Case
 * @typedef {{ code: number | null, stdout: string, stderr: string }} Result
 * @typedef {{ steps: Result[], calls: unknown[], state: unknown, tree: unknown[] }} Transcript
 * @typedef {(args: string[], env: Record<string, string>, cwd: string) => Result} Runner
 */

/**
 * The Issues every case starts from: one unrelated Issue and the App-authored twin of #70.
 * @param {string} [mhwState]
 * @param {unknown[]} [skills]
 * @param {unknown[]} [comments]
 */
export function initialState(mhwState = 'OPEN', skills = /** @type {unknown[]} */ (DEFAULT_SKILLS), comments = /** @type {unknown[]} */ ([])) {
  return {
    mhw: { number: 7, title: 'T', body: 'B', state: mhwState, url: 'https://github.com/tedeuxx/mhw/issues/7', labels: [] },
    mhw_comments: [...comments], skills: structuredClone(skills),
  };
}

export const DEFAULT_SKILLS = [
  { number: 5, title: 'other', state: 'OPEN', url: 'u5', body: 'unrelated' },
  { number: 6, title: 'other twin', state: 'OPEN', url: 'u6', body: '<!-- mhw-issue: tedeuxx/mhw#70 -->', author: { login: 'app/tedeuxx-mhw-mirror' } },
];

/** @param {{ state?: string, number?: number, author?: string }} t */
export function twin(t) {
  const number = t.number ?? 42;
  return {
    number, title: '[mhw#7] T', state: t.state ?? 'OPEN', url: 'u' + number, author: { login: t.author ?? 'app/tedeuxx-mhw-mirror' },
    body: '<!-- mhw-issue: tedeuxx/mhw#7 -->\nhttps://github.com/tedeuxx/mhw/issues/7',
  };
}

/**
 * A gh on PATH that runs the JavaScript stub, or the Python one given as text.
 * @param {string} bin
 * @param {string | undefined} pythonStub
 * @param {string | undefined} python
 */
function writeGh(bin, pythonStub, python) {
  fs.mkdirSync(bin);
  const gh = path.join(bin, 'gh');
  /** @param {string} s */
  const q = (s) => "'" + s.replaceAll("'", String.raw`'\''`) + "'";
  if (pythonStub) fs.writeFileSync(gh, '#!' + python + ' -B\n' + pythonStub);
  else fs.writeFileSync(gh, '#!/bin/sh\nexec ' + q(process.execPath) + ' ' + q(STUB) + ' "$@"\n');
  fs.chmodSync(gh, 0o700);
}

/**
 * One step that is not a run: change the Issues or lay out a file, a directory or a link.
 * @param {Exclude<Step, { run: string[] }>} step
 * @param {(s: string) => string} fill
 * @param {string} statePath
 */
function layOut(step, fill, statePath) {
  /** @param {unknown} v */
  const saveState = (v) => fs.writeFileSync(statePath, JSON.stringify(v));
  if ('twin' in step) {
    const st = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    st.skills.push(twin(step.twin));
    saveState(st);
  } else if ('reset' in step) {
    saveState(initialState(step.reset.mhw_state, step.reset.skills ?? [], step.reset.comments ?? []));
  } else if ('write' in step) {
    fs.writeFileSync(fill(step.write), step.text);
  } else if ('json' in step) {
    fs.writeFileSync(fill(step.json), JSON.stringify(step.value));
  } else if ('mkdir' in step) {
    fs.mkdirSync(fill(step.mkdir));
    if (step.mode !== undefined) fs.chmodSync(fill(step.mkdir), step.mode);
  } else {
    fs.symlinkSync(fill(step.target), fill(step.symlink));
  }
}

/**
 * Lay out a case, run its steps with runner, and normalise what was observed.
 * @param {Case} c
 * @param {Runner} runner
 * @param {{ pythonStub?: string, python?: string }} [opts]
 * @returns {Transcript}
 */
export function transcript(c, runner, opts = {}) {
  const d = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 's30-')));
  try {
    const bin = path.join(d, 'bin');
    writeGh(bin, opts.pythonStub, opts.python);
    const sync = path.join(d, 'sync');
    fs.mkdirSync(sync);
    const home = path.join(d, 'home');
    fs.mkdirSync(home);
    const statePath = path.join(d, 'state.json');
    const logPath = path.join(d, 'log.jsonl');
    /** @param {unknown} v */
    const saveState = (v) => fs.writeFileSync(statePath, JSON.stringify(v));
    saveState(initialState());
    /** @param {string} s */
    const fill = (s) => s.replaceAll('{SYNC}', sync).replaceAll('{D}', d);
    /** @type {Result[]} */
    const results = [];
    for (const step of c.steps) {
      if ('run' in step) {
        /** @type {Record<string, string>} */
        const env = {
          PATH: bin + path.delimiter + (process.env.PATH || ''), HOME: home, STUB_STATE: statePath, STUB_LOG: logPath,
          MHW_ISSUE: step.issue ?? '7', MHW_TOKEN: 'tok-mhw', MHW_SKILLS_TOKEN: 'tok-skills', MHW_SYNC_DIR: sync,
          GITHUB_TOKEN: 'tok-other', PYTHONDONTWRITEBYTECODE: '1', PYTHONUTF8: '1',
        };
        for (const [k, v] of Object.entries(step.env || {})) {
          if (v === null) delete env[k];
          else env[k] = fill(v);
        }
        const r = runner(step.run.map(fill), env, d);
        /** @param {string} s */
        const norm = (s) => s.replaceAll('\r\n', '\n').replaceAll(d, '<D>');
        results.push({ code: r.code, stdout: norm(r.stdout), stderr: norm(r.stderr) });
      } else {
        layOut(step, fill, statePath);
      }
    }
    const subs = /** @type {Array<[string, string]>} */ ([[d, '<D>']]);
    const calls = fs.existsSync(logPath)
      ? fs.readFileSync(logPath, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l.replaceAll(d, '<D>')))
      : [];
    const state = JSON.parse(fs.readFileSync(statePath, 'utf8').replaceAll(d, '<D>'));
    // A link's own mode is the platform's (755 on macOS, 777 on Linux), never what a command chose.
    const tree = snapshotTree(d, subs)
      .filter((e) => !/^(bin|home)(\/|$)/.test(e.path) && e.path !== 'state.json' && e.path !== 'log.jsonl')
      .map((e) => (e.kind === 'link' ? { ...e, mode: '-', data: e.data.replaceAll(d, '<D>') } : e));
    return { steps: results, calls, state, tree };
  } finally {
    fs.rmSync(d, { recursive: true, force: true });
  }
}

/** @type {Runner} */
export const nodeRunner = (args, env, cwd) => {
  const p = spawnSync(process.execPath, [SCRIPT, ...args], { env, cwd, encoding: 'utf8' });
  return { code: p.status, stdout: p.stdout, stderr: p.stderr };
};

/**
 * The original, extracted from the base revision, on a given python3.
 * @param {string} python
 * @param {string} script
 * @returns {Runner}
 */
export const pythonRunner = (python, script) => (args, env, cwd) => {
  const p = spawnSync(python, ['-B', script, ...args], { env, cwd, encoding: 'utf8' });
  return { code: p.status, stdout: p.stdout, stderr: p.stderr };
};

/**
 * @typedef {{ case: string[], stream: Array<'stdout' | 'stderr'>, base?: string, head?: string, replace?: string, why: string }} ExpectedDifference
 */

/**
 * The two transcripts compared, after each expected difference rewrites its lines on each side (base on
 * the original, head on the Node script) to `replace`.
 * @param {string} name
 * @param {Transcript} original
 * @param {Transcript} head
 * @param {ExpectedDifference[]} expected
 * @returns {string[]}
 */
export function differences(name, original, head, expected) {
  const rules = expected.filter((e) => e.case.includes(name) || e.case.includes('*'));
  /** @param {string} text @param {'stdout' | 'stderr'} stream @param {'base' | 'head'} side */
  const apply = (text, stream, side) => {
    let out = text;
    for (const r of rules) {
      const pattern = r[side];
      if (r.stream.includes(stream) && pattern) out = out.replace(new RegExp(pattern, 'gm'), r.replace ?? '');
    }
    return out;
  };
  /** @param {Transcript} t @param {'base' | 'head'} side */
  const view = (t, side) => ({
    steps: t.steps.map((s) => ({ code: s.code, stdout: apply(s.stdout, 'stdout', side), stderr: apply(s.stderr, 'stderr', side) })),
    calls: t.calls, state: t.state, tree: t.tree,
  });
  const a = view(original, 'base');
  const b = view(head, 'head');
  /** @type {string[]} */
  const diffs = [];
  const steps = Math.max(a.steps.length, b.steps.length);
  for (let i = 0; i < steps; i++) {
    const x = JSON.stringify(a.steps[i]);
    const y = JSON.stringify(b.steps[i]);
    if (x !== y) diffs.push(name + ': step ' + i + ' differs\n--- original\n' + x + '\n--- head\n' + y);
  }
  for (const key of /** @type {const} */ (['calls', 'state', 'tree'])) {
    const x = JSON.stringify(a[key], null, 1);
    const y = JSON.stringify(b[key], null, 1);
    if (x !== y) diffs.push(name + ': ' + key + ' differs\n--- original\n' + x + '\n--- head\n' + y);
  }
  return diffs;
}
