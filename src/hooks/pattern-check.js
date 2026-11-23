// The fixed-pattern check (#588, slice 2a of the CLI native baseline PRD, sections 5 and 6; ADR-0033 and
// ADR-0035 decision 7, 2026-11-23 amendments). A script `mhw install` installs as a file, beside a copy of
// the cleaning core it imports (../lib/clean.js, ../lib/clean-unicode.js), and that each agent harness runs
// from a NATIVE command hook. No hook command names `mhw`. It checks the fixed-format categories only
// (FIXED_CATEGORIES: credentials, e-mail addresses, card and identity numbers, phone numbers); the term
// categories stay with `mhw hook prompt` until #600 and then with the model.
//
//   node pattern-check.js prompt   --harness claude|codex|kiro [--config FILE] [--defer-to-paste-filter]
//       Before each prompt (UserPromptSubmit). A finding blocks the prompt and shows a redacted copy, in the
//       protocol `mhw hook prompt` uses on that harness: Claude Code and Codex print
//       {"decision": "block", "reason": ...} (Claude Code also suppressOriginalPrompt) and exit 0; Kiro exits
//       2 with the message on stderr. A clean prompt prints nothing. A check that could not run says so
//       ({"systemMessage": ...}; on Kiro on stderr, which Kiro drops at exit 0) and the prompt passes.
//       --defer-to-paste-filter: `mhw hook prompt` is registered beside this hook (until #600) and blocks the
//       same fixed-format findings itself, so this hook stays silent where it would: everywhere on Kiro, and
//       on Claude Code and Codex outside a session the paste wrapper started (PMHWC_PASTE_WRAPPER=1, where
//       that hook lets every prompt through and this one still checks what is typed). One prompt, one block.
//   node pattern-check.js pre-tool --harness claude|codex|kiro [--config FILE]
//       Before a tool call (PreToolUse). Only a shell command that runs `git push` (`git -C DIR push`
//       included) or `gh pr create` is checked; every other call passes at once. Checked: the command text
//       (a pull request's title and body included), the file a `--body-file`/`-F` names, and every commit
//       that push would send: its message and the lines it adds (as `mhw scan` reads them; the vendor
//       no-reply address of the attribution trailer excepted). A finding blocks the call on every harness:
//       exit 2, the findings on stderr, never the matched text. A check that could not run blocks too
//       (fail closed): the outbound act is the boundary, and the owner can still push from his own terminal.
//
// --config is the paste filter's clipboard.conf: its block_categories (intersected with the fixed set) and
// its notice templates apply, so a localised overlay localises these messages too. Without it, the defaults.
// It prints positions and categories, never the matched text, and writes nothing. node: modules and the
// two core files only (test/install/pattern-check.test.js holds the closure).
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as core from '../lib/clean.js';

export const HARNESSES = Object.freeze(['claude', 'codex', 'kiro']);
export const MODES = Object.freeze(['prompt', 'pre-tool']);
/** The hook gives up after this long; every agent harness here allows the hook 30 s. */
export const DEADLINE_MS = 20000;
const FIXED = new Set(core.FIXED_CATEGORIES);

/** The notices. The first four share their keys with `mhw hook prompt`, so one overlay localises both. */
export const NOTICES = Object.freeze({
  notice_blocked: 'Paste filter (ADR-0033): {categories} in this prompt. It was NOT sent, and nothing '
    + 'was changed. A redacted copy is below: submit that instead, or edit your prompt.',
  notice_cleaned_too_long: 'The redacted copy is {chars} characters, too long to show here.',
  notice_too_large: 'Paste filter (ADR-0033): this prompt is over {max} bytes and was NOT checked.',
  notice_error: 'Paste filter (ADR-0033): internal error ({error}); this prompt was NOT checked.',
  notice_outbound_blocked: 'Outbound check (ADR-0035 decision 7): this command would send {categories}. It was NOT '
    + 'run. Where, never the text:',
  notice_outbound_fix: 'Remove it from the command, or rewrite the unpushed commit that introduced it (not with a '
    + 'follow-up commit, which still sends the first), then run the command again.',
  notice_outbound_error: 'Outbound check (ADR-0035 decision 7): the check could not run ({error}), so this command '
    + 'was NOT run. Run it from your own terminal if you have checked it yourself.',
});
const DEFAULTS = Object.freeze({ ...core.DEFAULTS, ...NOTICES });

// --------------------------------------------------------------------------------------- shared

