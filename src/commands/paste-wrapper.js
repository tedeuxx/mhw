// mhw paste-wrapper, the paste filter at the CLI session's paste boundary (ADR-0033), in Node since #487
// (S16 of #470). It replaces global/clipboard/paste_wrapper.py, deleted in the same slice; test/golden/S16/
// holds the original's answers. A launcher that starts a harness CLI (claude, codex, kiro-cli) as a child
// on a pseudo-terminal and relays every byte both ways. In the bytes the terminal sends, it watches for a
// bracketed paste (ESC[200~ ... ESC[201~) and replaces the pasted payload with its redacted version, using
// the cleaning core (src/lib/clean.js), before the CLI sees it. Everything else passes through unchanged,
// byte for byte.
//
//   mhw paste-wrapper run [--config FILE] [--grace SECONDS] -- <program> [args...]
//   mhw paste-wrapper check      exit 0 when the pty library loads here; otherwise the reason, exit 1
//
// The owner activates it with shell functions he sources himself (the installer renders them into a
// managed snippet and never edits a shell rc). `command claude` bypasses it.
//
// Properties this file must keep, each with a test in test/clipboard/paste-wrapper.test.js:
//   - typed input (anything outside a bracketed paste) reaches the CLI byte for byte, and so does a
//     paste with no finding; output from the CLI reaches the terminal byte for byte;
//   - a paste with a finding reaches the CLI with each finding replaced by [REDACTED:<category>]; the
//     original payload is never forwarded, and a paste it cannot check (too large, internal error) is
//     replaced by a one-line notice instead of being forwarded unchecked. "Never" holds for a paste whose
//     start marker arrives as one piece, or split at any byte with the pieces at most
//     HOLD_SEQUENCE_SECONDS apart; a split marker whose halves are further apart than that is not
//     recognised and its paste passes as typing (stated in ADR-0011's limits);
//   - it writes NO file, keeps no log or record of what matched (ADR-0005), never reads or writes the
//     system clipboard, and calls no dialog, notification or launchd tool;
//   - window size, the four forwarded signals, the CLI stopping (job control), the terminal mode and the
//     exit status are relayed, and the terminal's mode is restored on every exit path;
//   - when the CLI never enables bracketed paste, nothing can be cleaned, and the owner is told so in one
//     line; for kiro-cli that line also says whether this project's Kiro prompt hook is installed;
//   - every notice names categories only, never the pasted content or a matched term;
//   - the CLI it relays for gets the session marker (PMHWC_PASTE_WRAPPER=1), so the prompt hook, kept as
//     the safety net, passes its prompts silently; a CLI it only execs (not a terminal) gets it removed;
//   - when the pty library is unavailable (no prebuild for this platform, a spawn-helper without its
//     execute bit, a module that does not load), it REFUSES: one line on stderr naming the reason and
//     `command <program>`, exit 126. It never runs the CLI unwrapped on a terminal. `mhw status` names
//     the same reason (the PASTE line).
// node: modules and the vendored pty library only (convention 5 of #470); the pty is loaded at run time.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync, execFile } from 'node:child_process';
import * as core from '../lib/clean.js';
import { onPath } from '../lib/onpath.js';
import { readSalt } from '../lib/salt.js';
import { loadPty, PTY_NAME } from '../lib/pty.js';

