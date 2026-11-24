// mhw launch-line (#476, S05 of #470; /handoff of #198 and #454): the Node form of
// method/scripts/launch-line.py, which this slice deletes. It prints the one block that opens a fresh
// session of an agent harness with a prompt.
//
//   mhw launch-line <target> <prompt-file> --cd <checkout> [--env NAME=VALUE]...
//   mhw launch-line --resolve <current> [<first word of the arguments>]
//
// <target> names the agent harness the NEW session runs in: claude-code (alias claude), codex, kiro (alias
// kiro-cli). --resolve prints the canonical target, the first word when it names a harness and else
// <current>, and on a second line whether that word was `consumed` or `kept`.
//
// The prompt is read from a file, never an argument, and quoted here for a POSIX shell (zsh, bash): the
// whole prompt inside single quotes, each single quote in it as '\''. The --cd checkout is quoted the same
// way. Stdout is exactly one fenced block holding exactly one command, and nothing else:
//     cd '<checkout>' && NAME='value' claude '<prompt>'           claude-code
//     cd '<checkout>' && NAME='value' codex '<prompt>'            codex
//     cd '<checkout>' && NAME='value' kiro-cli chat '<prompt>'    kiro
// The fence is one backtick longer than any backtick run in the block.
//
// The prompt file is read only when it resolves (symlinks and `..` included) under the repository work
// tree or the system temporary directory (src/lib/confine.js), is a regular file and holds at most 64 KiB.
// Refused, exit 1, a prompt that is not safe to hand over: empty, a first line opening with /goal, a line
// over 280 characters, a machine-local path (the worklog continuity contract's refused strings, kept here
// since src/commands/worklog.js left with `mhw worklog` at #594; the schema's next_act pattern is the
// contract's copy), or a control character: every Unicode Cc
// character but the newline, and the bidirectional controls U+202A-U+202E and U+2066-U+2069. An --env is
// accepted only when its name is in LAUNCH_ENV (an allowlist; none is declared today) and its value carries
// no control character, line break, bidi control or machine-local path. --cd is required, once: an
// absolute path to an existing directory holding a `.git` entry, with no control character. A refusal names
// the line, the --env or --cd, never the content. This is a string check: copied private content carries
// none of those strings and passes. Exit 2 on a usage error. The same bytes and exit codes as the Python
// (test/golden/S05; the usage lines name `mhw launch-line`). node: modules only.
import fs from 'node:fs';
import path from 'node:path';
import { confined, ConfineError } from '../lib/confine.js';
import { pyLen, pyStrip, isPyWs, cmpStr } from '../lib/py.js';

// The worklog continuity contract's strict filter (#514), moved here from src/commands/worklog.js at #594:
// any of these anywhere, case-insensitively as CPython's re.IGNORECASE matches an ASCII letter: also
// U+0130 and U+0131 for i, U+017F for s and U+212A for k (measured over every code point on CPython 3.14).
// The Windows drive form needs a word boundary before the letter.
const STRICT_TOKENS = ['/tmp/', '~/', '/var/folders/', '/home/', '/users/', '/private/', 'file://']; // NOSONAR javascript:S5443 - literals that REFUSE machine-local paths in published text; nothing opens a directory
/** @type {Record<string, string>} */
const FOLD_EXTRA = { '\u0130': 'i', '\u0131': 'i', '\u017f': 's', '\u212a': 'k' };
/** The ASCII letter c matches case-insensitively, or c. @param {string} c */
const fold = (c) => FOLD_EXTRA[c] || (c >= 'A' && c <= 'Z' ? c.toLowerCase() : c);
const WORD = /[\p{L}\p{N}_]/u;
const BRAND_NEXT = /[A-Za-z0-9_-]/;
/** STRICT_PRIVATE.search(text) of the deleted worklog.py. @param {string} text */
export function strictPrivate(text) {
  const cps = Array.from(text);
  const low = cps.map(fold);
  const at = (/** @type {number} */ i, /** @type {string} */ t) => low.slice(i, i + t.length).join('') === t;
  for (let i = 0; i < cps.length; i++) {
    for (const t of STRICT_TOKENS) if (at(i, t)) return true;
    // \.brand(?![A-Za-z0-9_-]), the class matched case-insensitively too
    if (at(i, '.brand') && !(i + 6 < cps.length && (BRAND_NEXT.test(cps[i + 6]) || FOLD_EXTRA[cps[i + 6]]))) return true;
    // \b[A-Za-z]:\\
    if (/^[a-z]$/.test(low[i]) && cps[i + 1] === ':' && cps[i + 2] === '\\' && (i === 0 || !WORD.test(cps[i - 1]))) return true;
  }
  return false;
}

