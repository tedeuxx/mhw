// The retired paste wrapper's managed block in the shell start-up files (#590). Until #590 this step wrote
// the block (#492, S21 of #470; the Node form of install.sh's rc_* and shell_rc_* functions, Issue #145),
// which sourced the snippet that ran `mhw paste-wrapper`. The wrapper is removed: a pasted credential is
// caught by the fixed-pattern check on submit (#588), which blocks and shows a redacted copy. So every mode
// now only finds and removes the block an earlier install wrote; nothing is ever added.
//
//   node src/render/shell-rc.js --mode=install|check|dry-run|uninstall --shell-rc=|none|/ABSOLUTE
//        --shell=SHELL --data-dir=DIR --uname=NAME
//
// HOME and ZDOTDIR are read from the environment. --shell is install.sh's $SHELL, --data-dir the data
// directory that keeps the list of start-up files an earlier install created, --uname what `uname -s`
// printed (the macOS login-file rule).
//
// Which files: every start-up file the block may be in, the one --shell-rc names (none for
// --shell-rc=none), the one an earlier install chose from --shell (zsh ${ZDOTDIR:-$HOME}/.zshrc when that
// is inside HOME; bash ~/.bashrc and on macOS the login file), and every default one: ~/.zshrc as ZDOTDIR
// gives it, ~/.bashrc, ~/.bash_profile and ~/.bash_login. ~/.profile was never written and is never read.
//
// install and uninstall remove the block, an earlier one-line form and the unmarked two-line form; damaged
// markers (repeated, unpaired or out of order) are refused and nothing is changed. Each change keeps the
// previous file as <file>.pmhwc-backup (0600), or as <file>.pmhwc-backup.N with the first free N when a
// backup is already there: an existing backup is never overwritten. A file an earlier install created, and
// that holds nothing but the block, is removed. Writes go through a symbolic link, mode kept. check names
// a block still there as STALE (exit 1); dry-run says what install would change. Files are read and written
// as bytes (latin1), as awk did.
//
// Exit codes: 0 ok, 1 a block still there (check), 2 usage, 3 refused (that file left as it was), 4 an
// I/O failure while writing (a backup or the file): install then stops at once with exit 1. node: modules only.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NAME } from '../lib/marker.js';
import { keyOptions } from '../lib/key-options.js';
import { privateCopy } from '../lib/private-copy.js';

const PROG = 'shell-rc.js';
export const BEGIN_PREFIX = '# >>> ' + NAME + ': paste wrapper';
export const BEGIN = BEGIN_PREFIX + ' (ADR-0011); managed block, mhw uninstall removes it';
export const END = '# <<< ' + NAME + ': paste wrapper';
/** The earlier one-line form carries this. */
export const TAG = '# ' + NAME + ': paste wrapper (ADR-0011)';
// The unmarked two-line form an owner added by hand before the managed block existed (the reference
// machine's ~/.zshrc, 2026-10-11 canary): this comment line immediately followed by this source line, both
// exact. Either line alone, or any other spelling, is the owner's and stays. A pair that opens a compound
// command's body (the last non-blank line before it ends in then, else, do, {, && or ||) is left in place
// and reported: removing it could leave an empty body, which bash refuses (PR #153 lens).
export const LEG2_COMMENT = '# ' + NAME + ': clean pastes into claude/codex/kiro-cli (ADR-0011)';
export const LEG2_SOURCE = '. "$HOME/.local/share/' + NAME + '/paste-filter.sh"';
/** The list of start-up files install created, in the data directory. */
export const CREATED_LIST = 'shell-rc-created.list';
const OPENERS = ['then', 'else', 'do', '{', '&&', '||'];

/** An I/O failure while writing: install.sh stops (exit 4 here, 1 there). */
class IoFailure extends Error {}

/**
 * @typedef {{ out: (s: string) => void, err: (s: string) => void, status: number, mode: string, shellRc: string,
 *   shell: string, dataDir: string, uname: string, env: Record<string, string | undefined> }} Ctx
 */

/** A JS string as the latin1 string of its UTF-8 bytes, so it compares with a file read as latin1. @param {string} s */
const bytes = (s) => Buffer.from(s, 'utf8').toString('latin1');

/** The source line an earlier install wrote inside the block. @param {string} snippet */
export const body = (snippet) => '[ -r "' + snippet + '" ] && . "' + snippet + '"';
/** The block, as an earlier install wrote it (tests build their fixtures from it). @param {string} snippet */
export const block = (snippet) => BEGIN + '\n' + body(snippet) + '\n' + END + '\n';

