// `mhw hook prompt --harness claude|codex|kiro [--config FILE]` (#488, S17 of #470; D6): the paste filter's
// UserPromptSubmit hook, ported from clipboard_guard.py's prompt-hook (ADR-0011, ADR-0033), with the same
// decision, the same redacted copy and the same exit contract on each agent harness:
//   claude, codex  one hook payload on stdin; a finding prints {"decision": "block", "reason": ...} (on
//                  Claude Code also suppressOriginalPrompt); a clean prompt prints NOTHING (plain stdout
//                  at exit 0 would become model context); anything that stops the check prints a visible
//                  {"systemMessage": ...} and the prompt passes (fail open, never silently). Always exit 0.
//   kiro           (Issue #455) never writes to stdout: a finding exits 2 with the block message on stderr;
//                  everything else exits 0, a warning or an error on stderr only, which Kiro drops on
//                  exit 0 (read from the bundle, kas 2.35.2, not measured). The wrapper's marker is ignored.
// In a session the paste wrapper started (PMHWC_PASTE_WRAPPER=1) the claude and codex modes read the
// payload and print nothing. A notice names categories and the mitigation, never the original text or a
// matched term; an error is named by its class only, because a message can quote the input. It writes
// nothing to disk.
//
// Two additions over the Python original, both toward visible: the decision has a deadline
// (DEADLINE_MS), after which the error notice is printed, so a stalled read is never left to the harness's
// own timeout; and src/commands/hook-entry.js prints the error notice when this file itself cannot load.
// node: modules only (convention 5 of #470; test/deps-graph.test.js).
import fs from 'node:fs';
import * as core from '../lib/clean.js';
import { WORD } from '../lib/clean-unicode.js';
import { readSalt } from '../lib/salt.js';
import { stockPython } from '../lib/keychain.js';

export const HARNESSES = Object.freeze(['claude', 'codex', 'kiro']);
export const WRAPPER_MARKER = 'PMHWC_PASTE_WRAPPER';
export const WRAPPER_MARKER_VALUE = '1';
/** The hook gives up visibly after this long; every agent harness here allows the hook 30 s. */
export const DEADLINE_MS = 20000;

/** The prompt hook's notices, verbatim from clipboard_guard.py's DEFAULTS. */
export const HOOK_NOTICES = Object.freeze({
  notice_blocked: 'Paste filter (ADR-0033): {categories} in this prompt. It was NOT sent, and nothing '
    + 'was changed. A redacted copy is below: submit that instead, or edit your prompt.',
  notice_cleaned_too_long: 'The redacted copy is {chars} characters, too long to show here.',
  notice_too_large: 'Paste filter (ADR-0033): this prompt is over {max} bytes and was NOT checked.',
  notice_error: 'Paste filter (ADR-0033): internal error ({error}); this prompt was NOT checked.',
  notice_no_salt: 'Paste filter (ADR-0033): the term list exists but its salt could not be read without '
    + 'a prompt (Keychain locked, slow or item missing), so term matching was NOT checked for '
    + 'this prompt (employer/client terms, health terms, colleague names).',
  notice_paste_redacted: 'Paste filter (ADR-0033): this prompt carries redacted text ({categories}); the '
    + 'original was not sent.',
  notice_report_only: 'Paste filter (ADR-0033): {categories} in this prompt (report-only: it was sent '
    + 'unchanged).',
});
/** Every key clipboard.conf may set, as clipboard_guard.py's DEFAULTS held them. */
export const DEFAULTS = Object.freeze({ ...core.DEFAULTS, ...HOOK_NOTICES });

const REDACTED_MARKER = new RegExp(String.raw`\[REDACTED:(` + core.CATEGORY_ORDER.join('|') + String.raw`)\]`, 'g');
/**
 * clipboard_guard.PASTE_MARKER_LINE.sub("", text): r"^</?pasted_content\b[^\n]*>\n?" with re.MULTILINE.
 * ^ is the start of the text or the position after a "\n" (never after "\r"); \b is the end of the word,
 * judged by the \w set CPython answers (src/lib/clean-unicode.js); [^\n]*> runs to the LAST ">" on the line.
 * @param {string} text
 */
