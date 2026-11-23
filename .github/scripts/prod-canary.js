#!/usr/bin/env node
// The PROD install canary (Issue #452): install the npm package the way the owner does, then check it.
// The Node form of the deleted .github/scripts/prod_canary.py and prod-canary-container.sh (#501, S31 of
// #470): same commands, same checks, the same PASS and FAIL lines and exit codes, except where
// test/golden/S31/expected-differences.json says otherwise.
//
// mhw has no STG or PROD environment. Its PROD is the owner running `mhw install` on his workstation, so
// this is that install, repeated where nothing of his exists: a throwaway HOME, a throwaway npm prefix and
// a throwaway admin root, on a clean container (CI, Linux) or a throwaway HOME (CI, macOS; or by hand).
//
//   prod-canary.js pack --ref REF --out DIR [--name N]   git archive REF (of this checkout), then npm pack
//   prod-canary.js run  --source DIR --tgz HEAD.tgz [--from-tgz OLD.tgz] --work DIR [--commit SHA]
//                       [--legacy "PATH ..."]
//   prod-canary.js container IMAGE PKG_DIR COMMIT fresh|upgrade [--legacy "PATH ..."]
//
// `pack` builds the package from a source archive, as GitHub serves a tag: `git archive` fills in
// .workstation-archive, and npm packs that tree. `run` installs HEAD.tgz with `npm install -g`, then
// `mhw install --yes`; with --from-tgz it first installs OLD.tgz the same way, so the head is an upgrade
// over it. Then it checks, and every check prints PASS or FAIL:
//
//   0. the installed package carries no .py, .sh or .ps1 file, but those --legacy names (the files a later
//      slice of #470 still has to retire), and every --legacy name is still carried (a stale one is red);
//   1. the deny floor rendered into the three agent harness carriers (Claude Code settings.json, the Codex
//      rules file, Kiro permissions.yaml), and into the admin layer under the throwaway root, equals what
//      global/deny-floor.conf plus overlay/deny-floor.conf in --source say it must be;
//   2. the installed prompt hook, run as the harness runs it with the paste-wrapper marker unset, blocks
//      a synthetic credential-shaped prompt and passes a clean one (Claude Code and Codex); Kiro CLI V3's
//      user-level hook file (Issue #455) exists in the V3 shape, and its command blocks the same prompt with
//      exit 2, the redacted copy on stderr and nothing on stdout, with the marker SET as well;
//   3. `mhw status` and `mhw check` exit 0;
//   4. `mhw uninstall --yes` restores every file the owner had, removes the admin layer, and leaves no
//      floor rule, brief or data directory of mhw behind.
//
// `container` runs `run` inside IMAGE (pinned by digest, the convention of reference-delivery-gate.yml),
// as the image's unprivileged `node` user, against packages built OUTSIDE it by `pack`: PKG_DIR holds
// mhw-HEAD.tgz, src-HEAD/ and, for upgrade, mhw-from.tgz, mounted read-only, and the canary that runs is
// src-HEAD's own copy of this file. CONTAINER_RUNTIME picks docker (default) or podman. The one thing
// fetched inside is jq, from the image's own Debian archive, because install.sh needs it.
//
// EVIDENCE LEVEL: installed. Nothing here starts an agent harness, so nothing here shows a rule is loaded
// or enforced. The admin layer goes into a throwaway root, never /Library or /etc. Payloads are synthetic.
// Needs git, node, npm and jq on PATH (absolute entries only; programs run by absolute path). Imports:
// node: modules and three files of src/lib that import nothing else, so `run` works from any copy of the
// source tree (the container runs the one in src-HEAD). POSIX: hooks run through /bin/sh.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { pyRepr, pyStrip, isPyWs, cmpStr, codePoints } from '../../src/lib/py.js';
import { splitLines } from '../../src/lib/py-text.js';
import { onPath } from '../../src/lib/onpath.js';

export const MARKER = 'PMHWC_PASTE_WRAPPER'; // src/commands/hook-prompt.js, WRAPPER_MARKER
export const NAME = 'personal-multi-harness-workstation-configuration';
const WORD = /^[A-Za-z0-9._/~=:@+*-]+$/;
// `pack` reads the checkout this script sits in (.github/scripts/ -> the repository root); `run` needs
// no checkout.
const SCRIPT = fileURLToPath(import.meta.url);
const CHECKOUT = path.resolve(path.dirname(SCRIPT), '..', '..');
const CLAUDE_SETTINGS = '.claude/settings.json';
const FLOOR_FILES = ['global/deny-floor.conf', 'overlay/deny-floor.conf']; // install.sh appends the overlay's
const MAX_BUFFER = 256 * 1024 * 1024;
// The file kinds one runtime retires (#470): none may be in the installed package.
const RETIRED_KINDS = ['.py', '.sh', '.ps1'];
// install.sh's start fallback for Kiro (paste_wrap, PR #536 lens B3): test/clipboard/hook.test.js holds it
// to install.sh's own function.
export const KIRO_NOTICE = 'Paste filter (ADR-0033): internal error (HookStartError); this prompt was NOT checked.';

/** @type {string[]} */
const failures = [];

class Exit extends Error {
  /** @param {number} code */
  constructor(code) {
    super('exit ' + code);
    this.code = code;
  }
}

/** @param {string} s */
function out(s) {
  process.stdout.write(s + '\n');
}

/**
 * @param {unknown} ok
 * @param {string} what
 * @param {string} [detail]
 */
function check(ok, what, detail = '') {
  out((ok ? 'PASS  ' : 'FAIL  ') + what + (ok || !detail ? '' : '\n      ' + detail));
  if (!ok) failures.push(what);
  return Boolean(ok);
}

/** @param {string} msg @returns {never} */
function die(msg) {
  out('ERROR ' + msg);
  throw new Exit(2);
}

/** The last n code points of s, as Python's s[-n:]. @param {string} s @param {number} n */
const tail = (s, n) => codePoints(s).slice(-n).join('');
/** The first n code points of s, as Python's s[:n]. @param {string} s @param {number} n */
const head = (s, n) => codePoints(s).slice(0, n).join('');
/** Python's sorted() of strings. @param {Iterable<string>} xs */
const sorted = (xs) => [...xs].sort(cmpStr);
/** Python's str.split() with no argument. @param {string} s */
function pySplit(s) {
  const words = [];
  let cur = '';
  for (const ch of s) {
    if (isPyWs(ch)) {
      if (cur) words.push(cur);
      cur = '';
    } else cur += ch;
  }
  if (cur) words.push(cur);
  return words;
}
/** @param {Set<string>} a @param {Set<string>} b */
const minus = (a, b) => new Set([...a].filter((x) => !b.has(x)));
/** @param {Set<string>} a @param {Set<string>} b */
const sameSet = (a, b) => a.size === b.size && [...a].every((x) => b.has(x));
/** @param {unknown} v @returns {v is Record<string, unknown>} */
const isDict = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
/** dict.get(key, fallback) of a parsed JSON value. @param {unknown} d @param {string} key @param {unknown} fallback */
function get(d, key, fallback) {
  if (!isDict(d)) throw new TypeError('not a JSON object');
  return Object.hasOwn(d, key) ? d[key] : fallback;
}
/** A list of strings read from a document, as Python's set() over it. @param {unknown} v */
function strings(v) {
  if (typeof v === 'string') return [...v];
  if (!Array.isArray(v)) throw new TypeError('not a list');
  return v.map((x) => (typeof x === 'string' ? x : JSON.stringify(x)));
}

