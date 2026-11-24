#!/usr/bin/env node
// S31 fixture (#501): a FAKE mhw, the package the prod canary's golden cases install and check. It renders
// the deny floor of its own global/ and overlay/ deny-floor.conf into a throwaway HOME and admin root in the
// shapes the canary reads, answers `status`, `check`, `uninstall --yes` and the prompt hook (since #600 a
// script install writes, as the fixed-pattern check's, that runs this file with `prompt`), and can be told by
// variant.json to break each of them (one key per property; a test may override the package's variant.json
// with <work>.variant.json beside the canary's work directory, so one package serves every row). It is not mhw and claims nothing about mhw: it exists so both the
// deleted prod_canary.py and .github/scripts/prod-canary.js can be run against the same package, offline,
// in seconds. Every value is synthetic. CommonJS (this package declares no "type"); node: modules only.
'use strict';
const fs = require('node:fs');
const path = require('node:path');

const NAME = 'personal-multi-harness-workstation-configuration';
const MARKER = 'PMHWC_PASTE_WRAPPER';
const PKG = fs.realpathSync(path.join(__dirname, '..'));
const HOME = process.env.HOME || '';
const ROOT = process.env.WORKSTATION_MANAGED_ROOT || '';
/** @type {Record<string, unknown>} */
const VARIANT = JSON.parse(fs.readFileSync(path.join(PKG, 'variant.json'), 'utf8'));
// The canary's box is <work>/<label>/home: <work>.variant.json beside the work directory overrides.
const WORK = path.dirname(path.dirname(HOME));
const OVERRIDE = path.join(path.dirname(WORK), path.basename(WORK) + '.variant.json');
if (HOME && fs.existsSync(OVERRIDE)) Object.assign(VARIANT, JSON.parse(fs.readFileSync(OVERRIDE, 'utf8')));
const OWNER_DENY = 'Bash(owner-canary-tool --only-mine:*)';
const BACKUP = '.pmhwc-backup';
const KEY_PATTERN = /AKIA[0-9A-Z]{16}/g;

/** @returns {Array<[string, string[]]>} */
function floor() {
  /** @type {Array<[string, string[]]>} */
  const out = [];
  for (const rel of ['global/deny-floor.conf', 'overlay/deny-floor.conf']) {
    const f = path.join(PKG, rel);
    if (!fs.existsSync(f)) continue;
    for (const raw of fs.readFileSync(f, 'utf8').split('\n')) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      const w = line.split(/\s+/);
      out.push([w[0], w.slice(1)]);
    }
  }
  return out;
}

/** @param {string} p */
function mkdirFor(p) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
}

/** Back the owner's file up once, and return its original text (or null). @param {string} p */
function original(p) {
  const b = p + BACKUP;
  if (fs.existsSync(b)) return fs.readFileSync(b, 'utf8');
  if (fs.existsSync(p)) {
    fs.copyFileSync(p, b);
    return fs.readFileSync(p, 'utf8');
  }
  return null;
}

function firstNode() {
  for (const dir of (process.env.PATH || '').split(':')) {
    if (!dir || !path.isAbsolute(dir)) continue;
    const p = path.join(dir, 'node');
    if (fs.existsSync(p)) return p;
  }
  return process.execPath;
}

// #600: the prompt hook is an installed script (the fixed-pattern check's place), never mhw itself.
const SCRIPT = path.join(HOME, '.local', 'share', NAME, 'pattern-check', 'src', 'hooks', 'pattern-check.js');

/** @param {string} harness */
function hookCommand(harness) {
  return '"' + process.execPath + '" "' + SCRIPT + '" prompt --harness ' + harness;
}