/** True when the line, its trailing blanks dropped, ends in a word that opens a compound command's body. @param {string} line */
function opensBody(line) {
  let end = line.length;
  while (end > 0 && (line[end - 1] === ' ' || line[end - 1] === '\t')) end--;
  const t = line.slice(0, end);
  return OPENERS.some((w) => t.endsWith(w));
}

/** True when the line holds something other than spaces and tabs. @param {string} line */
function notBlank(line) {
  for (const c of line) if (c !== ' ' && c !== '\t') return true;
  return false;
}

/**
 * One start-up file's text (latin1, as awk read it), taken apart: the text without our block and without an
 * earlier form (stripped), our block's lines (block), and the counts: nb begin markers, ne end markers, bad
 * when they are out of order, leg earlier forms of both kinds, leg2 of which the two-line form, leg2k
 * two-line forms left in place because they open a compound command's body.
 * @param {string} text
 */
export function scan(text) {
  const lines = text.split('\n');
  if (text === '' || text.endsWith('\n')) lines.pop();
  /** @type {string[]} */
  const stripped = [];
  /** @type {string[]} */
  const blk = [];
  let nb = 0;
  let ne = 0;
  let bad = false;
  let leg = 0;
  let leg2 = 0;
  let leg2k = 0;
  let inb = false;
  let held = false;
  let last = '';
  /** @param {string} l */
  const emit = (l) => {
    stripped.push(l);
    if (notBlank(l)) last = l;
  };
  for (const l of lines) {
    if (held && !inb && l === LEG2_SOURCE) {
      held = false;
      if (opensBody(last)) {
        leg2k++;
        emit(LEG2_COMMENT);
        emit(l);
      } else {
        leg++;
        leg2++;
      }
      continue;
    }
    if (held) {
      held = false;
      emit(LEG2_COMMENT);
    }
    if (!inb && l === LEG2_COMMENT) {
      held = true;
    } else if (l.startsWith(BEGIN_PREFIX)) {
      nb++;
      if (inb) bad = true;
      inb = true;
      blk.push(l);
    } else if (l === END) {
      ne++;
      if (!inb) bad = true;
      inb = false;
      blk.push(l);
    } else if (inb) {
      blk.push(l);
    } else if (l.includes(TAG)) {
      leg++;
    } else {
      emit(l);
    }
  }
  if (held) emit(LEG2_COMMENT);
  if (inb) bad = true;
  const join = (/** @type {string[]} */ a) => a.map((l) => l + '\n').join('');
  return { stripped: join(stripped), block: join(blk), nb, ne, bad, leg, leg2, leg2k };
}

/** @param {ReturnType<typeof scan>} s */
const damaged = (s) => s.bad || s.nb > 1 || s.nb !== s.ne;

/** @param {string} p */
function lstatOf(p) {
  try {
    return fs.lstatSync(p);
  } catch {
    return null;
  }
}
/** @param {string} p */
function statOf(p) {
  try {
    return fs.statSync(p);
  } catch {
    return null;
  }
}
/** `[ -f p ]`: a regular file, through a link. @param {string} p */
const isFile = (p) => statOf(p)?.isFile() === true;

/** @param {Ctx} ctx @param {number} n */
function raise(ctx, n) {
  if (n > ctx.status) ctx.status = n;
}

/** The home directory, as install.sh read $HOME. @param {Ctx} ctx */
const home = (ctx) => ctx.env.HOME || '';

/** The default zsh start-up file, or '' when ZDOTDIR leads outside HOME. @param {Ctx} ctx */
function zshrc(ctx) {
  const h = home(ctx);
  const z = (ctx.env.ZDOTDIR || h) + '/.zshrc';
  // A relative ZDOTDIR is never inside HOME (the text check it replaces said so), whatever the cwd.
  if (!z.startsWith('/')) return '';
  // The text check alone let ZDOTDIR=$HOME/../x through (#492, PR #543 lens): the directory is resolved,
  // links and '..' included, and must be HOME or under it, compared with the trailing '/' so a sibling such
  // as $HOME-x is outside (PR #543 QA). Only narrows.
  const rh = realOf(h);
  const rz = realOf(path.dirname(z));
  return rz === rh || rz.startsWith(rh.endsWith('/') ? rh : rh + '/') ? z : '';
}

/**
 * The path as the kernel resolves it: the longest prefix that exists through realpath(3) (links and '..'
 * followed in order), the rest appended. @param {string} p
 */
export function realOf(p) {
  let head = p;
  /** @type {string[]} */
  const rest = [];
  for (;;) {
    try {
      return path.join(fs.realpathSync.native(head), ...rest.reverse());
    } catch {
      const parent = path.dirname(head);
      if (parent === head) return path.resolve(p);
      rest.push(path.basename(head));
      head = parent;
    }
  }
}