/** The class name of an error, never its message. @param {unknown} e */
export function errorClass(e) {
  if (e instanceof core.PyError) return e.pyClass;
  if (e && typeof e === 'object' && 'code' in e && typeof (/** @type {any} */ (e).code) === 'string') return core.osErrorClass(e);
  return e instanceof Error && /^[A-Za-z]+$/.test(e.name) ? e.name : 'Error';
}

/** A notice, or its default when the configured template is broken. @param {Record<string, string>} conf @param {string} key @param {Record<string, string | number>} [v] */
function notice(conf, key, v = {}) {
  try {
    return core.pyFormat(conf[key], v);
  } catch {
    return core.pyFormat(/** @type {Record<string, string>} */ (DEFAULTS)[key], v);
  }
}

/** The settings, or the defaults when there is no file. @param {string | null} file @param {Record<string, string | undefined>} env */
export function loadConfig(file, env) {
  return core.loadConfig(file, { env, defaults: DEFAULTS });
}

/** The fixed categories this configuration blocks. @param {Record<string, string>} conf */
export function blocked(conf) {
  return new Set([...core.blockingSet(conf)].filter((c) => FIXED.has(c)));
}

/**
 * The fixed-format findings in text that conf blocks, as spans. No term list is read: the core runs its
 * patterns only.
 * @param {string} text @param {Set<string>} cats
 * @returns {Array<[number, number, string]>}
 */
export function fixedSpans(text, cats) {
  return core.findSpans(text).filter((s) => cats.has(s[2]));
}

/** JSON as `mhw hook prompt` writes it: ASCII only, ", " and ": " separators. @param {unknown} v @returns {string} */
export function asciiJson(v) {
  if (typeof v === 'string') return JSON.stringify(v).replace(/[\u007f-\uffff]/g, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
  if (v === null || typeof v === 'boolean' || typeof v === 'number') return String(v);
  if (Array.isArray(v)) return '[' + v.map(asciiJson).join(', ') + ']';
  return '{' + Object.entries(/** @type {Record<string, unknown>} */ (v)).map(([k, x]) => asciiJson(k) + ': ' + asciiJson(x)).join(', ') + '}';
}

/** The payload object; throws a PyError naming why it is not one. @param {Buffer} raw */
export function payloadOf(raw) {
  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(raw);
  } catch {
    throw new core.PyError('UnicodeDecodeError');
  }
  let v;
  try {
    v = JSON.parse(text);
  } catch {
    throw new core.PyError('JSONDecodeError');
  }
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new core.PyError('ValueError');
  return /** @type {Record<string, unknown>} */ (v);
}

// --------------------------------------------------------------------------------------- prompt

/** The paste wrapper's session marker (src/commands/hook-prompt.js, WRAPPER_MARKER), and its value. */
export const WRAPPER_MARKER = 'PMHWC_PASTE_WRAPPER';

/**
 * True when `mhw hook prompt` blocks this prompt's fixed-format findings itself: on Kiro always (its Kiro mode
 * ignores the marker), elsewhere outside a session the paste wrapper started.
 * @param {string} harness @param {Record<string, string | undefined>} env
 */
export function pasteFilterBlocks(harness, env) {
  return harness === 'kiro' || env[WRAPPER_MARKER] !== '1';
}

/**
 * What the prompt hook writes for one payload.
 * @param {Record<string, string>} conf @param {string} harness @param {Buffer} raw
 * @param {boolean} [defer] the paste filter blocks the same findings here (--defer-to-paste-filter)
 * @returns {{ stdout: string, stderr: string, code: number }}
 */
export function promptCheck(conf, harness, raw, defer = false) {
  /** @param {string} msg */
  const warnOut = (msg) => (harness === 'kiro' ? { stdout: '', stderr: msg + '\n', code: 0 } : { stdout: asciiJson({ systemMessage: msg }) + '\n', stderr: '', code: 0 });
  try {
    const max = core.pyInt(conf.max_bytes);
    if (raw.length > max * 6 + 65536) return warnOut(notice(conf, 'notice_too_large', { max: conf.max_bytes }));
    const prompt = payloadOf(raw).prompt;
    if (typeof prompt !== 'string') throw new core.PyError('ValueError');
    if (Buffer.byteLength(prompt, 'utf8') > max) return warnOut(notice(conf, 'notice_too_large', { max: conf.max_bytes }));
    const spans = fixedSpans(prompt, blocked(conf));
    if (!spans.length || defer) return { stdout: '', stderr: '', code: 0 };
    const cleaned = core.sanitise(prompt, spans);
    const chars = [...cleaned].length;
    const parts = [notice(conf, 'notice_blocked', { categories: core.categories(spans).join(', ') })];
    parts.push(chars <= core.pyInt(conf.show_cleaned_chars) ? '\n' + cleaned : notice(conf, 'notice_cleaned_too_long', { chars }));
    const reason = parts.join('\n');
    if (harness === 'kiro') return { stdout: '', stderr: reason + '\n', code: 2 };
    /** @type {Record<string, unknown>} */
    const out = { decision: 'block', reason };
    if (harness === 'claude') out.hookSpecificOutput = { hookEventName: 'UserPromptSubmit', suppressOriginalPrompt: true };
    return { stdout: asciiJson(out) + '\n', stderr: '', code: 0 };
  } catch (e) {
    return warnOut(notice(conf, 'notice_error', { error: errorClass(e) }));
  }
}