function install() {
  const entries = floor();
  if (VARIANT.broken) entries.pop();
  const claude = [];
  const codex = [];
  /** @type {Record<string, string[]>} */
  const kiro = { shell: [], fs_read: [], fs_write: [] };
  for (const [kind, words] of entries) {
    const w = words.join(' ');
    if (kind === 'cmd') {
      claude.push('Bash(' + w + ':*)');
      codex.push(words);
      kiro.shell.push(w + ' *');
    } else if (kind === 'glob') {
      claude.push('Bash(' + w + ')');
      kiro.shell.push(w);
    } else {
      claude.push('Read(' + w + ')', 'Edit(' + w + ')');
      kiro.fs_read.push(w);
      kiro.fs_write.push(w);
    }
  }
  // Claude Code user settings: the owner's document, plus the floor and the record of what is mhw's.
  const settings = path.join(HOME, '.claude', 'settings.json');
  const sText = original(settings);
  const doc = sText ? JSON.parse(sText) : {};
  doc.permissions = doc.permissions || {};
  const kept = (doc.permissions.deny || []).filter((/** @type {string} */ r) => !(VARIANT.dropOwnerDeny && r === OWNER_DENY));
  doc.permissions.deny = [...kept, ...claude];
  doc[NAME + '-owned-deny'] = claude;
  mkdirFor(settings);
  fs.writeFileSync(settings, JSON.stringify(doc, null, 2) + '\n');
  // Codex user rules file.
  const rules = path.join(HOME, '.codex', 'rules', 'workstation-deny-floor.rules');
  mkdirFor(rules);
  fs.writeFileSync(rules, '# managed-by: ' + NAME + '\n'
    + codex.map((c) => 'prefix_rule(pattern=' + JSON.stringify(c) + ', decision="forbidden")\n').join(''));
  // Kiro user permissions.yaml: the owner's rules kept, the floor appended.
  const perms = path.join(HOME, '.kiro', 'settings', 'permissions.yaml');
  let yaml = original(perms) || 'rules:\n';
  if (VARIANT.dropOwnerKiro) yaml = 'rules:\n';
  for (const cap of Object.keys(kiro)) {
    if (!kiro[cap].length) continue;
    yaml += '  - capability: "' + cap + '"\n    effect: "deny"\n    match:\n'
      + kiro[cap].map((m) => '      - ' + JSON.stringify(m) + '\n').join('');
  }
  mkdirFor(perms);
  fs.writeFileSync(perms, yaml);
  // The admin layer, under the throwaway root only.
  const claudeHook = { type: 'command', command: hookCommand('claude') };
  const drop = path.join(ROOT, 'etc', 'claude-code', 'managed-settings.d', '50-' + NAME + '.json');
  mkdirFor(drop);
  fs.writeFileSync(drop, JSON.stringify({
    permissions: { deny: claude },
    hooks: { UserPromptSubmit: [{ hooks: VARIANT.twoHooks ? [claudeHook, claudeHook] : [claudeHook] }] },
  }, null, 2) + '\n');
  if (VARIANT.twoDropIns) {
    const second = path.join(ROOT, 'opt', 'managed-settings.d', '50-' + NAME + '.json');
    mkdirFor(second);
    fs.copyFileSync(drop, second);
  }
  const req = path.join(ROOT, 'etc', 'codex', 'requirements.toml');
  mkdirFor(req);
  fs.writeFileSync(req, '[rules]\nprefix_rules = [\n'
    + codex.map((c) => '  { pattern = [' + c.map((t) => '{ token = "' + t + '" }').join(', ') + '], decision = "forbidden" },\n').join('')
    + ']\n\n[[hooks.UserPromptSubmit]]\ncommand = ' + JSON.stringify(hookCommand('codex')) + '\n'
    + (VARIANT.twoHooks ? '\n[[hooks.UserPromptSubmit]]\ncommand = ' + JSON.stringify(hookCommand('codex')) + '\n' : ''));
  const km = path.join(ROOT, 'etc', 'kiro', 'managed-settings.json');
  mkdirFor(km);
  fs.writeFileSync(km, JSON.stringify({
    rules: Object.keys(kiro).filter((c) => kiro[c].length).map((c) => ({ capability: c, effect: 'deny', match: kiro[c] })),
  }, null, 2) + '\n');
  // Kiro CLI V3's user-level hook file, in the form install.sh renders.
  const data = path.join(HOME, '.local', 'share', NAME);
  fs.mkdirSync(data, { recursive: true });
  fs.writeFileSync(path.join(data, 'clipboard.conf'), '# synthetic\n');
  mkdirFor(SCRIPT);
  fs.writeFileSync(SCRIPT, "'use strict';\nrequire(" + JSON.stringify(path.join(PKG, 'bin', 'mhw.js')) + ');\n');
  const inner = '/usr/bin/env -u NODE_OPTIONS -u NODE_ICU_DATA -u NODE_PATH -u NODE_COMPILE_CACHE "' + firstNode()
    + '" "' + SCRIPT + '" prompt --harness kiro --config "' + path.join(data, 'clipboard.conf') + '"';
  const notice = 'Paste filter (ADR-0033): internal error (HookStartError); this prompt was NOT checked.';
  let command = "/bin/sh -c '" + inner + ' || { [ $? -eq 2 ] && exit 2; printf "' + String.raw`%s\n` + '" "' + notice + "\" >&2; exit 2; }'";
  if (VARIANT.broken) command += ' ';
  // The fixed-pattern check's Kiro file (#588; the prompt hook there since #600): its prompt entry and its
  // pre-tool entry, which the canary does not run.
  const kh = path.join(HOME, '.kiro', 'hooks', NAME + '-pattern-check.json');
  const shape = VARIANT.kiroShape;
  const entry = {
    description: shape === 'desc' ? 'someone else' : 'managed-by: ' + NAME,
    trigger: shape === 'trigger' ? 'Stop' : 'UserPromptSubmit', action: { type: 'command', command },
  };
  const tool = { description: 'managed-by: ' + NAME, trigger: 'PreToolUse', action: { type: 'command', command: 'true' } };
  if (shape !== 'missing') {
    mkdirFor(kh);
    fs.writeFileSync(kh, JSON.stringify({ version: shape === 'version' ? 'v0' : 'v1', hooks: shape === 'two' ? [entry, entry, tool] : [entry, tool] }, null, 2) + '\n');
  }
  if (VARIANT.oldKiroFile) {
    const old = path.join(HOME, '.kiro', 'hooks', NAME + '-paste-filter.json');
    mkdirFor(old);
    fs.writeFileSync(old, '{"version": "v1", "hooks": []}\n');
  }
  if (VARIANT.badSettings) fs.writeFileSync(settings, '{ not json\n');
  if (VARIANT.installExit) {
    process.stdout.write('install: a synthetic failure\n');
    return Number(VARIANT.installExit);
  }
  process.stdout.write(VARIANT.noSuccessLine ? 'Installed.\n' : 'Installation successful!\n');
  return 0;
}