/**
 * The start-up file this run writes ('' with why), and on macOS bash the login file ('' with loginWhy).
 * @param {Ctx} ctx
 */
export function pick(ctx) {
  const none = { rc: '', why: '', login: '', loginWhy: '' };
  if (ctx.shellRc === 'none') return { ...none, why: '--shell-rc=none' };
  if (ctx.shellRc) return { ...none, rc: ctx.shellRc };
  const sh = ctx.shell;
  if (sh === 'zsh' || sh.endsWith('/zsh')) {
    const rc = zshrc(ctx);
    return { ...none, rc, why: rc ? '' : 'ZDOTDIR=' + (ctx.env.ZDOTDIR ?? '') + ' is outside HOME=' + home(ctx) };
  }
  if (sh === 'bash' || sh.endsWith('/bash')) return { ...none, rc: home(ctx) + '/.bashrc', ...bashLogin(ctx) };
  return { ...none, why: 'your shell (SHELL=' + (sh || 'unset') + ') is neither zsh nor bash' };
}

/**
 * On macOS a bash login shell (what Terminal.app opens) reads the first of ~/.bash_profile, ~/.bash_login and
 * ~/.profile that exists, and never ~/.bashrc. login is the first of the two bash-only files that exists, or
 * a new ~/.bash_profile when none of the three does. When only ~/.profile exists, login stays empty and
 * loginWhy says why: sh reads ~/.profile too (a function named kiro-cli is a syntax error there), and
 * creating ~/.bash_profile would stop bash reading ~/.profile.
 * @param {Ctx} ctx
 */
function bashLogin(ctx) {
  const h = home(ctx);
  if (ctx.uname !== 'Darwin') return { login: '', loginWhy: '' };
  if (lstatOf(h + '/.bash_profile')) return { login: h + '/.bash_profile', loginWhy: '' };
  if (lstatOf(h + '/.bash_login')) return { login: h + '/.bash_login', loginWhy: '' };
  if (lstatOf(h + '/.profile')) {
    return { login: '', loginWhy: 'for a bash login shell: only ~/.profile is there, which sh also reads, and a new ~/.bash_profile would stop bash reading it' };
  }
  return { login: h + '/.bash_profile', loginWhy: '' };
}

/** @param {Ctx} ctx */
const createdList = (ctx) => path.join(ctx.dataDir, CREATED_LIST);

/** True when install created the file (it is a line of the created list). @param {Ctx} ctx @param {string} file */
function wasCreated(ctx, file) {
  const list = createdList(ctx);
  if (!isFile(list)) return false;
  return fs.readFileSync(list, 'latin1').split('\n').includes(bytes(file));
}

/**
 * The backup name for a file about to change: <file>.pmhwc-backup, or <file>.pmhwc-backup.N with the first
 * free N, so an existing backup is never overwritten (#590). @param {string} file
 */
export function freeBackup(file) {
  let bak = file + '.pmhwc-backup';
  for (let n = 1; lstatOf(bak); n++) bak = file + '.pmhwc-backup.' + n;
  return bak;
}

/**
 * The file gets data (latin1); the previous file is kept beside it, owner-only, at a backup name that was
 * free (freeBackup). Written through, so a start-up file that is a symbolic link stays one, mode kept.
 * Returns the backup's name.
 * @param {Ctx} ctx @param {string} file @param {string} data
 */
function write(ctx, file, data) {
  const bak = freeBackup(file);
  try {
    privateCopy(file, bak);
  } catch {
    ctx.err('REFUSE  ' + bak + ': the backup could not be created exclusively; no backup written\n');
    throw new IoFailure();
  }
  try {
    fs.writeFileSync(file, Buffer.from(data, 'latin1'));
  } catch (e) {
    ctx.err('REFUSE  ' + file + ': could not be written (' + message(e) + ')\n');
    throw new IoFailure();
  }
  return bak;
}

/** @param {unknown} e */
const message = (e) => (e instanceof Error ? e.message : String(e));

/**
 * The file's text as latin1, '' when it is not a regular file, null (after the REFUSE line) when it cannot be read.
 * @param {Ctx} ctx @param {string} file @param {string} what what is not done, for the REFUSE line
 */
function read(ctx, file, what) {
  if (!isFile(file)) return '';
  try {
    return fs.readFileSync(file, 'latin1');
  } catch (e) {
    ctx.out('REFUSE  ' + file + ': cannot be read (' + (/** @type {NodeJS.ErrnoException} */ (e).code || message(e)) + '); ' + what + '\n');
    raise(ctx, 3);
    return null;
  }
}