/** @type {Record<string, string>} */
export const LAUNCH = { 'claude-code': 'claude', codex: 'codex', kiro: 'kiro-cli chat' };
/** @type {Record<string, string>} */
const ALIASES = { claude: 'claude-code', 'kiro-cli': 'kiro' };
const LINE_LIMIT = 280;
const SIZE_LIMIT = 64 * 1024; // bytes; a prompt is a handful of one-line fields
// The launch variables the method declares: a variable an MCP server or the agent harness reads only when
// it starts. An allowlist, so a name that redirects a configuration home, a base URL, an editor or git's
// configuration is refused without anyone having had to think of it. Add a name here, in a reviewed
// change, when a method file declares a new launch variable. None is declared today, so every --env is
// refused (HARNESS_SWEEP_ORIGIN left with the chrome-devtools origin bound it fed, ADR-0038 amendment D8).
export const LAUNCH_ENV = Object.freeze(/** @type {string[]} */ ([]));

/** A Cc character (the newline excepted when keepNewline) or a bidi control. @param {string} text @param {boolean} keepNewline */
export function control(text, keepNewline) {
  for (const c of text) {
    const code = /** @type {number} */ (c.codePointAt(0));
    if (code <= 0x1f || (code >= 0x7f && code <= 0x9f)) {
      if (!(keepNewline && c === '\n')) return true;
    } else if ((code >= 0x202a && code <= 0x202e) || (code >= 0x2066 && code <= 0x2069)) {
      return true;
    }
  }
  return false;
}

/** The harness id a name or alias stands for, or null. @param {string | undefined} name */
export function canonical(name) {
  if (name === undefined) return null;
  const id = Object.hasOwn(ALIASES, name) ? ALIASES[name] : name;
  return Object.hasOwn(LAUNCH, id) ? id : null;
}

/** @param {string} text */
const quote = (text) => "'" + text.replaceAll("'", String.raw`'\''`) + "'";

/** @param {string} prompt @returns {string[]} */
export function problems(prompt) {
  if (!pyStrip(prompt)) return ['the prompt is empty'];
  const out = [];
  const cps = Array.from(prompt);
  if (prompt.startsWith('/goal') && (cps.length === 5 || isPyWs(cps[5]))) {
    out.push('the first line opens with /goal; a fresh session does not start with /goal');
  }
  prompt.split('\n').forEach((line, i) => {
    const n = i + 1;
    const len = pyLen(line);
    if (len > LINE_LIMIT) out.push('line ' + n + ' is ' + len + ' characters; the limit is ' + LINE_LIMIT);
    // The text is never echoed: only where it is.
    if (strictPrivate(line)) out.push('line ' + n + ' carries a machine-local path (a refused string of the worklog contract)');
    if (control(line, true)) out.push('line ' + n + ' carries a control character (Cc other than the newline, or a bidi control)');
  });
  return out;
}

/** @param {Array<[string, string]>} pairs @param {readonly string[]} declared @returns {string[]} */
function envProblems(pairs, declared) {
  /** @type {string[]} */
  const out = [];
  pairs.forEach(([name, value], i) => {
    const n = i + 1;
    if (!declared.includes(name)) {
      out.push('--env ' + n + ': the name is not a declared launch variable (' + ([...declared].sort(cmpStr).join(', ') || 'none is declared') + ')');
    }
    if (control(value, false)) out.push('--env ' + n + ': the value carries a control character or a line break');
    if (strictPrivate(value)) out.push('--env ' + n + ': the value carries a machine-local path');
  });
  return out;
}

/** @param {string} p */
const isDir = (p) => {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
};

/** @param {string} p @param {string} [platform] @returns {string[]} */
function cdProblems(p, platform = process.platform) {
  if (control(p, false)) return ['--cd carries a control character or a line break'];
  const P = platform === 'win32' ? path.win32 : path.posix;
  // pathlib's is_absolute: on Windows it needs a drive and a root, and P.isAbsolute accepts "\\x" alone.
  const absolute = platform === 'win32' ? /^[A-Za-z]:[\\/]/.test(p) || /^[\\/]{2}/.test(p) : p.startsWith('/');
  if (!absolute) return ['--cd is not an absolute path'];
  if (!isDir(p)) return ['--cd is not an existing directory'];
  if (!fs.existsSync(P.join(p, '.git'))) return ['--cd is not a git checkout (no .git entry)'];
  return [];
}

/** @param {string} body */
function fence(body) {
  let longest = 0;
  let run = 0;
  for (const c of body) {
    run = c === '`' ? run + 1 : 0;
    if (run > longest) longest = run;
  }
  return '`'.repeat(Math.max(3, longest + 1));
}

/** @param {string} target @param {string} prompt @param {Array<[string, string]>} pairs @param {string} checkout */
function block(target, prompt, pairs, checkout) {
  const prefix = pairs.map(([name, value]) => name + '=' + quote(value) + ' ').join('');
  const line = 'cd ' + quote(checkout) + ' && ' + prefix + LAUNCH[target] + ' ' + quote(prompt);
  const f = fence(line);
  return f + '\n' + line + '\n' + f;
}

