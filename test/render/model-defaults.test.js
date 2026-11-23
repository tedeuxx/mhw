// S10 parity (#481, convention 3 of #470): src/render/model-defaults.js against the deleted
// global/models/model_defaults.py, on the cases of its own suite (model_defaults_test.py, also deleted)
// plus byte-for-byte install -> uninstall per harness, the TOML editor on a commented fixture, and the
// edges of Python's text semantics (test/golden/S10/cases.json). Every value is synthetic, and every run
// is on a throwaway directory: HOME, USERPROFILE and every path the renderer can reach are under it.
//   golden: the Node renderer in this process against the transcripts recorded from the Python original
//           (exit code, stdout, stderr and every entry under the case's directory after each run: path,
//           kind, mode, content). Every OS.
//   live:   where the base revision still holds model_defaults.py and the recorded CPython is on PATH, the
//           Python original and the Node renderer side by side. POSIX only. MHW_UPDATE_GOLDEN=1 rewrites
//           the golden transcripts from the Python side, never from the Node side.
//   entry:  the same cases through `node src/render/model-defaults.js`, the form install.sh and
//           install.ps1 run.
// Then the deleted suite's assertions that are not transcripts, and unit tests of the Python semantics.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import {
  run, NativeFile, BACKUP, UNREADABLE, utf8Error, splitLines, pyPath, pyErrorClass, isKeyLine, tomlValue,
  readText, loadPolicy, PolicyError,
} from '../../src/render/model-defaults.js';
import { tomlInvalid } from '../../src/render/toml-guard.js';
import { readGolden, writeGolden, UPDATE } from '../helpers/golden.js';
import { which } from '../helpers/home.js';
import { extractRevision } from '../helpers/parity.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SLICE = 'S10';
const POSIX = process.platform !== 'win32';
const WIN = !POSIX;
const SCRIPT = path.join(ROOT, 'src', 'render', 'model-defaults.js');
const spec = readGolden(SLICE, 'cases.json');
const declared = readGolden(SLICE, 'expected-differences.json');
/** @type {Array<{ case: string, stream: string, pattern: string, why: string }>} */
const expected = declared.differences;
const recordedFrom = readGolden(SLICE, 'recorded-from.json');
const GIT = which('git');
const RECORD = '.local/share/personal-multi-harness-workstation-configuration/model-defaults.json';
const cleanups = /** @type {Array<() => void>} */ ([]);
after(() => cleanups.forEach((c) => c()));

/**
 * @typedef {{ run?: string, args?: string[], policy?: unknown, stamp?: string, home?: boolean, env?: Record<string, string>,
 *   write?: string, text?: string, bytes?: string, hex?: string, mkdir?: string, chmod?: string, mode?: string,
 *   replace?: string, from?: string, to?: string, remove?: string }} Step
 * @typedef {{ name: string, posix?: boolean, steps: Step[] }} Case
 * @typedef {{ path: string, kind: string, mode: string, text?: string, hex?: string }} Entry
 * @typedef {{ code: number, stdout: string, stderr: string, tree: Entry[] }} Run
 * @typedef {{ name: string, runs: Run[] }} Transcript
 * @typedef {(args: string[], env: Record<string, string>, cwd: string) => { code: number, stdout: string, stderr: string }} Runner
 */

/** @type {Case[]} */
const CASES = spec.cases;

/** @param {string} label */
function freshDir(label) {
  const dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'mhw-s10-' + label + '-')));
  cleanups.push(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/**
 * Every entry under dir after normalise: path, kind, mode (POSIX), content as text when it is UTF-8.
 * @param {string} dir
 * @param {(s: string) => string} norm
 * @returns {Entry[]}
 */
function snapshot(dir, norm) {
  /** @type {Entry[]} */
  const out = [];
  /** @param {string} rel */
  const walk = (rel) => {
    for (const name of fs.readdirSync(path.join(dir, rel)).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))) {
      const r = rel ? rel + '/' + name : name;
      const p = path.join(dir, r);
      const st = fs.lstatSync(p);
      const mode = POSIX ? (st.mode & 0o777).toString(8) : '-';
      if (st.isDirectory()) {
        out.push({ path: r, kind: 'dir', mode });
        walk(r);
        continue;
      }
      /** @type {Entry} */
      const e = { path: r, kind: st.isSymbolicLink() ? 'link' : 'file', mode };
      try {
        const raw = fs.readFileSync(p);
        const text = raw.toString('utf8');
        if (Buffer.from(text, 'utf8').equals(raw)) e.text = norm(WIN ? text.replaceAll('\r\n', '\n') : text);
        else e.hex = raw.toString('hex');
      } catch {
        e.text = '<unreadable>';
      }
      out.push(e);
    }
  };
  walk('');
  return out;
}