export const PASTE_START = Buffer.from('\x1b[200~', 'latin1');
export const PASTE_END = Buffer.from('\x1b[201~', 'latin1');
const ESC = Buffer.from([0x1b]);
// A possible start of a paste marker split across two reads is held before it is forwarded as typed
// input. A lone ESC is held at most HOLD_SECONDS (it is usually the Escape key). A longer prefix (ESC[,
// ESC[2, ESC[20, ESC[200) is only ever the head of a sequence the terminal writes at once, so it is held up
// to HOLD_SEQUENCE_SECONDS: a split marker delayed by a loaded host must still be recognised. A lone ESC
// that WAS released after its hold is not the end of it either: if the next input, within
// HOLD_SEQUENCE_SECONDS, is "[200~", the marker was split after its first byte; the CLI already has the
// ESC, so the wrapper forwards "[200~" + the cleaned payload + the end marker (QA, PR #23).
export const HOLD_SECONDS = 0.025;
export const HOLD_SEQUENCE_SECONDS = 1.0;
// A paste whose end marker has not arrived after this much silence is closed and cleaned as it stands.
export const PASTE_IDLE_SECONDS = 2.0;
// How long the CLI may run without enabling bracketed paste before the owner is warned.
export const GRACE_SECONDS = 5.0;
// After the CLI exits, its output is drained until it has been quiet this long.
export const EXIT_DRAIN_SECONDS = 0.2;
// node-pty reports an exit, never a stop: the CLI's state is read this often to relay job control.
export const STOP_POLL_MS = 250;
export const WRAPPER_MARKER = 'PMHWC_PASTE_WRAPPER';
export const WRAPPER_MARKER_VALUE = '1';
export const KIRO_HOOK_FILE = core.PROJECT + '-paste-filter.json';
// Exit status when the pty library cannot be used: the POSIX "found but cannot execute".
export const REFUSED = 126;
// DEC private mode set/reset; the parameter list is digits and semicolons only (no backtracking).
const MODE_RE = /\x1b\[\?([0-9;]*)([hl])/g;

/** Seconds, monotonic. */
const monotonic = () => Number(process.hrtime.bigint()) / 1e9;

/**
 * Length of the longest proper prefix of marker that buf ends with (0 if none).
 * @param {Buffer} buf @param {Buffer} marker
 */
export function prefixTail(buf, marker) {
  for (let k = Math.min(marker.length - 1, buf.length); k > 0; k--) {
    if (buf.subarray(buf.length - k).equals(marker.subarray(0, k))) return k;
  }
  return 0;
}

/**
 * @typedef {((payload: Buffer) => [Buffer, string[]]) & { reportedPastes: number, reported: Set<string> }} Cleaner
 */

/**
 * The input-side state machine. feed() takes bytes from the terminal and returns the bytes to send to the
 * CLI; flush(now) releases what was held when its deadline has passed. clean maps a paste payload to
 * [payload to forward, categories]; it may throw, and the paste is then replaced by a notice. Nothing
 * here keeps a copy of a payload once it has been forwarded.
 */
export class PasteFilter {
  /**
   * @param {(payload: Buffer) => [Buffer, string[]]} clean
   * @param {number} maxBytes
   * @param {{ too_large: string, error: string }} notices already formatted; error keeps {error}
   * @param {() => number} [clock] seconds
   */
  constructor(clean, maxBytes, notices, clock = monotonic) {
    this.clean = clean;
    this.maxBytes = maxBytes;
    this.notices = notices;
    this.clock = clock;
    this.held = Buffer.alloc(0); // outside a paste: a possible prefix of PASTE_START
    /** @type {number | null} */ this.heldAt = null;
    /** @type {number | null} */ this.escReleasedAt = null; // a lone ESC was released as typing at this time
    this.opener = PASTE_START; // what precedes the cleaned payload when a paste is forwarded
    this.inPaste = false;
    /** @type {Buffer[]} */ this.parts = [];
    this.bodyLength = 0;
    this.tooLarge = false;
    /** @type {number | null} */ this.lastInput = null;
    this.cleaned = 0; // pastes that had a finding
    /** @type {Set<string>} */ this.categories = new Set();
    this.replaced = 0; // pastes replaced by a notice (too large, error)
  }

  /** @returns {number | null} */
  deadline() {
    if (this.inPaste) return /** @type {number} */ (this.lastInput) + PASTE_IDLE_SECONDS;
    if (this.held.length) {
      return /** @type {number} */ (this.heldAt) + (this.held.length === 1 && this.held[0] === 0x1b ? HOLD_SECONDS : HOLD_SEQUENCE_SECONDS);
    }
    return null;
  }

  body() {
    const b = Buffer.concat(this.parts);
    this.parts = [b];
    return b;
  }

  startPaste() {
    this.inPaste = true;
    this.parts = [];
    this.bodyLength = 0;
    this.tooLarge = false;
  }

  /** @param {Buffer} data @returns {Buffer} */
  feed(data) {
    const now = this.clock();
    this.lastInput = now;
    /** @type {Buffer[]} */
    const out = [];
    let buf = Buffer.concat([this.held, data]);
    this.held = Buffer.alloc(0);
    const rest = PASTE_START.subarray(1);
    while (buf.length) {
      if (!this.inPaste && this.escReleasedAt !== null) {
        if (now - this.escReleasedAt <= HOLD_SEQUENCE_SECONDS) {
          if (buf.length >= rest.length && buf.subarray(0, rest.length).equals(rest)) {
            buf = buf.subarray(rest.length);
            this.escReleasedAt = null;
            this.startPaste();
            this.opener = rest; // the ESC is already with the CLI
            continue;
          }
          if (buf.length < rest.length && rest.subarray(0, buf.length).equals(buf)) {
            this.held = Buffer.from(buf); // "[", "[2" ...: wait for the rest
            this.heldAt = now;
            break;
          }
        }
        this.escReleasedAt = null;
      }
      if (!this.inPaste) {
        const i = buf.indexOf(PASTE_START);
        if (i < 0) {
          const keep = prefixTail(buf, PASTE_START);
          out.push(buf.subarray(0, buf.length - keep));
          if (keep) {
            this.held = Buffer.from(buf.subarray(buf.length - keep));
            this.heldAt = now;
          }
          break;
        }
        out.push(buf.subarray(0, i));
        buf = buf.subarray(i + PASTE_START.length);
        this.startPaste();
        this.opener = PASTE_START;
      } else {
        // The end marker can straddle the previous chunk: search the body's last bytes plus this chunk,
        // never the body's own length (which append may have trimmed).
        const body = this.body();
        const k = Math.min(PASTE_END.length - 1, body.length);
        const window = Buffer.concat([body.subarray(body.length - k), buf]);
        const j = window.indexOf(PASTE_END);
        if (j < 0) {
          this.append(buf);
          break;
        }
        const cut = j - k; // where the marker starts in buf; negative: in the body
        if (cut < 0) {
          this.parts = [body.subarray(0, body.length + cut)];
          this.bodyLength = body.length + cut;
        } else {
          this.append(buf.subarray(0, cut));
        }
        out.push(this.finish());
        buf = window.subarray(j + PASTE_END.length);
      }
    }
    return Buffer.concat(out);
  }

  /** @param {Buffer} data */
  append(data) {
    this.parts.push(Buffer.from(data));
    this.bodyLength += data.length;
    if (this.bodyLength > this.maxBytes) {
      // Over the limit: the payload is gone. Keep only the bytes that could begin the end marker.
      this.tooLarge = true;
      const b = this.body();
      const keep = b.subarray(Math.max(0, b.length - (PASTE_END.length - 1)));
      this.parts = [Buffer.from(keep)];
      this.bodyLength = keep.length;
    }
  }

  /** @param {number} [now] @returns {Buffer} */
  flush(now) {
    const t = now === undefined ? this.clock() : now;
    const d = this.deadline();
    if (d === null || t < d) return Buffer.alloc(0);
    if (this.inPaste) return this.finish(); // the end marker never came: clean what arrived
    const out = this.held;
    this.held = Buffer.alloc(0);
    this.escReleasedAt = out.equals(ESC) ? t : null;
    return out;
  }

  /** @returns {Buffer} */
  finish() {
    const body = this.body();
    const tooLarge = this.tooLarge;
    this.inPaste = false;
    this.parts = [];
    this.bodyLength = 0;
    this.tooLarge = false;
    /** @type {Buffer} */
    let payload;
    if (tooLarge || body.length > this.maxBytes) {
      this.replaced += 1;
      payload = Buffer.from(this.notices.too_large, 'utf8');
    } else {
      try {
        const [p, cats] = this.clean(body);
        payload = p;
        if (cats.length) {
          this.cleaned += 1;
          for (const c of cats) this.categories.add(c);
        }
      } catch (e) {
        // never forward what could not be checked
        this.replaced += 1;
        payload = Buffer.from(this.notices.error.replaceAll('{error}', errorName(e)), 'utf8');
      }
    }
    return Buffer.concat([this.opener, payload, PASTE_END]);
  }
}

/** The class name Python would print for an exception. @param {unknown} e */
function errorName(e) {
  return e instanceof Error ? e.name || 'Error' : 'Error';
}

/** Watches the CLI's output for DEC private mode 2004 (bracketed paste) being set or reset. */
export class ModeTracker {
  /** @param {() => number} [clock] */
  constructor(clock = monotonic) {
    this.clock = clock;
    this.tail = '';
    this.enabled = false;
    this.ever = false;
    /** @type {number | null} */ this.offSince = null; // when the CLI turned the mode off after having turned it on
  }

  /** @param {Buffer} data */
  feed(data) {
    const buf = this.tail + data.toString('latin1');
    /** @type {RegExpExecArray | null} */
    let last = null;
    for (const m of buf.matchAll(MODE_RE)) {
      if (m[1].split(';').includes('2004')) last = m;
    }
    const lastEnd = last ? last.index + last[0].length : 0;
    if (last && lastEnd > this.tail.length) {
      const was = this.enabled;
      this.enabled = last[2] === 'h';
      this.ever = this.ever || this.enabled;
      if (was && !this.enabled) this.offSince = this.clock();
      else if (this.enabled) this.offSince = null;
    }
    // Keep a tail long enough to hold a sequence split across reads, but not one already applied.
    this.tail = buf.slice(Math.max(buf.length - 64, lastEnd));
  }
}

/**
 * The paste cleaner. Only block_categories are replaced. A report-only category (Issue #36) is forwarded
 * unchanged and only counted (reportedPastes, reported), for the session summary; never the text.
 * @param {Record<string, string>} conf
 * @param {Set<string>} terms
 * @param {string | null} salt
 * @param {Record<string, Set<string>>} [termLists]
 * @returns {Cleaner}
 */
export function makeCleaner(conf, terms, salt, termLists = {}) {
  const wanted = core.blockingSet(conf);
  const report = core.reportOnlySet(conf);
  /** @type {Cleaner} */
  const clean = Object.assign(
    /** @param {Buffer} payload @returns {[Buffer, string[]]} */
    (payload) => {
      const [text, units] = decodeEscaped(payload);
      const found = core.findSpans(text, terms, salt, termLists);
      const reported = core.categories(found.filter((s) => report.has(s[2])));
      if (reported.length) {
        clean.reportedPastes += 1;
        for (const c of reported) clean.reported.add(c);
      }
      const spans = found.filter((s) => wanted.has(s[2]));
      if (!spans.length) return [payload, []];
      return [encodeEscaped(core.sanitise(text, spans), units), core.categories(spans)];
    },
    { reportedPastes: 0, reported: new Set() },
  );
  return clean;
}

// Python decodes a paste with utf-8 and surrogateescape: each byte that is not part of valid UTF-8
// becomes a lone surrogate U+DC80..U+DCFF, and encoding back restores it. These two functions do the
// same, so a payload with invalid UTF-8 round-trips byte for byte around the [REDACTED:...] markers.
/**
 * @param {Buffer} buf
 * @returns {[string, null]}
 */
export function decodeEscaped(buf) {
  let out = '';
  let i = 0;
  while (i < buf.length) {
    const b = buf[i];
    const n = b < 0x80 ? 1 : b >= 0xc2 && b <= 0xdf ? 2 : b >= 0xe0 && b <= 0xef ? 3 : b >= 0xf0 && b <= 0xf4 ? 4 : 0;
    if (n === 1) {
      out += String.fromCharCode(b);
      i += 1;
      continue;
    }
    if (n && i + n <= buf.length && validSequence(buf, i, n)) {
      out += buf.toString('utf8', i, i + n);
      i += n;
      continue;
    }
    out += String.fromCharCode(0xdc00 + b);
    i += 1;
  }
  return [out, null];
}

/** Is buf[i..i+n) one well-formed UTF-8 sequence (no overlong, no surrogate, at most U+10FFFF)? */
function validSequence(/** @type {Buffer} */ buf, /** @type {number} */ i, /** @type {number} */ n) {
  for (let k = 1; k < n; k++) if ((buf[i + k] & 0xc0) !== 0x80) return false;
  const b0 = buf[i];
  const b1 = buf[i + 1];
  if (n === 3) {
    if (b0 === 0xe0 && b1 < 0xa0) return false;
    if (b0 === 0xed && b1 >= 0xa0) return false;
  }
  if (n === 4) {
    if (b0 === 0xf0 && b1 < 0x90) return false;
    if (b0 === 0xf4 && b1 >= 0x90) return false;
  }
  return true;
}

/**
 * @param {string} text
 * @param {null} _units
 * @returns {Buffer}
 */
export function encodeEscaped(text, _units) {
  /** @type {Buffer[]} */
  const out = [];
  let run = '';
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c >= 0xdc80 && c <= 0xdcff && !(i > 0 && isHigh(text.charCodeAt(i - 1)))) {
      if (run) out.push(Buffer.from(run, 'utf8'));
      run = '';
      out.push(Buffer.from([c - 0xdc00]));
    } else {
      run += text[i];
    }
  }
  if (run) out.push(Buffer.from(run, 'utf8'));
  return Buffer.concat(out);
}

