// The user deny floor and the paste filter's hook entry, merged into ~/.claude/settings.json (#491, S20 of
// #470): the Node form of install.sh's merge_settings and of the settings half of its uninstall_user, which
// were jq programs. ADR-0016 (the deny floor), ADR-0011 (the paste filter), Issue #66 (the stamp key),
// Issue #67 (the ownership record).
//
//   node src/render/settings-merge.js --phase=merge --mode=install|check|dry-run --settings=FILE
//        --floor-claude=FILE --stamp=STAMP [--paste-cmd=COMMAND]
//   node src/render/settings-merge.js --phase=uninstall --settings=FILE --floor-claude=FILE
//
// --floor-claude is the rendered floor, one Claude Code rule per line (install.sh's $floor_claude).
// --paste-cmd is the paste filter's hook command; without it the entry of ours is removed instead of
// written (paste filter refused, or --hooks=managed). An entry of a removed hook (the HITL picker guard,
// the restart guard) is always removed.
//
// The file is never replaced: every other key, hook and permission rule is kept in its place, no existing
// deny entry is removed, a missing floor rule is appended, and a 0600 backup is left beside it. It is read
// and written the way jq 1.7.1 did (src/lib/jq-json.js, S19's reader): key order, number literals and string
// escapes come out as jq wrote them, so the rendered deny set is byte for byte what the jq program wrote
// (test/golden/S20). A file jq refuses is refused; a file jq reads and strict JSON does not (NaN, a
// byte-order mark, several documents, nesting past 256 levels) is refused too, visibly, and left untouched.
//
// Exit codes: 0 ok · 1 drift (check) · 2 usage · 3 refused, nothing written · 4 an I/O failure while writing
// (the backup or the file): install.sh then stops at once with exit 1, as its set -e did. node: modules only.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MARKER_ID, NAME, stampOfLine } from '../lib/marker.js';
import { keyOptions } from '../lib/key-options.js';
import { privateCopy } from '../lib/private-copy.js';
import { classify, stringify, compact, equal, typeOf, JqNumber } from '../lib/jq-json.js';
import { unifiedHunks } from '../lib/unified-diff.js';

/** @typedef {import('../lib/jq-json.js').JqValue} JqValue */
/** @typedef {Map<string, JqValue>} JqObject */
/**
 * @typedef {{ out: (s: string) => void, err: (s: string) => void, status: number, opts: Record<string, string> }} Ctx
 */

const PROG = 'settings-merge.js';
/** The top-level key that carries the provenance stamp (Issue #66). */
export const STAMP_KEY = NAME;
/** The deny-floor rules this installer appended (Issue #67). */
export const OWN_KEY = NAME + '-owned-deny';
/** The prompt hook's command carries this (`mhw hook prompt`, Node since #488). */
export const PASTE_ID = '/bin/mhw.js" hook prompt --harness ';
/** The Python core an earlier install merged (before #488): always removed. */
export const OLD_PASTE_ID = NAME + '/clipboard_guard.py';
/** Removed hooks (ADR-0028; ADR-0013 2026-10-05): kept so an entry an earlier version merged is deleted. */
export const RESTART_ID = NAME + '/restart_guard.py';
export const HOOK_ID = NAME + '/hitl-escalation-guard.sh';

/** A jq runtime error: the program would have failed, so the step refuses. */
class JqError extends Error {}
/** jq would have printed nothing (an `if` over an empty generator): the shell then emptied the file. */
class JqEmpty extends Error {}

// ---- jq's semantics for the few operations the two programs use ----------------------------------------

/** `.k` on v: null on null, the value (or null) on an object, an error otherwise. @param {JqValue} v @param {string} k @returns {JqValue} */
function index(v, k) {
  if (v === null) return null;
  if (v instanceof Map) return v.has(k) ? /** @type {JqValue} */ (v.get(k)) : null;
  throw new JqError('Cannot index ' + typeOf(v) + ' with "' + k + '"');
}

