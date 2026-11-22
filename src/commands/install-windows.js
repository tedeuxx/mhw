// `mhw install-windows`: the user-layer installer on Windows, moved from global/install.ps1 by #497 (S27 of
// #470). It renders global/AGENTS.md into each agent harness's user-level brief (ADR-0010), merges the deny
// floor into %USERPROFILE%\.claude\settings.json and renders it for Codex (ADR-0016) and, through
// src/render/kiro-permissions.js, for Kiro (ADR-0036); it pins the session-start model and effort
// (src/render/model-defaults.js, ADR-0007), removes the retired find and awk allows (ADR-0035 decision 4),
// and renders the working method (src/render/method.js, ADR-0032). `mhw install`, `check` and `status` run
// it on Windows (src/cli.js); macOS and Linux run `mhw install-user` instead.
//
// What it does not do, as install.ps1 did not: the paste wrapper and the paste filter (ADR-0033) are not
// installed on Windows (whether the pty library works there is not measured, D7 of #470), no shell
// start-up file is written, no Kiro prompt hook, no allow list of its own (ADR-0031 is POSIX only), and
// there is no uninstall: each step's backup beside its file is the way back. Every backup is owner-only:
// src/lib/private-copy.js gives it an access list for the current user alone, inheritance removed, before
// a byte is written (0600 has no Windows equivalent).
//
// The source is read with CRLF turned into LF, so a checkout made with core.autocrlf=true renders the same
// bytes as macOS and Linux do. Exit codes are install.ps1's: 0 ok, 1 drift, stamp or missing (--check),
// 2 usage, an invalid floor entry or a missing node, 3 an UNMANAGED or unreadable file is in the way.
// node: modules only.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { MARKER_ID, isManaged as managedText, unstamp } from '../lib/marker.js';
import { privateCopy } from '../lib/private-copy.js';
import { onPath } from '../lib/onpath.js';
import { runAbsolute } from '../lib/run.js';
import { deriveStamp, parseFloor } from '../lib/user-layer.js';

/** @typedef {Record<string, string | undefined>} Env */
/** @typedef {{ out: (text: string | Buffer) => void, err: (text: string | Buffer) => void }} Io */

/** Every byte of text, written synchronously. @param {number} fd @param {string | Buffer} text */
function write(fd, text) {
  const b = typeof text === 'string' ? Buffer.from(text, 'utf8') : text;
  for (let off = 0; off < b.length;) off += fs.writeSync(fd, b, off, b.length - off);
}

/** This process's output, written synchronously so it interleaves with the renderers' inherited output. */
const STDIO = /** @type {Io} */ ({
  out: (text) => { write(1, text); },
  err: (text) => { write(2, text); },
});

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const STAMP_KEY = 'personal-multi-harness-workstation-configuration';

export const USAGE = `The user layer on Windows: the global brief for each agent harness, the deny floor (Claude Code, Codex
and Kiro), the session-start model defaults, the retired allow entries and the working method. mhw
install, check and status run it on Windows; this is their internal step.

  mhw install-windows                 install or update every managed target
  mhw install-windows --dry-run       print exactly what would be written where; write nothing
  mhw install-windows --check         exit non-zero if any target is missing, drifted, unmanaged, or carries a
                                      provenance stamp other than the source's (Issue #66, ADR-0029)
  mhw install-windows --overlay=DIR   owner overlay directory (default: <repo>\\overlay); --overlay=none for none
  mhw install-windows --method        opt-in (Issue #61): also render the working method

Exit codes: 0 ok · 1 drift, stamp or missing (--check) · 2 usage, invalid floor entry or missing node ·
3 an UNMANAGED or unreadable file is in the way.
`;

/**
 * @typedef {{
 *   env: Env, io: Io, mode: string, method: boolean, overlay: string, repoRoot: string, scriptDir: string,
 *   home: string, codexHome: string, stamp: string, brief: Buffer, briefSha: string, briefFrom: string,
 *   floorLines: string[], floorFrom: string, claudeRules: string[], codexWords: string[], status: number,
 *   refused: Set<string>
 * }} Ctx
 */