/**
 * Python's Path.resolve() (not strict): the longest existing prefix with its links resolved, then the rest.
 * @param {string} p
 */
function resolveLoose(p) {
  const abs = path.resolve(p);
  const rest = [];
  let cur = abs;
  for (;;) {
    try {
      return path.join(fs.realpathSync.native(cur), ...rest);
    } catch {
      const parent = path.dirname(cur);
      if (parent === cur) return abs;
      rest.unshift(path.basename(cur));
      cur = parent;
    }
  }
}

/**
 * A program on PATH (absolute entries only), run by absolute path.
 * @param {string} name
 * @param {Record<string, string | undefined>} env
 */
function program(name, env) {
  const p = onPath(name, env);
  if (!p) throw new Error(name + ' is not on PATH (absolute entries only)');
  return p;
}

/**
 * @typedef {{ returncode: number, stdout: string, stderr: string }} Ran
 * @param {string} exe
 * @param {string[]} args
 * @param {{ env?: Record<string, string | undefined>, cwd?: string, input?: string, timeout?: number }} [opts]
 * @returns {Ran}
 */
export function runText(exe, args, opts = {}) {
  const p = spawnSync(exe, args, {
    env: opts.env, cwd: opts.cwd, input: opts.input, timeout: opts.timeout, encoding: 'utf8', maxBuffer: MAX_BUFFER,
  });
  if (p.error && !p.signal) throw p.error;
  // Python reports a process killed by a signal as -signal.
  const sig = p.signal ? os.constants.signals[p.signal] : 0;
  return { returncode: p.status ?? -(sig || 1), stdout: p.stdout ?? '', stderr: p.stderr ?? '' };
}

// --- a tar reader (git archive and npm pack write ustar with pax headers) ----------------------------------

/**
 * @typedef {{ name: string, type: string, mode: number, linkname: string, data: Buffer }} TarMember
 *   type: file, dir, symlink, hardlink, or the raw typeflag of anything else
 */

/** @param {Buffer} b @param {number} at @param {number} len */
function field(b, at, len) {
  const s = b.subarray(at, at + len);
  const nul = s.indexOf(0);
  return (nul < 0 ? s : s.subarray(0, nul)).toString('utf8');
}

/** An octal (or base-256) number field. @param {Buffer} b @param {number} at @param {number} len */
function octal(b, at, len) {
  if (b[at] & 0x80) {
    let n = 0;
    for (let i = at + 1; i < at + len; i++) n = n * 256 + b[i];
    return n;
  }
  const s = field(b, at, len).trim();
  return s ? Number.parseInt(s, 8) : 0;
}

/** pax extended header records ("LEN key=value\n"). @param {Buffer} data */
function paxRecords(data) {
  /** @type {Record<string, string>} */
  const rec = {};
  let i = 0;
  while (i < data.length) {
    const sp = data.indexOf(0x20, i);
    if (sp < 0) break;
    const len = Number.parseInt(data.subarray(i, sp).toString('utf8'), 10);
    if (!Number.isFinite(len) || len <= 0) break;
    const line = data.subarray(sp + 1, i + len - 1).toString('utf8');
    const eq = line.indexOf('=');
    if (eq > 0) rec[line.slice(0, eq)] = line.slice(eq + 1);
    i += len;
  }
  return rec;
}

/**
 * The members of an uncompressed tar archive.
 * @param {Buffer} buf
 * @returns {TarMember[]}
 */
export function readTar(buf) {
  /** @type {TarMember[]} */
  const members = [];
  /** @type {Record<string, string>} */
  let pax = {};
  let at = 0;
  while (at + 512 <= buf.length) {
    const h = buf.subarray(at, at + 512);
    if (h.every((x) => x === 0)) break;
    const flag = String.fromCodePoint(h[156] || 0x30);
    let size = octal(h, 124, 12);
    if (pax.size) size = Number(pax.size);
    const data = buf.subarray(at + 512, at + 512 + size);
    at += 512 + Math.ceil(size / 512) * 512;
    if (flag === 'x') {
      pax = { ...pax, ...paxRecords(data) };
      continue;
    }
    if (flag === 'g') continue; // git's global header: the commit id, as a comment
    const prefix = field(h, 345, 155);
    const base = field(h, 0, 100);
    const name = pax.path ?? (prefix ? prefix + '/' + base : base);
    const linkname = pax.linkpath ?? field(h, 157, 100);
    /** @type {Record<string, string>} */
    const kinds = { '0': 'file', '\u0000': 'file', '7': 'file', '5': 'dir', '2': 'symlink', '1': 'hardlink' };
    members.push({ name, type: kinds[flag] ?? flag, mode: octal(h, 100, 8), linkname, data: Buffer.from(data) });
    pax = {};
  }
  return members;
}

/**
 * Extract a git archive as Python's tarfile does with the "data" filter: no absolute path, nothing out of
 * the tree, no link out of it, no special file; a file's mode without group and other write, set-id or
 * sticky bits, and owner read and write always.
 * @param {TarMember[]} members
 * @param {string} dest an existing, empty, resolved directory
 */
export function extractData(members, dest) {
  /** @param {string} p */
  const inside = (p) => p === dest || p.startsWith(dest + path.sep);
  for (const m of members) {
    const target = path.resolve(dest, m.name.replace(/^\/+/, ''));
    if (!inside(target)) die('git archive: ' + pyRepr(m.name) + ' would be extracted outside the destination');
    if (m.type === 'dir') fs.mkdirSync(target, { recursive: true });
    else if (m.type === 'symlink') {
      if (path.isAbsolute(m.linkname) || !inside(path.resolve(path.dirname(target), m.linkname))) {
        die('git archive: ' + pyRepr(m.name) + ' is a link out of the destination');
      }
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.symlinkSync(m.linkname, target);
    } else if (m.type === 'file') {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, m.data);
      fs.chmodSync(target, dataMode(m.mode));
    } else die('git archive: ' + pyRepr(m.name) + ' is not a regular file, a directory or a symbolic link');
  }
}

/** The data filter's mode for a regular file. @param {number} raw */
function dataMode(raw) {
  let mode = raw & 0o755;
  if (!(mode & 0o100)) mode &= ~0o111;
  return mode | 0o600;
}

/** set.add into the set stored under key, creating it. @param {Record<string, Set<string>>} sets @param {string} key @param {string} value */
function addTo(sets, key, value) {
  if (!sets[key]) sets[key] = new Set();
  sets[key].add(value);
}

// --- pack ------------------------------------------------------------------------------------------------

