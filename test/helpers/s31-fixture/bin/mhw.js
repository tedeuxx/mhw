#!/usr/bin/env node
// S31 fixture (#501): a FAKE mhw, the package the prod canary's golden cases install and check. It renders
// the deny floor of its own global/ and overlay/ deny-floor.conf into a throwaway HOME and admin root in the
// shapes the canary reads, answers `status`, `check`, `uninstall --yes` and `hook prompt`, and can be told by
// variant.json to break each of them. It is not mhw and claims nothing about mhw: it exists so both the
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
/** @type {{ broken?: boolean, installExit?: number, badSettings?: boolean }} */
const VARIANT = JSON.parse(fs.readFileSync(path.join(PKG, 'variant.json'), 'utf8'));
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

/** @param {string} harness */
function hookCommand(harness) {
  return '"' + process.execPath + '" "' + path.join(PKG, 'bin', 'mhw.js') + '" hook prompt --harness ' + harness;
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
  doc.permissions.deny = [...(doc.permissions.deny || []), ...claude];
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
  for (const cap of Object.keys(kiro)) {
    if (!kiro[cap].length) continue;
    yaml += '  - capability: "' + cap + '"\n    effect: "deny"\n    match:\n'
      + kiro[cap].map((m) => '      - ' + JSON.stringify(m) + '\n').join('');
  }
  mkdirFor(perms);
  fs.writeFileSync(perms, yaml);
  // The admin layer, under the throwaway root only.
  const drop = path.join(ROOT, 'etc', 'claude-code', 'managed-settings.d', '50-' + NAME + '.json');
  mkdirFor(drop);
  fs.writeFileSync(drop, JSON.stringify({
    permissions: { deny: claude },
    hooks: { UserPromptSubmit: [{ hooks: [{ type: 'command', command: hookCommand('claude') }] }] },
  }, null, 2) + '\n');
  const req = path.join(ROOT, 'etc', 'codex', 'requirements.toml');
  mkdirFor(req);
  fs.writeFileSync(req, '[rules]\nprefix_rules = [\n'
    + codex.map((c) => '  { pattern = [' + c.map((t) => '{ token = "' + t + '" }').join(', ') + '], decision = "forbidden" },\n').join('')
    + ']\n\n[[hooks.UserPromptSubmit]]\ncommand = ' + JSON.stringify(hookCommand('codex')) + '\n');
  const km = path.join(ROOT, 'etc', 'kiro', 'managed-settings.json');
  mkdirFor(km);
  fs.writeFileSync(km, JSON.stringify({
    rules: Object.keys(kiro).filter((c) => kiro[c].length).map((c) => ({ capability: c, effect: 'deny', match: kiro[c] })),
  }, null, 2) + '\n');
  // Kiro CLI V3's user-level hook file, in the form install.sh renders.
  const data = path.join(HOME, '.local', 'share', NAME);
  fs.mkdirSync(data, { recursive: true });
  fs.writeFileSync(path.join(data, 'clipboard.conf'), '# synthetic\n');
  const inner = '/usr/bin/env -u NODE_OPTIONS -u NODE_ICU_DATA -u NODE_PATH -u NODE_COMPILE_CACHE "' + firstNode()
    + '" "' + path.join(PKG, 'bin', 'mhw.js') + '" hook prompt --harness kiro --config "' + path.join(data, 'clipboard.conf') + '"';
  const notice = 'Paste filter (ADR-0033): internal error (HookStartError); this prompt was NOT checked.';
  let command = "/bin/sh -c '" + inner + ' || { [ $? -eq 2 ] && exit 2; printf "' + String.raw`%s\n` + '" "' + notice + "\" >&2; exit 2; }'";
  if (VARIANT.broken) command += ' ';
  const kh = path.join(HOME, '.kiro', 'hooks', NAME + '-paste-filter.json');
  mkdirFor(kh);
  fs.writeFileSync(kh, JSON.stringify({
    version: 'v1',
    hooks: [{ description: 'managed-by: ' + NAME, trigger: 'UserPromptSubmit', action: { type: 'command', command } }],
  }, null, 2) + '\n');
  if (VARIANT.badSettings) fs.writeFileSync(settings, '{ not json\n');
  if (VARIANT.installExit) {
    process.stdout.write('install: a synthetic failure\n');
    return VARIANT.installExit;
  }
  process.stdout.write('Installation successful!\n');
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
  fs.rmSync(path.join(HOME, '.kiro', 'hooks', NAME + '-paste-filter.json'), { force: true });
  fs.rmSync(path.join(HOME, '.local', 'share', NAME), { recursive: true, force: true });
  for (const f of walk(ROOT)) fs.rmSync(f, { force: true });
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
  if (harness !== 'kiro' && process.env[MARKER]) return 0;
  if (VARIANT.broken && harness === 'claude') return 0;
  if (!/AKIA[0-9A-Z]{16}/.test(prompt)) return 0;
  const redacted = prompt.replaceAll(KEY_PATTERN, '[REDACTED:credential]');
  if (harness === 'kiro') {
    process.stderr.write('Blocked: ' + redacted + '\n');
    return 2;
  }
  process.stdout.write(JSON.stringify({ decision: 'block', reason: 'Blocked: ' + redacted }) + '\n');
  return 0;
}

function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  if (cmd === 'install' && rest[0] === '--yes') return install();
  if (cmd === 'uninstall' && rest[0] === '--yes') return uninstall();
  if (cmd === 'hook' && rest[0] === 'prompt') return hook();
  if (cmd === 'status') {
    process.stdout.write('mhw status (fixture)\n  source fixture package\n  evidence installed\n');
    return 0;
  }
  if (cmd === 'check') {
    const lines = ['OK    claude floor', VARIANT.broken ? 'DRIFT codex floor' : 'OK    codex floor',
      'PREREQ required command-line tools', 'OK node [required]', 'MISSING claude [required: synthetic]',
      VARIANT.broken ? 'MISSING gnu-tool [required: synthetic]' : 'MISSING codex [required: synthetic]'];
    process.stdout.write(lines.join('\n') + '\n');
    return 1;
  }
  process.stderr.write('fixture mhw: unknown command\n');
  return 2;
}

process.exitCode = main();
