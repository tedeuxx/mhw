// The paste wrapper's managed block in the shell start-up files (#492, S21 of #470): the Node form of
// install.sh's rc_* and shell_rc_* functions (Issue #145; ADR-0011, ADR-0035), which were shell and awk.
//
//   node src/render/shell-rc.js --mode=install|check|dry-run|uninstall --shell-rc=|none|/ABSOLUTE
//        --shell=SHELL --snippet=FILE --data-dir=DIR --uname=NAME
//
// HOME and ZDOTDIR are read from the environment, as install.sh read them; --shell is install.sh's $SHELL
// (passed, since a shell that sets SHELL itself, bash as sh among them, does not export it). --snippet is the managed
// shell snippet the block sources ($snippet_dest), --data-dir the data directory that keeps the list of
// start-up files install created, --uname what `uname -s` printed (install.sh passes it, so the login-file
// rule reads the same system name as before).
//
// Which file: --shell-rc=FILE only that file; --shell-rc=none none; otherwise from --shell: zsh gets
// ${ZDOTDIR:-$HOME}/.zshrc when that is inside HOME, bash gets ~/.bashrc and, when uname is Darwin, the bash
// login file (the first of ~/.bash_profile and ~/.bash_login that exists, a new ~/.bash_profile when none of
// ~/.bash_profile, ~/.bash_login and ~/.profile does; nothing when only ~/.profile does). ~/.profile is never
// written. Another shell gets none. Uninstall reads the chosen file and every default one. Two checks
// the shell functions lacked (PR #543 lens; narrower only): a snippet path holding a quote, $, a backtick,
// a backslash or a line break is refused (it would run as code from the block), and ZDOTDIR is resolved
// (links and '..') before the inside-HOME check.
//
// The block is replaced whole when it differs and never duplicated; an earlier one-line form and the
// unmarked two-line form are replaced by it. Damaged markers (repeated, unpaired or out of order) are
// refused and nothing is written. Every write keeps the previous file as <file>.pmhwc-backup (0600) and
// writes through a symbolic link, mode kept. Files are read and written as bytes (latin1), as awk did, so
// uninstall gives a file back byte for byte (but for a final newline install added).
//
// Exit codes: 0 ok · 1 drift (check) · 2 usage · 3 refused, that file left as it was · 4 an I/O failure
// while writing (a backup, a directory or the file): install.sh then stops at once with exit 1, as its
// set -e did. node: modules only.
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
 *   shell: string, snippet: string, dataDir: string, uname: string, env: Record<string, string | undefined> }} Ctx
 */

/** A JS string as the latin1 string of its UTF-8 bytes, so it compares with a file read as latin1. @param {string} s */
const bytes = (s) => Buffer.from(s, 'utf8').toString('latin1');

/** The block's source line. @param {string} snippet */
export const body = (snippet) => '[ -r "' + snippet + '" ] && . "' + snippet + '"';
/** The line an owner adds by hand where no file is written. @param {string} snippet */
export const handLine = (snippet) => body(snippet) + '  ' + TAG;
/** The block, as it is written. @param {string} snippet */
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
  if (!z.startsWith(h + '/')) return '';
  // The text check alone let ZDOTDIR=$HOME/../x through (#492, PR #543 lens): the directory is also
  // resolved, links and '..' included, and must still be HOME or under it. Only narrows.
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

/** The characters a double-quoted sourced path would run as code, or that would break the block's line. */
const UNSAFE = ['"', "'", '$', '`', '\\', '\n', '\r'];
/** True when the snippet path holds one of them. @param {string} snippet */
export const unsafeSnippet = (snippet) => UNSAFE.some((c) => snippet.includes(c));

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
 * The file gets data (latin1); the previous file is kept beside it as <file>.pmhwc-backup, owner-only.
 * Written through, so a start-up file that is a symbolic link (a dotfiles checkout) stays one, mode kept.
 * Returns what was kept, for the CHANGED line.
 * @param {Ctx} ctx @param {string} file @param {string} data
 */