/**
 * The ref as git itself spells it: HEAD, a tag that exists, or a full commit SHA. Nothing taken from the
 * command line reaches git's argument list as typed.
 * @param {string} arg
 */
function knownRef(arg) {
  if (arg === 'HEAD') return 'HEAD';
  if (/^[0-9a-f]{40}$/.test(arg)) return BigInt('0x' + arg).toString(16).padStart(40, '0');
  const git = program('git', process.env);
  const tags = pySplit(runText(git, ['-C', CHECKOUT, 'tag', '--list']).stdout);
  const found = tags.filter((t) => t === arg);
  if (!found.length) die('refusing ref ' + pyRepr(arg) + ': HEAD, an existing tag or a full commit SHA only');
  return found[0];
}

/** @param {Record<string, string | undefined>} a */
function cmdPack(a) {
  const ref = knownRef(/** @type {string} */ (a.ref));
  fs.mkdirSync(path.resolve(/** @type {string} */ (a.out)), { recursive: true });
  const outDir = fs.realpathSync.native(path.resolve(/** @type {string} */ (a.out)));
  const name = a.name || ref.replace(/[^A-Za-z0-9._-]/g, '_');
  const src = path.join(outDir, 'src-' + name);
  if (fs.existsSync(src)) die(src + ' exists; pack into a fresh directory');
  fs.mkdirSync(src);
  const git = program('git', process.env);
  const raw = spawnSync(git, ['-C', CHECKOUT, 'archive', '--format=tar', '--end-of-options', ref], { maxBuffer: MAX_BUFFER });
  if (raw.status !== 0) die('git archive ' + ref + ': ' + pyStrip(Buffer.from(raw.stderr ?? '').toString('utf8')));
  extractData(readTar(raw.stdout), src);
  const npm = program('npm', process.env);
  const p = runText(npm, ['pack', '--pack-destination', outDir, '--cache', path.join(outDir, 'npm-cache')], { cwd: src });
  if (p.returncode) die('npm pack: ' + p.stdout + p.stderr);
  const lines = splitLines(pyStrip(p.stdout));
  const tgz = path.join(outDir, String(lines.at(-1)));
  const named = path.join(outDir, 'mhw-' + name + '.tgz');
  fs.renameSync(tgz, named);
  out(named);
}

// --- what the floor must render to (read from the source, independently of the installer) ---------------

/**
 * One deny-floor line -> [kind, words], or null for a blank or comment line.
 * @param {string} rel
 * @param {string} raw
 * @returns {[string, string[]] | null}
 */
function floorLine(rel, raw) {
  const line = pyStrip(raw);
  if (!line || line.startsWith('#')) return null;
  const f = pySplit(line);
  if (!['cmd', 'file', 'glob'].includes(f[0]) || f.length < 2 || !f.slice(1).every((w) => WORD.test(w))) {
    die('unreadable deny-floor entry in ' + rel + ': ' + line);
  }
  return [f[0], f.slice(1)];
}

/** @param {string} source */
function floorEntries(source) {
  /** @type {Array<[string, string[]]>} */
  const entries = [];
  const root = fs.realpathSync.native(path.resolve(source));
  for (const rel of FLOOR_FILES) {
    const p = resolveLoose(path.join(root, rel));
    if (p !== root && !p.startsWith(root + path.sep)) die(rel + ' resolves outside the source tree');
    if (fs.existsSync(p) && fs.statSync(p).isFile()) {
      for (const raw of splitLines(fs.readFileSync(p, 'utf8'))) {
        const e = floorLine(rel, raw);
        if (e) entries.push(e);
      }
    }
  }
  if (!entries.length) die('no deny-floor entry under ' + source);
  return entries;
}

/**
 * @typedef {{ claude: Set<string>, codex: string[][], kiro: Record<'shell' | 'fs_read' | 'fs_write', Set<string>> }} Expected
 * @param {Array<[string, string[]]>} entries
 * @returns {Expected}
 */
function expected(entries) {
  /** @type {Expected} */
  const e = { claude: new Set(), codex: [], kiro: { shell: new Set(), fs_read: new Set(), fs_write: new Set() } };
  for (const [kind, words] of entries) {
    const w = words.join(' ');
    if (kind === 'cmd') {
      e.claude.add('Bash(' + w + ':*)');
      e.codex.push([...words]);
      e.kiro.shell.add(w + ' *');
    } else if (kind === 'glob') {
      e.claude.add('Bash(' + w + ')');
      e.kiro.shell.add(w);
    } else {
      e.claude.add('Read(' + w + ')').add('Edit(' + w + ')');
      e.kiro.fs_read.add(w);
      e.kiro.fs_write.add(w);
    }
  }
  return e;
}

// --- readers for the installed carriers ------------------------------------------------------------------

/** @param {string} p @returns {unknown} */
const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
/** @param {string} p */
const isFile = (p) => {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
};

/** @param {string} p @returns {unknown[]} */
function codexRules(p) {
  const pre = 'prefix_rule(pattern=';
  const post = ', decision="forbidden")';
  const pats = [];
  for (const line of splitLines(fs.readFileSync(p, 'utf8'))) {
    const s = pyStrip(line);
    if (s.length < pre.length + post.length + 2 || !s.startsWith(pre) || !s.endsWith(post)) continue;
    const mid = s.slice(pre.length, s.length - post.length);
    if (mid.startsWith('[') && mid.endsWith(']')) pats.push(JSON.parse(mid));
  }
  return pats;
}

/** -> [prefix rule patterns, hook commands] from the admin requirements.toml mhw writes. @param {string} p */
function codexRequirements(p) {
  const pats = [];
  const hooks = [];
  for (const line of splitLines(fs.readFileSync(p, 'utf8'))) {
    const s = pyStrip(line);
    if (s.startsWith('{ pattern = [') && s.includes('decision = "forbidden"')) {
      pats.push([...s.split('], decision')[0].matchAll(/\{ token = "([^"]*)" \}/g)].map((m) => m[1]));
    }
    const pre = 'command = ';
    if (s.startsWith(pre + '"') && s.endsWith('"') && s.length >= pre.length + 2) hooks.push(JSON.parse(s.slice(pre.length)));
  }
  return { pats, hooks };
}

/** -> {capability: set(patterns)} over the deny rules of a permissions.yaml in the subset mhw writes. @param {string} p */
function kiroYaml(p) {
  /** @type {Record<string, Set<string>>} */
  const res = {};
  /** @type {string | null} */
  let cap = null;
  /** @type {string | null} */
  let effect = null;
  let inMatch = false;
  for (const line of splitLines(fs.readFileSync(p, 'utf8'))) {
    const s = pyStrip(line);
    if (!s || s.startsWith('#')) continue;
    let m = /^- capability: "([^"]*)"$/.exec(s);
    if (m) {
      [cap, effect, inMatch] = [m[1], null, false];
      continue;
    }
    m = /^effect: "([^"]*)"$/.exec(s);
    if (m) {
      effect = m[1];
      continue;
    }
    if (s === 'match:' || s === 'exclude:') {
      inMatch = s === 'match:';
      continue;
    }
    if (s.startsWith('- "') && s.endsWith('"') && s.length >= 4 && inMatch && cap && effect === 'deny') {
      addTo(res, cap, String(JSON.parse(s.slice(2))));
    }
  }
  return res;
}