/** @param {Ctx} ctx @param {string} s */
const say = (ctx, s) => ctx.io.out(s + '\n');
/** @param {Ctx} ctx @param {string} s */
const warn = (ctx, s) => ctx.io.err(s + '\n');
/** @param {Ctx} ctx @param {number} n */
const raise = (ctx, n) => {
  if (n > ctx.status) ctx.status = n;
};

/** @param {string} p */
function isFile(p) {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

/** @param {string} p */
function isDir(p) {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

/** Test-Path: something is there. @param {string} p */
function exists(p) {
  try {
    fs.statSync(p);
    return true;
  } catch {
    return false;
  }
}

/** @param {string} p */
function readBytes(p) {
  try {
    return fs.readFileSync(p);
  } catch {
    return null;
  }
}

/** The bytes of a source file with every CRLF turned into LF (install.ps1's Read-LF). @param {string} p */
function readLF(p) {
  return Buffer.from(fs.readFileSync(p).toString('latin1').replaceAll('\r\n', '\n'), 'latin1');
}

/** Get-Content: the lines, without their CRLF or LF. @param {string} p */
function lines(p) {
  const l = fs.readFileSync(p, 'utf8').split(/\r?\n/);
  if (l.length && l[l.length - 1] === '') l.pop();
  return l;
}

/** Absolute on this OS (install.ps1's IsPathRooted). @param {string} p */
const rooted = (p) => path.isAbsolute(p);

/**
 * The arguments, or [code, message]: --dry-run, --check, --method, --overlay=DIR|none, --help.
 * @param {string[]} argv @param {string} repoRoot
 * @returns {{ mode: string, method: boolean, overlay: string } | [number, string]}
 */
export function parseArgs(argv, repoRoot) {
  let dry = false;
  let check = false;
  let method = false;
  let overlay = '';
  for (const arg of argv) {
    if (arg === '--dry-run') dry = true;
    else if (arg === '--check') check = true;
    else if (arg === '--method') method = true;
    else if (arg.startsWith('--overlay=') && arg.length > '--overlay='.length) overlay = arg.slice('--overlay='.length);
    else if (arg === '-h' || arg === '--help') return [0, USAGE];
    else return [2, 'mhw install-windows: unknown argument: ' + arg];
  }
  if (dry && check) return [2, 'use --dry-run or --check, not both'];
  if (!overlay) overlay = path.join(repoRoot, 'overlay');
  let mode = 'install';
  if (check) mode = 'check';
  else if (dry) mode = 'dry-run';
  return { mode, method, overlay };
}

/** current_version of .bumpversion.toml, the first one, or ''. @param {string} root */
function readVersion(root) {
  const raw = readBytes(path.join(root, '.bumpversion.toml'));
  if (raw === null) return '';
  const m = /^current_version[ \t]*=[ \t]*"([0-9][0-9.]*)"/m.exec(raw.toString('utf8'));
  return m ? m[1] : '';
}

/**
 * The node a step runs: MHW_NODE when absolute and a file, refused when absolute and not one, else node on
 * PATH; null when there is none.
 * @param {Env} env
 * @returns {{ node: string | null, refused: boolean }}
 */
export function nodeLookup(env) {
  const given = env.MHW_NODE || '';
  if (rooted(given)) return isFile(given) ? { node: given, refused: false } : { node: null, refused: true };
  return { node: onPath('node', env), refused: false };
}

/**
 * Everything before the first target. The context, or the exit code it stopped with.
 * @param {string[]} argv @param {Env} env @param {Io} io @param {string} [repoRoot]
 * @returns {Ctx | number}
 */
export function prepare(argv, env, io, repoRoot = ROOT) {
  const a = parseArgs(argv, repoRoot);
  if (Array.isArray(a)) {
    if (a[0] === 0) io.out(a[1]);
    else io.err(a[1] + '\n');
    return a[0];
  }
  const scriptDir = path.join(repoRoot, 'global');
  const usage = (/** @type {string} */ m) => {
    io.err(m + '\n');
    return 2;
  };
  const src = path.join(scriptDir, 'AGENTS.md');
  if (!isFile(src)) return usage('source not found: ' + src);
  const version = readVersion(repoRoot);
  if (!version) return usage('cannot read current_version from .bumpversion.toml');
  const home = env.USERPROFILE;
  if (!home) return usage('mhw install-windows: USERPROFILE is not set');
  const stamp = deriveStamp(repoRoot, version, env);
  const { overlay } = a;
  const none = overlay === 'none';
  // A structured profile must be compiled and current before any target is written (ADR-0018).
  if (!none && isFile(path.join(overlay, 'profile.json'))) {
    let node = env.MHW_NODE && rooted(env.MHW_NODE) ? env.MHW_NODE : onPath('node', env);
    if (!node) return usage('profile overlay requires node (26 or later); no target was written');
    const r = runAbsolute(node, [path.join(repoRoot, 'bin', 'mhw.js'), 'profile', 'check', '--source', 'profile.json', '--output', '.'],
      { env, stdio: 'inherit', cwd: overlay });
    if (r.error) io.err('mhw: ' + node + ' did not start: ' + r.error.message + '\n');
    if (r.code !== 0) return r.code;
  }
  let brief = readLF(src);
  let briefFrom = 'global/AGENTS.md';
  if (!none) {
    if (!isDir(overlay)) return usage('overlay directory not found: ' + overlay);
    const ob = path.join(overlay, 'AGENTS.md');
    if (isFile(ob)) {
      brief = Buffer.concat([brief, readLF(ob)]);
      briefFrom = 'global/AGENTS.md + overlay';
    }
  }
  // The deny floor (ADR-0016): generic entries, then the overlay's; an invalid entry stops the run before
  // anything is written.
  const floorSrc = path.join(scriptDir, 'deny-floor.conf');
  if (!isFile(floorSrc)) return usage('source not found: ' + floorSrc);
  let floorLines = lines(floorSrc);
  let floorFrom = 'global/deny-floor.conf';
  if (!none && isFile(path.join(overlay, 'deny-floor.conf'))) {
    floorLines = floorLines.concat(lines(path.join(overlay, 'deny-floor.conf')));
    floorFrom = 'global/deny-floor.conf + overlay';
  }
  const floor = parseFloor(floorLines.map((l) => l + '\n').join(''));
  if (floor.errors.length) {
    for (const e of floor.errors) io.err(e + '\n');
    return 2;
  }
  return {
    env, io, mode: a.mode, method: a.method, overlay, repoRoot, scriptDir, home,
    codexHome: env.CODEX_HOME || path.join(home, '.codex'), stamp, brief,
    briefSha: crypto.createHash('sha256').update(brief).digest('hex'), briefFrom, floorLines, floorFrom,
    claudeRules: floor.claude, codexWords: floor.codex, status: 0, refused: new Set(),
  };
}

/**
 * The bytes a managed target should hold: the brief for Claude Code and Codex (plain), the brief with
 * Kiro's front matter (kiro), or the Codex rules file (codexrules).
 * @param {Ctx} ctx @param {string} kind
 */
export function render(ctx, kind) {
  if (kind === 'codexrules') {
    let s = '# ' + MARKER_ID + '; source: ' + ctx.floorFrom + '; ' + ctx.stamp + '; do not edit, re-run the installer\n'
      + '# The workstation deny floor (ADR-0016). A prefix rule matches the command words from the\n'
      + '# program name on; another spelling, a wrapper or a script is not matched.\n';
    for (const words of ctx.codexWords) {
      s += 'prefix_rule(pattern=[' + words.split(' ').map((w) => '"' + w + '"').join(', ') + '], decision="forbidden")\n';
    }
    return Buffer.from(s, 'latin1');
  }
  const head = (kind === 'kiro' ? '---\ninclusion: always\n---\n' : '')
    + '<!-- ' + MARKER_ID + '; source: ' + ctx.briefFrom + '; ' + ctx.stamp + '; sha256: ' + ctx.briefSha
    + '; do not edit, re-run the installer -->\n\n';
  return Buffer.concat([Buffer.from(head, 'utf8'), ctx.brief]);
}

/** Write bytes beside the file and move them into place. @param {string} dest @param {Buffer | string} data */
function replace(dest, data) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const tmp = dest + '.new.' + process.pid;
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, dest);
}