function write(ctx, file, data) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
  } catch (e) {
    ctx.err('REFUSE  ' + file + ': could not be written (' + message(e) + ')\n');
    throw new IoFailure();
  }
  let kept;
  if (statOf(file)) {
    try {
      privateCopy(file, file + '.pmhwc-backup');
    } catch {
      ctx.err('REFUSE  ' + file + '.pmhwc-backup: the backup could not be created exclusively; no backup written\n');
      throw new IoFailure();
    }
    kept = 'previous file kept as ' + file + '.pmhwc-backup';
  } else {
    kept = 'new file';
    if (!wasCreated(ctx, file)) {
      try {
        fs.mkdirSync(ctx.dataDir, { recursive: true });
        fs.appendFileSync(createdList(ctx), file + '\n');
      } catch (e) {
        ctx.err('REFUSE  ' + createdList(ctx) + ': could not be written (' + message(e) + ')\n');
        throw new IoFailure();
      }
    }
  }
  try {
    fs.writeFileSync(file, Buffer.from(data, 'latin1'));
  } catch (e) {
    ctx.err('REFUSE  ' + file + ': could not be written (' + message(e) + ')\n');
    throw new IoFailure();
  }
  return kept;
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

/**
 * The managed block in one start-up file, in install, check or dry-run mode.
 * @param {Ctx} ctx @param {string} rc
 */
function one(ctx, rc) {
  const line = handLine(ctx.snippet);
  const lst = lstatOf(rc);
  const st = statOf(rc);
  if (lst?.isSymbolicLink() && !st) {
    // A link to nothing: writing through it would create its target somewhere else. Refused visibly; the
    // other steps still run.
    ctx.out('REFUSE  ' + rc + ' is a symbolic link to a missing file; nothing written. Fix or remove the link, or add this line yourself:\n');
    ctx.out('        ' + line + '\n');
    raise(ctx, 3);
    return;
  }
  if (st && !st.isFile()) {
    ctx.out('REFUSE  ' + rc + ' is not a regular file; nothing written. Add this line yourself:\n');
    ctx.out('        ' + line + '\n');
    raise(ctx, 3);
    return;
  }
  const want = block(ctx.snippet);
  const text = read(ctx, rc, 'nothing written');
  if (text === null) return;
  const s = scan(text);
  if (damaged(s)) {
    ctx.out('REFUSE  ' + rc + ": the paste-wrapper block's markers are damaged (missing, repeated or out of order); nothing written. Fix or remove them, then run install again\n");
    raise(ctx, 3);
    return;
  }
  if (s.leg2k > 0) {
    ctx.out('NOTE    ' + rc + ": an unmarked two-line paste-filter source opens a compound command's body (after then, else, do, {, && or ||); left in place, since removing it could leave an empty body bash refuses. It sources the snippet a second time: remove it by hand\n");
  }
  if (s.nb === 1 && s.leg === 0 && s.block === bytes(want)) {
    ctx.out('OK      ' + rc + ' activates the paste wrapper (managed block)\n');
    return;
  }
  let old;
  if (s.leg2 > 0 && s.nb === 1) old = 'sourced twice (an unmarked two-line form beside the block)';
  else if (s.leg2 > 0) old = 'an unmarked two-line form';
  else if (s.leg > 0) old = 'the earlier one-line form';
  else if (s.nb === 1) old = 'a different block';
  else old = 'absent';
  if (ctx.mode === 'check') {
    if (old === 'absent') ctx.out('MISSING ' + rc + ': no paste-wrapper start-up block; install adds it\n');
    else ctx.out('DRIFT   ' + rc + ': paste-wrapper start-up block is ' + old + '; install replaces it\n');
    raise(ctx, 1);
  } else if (ctx.mode === 'dry-run') {
    ctx.out('WOULD CHANGE ' + rc + ': paste-wrapper start-up block ' + old + ' -> present (backup ' + rc + '.pmhwc-backup):\n');
    ctx.out(want);
  } else {
    const kept = write(ctx, rc, s.stripped + bytes(want));
    ctx.out('CHANGED ' + rc + ': paste-wrapper start-up block ' + old + ' -> present (' + kept + '); new shells clean pastes\n');
  }
}

