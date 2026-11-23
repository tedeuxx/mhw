// Parity of the paste wrapper (#487, S16 of #470; convention 3): the Node port against the answers the
// Python original (global/clipboard/paste_wrapper.py, deleted in this slice) gave on the same cases.
// test/golden/S16/answers.json is the binding oracle: the state machine (every split, hold, limit and
// cleaner case), the notices, the argument rule and the constants. The golden is frozen: the live arm and
// its recorder (test/helpers/s16-record.py) were deleted by #502 (S32 of #470, one Node runtime).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as core from '../../src/lib/clean.js';
import * as w from '../../src/commands/paste-wrapper.js';
import { readGolden } from '../helpers/golden.js';
import { SALT, TERM, filterCases, noticeCases, argCases } from '../helpers/s16.js';

const WRAPPER_NOTICE_KEYS = Object.keys(core.DEFAULTS).filter((k) => k.startsWith('notice_')).sort();
const CASES = { salt: SALT, term: TERM, filter: filterCases(), notice: noticeCases(), args: argCases(), wrapper_notice_keys: WRAPPER_NOTICE_KEYS };
/** @type {Array<() => void>} */
const cleanups = [];
after(() => cleanups.forEach((f) => f()));

function fresh() {
  const dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'mhw-s16-')));
  cleanups.push(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** A clipboard.conf in a throwaway directory, as the recorder writes it. @param {string} dir @param {Record<string, string>} over */
function confIn(dir, over) {
  fs.mkdirSync(path.join(dir, 'lo'), { recursive: true });
  const lines = ['salt_store=file', 'terms_file=' + path.join(dir, 'lo', 'terms'), 'salt_file=' + path.join(dir, 'lo', 'salt'),
    'health_terms_file=' + path.join(dir, 'lo', 'terms-health'), 'colleague_terms_file=' + path.join(dir, 'lo', 'terms-colleague')];
  for (const [k, v] of Object.entries(over)) {
    lines.push(k + '=' + (v === 'CATEGORIES-EXCEPT-phone' ? core.CATEGORY_ORDER.filter((c) => c !== 'phone').join(',') : v));
  }
  fs.writeFileSync(path.join(dir, 'clipboard.conf'), lines.join('\n') + '\n');
  return core.loadConfig(path.join(dir, 'clipboard.conf'));
}

/** @returns {never} */
function boom() {
  throw new Error('synthetic');
}

/** The Node answers, in the recorder's shape. */
function nodeAnswers() {
  const work = fresh();
  const filter = CASES.filter.map((c, i) => {
    const conf = confIn(path.join(work, 'f' + i), c.conf || {});
    let terms = new Set();
    let salt = null;
    if (c.cleaner === 'term') {
      terms = new Set(core.termForms(TERM).map((f) => core.termHash(SALT, f)));
      salt = SALT;
    }
    const clean = w.makeCleaner(conf, terms, salt);
    let now = 0;
    const f = new w.PasteFilter(c.cleaner === 'boom' ? boom : clean, c.max_bytes, { too_large: '[TOO LARGE]', error: '[ERR {error}]' }, () => now);
    /** @type {string[]} */
    const out = [];
    for (const op of c.ops) {
      if (op[0] === 'feed') out.push(f.feed(Buffer.from(op[1], 'hex')).toString('hex'));
      else if (op[0] === 'advance') now += op[1];
      else out.push(f.flush().toString('hex'));
    }
    return { name: c.name, out, cleaned: f.cleaned, replaced: f.replaced, categories: core.CATEGORY_ORDER.filter((x) => f.categories.has(x)),
      in_paste: f.inPaste, reported_pastes: clean.reportedPastes, reported: [...clean.reported].sort() };
  });
  const notice = CASES.notice.map((c, i) => w.notice(confIn(path.join(work, 'n' + i), c.conf || {}), c.key, c.values));
  const args = CASES.args.map((c, i) => {
    const conf = confIn(path.join(work, 'a' + i), {});
    const clean = c.boom ? boom : w.makeCleaner(conf, new Set(), null);
    return w.argsAllowMarker(clean, c.args.map((a) => Buffer.from(a, 'hex').toString('utf8')), c.no_salt);
  });
  const constants = {
    HOLD_SECONDS: w.HOLD_SECONDS, HOLD_SEQUENCE_SECONDS: w.HOLD_SEQUENCE_SECONDS, PASTE_IDLE_SECONDS: w.PASTE_IDLE_SECONDS,
    GRACE_SECONDS: w.GRACE_SECONDS, EXIT_DRAIN_SECONDS: w.EXIT_DRAIN_SECONDS, WRAPPER_MARKER: w.WRAPPER_MARKER,
    WRAPPER_MARKER_VALUE: w.WRAPPER_MARKER_VALUE, KIRO_HOOK_FILE: w.KIRO_HOOK_FILE,
    notices: Object.fromEntries(WRAPPER_NOTICE_KEYS.map((k) => [k, core.DEFAULTS[k]])),
  };
  return { filter, notice, args, constants };
}

/** JSON with object keys sorted, so key order never counts. @param {any} v @returns {string} */
function canon(v) {
  if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
  if (v && typeof v === 'object') return '{' + Object.keys(v).sort((a, b) => (a < b ? -1 : Number(a > b))).map((k) => JSON.stringify(k) + ':' + canon(v[k])).join(',') + '}';
  return JSON.stringify(v);
}

const EXPECTED = readGolden('S16', 'expected-differences.json').filter((/** @type {any} */ d) => d.stream.includes('filter'));

/**
 * A head output with each declared difference of its case put back to the base's form (hex in, hex out).
 * @param {string} name @param {string} h
 */
function expected(name, h) {
  let s = Buffer.from(h, 'hex').toString('latin1');
  for (const d of EXPECTED) if (d.case.includes(name)) s = s.replaceAll(d.head, d.base);
  return Buffer.from(s, 'latin1').toString('hex');
}

/** @param {any} golden @param {any} node @returns {string[]} */
function diff(golden, node) {
  /** @type {string[]} */
  const out = [];
  golden.filter.forEach((/** @type {any} */ g, /** @type {number} */ i) => {
    const head = { ...node.filter[i], out: node.filter[i].out.map((/** @type {string} */ h) => expected(g.name, h)) };
    if (canon(g) !== canon(head)) out.push('filter ' + g.name + '\n' + canon(g) + '\n--- node\n' + canon(node.filter[i]));
  });
  if (golden.filter.length !== node.filter.length) out.push('filter case count');
  for (const k of ['notice', 'args', 'constants']) {
    if (canon(golden[k]) !== canon(node[k])) out.push(k + '\n' + canon(golden[k]) + '\n--- node\n' + canon(node[k]));
  }
  return out;
}

test('the Node paste filter, notices and argument rule give the answers the Python original recorded', () => {
  const golden = readGolden('S16', 'answers.json');
  assert.equal(golden.filter.length, CASES.filter.length, 'the cases changed: re-record the golden from the base revision');
  assert.deepEqual(diff(golden, nodeAnswers()), []);
});