/** `.[]` on v: an array's elements, an object's values, an error otherwise. @param {JqValue} v @returns {JqValue[]} */
function iterate(v) {
  if (Array.isArray(v)) return v;
  if (v instanceof Map) return [...v.values()];
  throw new JqError('Cannot iterate over ' + typeOf(v));
}

/** `.[]?`: as iterate, nothing where it would fail. @param {JqValue} v */
function iterateOpt(v) {
  return Array.isArray(v) || v instanceof Map ? iterate(v) : [];
}

/** `a // b`. @param {JqValue} a @param {JqValue} b */
function alt(a, b) {
  return a === null || a === false ? b : a;
}

/** `(.command? // "") | tostring`. @param {JqValue} h */
function commandText(h) {
  const c = h instanceof Map ? (h.get('command') ?? null) : null;
  if (c === null || c === false) return '';
  return typeof c === 'string' ? c : compact(c);
}

/** `(.command? // "") | tostring | contains($id)`. @param {JqValue} h @param {string} id */
const ours = (h, id) => commandText(h).includes(id);

/**
 * jq's `$list | index($r) != null`: an element equal to r, or, when r is a non-empty array, a contiguous
 * run of the list equal to it (jq's subarray index). @param {JqValue[]} list @param {JqValue} r
 */
export function jqIndexed(list, r) {
  if (!Array.isArray(r)) return list.some((e) => equal(e, r));
  if (!r.length) return false;
  for (let k = 0; k + r.length <= list.length; k++) if (r.every((x, j) => equal(list[k + j], x))) return true;
  return false;
}

/** A copy of an object with key set, keeping the key's place when it is there. @param {JqObject} o @param {string} k @param {JqValue} v */
function withKey(o, k, v) {
  const out = new Map(o);
  out.set(k, v);
  return out;
}

/**
 * The groups of one event without the hook entries of ours: a group holding one keeps its other entries,
 * and goes when none is left; any other group stays as it is. `[.[] | if any(.hooks[]?; ours) then (.hooks
 * |= map(select(ours | not))) | select(.hooks | length > 0) else . end]`.
 * @param {JqValue[]} list
 * @param {string} id
 */
function withoutOurs(list, id) {
  /** @type {JqValue[]} */
  const groups = [];
  for (const g of list) {
    const hs = index(g, 'hooks');
    if (!iterateOpt(hs).some((h) => ours(h, id))) groups.push(g);
    else {
      const kept = iterate(hs).filter((h) => !ours(h, id));
      if (kept.length) groups.push(withKey(/** @type {JqObject} */ (g), 'hooks', kept));
    }
  }
  return groups;
}

/** `[.hooks[$ev][]?.hooks[]? | select(ours)] | length`. @param {JqValue} groups @param {string} id */
function oursCount(groups, id) {
  let n = 0;
  for (const g of iterateOpt(groups)) n += iterateOpt(index(g, 'hooks')).filter((h) => ours(h, id)).length;
  return n;
}

// ---- The merge program (merge_settings) -----------------------------------------------------------------

/**
 * The Python prompt hook an earlier install merged (#488), always removed before the Node one is placed:
 * `if any(.hooks.UserPromptSubmit[]?.hooks[]?; ours($opid)) then .hooks.UserPromptSubmit = [
 * .hooks.UserPromptSubmit[] | (.hooks |= map(select(ours($opid) | not))) | select(.hooks | length > 0) ]
 * else . end`. Unlike place, it filters every group, and drops any group left with no hook.
 * @param {JqObject} doc
 * @returns {JqObject}
 */
