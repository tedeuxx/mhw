// Which layer carries the deny floor (ADR-0016, 2026-10-05 amendment): the FLOOR lines install.sh prints at
// the end of every run. The Node form of its report_floor (#491, S20 of #470), whose counts were jq programs.
// A report, never a status change: the admin copy is the owner's sudo act (install-managed.sh), and its drift
// is install-managed.sh --check's to report.
//
//   node src/render/floor-report.js --settings=FILE --floor-claude=FILE --floor-codex=FILE --floor=FILE
//        --stamp=STAMP --codex-rules=FILE [--floor-from=TEXT] [--managed-root=DIR] [--cmd=TEXT]
//
// The Kiro lines are src/render/kiro-permissions.js --mode=report, run in this process between the Codex
// line and the carrier line, as install.sh's kiro_step ran it; the exit code is its exit code. node: modules only.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { isManaged } from '../lib/marker.js';
import { codepointCompare } from '../lib/jq-json.js';
import { readSettings } from './settings-merge.js';
import { shellCount, codexAdminWords, records } from './allow-list.js';
import { main as kiroMain } from './kiro-permissions.js';

/** @typedef {import('../lib/jq-json.js').JqValue} JqValue */

const PROG = 'floor-report.js';
const ADMIN_FILE = '50-personal-multi-harness-workstation-configuration.json';