/**
 * The normaliser: the case directory becomes <BASE>; on Windows its JSON-escaped form too, and the
 * remaining path separators become /, so one golden serves every OS.
 * @param {string} base
 */
function normaliser(base) {
  return (/** @type {string} */ s) => {
    let out = s;
    if (WIN) {
      // Only the separators of a path under <BASE> become /: a backslash elsewhere (a JSON or TOML escape
      // such as \u00e7) is content and stays.
      out = out.split(base.replaceAll('\\', '\\\\')).join('<BASE>').split(base).join('<BASE>');
      out = out.replace(/<BASE>[^\s"',;()]*/g, (p) => p.replaceAll('\\\\', '/').replaceAll('\\', '/'));
    } else {
      out = out.split(base).join('<BASE>');
    }
    return out;
  };
}

/**
 * Run every step of c with runner; the transcript.
 * @param {Case} c
 * @param {Runner} runner
 * @returns {Transcript}
 */
function transcript(c, runner) {
  const outer = freshDir('case');
  const base = path.join(outer, 'case');
  const home = path.join(base, 'home');
  fs.mkdirSync(home, { recursive: true });
  const policyFile = path.join(base, 'policy.json');
  /** @param {string} s */
  const fill = (s) => s.split('{BASE}').join(base).split('{HOME}').join(home).split('{POLICY}').join(policyFile)
    .split('/').join(path.sep);
  /** @param {string} s JSON text: a path placeholder is filled JSON-escaped */
  const fillText = (s) => s.replace(/\{(?:BASE|HOME)\}[^"]*/g, (p) => JSON.stringify(fill(p)).slice(1, -1));
  /** @param {unknown} doc */
  const writePolicy = (doc) => fs.writeFileSync(policyFile, JSON.stringify(doc));
  writePolicy(spec.policy);
  const norm = normaliser(base);
  /** @type {Run[]} */
  const runs = [];
  for (const s of c.steps) {
    if (s.write !== undefined) {
      const f = fill(s.write);
      fs.mkdirSync(path.dirname(f), { recursive: true });
      fs.writeFileSync(f, fillText(/** @type {string} */ (s.text)));
    } else if (s.bytes !== undefined) {
      const f = fill(s.bytes);
      fs.mkdirSync(path.dirname(f), { recursive: true });
      fs.writeFileSync(f, Buffer.from(/** @type {string} */ (s.hex), 'hex'));
    } else if (s.mkdir !== undefined) {
      fs.mkdirSync(fill(s.mkdir), { recursive: true });
    } else if (s.chmod !== undefined) {
      fs.chmodSync(fill(s.chmod), Number.parseInt(/** @type {string} */ (s.mode), 8));
    } else if (s.replace !== undefined) {
      const f = fill(s.replace);
      const text = fs.readFileSync(f, 'utf8');
      // Rewritten in the file's own line ends: on Windows the renderer wrote \r\n.
      const from = /** @type {string} */ (s.from);
      const to = /** @type {string} */ (s.to);
      const crlf = WIN && text.includes('\r\n');
      const fix = (/** @type {string} */ x) => (crlf ? x.replaceAll('\n', '\r\n') : x);
      assert.ok(text.includes(fix(from)), c.name + ': replace found nothing');
      fs.writeFileSync(f, text.replace(fix(from), fix(to)));
    } else if (s.remove !== undefined) {
      fs.rmSync(fill(s.remove), { force: true });
    } else if (s.policy !== undefined) {
      writePolicy(s.policy);
    } else {
      // --policy: the run's own value (a placeholder, none, or empty), or {POLICY}.
      const own = /** @type {Step & { policyArg?: string }} */ (s).policyArg;
      const args = s.args || [
        '--mode=' + s.run,
        '--stamp=' + (s.stamp || spec.stamp),
        '--policy=' + (own === undefined ? policyFile : fill(own)),
        ...(s.home === false ? [] : ['--home=' + home]),
      ];
      /** @type {Record<string, string>} */
      const env = {};
      for (const [k, v] of Object.entries(process.env)) if (v !== undefined && k !== 'CODEX_HOME' && k !== 'XDG_DATA_HOME') env[k] = v;
      Object.assign(env, { HOME: home, USERPROFILE: home });
      for (const [k, v] of Object.entries(s.env || {})) env[k] = fill(v);
      const r = runner(args, env, base);
      runs.push({ code: r.code, stdout: norm(r.stdout), stderr: norm(r.stderr), tree: snapshot(base, norm) });
    }
  }
  return { name: c.name, runs };
}

// cases.json names a run's own policy argument "policy" too, beside a policy step; a run step carries
// it under run+policy. Map it once here so transcript() reads one field.
for (const c of CASES) {
  for (const s of c.steps) {
    if (s.run !== undefined && 'policy' in s) {
      /** @type {any} */ (s).policyArg = s.policy;
      delete s.policy;
    }
  }
}

/** The Node renderer in this process. @type {Runner} */
const nodeRunner = (args, env, cwd) => {
  let out = '';
  let err = '';
  const code = run(args, { env, cwd, out: (x) => { out += x; }, err: (x) => { err += x; } });
  return { code, stdout: out, stderr: err };
};

/**
 * One rule per declared difference, applied to both sides before they are compared: the matched text
 * becomes <DECLARED>. The OSError subclass a removed directory raises is the OS's (macOS PermissionError,
 * Linux IsADirectoryError, from Python and Node alike), so it is folded too; pyErrorClass is unit-tested.
 * @param {string} name
 * @param {string} stream
 * @param {string} text
 */
function fold(name, stream, text) {
  let out = text.replace(/the backup or the write failed \((PermissionError|IsADirectoryError)\)/g, 'the backup or the write failed (<OSError>)');
  // Windows: CPython's open() on a directory raises PermissionError (errno 13), not IsADirectoryError.
  if (WIN) out = out.replaceAll('[Errno 13] Permission denied', '[Errno 21] Is a directory');
  for (const e of expected) {
    if (e.case === name && e.stream === stream) out = out.replace(new RegExp(e.pattern, 'g'), '<DECLARED>');
  }
  return out;
}

/**
 * @param {Transcript} original
 * @param {Transcript} head
 */
function differences(original, head) {
  /** @type {string[]} */
  const diffs = [];
  if (original.runs.length !== head.runs.length) return [head.name + ': ' + original.runs.length + ' runs -> ' + head.runs.length];
  original.runs.forEach((o, i) => {
    const h = head.runs[i];
    const at = head.name + ' run ' + (i + 1);
    if (o.code !== h.code) diffs.push(at + ': exit ' + o.code + ' -> ' + h.code);
    for (const stream of /** @type {const} */ (['stdout', 'stderr'])) {
      if (fold(head.name, stream, o[stream]) !== fold(head.name, stream, h[stream])) {
        diffs.push(at + ': ' + stream + ' differs\n--- original\n' + o[stream] + '\n--- head\n' + h[stream]);
      }
    }
    /** @param {Entry[]} t */
    // Windows: modes are not compared, and \r\n reads as \n (the renderer writes \r\n there, as Python's
    // text mode did; the Windows-only CRLF test holds that).
    const tree = (t) => JSON.stringify(t.map((e) => (WIN ? { ...e, mode: '-', ...(e.text === undefined ? {} : { text: e.text.replaceAll('\r\n', '\n') }) } : e)), null, 1);
    if (tree(o.tree) !== tree(h.tree)) diffs.push(at + ': tree differs\n--- original\n' + tree(o.tree) + '\n--- head\n' + tree(h.tree));
  });
  return diffs;
}

/** @param {string} name */
const goldenName = (name) => 'transcripts/' + name + '.json';

/** @param {Case} c */
const skipReason = (c) => {
  if (c.posix && !POSIX) return 'needs POSIX file modes';
  if (c.posix && process.getuid && process.getuid() === 0) return 'root reads a mode-000 file';
  return '';
};

test('every case has a golden transcript and every expected difference names a case', () => {
  const names = new Set(CASES.map((c) => c.name));
  assert.equal(names.size, CASES.length, 'case names are unique');
  for (const c of CASES) assert.ok(fs.existsSync(path.join(ROOT, 'test', 'golden', SLICE, goldenName(c.name))), 'no golden for ' + c.name);
  for (const e of expected) {
    assert.ok(names.has(e.case), 'unknown case ' + e.case);
    assert.ok(e.why && e.why.length > 40, 'an expected difference states why');
    new RegExp(e.pattern);
  }
  for (const r of declared.residuals) assert.ok(r.what && r.why && r.why.length > 40, 'a residual states why');
});

test('golden: the Node renderer matches the Python original\'s transcripts', { skip: UPDATE && 'MHW_UPDATE_GOLDEN=1' }, (t) => {
  const diffs = [];
  for (const c of CASES) {
    const why = skipReason(c);
    if (why) {
      t.diagnostic(c.name + ' skipped: ' + why);
      continue;
    }
    diffs.push(...differences(readGolden(SLICE, goldenName(c.name)), transcript(c, nodeRunner)));
  }
  assert.deepEqual(diffs, []);
});

// CI sets MHW_S10_LIVE_REQUIRED=1 in a step that installs the recorded CPython: there, a base that still
// holds model_defaults.py with any other python3 (or none) is a failure, not a skip.
const LIVE_REQUIRED = process.env.MHW_S10_LIVE_REQUIRED === '1';

/** The python3 on PATH and its version, or null. */
function python3() {
  const py = which('python3');
  if (!py) return null;
  return { py, version: spawnSync(py, ['-c', 'import platform; print(platform.python_version())'], { encoding: 'utf8' }).stdout.trim() };
}

/**
 * The base revision's model_defaults.py and the recorded CPython; or why they are not here, and whether
 * that is a failure (MHW_S10_LIVE_REQUIRED=1 and the base still holds the script).
 * @returns {{ py?: string, script?: string, why?: string, fail?: boolean }}
 */
function pythonBase() {
  if (!POSIX) return { why: 'POSIX only' };
  if (!GIT) return { why: 'needs git on PATH', fail: LIVE_REQUIRED };
  const base = process.env.MHW_PARITY_BASE || (() => {
    const p = spawnSync(GIT, ['-C', ROOT, 'merge-base', 'HEAD', 'origin/' + (process.env.GITHUB_BASE_REF || 'rc/next')], { encoding: 'utf8' });
    return p.status === 0 ? p.stdout.trim() : '';
  })();
  if (!base) return { why: 'no base revision (MHW_PARITY_BASE unset, no merge-base with origin/rc/next)', fail: LIVE_REQUIRED };
  const dest = path.join(freshDir('base'), 'tree');
  if (!extractRevision(ROOT, base, dest)) return { why: 'base revision ' + base + ' is not readable here', fail: LIVE_REQUIRED };
  const script = path.join(dest, 'global', 'models', 'model_defaults.py');
  if (!fs.existsSync(script)) return { why: 'the base revision no longer holds model_defaults.py (this slice has merged)' };
  const p = python3();
  if (!p) return { why: 'needs python3 on PATH', fail: LIVE_REQUIRED };
  if (p.version !== recordedFrom.cpython) {
    return { why: 'the goldens were recorded from CPython ' + recordedFrom.cpython + ', python3 here is ' + p.version, fail: LIVE_REQUIRED };
  }
  return { py: p.py, script };
}

test('live: the Python original and the Node renderer side by side', (t) => {
  const b = pythonBase();
  if (!b.script || !b.py) {
    if (b.fail) assert.fail('MHW_S10_LIVE_REQUIRED=1: ' + b.why);
    t.skip(b.why);
    return;
  }
  const { py, script } = b;
  /** @type {Runner} */
  const python = (args, env, cwd) => {
    const p = spawnSync(py, ['-B', script, ...args], { env, cwd, encoding: 'utf8' });
    return { code: p.status ?? 1, stdout: p.stdout, stderr: p.stderr };
  };
  const diffs = [];
  for (const c of CASES) {
    if (skipReason(c)) continue;
    const original = transcript(c, python);
    if (UPDATE) writeGolden(SLICE, goldenName(c.name), original);
    diffs.push(...differences(original, transcript(c, nodeRunner)));
  }
  assert.deepEqual(diffs, []);
});

test('entry: node src/render/model-defaults.js runs the same renderer', () => {
  /** @type {Runner} */
  const entry = (args, env, cwd) => {
    const p = spawnSync(process.execPath, [SCRIPT, ...args], { env, cwd, encoding: 'utf8' });
    return { code: p.status ?? 1, stdout: p.stdout, stderr: p.stderr };
  };
  const diffs = [];
  for (const name of ['fresh-install-check-install-check', 'codex-commented-fixture-install-uninstall', 'usage-errors', 'policy-shapes']) {
    const c = /** @type {Case} */ (CASES.find((x) => x.name === name));
    diffs.push(...differences(readGolden(SLICE, goldenName(c.name)), transcript(c, entry)));
  }
  assert.deepEqual(diffs, []);
});

// ── The deleted suite's assertions that are properties, not transcripts ─────────────────────────────

/** @param {string} name */
const golden = (name) => /** @type {Transcript} */ (readGolden(SLICE, goldenName(name)));
/** @param {Run} r @param {string} p */
const fileText = (r, p) => r.tree.find((e) => e.path === p)?.text;

// The original restored each key's VALUE byte for byte and left every other line as it was; the line it
// edited is rewritten in its canonical spelling (key = "value"), so a quoted key spelling and an inline
// comment ON THAT LINE are not kept (the golden transcripts show the original doing the same). These
// assertions hold both halves against the port.
test('install then uninstall restores each value byte for byte and every other line as it was', () => {
  /** @type {Record<string, [string, Array<[string, string]>]>} case -> [file, each edited line and its canonical form] */
  const cases = {
    'claude-json-byte-for-byte-install-uninstall': ['home/.claude/settings.json', []],
    'kiro-json-byte-for-byte-install-uninstall': ['home/.kiro/settings/cli.json', []],
    'owner-value-replaced-and-restored-byte-for-byte': ['home/.codex/config.toml', []],
    'codex-unicode-owner-value-restored': ['home/.codex/config.toml',
      [['model = "gpt-\u00e7-\u00fcn\u00ef"', 'model = "gpt-\\u00e7-\\u00fcn\\u00ef"']]],
    'codex-commented-fixture-install-uninstall': ['home/.codex/config.toml',
      [['model = "gpt-owner" # the owner\'s model, inline comment kept', 'model = "gpt-owner"']]],
    'codex-quoted-owner-keys-and-literal-values': ['home/.codex/config.toml',
      [["  \"model\"   =   'gpt-literal'   # spaced, literal", 'model = "gpt-literal"'],
        ["'model_reasoning_effort'=\"high\"#tight", 'model_reasoning_effort = "high"']]],
  };
  for (const [name, [rel, edited]] of Object.entries(cases)) {
    const c = /** @type {Case} */ (CASES.find((x) => x.name === name));
    const seeded = /** @type {string} */ (/** @type {Step} */ (c.steps.find((s) => s.write && s.write.endsWith(rel.slice(4)))).text);
    const want = edited.reduce((acc, [from, to]) => {
      assert.ok(acc.includes(from), name + ': ' + from);
      return acc.replace(from, to);
    }, seeded);
    const t = transcript(c, nodeRunner);
    const last = t.runs[t.runs.length - 1];
    assert.equal(fileText(last, rel), want, name);
    assert.ok(!last.tree.some((e) => e.path === 'home/' + RECORD), name + ': the record is removed');
  }
});

test('the commented Codex fixture keeps every comment, blank line and table through install', () => {
  const t = golden('codex-commented-fixture-install-uninstall');
  const installed = /** @type {string} */ (fileText(t.runs[2], 'home/.codex/config.toml'));
  const seed = /** @type {string} */ (CASES.find((x) => x.name === 'codex-commented-fixture-install-uninstall')?.steps[0].text);
  // Exactly two lines differ: the owner's model line is replaced in place, the effort line is added first.
  const want = 'model_reasoning_effort = "medium"\n' + seed.replace('model = "gpt-owner" # the owner\'s model, inline comment kept', 'model = "gpt-5.6-sol"');
  assert.equal(installed, want);
  assert.equal(transcript(/** @type {Case} */ (CASES.find((x) => x.name === 'codex-commented-fixture-install-uninstall')), nodeRunner).runs[2].tree
    .find((e) => e.path === 'home/.codex/config.toml')?.text, want);
});

test('the backup is owner-only whatever the original mode', { skip: !POSIX && 'POSIX modes' }, () => {
  const c = /** @type {Case} */ (CASES.find((x) => x.name === 'backup-is-owner-only-whatever-the-original-mode'));
  const r = transcript(c, nodeRunner).runs[0];
  const entry = (/** @type {string} */ p) => r.tree.find((e) => e.path === p);
  assert.equal(entry('home/.codex/config.toml')?.mode, '644');
  assert.equal(entry('home/.codex/config.toml.pmhwc-models-backup')?.mode, '600');
  assert.equal(entry('home/.codex/config.toml.pmhwc-models-backup')?.text, 'model_reasoning_effort = "high"\n');
});

test('a backup that cannot be made leaves no temporary file and changes nothing', () => {
  const c = /** @type {Case} */ (CASES.find((x) => x.name === 'backup-that-cannot-be-made'));
  const r = transcript(c, nodeRunner).runs[0];
  assert.equal(r.code, 3);
  assert.match(r.stdout, /REFUSE {2}<BASE>\/home\/\.claude\/settings\.json: the backup or the write failed \(\w+Error\)/);
  assert.equal(fileText(r, 'home/.claude/settings.json'), '{"model": "owner-model"}');
  assert.ok(!r.tree.some((e) => e.path.includes('.new.')));
});

test('a failed replace removes its temporary file and leaves the original', () => {
  const dir = freshDir('replace');
  const file = path.join(dir, 'settings.json');
  fs.writeFileSync(file, '{"model": "owner-model"}');
  const nf = new NativeFile('claude-code', file, { seams: { rename: () => { throw Object.assign(new Error('replace failed'), { code: 'EACCES' }); } } });
  nf.put('model', 'pinned');
  assert.throws(() => nf.write(), /replace failed/);
  assert.equal(fs.readFileSync(file, 'utf8'), '{"model": "owner-model"}');
  assert.deepEqual(fs.readdirSync(dir).filter((n) => n.includes('.new.')), []);
  assert.ok(fs.existsSync(file + BACKUP), 'the backup is taken before the write');
});

test('a write the renderer cannot encode is not an OSError: it propagates, as Python crashed', () => {
  // A Kiro cli.json the original read and could not write back (a lone high surrogate): still a crash.
  const dir = freshDir('surrogate');
  const home = path.join(dir, 'home');
  fs.mkdirSync(path.join(home, '.kiro', 'settings'), { recursive: true });
  fs.writeFileSync(path.join(home, '.kiro', 'settings', 'cli.json'), '{"x": "\\ud800"}');
  const policy = path.join(dir, 'p.json');
  fs.writeFileSync(policy, JSON.stringify({ version: 1, 'kiro-cli': { model: 'claude-x' } }));
  assert.throws(() => run(['--mode=install', '--policy=' + policy, '--home=' + home], { env: { HOME: home }, out: () => {}, err: () => {} }), TypeError);
  assert.deepEqual(fs.readdirSync(path.join(home, '.kiro', 'settings')).filter((n) => n.includes('.new.')), []);
});

test('a Claude Code settings.json jq refuses is refused here too, as the settings merge refuses it (#503, carried from #502)', () => {
  for (const [label, text] of [['a lone high surrogate', '{"x": "\\ud800"}'], ['nested 300 levels deep', '{"a":'.repeat(300) + '1' + '}'.repeat(300)],
    ['not JSON', '{ "model": ']]) {
    const dir = freshDir('jq-refuses');
    const home = path.join(dir, 'home');
    const file = path.join(home, '.claude', 'settings.json');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
    const policy = path.join(dir, 'p.json');
    fs.writeFileSync(policy, JSON.stringify({ version: 1, 'claude-code': { model: 'claude-x' } }));
    let out = '';
    const code = run(['--mode=install', '--policy=' + policy, '--home=' + home], { env: { HOME: home }, out: (t) => { out += t; }, err: () => {} });
    assert.equal(code, 3, label);
    // The path is printed as the platform prints it (str(Path) on Windows), so only its tail is compared.
    assert.match(out, /^REFUSE {2}.*settings\.json: not readable as its format; model defaults left untouched$/m, label + ': ' + out);
    assert.equal(fs.readFileSync(file, 'utf8'), text, label);
    assert.deepEqual(fs.readdirSync(path.dirname(file)).sort(), ['settings.json'], label);
  }
});

test('a record entry that is not an object crashes as the original did (exit 1), never silently', () => {
  const dir = freshDir('badrec');
  const home = path.join(dir, 'home');
  const rec = path.join(home, RECORD);
  fs.mkdirSync(path.dirname(rec), { recursive: true });
  fs.writeFileSync(rec, JSON.stringify({ 'managed-by': 'managed-by: personal-multi-harness-workstation-configuration', set: { [path.join(home, '.claude', 'settings.json')]: 'x', other: [1] } }));
  assert.throws(() => run(['--mode=check', '--home=' + home], { env: { HOME: home }, out: () => {} }), TypeError);
  fs.writeFileSync(rec, JSON.stringify({ 'managed-by': 'managed-by: personal-multi-harness-workstation-configuration', set: { '/elsewhere': { harness: ['codex'], keys: { a: 'b' } } } }));
  assert.throws(() => run(['--mode=check', '--home=' + home], { env: { HOME: home }, out: () => {} }), /unhashable/);
});

test('the repository overlay policy is valid', () => {
  const dir = freshDir('overlay');
  const home = path.join(dir, 'home');
  fs.mkdirSync(home);
  let out = '';
  const code = run(['--mode=dry-run', '--policy=' + path.join(ROOT, 'overlay', 'model-defaults.json'), '--home=' + home],
    { env: { HOME: home }, out: (x) => { out += x; } });
  assert.equal(code, 0, out);
  assert.equal(out.split('WOULD CHANGE').length - 1, 3);
  assert.deepEqual(fs.readdirSync(home), []);
});

test('on Windows a written file has \\r\\n line ends, as Python\'s text mode wrote it', { skip: POSIX && 'Windows only' }, () => {
  const dir = freshDir('crlf');
  const home = path.join(dir, 'home');
  fs.mkdirSync(path.join(home, '.codex'), { recursive: true });
  fs.writeFileSync(path.join(home, '.codex', 'config.toml'), '# c\nmodel = "x"\n');
  const policy = path.join(dir, 'p.json');
  fs.writeFileSync(policy, JSON.stringify({ version: 1, codex: { model: 'gpt-y' } }));
  assert.equal(run(['--mode=install', '--policy=' + policy, '--home=' + home], { env: { USERPROFILE: home, SystemRoot: process.env.SystemRoot }, out: () => {} }), 0);
  assert.equal(fs.readFileSync(path.join(home, '.codex', 'config.toml'), 'utf8'), '# c\r\nmodel = "gpt-y"\r\n');
});

// ── The TOML parse guard against tomllib (PR #515 QA, B1) ──────────────────────────────────────────

/** @type {{ cpython: string, rows: Array<{ name: string, text: string, tomllib: 'accept' | 'refuse' }> }} */
const guardTable = readGolden(SLICE, 'toml-guard.json');

test('the parse guard accepts or refuses each document as tomllib did (recorded, one row per form)', () => {
  const names = new Set(guardTable.rows.map((r) => r.name));
  assert.equal(names.size, guardTable.rows.length, 'row names are unique');
  const off = guardTable.rows
    .map((r) => ({ name: r.name, tomllib: r.tomllib, guard: tomlInvalid(r.text) === null ? 'accept' : 'refuse' }))
    .filter((r) => r.tomllib !== r.guard);
  assert.deepEqual(off, []);
  // The table holds both answers for each form the guard adds to smol-toml, so a bump that moves one is red.
  for (const name of ['int-i64-max', 'inline-table-newline', 'inline-table-trailing-comma', 'escape-e', 'escape-x',
    'time-without-seconds', 'date-feb-30', 'bom-second-line', 'date-like-bare-key', 'escape-x-in-literal']) {
    assert.ok(names.has(name), 'the table pins ' + name);
  }
});

test('the guard keeps integers past 2^53 and reports the first line of a smol-toml refusal', () => {
  assert.equal(tomlInvalid('n = 9223372036854775807\n'), null);
  assert.match(String(tomlInvalid('a = 1\na = 2\n')), /^Invalid TOML document: [^\n]+$/);
  assert.equal(tomlInvalid('t = 07:32\n'), 'Invalid TOML 1.0 document: a time without seconds');
});

// ── The Python semantics, unit by unit ──────────────────────────────────────────────────────────────

test('utf8Error reports what CPython\'s utf-8 codec reports', () => {
  const at = (/** @type {string} */ hex) => utf8Error(Buffer.from(hex, 'hex'));
  assert.equal(at('616263c3a9'), null);
  assert.deepEqual(at('61ff'), { start: 1, end: 2, reason: 'invalid start byte' });
  assert.deepEqual(at('c0af'), { start: 0, end: 1, reason: 'invalid start byte' });
  assert.deepEqual(at('c328'), { start: 0, end: 1, reason: 'invalid continuation byte' });
  assert.deepEqual(at('e28228'), { start: 0, end: 2, reason: 'invalid continuation byte' });
  assert.deepEqual(at('f09f9828'), { start: 0, end: 3, reason: 'invalid continuation byte' });
  assert.deepEqual(at('e282'), { start: 0, end: 2, reason: 'unexpected end of data' });
  assert.deepEqual(at('c3'), { start: 0, end: 1, reason: 'unexpected end of data' });
  assert.deepEqual(at('e080af'), { start: 0, end: 1, reason: 'invalid continuation byte' });
  assert.deepEqual(at('eda080'), { start: 0, end: 1, reason: 'invalid continuation byte' });
  assert.deepEqual(at('f08f8080'), { start: 0, end: 1, reason: 'invalid continuation byte' });
  assert.deepEqual(at('f4908080'), { start: 0, end: 1, reason: 'invalid continuation byte' });
  assert.deepEqual(at('f5'), { start: 0, end: 1, reason: 'invalid start byte' });
  assert.equal(at('ed9fbf'), null);
  assert.equal(at('f48fbfbf'), null);
});

test('readText keeps a byte-order mark and reads \\r\\n and \\r as \\n', () => {
  const dir = freshDir('read');
  const f = path.join(dir, 'x');
  fs.writeFileSync(f, '\ufeffa\r\nb\rc\n');
  assert.equal(readText(f), '\ufeffa\nb\nc\n');
});

test('splitLines splits as str.splitlines() does', () => {
  assert.deepEqual(splitLines(''), []);
  assert.deepEqual(splitLines('a\n'), ['a']);
  assert.deepEqual(splitLines('a\n\n'), ['a', '']);
  assert.deepEqual(splitLines('a'), ['a']);
  assert.deepEqual(splitLines('a\r\nb\rc'), ['a', 'b', 'c']);
  assert.deepEqual(splitLines('a\fb\vc\x1cd\x1de\x1ef\x85g\u2028h\u2029i\x1fj'), ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i\x1fj']);
});

test('pyPath prints a path as str(Path(...)) does', () => {
  assert.equal(pyPath('/a//b/./c/', 'linux'), '/a/b/c');
  assert.equal(pyPath('//a', 'linux'), '//a');
  assert.equal(pyPath('///a', 'linux'), '/a');
  assert.equal(pyPath('', 'linux'), '.');
  assert.equal(pyPath('./x', 'linux'), 'x');
  assert.equal(pyPath('a/../b', 'linux'), 'a/../b');
  assert.equal(pyPath('C:/Users//me/', 'win32'), 'C:\\Users\\me');
  assert.equal(pyPath('\\\\srv\\share\\x', 'win32'), '\\\\srv\\share\\x');
  assert.equal(pyPath('rel\\.\\x', 'win32'), 'rel\\x');
  assert.equal(pyPath('', 'win32'), '.');
});

test('pyErrorClass names the OSError subclass Python raises', () => {
  const e = (/** @type {string} */ code) => Object.assign(new Error(code), { code });
  assert.equal(pyErrorClass(e('EPERM')), 'PermissionError');
  assert.equal(pyErrorClass(e('EACCES')), 'PermissionError');
  assert.equal(pyErrorClass(e('EISDIR')), 'IsADirectoryError');
  assert.equal(pyErrorClass(e('ENOTDIR')), 'NotADirectoryError');
  assert.equal(pyErrorClass(e('EEXIST')), 'FileExistsError');
  assert.equal(pyErrorClass(e('ENOENT')), 'FileNotFoundError');
  assert.equal(pyErrorClass(e('ENOSPC')), 'OSError');
  assert.equal(pyErrorClass(new Error('icacls exited 5')), 'OSError');
});

test('the TOML line reader: key spellings and the values it can read', () => {
  assert.ok(isKeyLine('model = "x"', 'model'));
  assert.ok(isKeyLine('  "model"= "x"', 'model'));
  assert.ok(isKeyLine("\u00a0'model'\t=x", 'model'));
  assert.ok(!isKeyLine('model_reasoning_effort = "x"', 'model'));
  assert.ok(!isKeyLine('# model = "x"', 'model'));
  assert.ok(!isKeyLine('\ufeffmodel = "x"', 'model'));
  assert.ok(!isKeyLine('model', 'model'));
  assert.equal(tomlValue('model = "x" # c'), 'x');
  assert.equal(tomlValue("model='x'"), 'x');
  assert.equal(tomlValue("'model' = 'a\\b'"), 'a\\b');
  assert.equal(tomlValue('"m.k" = ""'), '');
  assert.equal(tomlValue('model = "a\\"b"'), UNREADABLE);
  assert.equal(tomlValue('model = 5'), UNREADABLE);
  assert.equal(tomlValue('model = "x" y'), UNREADABLE);
  assert.equal(tomlValue('model = "x'), UNREADABLE);
  assert.equal(tomlValue('model "x"'), UNREADABLE);
  assert.equal(tomlValue('= "x"'), UNREADABLE);
  assert.equal(tomlValue('"mo\\del" = "x"'), UNREADABLE);
  assert.equal(tomlValue('"model = "x"'), UNREADABLE);
});

test('loadPolicy: version equals 1 as Python compares it, and a missing file names its errno', () => {
  const dir = freshDir('policy');
  const f = path.join(dir, 'p.json');
  for (const v of ['1', '1.0', 'true']) {
    fs.writeFileSync(f, '{"version": ' + v + '}');
    assert.deepEqual(loadPolicy(f, process.platform), {});
  }
  for (const v of ['0', '"1"', 'null', '2.5']) {
    fs.writeFileSync(f, '{"version": ' + v + '}');
    assert.throws(() => loadPolicy(f, process.platform), PolicyError);
  }
  assert.throws(() => loadPolicy(path.join(dir, 'none.json'), process.platform), /\[Errno 2\] No such file or directory: '/);
});