function withoutOldPaste(doc) {
  const hooks = index(doc, 'hooks');
  const ups = index(hooks, 'UserPromptSubmit');
  // jq's any stops at the first match, so a group after it is never indexed.
  const found = iterateOpt(ups).some((g) => iterateOpt(index(g, 'hooks')).some((h) => ours(h, OLD_PASTE_ID)));
  if (!found) return doc;
  /** @type {JqValue[]} */
  const groups = [];
  for (const g of iterate(ups)) {
    const kept = iterate(index(g, 'hooks')).filter((h) => !ours(h, OLD_PASTE_ID));
    if (kept.length) groups.push(withKey(/** @type {JqObject} */ (g), 'hooks', kept));
  }
  return withKey(doc, 'hooks', withKey(/** @type {JqObject} */ (hooks), 'UserPromptSubmit', groups));
}

/**
 * One hook entry of ours per event: keep the file when it holds exactly the wanted one; otherwise drop
 * every entry of ours (and a group left empty by that) and append the wanted one, unless it is null.
 * merge_settings' `place`. @param {JqObject} doc @param {string} ev @param {string} id @param {JqValue} want
 * @returns {JqObject}
 */
function place(doc, ev, id, want) {
  const groupsVal = index(index(doc, 'hooks'), ev);
  const n = oursCount(groupsVal, id);
  const keep = want === null ? n === 0 : n === 1 && iterateOpt(groupsVal).filter((g) => equal(g, want)).length === 1;
  if (keep) return doc;
  const hooks = alt(index(doc, 'hooks'), new Map());
  const out = withKey(doc, 'hooks', hooks);
  const groups = withoutOurs(iterate(alt(index(hooks, ev), [])), id);
  if (want !== null) groups.push(want);
  if (!(hooks instanceof Map)) throw new JqError('Cannot index ' + typeOf(hooks) + ' with "' + ev + '"');
  out.set('hooks', withKey(hooks, ev, groups));
  return out;
}

/** The paste filter's hook group: {hooks: [{type: "command", command: $cmd, timeout: 30}]}. @param {string} cmd */
export function pasteGroup(cmd) {
  const hook = new Map(/** @type {Array<[string, JqValue]>} */ ([['type', 'command'], ['command', cmd], ['timeout', new JqNumber('30')]]));
  return new Map(/** @type {Array<[string, JqValue]>} */ ([['hooks', [hook]]]));
}

/** The stamp key's value. @param {string} stamp */
export function stampValue(stamp) {
  return MARKER_ID + '; source: global/install.sh (only the hook entries and deny-floor rules merged into this file; every other key is yours); '
    + stamp + '; do not edit, re-run the installer';
}

/**
 * merge_settings' jq program. Throws a JqError where jq failed (the step then refuses).
 * @param {JqObject} doc the settings file, an object
 * @param {string[]} floor the floor rules, deduplicated in file order
 * @param {JqValue} paste the paste filter's group, or null
 * @param {string} stamp
 * @returns {JqObject}
 */
export function merged(doc, floor, paste, stamp) {
  const perms = doc.get('permissions') ?? null;
  const dRaw = perms instanceof Map ? alt(perms.get('deny') ?? null, []) : [];
  const d0 = Array.isArray(dRaw) ? dRaw : [];
  const inD0 = (/** @type {string} */ x) => d0.some((e) => equal(e, x));
  const record = doc.get(OWN_KEY) ?? null;
  /** @type {JqValue[]} */
  let prev = [];
  if (Array.isArray(record)) prev = record;
  else if ((doc.get(STAMP_KEY) ?? null) !== null) prev = floor.filter(inD0);
  const own0 = [...prev, ...floor.filter((x) => !inD0(x))];
  const own = floor.filter((x) => own0.some((e) => equal(e, x)));
  if (perms !== null && !(perms instanceof Map)) throw new JqError('permissions has an unexpected shape');
  if (perms instanceof Map && (perms.get('deny') ?? null) !== null && !Array.isArray(perms.get('deny'))) {
    throw new JqError('permissions has an unexpected shape');
  }
  let out = place(doc, 'PreToolUse', HOOK_ID, null);
  out = withoutOldPaste(out);
  out = place(out, 'UserPromptSubmit', PASTE_ID, paste);
  out = place(out, 'SessionStart', RESTART_ID, null);
  out = place(out, 'PreToolUse', RESTART_ID, null);
  const p = out.get('permissions') ?? null;
  const d = /** @type {JqValue[]} */ (alt(p instanceof Map ? (p.get('deny') ?? null) : null, []));
  const missing = floor.filter((r) => !d.some((e) => equal(e, r)));
  if (missing.length) {
    const base = /** @type {JqObject} */ (alt(p, new Map()));
    out = withKey(out, 'permissions', withKey(base, 'deny', [...d, ...missing]));
  }
  out = withKey(out, STAMP_KEY, stampValue(stamp));
  return withKey(out, OWN_KEY, own);
}