/** @param {string} file */
function isFile(file) {
  try {
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
}

/**
 * report_floor's count of the floor rules a Claude Code settings file denies:
 * `[(.permissions.deny? // [])[] | select(. as $r | $f | index($r))] | unique | length`. The file is read
 * with the merge's own reader: what is not strict JSON (NaN, a byte-order mark, several documents, nesting
 * past 256) counts 0 and is named, so the report never credits a file the merge refused (PR #539 lens F2).
 * @param {string} file @param {string[]} want the floor rules as jq's unique left them (sorted by code point)
 * @returns {{ n: number, note: string }}
 */
export function denied(file, want) {
  if (!isFile(file)) return { n: 0, note: '' };
  const r = readSettings(file);
  if (r.kind === 'jq-only') return { n: 0, note: ' (not read: not strict JSON)' };
  if (r.kind !== 'object') return { n: 0, note: '' };
  return { n: deniedIn(r.value, want), note: '' };
}

/** The count over a read object. @param {Map<string, JqValue>} v @param {string[]} want */
function deniedIn(v, want) {
  const perms = v.get('permissions') ?? null;
  let deny = perms instanceof Map ? (perms.get('deny') ?? null) : null;
  if (deny === null || deny === false) deny = [];
  if (deny instanceof Map) deny = [...deny.values()];
  if (!Array.isArray(deny)) return 0;
  return shellCount(want, deny);
}

/** The text of a file, or '' when it cannot be read. @param {string} file */
function textOf(file) {
  try {
    return fs.readFileSync(file, 'latin1');
  } catch {
    return '';
  }
}

/**
 * The FLOOR lines. Returns the exit code of the Kiro report.
 * @param {Record<string, string>} o
 * @param {{ out: (s: string) => void, err: (s: string) => void, platform: string, env?: Record<string, string | undefined> }} io
 *   env: the environment the Kiro report reads its HOME from (default: this process's)
 */
export function report(o, io) {
  const root = o['--managed-root'] || '';
  const darwin = io.platform === 'darwin';
  // install.sh's paths, by plain concatenation onto --managed-root (empty: the real admin layer under /).
  const mClaude = darwin
    ? root + '/Library/Application Support/ClaudeCode/managed-settings.d/' + ADMIN_FILE
    : root + '/etc/claude-code/managed-settings.d/' + ADMIN_FILE;
  const mCodex = root + '/etc/codex/requirements.toml';
  const mKiro = darwin ? root + '/Library/Application Support/Kiro/managed-settings.json' : root + '/etc/kiro/managed-settings.json';
  const cmd = o['--cmd'] || './mhw';
  const floorRules = records(textOf(o['--floor-claude'])).filter((l) => l.length > 0);
  const want = [...new Set(floorRules)].sort(codepointCompare);
  const nWant = want.length;
  const codexWords = records(textOf(o['--floor-codex']));
  const nCodex = codexWords.filter((l) => l.length > 0).length;
  const user = denied(o['--settings'], want);
  const admin = denied(mClaude, want);
  const nUser = user.n;
  const nAdmin = admin.n;
  let nCodexAdmin = 0;
  if (isFile(mCodex) && isManaged(textOf(mCodex))) {
    nCodexAdmin = codexAdminWords(textOf(mCodex)).filter((l) => codexWords.includes(l)).length;
  }
  const rules = o['--codex-rules'];
  const codexUser = isFile(rules) && isManaged(textOf(rules)) ? 'present' : 'absent';
  io.out('FLOOR   Claude Code: user layer ' + nUser + '/' + nWant + ' rules' + user.note + '; admin layer ' + nAdmin + '/' + nWant + ' rules' + admin.note + '\n');
  io.out('FLOOR   Codex: user rules file ' + codexUser + '; admin requirements ' + nCodexAdmin + '/' + nCodex + ' prefix rules\n');
  const kiroArgs = ['--mode=report', '--stamp=' + o['--stamp'], '--floor=' + o['--floor']];
  if (o['--floor-from']) kiroArgs.push('--floor-from=' + o['--floor-from']);
  kiroArgs.push('--admin=' + mKiro);
  const code = kiroMain(kiroArgs, { out: io.out, err: io.err, ...(io.env ? { env: io.env } : {}) });
  if (nAdmin === nWant && nCodexAdmin === nCodex) {
    io.out('FLOOR   carried by: the admin layer; the user copy stays as a fallback until it is retired (ADR-0016)\n');
  } else if (nUser !== nWant || codexUser !== 'present') {
    io.out('FLOOR   carried by: NO complete layer; run ' + cmd + ' install\n');
  } else if (nAdmin > 0 || nCodexAdmin > 0) {
    io.out('FLOOR   carried by: the user layer; the admin copy is INCOMPLETE (run ' + cmd + ' install)\n');
  } else {
    io.out('FLOOR   carried by: the user layer only; a session flag can drop it (--setting-sources project, measured); install the admin copy with '
      + cmd + ' install\n');
  }
  return code;
}

const OPTIONS = new Set(['--settings', '--floor-claude', '--floor-codex', '--floor', '--floor-from', '--stamp', '--codex-rules',
  '--managed-root', '--cmd']);
const REQUIRED = ['--settings', '--floor-claude', '--floor-codex', '--floor', '--stamp', '--codex-rules'];

/**
 * The command line. Returns the exit code.
 * @param {string[]} argv
 * @param {{ out?: (s: string) => void, err?: (s: string) => void, platform?: string }} [io]
 */
export function main(argv, io = {}) {
  const out = io.out || ((s) => process.stdout.write(s));
  const err = io.err || ((s) => process.stderr.write(s));
  /** @type {Record<string, string>} */
  const o = {};
  for (const a of argv) {
    const at = a.indexOf('=');
    const k = at < 0 ? a : a.slice(0, at);
    if (at < 0 || !OPTIONS.has(k) || Object.hasOwn(o, k)) {
      err('usage: ' + PROG + ' --settings=FILE --floor-claude=FILE --floor-codex=FILE --floor=FILE --stamp=STAMP --codex-rules=FILE'
        + ' [--floor-from=TEXT] [--managed-root=DIR] [--cmd=TEXT]\n');
      return 2;
    }
    o[k] = a.slice(at + 1);
  }
  if (REQUIRED.some((k) => !o[k])) {
    err('usage: ' + PROG + ' --settings=FILE --floor-claude=FILE --floor-codex=FILE --floor=FILE --stamp=STAMP --codex-rules=FILE'
      + ' [--floor-from=TEXT] [--managed-root=DIR] [--cmd=TEXT]\n');
    return 2;
  }
  return report(o, { out, err, platform: io.platform || process.platform });
}

/** True when this file is the program node was started with. */
function isEntry() {
  try {
    return fs.realpathSync(process.argv[1] || '') === fs.realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isEntry()) process.exitCode = main(process.argv.slice(2));