/** Every start-up file the block may be in, each once. @param {Ctx} ctx */
export function candidates(ctx) {
  const h = home(ctx);
  const p = pick(ctx);
  /** @type {string[]} */
  const out = [];
  for (const rc of [p.rc, p.login, zshrc(ctx), h + '/.bashrc', h + '/.bash_profile', h + '/.bash_login']) {
    if (rc && !out.includes(rc)) out.push(rc);
  }
  return out;
}

/** What the block is, in every line that names it. */
export const WHAT = "the retired paste wrapper's start-up block (#590: a pasted credential is caught by the hook on submit)";

/** Every mode: the retired block leaves every start-up file it may be in (#590). @param {Ctx} ctx */
function removeStep(ctx) {
  for (const rc of candidates(ctx)) {
    // A file that is not there, or not a regular file, reads as '' and holds no block.
    const text = read(ctx, rc, 'nothing removed');
    if (text === null) continue;
    const s = scan(text);
    if (s.leg2k > 0) {
      ctx.out('NOTE    ' + rc + ": an unmarked two-line paste-filter source inside a compound command's body is left in place; the snippet it sources is removed, so remove that line by hand\n");
    }
    if (s.nb === 0 && s.ne === 0 && s.leg === 0) continue;
    if (damaged(s)) {
      ctx.out('REFUSE  ' + rc + ": the paste-wrapper block's markers are damaged (missing, repeated or out of order); nothing removed. Fix or remove them, then run install again\n");
      raise(ctx, 3);
      continue;
    }
    const created = s.stripped === '' && !lstatOf(rc)?.isSymbolicLink() && wasCreated(ctx, rc);
    if (ctx.mode === 'check') {
      ctx.out('STALE   ' + rc + ': ' + WHAT + ' is still there; install removes it\n');
      raise(ctx, 1);
    } else if (ctx.mode === 'dry-run') {
      if (created) ctx.out('WOULD REMOVE ' + rc + ' (an earlier install created it and only the paste-wrapper block is in it)\n');
      else ctx.out('WOULD CHANGE ' + rc + ': paste-wrapper start-up block present -> absent (backup ' + freeBackup(rc) + ')\n');
    } else if (created) {
      fs.rmSync(rc, { force: true });
      ctx.out('REMOVED ' + rc + ' (an earlier install created it and only the paste-wrapper block was in it)\n');
    } else {
      const bak = write(ctx, rc, s.stripped);
      ctx.out('CHANGED ' + rc + ': paste-wrapper start-up block present -> absent (' + WHAT + '; previous file kept as ' + bak + ')\n');
    }
  }
  // A refused file (damaged markers, unreadable) still holds its block: the list stays, so the run that
  // finally removes it can still delete a file an earlier install created (PR #543 QA advisory).
  if ((ctx.mode === 'install' || ctx.mode === 'uninstall') && ctx.status < 3) fs.rmSync(createdList(ctx), { force: true });
}

// ---- The command line ----------------------------------------------------------------------------------

const OPTIONS = new Set(['--mode', '--shell-rc', '--shell', '--data-dir', '--uname']);
const MODES = new Set(['install', 'check', 'dry-run', 'uninstall']);
const USAGE = 'usage: ' + PROG + ' --mode=install|check|dry-run|uninstall --shell-rc=|none|/ABSOLUTE --shell=SHELL --data-dir=DIR --uname=NAME\n';

/**
 * The command line. Returns the exit code.
 * @param {string[]} argv
 * @param {{ out?: (s: string) => void, err?: (s: string) => void, env?: Record<string, string | undefined> }} [io]
 */
export function main(argv, io = {}) {
  const o = keyOptions(argv, OPTIONS);
  const err = io.err || ((/** @type {string} */ s) => process.stderr.write(s));
  const rc = o?.['--shell-rc'];
  if (!o || Object.keys(o).length !== OPTIONS.size || !MODES.has(o['--mode']) || !o['--data-dir']
      || !(rc === '' || rc === 'none' || rc?.startsWith('/'))) {
    err(USAGE);
    return 2;
  }
  /** @type {Ctx} */
  const ctx = {
    out: io.out || ((s) => process.stdout.write(s)),
    err,
    status: 0,
    mode: o['--mode'],
    shellRc: o['--shell-rc'],
    shell: o['--shell'],
    dataDir: o['--data-dir'],
    uname: o['--uname'],
    env: io.env || process.env,
  };
  if (!ctx.env.HOME) {
    err('REFUSE  the shell start-up block: HOME is not set; no start-up file changed\n');
    return 2;
  }
  try {
    removeStep(ctx);
  } catch (e) {
    if (e instanceof IoFailure) return 4;
    // Anything unforeseen is a refusal, never node's exit 1 (which install.sh would read as --check's drift).
    ctx.err('REFUSE  the shell start-up block: the step failed (' + message(e) + '); the file it was on is left as it was\n');
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