// ---- The uninstall program (uninstall_user) -------------------------------------------------------------

/** uninstall_user's `drop`. @param {JqObject} doc @param {string} ev @param {string} id @returns {JqObject} */
function drop(doc, ev, id) {
  const hooks = doc.get('hooks') ?? null;
  if (hooks !== null && !(hooks instanceof Map)) throw new JqEmpty('hooks is not an object');
  const list = index(hooks, ev);
  if (!Array.isArray(list)) return doc;
  const groups = withoutOurs(list, id);
  const h2 = withKey(/** @type {JqObject} */ (hooks), ev, groups);
  if (!groups.length) h2.delete(ev);
  return withKey(doc, 'hooks', h2);
}

/**
 * uninstall_user's jq program: our hook entries, the deny-floor rules recorded as ours (all the floor
 * rules present, for a file stamped before the record existed) and our two keys removed. Throws a JqError
 * where jq failed, and a JqEmpty where jq printed nothing (the shell then emptied the file).
 * @param {JqObject} doc @param {string[]} floor the floor rules as rendered (file order)
 * @returns {JqObject}
 */
export function unmerged(doc, floor) {
  const record = doc.get(OWN_KEY) ?? null;
  /** @type {JqValue[]} */
  let mine = [];
  if (Array.isArray(record)) mine = record;
  else if ((doc.get(STAMP_KEY) ?? null) !== null) mine = floor;
  let out = drop(doc, 'PreToolUse', HOOK_ID);
  out = drop(out, 'UserPromptSubmit', PASTE_ID);
  out = drop(out, 'UserPromptSubmit', OLD_PASTE_ID);
  out = drop(out, 'SessionStart', RESTART_ID);
  out = drop(out, 'PreToolUse', RESTART_ID);
  if (equal(out.get('hooks') ?? null, new Map())) {
    out = new Map(out);
    out.delete('hooks');
  }
  const perms = out.get('permissions') ?? null;
  if (perms !== null && !(perms instanceof Map)) throw new JqEmpty('permissions is not an object');
  if (perms instanceof Map && Array.isArray(perms.get('deny'))) {
    const p = withKey(perms, 'deny', /** @type {JqValue[]} */ (perms.get('deny')).filter((r) => !jqIndexed(mine, r)));
    if (equal(p.get('deny') ?? null, [])) p.delete('deny');
    out = withKey(out, 'permissions', p);
    if (equal(p, new Map())) out.delete('permissions');
  }
  out = new Map(out);
  out.delete(STAMP_KEY);
  out.delete(OWN_KEY);
  return out;
}

// ---- Files ---------------------------------------------------------------------------------------------

/** [ -e ] (follows links). @param {string} file */
function exists(file) {
  try {
    fs.statSync(file);
    return true;
  } catch {
    return false;
  }
}

/** The floor rules: every non-empty line of the rendered floor. @param {string} file */
export function floorRules(file) {
  return fs.readFileSync(file, 'utf8').split('\n').filter((l) => l.length > 0);
}

/** Deduplicated, first occurrence kept (merge_settings' reduce). @param {string[]} rules */
export function dedupe(rules) {
  return rules.filter((r, k) => rules.indexOf(r) === k);
}

/**
 * The settings file, read as jq 1.7.1 reads it.
 * @param {string} file
 * @returns {{ kind: 'object', value: JqObject } | { kind: 'jq-only' | 'unreadable' }}
 */