/** @param {number} c */
const isHigh = (c) => c >= 0xd800 && c <= 0xdbff;

/**
 * Python's str.format for the notice templates: {name} and the {{ }} escapes. Anything else (a format
 * spec, a conversion, a positional field, a name not given) throws, as the Python call raised.
 * @param {string} template
 * @param {Record<string, string | number>} values
 */
export function pyFormat(template, values) {
  let out = '';
  let i = 0;
  while (i < template.length) {
    const c = template[i];
    if (c === '{' && template[i + 1] === '{') {
      out += '{';
      i += 2;
    } else if (c === '}' && template[i + 1] === '}') {
      out += '}';
      i += 2;
    } else if (c === '{') {
      const end = template.indexOf('}', i);
      if (end < 0) throw new Error('ValueError');
      const name = template.slice(i + 1, end);
      if (!/^[A-Za-z_]\w*$/.test(name) || !Object.hasOwn(values, name)) throw new Error('KeyError');
      out += String(values[name]);
      i = end + 1;
    } else if (c === '}') {
      throw new Error('ValueError');
    } else {
      out += c;
      i += 1;
    }
  }
  return out;
}

/**
 * clipboard_guard._format: the configured template, or the default when it has a bad placeholder.
 * @param {Record<string, string>} conf
 * @param {string} key
 * @param {Record<string, string | number>} values
 */