// --------------------------------------------------------------------------------------- the command

/**
 * The simple commands of a shell command text, each as its words: quotes and backslashes are read the way
 * sh reads them; ; & | ( ) and a newline end a command. Substitutions are not expanded (the text-level
 * trigger below catches what this misses).
 * @param {string} text
 * @returns {string[][]}
 */
export function simpleCommands(text) {
  /** @type {Lexer} */
  const L = { text, i: 0, word: '', inWord: false, words: [], cmds: [] };
  while (L.i < text.length) lexStep(L);
  endCmd(L);
  return L.cmds;
}

/** @typedef {{ text: string, i: number, word: string, inWord: boolean, words: string[], cmds: string[][] }} Lexer */

/** @param {Lexer} L */
function endWord(L) {
  if (L.inWord) L.words.push(L.word);
  L.word = '';
  L.inWord = false;
}

/** @param {Lexer} L */
function endCmd(L) {
  endWord(L);
  if (L.words.length) L.cmds.push(L.words);
  L.words = [];
}

/** '...': everything to the next single quote, literally (or to the end, unterminated). @param {Lexer} L */
function singleQuoted(L) {
  const end = L.text.indexOf("'", L.i + 1);
  const stop = end < 0 ? L.text.length : end;
  L.word += L.text.slice(L.i + 1, stop);
  L.inWord = true;
  L.i = stop + 1;
}

/** A double-quoted run: a backslash escapes only a double quote, a backslash, a dollar sign, a backtick and a newline. @param {Lexer} L */
function doubleQuoted(L) {
  const t = L.text;
  let j = L.i + 1;
  L.inWord = true;
  while (j < t.length && t[j] !== '"') {
    if (t[j] === '\\' && j + 1 < t.length && '"\\$`\n'.includes(t[j + 1])) j++;
    L.word += t[j];
    j++;
  }
  L.i = j + 1;
}

/** A backslash outside quotes: the next character literally; before a newline, a line continuation. @param {Lexer} L */
function backslash(L) {
  // A backslash that ends the text escapes nothing: the length is checked, never an undefined read.
  if (L.i + 1 < L.text.length && L.text[L.i + 1] !== '\n') {
    L.word += L.text[L.i + 1];
    L.inWord = true;
  }
  L.i += 2;
}

/** One character (or quoted run) of the command text. @param {Lexer} L */
function lexStep(L) {
  const c = L.text[L.i];
  if (c === "'") return singleQuoted(L);
  if (c === '"') return doubleQuoted(L);
  if (c === '\\') return backslash(L);
  if (c === '#' && !L.inWord) {
    const nl = L.text.indexOf('\n', L.i);
    L.i = nl < 0 ? L.text.length : nl; // the comment runs to the newline, which still ends the command
    return undefined;
  }
  if (';&|()\n'.includes(c)) endCmd(L);
  else if (c === ' ' || c === '\t' || c === '\r') endWord(L);
  else {
    L.word += c;
    L.inWord = true;
  }
  L.i++;
  return undefined;
}

const WRAPPERS = new Set(['command', 'env', 'nohup', 'time', 'exec', 'builtin', 'noglob']);
// git's global options that take the next word as their value (git(1), "OPTIONS").
const GIT_VALUE = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace', '--exec-path', '--super-prefix', '--config-env', '--list-cmds']);
const GH_VALUE = new Set(['-R', '--repo', '--hostname']);

/**
 * @typedef {{ kind: 'push', dir: string, gitDir: string | null, args: string[] }
 *   | { kind: 'pr', dir: string, args: string[] }} Action
 */