/**
 * One managed target: OK, or by mode MISSING, STAMP or DRIFT (--check), WOULD WRITE (--dry-run), WROTE.
 * A file without the marker in its first five lines is REFUSED and never overwritten.
 * @param {Ctx} ctx @param {string} kind @param {string} dest
 */
export function processTarget(ctx, kind, dest) {
  const bytes = render(ctx, kind);
  const there = exists(dest);
  const current = there ? readBytes(dest) : null;
  if (there && (current === null || !managedText(current.toString('latin1')))) {
    warn(ctx, 'REFUSE  ' + dest + ': exists and is NOT managed by this project; move it aside or merge it by hand');
    raise(ctx, 3);
    return;
  }
  let restamp = false;
  let was = 'none';
  if (current !== null) {
    if (current.equals(bytes)) {
      say(ctx, 'OK      ' + dest + ' (' + ctx.stamp + ')');
      return;
    }
    // Matching content under another stamp is STAMP, not DRIFT: --check flags it, install rewrites it.
    restamp = unstamp(current.toString('utf8')) === unstamp(bytes.toString('utf8'));
    was = stampOf(current.toString('utf8'));
  }
  if (ctx.mode === 'check') {
    if (current === null) say(ctx, 'MISSING ' + dest);
    else if (restamp) say(ctx, 'STAMP   ' + dest + ': content matches, but it carries (' + was + ') and the source is (' + ctx.stamp + ')');
    else say(ctx, 'DRIFT   ' + dest + ' (' + was + ')');
    raise(ctx, 1);
  } else if (ctx.mode === 'dry-run') {
    say(ctx, 'WOULD WRITE ' + dest + ' (' + bytes.length + ' bytes):');
    say(ctx, '----- begin ' + dest);
    say(ctx, bytes.toString('utf8'));
    say(ctx, '----- end ' + dest);
  } else {
    replace(dest, bytes);
    say(ctx, 'WROTE   ' + dest + ' (' + ctx.stamp + ')');
  }
}