export function format(conf, key, values = {}) {
  try {
    return pyFormat(conf[key], values);
  } catch {
    return pyFormat(core.DEFAULTS[key], values); // an overlay template with a bad placeholder
  }
}

/** One line. @param {Record<string, string>} conf @param {string} key @param {Record<string, string | number>} [values] */
export function notice(conf, key, values = {}) {
  return format(conf, key, values).replaceAll('\r', ' ').replaceAll('\n', ' ');
}

/**
 * True when the managed Kiro hook file is there and runs the core in its kiro mode. A read only: the
 * file can be present and still not run (an untrusted workspace, a V2 engine).
 * @param {string} home
 */
export function kiroHookInstalled(home) {
  let text;
  try {
    const fd = fs.openSync(path.join(home, '.kiro', 'hooks', KIRO_HOOK_FILE), 'r');
    try {
      const buf = Buffer.alloc(65536 * 4);
      text = new TextDecoder('utf-8', { fatal: true }).decode(buf.subarray(0, fs.readSync(fd, buf, 0, buf.length, 0))).slice(0, 65536);
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return false;
  }
  return text.includes('managed-by: ' + core.PROJECT) && text.includes('prompt-hook --harness kiro');
}

/**
 * A "pastes are NOT cleaned" notice. For kiro-cli it adds who checks now (Issue #455).
 * @param {Record<string, string>} conf
 * @param {string} key
 * @param {string} argv0
 * @param {string} home
 */
export function noPasteNotice(conf, key, argv0, home) {
  let text = notice(conf, key, { program: argv0 });
  if (path.basename(argv0) === 'kiro-cli') {
    text += ' ' + notice(conf, kiroHookInstalled(home) ? 'notice_kiro_hook_on' : 'notice_kiro_hook_off');
  }
  return text;
}

/**
 * Whether the session may be marked, given the CLI's command-line arguments (PR #90 lens finding). A
 * prompt passed as an argument never crosses the terminal as a paste, so the wrapper cannot clean it. An
 * argument with a finding, or one that cannot be checked (a cleaner error, or a term list whose salt is
 * unreadable), leaves the marker unset, and the prompt hook judges the session. Returns [marked, categories].
 * @param {(payload: Buffer) => [Buffer, string[]]} cleaner
 * @param {string[]} args
 * @param {boolean} noSalt
 * @returns {[boolean, string[]]}
 */
export function argsAllowMarker(cleaner, args, noSalt) {
  /** @type {Set<string>} */
  const found = new Set();
  for (const a of args) {
    try {
      for (const c of cleaner(Buffer.from(a, 'utf8'))[1]) found.add(c);
    } catch {
      return [false, core.CATEGORY_ORDER.filter((c) => found.has(c))];
    }
  }
  if (found.size) return [false, core.CATEGORY_ORDER.filter((c) => found.has(c))];
  if (args.length && noSalt) return [false, []];
  return [true, []];
}

/** The environment a child gets: the marker removed, and set only when marked. */
export function childEnv(/** @type {Record<string, string | undefined>} */ env, /** @type {boolean} */ marked) {
  /** @type {Record<string, string>} */
  const out = {};
  for (const [k, v] of Object.entries(env)) if (v !== undefined && k !== WRAPPER_MARKER) out[k] = v;
  if (marked) out[WRAPPER_MARKER] = WRAPPER_MARKER_VALUE;
  return out;
}

/**
 * The refusal when the pty library cannot be used: one line, the reason and the bypass.
 * @param {string} argv0 @param {string} reason
 */
export function refusal(argv0, reason) {
  return 'Paste filter (ADR-0033): ' + argv0 + ' was NOT started: the paste wrapper needs its pty library and '
    + reason + '. Run `command ' + path.basename(argv0) + '` to start it without paste cleaning (the prompt hook '
    + 'still checks each prompt where it is installed); `mhw status` names the same reason.';
}

/**
 * Run real on a pty and relay. Resolves with the exit status to exit with.
 * @param {import('../lib/pty.js').PtyModule} ptyModule
 * @param {string} real
 * @param {string} argv0
 * @param {string[]} args
 * @param {Record<string, string>} conf
 * @param {{ env: Record<string, string | undefined>, grace?: number, stdin?: NodeJS.ReadStream, stdout?: NodeJS.WriteStream,
 *   stderr?: NodeJS.WriteStream, platform?: string }} opts
 * @returns {Promise<number>}
 */
export function relay(ptyModule, real, argv0, args, conf, opts) {
  const env = opts.env;
  const grace = opts.grace ?? GRACE_SECONDS;
  const stdin = opts.stdin || process.stdin;
  const stdout = opts.stdout || process.stdout;
  const stderr = opts.stderr || process.stderr;
  const platform = opts.platform || process.platform;
  const home = env.HOME || os.homedir();
  /** @param {string} line */
  const say = (line) => stderr.write(line + '\n');

  const [terms, lists] = core.readTermLists(conf);
  let salt = null;
  let noSalt = false;
  if (terms.size || Object.values(lists).some((h) => h.size)) {
    salt = readSalt({ platform, python: onPath('python3', env, platform), env }, conf).salt;
    if (!salt) {
      noSalt = true;
      say(notice(conf, 'notice_wrapper_no_salt'));
    }
  }
  const cleaner = makeCleaner(conf, terms, salt, lists);
  const [marked, argCategories] = argsAllowMarker(cleaner, args, noSalt);
  cleaner.reportedPastes = 0; // the arguments are not pastes
  cleaner.reported = new Set();
  if (!marked) say(notice(conf, 'notice_wrapper_args_unmarked', { categories: argCategories.join(', ') || '-' }));
  const filt = new PasteFilter(cleaner, Number(conf.max_bytes), {
    too_large: notice(conf, 'notice_paste_too_large', { max: conf.max_bytes }),
    error: notice(conf, 'notice_paste_error', { error: '{error}' }),
  });
  const mode = new ModeTracker();

  const [cols, rows] = windowSize(stdout);
  const term = ptyModule.spawn(real, args, {
    name: env.TERM || 'xterm-256color', cols, rows, cwd: process.cwd(), env: childEnv(env, marked), encoding: null,
  });

  return new Promise((resolve) => {
    const start = monotonic();
    /** @type {number | null} */ let status = null;
    let exitedAt = 0;
    let warned = false;
    /** @type {number | null} */ let warnedOff = null;
    let done = false;
    /** @type {NodeJS.Timeout | null} */ let timer = null;
    /** @type {NodeJS.Timeout | null} */ let poll = null;
    let polling = false;

    /** @param {Buffer} data */
    const toChild = (data) => {
      if (data.length) term.write(data);
    };
    /** @param {string} key */
    const banner = (key) => stdout.write('\r\n' + noPasteNotice(conf, key, argv0, home) + '\r\n');
    const resize = () => {
      const [c, r] = windowSize(stdout);
      try {
        term.resize(c, r); // the kernel signals the CLI's process group
      } catch {
        // the CLI is gone
      }
    };
    const setRaw = () => {
      if (stdin.isTTY) stdin.setRawMode(true);
    };
    const restore = () => {
      if (stdin.isTTY) stdin.setRawMode(false);
    };

    const tick = () => {
      if (done) return;
      const now = monotonic();
      toChild(filt.flush(now));
      if (!warned && !mode.ever && now >= start + grace) {
        warned = true;
        banner('notice_no_bracketed_paste');
      }
      // Turned off mid-session and still off after the grace period (a CLI that is merely exiting turns
      // it off too, and is gone by then): say pastes are no longer cleaned.
      if (mode.offSince !== null && warnedOff !== mode.offSince && status === null && now >= mode.offSince + grace) {
        warnedOff = mode.offSince;
        banner('notice_bracketed_paste_off');
      }
      if (status !== null && now >= exitedAt + EXIT_DRAIN_SECONDS) {
        finish();
        return;
      }
      schedule();
    };
    const schedule = () => {
      if (timer) clearTimeout(timer);
      timer = null;
      const now = monotonic();
      /** @type {number[]} */
      const deadlines = [];
      const d = filt.deadline();
      if (d !== null) deadlines.push(d);
      if (!warned && !mode.ever) deadlines.push(start + grace);
      if (mode.offSince !== null && warnedOff !== mode.offSince && status === null) deadlines.push(mode.offSince + grace);
      if (status !== null) deadlines.push(exitedAt + EXIT_DRAIN_SECONDS);
      if (!deadlines.length) return;
      timer = setTimeout(tick, Math.max(0, Math.ceil((Math.min(...deadlines) - now) * 1000)));
    };

    /** @param {Buffer} data */
    const onInput = (data) => {
      toChild(filt.feed(Buffer.isBuffer(data) ? data : Buffer.from(data)));
      toChild(filt.flush());
      schedule();
    };
    const onEnd = () => {
      // the terminal went away; the CLI gets SIGHUP from its own
      stdin.off('data', onInput);
    };
    /** @type {Record<string, () => void>} */
    const handlers = {};
    for (const sig of ['SIGTERM', 'SIGHUP', 'SIGINT', 'SIGQUIT']) {
      handlers[sig] = () => {
        try {
          term.kill(sig);
        } catch {
          // already gone
        }
      };
    }
    handlers.SIGWINCH = resize;

    // Job control: node-pty reports an exit and never a stop. When the CLI stops (Ctrl+Z, or a SIGSTOP),
    // restore the terminal and stop this launcher too, so the shell gets its prompt back; continued, put
    // the terminal back in raw mode, sync the size and continue the CLI.
    const checkStopped = () => {
      if (done || polling || status !== null) return;
      polling = true;
      execFile('/bin/ps', ['-o', 'stat=', '-p', String(term.pid)], { encoding: 'utf8', timeout: 2000 }, (err, out) => {
        polling = false;
        if (done || err || !String(out).trim().startsWith('T')) return;
        restore();
        process.kill(process.pid, 'SIGSTOP'); // returns once a SIGCONT has resumed this process
        setRaw();
        resize();
        try {
          term.kill('SIGCONT');
        } catch {
          // gone meanwhile
        }
      });
    };

    const finish = () => {
      if (done) return;
      done = true;
      if (timer) clearTimeout(timer);
      if (poll) clearInterval(poll);
      stdin.off('data', onInput);
      stdin.off('end', onEnd);
      for (const [sig, h] of Object.entries(handlers)) process.off(sig, h);
      restore();
      stdin.pause();
      if (filt.cleaned || filt.replaced) {
        say(notice(conf, 'notice_session_summary', {
          count: filt.cleaned,
          categories: core.CATEGORY_ORDER.filter((c) => filt.categories.has(c)).join(', ') || '-',
          replaced: filt.replaced,
        }));
      }
      if (cleaner.reportedPastes) {
        say(notice(conf, 'notice_session_report_only', {
          count: cleaner.reportedPastes,
          categories: core.CATEGORY_ORDER.filter((c) => cleaner.reported.has(c)).join(', '),
        }));
      }
      if (!mode.ever) say(noPasteNotice(conf, 'notice_no_bracketed_paste', argv0, home));
      if (noSalt) say(notice(conf, 'notice_wrapper_no_salt'));
      resolve(/** @type {number} */ (status));
    };

    term.onData((data) => {
      const b = Buffer.isBuffer(data) ? data : Buffer.from(data);
      mode.feed(b);
      stdout.write(b);
      if (status !== null) exitedAt = monotonic();
      schedule();
    });
    term.onExit((e) => {
      status = e.signal ? 128 + e.signal : e.exitCode;
      exitedAt = monotonic();
      schedule();
    });
    for (const [sig, h] of Object.entries(handlers)) process.on(sig, h);
    setRaw();
    stdin.on('data', onInput);
    stdin.on('end', onEnd);
    stdin.resume();
    if (platform !== 'win32') {
      poll = setInterval(checkStopped, STOP_POLL_MS);
      poll.unref();
    }
    schedule();
  });
}

/** [cols, rows] of the terminal, or 80x24. @param {NodeJS.WriteStream} out */
function windowSize(out) {
  try {
    if (out.isTTY) {
      const [c, r] = out.getWindowSize();
      if (c > 0 && r > 0) return [c, r];
    }
  } catch {
    // not a terminal
  }
  return [80, 24];
}

const USAGE = 'usage:\n'
  + '  mhw paste-wrapper run [--config FILE] [--grace SECONDS] -- <program> [args...]\n'
  + '  mhw paste-wrapper check\n'
  + 'Runs <program> on a pseudo-terminal and cleans bracketed pastes before it sees them (ADR-0033).\n';

/**
 * The PASTE line of `mhw status`: whether the wrapper can run here.
 * @param {Record<string, string | undefined>} env
 * @param {string} [platform]
 */
export function statusLine(env, platform = process.platform) {
  if (platform === 'win32') {
    return 'PASTE   n/a   the paste wrapper is not installed on Windows; whether it works there is not measured (D7)';
  }
  const p = loadPty({ env, platform });
  if (p.ok) return 'PASTE   ok    the paste wrapper loads its pty library (' + PTY_NAME + ')';
  return 'PASTE   FAIL  the paste wrapper cannot run here: ' + p.reason + '; claude, codex and kiro-cli started '
    + 'through it refuse to start (command <cli> runs one without paste cleaning)';
}

/**
 * Run the CLI straight, with the marker removed: not a terminal on both ends, so nothing can be pasted.
 * @param {string} real @param {string} argv0 @param {string[]} rest @param {Record<string, string | undefined>} env
 */
function execStraight(real, argv0, rest, env) {
  const e = childEnv(env, false);
  if (typeof process.execve === 'function') process.execve(real, [argv0, ...rest], e);
  const r = spawnSync(real, rest, { stdio: 'inherit', env: e, argv0, shell: false });
  if (r.error) {
    process.stderr.write(argv0 + ': ' + r.error.message + '\n');
    return 126;
  }
  if (r.signal) return 128 + (os.constants.signals[r.signal] || 0);
  return r.status ?? 1;
}

/**
 * `mhw paste-wrapper ...`. Returns the exit status, or a Promise of it for a relayed session.
 * @param {string[]} argv
 * @param {Record<string, string | undefined>} env
 * @param {{ stdinTTY?: boolean, stdoutTTY?: boolean, stderr?: { write(s: string): unknown } }} [opts] tests only
 * @returns {number | Promise<number>}
 */
export function main(argv, env, opts = {}) {
  const err = opts.stderr || process.stderr;
  if (argv[0] === 'check') {
    const p = loadPty({ env });
    if (p.ok) return 0;
    err.write('mhw paste-wrapper: ' + p.reason + '\n');
    return 1;
  }
  if (!argv.length || argv[0] !== 'run') {
    const help = argv[0] === '-h' || argv[0] === '--help';
    (help ? process.stdout : process.stderr).write(USAGE);
    return help ? 0 : 2;
  }
  const args = argv.slice(1);
  let config = null;
  let grace = GRACE_SECONDS;
  while (args.length && args[0] !== '--') {
    const flag = /** @type {string} */ (args.shift());
    if (flag === '--config' && args.length) config = /** @type {string} */ (args.shift());
    else if (flag === '--grace' && args.length && /^\d+(?:\.\d+)?$/.test(args[0])) grace = Number(args.shift());
    else {
      err.write('unknown or incomplete argument: ' + flag + '\n');
      return 2;
    }
  }
  if (args.length < 2) {
    err.write(USAGE);
    return 2;
  }
  const argv0 = args[1];
  const rest = args.slice(2);
  const real = argv0.includes('/') || argv0.includes(path.sep) ? argv0 : onPath(argv0, env);
  if (!real) {
    err.write(argv0 + ': command not found\n');
    return 127;
  }
  // Not an interactive terminal on both ends: nothing can be pasted, so get out of the way entirely.
  // Nothing is cleaned on this path, so the marker is removed, even one inherited from an outer session.
  const ttyIn = opts.stdinTTY ?? Boolean(process.stdin.isTTY);
  const ttyOut = opts.stdoutTTY ?? Boolean(process.stdout.isTTY);
  if (!(ttyIn && ttyOut)) return execStraight(real, argv0, rest, env);
  let conf;
  try {
    conf = core.loadConfig(config, { env });
  } catch (e) {
    // an unreadable settings file: say so, and do not run unchecked
    const name = e instanceof core.PyError ? e.message : errorName(e);
    err.write(core.DEFAULTS.notice_paste_error.replaceAll('{error}', name) + '\n');
    return 2;
  }
  const p = loadPty({ env });
  if (!p.ok) {
    err.write(refusal(argv0, p.reason) + '\n');
    return REFUSED;
  }
  let session;
  try {
    session = relay(p.pty, real, argv0, rest, conf, { env, grace });
  } catch (e) {
    // The pty loaded but the spawn failed (posix_spawnp, a damaged helper): refuse, never run unwrapped.
    if (process.stdin.isTTY) process.stdin.setRawMode(false);
    err.write(refusal(argv0, 'the spawn failed (' + (e instanceof Error ? e.message.split('\n')[0] : String(e)) + ')') + '\n');
    return REFUSED;
  }
  // The CLI is gone; stdin may still hold the event loop open, so exit explicitly.
  return session.then((code) => process.exit(code));
}