/**
 * The outbound acts in one command text: `git ... push` (each -C applied in order, relative to cwd) and
 * `gh ... pr create`.
 * @param {string} text @param {string} cwd
 * @returns {Action[]}
 */
export function actionsOf(text, cwd) {
  /** @type {Action[]} */
  const acts = [];
  for (const cmd of simpleCommands(text)) {
    const i = programIndex(cmd);
    const prog = path.basename(cmd[i] || '');
    const read = Object.hasOwn(READERS, prog) ? READERS[/** @type {'git' | 'gh'} */ (prog)] : null;
    const act = read ? read(cmd, i, cwd) : null;
    if (act) acts.push(act);
  }
  // A push or pull request the word reading above did not see (inside $(...), backticks, eval, sh -c):
  // check this directory's outgoing commits anyway. Over-triggering costs one check; missing one costs a leak.
  if (!acts.length && (/\bgit\b[^\n]*\bpush\b/.test(text) || /\bgh\b[^\n]*\bpr\b[^\n]*\bcreate\b/.test(text))) {
    acts.push({ kind: 'push', dir: cwd, gitDir: null, args: [] });
  }
  return acts;
}

const ASSIGNMENT = /^[A-Za-z_]\w*=/;

/** Where the program word is: past every leading VAR=value and wrapper (env -i, command -p, ...). @param {string[]} cmd */
export function programIndex(cmd) {
  let i = 0;
  for (;;) {
    while (i < cmd.length && ASSIGNMENT.test(cmd[i])) i++;
    if (i >= cmd.length || !WRAPPERS.has(cmd[i])) return i;
    i++;
    while (i < cmd.length && cmd[i].startsWith('-')) i++;
  }
}

/**
 * The value of the option at cmd[j]: after its '=', else the next word, or null when there is none (a
 * trailing `git -C`).
 * @param {string[]} cmd @param {number} j @param {number} eq the index of '=' in cmd[j], or -1
 * @returns {string | null}
 */
function optionValue(cmd, j, eq) {
  if (eq > 0) return cmd[j].slice(eq + 1);
  return j + 1 < cmd.length ? cmd[j + 1] : null;
}

/** `git [options] push ...`, each -C applied in order. @param {string[]} cmd @param {number} i @param {string} cwd @returns {Action | null} */
function gitPush(cmd, i, cwd) {
  let dir = cwd;
  /** @type {string | null} */
  let gitDir = null;
  let j = i + 1;
  while (j < cmd.length && cmd[j].startsWith('-')) {
    const eq = cmd[j].indexOf('=');
    const name = eq > 0 ? cmd[j].slice(0, eq) : cmd[j];
    const value = optionValue(cmd, j, eq);
    if (name === '-C' && value !== null) dir = path.resolve(dir, value);
    if (name === '--git-dir' && value !== null) gitDir = path.resolve(dir, value);
    j += GIT_VALUE.has(name) && eq < 0 ? 2 : 1;
  }
  return cmd[j] === 'push' ? { kind: 'push', dir, gitDir, args: cmd.slice(j + 1) } : null;
}

/** `gh [options] pr create ...`. @param {string[]} cmd @param {number} i @param {string} cwd @returns {Action | null} */
function ghPrCreate(cmd, i, cwd) {
  let j = i + 1;
  while (j < cmd.length && cmd[j].startsWith('-')) j += GH_VALUE.has(cmd[j]) ? 2 : 1;
  if (cmd[j] !== 'pr') return null;
  return cmd.slice(j + 1).find((w) => !w.startsWith('-')) === 'create' ? { kind: 'pr', dir: cwd, args: cmd.slice(j + 2) } : null;
}

const READERS = Object.freeze({ git: gitPush, gh: ghPrCreate });

/** The files a `gh pr create` reads its body from (--body-file F, -F F, --body-file=F), relative to cwd. @param {string[]} args @param {string} cwd */
export function bodyFiles(args, cwd) {
  /** @type {string[]} */
  const out = [];
  for (let k = 0; k < args.length; k++) {
    const a = args[k];
    if ((a === '--body-file' || a === '-F') && k + 1 < args.length) out.push(args[++k]);
    else if (a.startsWith('--body-file=')) out.push(a.slice('--body-file='.length));
    else if (a.startsWith('-F') && a.length > 2) out.push(a.slice(2));
  }
  return out.filter((f) => f !== '-').map((f) => path.resolve(cwd, f));
}

// --------------------------------------------------------------------------------------- the commits