export function readSettings(file) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return { kind: 'unreadable' };
  }
  const c = classify(text);
  if (c.kind === 'json') return c.value instanceof Map ? { kind: 'object', value: c.value } : { kind: 'unreadable' };
  return { kind: c.kind };
}

const JQ_ONLY = ': not readable by the settings merge (jq reads it, strict JSON does not: NaN, a byte-order mark, several documents, nesting past 256 levels or the like); left untouched\n';

/** install.sh's stamp_of over the stamp key's value: the release and commit of its first managed-by line, or "none". @param {string} text */
export function stampOf(text) {
  const line = text.split('\n').find((l) => l.includes(MARKER_ID));
  return line === undefined ? 'none' : stampOfLine(line);
}

/** `jq -r '.[$sk] // "" | tostring'`. @param {JqObject} doc */
function stampText(doc) {
  const v = alt(doc.get(STAMP_KEY) ?? null, '');
  return typeof v === 'string' ? v : compact(v);
}

/** `jq -S 'del(.[$sk], .[$ok])'`, with its newline. @param {JqObject} doc */
function semantic(doc) {
  const out = new Map(doc);
  out.delete(STAMP_KEY);
  out.delete(OWN_KEY);
  return stringify(out, { indent: 2, sortKeys: true }) + '\n';
}

/** The removed picker guard still registered: `[.hooks.PreToolUse[]?.hooks[]? | select(ours)] | length > 0`. @param {JqObject} doc */
function pickerGuardLeft(doc) {
  try {
    const groups = index(index(doc, 'hooks'), 'PreToolUse');
    return iterateOpt(groups).some((g) => iterateOpt(index(g, 'hooks')).some((h) => ours(h, HOOK_ID)));
  } catch {
    return false;
  }
}

/** @param {Ctx} ctx @param {number} n */
function raise(ctx, n) {
  if (n > ctx.status) ctx.status = n;
}

/**
 * Keep the previous file as <file>.pmhwc-backup, owner-only. False (after the REFUSE line) when it could not be written.
 * @param {Ctx} ctx @param {string} file
 */
function backup(ctx, file) {
  try {
    privateCopy(file, file + '.pmhwc-backup');
    return true;
  } catch {
    ctx.err('REFUSE  ' + file + '.pmhwc-backup: the backup could not be created exclusively; no backup written\n');
    return false;
  }
}

/** Write text to file through file.new.<pid> and a rename; mode copies the old file's mode (cp -p). @param {string} file @param {string} text @param {boolean} keepMode */
function replace(file, text, keepMode) {
  const tmp = file + '.new.' + process.pid;
  const mode = keepMode ? fs.statSync(file).mode & 0o7777 : null;
  fs.writeFileSync(tmp, text);
  if (mode !== null) fs.chmodSync(tmp, mode);
  fs.renameSync(tmp, file);
}

/**
 * The settings file to merge into: {} when there is none, null (after the REFUSE line) when it is refused.
 * @param {Ctx} ctx @param {string} settings @param {boolean} has @returns {JqObject | null}
 */
function current(ctx, settings, has) {
  if (!has) return new Map();
  const r = readSettings(settings);
  if (r.kind === 'object') return r.value;
  ctx.err('REFUSE  ' + settings + (r.kind === 'jq-only' ? JQ_ONLY : ': not a readable JSON object; left untouched\n'));
  raise(ctx, 3);
  return null;
}

/**
 * --check where something differs: STAMP, DRIFT or MISSING.
 * @param {Ctx} ctx @param {{ settings: string, has: boolean, restamp: boolean, haveStamp: string, missing: number }} f
 */