export function stripPasteMarkers(text) {
  let out = '';
  let pos = 0;
  let line = 0;
  for (;;) {
    const nl = text.indexOf('\n', line);
    const end = nl < 0 ? text.length : nl;
    const head = text.startsWith('</pasted_content', line) ? 16 : text.startsWith('<pasted_content', line) ? 15 : 0;
    const next = text.codePointAt(line + head);
    const gt = head ? text.lastIndexOf('>', end - 1) : -1;
    if (head && (next === undefined || !core.inRanges(WORD, next)) && gt >= line + head) {
      out += text.slice(pos, line);
      pos = gt + 1 === nl ? nl + 1 : gt + 1;
    }
    if (nl < 0) break;
    line = nl + 1;
  }
  return out + text.slice(pos);
}

/**
 * True when this process runs inside a session the paste wrapper started (the marker is exactly set).
 * @param {Record<string, string | undefined>} env
 */
export function wrappedSession(env) {
  return env[WRAPPER_MARKER] === WRAPPER_MARKER_VALUE;
}

/**
 * clipboard_guard._format: the configured template, or the default when it has a bad placeholder.
 * @param {Record<string, string>} conf @param {string} key @param {Record<string, string | number>} [values]
 */
export function format(conf, key, values = {}) {
  try {
    return core.pyFormat(conf[key], values);
  } catch {
    return core.pyFormat(/** @type {Record<string, string>} */ (DEFAULTS)[key], values);
  }
}

/**
 * clipboard_guard.load_config() with the hook's notices known.
 * @param {string | null | undefined} file
 * @param {{ env?: Record<string, string | undefined>, platform?: string }} [opts]
 */
export function loadConfig(file, opts = {}) {
  return core.loadConfig(file, { ...opts, defaults: DEFAULTS });
}

/** The prompt's UTF-8 length, as Python's len(prompt.encode("utf-8")); which raises on a lone surrogate. @param {string} s */
function utf8Length(s) {
  let n = 0;
  for (const ch of s) {
    const cp = /** @type {number} */ (ch.codePointAt(0));
    if (cp >= 0xd800 && cp <= 0xdfff) throw new core.PyError('UnicodeEncodeError'); // as str.encode("utf-8") raises
    n += cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
  }
  return n;
}

/** Characters as Python counts them (code points). @param {string} s */
const pyLen = (s) => {
  let n = 0;
  for (const _ of s) n++; // eslint-disable-line no-unused-vars
  return n;
};

/**
 * @typedef {{ systemMessage: string } | { decision: 'block', reason: string,
 *   hookSpecificOutput?: { hookEventName: 'UserPromptSubmit', suppressOriginalPrompt: true } }} Decision
 * @typedef {{ get(): string | null }} Salts
 */

/**
 * clipboard_guard.prompt_decision(): the hook's whole judgement, as data. Returns the object to print, or
 * null to print nothing.
 * @param {Record<string, string>} conf
 * @param {string} prompt
 * @param {string} harness
 * @param {Salts} salts
 * @returns {Decision | null}
 */