/**
 * @typedef {{ cwd: string, env: Record<string, string | undefined>, platform?: string,
 *   out: (s: string) => void, err: (s: string) => void, launchEnv?: readonly string[] }} Io
 */

/** @param {string[]} argv @param {Io} io */
function resolve(argv, io) {
  if (!argv.length || argv.length > 2 || canonical(argv[0]) === null) {
    io.err('usage: mhw launch-line --resolve <' + Object.keys(LAUNCH).join('|') + '> [<first word>]\n');
    return 2;
  }
  const word = argv.length === 2 ? canonical(argv[1]) : null;
  io.out((word || canonical(argv[0])) + '\n' + (word ? 'consumed' : 'kept') + '\n');
  return 0;
}

/**
 * (target, path, env pairs, checkout), or null on a usage error. --cd is required, once.
 * @param {string[]} argv
 * @returns {[string, string, Array<[string, string]>, string] | null}
 */
export function parse(argv) {
  if (argv.length < 2 || canonical(argv[0]) === null) return null;
  /** @type {Array<[string, string]>} */
  const pairs = [];
  /** @type {string | null} */
  let checkout = null;
  let rest = argv.slice(2);
  while (rest.length) {
    if (rest.length < 2) return null;
    if (rest[0] === '--cd' && checkout === null) {
      checkout = rest[1];
    } else if (rest[0] === '--env' && rest[1].includes('=')) {
      const eq = rest[1].indexOf('=');
      pairs.push([rest[1].slice(0, eq), rest[1].slice(eq + 1)]);
    } else {
      return null;
    }
    rest = rest.slice(2);
  }
  if (checkout === null) return null;
  return [/** @type {string} */ (canonical(argv[0])), argv[1], pairs, checkout];
}

/** @type {Record<string, string>} */
const OS_ERROR = { EACCES: 'PermissionError', EPERM: 'PermissionError', ENOENT: 'FileNotFoundError', EISDIR: 'IsADirectoryError', ENOTDIR: 'NotADirectoryError' };

/**
 * mhw launch-line ...: 0 with the block on stdout, 1 on a refusal, 2 on a usage or read error.
 * io.launchEnv replaces LAUNCH_ENV, for the tests only; the command line has no way to set it.
 * @param {string[]} argv
 * @param {Io} io
 * @returns {number}
 */
export function run(argv, io) {
  if (argv[0] === '--resolve') return resolve(argv.slice(1), io);
  const parsed = parse(argv);
  if (parsed === null) {
    const names = [...Object.keys(LAUNCH), ...Object.keys(ALIASES)].sort(cmpStr);
    io.err('usage: mhw launch-line <' + names.join('|') + '> <prompt-file> --cd <checkout> [--env NAME=VALUE]...\n');
    return 2;
  }
  const [target, file, pairs, checkout] = parsed;
  // mhw #170 (Sonar S8707): the path is supplied by an agent and its content is printed, so it is resolved
  // and read only under the work tree or the temporary directory, only as a regular file, only up to
  // SIZE_LIMIT bytes.
  let real;
  try {
    real = confined(file, io);
  } catch (e) {
    if (e instanceof ConfineError) {
      io.err('REFUSE  ' + e.message + '\n');
      return 1;
    }
    throw e;
  }
  let prompt;
  try {
    let st;
    try {
      st = fs.statSync(real);
    } catch {
      st = null;
    }
    if (!st || !st.isFile()) {
      io.err('REFUSE  the prompt file is not a regular file\n');
      return 1;
    }
    if (st.size > SIZE_LIMIT) {
      io.err('REFUSE  the prompt file is over ' + SIZE_LIMIT + ' bytes\n');
      return 1;
    }
    const bytes = fs.readFileSync(real);
    try {
      prompt = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
    } catch {
      io.err('launch-line: cannot read the prompt file: UnicodeDecodeError\n');
      return 2;
    }
  } catch (e) {
    const code = /** @type {NodeJS.ErrnoException} */ (e).code || '';
    io.err('launch-line: cannot read the prompt file: ' + (OS_ERROR[code] || 'OSError') + '\n');
    return 2;
  }
  prompt = prompt.replaceAll('\r\n', '\n');
  let end = prompt.length;
  while (end > 0 && prompt[end - 1] === '\n') end--; // str.rstrip("\n")
  prompt = prompt.slice(0, end);
  const found = [...problems(prompt), ...envProblems(pairs, io.launchEnv || LAUNCH_ENV), ...cdProblems(checkout, io.platform)];
  if (found.length) {
    io.err(found.map((p) => 'REFUSE  ' + p + '\n').join(''));
    return 1;
  }
  io.out(block(target, prompt, pairs, checkout) + '\n');
  return 0;
}

/**
 * @param {string[]} argv
 * @param {Record<string, string | undefined>} env
 */
export function main(argv, env) {
  return run(argv, {
    cwd: path.resolve(process.cwd()),
    env,
    out: (s) => process.stdout.write(s),
    err: (s) => process.stderr.write(s),
  });
}