/** @param {string} dir @returns {string[]} */
function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

function uninstall() {
  for (const p of [
    path.join(HOME, '.claude', 'settings.json'), path.join(HOME, '.kiro', 'settings', 'permissions.yaml'),
  ]) {
    if (fs.existsSync(p + BACKUP)) fs.renameSync(p + BACKUP, p);
    else fs.rmSync(p, { force: true });
  }
  fs.rmSync(path.join(HOME, '.codex', 'rules', 'workstation-deny-floor.rules'), { force: true });
  fs.rmSync(path.join(HOME, '.kiro', 'hooks', NAME + '-pattern-check.json'), { force: true });
  fs.rmSync(path.join(HOME, '.kiro', 'hooks', NAME + '-paste-filter.json'), { force: true });
  fs.rmSync(path.join(HOME, '.local', 'share', NAME), { recursive: true, force: true });
  for (const f of walk(ROOT)) fs.rmSync(f, { force: true });
  if (VARIANT.uninstallChangesZshrc) fs.appendFileSync(path.join(HOME, '.zshrc'), '# changed by uninstall\n');
  if (VARIANT.uninstallKeepsFloor) {
    const settings = path.join(HOME, '.claude', 'settings.json');
    const doc = JSON.parse(fs.readFileSync(settings, 'utf8'));
    doc.permissions.deny.push('Bash(rm -rf:*)');
    fs.writeFileSync(settings, JSON.stringify(doc, null, 2) + '\n');
  }
  // npm cannot remove a package from a read-only node_modules directory.
  if (VARIANT.lockPackage) fs.chmodSync(path.dirname(PKG), 0o500);
  if (VARIANT.uninstallExit1) return 1;
  if (VARIANT.broken) {
    fs.writeFileSync(path.join(HOME, '.mhw-leftover'), 'left behind\n');
    fs.mkdirSync(path.join(ROOT, 'etc'), { recursive: true });
    fs.writeFileSync(path.join(ROOT, 'etc', 'leftover.json'), '{"x": 1}\n');
  }
  process.stdout.write('Uninstalled.\n');
  return 0;
}

