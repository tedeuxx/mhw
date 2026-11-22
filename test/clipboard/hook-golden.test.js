// Parity of the prompt hook and add-term (#488, S17 of #470; convention 3): the Node port against the
// answers the Python original (global/clipboard/clipboard_guard.py, deleted in this slice) gave on the same
// cases. test/golden/S17/answers.json is the binding oracle: every decision on every agent harness (stdout,
// stderr, exit code), the command line as a process, check-config, add-term's pure half with the files it
// wrote, and the constants and notices. The golden is frozen: the live arm and its recorder
// (test/helpers/s17-record.py) were deleted by #502 (S32 of #470, one Node runtime).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { spawnSync } from 'node:child_process';
import * as core from '../../src/lib/clean.js';
import * as hook from '../../src/commands/hook-prompt.js';
import * as addTerm from '../../src/commands/add-term.js';
import { addTermHashes } from '../../src/lib/salt.js';
import { KIRO_HOOK_FILE } from '../../src/commands/paste-wrapper.js';
import { readGolden, UPDATE } from '../helpers/golden.js';
import { ROOT } from '../helpers/s15.js';
import { SALT, decisionCases, cliCases, addTermCases } from '../helpers/s17.js';

const POSIX = process.platform !== 'win32';
const MHW = path.join(ROOT, 'bin', 'mhw.js');
const CASES = { salt: SALT, decision: decisionCases(), cli: cliCases(), add_term: addTermCases() };
/** @type {Array<() => void>} */
const cleanups = [];
after(() => cleanups.forEach((f) => f()));