export function promptDecision(conf, prompt, harness, salts) {
  if (utf8Length(prompt) > core.pyInt(conf.max_bytes)) return { systemMessage: format(conf, 'notice_too_large', { max: conf.max_bytes }) };
  /** @type {string[]} */
  const warnings = [];
  const [terms, lists] = core.readTermLists(conf);
  let salt = null;
  if (terms.size || Object.values(lists).some((h) => h.size)) {
    salt = salts.get();
    if (!salt) warnings.push(format(conf, 'notice_no_salt'));
  }
  const blocking = core.blockingSet(conf);
  const report = core.reportOnlySet(conf);
  const found = core.findSpans(prompt, terms, salt, lists);
  const spans = found.filter((s) => blocking.has(s[2]));
  const reported = core.categories(found.filter((s) => report.has(s[2])));
  if (reported.length) warnings.push(format(conf, 'notice_report_only', { categories: reported.join(', ') }));
  if (!spans.length) {
    // Text the paste wrapper (or an earlier block) already redacted: say so, by category only.
    const marked = new Set([...prompt.matchAll(REDACTED_MARKER)].map((m) => m[1]));
    if (marked.size) {
      warnings.push(format(conf, 'notice_paste_redacted', { categories: core.CATEGORY_ORDER.filter((c) => marked.has(c)).join(', ') }));
    }
    return warnings.length ? { systemMessage: warnings.join(' ') } : null;
  }
  // Claude Code may wrap an expanded paste in marker lines (documented); they are not the owner's text,
  // so they are dropped from the copy he would resubmit.
  const cleaned = stripPasteMarkers(core.sanitise(prompt, spans));
  const parts = [format(conf, 'notice_blocked', { categories: core.categories(spans).join(', ') }), ...warnings];
  const chars = pyLen(cleaned);
  if (chars <= core.pyInt(conf.show_cleaned_chars)) parts.push('\n' + cleaned);
  else parts.push(format(conf, 'notice_cleaned_too_long', { chars }));
  /** @type {Decision} */
  const out = { decision: 'block', reason: parts.join('\n') };
  if (harness === 'claude') out.hookSpecificOutput = { hookEventName: 'UserPromptSubmit', suppressOriginalPrompt: true };
  return out;
}

/**
 * Python's json.dumps(obj, ensure_ascii=True): ", " and ": " separators, every non-ASCII character
 * escaped as \uXXXX (a surrogate pair as two), so the output never depends on the hook's locale.
 * @param {unknown} obj
 */
export function pyJson(obj) {
  /** @param {unknown} v @returns {string} */
  const enc = (v) => {
    if (typeof v === 'string') {
      let s = '"';
      for (let i = 0; i < v.length; i++) {
        const c = v.charCodeAt(i);
        const ch = v[i];
        if (ch === '"') s += '\\"';
        else if (ch === '\\') s += '\\\\';
        else if (ch === '\n') s += '\\n';
        else if (ch === '\r') s += '\\r';
        else if (ch === '\t') s += '\\t';
        else if (ch === '\b') s += '\\b';
        else if (ch === '\f') s += '\\f';
        else if (c < 0x20 || c > 0x7e) s += '\\u' + c.toString(16).padStart(4, '0');
        else s += ch;
      }
      return s + '"';
    }
    if (v === true || v === false || v === null) return String(v);
    if (typeof v === 'number') return String(v);
    if (Array.isArray(v)) return '[' + v.map(enc).join(', ') + ']';
    return '{' + Object.entries(/** @type {Record<string, unknown>} */ (v)).map(([k, x]) => enc(k) + ': ' + enc(x)).join(', ') + '}';
  };
  return enc(obj);
}

/** The class name of an error, as Python names an exception; never its message. @param {unknown} e */
export function errorClass(e) {
  if (e instanceof core.PyError) return e.pyClass;
  if (e && typeof e === 'object' && 'code' in e && typeof (/** @type {any} */ (e).code) === 'string') return core.osErrorClass(e);
  return e instanceof Error ? e.name : 'Error';
}

/**
 * The payload's prompt. Python's json.loads of the UTF-8 bytes: a decoding error, invalid JSON, a
 * non-object or a prompt that is not a string all raise, and the hook reports the class.
 * @param {Buffer} raw
 * @returns {string}
 */
export function promptOf(raw) {
  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(raw);
  } catch {
    throw new core.PyError('UnicodeDecodeError');
  }
  if (text.startsWith('﻿')) throw new core.PyError('JSONDecodeError'); // json.loads refuses a BOM in a str
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new core.PyError('JSONDecodeError');
  }
  const prompt = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload.prompt : undefined;
  if (typeof prompt !== 'string') throw new core.PyError('ValueError');
  return prompt;
}

/**
 * The decision for one raw payload, as clipboard_guard.cmd_prompt_hook() computed it.
 * @param {Record<string, string>} conf
 * @param {string} harness
 * @param {Buffer} raw  at most limit + 1 bytes
 * @param {Salts} salts
 * @param {Record<string, string | undefined>} env
 * @returns {Decision | null}
 */