/** @param {string} p */
function kiroManaged(p) {
  /** @type {Record<string, Set<string>>} */
  const res = {};
  for (const r of /** @type {unknown[]} */ (get(readJson(p), 'rules', []))) {
    if (get(r, 'effect', null) === 'deny') {
      const cap = String(/** @type {Record<string, unknown>} */ (r).capability);
      for (const x of strings(get(r, 'match', []))) addTo(res, cap, x);
    }
  }
  return res;
}

/** Python's ordering of Path objects: by their parts. @param {string} a @param {string} b */
function cmpPath(a, b) {
  const x = a.split('/');
  const y = b.split('/');
  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    const d = cmpStr(x[i], y[i]);
    if (d) return d;
  }
  return x.length - y.length;
}

/**
 * Python's Path.rglob(pattern) for a literal pattern ("*" matches every name): every path under base, at
 * any depth, whose last components are the pattern's. Links to directories are not followed.
 * @param {string} base
 * @param {string} pattern
 * @returns {string[]}
 */
function rglob(base, pattern) {
  const want = pattern.split('/');
  /** @type {string[]} */
  const found = [];
  /** @param {string} dir */
  const walk = (dir) => {
    /** @type {fs.Dirent[]} */
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      const parts = path.relative(base, p).split(path.sep);
      if (pattern === '*' || (parts.length >= want.length && want.every((w, i) => parts[parts.length - want.length + i] === w))) found.push(p);
      if (e.isDirectory()) walk(p);
    }
  };
  walk(base);
  return found;
}

/** @param {string[]} paths @param {string} what */
function one(paths, what) {
  const s = [...paths].sort(cmpPath);
  if (s.length !== 1) {
    check(false, what, 'expected exactly one file, found ' + s.length + ': ' + pyRepr(s));
    return null;
  }
  return s[0];
}

// --- the throwaway workstation ---------------------------------------------------------------------------

const OWNER_DENY = 'Bash(owner-canary-tool --only-mine:*)';
const OWNER_KIRO = 'owner-canary-tool --only-mine *';

/** What the owner already has before mhw arrives: uninstall must give it back byte for byte. @param {string} home */
function seed(home) {
  /** @type {Record<string, string>} */
  const files = {
    [CLAUDE_SETTINGS]: JSON.stringify({ theme: 'dark', permissions: { deny: [OWNER_DENY] }, model: 'owner-chosen-model' }, null, 2) + '\n',
    '.codex/config.toml': 'model = "owner-chosen-model"\n\n[tui]\nnotifications = false\n',
    '.kiro/settings/permissions.yaml': 'rules:\n  - capability: "shell"\n    effect: "deny"\n'
      + '    match:\n      - "' + OWNER_KIRO + '"\n',
    '.zshrc': "# the owner's own zsh line\nexport OWNER_CANARY=1\n",
    '.bashrc': "# the owner's own bash line\nexport OWNER_CANARY=1\n",
  };
  for (const [rel, text] of Object.entries(files)) {
    const p = path.join(home, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, text, 'utf8');
  }
  return files;
}