function fresh() {
  const dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'mhw-s17-')));
  cleanups.push(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** @param {string} v */
const expand = (v) => (v === 'CATEGORIES-EXCEPT-phone-health' ? core.CATEGORY_ORDER.filter((c) => c !== 'phone' && c !== 'health').join(',') : v);

/** The recorder's conf_dir. @param {string} work @param {string} name @param {Record<string, string>} over */
function confDir(work, name, over) {
  const d = path.join(work, name.replaceAll('/', '_'));
  fs.mkdirSync(path.join(d, 'lo'), { recursive: true });
  const lines = ['salt_store=file', 'terms_file=' + path.join(d, 'lo', 'terms'), 'salt_file=' + path.join(d, 'lo', 'salt'),
    'health_terms_file=' + path.join(d, 'lo', 'terms-health'), 'colleague_terms_file=' + path.join(d, 'lo', 'terms-colleague'),
    ...Object.entries(over).map(([k, v]) => k + '=' + expand(v))];
  const p = path.join(d, 'clipboard.conf');
  fs.writeFileSync(p, lines.join('\n') + '\n');
  return { d, p };
}

/** @param {string[]} terms */
const hashes = (terms) => terms.flatMap((t) => core.termForms(t).map((f) => core.termHash(SALT, f)));

/** @param {string} d */
function procEnv(d) {
  const home = path.join(d, 'home');
  fs.mkdirSync(home, { recursive: true });
  return { HOME: home, USERPROFILE: home, PATH: '/usr/bin:/bin', LC_ALL: 'C' }; // USERPROFILE: Windows' home
}

/** @param {string} work @param {string} s */
// Windows: the Python original never ran there; its paths are compared with / as separator.
const norm = (work, s) => (POSIX ? s.replaceAll(work, '<T>') : s.replaceAll(work, '<T>').replaceAll('\\', '/'));

/** The Node answers, in the recorder's shape. */
async function nodeAnswers() {
  const work = fresh();
  const decision = [];
  for (const c of CASES.decision) {
    const { p } = confDir(work, 'd-' + c.name, c.conf || {});
    const conf = hook.loadConfig(p);
    const lists = c.lists || {};
    for (const [key, file] of /** @type {Array<[keyof typeof lists, string]>} */ ([['employer', conf.terms_file], ['health', conf.health_terms_file], ['colleague', conf.colleague_terms_file]])) {
      if (lists[key]?.length) addTermHashes(file, hashes(/** @type {string[]} */ (lists[key])));
    }
    for (const [key, data] of Object.entries(c.raw || {})) {
      fs.mkdirSync(path.dirname(conf[key]), { recursive: true });
      fs.appendFileSync(conf[key], Buffer.from(data, 'hex'));
    }
    const env = c.marker == null ? {} : { [hook.WRAPPER_MARKER]: c.marker };
    const raw = Buffer.from(c.payload, 'hex');
    const salts = c.fileSalt ? undefined : { get: () => c.salt ?? null };
    const r = await hook.run(['--harness', c.harness, '--config', p], env, { stdin: Readable.from(raw.length ? [raw] : []), salts });
    decision.push({ name: c.name, stdout: r.stdout, stderr: r.stderr, code: r.code });
  }
  const cli = POSIX ? CASES.cli.map((c) => {
    const d = path.join(work, 'c-' + c.name.replaceAll('/', '_'));
    fs.mkdirSync(path.join(d, 'lo'), { recursive: true });
    const args = [...c.args];
    if (c.configPath === 'dir') args.push('--config', d);
    else if (c.configPath === 'missing') args.push('--config', path.join(d, 'no-such.conf'));
    else if (c.conf) {
      const p = path.join(d, 'clipboard.conf');
      const text = Buffer.from((c.conf.map((l) => l.replaceAll('DIR', d)).join('\n') + '\n'), 'utf8');
      const at = text.indexOf('BADBYTE');
      fs.writeFileSync(p, at < 0 ? text : Buffer.concat([text.subarray(0, at), Buffer.from([0xff]), text.subarray(at + 7)]));
      args.push('--config', p);
    }
    const r = spawnSync(process.execPath, [MHW, 'hook', 'prompt', ...args], { input: Buffer.from(c.stdin, 'hex'), env: procEnv(d), timeout: 60000 });
    return { name: c.name, stdout: norm(work, r.stdout.toString('utf8')), stderr: norm(work, r.stderr.toString('utf8')), code: r.status };
  }) : null;
  const checkConfig = [];
  {
    const { d, p } = confDir(work, 'check-config', { block_categories: 'credential,email', show_cleaned_chars: '77' });
    addTermHashes(hook.loadConfig(p).terms_file, hashes(['Zyxw Quillon']));
    for (const [name, extra] of /** @type {Array<[string, string[]]>} */ ([['file', ['--config', p]], ['missing', ['--config', path.join(d, 'none.conf')]], ['unknown-flag', ['--config']]])) {
      const r = hook.checkConfig(extra, procEnv(d));
      checkConfig.push({ name, stdout: norm(work, r.stdout), stderr: norm(work, r.stderr), code: r.code });
    }
  }
  const { p: addConf } = confDir(work, 'add-term', {});
  const conf = hook.loadConfig(addConf);
  fs.mkdirSync(path.dirname(conf.salt_file), { recursive: true });
  fs.writeFileSync(conf.salt_file, SALT + '\n');
  const addAnswers = CASES.add_term.map((c) => {
    const r = addTerm.addEntered(conf, c.first, c.second, c.list);
    return { name: c.name, out: norm(work, r.out), code: r.code };
  });
  /** @type {Record<string, string>} */
  const files = {};
  for (const key of ['terms_file', 'health_terms_file', 'colleague_terms_file']) {
    files[key] = fs.readFileSync(conf[key], 'ascii');
    files[key + '_mode'] = '0o' + (fs.statSync(conf[key]).mode & 0o777).toString(8);
  }
  files.dir_mode = '0o' + (fs.statSync(path.dirname(conf.terms_file)).mode & 0o777).toString(8);
  if (!POSIX) for (const k of Object.keys(files)) if (k.endsWith('_mode')) delete files[k]; // no POSIX modes there
  const constants = {
    WRAPPER_MARKER: hook.WRAPPER_MARKER, WRAPPER_MARKER_VALUE: hook.WRAPPER_MARKER_VALUE, HARNESSES: [...hook.HARNESSES],
    AGENT_MARKERS: [...addTerm.AGENT_MARKERS], KIRO_HOOK_FILE,
    notices: Object.fromEntries(Object.entries(hook.DEFAULTS).filter(([k]) => k.startsWith('notice_')).sort((a, b) => (a[0] < b[0] ? -1 : Number(a[0] > b[0])))),
    settings: Object.fromEntries(Object.entries(hook.DEFAULTS).filter(([k]) => !k.startsWith('notice_')).sort((a, b) => (a[0] < b[0] ? -1 : Number(a[0] > b[0])))),
  };
  return { decision, cli, check_config: checkConfig, add_term: addAnswers, add_term_files: files, constants };
}

/** JSON with object keys sorted. @param {any} v @returns {string} */
function canon(v) {
  if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
  if (v && typeof v === 'object') return '{' + Object.keys(v).sort((a, b) => (a < b ? -1 : Number(a > b))).map((k) => JSON.stringify(k) + ':' + canon(v[k])).join(',') + '}';
  return JSON.stringify(v);
}

const EXPECTED = readGolden('S17', 'expected-differences.json').differences;

/**
 * The Python original's answer with every declared difference applied: what the head must answer.
 * @param {any} want all the original's answers
 * @param {string} section
 * @param {any} w one answer of that section
 */
function expectedOf(want, section, w) {
  let e = { ...w };
  for (const d of EXPECTED) {
    if (d.section !== section || !d.cases.includes(w.name)) continue;
    if (d.answer) {
      const twin = want[section].find((/** @type {any} */ a) => a.name === 'dirty/' + w.name.split('/')[1]);
      e = { ...twin, name: w.name };
    }
    for (const k of ['stdout', 'stderr', 'out']) {
      if (typeof e[k] !== 'string') continue;
      if (d.drop_lines) e[k] = e[k].split('\n').filter((/** @type {string} */ l) => !d.drop_lines.some((/** @type {string} */ p) => l.startsWith(p))).join('\n');
      if (d.replace) e[k] = e[k].replaceAll(d.replace.base, d.replace.head);
    }
  }
  return e;
}

/** The recorded constants with the declared patches applied. @param {any} c */
function expectedConstants(c) {
  const e = structuredClone(c);
  for (const d of EXPECTED) {
    if (d.section !== 'constants') continue;
    for (const p of d.constants.delete) {
      const [a, b] = p.split('.');
      if (b) delete e[a][b];
      else delete e[a];
    }
    for (const [p, v] of Object.entries(d.constants.set)) {
      const [a, b] = p.split('.');
      e[a][b] = v;
    }
  }
  return e;
}

/**
 * Where the two answer sets differ, minus the declared differences.
 * @param {any} want the Python original's answers
 * @param {any} got Node's
 * @returns {string[]}
 */
function diff(want, got) {
  /** @type {string[]} */
  const out = [];
  for (const section of ['decision', 'cli', 'check_config', 'add_term']) {
    if (got[section] === null) continue; // the process cases are POSIX only
    const byName = new Map(got[section].map((/** @type {any} */ a) => [a.name, a]));
    if (want[section].length !== got[section].length) out.push(section + ': case count');
    for (const w of want[section]) {
      const g = byName.get(w.name);
      const e = expectedOf(want, section, w);
      if (canon(e) !== canon(g)) out.push(section + ' ' + w.name + '\n  expected ' + canon(e) + '\n  node     ' + canon(g));
    }
  }
  const wantFiles = POSIX ? want.add_term_files : Object.fromEntries(Object.entries(want.add_term_files).filter(([k]) => !k.endsWith('_mode')));
  if (canon(wantFiles) !== canon(got.add_term_files)) out.push('add_term_files\n  python ' + canon(wantFiles) + '\n  node   ' + canon(got.add_term_files));
  const ec = expectedConstants(want.constants);
  if (canon(ec) !== canon(got.constants)) out.push('constants\n  expected ' + canon(ec) + '\n  node     ' + canon(got.constants));
  return out;
}

test('every declared difference names its section, its cases, why, and what changes', () => {
  for (const d of EXPECTED) {
    assert.ok(['decision', 'cli', 'check_config', 'add_term', 'constants', 'scan'].includes(d.section), d.what);
    assert.ok(d.cases.length && d.why && d.what && (d.replace || d.answer || d.constants || d.drop_lines), d.what);
  }
});

test('the Node hook, check-config and add-term give the answers the Python original recorded', { skip: UPDATE && 'MHW_UPDATE_GOLDEN=1' }, async () => {
  const golden = readGolden('S17', 'answers.json');
  assert.equal(golden.decision.length, CASES.decision.length, 'the cases changed: re-record the golden from the base revision');
  assert.deepEqual(diff(golden, await nodeAnswers()), []);
});

test('the golden holds a block, a silent pass, a visible warning and an exit 2 for each harness', () => {
  const golden = readGolden('S17', 'answers.json');
  for (const h of hook.HARNESSES) {
    const mine = golden.decision.filter((/** @type {any} */ a) => a.name.endsWith('/' + h));
    if (h === 'kiro') {
      assert.ok(mine.some((/** @type {any} */ a) => a.code === 2 && a.stderr.includes('It was NOT sent') && a.stdout === ''), h);
      assert.ok(mine.every((/** @type {any} */ a) => a.stdout === ''), 'kiro never writes stdout');
    } else {
      assert.ok(mine.some((/** @type {any} */ a) => a.stdout.includes('"decision": "block"')), h);
      assert.ok(mine.some((/** @type {any} */ a) => a.stdout.includes('"systemMessage"') && a.stdout.includes('NOT checked')), h);
      assert.ok(mine.every((/** @type {any} */ a) => a.code === 0 && a.stderr === ''), h);
    }
    assert.ok(mine.some((/** @type {any} */ a) => a.stdout === '' && a.stderr === '' && a.code === 0), h + ' silent pass');
  }
});
