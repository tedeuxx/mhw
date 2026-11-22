// `mhw install-admin` (#496, S26 of #470): the admin-layer installer, moved from global/install-managed.sh.
// It installs the hook layers in each harness's native admin layer (ADR-0025), so no process running as the
// owner can switch them off. Only an administrator can change or remove them, with sudo, as with any
// OS-managed policy; there is no per-request or expiring waiver (ADR-0028, which removed the restart guard
// and the ADR-0024 breaking-glass switches; --apply and --remove delete what they left behind). The HITL
// picker guard is removed too (ADR-0013, 2026-10-05 amendment, Issue #60): --apply and --remove delete its
// script and limits, and --check reports them as STALE. The same admin documents carry the deny floor
// (ADR-0016, 2026-10-05 amendment): the Claude Code drop-in's permissions.deny and the Codex requirements'
// [rules] prefix_rules, both rendered from the rules `mhw install-user` renders, so the floor has one source.
//
// `mhw install` runs this command (src/lib/lifecycle.js); `mhw install --admin` is the owner's entry. It
// runs on node: src/cli.js starts this file as a child of the node running mhw, by absolute path, because it
// loads the vendored TOML parser, which stays off the import graph of `mhw hook prompt` (convention 5).
//
// The admin hook names node by absolute path: the node `mhw install-user` rendered into the user layer, the
// node running mhw. On Homebrew or nvm that node, and the libraries it loads, are owner-writable code, so a
// process running as the owner can change what the root-owned hook does. The owner accepted that gap until
// S32 (#536, #502: «Aceitar agora, travar no fim»): this command names the node's ownership on its NODE line,
// and `mhw status` flags an owner-writable one (src/lib/readers/hooks.js).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { MARKER_ID, NAME, isManaged, unstamp } from '../lib/marker.js';
import { runAbsolute } from '../lib/run.js';
import { parse as jqParse, stringify as jqStringify, quote as jqQuote, equal as jqEqual, get as jqGet, JqNumber } from '../lib/jq-json.js';
import { parseToml } from '../lib/toml.js';
import { dumps } from '../lib/py.js';
import { nodeOwnership } from '../lib/readers/hooks.js';
import { adminDoc, adminValidate, wantFromYaml } from '../render/kiro-permissions.js';
import { nodeLookup, pasteWrap } from './install-user.js';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const MHW_JS = path.join(ROOT, 'bin', 'mhw.js');
const DROPIN = '50-' + NAME + '.json';
/** What the admin documents name as their source: kept as install-managed.sh wrote it, so an installed layer reads OK, not DRIFT. */
const SOURCE = 'global/install-managed.sh';
// The prompt hook in Node (#488, S17 of #470): a root-owned copy of the hook's own JavaScript, so no process
// running as the owner can change THOSE files. It does NOT make the admin layer's hook root-owned end to end:
// it runs the node `mhw install-user` found (see the header).
export const HOOK_FILES = ['hook/package.json', 'hook/src/commands/hook-entry.js', 'hook/src/commands/hook-prompt.js', 'hook/src/lib/clean.js', 'hook/src/lib/clean-unicode.js'];
export const FILES = ['clipboard.conf', ...HOOK_FILES];
// Removed by ADR-0028 (restart guard, switches) and by ADR-0013's 2026-10-05 amendment (HITL picker guard),
// and the Python hook core (#488); an earlier --apply installed them. Deleted by --apply and --remove,
// reported by --check.
export const LEGACY = ['restart_guard.py', 'breaking_glass.py', 'hitl-escalation-guard.sh', 'hitl.conf', 'clipboard_guard.py'];
const STAGE_EXTRA = ['../claude.json', '../requirements.toml', '../kiro.json'];
const PASTE_ENV = '/usr/bin/env -u NODE_OPTIONS -u NODE_ICU_DATA -u NODE_PATH -u NODE_COMPILE_CACHE';
const QUOTED = /["\\$`']/;

export const USAGE = `Install the hook layers and the deny floor in each harness's native admin layer (ADR-0025, ADR-0016).

  mhw install-admin                       render and validate into a fresh stage, print the ONE sudo line for
                                          the owner; writes nothing outside the stage
  mhw install-admin --check               exit 0 when the installed admin layer matches a fresh render (stamp too)
  mhw install-admin --uninstall           print the sudo line that removes what --apply installed
  mhw install-admin --apply=STAGE --sha256=HEX   (root) copy the stage, verify its hash, install it
  mhw install-admin --remove              (root) remove every file --apply installed
  --overlay=DIR|none                      passed to mhw install-user, which renders the hook files
  --root=DIR                              prefix every system path; for tests only, allows non-root

Targets (macOS; Linux uses /etc/${NAME} and /etc/claude-code):
  /Library/Application Support/${NAME}/bin/   the hook's files
  /Library/Application Support/ClaudeCode/managed-settings.d/${DROPIN}
  /etc/codex/requirements.toml             refused when it exists and is not ours
  /Library/Application Support/Kiro/managed-settings.json   (Linux /etc/kiro/managed-settings.json) the deny
                                           floor for Kiro IDE and the Kiro CLI V3 engine (ADR-0036); refused
                                           when it exists and is not ours
Kiro has no admin layer for hooks; Windows is not supported (ADR-0025).
Exit codes: 0 ok · 1 drift, stamp or missing (--check) · 2 usage or missing dependency · 3 something
unmanaged in the way, or a stage that fails validation or its hash.
`;

/** @typedef {Record<string, string | undefined>} Env */
/** @typedef {{ out: (s: string) => void, err: (s: string) => void }} Io */

/** set -e, or an `exit N`: unwinds to main. */
class Exit extends Error {
  /** @param {number} code */
  constructor(code) {
    super('exit ' + code);
    this.code = code;
  }
}

export const STDIO = /** @type {Io} */ ({ out: (s) => fs.writeSync(1, s), err: (s) => fs.writeSync(2, s) });

/** @param {string} p */
function lexists(p) {
  try {
    fs.lstatSync(p);
    return true;
  } catch {
    return false;
  }
}

/** `[ -e p ]`: exists, a symlink followed. @param {string} p */
function exists(p) {
  try {
    fs.statSync(p);
    return true;
  } catch {
    return false;
  }
}

/** `[ -f p ]`. @param {string} p */
function isFile(p) {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

/** The bytes of a file as a byte-per-character string, or null. @param {string} p */
function readBin(p) {
  try {
    return fs.readFileSync(p).toString('latin1');
  } catch {
    return null;
  }
}

/**
 * The paths of the admin layer under root (empty on a real run).
 * @param {string} root
 */
export function targets(root) {
  const darwin = os.type() === 'Darwin';
  const base = root + (darwin ? '/Library/Application Support/' : '/etc/') + NAME;
  const claudeDir = root + (darwin ? '/Library/Application Support/ClaudeCode' : '/etc/claude-code') + '/managed-settings.d';
  return {
    base,
    bin: base + '/bin',
    switches: base + '/breaking-glass',
    claudeDir,
    claude: claudeDir + '/' + DROPIN,
    codex: root + '/etc/codex/requirements.toml',
    kiro: root + (darwin ? '/Library/Application Support/Kiro/managed-settings.json' : '/etc/kiro/managed-settings.json'),
  };
}

/** The last `; release: …; commit: …` followed by ';' (sed's greedy `.*; \(…\);`), or ''. @param {string} line @param {boolean} quotes */
function stampIn(line, quotes) {
  const re = quotes ? /; (release: [^;"]*; commit: [^;"]*)(?=;)/g : /; (release: [^;]*; commit: [^;]*)(?=;)/g;
  let last = '';
  for (const m of line.matchAll(re)) last = m[1];
  return last;
}

/** The first marker line of a file (grep -m 1 -F), or ''. @param {string} p */
function markerLineOf(p) {
  const text = readBin(p);
  if (text === null) return '';
  return text.split('\n').find((l) => l.includes(MARKER_ID)) ?? '';
}

/** stamp_of: the stamp a file's marker line carries, or 'none'. @param {string} p */
export function stampOf(p) {
  return stampIn(markerLineOf(p), true) || 'none';
}

/**
 * The digest of everything --apply installs, in a fixed order: each name, its length and its bytes.
 * @param {string} dir a stage, or --apply's copy of one
 */
export function stageHash(dir) {
  const h = crypto.createHash('sha256');
  for (const n of [...FILES, ...STAGE_EXTRA]) {
    const data = fs.readFileSync(path.normalize(path.join(dir, 'bin', n)));
    h.update(Buffer.concat([Buffer.from(n + '\0' + data.length + '\0', 'latin1'), data]));
  }
  return h.digest('hex');
}

/** Are these Claude Code admin settings a document of ours? Throws when not. @param {string} file */
function validateClaude(file) {
  const d = JSON.parse(fs.readFileSync(file, 'utf8'));
  const keys = d && typeof d === 'object' && !Array.isArray(d) ? Object.keys(d) : null;
  if (!keys || keys.length !== 3 || !['hooks', 'permissions', NAME].every((k) => keys.includes(k))) throw new Error('keys');
  const sv = d[NAME];
  if (typeof sv !== 'string' || !sv.includes('; release: ') || !sv.includes('; commit: ')) throw new Error('stamp');
  const perm = d.permissions;
  if (!perm || typeof perm !== 'object' || Array.isArray(perm) || Object.keys(perm).length !== 1 || !Object.hasOwn(perm, 'deny')) throw new Error('permissions');
  const deny = perm.deny;
  if (!Array.isArray(deny) || !deny.length || !deny.every((r) => typeof r === 'string' && r)) throw new Error('deny');
  return deny;
}

/**
 * validate(): both admin documents must parse, or the harness may refuse to start; the Codex rules are one
 * per Claude Code PREFIX rule (a glob entry is Claude Code only, ADR-0035); and the Kiro document is one Kiro
 * accepts. A file Kiro rejects is NOT "no rule": Kiro IDE and the Kiro CLI V3 engine then deny EVERY tool
 * call (read from both bundles, PR #153 lens), and so can a statement of 64 or more conditions.
 * @param {string} dir
 */
export function validate(dir) {
  try {
    const deny = validateClaude(path.join(dir, 'claude.json'));
    const t = parseToml(fs.readFileSync(path.join(dir, 'requirements.toml'), 'utf8'));
    const rules = t.rules?.prefix_rules;
    if (!Array.isArray(rules) || !rules.length) return false;
    if (!rules.every((r) => r && r.decision === 'forbidden' && Array.isArray(r.pattern) && r.pattern.length)) return false;
    if (rules.length !== deny.filter((r) => r.startsWith('Bash(') && r.endsWith(':*)')).length) return false;
    adminValidate(path.join(dir, 'kiro.json'));
    return true;
  } catch {
    return false;
  }
}

/** codex_foreign: the requirements file exists and carries no marker in its first five lines. @param {string} p */
function codexForeign(p) {
  if (!exists(p)) return false;
  const text = readBin(p);
  return text === null || !isManaged(text);
}

/** kiro_foreign: something is there, and it is not a JSON object whose key of ours carries the marker. @param {string} p */
function kiroForeign(p) {
  if (!lexists(p)) return false;
  try {
    const v = jqGet(jqParse(fs.readFileSync(p, 'utf8')), NAME);
    return !(typeof v === 'string' && v.includes(MARKER_ID));
  } catch {
    return true;
  }
}

/**
 * @typedef {{ env: Env, io: Io, root: string, overlay: string, t: ReturnType<typeof targets>, node: string,
 *   nodeLine: string }} Ctx
 */

/** @param {Ctx} ctx @param {string} s */
const say = (ctx, s) => ctx.io.out(s + '\n');
/** @param {Ctx} ctx @param {string} s */
const warn = (ctx, s) => ctx.io.err(s + '\n');

/**
 * The node `mhw install-user` rendered into the user hook (the first quoted word after /usr/bin/env), so
 * both layers run the same node; '' when there is none.
 * @param {string} settingsFile
 */
export function renderedNode(settingsFile) {
  let doc;
  try {
    doc = jqParse(fs.readFileSync(settingsFile, 'utf8'));
  } catch {
    return '';
  }
  const groups = jqGet(jqGet(doc, 'hooks'), 'UserPromptSubmit');
  if (!Array.isArray(groups)) return '';
  for (const g of groups) {
    const hooks = jqGet(g, 'hooks');
    if (!Array.isArray(hooks)) continue;
    for (const h of hooks) {
      const c = jqGet(h, 'command');
      if (typeof c !== 'string' || !c.includes('hook prompt --harness')) continue;
      const prefix = PASTE_ENV + ' "';
      if (!c.startsWith('/bin/sh -c ') || c.slice(12, 12 + prefix.length) !== prefix) return '';
      const rest = c.slice(12 + prefix.length);
      const end = rest.indexOf('"');
      return end < 0 ? '' : rest.slice(0, end);
    }
  }
  return '';
}

/** The deny floor as install-user rendered it, its own allow-list Edit protections taken out. @param {string} settingsFile */
function floorOf(settingsFile) {
  const doc = jqParse(fs.readFileSync(settingsFile, 'utf8'));
  const deny = jqGet(jqGet(doc, 'permissions'), 'deny');
  const owned = jqGet(jqGet(doc, NAME + '-owned-allow'), 'deny');
  if (!Array.isArray(deny)) throw new Error('no permissions.deny');
  const drop = Array.isArray(owned) ? owned : [];
  return deny.filter((r) => !drop.some((o) => jqEqual(o, r)));
}

/** A Codex prefix rule for one `Bash(words:*)` floor entry. @param {string} rule */
function prefixRule(rule) {
  const words = [...rule].slice(5, -3).join('').split(' ');
  return '  { pattern = [' + words.map((w) => '{ token = ' + jqQuote(w) + ' }').join(', ')
    + '], decision = "forbidden", justification = "workstation deny floor (ADR-0016)" },';
}

/**
 * render(): the hook files, the three admin documents and their validation, into an empty stage.
 * @param {Ctx} ctx @param {string} st
 */
export function render(ctx, st) {
  const { t } = ctx;
  fs.mkdirSync(path.join(st, 'home'), { recursive: true });
  fs.mkdirSync(path.join(st, 'bin'), { recursive: true });
  // The user-layer installer renders every hook file (overlay included) into a throwaway home; reuse, never
  // duplicate. It runs on the node found, by absolute path.
  /** @type {Env} */
  const childEnv = { ...ctx.env, HOME: path.join(st, 'home') };
  delete childEnv.CODEX_HOME;
  delete childEnv.XDG_DATA_HOME;
  const r = runAbsolute(ctx.node, [MHW_JS, 'install-user', ...(ctx.overlay ? [ctx.overlay] : [])], { env: childEnv });
  fs.writeFileSync(path.join(st, 'install.log'), r.stdout + r.stderr);
  if (r.code !== 0 || r.error) {
    warn(ctx, 'REFUSE  mhw install-user could not render the hook files (see ' + st + '/install.log)');
    throw new Exit(2);
  }
  const conf = path.join(st, 'home', '.local', 'share', NAME, 'clipboard.conf');
  try {
    fs.copyFileSync(conf, path.join(st, 'bin', 'clipboard.conf'));
  } catch (e) {
    warn(ctx, 'cp: ' + conf + ': ' + (e instanceof Error ? e.message : String(e)));
    throw new Exit(1);
  }
  // The provenance stamp (Issue #66, ADR-0029) exactly as install-user derived it for the same checkout, read
  // back from a file it rendered, so the admin documents and the scripts cannot name two sources.
  const stamp = stampIn(markerLineOf(path.join(st, 'bin', 'clipboard.conf')), false);
  if (!stamp) {
    warn(ctx, 'REFUSE  mhw install-user rendered no provenance stamp');
    throw new Exit(2);
  }
  // The hook's files, each stamped: a comment line on a .js file, a key of ours in package.json.
  for (const f of HOOK_FILES) {
    const dest = path.join(st, 'bin', f);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    if (f === 'hook/package.json') {
      fs.writeFileSync(dest, '{"type": "module", "' + NAME + '": "' + MARKER_ID + '; source: ' + SOURCE + '; ' + stamp + '; do not edit, re-run the installer"}\n');
    } else {
      const rel = f.slice('hook/'.length);
      fs.writeFileSync(dest, Buffer.concat([Buffer.from('// ' + MARKER_ID + '; source: ' + rel + '; ' + stamp + '; do not edit, re-run the installer\n'),
        fs.readFileSync(path.join(ROOT, rel))]));
    }
  }
  const settings = path.join(st, 'home', '.claude', 'settings.json');
  const hookNode = renderedNode(settings);
  if (!hookNode.startsWith('/')) {
    warn(ctx, 'REFUSE  mhw install-user rendered no prompt hook (node not found?); nothing staged');
    throw new Exit(2);
  }
  if (QUOTED.test(hookNode)) {
    warn(ctx, 'REFUSE  the node path holds a quote, backslash, dollar sign or backtick');
    throw new Exit(2);
  }
  ctx.nodeLine = 'NODE    the admin hook runs ' + nodeOwnership(hookNode) + '; the owner accepted an owner-writable node until S32 (#536)';
  const nodecmd = PASTE_ENV + ' "' + hookNode + '" "' + t.bin + '/hook/src/commands/hook-entry.js"';
  const pasteClaude = pasteWrap('claude', nodecmd + ' --harness claude --config "' + t.bin + '/clipboard.conf"');
  const pasteCodex = pasteWrap('codex', nodecmd + ' --harness codex --config "' + t.bin + '/clipboard.conf"');
  // The deny floor exactly as install-user rendered it (global entries, then the overlay's), so the admin copy
  // cannot drift from the user copy: the throwaway home started empty, so its deny list is the floor plus the
  // allow list's own Edit protections (ADR-0031), which are user-level and named by their owner key.
  let floor;
  try {
    floor = floorOf(settings);
  } catch {
    warn(ctx, 'jq: error: the rendered settings.json carries no deny floor');
    throw new Exit(5);
  }
  fs.writeFileSync(path.join(st, 'floor.json'), JSON.stringify(floor) + '\n');
  // JSON has no comment: one top-level key of ours carries the stamp. Claude Code ignores a key it does not
  // know (measured on 2.1.289 through --settings; see ADR-0029).
  const hook = new Map(/** @type {Array<[string, any]>} */ ([['type', 'command'], ['command', pasteClaude], ['timeout', new JqNumber('30')]]));
  const doc = new Map(/** @type {Array<[string, any]>} */ ([
    [NAME, MARKER_ID + '; source: ' + SOURCE + '; ' + stamp + '; do not edit, re-run the installer'],
    ['hooks', new Map([['UserPromptSubmit', [new Map([['hooks', [hook]]])]]])],
    ['permissions', new Map([['deny', floor]])],
  ]));
  fs.writeFileSync(path.join(st, 'claude.json'), jqStringify(/** @type {any} */ (doc)) + '\n');
  const lines = [
    '# ' + MARKER_ID + '; source: ' + SOURCE + '; ' + stamp + '; do not edit, re-run the installer',
    '# ADR-0025. No allow_managed_hooks_only and no [features] pin: user and plugin hooks keep running.',
    '[hooks]', 'managed_dir = ' + jqQuote(t.bin),
    // One hook since ADR-0028 removed the restart guard: the paste filter.
    '', '[[hooks.UserPromptSubmit]]', '', '[[hooks.UserPromptSubmit.hooks]]', 'type = "command"', 'command = ' + jqQuote(pasteCodex), 'timeout = 30',
    // The deny floor's command entries as admin prefix rules (ADR-0016, 2026-10-05 amendment). They merge
    // with every .rules file and the most restrictive decision wins, so "codex exec --ignore-rules" cannot
    // skip them. A file or glob entry has no Codex form (ADR-0016).
    '', '# The workstation deny floor (ADR-0016). One rule per line; a prefix matches the command words',
    '# from the program name on, so another spelling, a wrapper or a script is not matched.',
    '[rules]', 'prefix_rules = [',
    ...floor.filter((r) => typeof r === 'string' && r.startsWith('Bash(') && r.endsWith(':*)')).map((r) => prefixRule(/** @type {string} */ (r))),
    ']',
  ];
  fs.writeFileSync(path.join(st, 'requirements.toml'), lines.join('\n') + '\n');
  // The deny floor for Kiro (ADR-0036, 2026-10-11 amendment), from the permissions.yaml install-user rendered
  // into the same throwaway home, so the Kiro admin copy has the same single source as the user copy.
  try {
    const kiro = adminDoc(wantFromYaml(path.join(st, 'home', '.kiro', 'settings', 'permissions.yaml')), stamp);
    fs.writeFileSync(path.join(st, 'kiro.json'), dumps(kiro, { indent: 2, sortKeys: false, ensureAscii: true }) + '\n');
  } catch (e) {
    fs.writeFileSync(path.join(st, 'kiro.log'), 'REFUSE  Kiro admin document: ' + (e instanceof Error ? e.message : String(e)) + '\n');
    warn(ctx, 'REFUSE  the Kiro admin document could not be rendered (see ' + st + '/kiro.log)');
    throw new Exit(2);
  }
  if (!validate(st)) {
    warn(ctx, 'REFUSE  the rendered admin documents do not validate');
    throw new Exit(3);
  }
}

/** A fresh stage directory under TMPDIR (mktemp -d). @param {Env} env @param {string} name */
function mktemp(env, name) {
  return fs.mkdtempSync(path.join(env.TMPDIR || '/tmp', name + '.'));
}

/** The sudo line's program: this node and this package's entry, quoted. */
const sudoProgram = () => 'sudo "' + process.execPath + '" "' + MHW_JS + '" install-admin';
/** The --root suffix of a printed line. @param {Ctx} ctx */
const rootArg = (ctx) => (ctx.root ? ' --root="' + ctx.root + '"' : '');

/** @param {Ctx} ctx */
function renderMode(ctx) {
  // The sudo line names this node, quoted: a path that would break that quoting is refused, as the hook node is.
  if (QUOTED.test(process.execPath) || QUOTED.test(MHW_JS)) {
    warn(ctx, 'REFUSE  the node or package path holds a quote, backslash, dollar sign or backtick');
    return 2;
  }
  const st = mktemp(ctx.env, 'pmhwc-managed');
  render(ctx, st);
  if (codexForeign(ctx.t.codex)) {
    warn(ctx, 'REFUSE  ' + ctx.t.codex + ' exists and is NOT managed by this project; nothing to apply');
    return 3;
  }
  if (kiroForeign(ctx.t.kiro)) {
    warn(ctx, 'REFUSE  ' + ctx.t.kiro + ' exists and is NOT managed by this project (an organisation\'s Kiro policy?); nothing to apply');
    return 3;
  }
  say(ctx, 'STAGED  ' + st + ' (validated; nothing installed)');
  say(ctx, ctx.nodeLine);
  say(ctx, 'RUN     ' + sudoProgram() + ' --apply="' + st + '" --sha256=' + stageHash(st) + rootArg(ctx));
  say(ctx, 'THEN    ' + (ctx.env.MHW_CMD || './mhw') + ' install   (detects the admin layer and removes the user-level duplicates), then open fresh sessions');
  return 0;
}

/** @param {Ctx} ctx */
function uninstallMode(ctx) {
  if (QUOTED.test(process.execPath) || QUOTED.test(MHW_JS)) {
    warn(ctx, 'REFUSE  the node or package path holds a quote, backslash, dollar sign or backtick');
    return 2;
  }
  say(ctx, 'RUN     ' + sudoProgram() + ' --remove' + rootArg(ctx));
  say(ctx, 'THEN    ' + (ctx.env.MHW_CMD || './mhw') + ' install   (restores the user-level hooks), then open fresh sessions');
  return 0;
}

/** @param {Ctx} ctx */
function checkMode(ctx) {
  const { t } = ctx;
  const st = mktemp(ctx.env, 'pmhwc-managed');
  try {
    render(ctx, st);
    let status = 0;
    // The managed-by line carries the provenance stamp (Issue #66, ADR-0029; "version" in files an earlier
    // release installed). Content is compared without it; a stamp other than the source's on matching content
    // is STAMP, not DRIFT. Both fail the check, and --apply rewrites both.
    say(ctx, 'SOURCE  ' + stampOf(path.join(st, 'bin', 'clipboard.conf')));
    /** @param {string} rendered @param {string} installed */
    const compare = (rendered, installed) => {
      if (!isFile(installed)) {
        say(ctx, 'MISSING ' + installed);
        status = 1;
        return;
      }
      const a = readBin(rendered);
      const b = readBin(installed);
      if (a !== null && a === b) say(ctx, 'OK      ' + installed + ' (' + stampOf(installed) + ')');
      else {
        if (a !== null && b !== null && unstamp(a) === unstamp(b)) {
          say(ctx, 'STAMP   ' + installed + ': content matches, but it carries (' + stampOf(installed) + ') and the source is (' + stampOf(rendered) + ')');
        } else say(ctx, 'DRIFT   ' + installed + ' (' + stampOf(installed) + ')');
        status = 1;
      }
    };
    for (const f of FILES) compare(path.join(st, 'bin', f), t.bin + '/' + f);
    for (const f of LEGACY) {
      if (exists(t.bin + '/' + f)) {
        say(ctx, 'STALE   ' + t.bin + '/' + f + ': a removed hook\'s file (ADR-0028, ADR-0013); --apply deletes it');
        status = 1;
      }
    }
    if (exists(t.switches)) {
      say(ctx, 'STALE   ' + t.switches + ': removed by ADR-0028; --apply deletes it');
      status = 1;
    }
    compare(path.join(st, 'claude.json'), t.claude);
    compare(path.join(st, 'requirements.toml'), t.codex);
    if (kiroForeign(t.kiro)) {
      say(ctx, 'REFUSE  ' + t.kiro + ': NOT managed by this project; --apply refuses it');
      status = 1;
    } else {
      compare(path.join(st, 'kiro.json'), t.kiro);
      if (isFile(t.kiro) && !kiroValid(t.kiro)) {
        say(ctx, 'REFUSE  ' + t.kiro + ': Kiro would reject it, and then Kiro IDE and the Kiro CLI V3 engine deny EVERY tool call; --apply rewrites it, --remove deletes it (Kiro CLI 2.x is unaffected)');
        status = 1;
      }
    }
    return status;
  } finally {
    fs.rmSync(st, { recursive: true, force: true });
  }
}

/** @param {string} p */
function kiroValid(p) {
  try {
    adminValidate(p);
    return true;
  } catch {
    return false;
  }
}

/** Running as root, or under the tests' --root. @param {Ctx} ctx */
const isRootRun = (ctx) => (typeof process.getuid === 'function' && process.getuid() === 0) || ctx.root !== '';

/** rm -f: a missing file is fine; a directory stops the run, as set -e did. @param {Ctx} ctx @param {string} p */
function rmF(ctx, p) {
  try {
    fs.unlinkSync(p);
  } catch (e) {
    const code = /** @type {NodeJS.ErrnoException} */ (e).code;
    if (code === 'ENOENT') return;
    warn(ctx, 'rm: ' + p + ': ' + (code === 'EISDIR' || code === 'EPERM' ? 'is a directory' : String(code)));
    throw new Exit(1);
  }
}

/** rmdir, its failure ignored (2>/dev/null || true). @param {string} p */
function rmdirQuiet(p) {
  try {
    fs.rmdirSync(p);
  } catch {
    // not empty, or not there
  }
}

/** rm -f DIR/*.json. @param {Ctx} ctx @param {string} dir */
function rmJson(ctx, dir) {
  let names = [];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return;
  }
  for (const n of names.filter((x) => x.endsWith('.json') && !x.startsWith('.'))) rmF(ctx, path.join(dir, n));
}

/** cp, its failure stopping the run as set -e did. @param {Ctx} ctx @param {string} from @param {string} to */
function cp(ctx, from, to) {
  try {
    fs.copyFileSync(from, to);
  } catch (e) {
    warn(ctx, 'cp: ' + from + ': ' + (e instanceof Error ? e.message : String(e)));
    throw new Exit(1);
  }
}

/** @param {Ctx} ctx @param {string} stage @param {string} sha */
function applyMode(ctx, stage, sha) {
  const { t } = ctx;
  if (!isRootRun(ctx)) {
    warn(ctx, 'REFUSE  --apply needs administrator privilege (sudo)');
    return 2;
  }
  if (!stage || !sha) {
    warn(ctx, 'REFUSE  --apply needs --sha256');
    return 2;
  }
  // Copy first, then verify the copy: the stage is writable by the owner's account, the copy is not.
  const work = mktemp(ctx.env, 'pmhwc-apply');
  try {
    fs.mkdirSync(path.join(work, 'bin'));
    for (const f of FILES) {
      fs.mkdirSync(path.dirname(path.join(work, 'bin', f)), { recursive: true });
      cp(ctx, path.join(stage, 'bin', f), path.join(work, 'bin', f));
    }
    for (const f of ['claude.json', 'requirements.toml', 'kiro.json']) cp(ctx, path.join(stage, f), path.join(work, f));
    if (stageHash(work) !== sha) {
      warn(ctx, 'REFUSE  the stage does not match its hash; nothing installed');
      return 3;
    }
    if (!validate(work)) {
      warn(ctx, 'REFUSE  the stage does not validate; nothing installed');
      return 3;
    }
    if (codexForeign(t.codex)) {
      warn(ctx, 'REFUSE  ' + t.codex + ' exists and is NOT managed by this project');
      return 3;
    }
    if (kiroForeign(t.kiro)) {
      warn(ctx, 'REFUSE  ' + t.kiro + ' exists and is NOT managed by this project');
      return 3;
    }
    const old = process.umask(0o022); // NOSONAR javascript:S2612 - the admin layer is root-owned and must be readable by every harness the owner runs; only root writes it (ADR-0025)
    try {
      install(ctx, work);
    } finally {
      process.umask(old);
    }
    say(ctx, 'INSTALLED ' + t.bin + ', ' + t.claude + ', ' + t.codex + ', ' + t.kiro);
    say(ctx, 'THEN    as yourself: mhw install (./mhw install in a checkout); then open fresh Claude Code, Codex and Kiro sessions');
    return 0;
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

/** The install proper: root-owned on a real run, every file replaced atomically. @param {Ctx} ctx @param {string} work */
function install(ctx, work) {
  const { t } = ctx;
  const own = (/** @type {string} */ p) => {
    if (!ctx.root) fs.chownSync(p, 0, 0);
  };
  for (const d of [t.bin, t.claudeDir, path.dirname(t.codex), path.dirname(t.kiro)]) fs.mkdirSync(d, { recursive: true });
  fs.chmodSync(t.base, 0o755); // NOSONAR javascript:S2612 - the admin layer is root-owned and must be readable by every harness the owner runs; only root writes it (ADR-0025)
  fs.chmodSync(t.bin, 0o755); // NOSONAR javascript:S2612 - the admin layer is root-owned and must be readable by every harness the owner runs; only root writes it (ADR-0025)
  /** put(): atomic replace, root-owned on a real run. @param {string} from @param {string} to @param {number} mode */
  const put = (from, to, mode) => {
    const tmp = to + '.new.' + process.pid;
    cp(ctx, from, tmp);
    fs.chmodSync(tmp, mode);
    own(tmp);
    fs.renameSync(tmp, to);
  };
  own(t.base);
  own(t.bin);
  for (const f of FILES) {
    const d = path.dirname(t.bin + '/' + f);
    fs.mkdirSync(d, { recursive: true });
    fs.chmodSync(d, 0o755); // NOSONAR javascript:S2612 - the admin layer is root-owned and must be readable by every harness the owner runs; only root writes it (ADR-0025)
    own(d);
    put(path.join(work, 'bin', f), t.bin + '/' + f, 0o644);
  }
  put(path.join(work, 'claude.json'), t.claude, 0o644);
  put(path.join(work, 'requirements.toml'), t.codex, 0o644);
  put(path.join(work, 'kiro.json'), t.kiro, 0o644);
  // What an earlier release installed for the restart guard, the breaking-glass switches (ADR-0028) and the
  // HITL picker guard (ADR-0013, 2026-10-05 amendment).
  for (const f of LEGACY) rmF(ctx, t.bin + '/' + f);
  rmJson(ctx, t.switches);
  rmdirQuiet(t.switches);
}

/** @param {Ctx} ctx */
function removeMode(ctx) {
  const { t } = ctx;
  if (!isRootRun(ctx)) {
    warn(ctx, 'REFUSE  --remove needs administrator privilege (sudo)');
    return 2;
  }
  for (const f of [...FILES, ...LEGACY]) rmF(ctx, t.bin + '/' + f);
  for (const d of ['hook/src/commands', 'hook/src/lib', 'hook/src', 'hook']) rmdirQuiet(t.bin + '/' + d);
  rmJson(ctx, t.switches);
  rmF(ctx, t.claude);
  if (exists(t.codex) && !codexForeign(t.codex)) rmF(ctx, t.codex);
  if (kiroForeign(t.kiro)) say(ctx, 'NOTE    ' + t.kiro + ' is NOT managed by this project; left alone');
  else if (exists(t.kiro)) rmF(ctx, t.kiro);
  for (const d of [t.switches, t.bin, t.base]) rmdirQuiet(d);
  say(ctx, 'REMOVED the admin-layer hooks; run mhw install-user as yourself to restore the user-level ones');
  return 0;
}

/**
 * The command: parse, look the node up for the modes that render, refuse an admin path the hook command
 * cannot carry, and run the mode.
 * @param {string[]} argv @param {Env} env @param {Io} [io]
 */
export function main(argv, env, io = STDIO) {
  let mode = 'render';
  let root = '';
  let stage = '';
  let sha = '';
  let overlay = '';
  for (const arg of argv) {
    if (arg === '--check') mode = 'check';
    else if (arg === '--uninstall') mode = 'uninstall';
    else if (arg === '--remove') mode = 'remove';
    else if (arg.startsWith('--apply=')) {
      mode = 'apply';
      stage = arg.slice('--apply='.length);
    } else if (arg.startsWith('--sha256=')) sha = arg.slice('--sha256='.length);
    else if (arg.startsWith('--root=')) root = arg.slice('--root='.length);
    else if (arg.startsWith('--overlay=')) overlay = arg;
    else if (arg === '-h' || arg === '--help') {
      io.out(USAGE);
      return 0;
    } else {
      io.err('unknown argument: ' + arg + '\n');
      return 2;
    }
  }
  /** @type {Ctx} */
  const ctx = { env, io, root, overlay, t: targets(root), node: '', nodeLine: '' };
  if (mode === 'render' || mode === 'check') {
    // The node that runs mhw install-user (MHW_NODE, set by mhw, else node on PATH), by absolute path. An
    // absolute MHW_NODE that is not an executable file is refused, never replaced by another node (PR #515
    // lens A1). --apply, --remove and --uninstall need none: this process is node.
    const found = nodeLookup(env);
    if (found.refused) {
      io.err('REFUSE  MHW_NODE (' + env.MHW_NODE + ') is not an executable file; nothing staged or installed\n');
      return 2;
    }
    if (!found.node) {
      io.err('REFUSE  node (26 or later) is required for the Kiro admin document\n');
      return 2;
    }
    ctx.node = found.node;
  }
  if (QUOTED.test(ctx.t.bin)) {
    io.err('REFUSE  ' + ctx.t.bin + ' holds a quote, backslash, dollar sign or backtick\n');
    return 2;
  }
  try {
    if (mode === 'render') return renderMode(ctx);
    if (mode === 'uninstall') return uninstallMode(ctx);
    if (mode === 'check') return checkMode(ctx);
    if (mode === 'apply') return applyMode(ctx, stage, sha);
    return removeMode(ctx);
  } catch (e) {
    if (e instanceof Exit) return e.code;
    throw e;
  }
}

/** True when this file is the program node was started with. */
function isEntry() {
  try {
    return fs.realpathSync(process.argv[1] || '') === fs.realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isEntry()) process.exitCode = main(process.argv.slice(2), process.env);