const OBJECT_ID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const HUNK = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/;
const ATTRIBUTION_ADDRESSES = ['noreply' + '@' + 'anthropic.com', 'noreply' + '@' + 'openai.com'];
const ATTRIBUTION_TRAILER = new RegExp(String.raw`(?<![^\n])` + core.ci('co-authored-by') + String.raw`:([^<>\n]*)<(?:`
  + ATTRIBUTION_ADDRESSES.map((a) => a.replaceAll('.', String.raw`\.`)).join('|') + String.raw`)>[ \t]*(?![^\n])`, 'gu');
// git's push options that take the next word (git-push(1)); a refspec is any other word after the remote.
const PUSH_VALUE = new Set(['--repo', '--receive-pack', '--exec', '-o', '--push-option', '--signed']);

/** The message with only the vendor address of each attribution trailer cut, as `mhw scan` reads it. @param {string} message */
export function withoutAttributionTrailer(message) {
  return message.replace(ATTRIBUTION_TRAILER, (whole, name) => (core.strip(name) ? whole.slice(0, 'co-authored-by:'.length + name.length) : whole));
}

/**
 * The revisions a push names: each refspec's source (a leading + dropped; an empty source deletes and sends
 * nothing), --all/--branches/--mirror/--tags as git rev-list reads them, or HEAD when none is named.
 * @param {string[]} args
 */
export function pushRevisions(args) {
  /** @type {string[]} */
  const revs = [];
  /** @type {string[]} */
  const positional = [];
  for (let k = 0; k < args.length; k++) {
    const a = args[k];
    if (a === '--all' || a === '--branches') revs.push('--branches');
    else if (a === '--mirror') revs.push('--all');
    else if (a === '--tags') revs.push('--tags');
    else if (a === '--') {
      positional.push(...args.slice(k + 1));
      break;
    } else if (a.startsWith('-')) {
      if (PUSH_VALUE.has(a)) k++;
    } else positional.push(a);
  }
  for (const spec of positional.slice(1)) {
    const src = spec.replace(/^\+/, '').split(':')[0];
    if (src) revs.push(src);
  }
  if (!revs.some((r) => !r.startsWith('--')) && !revs.includes('--branches') && !revs.includes('--all')) revs.push('HEAD');
  return revs;
}

/**
 * Run git; [exit code, stdout]. Never through a shell.
 * @param {{ git: string, env: Record<string, string | undefined> }} ctx @param {string} dir @param {string | null} gitDir @param {string[]} args
 * @returns {[number, string]}
 */
function git(ctx, dir, gitDir, args) {
  const p = spawnSync(ctx.git, [...(gitDir ? ['--git-dir=' + gitDir] : []), ...args], {
    cwd: dir, env: ctx.env, maxBuffer: 1 << 30, shell: false, windowsHide: true,
  });
  if (p.error) throw new core.PyError('GitStartError');
  return [p.status === null ? 1 : p.status, new TextDecoder('utf-8').decode(p.stdout)];
}

/**
 * [path, first line, text or null] from a -U0 patch: each hunk's added lines as one block; a binary file is
 * one entry with text null. As `mhw scan` reads a commit (src/commands/scan.js addedBlocks).
 * @param {string} patch
 * @returns {Array<[string, number, string | null]>}
 */
export function addedBlocks(patch) {
  /** @type {Array<{ path: string, first: number, lines: string[] | null }>} */
  const blocks = [];
  /** @type {string | null} */
  let file = null;
  /** @type {{ path: string, first: number, lines: string[] } | null} */
  let current = null;
  for (const line of patch.split('\n')) {
    if (line.startsWith('diff --git ')) {
      current = null;
      file = headerPath(line);
    } else if (line.startsWith('@@')) {
      current = hunkStart(line, file);
      if (current) blocks.push(current);
    } else if (current !== null) {
      if (line.startsWith('+')) current.lines.push(line.slice(1));
    } else if (line.startsWith('+++ ')) {
      file = patchPath(line.slice(4));
    } else if (line.startsWith('Binary files ') && file) {
      blocks.push({ path: file, first: 0, lines: null });
    }
  }
  return blocks.map((b) => [b.path, b.first, b.lines === null ? null : b.lines.join('\n') + '\n']);
}

/** The new-side path of a 'diff --git a/<path> b/<path>' line, or null. @param {string} line */
export function headerPath(line) {
  const head = line.slice('diff --git '.length);
  if (head.endsWith('"') && head.includes(' "b/')) return head.slice(head.lastIndexOf(' "b/') + 4, -1);
  if (head.includes(' b/')) return head.slice(head.lastIndexOf(' b/') + 3);
  return null;
}