/** install, check and dry-run: the block in the chosen start-up file, and on macOS bash in the login file. @param {Ctx} ctx */
function lineStep(ctx) {
  // The block sources the snippet inside double quotes, so a quote, $, a backtick or a backslash in its
  // path (from HOME or XDG_DATA_HOME) would run as code on every shell start (#492, PR #543 lens).
  // Refused, nothing written and no line offered to paste. Uninstall is not refused: it only removes.
  if (unsafeSnippet(ctx.snippet)) {
    ctx.out('REFUSE  the shell start-up block: the snippet path ' + JSON.stringify(ctx.snippet)
      + ' holds a quote, $, a backtick, a backslash or a line break, which a start-up file would run as code; no start-up file written\n');
    raise(ctx, 3);
    return;
  }
  const p = pick(ctx);
  const line = handLine(ctx.snippet);
  if (!p.rc) {
    if (ctx.mode === 'install') {
      ctx.out('NOTE    automatic paste cleaning: no shell start-up file is written (' + p.why + '); add this line to yours:\n');
      ctx.out('        ' + line + '\n');
    }
    return;
  }
  one(ctx, p.rc);
  if (p.login) one(ctx, p.login);
  else if (p.loginWhy && ctx.mode === 'install') {
    ctx.out('NOTE    automatic paste cleaning: no bash login start-up file is written (' + p.loginWhy + '); add this line to yours:\n');
    ctx.out('        ' + line + '\n');
  }
}

/** Uninstall: the block (and an earlier form) leaves every start-up file it may be in. @param {Ctx} ctx */
function uninstallStep(ctx) {
  const h = home(ctx);
  const seen = new Set();
  for (const rc of [pick(ctx).rc, zshrc(ctx), h + '/.bashrc', h + '/.bash_profile', h + '/.bash_login']) {
    if (!rc || seen.has(rc)) continue;
    seen.add(rc);
    // A file that is not there, or not a regular file, reads as '' and holds no block.
    const text = read(ctx, rc, 'nothing removed');
    if (text === null) continue;
    const s = scan(text);
    if (s.leg2k > 0) {
      ctx.out('NOTE    ' + rc + ": an unmarked two-line paste-filter source inside a compound command's body is left in place; the snippet it sources is removed, so remove that line by hand\n");
    }
    if (s.nb === 0 && s.ne === 0 && s.leg === 0) continue;
    if (damaged(s)) {
      ctx.out('REFUSE  ' + rc + ": the paste-wrapper block's markers are damaged; nothing removed\n");
      raise(ctx, 3);
      continue;
    }
    if (s.stripped === '' && !lstatOf(rc)?.isSymbolicLink() && wasCreated(ctx, rc)) {
      fs.rmSync(rc, { force: true });
      ctx.out('REMOVED ' + rc + ' (install created it and only the paste-wrapper block was in it)\n');
      continue;
    }
    const kept = write(ctx, rc, s.stripped);
    ctx.out('CHANGED ' + rc + ': paste-wrapper start-up block present -> absent (' + kept + ')\n');
  }
  fs.rmSync(createdList(ctx), { force: true });
}

// ---- The command line ----------------------------------------------------------------------------------

const OPTIONS = new Set(['--mode', '--shell-rc', '--shell', '--snippet', '--data-dir', '--uname']);
const MODES = new Set(['install', 'check', 'dry-run', 'uninstall']);
const USAGE = 'usage: ' + PROG + ' --mode=install|check|dry-run|uninstall --shell-rc=|none|/ABSOLUTE --shell=SHELL --snippet=FILE --data-dir=DIR --uname=NAME\n';

/**
 * The command line. Returns the exit code.
 * @param {string[]} argv
 * @param {{ out?: (s: string) => void, err?: (s: string) => void, env?: Record<string, string | undefined> }} [io]
 */
export function main(argv, io = {}) {
  const o = keyOptions(argv, OPTIONS);
  const err = io.err || ((/** @type {string} */ s) => process.stderr.write(s));
  const rc = o?.['--shell-rc'];
  if (!o || Object.keys(o).length !== OPTIONS.size || !MODES.has(o['--mode']) || !o['--snippet'] || !o['--data-dir']
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
    snippet: o['--snippet'],
    dataDir: o['--data-dir'],
    uname: o['--uname'],
    env: io.env || process.env,
  };
  if (!ctx.env.HOME) {
    err('REFUSE  the shell start-up block: HOME is not set; no start-up file changed\n');
    return 2;
  }
  try {
    if (ctx.mode === 'uninstall') uninstallStep(ctx);
    else lineStep(ctx);
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