export function decide(conf, harness, raw, salts, env) {
  const limit = core.pyInt(conf.max_bytes) * 6 + 65536; // JSON escaping can inflate the prompt (\uXXXX)
  try {
    if (harness !== 'kiro' && wrappedSession(env)) return null; // the wrapper is the primary mechanism here
    if (raw.length > limit) return { systemMessage: format(conf, 'notice_too_large', { max: conf.max_bytes }) };
    return promptDecision(conf, promptOf(raw), harness, salts);
  } catch (e) {
    return { systemMessage: format(conf, 'notice_error', { error: errorClass(e) }) };
  }
}

/**
 * What the hook writes, and its exit code.
 * @param {string} harness
 * @param {Decision | null} out
 * @returns {{ stdout: string, stderr: string, code: number }}
 */
export function emit(harness, out) {
  if (harness === 'kiro') {
    if (out === null) return { stdout: '', stderr: '', code: 0 };
    const block = 'decision' in out;
    return { stdout: '', stderr: (block ? out.reason : out.systemMessage) + '\n', code: block ? 2 : 0 };
  }
  return { stdout: out === null ? '' : pyJson(out) + '\n', stderr: '', code: 0 };
}

/**
 * The error notice for a check that could not run, in the harness's protocol; never names the input.
 * @param {string} harness
 * @param {string} error the class name
 * @param {string} [template]
 */
export function errorOutput(harness, error, template = HOOK_NOTICES.notice_error) {
  let msg;
  try {
    msg = core.pyFormat(template, { error });
  } catch {
    msg = core.pyFormat(HOOK_NOTICES.notice_error, { error });
  }
  return emit(harness, { systemMessage: msg });
}

/**
 * Read stdin up to max bytes (or its end), as Python's stdin.read(n).
 * @param {NodeJS.ReadableStream} stdin
 * @param {number} max
 * @returns {Promise<Buffer>}
 */
function readUpTo(stdin, max) {
  return new Promise((resolve, reject) => {
    /** @type {Buffer[]} */
    const chunks = [];
    let n = 0;
    const done = () => {
      stdin.removeListener('data', onData);
      stdin.removeListener('end', done);
      stdin.removeListener('error', onError);
      if (typeof (/** @type {any} */ (stdin).pause) === 'function') stdin.pause();
      resolve(Buffer.concat(chunks).subarray(0, max));
    };
    /** @param {Buffer} c */
    const onData = (c) => {
      chunks.push(c);
      n += c.length;
      if (n >= max) done();
    };
    /** @param {Error} e */
    const onError = (e) => {
      stdin.removeListener('data', onData);
      stdin.removeListener('end', done);
      reject(e);
    };
    stdin.on('data', onData);
    stdin.on('end', done);
    stdin.on('error', onError);
  });
}

/**
 * The Keychain context the hook reads its salt with: the stock python3 for the lock probe (never one on
 * PATH: the admin layer's point is that no owner-run process can swap what the hook runs).
 * @param {Record<string, string | undefined>} env
 * @param {string} platform
 */
function keychainCtx(env, platform) {
  return { platform, env, python: stockPython(platform) };
}

/**
 * The deadline: DEADLINE_MS, or a shorter one from MHW_HOOK_DEADLINE_MS (tests: a whole number of
 * milliseconds below DEADLINE_MS). It can only shorten the wait, and expiry is always reported visibly.
 * @param {Record<string, string | undefined>} env
 */
export function deadlineOf(env) {
  const v = env.MHW_HOOK_DEADLINE_MS || '';
  return /^\d{1,6}$/.test(v) && Number(v) > 0 && Number(v) < DEADLINE_MS ? Number(v) : DEADLINE_MS;
}

/**
 * The CLI. argv: the words after `mhw hook prompt`.
 * @param {string[]} argv
 * @param {Record<string, string | undefined>} env
 * @param {{ stdin?: NodeJS.ReadableStream, platform?: string, salts?: Salts, deadlineMs?: number }} [io]
 * @returns {Promise<{ stdout: string, stderr: string, code: number }>}
 */