/** Every regular file under base (links excluded) -> its sha256, in Python's sorted order. @param {string} base */
function snapshot(base) {
  /** @type {Map<string, string>} */
  const res = new Map();
  for (const p of rglob(base, '*').sort(cmpPath)) {
    const st = fs.lstatSync(p);
    if (st.isFile()) res.set(path.relative(base, p).split(path.sep).join('/'), crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex'));
  }
  return res;
}

/** A PATH holding only what install needs, so no agent harness CLI or gh of the host is found. @param {string} work */
function toolsDir(work) {
  const d = path.join(work, 'tools');
  fs.mkdirSync(d);
  for (const name of ['node', 'npm', 'npx', 'jq', 'git']) {
    const found = onPath(name, process.env);
    if (!found) die(name + ' is not on PATH');
    fs.symlinkSync(found, path.join(d, name));
  }
  return d;
}

class Box {
  /** @param {string} work @param {string} label */
  constructor(work, label) {
    this.d = path.join(work, label);
    for (const sub of ['home', 'root', 'tmp', 'proj', 'prefix', 'cache']) fs.mkdirSync(path.join(this.d, sub), { recursive: true });
    this.home = path.join(this.d, 'home');
    this.root = path.join(this.d, 'root');
    /** @type {Record<string, string>} */
    this.env = {
      PATH: [path.join(this.d, 'prefix', 'bin'), path.join(work, 'tools'), '/usr/bin', '/bin'].join(path.delimiter),
      HOME: this.home, TMPDIR: path.join(this.d, 'tmp'), LANG: 'C.UTF-8',
      WORKSTATION_MANAGED_ROOT: this.root, MHW_POSTINSTALL_TTY: '0',
      npm_config_cache: path.join(this.d, 'cache'), npm_config_prefix: path.join(this.d, 'prefix'),
      npm_config_userconfig: path.join(this.d, 'npmrc'), npm_config_update_notifier: 'false',
      npm_config_audit: 'false', npm_config_fund: 'false',
    };
    if (process.env.USER) this.env.USER = process.env.USER;
  }

  /** @param {string} name @param {...string} args */
  run(name, ...args) {
    return runText(program(name, this.env), args, { env: this.env, cwd: path.join(this.d, 'proj') });
  }

  /** @param {string} tgz @param {string} what */
  install(tgz, what) {
    let p = this.run('npm', 'install', '-g', '--offline', '--foreground-scripts', tgz);
    if (!check(p.returncode === 0, 'npm install -g ' + what, tail(p.stdout + p.stderr, 2000))) return false;
    p = this.run('mhw', 'install', '--yes');
    return check(p.returncode === 0 && p.stdout.includes('Installation successful!'),
      'mhw install --yes (' + what + ')', 'exit ' + p.returncode + '\n' + tail(p.stdout + p.stderr, 3000));
  }

  /** The installed package directory, its links resolved. */
  pkg() {
    return path.join(this.d, 'prefix', 'lib', 'node_modules', 'mhw');
  }
}

// --- the checks ------------------------------------------------------------------------------------------

/**
 * 0: no file of a retired kind in the installed package, but the --legacy ones, which must all be there.
 * @param {Box} box
 * @param {string[]} legacy
 */
function checkPackage(box, legacy) {
  const pkg = fs.realpathSync.native(box.pkg());
  const carried = sorted(rglob(pkg, '*')
    .filter((p) => fs.lstatSync(p).isFile() && RETIRED_KINDS.some((k) => p.toLowerCase().endsWith(k)))
    .map((p) => path.relative(pkg, p).split(path.sep).join('/')));
  const allowed = new Set(legacy);
  const extra = carried.filter((r) => !allowed.has(r));
  const kinds = RETIRED_KINDS.join(', ').replace(/, (?=[^,]*$)/, ' or ');
  check(!extra.length, 'the installed package carries no ' + kinds + ' file'
    + (legacy.length ? ' but the ' + legacy.length + ' --legacy one(s) still to be retired' : ''), 'carried: ' + pyRepr(extra));
  if (legacy.length) {
    const gone = sorted(legacy.filter((r) => !carried.includes(r)));
    check(!gone.length, 'every --legacy file is still in the installed package (remove a retired one from --legacy)',
      'no longer carried: ' + pyRepr(gone));
  }
}

/**
 * The Kiro hook command install.sh must render, from its inner command (paste_wrap's start fallback).
 * @param {string} inner
 */
export function kiroHookCommand(inner) {
  return "/bin/sh -c '" + inner + ' || { [ $? -eq 2 ] && exit 2; printf "' + String.raw`%s\n` + '" "' + KIRO_NOTICE + "\" >&2; exit 2; }'";
}

/** "missing [...]; extra [...]" between two sets, ten of each at most. @param {Set<string>} want @param {Set<string>} got */
const missingExtra = (want, got) => 'missing ' + pyRepr(sorted(minus(want, got)).slice(0, 10)) + '; extra ' + pyRepr(sorted(minus(got, want)).slice(0, 10));

/** @param {unknown} doc a settings document @returns {Set<string>} its permissions.deny */
const denyOf = (doc) => new Set(strings(get(get(doc, 'permissions', {}), 'deny', [])));

/** 1, user level: the three carriers in HOME. @param {Box} box @param {Expected} exp */
function checkUserCarriers(box, exp) {
  const { claude, codex, kiro } = exp;
  const s = readJson(path.join(box.home, CLAUDE_SETTINGS));
  const deny = denyOf(s);
  const owned = new Set(strings(get(s, NAME + '-owned-deny', [])));
  check([...claude].every((x) => deny.has(x)), 'Claude Code user settings.json carries every floor rule (' + claude.size + ')',
    'missing: ' + pyRepr(sorted(minus(claude, deny)).slice(0, 10)));
  check(sameSet(owned, claude), 'Claude Code: the rules mhw records as its floor are exactly the floor', missingExtra(claude, owned));
  check(deny.has(OWNER_DENY), "Claude Code: the owner's own deny rule is kept");
  const rules = path.join(box.home, '.codex', 'rules', 'workstation-deny-floor.rules');
  const got = isFile(rules) ? codexRules(rules) : [];
  const has = (/** @type {unknown[]} */ list, /** @type {unknown} */ c) => list.some((x) => JSON.stringify(x) === JSON.stringify(c));
  check(JSON.stringify(got) === JSON.stringify(codex), "Codex user rules file equals the floor's " + codex.length + ' cmd entries',
    'got ' + got.length + ' rules; first missing: ' + pyRepr(codex.filter((c) => !has(got, c)).slice(0, 5)));
  const k = kiroYaml(path.join(box.home, '.kiro', 'settings', 'permissions.yaml'));
  const caps = capsOf(kiro);
  const kmine = Object.fromEntries(caps.map((c) => [c, minus(k[c] ?? new Set(), new Set([OWNER_KIRO]))]));
  check(caps.every((c) => sameSet(kmine[c], kiro[c])), 'Kiro user permissions.yaml equals the floor (' + kiro.shell.size + ' shell, '
    + kiro.fs_read.size + ' fs_read, ' + kiro.fs_write.size + ' fs_write)',
    'missing ' + pyRepr(Object.fromEntries(caps.map((c) => [c, sorted(minus(kiro[c], kmine[c])).slice(0, 5)]))));
  check((k.shell ?? new Set()).has(OWNER_KIRO), "Kiro: the owner's own deny rule is kept");
}

/** @param {Expected['kiro']} kiro */
const capsOf = (kiro) => /** @type {Array<'shell' | 'fs_read' | 'fs_write'>} */ (Object.keys(kiro));

/**
 * 1, admin level: the three documents under the throwaway root (never /Library or /etc here), and the
 * Claude Code and Codex prompt hook commands they name.
 * @param {Box} box @param {Expected} exp
 * @returns {Record<string, string[]>}
 */
function checkAdmin(box, exp) {
  const { claude, codex, kiro } = exp;
  /** @type {Record<string, string[]>} */
  const hooks = {};
  const drop = one(rglob(box.root, 'managed-settings.d/50-' + NAME + '.json'), 'Claude Code admin drop-in');
  if (drop) {
    const md = denyOf(readJson(drop));
    check(sameSet(md, claude), 'Claude Code admin drop-in (throwaway root) equals the floor', missingExtra(claude, md));
  }
  const req = one(rglob(box.root, 'codex/requirements.toml'), 'Codex admin requirements.toml');
  if (req) {
    const r = codexRequirements(req);
    hooks.codex = r.hooks.map(String).filter(pasteFilterOnly);
    check(JSON.stringify(r.pats) === JSON.stringify(codex), 'Codex admin requirements.toml (throwaway root) equals the floor',
      'got ' + r.pats.length + ' prefix rules');
  }
  // macOS: <root>/Library/Application Support/Kiro/; Linux: <root>/etc/kiro/.
  const km = one(rglob(box.root, 'managed-settings.json').filter((p) => ['Kiro', 'kiro'].includes(path.basename(path.dirname(p)))),
    'Kiro admin managed-settings.json');
  if (km) {
    const g = kiroManaged(km);
    check(capsOf(kiro).every((c) => sameSet(g[c] ?? new Set(), kiro[c])), 'Kiro admin managed-settings.json (throwaway root) equals the floor');
  }
  if (drop) hooks.claude = claudeHooks(readJson(drop)).filter(pasteFilterOnly);
  return hooks;
}

/**
 * The paste filter's prompt hook among the admin hooks: the fixed-pattern check's entries (#588, the installed
 * src/hooks/pattern-check.js) sit beside it in the same documents and are held by test/hooks/ and
 * test/install/admin.test.js, so this canary keeps checking the one hook it always checked.
 * @param {string} cmd
 */
const pasteFilterOnly = (cmd) => !cmd.includes('/pattern-check.js"');

/** The command hooks of a Claude Code settings document's UserPromptSubmit. @param {unknown} doc */
function claudeHooks(doc) {
  /** @type {string[]} */
  const out = [];
  for (const e of /** @type {unknown[]} */ (get(get(doc, 'hooks', {}), 'UserPromptSubmit', []))) {
    for (const h of /** @type {unknown[]} */ (get(e, 'hooks', []))) {
      if (get(h, 'type', null) === 'command') out.push(String(/** @type {Record<string, unknown>} */ (h).command));
    }
  }
  return out;
}

/**
 * Kiro CLI V3's hook file (Issue #455): user level, the V3 shape read from the kas 2.35.2 bundle. Returns
 * the one command to run, which is the expected string, never one read from the file.
 * @param {Box} box
 * @returns {string[]}
 */
function checkKiroHookFile(box) {
  const kh = path.join(box.home, '.kiro', 'hooks', NAME + '-paste-filter.json');
  const kdoc = isFile(kh) ? readJson(kh) : {};
  const kentries = /** @type {unknown[]} */ (Array.isArray(get(kdoc, 'hooks', null)) ? get(kdoc, 'hooks', []) : []);
  const desc = kentries.length === 1 ? get(kentries[0], 'description', '') : '';
  check(isFile(kh) && get(kdoc, 'version', null) === 'v1' && kentries.length === 1
    && (typeof desc === 'string' ? desc : pyRepr(desc)).includes('managed-by: ' + NAME)
    && get(kentries[0], 'trigger', null) === 'UserPromptSubmit',
  'Kiro: the user-level hook file is rendered in the V3 shape', kh);
  // The command is compared with the one install.sh must render for this HOME, and only that expected
  // string is run: a command read from a file is never executed as given.
  const data = path.join(box.home, '.local', 'share', NAME);
  // #488: `mhw hook prompt` on the node install.sh found first on PATH (the tools directory), by absolute
  // path, from the installed package, with NODE_OPTIONS, NODE_ICU_DATA and NODE_PATH cleared.
  const node = path.join(path.dirname(box.d), 'tools', 'node');
  const mhwJs = path.join(resolveLoose(box.pkg()), 'bin', 'mhw.js');
  const inner = '/usr/bin/env -u NODE_OPTIONS -u NODE_ICU_DATA -u NODE_PATH -u NODE_COMPILE_CACHE "' + node + '" "' + mhwJs
    + '" hook prompt --harness kiro --config "' + path.join(data, 'clipboard.conf') + '"';
  const want = kiroHookCommand(inner);
  /** @param {unknown} e */
  const action = (e) => get(e, 'action', null);
  const commands = kentries.filter((e) => isDict(action(e)) && get(action(e), 'type', null) === 'command')
    .map((e) => get(action(e), 'command', null));
  const ok = commands.length === 1 && commands[0] === want;
  check(ok, 'Kiro: the hook file runs the installed core in kiro mode', 'got ' + pyRepr(commands.slice(0, 2)));
  return ok ? [want] : [];
}

/**
 * @param {Box} box
 * @param {Expected} exp
 * @returns {Record<string, string[]>}
 */
function checkFloor(box, exp) {
  checkUserCarriers(box, exp);
  const hooks = checkAdmin(box, exp);
  hooks.kiro = checkKiroHookFile(box);
  return hooks;
}

/**
 * @typedef {{ fire: (cmd: string, prompt: string, environ: Record<string, string>) => Ran, env: Record<string, string>,
 *   dirty: string, clean: string, fakeKey: string }} HookRig
 */

/** The decision of a Claude Code or Codex hook answer, or null. @param {string} stdout */
function decisionOf(stdout) {
  /** @type {unknown} */
  let parsed = {};
  try {
    parsed = pyStrip(stdout) ? JSON.parse(stdout) : {};
  } catch {
    parsed = {};
  }
  return isDict(parsed) ? parsed.decision ?? null : null;
}

/** 2, Claude Code or Codex: block the dirty prompt, pass the clean one, stay silent under the marker. @param {string} harness @param {string[]} cmds @param {HookRig} rig */
function checkJsonHook(harness, cmds, rig) {
  if (!check(cmds.length === 1, harness + ': exactly one installed prompt hook', 'found ' + cmds.length)) return;
  check(!(MARKER in rig.env), harness + ': the paste-wrapper marker is unset for the hook');
  let p = rig.fire(cmds[0], rig.dirty, rig.env);
  const decision = decisionOf(p.stdout);
  check(p.returncode === 0 && decision === 'block' && !p.stdout.includes(rig.fakeKey),
    harness + ': the installed hook blocks a synthetic credential-shaped prompt',
    'exit ' + p.returncode + ', decision ' + pyRepr(decision) + ', stderr ' + tail(p.stderr, 500));
  p = rig.fire(cmds[0], rig.clean, rig.env);
  check(p.returncode === 0 && p.stdout === '', harness + ': the installed hook passes a clean prompt',
    'exit ' + p.returncode + ', stdout ' + pyRepr(head(p.stdout, 300)));
  // Calibration: the same dirty prompt in a session the paste wrapper started passes silently, so the
  // block above came from the hook judging the prompt, not from something unrelated to the marker.
  p = rig.fire(cmds[0], rig.dirty, { ...rig.env, [MARKER]: '1' });
  check(p.returncode === 0 && p.stdout === '', harness + ': calibration, with the wrapper marker set the hook stays silent');
}

/**
 * 2, Kiro's protocol (read from the bundle): exit 2 blocks with stderr as the reason; on exit 0 stdout is
 * appended to the model's prompt. On V3 the wrapper cleans pastes but never checks typed text, so the
 * marker must NOT silence it.
 * @param {string[]} cmds @param {HookRig} rig
 */
function checkKiroHook(cmds, rig) {
  if (!check(cmds.length === 1, 'kiro: exactly one installed prompt hook', 'found ' + cmds.length)) return;
  for (const [label, environ] of /** @type {Array<[string, Record<string, string>]>} */ ([['marker unset', rig.env], ['marker set', { ...rig.env, [MARKER]: '1' }]])) {
    const p = rig.fire(cmds[0], rig.dirty, environ);
    check(p.returncode === 2 && p.stdout === '' && p.stderr.includes('[REDACTED:credential]') && !p.stderr.includes(rig.fakeKey),
      'kiro (' + label + '): the installed hook blocks with exit 2, a redacted copy on stderr, nothing on stdout',
      'exit ' + p.returncode + ', stdout ' + pyRepr(head(p.stdout, 200)));
  }
  const p = rig.fire(cmds[0], rig.clean, rig.env);
  check(p.returncode === 0 && p.stdout === '', 'kiro: the installed hook passes a clean prompt',
    'exit ' + p.returncode + ', stdout ' + pyRepr(head(p.stdout, 300)));
}

/**
 * @param {Box} box
 * @param {Record<string, string[]>} hooks
 */
function checkHook(box, hooks) {
  // Built at run time from pieces, so no credential-shaped literal sits in this file: the AWS access
  // key id shape (AKIA + 16 of [0-9A-Z]), synthetic, belonging to no account.
  const fakeKey = 'AK' + 'IA' + 'QZ7X'.repeat(4);
  const cwd = path.join(box.d, 'proj');
  /** @type {HookRig} */
  const rig = {
    fakeKey, dirty: 'deploy it with key ' + fakeKey + ' please', clean: 'summarise the README in two lines',
    env: Object.fromEntries(Object.entries(box.env).filter(([k]) => k !== MARKER)),
    fire: (cmd, prompt, environ) => runText('/bin/sh', ['-c', cmd], {
      input: JSON.stringify({ hook_event_name: 'UserPromptSubmit', prompt }), env: environ, cwd, timeout: 60_000,
    }),
  };
  for (const harness of ['claude', 'codex']) checkJsonHook(harness, hooks[harness] || [], rig);
  checkKiroHook(hooks.kiro || [], rig);
}

const PROBLEM = /^(REFUSE|STALE|DRIFT|MISSING|FAIL)\s/;
// The required prerequisites a throwaway workstation cannot have: the agent harness CLIs (a live,
// signed-in harness is outside this canary) and gh. global/prerequisites.json marks them required.
const NOT_HERE = new Set(['claude', 'codex', 'github']);

/** @param {Box} box */
function checkCli(box) {
  let p = box.run('mhw', 'status', '--project=' + path.join(box.d, 'proj'));
  check(p.returncode === 0, 'mhw status exits 0', 'exit ' + p.returncode + '\n' + tail(p.stdout + p.stderr, 3000));
  out('      ' + splitLines(p.stdout).map(pyStrip).filter((l) => l.startsWith('source ') || l.startsWith('evidence ')).join('\n      '));
  p = box.run('mhw', 'check');
  const lines = splitLines(p.stdout);
  let cut = lines.findIndex((l) => l.startsWith('PREREQ '));
  if (cut < 0) cut = lines.length;
  const installed = lines.slice(0, cut);
  const prereq = lines.slice(cut);
  const bad = installed.filter((l) => PROBLEM.test(l));
  check(!bad.length && cut < lines.length, 'mhw check: the installed-state and admin sections report no problem',
    bad.slice(0, 20).join('\n') || 'no PREREQ section found');
  const missing = new Set(prereq.map((l) => /^MISSING (\S+) \[required/.exec(l)).filter((m) => m !== null).map((m) => m[1]));
  if (p.returncode === 0) check(true, 'mhw check exits 0');
  else {
    // Exit 1 is accepted only when it comes from the prerequisites section alone, and only for the
    // CLIs this throwaway workstation cannot hold. The owner's PROD has them; there, the exit is 0.
    check(p.returncode === 1 && !bad.length && missing.size > 0 && [...missing].every((m) => NOT_HERE.has(m)),
      missing.size ? 'mhw check exits 0 but for the required CLIs absent by construction here (' + sorted(missing).join(', ') + ')' : 'mhw check exits 0',
      'exit ' + p.returncode + '; required missing: ' + pyRepr(sorted(missing)) + '\n' + tail(p.stderr, 1000));
  }
}

/** @param {string} p */
function emptyDoc(p) {
  const text = pyStrip(fs.readFileSync(p).toString('utf8'));
  if (text === '') return true;
  let doc;
  try {
    doc = JSON.parse(text);
  } catch {
    return false;
  }
  if (!isDict(doc)) return false;
  const keys = Object.keys(doc);
  return keys.length === 0 || (keys.length === 1 && keys[0] === 'mcpServers' && isDict(doc.mcpServers) && Object.keys(doc.mcpServers).length === 0);
}

/** Python's == over parsed JSON: a dict's key order does not matter. @param {unknown} a @param {unknown} b @returns {boolean} */
function jsonEqual(a, b) {
  if (Array.isArray(a) || Array.isArray(b)) return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => jsonEqual(x, b[i]));
  if (isDict(a) || isDict(b)) {
    if (!isDict(a) || !isDict(b)) return false;
    const ka = Object.keys(a);
    return ka.length === Object.keys(b).length && ka.every((k) => Object.hasOwn(b, k) && jsonEqual(a[k], b[k]));
  }
  return a === b;
}

/**
 * @param {Box} box
 * @param {Map<string, string>} before
 * @param {Record<string, string>} seeded
 * @param {Expected} exp
 */
function checkUninstall(box, before, seeded, exp) {
  let p = box.run('mhw', 'uninstall', '--yes');
  check(p.returncode === 0, 'mhw uninstall --yes exits 0', tail(p.stdout + p.stderr, 2000));
  const after = snapshot(box.home);
  /** @param {string} rel */
  const same = (rel) => {
    const f = path.join(box.home, rel);
    if (!isFile(f)) return false;
    // mhw re-serialises a JSON settings file (its indentation): the document is what must return.
    if (rel.endsWith('.json')) return jsonEqual(readJson(f), JSON.parse(seeded[rel]));
    return after.get(rel) === before.get(rel);
  };
  const changed = Object.keys(seeded).filter((r) => !same(r));
  check(!changed.length, 'uninstall restores every file the owner had (' + Object.keys(seeded).length + '; JSON as a document, the rest byte '
    + 'for byte)', 'changed or missing: ' + pyRepr(changed));
  const leftover = [...after.keys()].filter((r) => !before.has(r) && !r.includes('.pmhwc-') && !emptyDoc(path.join(box.home, r)));
  check(!leftover.length, 'uninstall leaves no file of mhw in HOME (backups and empty documents aside)', 'left: ' + pyRepr(leftover));
  const rootLeft = [...snapshot(box.root).keys()];
  check(!rootLeft.length, 'uninstall removes the admin layer from the throwaway root', 'left: ' + pyRepr(rootLeft.slice(0, 10)));
  const s = readJson(path.join(box.home, CLAUDE_SETTINGS));
  const deny = new Set(strings(get(get(s, 'permissions', {}), 'deny', [])));
  check(![...exp.claude].some((x) => deny.has(x)), 'no floor rule is left in Claude Code settings');
  p = box.run('npm', 'uninstall', '-g', 'mhw');
  check(p.returncode === 0, 'npm uninstall -g mhw exits 0', tail(p.stdout + p.stderr, 1000));
}

/** @param {string | undefined} v */
function legacyList(v) {
  const list = pySplit(v ?? '');
  for (const l of list) if (!/^[A-Za-z0-9._/-]+$/.test(l) || l.split('/').includes('..')) die('refusing --legacy entry ' + pyRepr(l));
  return list;
}

/** @param {Record<string, string | undefined>} a */
function cmdRun(a) {
  const work = resolveLoose(/** @type {string} */ (a.work));
  if (fs.existsSync(work) && fs.readdirSync(work).length) die(work + ' is not empty; give a fresh work directory');
  fs.mkdirSync(work, { recursive: true });
  toolsDir(work);
  const exp = expected(floorEntries(/** @type {string} */ (a.source)));
  const legacy = legacyList(a.legacy);
  const label = a.from_tgz ? 'upgrade' : 'fresh';
  out('==> PROD install canary, ' + label + ' install (evidence level: installed, never enforced)');
  const box = new Box(work, label);
  const seeded = seed(box.home);
  const before = snapshot(box.home);
  if (a.from_tgz && !box.install(resolveLoose(a.from_tgz), 'the latest published tag')) return 1;
  if (!box.install(resolveLoose(/** @type {string} */ (a.tgz)), 'the head')) return 1;
  const stamp = path.join(box.pkg(), '.workstation-archive');
  if (a.commit) {
    const text = isFile(stamp) ? fs.readFileSync(stamp, 'utf8') : '';
    check(text.includes('commit: ' + a.commit), 'the installed package is the head ' + head(a.commit, 12), pyStrip(text));
  }
  checkPackage(box, legacy);
  checkHook(box, checkFloor(box, exp));
  checkCli(box);
  checkUninstall(box, before, seeded, exp);
  out('==> ' + label + ': ' + failures.length + ' failure(s)' + (failures.length ? ': ' + failures.join('; ') : ''));
  return failures.length ? 1 : 0;
}

// --- container -------------------------------------------------------------------------------------------

/**
 * The script the container's own sh runs: jq from the image's archive, the versions, then `run` as the
 * unprivileged node user. Its positional parameters are the commit, the mode, the --from-tgz words and
 * the --legacy list, each validated before they get here.
 */
const CONTAINER_SH = String.raw`
    export DEBIAN_FRONTEND=noninteractive
    apt-get update -qq >/dev/null
    apt-get install -y -qq --no-install-recommends jq >/dev/null
    echo "image: $(. /etc/os-release && echo "$PRETTY_NAME"); node $(node --version); npm $(npm --version); $(git --version); jq $(jq --version)"
    exec su node -s /bin/sh -c "node /pkg/src-HEAD/.github/scripts/prod-canary.js run --source /pkg/src-HEAD \
      --tgz /pkg/mhw-HEAD.tgz $3 --work /tmp/prod-canary-$2 --commit $1 --legacy '$4'"
  `;

/** @param {string[]} argv IMAGE PKG_DIR COMMIT MODE [--legacy LIST] */
function cmdContainer(argv) {
  const args = [...argv];
  let legacy = '';
  const li = args.findIndex((x) => x === '--legacy' || x.startsWith('--legacy='));
  if (li >= 0) {
    legacy = args[li].startsWith('--legacy=') ? args[li].slice('--legacy='.length) : args[li + 1] ?? '';
    args.splice(li, args[li].startsWith('--legacy=') ? 1 : 2);
  }
  if (args.length !== 4) {
    process.stderr.write('usage: prod-canary.js container IMAGE PKG_DIR COMMIT fresh|upgrade [--legacy LIST]\n');
    return 2;
  }
  const [image, pkgArg, commit, mode] = args;
  // The first character is a letter or digit, so the image can never be read as a runtime option.
  if (!/^[a-z0-9][^@\s]*@sha256:[0-9a-f]{64}$/.test(image)) {
    process.stderr.write('BLOCK  the image is not pinned by digest: ' + image + '\n');
    return 2;
  }
  if (!/^[0-9a-f]{40}$/.test(commit)) {
    process.stderr.write('the commit must be a full lower-case SHA: ' + pyRepr(commit) + '\n');
    return 2;
  }
  /** @type {Record<string, string>} */
  const froms = { fresh: '', upgrade: '--from-tgz /pkg/mhw-from.tgz' };
  if (!Object.hasOwn(froms, mode)) {
    process.stderr.write('mode must be fresh or upgrade\n');
    return 2;
  }
  const list = legacyList(legacy).join(' ');
  const pkg = fs.realpathSync.native(pkgArg);
  // `-v SRC:DST:ro` splits on ':', so a ':' in the package directory would change the mount.
  if (pkg.includes(':')) {
    process.stderr.write('the package directory must not contain a colon: ' + pyRepr(pkg) + '\n');
    return 2;
  }
  const runtime = program(process.env.CONTAINER_RUNTIME || 'docker', process.env);
  const p = spawnSync(runtime, ['run', '--rm', '--network=bridge', '-v', pkg + ':/pkg:ro', image, 'sh', '-euc', CONTAINER_SH,
    'canary', commit, mode, froms[mode], list], { stdio: 'inherit' });
  if (p.error) throw p.error;
  return p.status ?? 1;
}

// --- the command line ------------------------------------------------------------------------------------

const PROG = 'prod-canary.js';
/** @type {Record<string, { options: string[], required: string[], usage: string }>} */
const SPECS = {
  pack: { options: ['ref', 'out', 'name'], required: ['ref', 'out'], usage: 'usage: ' + PROG + ' pack [-h] --ref REF --out OUT [--name NAME]' },
  run: {
    options: ['source', 'tgz', 'from-tgz', 'work', 'commit', 'legacy'], required: ['source', 'tgz', 'work'],
    usage: 'usage: ' + PROG + ' run [-h] --source SOURCE --tgz TGZ [--from-tgz FROM_TGZ]\n'
      + '                          --work WORK [--commit COMMIT] [--legacy LEGACY]',
  },
};
const TOP = 'usage: ' + PROG + ' [-h] {pack,run,container} ...';

/** argparse's usage error: the usage, then "PROG: error: MESSAGE", exit 2. @param {string} usage @param {string} prog @param {string} message */
function usageError(usage, prog, message) {
  process.stderr.write(usage + '\n' + prog + ': error: ' + message + '\n');
  return 2;
}

/**
 * `--opt value` and `--opt=value`, each option once at most; the required ones named in order.
 * @param {string} cmd
 * @param {string[]} argv
 * @returns {Record<string, string | undefined> | string}
 */
function parseOptions(cmd, argv) {
  const spec = SPECS[cmd];
  /** @type {Record<string, string | undefined>} */
  const values = {};
  const unknown = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const eq = a.indexOf('=');
    const end = eq > 0 ? eq : a.length;
    const key = a.startsWith('--') ? a.slice(2, end) : null;
    if (key === null || !spec.options.includes(key)) {
      unknown.push(a);
      continue;
    }
    let v;
    if (eq > 0) v = a.slice(eq + 1);
    else if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) v = argv[++i];
    else return 'argument --' + key + ': expected one argument';
    values[key.replaceAll('-', '_')] = v;
  }
  const missing = spec.required.filter((r) => values[r] === undefined).map((r) => '--' + r);
  if (missing.length) return 'the following arguments are required: ' + missing.join(', ');
  if (unknown.length) return 'unrecognized arguments: ' + unknown.join(' ');
  return values;
}

/** @param {string[]} argv @returns {number} */
export function main(argv) {
  failures.length = 0;
  try {
    const [cmd, ...rest] = argv;
    if (cmd === 'container') return cmdContainer(rest);
    if (!argv.length) return usageError(TOP, PROG, 'the following arguments are required: cmd');
    if (!Object.hasOwn(SPECS, cmd)) {
      return usageError(TOP, PROG, 'argument cmd: invalid choice: ' + pyRepr(cmd) + " (choose from 'pack', 'run', 'container')");
    }
    const parsed = parseOptions(cmd, rest);
    if (typeof parsed === 'string') return usageError(SPECS[cmd].usage, PROG + ' ' + cmd, parsed);
    if (cmd === 'pack') {
      cmdPack(parsed);
      return 0;
    }
    return cmdRun(parsed);
  } catch (e) {
    if (e instanceof Exit) return e.code;
    // An input nothing here expects (an unreadable carrier, a file that is not JSON): one line, exit 1.
    process.stderr.write('prod-canary: ' + (e instanceof Error ? e.message : String(e)) + '\n');
    return 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === SCRIPT) {
  process.exitCode = main(process.argv.slice(2));
}