function checkLine(ctx, f) {
  if (f.restamp) {
    ctx.out('STAMP   ' + f.settings + ': our entries match, but its "' + STAMP_KEY + '" key carries (' + f.haveStamp + ') and the source is ('
      + ctx.opts['--stamp'] + ')\n');
  } else if (f.has) {
    ctx.out('DRIFT   ' + f.settings + ' (' + f.missing + ' deny-floor rule(s) missing; or a hook entry is missing or stale; ' + f.haveStamp + ')\n');
  } else ctx.out('MISSING ' + f.settings + '\n');
  raise(ctx, 1);
}

/** --dry-run: what install would merge, and the semantic diff. @param {Ctx} ctx @param {{ settings: string, has: boolean, missing: number, text: string, before: string, after: string }} f */
function dryRun(ctx, f) {
  ctx.out('WOULD MERGE ' + f.settings + ': the UserPromptSubmit (paste filter) entry and ' + f.missing
    + ' deny-floor rule(s), removing any entry of a removed hook; every other key and rule is kept.\n');
  if (f.has && !fs.readFileSync(f.settings).equals(Buffer.from(f.text, 'utf8'))) {
    ctx.out('  note: the file is re-serialized (4-space indent, as jq wrote it), so whitespace and escaping may change;\n');
    ctx.out('  the semantic diff below (keys sorted) is the whole content change.\n');
  }
  ctx.out('----- semantic diff of ' + f.settings + '\n' + unifiedHunks(f.before, f.after) + '----- end\n');
}

/** install: the backup, then the file through a rename. @param {Ctx} ctx @param {string} settings @param {boolean} has @param {string} text */
function write(ctx, settings, has, text) {
  try {
    fs.mkdirSync(path.dirname(settings), { recursive: true });
    if (has && !backup(ctx, settings)) return raise(ctx, 4);
    replace(settings, text, has);
  } catch (e) {
    ctx.err('REFUSE  ' + settings + ': could not be written (' + (e instanceof Error ? e.message : String(e)) + ')\n');
    return raise(ctx, 4);
  }
  ctx.out('MERGED  ' + settings + (exists(settings + '.pmhwc-backup') ? ' (previous version kept as ' + settings + '.pmhwc-backup)' : '') + '\n');
}

/** The merge, in one mode. @param {Ctx} ctx */
export function mergeStep(ctx) {
  const settings = ctx.opts['--settings'];
  const mode = ctx.opts['--mode'];
  const stamp = ctx.opts['--stamp'];
  const floor = dedupe(floorRules(ctx.opts['--floor-claude']));
  const paste = ctx.opts['--paste-cmd'] ? pasteGroup(ctx.opts['--paste-cmd']) : null;
  const has = exists(settings);
  const cur = current(ctx, settings, has);
  if (cur === null) return;
  let want;
  try {
    want = merged(cur, floor, paste, stamp);
  } catch (e) {
    if (!(e instanceof JqError)) throw e;
    ctx.err('REFUSE  ' + settings + ': its hooks or permissions section has an unexpected shape; left untouched\n');
    return raise(ctx, 3);
  }
  const p = cur.get('permissions') ?? null;
  const d = /** @type {JqValue[]} */ (alt(p instanceof Map ? (p.get('deny') ?? null) : null, []));
  const missing = floor.filter((r) => !d.some((e) => equal(e, r))).length;
  const before = semantic(cur);
  const after = semantic(want);
  const haveStamp = stampOf(stampText(cur));
  if (has && mode === 'check' && pickerGuardLeft(cur)) {
    ctx.out('STALE   ' + settings + ": the removed HITL picker guard's PreToolUse(AskUserQuestion) entry; install removes it\n");
  }
  const restamp = has && before === after;
  if (restamp && haveStamp === stamp) {
    ctx.out('OK      ' + settings + ' (hook entries and all ' + floor.length + ' deny-floor rules present; ' + stamp + ')\n');
    return;
  }
  const text = stringify(want, { indent: 4 }) + '\n';
  if (mode === 'check') return checkLine(ctx, { settings, has, restamp, haveStamp, missing });
  if (mode === 'dry-run') return dryRun(ctx, { settings, has, missing, text, before, after });
  write(ctx, settings, has, text);
}