/**
 * The path of a '+++ b/<path>' line, or null for /dev/null. Trailing tabs are cut by a scan, not a regular
 * expression, so a long run of tabs costs linear time.
 * @param {string} name
 */
export function patchPath(name) {
  let end = name.length;
  while (end > 0 && name[end - 1] === '\t') end--;
  let n = name.slice(0, end);
  if (n.length > 1 && n.startsWith('"') && n.endsWith('"')) n = n.slice(1, -1);
  return n.startsWith('b/') ? n.slice(2) : null;
}

/** A hunk header's block, or null. @param {string} line @param {string | null} file */
function hunkStart(line, file) {
  const m = HUNK.exec(line);
  return m && file ? { path: file, first: Number(m[1]), lines: /** @type {string[]} */ ([]) } : null;
}

/** [line (1-based), category, length] for each finding in text. @param {string} text @param {Set<string>} cats */
function located(text, cats) {
  const o = core.offsets(text);
  return fixedSpans(text, cats).map(([s, e, cat]) => {
    const unit = o.toUnit(s);
    let line = 1;
    for (let i = text.indexOf('\n'); i >= 0 && i < unit; i = text.indexOf('\n', i + 1)) line++;
    return /** @type {[number, string, number]} */ ([line, cat, e - s]);
  }).sort((a, b) => a[0] - b[0] || core.CATEGORY_ORDER.indexOf(a[1]) - core.CATEGORY_ORDER.indexOf(b[1]));
}

/**
 * The findings in what one push would send: every commit reachable from its revisions and from no
 * remote-tracking ref, its message and the lines it adds (a merge's message only, as `mhw scan`).
 * @param {{ git: string, env: Record<string, string | undefined>, limit: number, cats: Set<string> }} ctx
 * @param {string} dir @param {string | null} gitDir @param {string[]} revs
 * @returns {Array<[string, string, number]>} [where, category, length]
 */
export function outgoingFindings(ctx, dir, gitDir, revs) {
  if (!fs.existsSync(dir)) return []; // git -C <missing> push fails by itself and sends nothing
  const [inRepo] = git(ctx, dir, gitDir, ['rev-parse', '--git-dir']);
  if (inRepo) return []; // not a repository: git push itself fails, and sends nothing
  const wanted = resolvedRevisions(ctx, dir, gitDir, revs);
  if (!wanted.length) return []; // nothing that resolves: an empty repository, or a refspec git push refuses
  const [c2, log] = git(ctx, dir, gitDir, ['log', '--reverse', '--format=%x00%H %h %P%n%B%x00', '-p', '-U0', '--no-color',
    '--no-ext-diff', '--no-textconv', '--no-renames', '--diff-merges=off', ...wanted, '--not', '--remotes', '--']);
  if (c2) throw new core.PyError('GitLogError');
  if (Buffer.byteLength(log, 'utf8') > ctx.limit * 4) throw new core.PyError('TooLargeToCheck');
  /** @type {Array<[string, string, number]>} */
  const found = [];
  const parts = log.split('\0');
  for (let k = 1; k + 1 < parts.length; k += 2) found.push(...commitFindings(ctx, parts[k], parts[k + 1] || ''));
  return found;
}

/**
 * The revisions as git rev-list reads them: an option kept, a name resolved to its commit, a name that does
 * not resolve left out.
 * @param {{ git: string, env: Record<string, string | undefined> }} ctx @param {string} dir @param {string | null} gitDir @param {string[]} revs
 */
function resolvedRevisions(ctx, dir, gitDir, revs) {
  /** @type {string[]} */
  const wanted = [];
  for (const r of revs) {
    if (r.startsWith('--')) {
      wanted.push(r);
      continue;
    }
    const [code, out] = git(ctx, dir, gitDir, ['rev-parse', '--verify', '--quiet', '--end-of-options', r + '^{commit}']);
    if (!code && OBJECT_ID.test(core.strip(out))) wanted.push(core.strip(out));
  }
  return wanted;
}

/**
 * One commit's findings: its message (head line '<full> <short> <parents>', then the body), and the lines
 * its patch adds.
 * @param {{ limit: number, cats: Set<string> }} ctx @param {string} record @param {string} patch
 * @returns {Array<[string, string, number]>}
 */
