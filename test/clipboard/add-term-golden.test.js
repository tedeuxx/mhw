// Parity of add-term (#488, S17 of #470; convention 3): the Node port against the answers the Python
// original (global/clipboard/clipboard_guard.py, deleted by #488) gave on the same cases.
// test/golden/S17/answers.json is the binding oracle. Until #600 this file was hook-golden.test.js and also
// played the prompt hook's decisions, its command line and check-config against the same golden; #600
// removed `mhw hook prompt` and `mhw hook check-config` (CLI native baseline PRD, section 5), so only
// add-term's pure half, the files it wrote, and its own constant are played now. The golden's other sections
// are kept as recorded, unread. Its live arm retired with #488's merge: the base revision no longer holds
// clipboard_guard.py.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as addTerm from '../../src/commands/add-term.js';
import { readGolden } from '../helpers/golden.js';
import { SALT, addTermCases } from '../helpers/s17.js';

const POSIX = process.platform !== 'win32';
const CASES = addTermCases();
/** @type {Array<() => void>} */
const cleanups = [];
after(() => cleanups.forEach((f) => f()));

function fresh() {
  const dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'mhw-s17a-')));
  cleanups.push(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** The recorder's conf_dir. @param {string} work @param {string} name */
function confDir(work, name) {
  const d = path.join(work, name);
  fs.mkdirSync(path.join(d, 'lo'), { recursive: true });
  const lines = ['salt_store=file', 'terms_file=' + path.join(d, 'lo', 'terms'), 'salt_file=' + path.join(d, 'lo', 'salt'),
    'health_terms_file=' + path.join(d, 'lo', 'terms-health'), 'colleague_terms_file=' + path.join(d, 'lo', 'terms-colleague')];
  const p = path.join(d, 'clipboard.conf');
  fs.writeFileSync(p, lines.join('\n') + '\n');
  return p;
}

/** @param {string} work @param {string} s */
// Windows: the Python original never ran there; its paths are compared with / as separator.
const norm = (work, s) => (POSIX ? s.replaceAll(work, '<T>') : s.replaceAll(work, '<T>').replaceAll('\\', '/'));

/** JSON with object keys sorted. @param {any} v @returns {string} */
function canon(v) {
  if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
  if (v && typeof v === 'object') return '{' + Object.keys(v).sort((a, b) => (a < b ? -1 : Number(a > b))).map((k) => JSON.stringify(k) + ':' + canon(v[k])).join(',') + '}';
  return JSON.stringify(v);
}

const EXPECTED = readGolden('S17', 'expected-differences.json').differences;

/** The original's add-term answer with every declared difference of its section applied. @param {any} w */
function expectedOf(w) {
  const e = { ...w };
  for (const d of EXPECTED) {
    if (d.section !== 'add_term' || !d.cases.includes(w.name)) continue;
    if (typeof e.out === 'string' && d.drop_lines) e.out = e.out.split('\n').filter((/** @type {string} */ l) => !d.drop_lines.some((/** @type {string} */ p) => l.startsWith(p))).join('\n');
    if (typeof e.out === 'string' && d.replace) e.out = e.out.replaceAll(d.replace.base, d.replace.head);
  }
  return e;
}

test('add-term gives the answers the Python original recorded, and writes the same files', () => {
  const golden = readGolden('S17', 'answers.json');
  const work = fresh();
  const conf = addTerm.loadConfig(confDir(work, 'add-term'));
  fs.mkdirSync(path.dirname(conf.salt_file), { recursive: true });
  fs.writeFileSync(conf.salt_file, SALT + '\n');
  assert.equal(golden.add_term.length, CASES.length, 'the cases changed');
  const byName = new Map(golden.add_term.map((/** @type {any} */ a) => [a.name, a]));
  for (const c of CASES) {
    const r = addTerm.addEntered(conf, c.first, c.second, c.list);
    assert.equal(canon({ name: c.name, out: norm(work, r.out), code: r.code }), canon(expectedOf(byName.get(c.name))), c.name);
  }
  /** @type {Record<string, string>} */
  const files = {};
  for (const key of ['terms_file', 'health_terms_file', 'colleague_terms_file']) {
    files[key] = fs.readFileSync(conf[key], 'ascii');
    files[key + '_mode'] = '0o' + (fs.statSync(conf[key]).mode & 0o777).toString(8);
  }
  files.dir_mode = '0o' + (fs.statSync(path.dirname(conf.terms_file)).mode & 0o777).toString(8);
  const want = POSIX ? golden.add_term_files : Object.fromEntries(Object.entries(golden.add_term_files).filter(([k]) => !k.endsWith('_mode')));
  if (!POSIX) for (const k of Object.keys(files)) if (k.endsWith('_mode')) delete files[k];
  assert.equal(canon(files), canon(want));
  assert.deepEqual([...addTerm.AGENT_MARKERS], golden.constants.AGENT_MARKERS);
});