/** The release and commit fields of the first managed-by line in a text, or 'none'. @param {string} text */
function stampOf(text) {
  const line = text.split('\n').find((l) => l.includes(MARKER_ID));
  if (line === undefined) return 'none';
  const m = /; (release: [^;"]*; commit: [^;"]*);/.exec(line);
  return m ? m[1] : 'none';
}

/** @param {unknown} v @returns {v is Record<string, unknown>} */
const isObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);

/** The settings file as an object, or null when it is not a readable JSON object. @param {string} p */
function readObject(p) {
  const raw = readBytes(p);
  if (raw === null) return null;
  try {
    const v = JSON.parse(raw.toString('utf8').replace(/^﻿/, ''));
    return isObject(v) ? v : null;
  } catch {
    return null;
  }
}

/** The JSON a settings file is written as: two-space indent, LF, a final newline. @param {unknown} v */
const serialize = (v) => JSON.stringify(v, null, 2) + '\n';

/**
 * An owner-only backup beside a file before it is rewritten. When the backup cannot be made owner-only the
 * file is REFUSED and left as it was (exit 3) and the later steps still run (#497; install.ps1's
 * Copy-Private stopped the whole run with exit 1). The line says what to do.
 * @param {Ctx} ctx @param {string} src @param {string} dst
 */