function commitFindings(ctx, record, patch) {
  const nl = record.indexOf('\n');
  const short = (nl < 0 ? record : record.slice(0, nl)).split(' ')[1] || '';
  const message = nl < 0 ? '' : record.slice(nl + 1);
  /** @type {Array<[string, string, number]>} */
  const found = located(withoutAttributionTrailer(message), ctx.cats).map(([, cat, len]) => [short + ':message', cat, len]);
  for (const [file, first, text] of addedBlocks(patch)) {
    if (text === null) continue; // binary: a text pattern cannot read it (`mhw scan` names it SKIPPED)
    if (Buffer.byteLength(text, 'utf8') > ctx.limit) throw new core.PyError('TooLargeToCheck');
    for (const [line, cat, len] of located(text, ctx.cats)) found.push([short + ':' + file + ':' + (first + line - 1), cat, len]);
  }
  return found;
}

/** The first git on PATH, by absolute path (src/lib/onpath.js's rule, kept here so the script stays self-contained). @param {Record<string, string | undefined>} env */
export function gitOnPath(env) {
  const win = process.platform === 'win32';
  const exts = win ? (env.PATHEXT || '.EXE;.CMD;.BAT').split(';').filter(Boolean) : [''];
  for (const dir of (env.PATH || env.Path || '').split(path.delimiter)) {
    if (!path.isAbsolute(dir)) continue;
    for (const ext of exts) {
      const p = path.join(dir, 'git' + ext.toLowerCase());
      try {
        if (fs.statSync(p).isFile()) {
          if (!win) fs.accessSync(p, fs.constants.X_OK);
          return p;
        }
      } catch {
        // not here
      }
    }
  }
  return null;
}

/**
 * What the pre-tool hook writes for one payload. Every harness: exit 0 and nothing to pass; exit 2 and the
 * message on stderr to block.
 * @param {Record<string, string>} conf @param {Buffer} raw @param {Record<string, string | undefined>} env
 * @returns {{ stdout: string, stderr: string, code: number }}
 */
export function preToolCheck(conf, raw, env) {
  const pass = { stdout: '', stderr: '', code: 0 };
  /** @param {string} msg */
  const block = (msg) => ({ stdout: '', stderr: msg + '\n', code: 2 });
  let payload;
  try {
    payload = payloadOf(raw);
  } catch (e) {
    return block(notice(conf, 'notice_outbound_error', { error: errorClass(e) }));
  }
  const input = payload.tool_input;
  const rawCmd = input && typeof input === 'object' ? /** @type {Record<string, unknown>} */ (input).command : undefined;
  const command = typeof rawCmd === 'string' ? rawCmd : Array.isArray(rawCmd) && rawCmd.every((w) => typeof w === 'string') ? rawCmd.join(' ') : null;
  if (command === null) return pass; // not a shell command: nothing to check
  const cwd = typeof payload.cwd === 'string' && path.isAbsolute(payload.cwd) ? payload.cwd : process.cwd();
  let acts;
  try {
    acts = actionsOf(command, cwd);
  } catch (e) {
    return block(notice(conf, 'notice_outbound_error', { error: errorClass(e) }));
  }
  if (!acts.length) return pass;
  try {
    const cats = blocked(conf);
    const limit = core.pyInt(conf.max_bytes);
    /** @type {Array<[string, string, number]>} */
    const found = located(command, cats).map(([line, cat, len]) => /** @type {[string, string, number]} */ (['command:' + line, cat, len]));
    const g = gitOnPath(env);
    if (!g) throw new core.PyError('GitNotFound');
    const ctx = { git: g, env, limit, cats };
    const seen = new Set();
    for (const a of acts) {
      if (a.kind === 'pr') {
        for (const f of bodyFiles(a.args, a.dir)) {
          const data = fs.readFileSync(f);
          if (data.length > limit) throw new core.PyError('TooLargeToCheck');
          for (const [line, cat, len] of located(new TextDecoder('utf-8').decode(data), cats)) found.push([f + ':' + line, cat, len]);
        }
      }
      const gitDir = a.kind === 'push' ? a.gitDir : null;
      const revs = a.kind === 'push' ? pushRevisions(a.args) : ['HEAD']; // gh pr create may push the branch
      const key = a.dir + '\0' + gitDir + '\0' + revs.join('\0');
      if (seen.has(key)) continue;
      seen.add(key);
      found.push(...outgoingFindings(ctx, a.dir, gitDir, revs));
    }
    if (!found.length) return pass;
    const names = core.CATEGORY_ORDER.filter((c) => found.some((f) => f[1] === c));
    return block([notice(conf, 'notice_outbound_blocked', { categories: names.join(', ') }),
      ...found.map(([where, cat, len]) => '  ' + where + ': ' + cat + ', ' + len + ' chars'),
      notice(conf, 'notice_outbound_fix')].join('\n'));
  } catch (e) {
    return block(notice(conf, 'notice_outbound_error', { error: errorClass(e) }));
  }
}