/** The settings half of uninstall_user. @param {Ctx} ctx */
export function uninstallStep(ctx) {
  const settings = ctx.opts['--settings'];
  if (!exists(settings)) {
    ctx.out('ABSENT  ' + settings + '\n');
    return;
  }
  const r = readSettings(settings);
  if (r.kind === 'jq-only') {
    ctx.err('REFUSE  ' + settings + JQ_ONLY);
    return raise(ctx, 3);
  }
  let out;
  try {
    if (r.kind !== 'object') throw new JqError('not an object');
    out = unmerged(r.value, floorRules(ctx.opts['--floor-claude']));
  } catch (e) {
    if (!(e instanceof JqError || e instanceof JqEmpty)) throw e;
    ctx.err('REFUSE  ' + settings + ': not a readable JSON object of the expected shape; left untouched\n');
    return raise(ctx, 3);
  }
  if (equal(r.value, out)) {
    ctx.out('OK      ' + settings + ' holds no entry of ours\n');
    return;
  }
  try {
    if (!backup(ctx, settings)) return raise(ctx, 4);
    replace(settings, stringify(out, { indent: 4 }) + '\n', false);
  } catch (e) {
    ctx.err('REFUSE  ' + settings + ': could not be written (' + (e instanceof Error ? e.message : String(e)) + ')\n');
    return raise(ctx, 4);
  }
  ctx.out('UNMERGED ' + settings + ' (our hook entries, the deny-floor rules this installer added, and our two keys removed; previous version kept as '
    + settings + '.pmhwc-backup)\n');
}

// ---- The command line ----------------------------------------------------------------------------------

const OPTIONS = new Set(['--phase', '--mode', '--settings', '--floor-claude', '--stamp', '--paste-cmd']);
const USAGE = 'usage: ' + PROG + ' --phase=merge --mode=install|check|dry-run --settings=FILE --floor-claude=FILE --stamp=STAMP [--paste-cmd=COMMAND]\n'
  + '       ' + PROG + ' --phase=uninstall --settings=FILE --floor-claude=FILE\n';

/** @param {string[]} argv */
const options = (argv) => keyOptions(argv, OPTIONS);

/** @param {Record<string, string> | null} o */
function usable(o) {
  if (!o?.['--settings'] || !o['--floor-claude']) return '';
  if (o['--phase'] === 'uninstall') return Object.keys(o).length === 3 ? 'uninstall' : '';
  if (o['--phase'] !== 'merge' || !o['--stamp'] || !['install', 'check', 'dry-run'].includes(o['--mode'])) return '';
  return 'merge';
}

/**
 * The command line. Returns the exit code.
 * @param {string[]} argv
 * @param {{ out?: (s: string) => void, err?: (s: string) => void }} [io]
 */
export function main(argv, io = {}) {
  const opts = options(argv);
  /** @type {Ctx} */
  const ctx = {
    out: io.out || ((s) => process.stdout.write(s)),
    err: io.err || ((s) => process.stderr.write(s)),
    status: 0,
    opts: opts ?? {},
  };
  const phase = usable(opts);
  if (!phase) {
    ctx.err(USAGE);
    return 2;
  }
  try {
    floorRules(ctx.opts['--floor-claude']);
  } catch {
    ctx.err('REFUSE  the deny floor ' + ctx.opts['--floor-claude'] + ' cannot be read; ' + ctx.opts['--settings'] + ' left untouched\n');
    return 2;
  }
  try {
    if (phase === 'merge') mergeStep(ctx);
    else uninstallStep(ctx);
  } catch (e) {
    // Anything unforeseen is a refusal, never node's exit 1 (which install.sh would read as --check's
    // drift): settings.json is left as it was and no allow list is written beside it (PR #539 lens F1).
    ctx.err('REFUSE  ' + ctx.opts['--settings'] + ': the settings step failed (' + (e instanceof Error ? e.message : String(e)) + '); left untouched\n');
    return 3;
  }
  return ctx.status;
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