function backup(ctx, src, dst) {
  try {
    privateCopy(src, dst, { env: ctx.env });
    return true;
  } catch (e) {
    warn(ctx, 'REFUSE  ' + src + ': left untouched, because its backup could not be made readable by you alone ('
      + (e instanceof Error ? e.message : String(e)) + '). Check who can read ' + path.dirname(src)
      + ' (icacls "' + path.dirname(src) + '"), then run mhw install again');
    raise(ctx, 3);
    ctx.refused.add(src);
    return false;
  }
}

/** Set a key as the last of its object (Add-Member -Force). @param {Record<string, unknown>} o @param {string} k @param {unknown} v */
function setLast(o, k, v) {
  delete o[k];
  o[k] = v;
}

/** The first occurrence of each value, in order (Select-Object -Unique). @param {unknown[]} list */
const unique = (list) => list.filter((x, i) => list.indexOf(x) === i);

/**
 * Merge the deny floor into the user's Claude Code settings: a union, every existing key and rule kept, a
 * backup beside the file, and one top-level key carrying the provenance stamp (JSON has no comment).
 * @param {Ctx} ctx @param {string} settings
 */
export function mergeDenyFloor(ctx, settings) {
  const there = exists(settings);
  /** @type {Record<string, unknown>} */
  let obj = {};
  if (there) {
    const read = readObject(settings);
    if (read === null) {
      warn(ctx, 'REFUSE  ' + settings + ': not a readable JSON object; left untouched');
      raise(ctx, 3);
      ctx.refused.add(settings);
      return;
    }
    obj = read;
  }
  const shape = () => {
    warn(ctx, 'REFUSE  ' + settings + ': its permissions section has an unexpected shape; left untouched');
    raise(ctx, 3);
    ctx.refused.add(settings);
  };
  const hasPerms = Object.hasOwn(obj, 'permissions');
  const perms = obj.permissions;
  if (hasPerms && !isObject(perms)) return shape();
  /** @type {unknown[]} */
  let existing = [];
  if (hasPerms && isObject(perms) && Object.hasOwn(perms, 'deny')) {
    const d = perms.deny;
    if (!Array.isArray(d) && d !== null) return shape();
    existing = d === null ? [null] : d;
  }
  const missing = /** @type {string[]} */ (unique(ctx.claudeRules.filter((r) => !existing.includes(r))));
  const want = MARKER_ID + '; source: global/install.ps1 (only the deny-floor rules merged into this file; every other key is yours); '
    + ctx.stamp + '; do not edit, re-run the installer';
  const hasKey = Object.hasOwn(obj, STAMP_KEY);
  const was = hasKey ? stampOf(String(obj[STAMP_KEY])) : 'none';
  const stampOk = hasKey && String(obj[STAMP_KEY]) === want;
  if (there && missing.length === 0 && stampOk) {
    say(ctx, 'OK      ' + settings + ' (all ' + ctx.claudeRules.length + ' deny-floor rules present; ' + ctx.stamp + ')');
    return;
  }
  if (ctx.mode === 'check') {
    if (!there) say(ctx, 'MISSING ' + settings);
    else if (missing.length === 0) say(ctx, 'STAMP   ' + settings + ': the deny floor matches, but its "' + STAMP_KEY + '" key carries (' + was + ') and the source is (' + ctx.stamp + ')');
    else say(ctx, 'DRIFT   ' + settings + ' (' + missing.length + ' deny-floor rule(s) missing) (' + was + ')');
    raise(ctx, 1);
  } else if (ctx.mode === 'dry-run') {
    say(ctx, 'WOULD MERGE ' + settings + ': ' + missing.length + ' deny-floor rule(s); every other key and rule is kept. The file is re-serialized as JSON.');
    for (const r of missing) say(ctx, '+ ' + r);
  } else {
    if (!hasPerms) obj.permissions = {};
    // Each key written is moved to the end of its object, as install.ps1's Add-Member -Force moved it
    // (measured: the issue-145 golden, recorded from install.ps1 under PowerShell 5.1 and 7).
    setLast(/** @type {Record<string, unknown>} */ (obj.permissions), 'deny', [...existing, ...missing]);
    setLast(obj, STAMP_KEY, want);
    fs.mkdirSync(path.dirname(settings), { recursive: true });
    if (there && !backup(ctx, settings, settings + '.pmhwc-backup')) return;
    replace(settings, serialize(obj));
    say(ctx, 'MERGED  ' + settings);
  }
}