// --------------------------------------------------------------------------------------- the CLI

/** Read stdin up to max bytes (or its end). @param {NodeJS.ReadableStream} stdin @param {number} max @returns {Promise<Buffer>} */
function readUpTo(stdin, max) {
  return new Promise((resolve, reject) => {
    /** @type {Buffer[]} */
    const chunks = [];
    let n = 0;
    const done = () => {
      stdin.removeAllListeners('data');
      if (typeof (/** @type {any} */ (stdin).pause) === 'function') stdin.pause();
      resolve(Buffer.concat(chunks).subarray(0, max));
    };
    stdin.on('data', (/** @type {Buffer} */ c) => {
      chunks.push(c);
      n += c.length;
      if (n >= max) done();
    });
    stdin.on('end', done);
    stdin.on('error', reject);
  });
}

/**
 * The CLI. argv: the words after the script.
 * @param {string[]} argv @param {Record<string, string | undefined>} env
 * @param {{ stdin?: NodeJS.ReadableStream, deadlineMs?: number }} [io]
 * @returns {Promise<{ stdout: string, stderr: string, code: number }>}
 */
export async function run(argv, env, io = {}) {
  const [mode, ...rest] = argv;
  /** @type {string | null} */
  let config = null;
  /** @type {string | null} */
  let harness = null;
  let defer = false;
  while (rest.length) {
    const flag = /** @type {string} */ (rest.shift());
    if (flag === '--defer-to-paste-filter' && mode === 'prompt') defer = true;
    else if (flag === '--config' && rest.length) config = /** @type {string} */ (rest.shift());
    else if (flag === '--harness' && rest.length) harness = /** @type {string} */ (rest.shift());
    else return { stdout: '', stderr: 'pattern-check: unknown or incomplete argument: ' + flag + '\n', code: 2 };
  }
  if (!MODES.includes(mode) || !harness || !HARNESSES.includes(harness)) {
    return { stdout: '', stderr: 'usage: pattern-check.js prompt|pre-tool --harness claude|codex|kiro [--config FILE] [--defer-to-paste-filter]\n', code: 2 };
  }
  const h = harness;
  /** @param {string} error */
  const failed = (error) => {
    if (mode === 'pre-tool') return { stdout: '', stderr: core.pyFormat(NOTICES.notice_outbound_error, { error }) + '\n', code: 2 };
    const msg = core.pyFormat(NOTICES.notice_error, { error });
    return h === 'kiro' ? { stdout: '', stderr: msg + '\n', code: 0 } : { stdout: asciiJson({ systemMessage: msg }) + '\n', stderr: '', code: 0 };
  };
  let conf;
  try {
    conf = loadConfig(config, env);
  } catch (e) {
    return failed(errorClass(e));
  }
  const c = conf;
  /** @type {NodeJS.Timeout | undefined} */
  let timer;
  const deadline = new Promise((resolve) => {
    timer = setTimeout(() => resolve(failed('TimeoutError')), io.deadlineMs ?? DEADLINE_MS);
  });
  const work = (async () => {
    let raw;
    try {
      raw = await readUpTo(io.stdin || process.stdin, core.pyInt(c.max_bytes) * 6 + 65536 + 1);
    } catch (e) {
      return failed(errorClass(e));
    }
    return mode === 'prompt' ? promptCheck(c, h, raw, defer && pasteFilterBlocks(h, env)) : preToolCheck(c, raw, env);
  })();
  try {
    return /** @type {{ stdout: string, stderr: string, code: number }} */ (await Promise.race([work, deadline]));
  } finally {
    clearTimeout(timer);
  }
}

// Run directly: exit as soon as the answer is written, even if stdin stays open.
if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url))) {
  run(process.argv.slice(2), process.env).then((r) => {
    if (r.stdout) fs.writeSync(1, r.stdout);
    if (r.stderr) fs.writeSync(2, r.stderr);
    process.exit(r.code);
  }, () => process.exit(process.argv[2] === 'pre-tool' ? 2 : 0));
}