export async function run(argv, env, io = {}) {
  let config = null;
  let harness = null;
  const rest = [...argv];
  while (rest.length) {
    const flag = /** @type {string} */ (rest.shift());
    if (flag === '--config' && rest.length) config = rest.shift();
    else if (flag === '--harness' && rest.length) harness = rest.shift();
    else return { stdout: '', stderr: 'unknown or incomplete argument: ' + flag + ' (no term is ever taken from arguments)\n', code: 2 };
  }
  if (!harness || !HARNESSES.includes(harness)) {
    return { stdout: '', stderr: 'prompt-hook: --harness must be one of ' + HARNESSES.join(', ') + '\n', code: 2 };
  }
  const platform = io.platform || process.platform;
  let conf;
  try {
    conf = loadConfig(config, { env, platform });
  } catch (e) {
    return errorOutput(harness, errorClass(e)); // an unreadable settings file: visible, and the prompt passes
  }
  const salts = io.salts || { get: () => readSalt(keychainCtx(env, platform), /** @type {Record<string, string>} */ (conf)).salt };
  const h = harness;
  const c = conf;
  /** @type {NodeJS.Timeout | undefined} */
  let timer;
  const deadline = new Promise((resolve) => {
    timer = setTimeout(() => resolve(errorOutput(h, 'TimeoutError', c.notice_error)), io.deadlineMs ?? deadlineOf(env));
  });
  const work = (async () => {
    let raw;
    try {
      raw = await readUpTo(io.stdin || process.stdin, core.pyInt(c.max_bytes) * 6 + 65536 + 1);
    } catch (e) {
      return emit(h, { systemMessage: format(c, 'notice_error', { error: errorClass(e) }) });
    }
    return emit(h, decide(c, h, raw, salts, env));
  })();
  try {
    return /** @type {{ stdout: string, stderr: string, code: number }} */ (await Promise.race([work, deadline]));
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Run and write, for the entry point; resolves to the exit code.
 * @param {string[]} argv
 * @param {Record<string, string | undefined>} env
 */
export async function main(argv, env) {
  const r = await run(argv, env);
  if (r.stdout) fs.writeSync(1, r.stdout);
  if (r.stderr) fs.writeSync(2, r.stderr);
  return r.code;
}

/**
 * `mhw hook check-config [--config FILE]`: the effective non-secret settings and the size of each term
 * list, as clipboard_guard.py check-config printed them.
 * @param {string[]} argv
 * @param {Record<string, string | undefined>} env
 * @param {{ platform?: string }} [opts]
 * @returns {{ stdout: string, stderr: string, code: number }}
 */
export function checkConfig(argv, env, opts = {}) {
  let config = null;
  const rest = [...argv];
  while (rest.length) {
    const flag = /** @type {string} */ (rest.shift());
    if (flag === '--config' && rest.length) config = rest.shift();
    else return { stdout: '', stderr: 'unknown or incomplete argument: ' + flag + ' (no term is ever taken from arguments)\n', code: 2 };
  }
  let conf;
  try {
    conf = loadConfig(config, { env, platform: opts.platform || process.platform });
  } catch (e) {
    return { stdout: '', stderr: 'mhw hook check-config: the settings file could not be read (' + errorClass(e) + ')\n', code: 1 };
  }
  let out = '';
  for (const key of ['max_bytes', 'block_categories', 'report_categories', 'show_cleaned_chars', 'salt_store',
    'keychain_service', 'keychain_path', 'terms_file', 'health_terms_file', 'colleague_terms_file', 'salt_file']) {
    out += key + '=' + conf[key] + '\n';
  }
  out += 'terms=' + core.readTerms(conf.terms_file).size + '\n';
  for (const [cat, key] of Object.entries(core.TERM_LISTS)) out += cat.replaceAll('-', '_') + '_terms=' + core.readTerms(conf[key]).size + '\n';
  return { stdout: out, stderr: '', code: 0 };
}