/**
 * The user-level Claude Code allow entries the policy retired (global/allow-retired.conf, ADR-0035 decision
 * 4): removed by name from permissions.allow only, the previous file kept as settings.json.pmhwc-allow-backup.
 * @param {Ctx} ctx @param {string} settings
 */
export function removeRetiredAllow(ctx, settings) {
  const src = path.join(ctx.scriptDir, 'allow-retired.conf');
  if (!isFile(src)) {
    warn(ctx, 'source not found: ' + src);
    raise(ctx, 2);
    return;
  }
  const retired = lines(src).filter((l) => !/^\s*(#|$)/.test(l));
  if (!isFile(settings)) return;
  const obj = readObject(settings);
  if (obj === null) return; // the deny-floor merge refused it
  const perms = obj.permissions;
  if (!isObject(perms)) return;
  const allow = Array.isArray(perms.allow) ? perms.allow : [];
  const isRetired = (/** @type {unknown} */ x) => typeof x === 'string' && retired.includes(x);
  const hits = unique(allow.filter(isRetired));
  if (hits.length === 0) {
    say(ctx, 'OK      ' + settings + ': no allow entry the policy retired');
    return;
  }
  const what = hits.map((h) => h + ' present -> absent').join('; ');
  const backupFile = settings + '.pmhwc-allow-backup';
  if (ctx.mode === 'check') {
    say(ctx, 'DRIFT   ' + settings + ': install would change permissions.allow ' + what + ' (retired, ADR-0035 decision 4)');
    raise(ctx, 1);
  } else if (ctx.mode === 'dry-run') {
    say(ctx, 'WOULD CHANGE ' + settings + ': permissions.allow ' + what + ' (backup ' + backupFile + ')');
  } else {
    // A file the deny-floor merge refused stays untouched, as its REFUSE line says (PR #547 QA; install.ps1
    // removed the allows from it anyway when only its deny list had the wrong shape).
    if (ctx.refused.has(settings)) {
      warn(ctx, 'REFUSE  ' + settings + ': permissions.allow ' + what + ' left in place, because this file was refused above');
      raise(ctx, 3);
      return;
    }
    const keep = allow.filter((x) => !isRetired(x));
    if (keep.length === 0) delete perms.allow;
    else setLast(perms, 'allow', keep);
    if (Object.keys(perms).length === 0) delete obj.permissions;
    if (!backup(ctx, settings, backupFile)) return;
    replace(settings, serialize(obj));
    say(ctx, 'CHANGED ' + settings + ': permissions.allow ' + what + ' (retired, ADR-0035 decision 4; previous file kept as ' + backupFile + ')');
  }
}

/**
 * A step run by node: REFUSE (an absolute MHW_NODE that is not a file, never replaced by another node) or
 * SKIP (no node), both exit 2, else the node.
 * @param {Ctx} ctx @param {string} what @param {string} skip
 */
function stepNode(ctx, what, skip) {
  const l = nodeLookup(ctx.env);
  if (l.refused) {
    say(ctx, 'REFUSE  ' + what + ': MHW_NODE (' + ctx.env.MHW_NODE + ') is not a file; nothing written');
    raise(ctx, 2);
    return null;
  }
  if (!l.node) {
    say(ctx, 'SKIP    ' + skip);
    raise(ctx, 2);
    return null;
  }
  return l.node;
}

/** Run a renderer of src/render by absolute paths, its output inherited; raise its exit code. @param {Ctx} ctx @param {string} node @param {string} script @param {string[]} args */
function renderer(ctx, node, script, args) {
  const r = runAbsolute(node, [path.join(ctx.repoRoot, 'src', 'render', script), ...args], { env: ctx.env, stdio: 'inherit' });
  if (r.error) warn(ctx, 'mhw: ' + node + ' did not start: ' + r.error.message);
  raise(ctx, r.code);
}

/**
 * The Kiro deny floor (ADR-0036): the validated floor lines, handed to src/render/kiro-permissions.js in a
 * temporary file removed after it. The renderer finds permissions.yaml from USERPROFILE.
 * @param {Ctx} ctx
 */
export function kiroStep(ctx) {
  const node = stepNode(ctx, 'the Kiro deny floor', 'the Kiro deny floor: node (26 or later) is required');
  if (!node) return;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mhw-kiro-floor-'));
  try {
    const tmp = path.join(dir, 'deny-floor.conf');
    fs.writeFileSync(tmp, ctx.floorLines.join('\n') + '\n');
    renderer(ctx, node, 'kiro-permissions.js', ['--mode=' + ctx.mode, '--stamp=' + ctx.stamp, '--floor=' + tmp, '--floor-from=' + ctx.floorFrom]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** The session-start model and effort (ADR-0007), from the overlay's model-defaults.json. @param {Ctx} ctx */
export function modelsStep(ctx) {
  const node = stepNode(ctx, 'the session-start model defaults', 'the session-start model defaults: node (26 or later) is required');
  if (!node) return;
  const file = path.join(ctx.overlay, 'model-defaults.json');
  const policy = ctx.overlay !== 'none' && isFile(file) ? file : 'none';
  renderer(ctx, node, 'model-defaults.js', ['--mode=' + ctx.mode, '--stamp=' + ctx.stamp, '--policy=' + policy, '--home=' + ctx.home]);
}

/** The working method (Issue #61, ADR-0032): off unless --method. @param {Ctx} ctx */
export function methodStep(ctx) {
  const node = stepNode(ctx, 'the working method (method\\)', 'the working method (method\\): node (26 or later) is required');
  if (!node) return;
  const args = ['--mode=' + ctx.mode, '--stamp=' + ctx.stamp, '--home=' + ctx.home];
  if (ctx.method) args.push('--opt-in');
  renderer(ctx, node, 'method.js', args);
}

/**
 * Every step, in install.ps1's order. The exit code.
 * @param {Ctx} ctx
 */
export function run(ctx) {
  const { home, codexHome } = ctx;
  processTarget(ctx, 'plain', path.join(home, '.claude', 'CLAUDE.md'));
  processTarget(ctx, 'plain', path.join(codexHome, 'AGENTS.md'));
  processTarget(ctx, 'kiro', path.join(home, '.kiro', 'steering', 'workstation-global-brief.md'));
  processTarget(ctx, 'codexrules', path.join(codexHome, 'rules', 'workstation-deny-floor.rules'));
  const settings = path.join(home, '.claude', 'settings.json');
  mergeDenyFloor(ctx, settings);
  kiroStep(ctx);
  modelsStep(ctx);
  removeRetiredAllow(ctx, settings);
  say(ctx, 'NOTE    the paste wrapper and the paste filter are not installed on Windows (ADR-0033; not measured there, D7 of #470); no shell start-up file is written, and no Kiro prompt hook (Issue #455)');
  methodStep(ctx);
  return ctx.status;
}

/**
 * `mhw install-windows [flags]`: the exit code.
 * @param {string[]} argv @param {Env} env @param {Io} [io]
 */
export function main(argv, env, io = STDIO) {
  const ctx = prepare(argv, env, io);
  if (typeof ctx === 'number') return ctx;
  return run(ctx);
}