function hook() {
  const harness = process.argv[process.argv.indexOf('--harness') + 1];
  const payload = JSON.parse(fs.readFileSync(0, 'utf8') || '{}');
  const prompt = String(payload.prompt || '');
  const kiro = harness === 'kiro';
  // Since #600 the prompt hook defers to nothing; hookHonoursMarker is the break the canary must catch.
  if (!kiro && process.env[MARKER] && VARIANT.hookHonoursMarker) return 0;
  if (VARIANT.broken && harness === 'claude') return 0;
  if (!/AKIA[0-9A-Z]{16}/.test(prompt)) return clean(kiro);
  const redacted = prompt.replaceAll(KEY_PATTERN, '[REDACTED:credential]');
  if (kiro) {
    if (VARIANT.kiroStdout) process.stdout.write('noise\n');
    if (VARIANT.kiroNoRedaction) process.stderr.write('Blocked.\n');
    else process.stderr.write('Blocked: ' + (VARIANT.kiroEchoesKey ? prompt + ' ' : '') + redacted + '\n');
    return VARIANT.kiroExit0 ? 0 : 2;
  }
  process.stdout.write(JSON.stringify({ decision: 'block', reason: 'Blocked: ' + (VARIANT.hookEchoesKey ? prompt : redacted) }) + '\n');
  return VARIANT.hookBlockExit1 ? 1 : 0;
}

/** A clean prompt: silent and exit 0, unless a variant says otherwise. @param {boolean} kiro */
function clean(kiro) {
  if (kiro) {
    if (VARIANT.kiroCleanNoise) process.stdout.write('noise\n');
    return VARIANT.kiroBlocksClean ? 2 : 0;
  }
  if (VARIANT.hookCleanNoise) process.stdout.write('{}\n');
  return VARIANT.hookCleanExit1 ? 1 : 0;
}

function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  if (cmd === 'install' && rest[0] === '--yes') return install();
  if (cmd === 'uninstall' && rest[0] === '--yes') return uninstall();
  if (cmd === 'prompt') return hook(); // run through the installed script (#600)
  if (cmd === 'status') {
    process.stdout.write('mhw status (fixture)\n  source fixture package\n  evidence installed\n');
    return VARIANT.statusExit1 ? 1 : 0;
  }
  if (cmd === 'check') {
    let lines = ['OK    claude floor', VARIANT.broken ? 'DRIFT codex floor' : 'OK    codex floor',
      'PREREQ required command-line tools', 'OK node [required]', 'MISSING claude [required: synthetic]',
      VARIANT.broken ? 'MISSING gnu-tool [required: synthetic]' : 'MISSING codex [required: synthetic]'];
    if (VARIANT.noPrereq) lines = lines.filter((l) => !l.startsWith('PREREQ'));
    if (VARIANT.checkNoMissing) lines = lines.filter((l) => !l.startsWith('MISSING'));
    process.stdout.write(lines.join('\n') + '\n');
    return VARIANT.checkExit2 ? 2 : 1;
  }
  process.stderr.write('fixture mhw: unknown command\n');
  return 2;
}

process.exitCode = main();
