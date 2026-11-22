// mhw install-user (#503, S25 of #470) against throwaway HOMEs, never the real one: the cases of the deleted
// global/install.test.sh, one test per section, in its order and with its section numbers. Every run passes a
// throwaway --managed-root (carried from #502, 3a), so no case reads the admin layer under /Library or /etc.
// POSIX only: the user-layer installer is macOS and Linux (Windows runs mhw install-windows, held by
// test/install/windows.test.js; #497). The parity with install.sh is install-user-golden.test.js.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { which } from '../helpers/home.js';
import { pasteCmd } from '../../src/commands/install-user.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const MHW = path.join(ROOT, 'bin', 'mhw.js');
const NAME = 'personal-multi-harness-workstation-configuration';
const MARKER = 'managed-by: ' + NAME;
const POSIX = process.platform !== 'win32';
const skip = !POSIX && 'the user-layer installer is POSIX; test/install/windows.test.js holds mhw install-windows (#497)';
const BASE = POSIX ? fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 's25-install-'))) : '';
after(() => {
  if (BASE) fs.rmSync(BASE, { recursive: true, force: true });
});

// Sections 1-16 run with a copy of the repository overlay minus model-defaults.json, which would overwrite
// the settings they seed; section 17 runs the real overlay and asserts the model defaults (ADR-0035).
const MODELS_OFF = path.join(BASE, 'overlay-without-model-defaults');
if (POSIX) {
  fs.cpSync(path.join(ROOT, 'overlay'), MODELS_OFF, { recursive: true });
  fs.rmSync(path.join(MODELS_OFF, 'model-defaults.json'), { force: true });
}
const REPO_OVERLAY = path.join(ROOT, 'overlay');
const NODE = which('node') || process.execPath;
const WRAP_MHW = MHW;

/** A fresh directory under BASE. @param {string} name */
function dir(name) {
  const d = path.join(BASE, name);
  fs.mkdirSync(d, { recursive: true });
  return d;
}

/** The data directory under a HOME. @param {string} h */
const data = (h) => h + '/.local/share/' + NAME;

/**
 * One run of the installer, as install.test.sh ran `sh install.sh`: HOME and the shell fixed, the overlay
 * without model defaults unless the arguments name one, CODEX_HOME, XDG_DATA_HOME and ZDOTDIR unset unless
 * given, and always a throwaway admin root.
 * @param {string} home @param {string[]} [args] @param {Record<string, string | undefined>} [extra]
 * @returns {{ code: number | null, out: string, stdout: string, stderr: string }}
 */
function inst(home, args = [], extra = {}) {
  /** @type {Record<string, string>} */
  const env = { PATH: process.env.PATH || '', HOME: home, SHELL: '/bin/zsh', LANG: 'C', TMPDIR: dir('tmp'), WORKSTATION_OVERLAY: MODELS_OFF };
  for (const [k, v] of Object.entries(extra)) {
    if (v === undefined) delete env[k];
    else env[k] = v;
  }
  const all = args.some((a) => a.startsWith('--managed-root=')) ? args : [...args, '--managed-root=' + path.join(BASE, 'no-admin')];
  const p = spawnSync(process.execPath, [MHW, 'install-user', ...all], { env, encoding: 'utf8', timeout: 120000 });
  return { code: p.status, out: p.stdout + p.stderr, stdout: p.stdout, stderr: p.stderr };
}

/** The file's text, or null. @param {string} f */
function read(f) {
  try {
    return fs.readFileSync(f, 'utf8');
  } catch {
    return null;
  }
}
/** @param {string} f */
const json = (f) => JSON.parse(/** @type {string} */ (read(f)));
/** @param {string} f */
const exists = (f) => {
  try {
    fs.lstatSync(f);
    return true;
  } catch {
    return false;
  }
};
/** @param {string} f */
const mode = (f) => (fs.statSync(f).mode & 0o777).toString(8);
/** Every regular file under d. @param {string} d @returns {string[]} */
function files(d) {
  if (!exists(d)) return [];
  return fs.readdirSync(d, { recursive: true, withFileTypes: true }).filter((e) => e.isFile())
    .map((e) => path.join(e.parentPath, e.name));
}
/** @param {string} text @param {string} line */
const hasLine = (text, line) => text.split('\n').includes(line);

/** The managed targets of a HOME. @param {string} h */
const targets = (h) => [h + '/.claude/CLAUDE.md', h + '/.codex/AGENTS.md', h + '/.kiro/steering/workstation-global-brief.md',
  h + '/.claude/settings.json', h + '/.codex/rules/workstation-deny-floor.rules', data(h) + '/clipboard.conf', h + '/.codex/hooks.json',
  data(h) + '/paste-filter.sh'];
/** @param {string} h */
const fingerprint = (h) => targets(h).map((f) => read(f) ?? 'absent ' + f);

/** Entries of the removed HITL picker guard in a settings file (must stay 0). @param {string} f */
const ours = (f) => (json(f).hooks?.PreToolUse ?? []).flatMap((/** @type {any} */ g) => g.hooks ?? [])
  .filter((/** @type {any} */ x) => String(x.command).includes(NAME + '/hitl-escalation-guard.sh')).length;
/** Paste-filter entries of ours (UserPromptSubmit) in a settings file. @param {string} f */
const pours = (f) => (json(f).hooks?.UserPromptSubmit ?? []).flatMap((/** @type {any} */ g) => g.hooks ?? [])
  .filter((/** @type {any} */ x) => String(x.command).includes('/bin/mhw.js" hook prompt --harness ') || String(x.command).includes(NAME + '/clipboard_guard.py')).length;
/** How many times a rule is in permissions.deny. @param {string} f @param {string} r */
const hasRule = (f, r) => (json(f).permissions?.deny ?? []).filter((/** @type {string} */ x) => x === r).length;
/** The prompt hook command install renders. @param {string} harness @param {string} conf */
const hookCmd = (harness, conf) => pasteCmd(harness, NODE, WRAP_MHW, conf);

// Expected rules, derived from the floor sources independently of the installer: a cmd line is one rule,
// a glob line one (Claude Code only), a file line two (Read and Edit).
const floorLines = POSIX ? [path.join(ROOT, 'global', 'deny-floor.conf'), path.join(REPO_OVERLAY, 'deny-floor.conf')]
  .flatMap((f) => (read(f) ?? '').split('\n')).map((l) => l.trim().split(/\s+/)) : [];
const FLOOR_RULES = floorLines.reduce((n, f) => n + (f[0] === 'cmd' || f[0] === 'glob' ? 1 : f[0] === 'file' ? 2 : 0), 0);
const FLOOR_CMDS = floorLines.filter((f) => f[0] === 'cmd').length;
const SYNTHETIC_KEY = 'AKI' + 'AQQQQRRRRSSSSTTTT';

/** Run a hook command as a harness would: through sh -c, the payload on stdin. @param {string} home @param {string} cmd @param {string} prompt @param {Record<string, string>} [extra] */
function runPaste(home, cmd, prompt, extra = {}) {
  const input = prompt === null ? '' : JSON.stringify({ hook_event_name: 'UserPromptSubmit', prompt });
  return spawnSync('/bin/sh', ['-c', cmd], { input, encoding: 'utf8', env: { PATH: process.env.PATH || '', HOME: home, ...extra } });
}

const H = POSIX ? dir('home-fresh') : '';
let freshOut = '';

test('1. dry-run writes nothing', { skip }, () => {
  const h = dir('home-dry');
  const r = inst(h, ['--dry-run']);
  assert.equal(r.code, 0, r.out);
  assert.deepEqual(files(h), [], 'dry-run wrote a file');
  assert.match(r.stdout, /^WOULD WRITE/m);
  assert.match(r.stdout, /^WOULD MERGE/m);
  assert.match(r.stdout, /^\+.*hook prompt --harness claude/m);
  assert.match(r.stdout, /^\+ *"Bash\(git push --force:\*\)"/m);
  assert.match(r.stdout, /^WOULD WRITE .*\/\.codex\/rules\/workstation-deny-floor\.rules/m);
});

test('2. fresh install', { skip }, () => {
  const r = inst(H);
  freshOut = r.stdout;
  assert.equal(r.code, 0, r.out);
  for (const f of targets(H)) assert.ok(fs.statSync(f).isFile(), 'missing: ' + f);
  const kiro = /** @type {string} */ (read(H + '/.kiro/steering/workstation-global-brief.md')).split('\n');
  assert.deepEqual(kiro.slice(0, 2), ['---', 'inclusion: always']);
  const claude = /** @type {string} */ (read(H + '/.claude/CLAUDE.md'));
  assert.match(claude, /^## Escalating to the owner/m);
  assert.match(claude, /^## Owner overlay/m);
  // The HITL picker guard is removed (Issue #60): no script, limits or hook entry.
  const s = H + '/.claude/settings.json';
  assert.ok(!exists(data(H) + '/hitl-escalation-guard.sh') && !exists(data(H) + '/hitl.conf'));
  assert.equal(ours(s), 0);
  assert.equal((json(s).hooks?.PreToolUse ?? []).length, 0);
  assert.ok(!(read(s) + /** @type {string} */ (read(H + '/.codex/hooks.json'))).includes('AskUserQuestion'));
  const briefs = [H + '/.claude/CLAUDE.md', H + '/.codex/AGENTS.md', H + '/.kiro/steering/workstation-global-brief.md'];
  for (const b of briefs) {
    const t = /** @type {string} */ (read(b));
    // The interaction standards (Issue #60), and no session-type intake.
    assert.ok(t.includes('one extreme, the opposite extreme, and the middle ground'), b);
    assert.ok(t.includes('one question per message; a question stem is at most 280 characters; the reasoning goes in a linked artifact'), b);
    assert.ok(t.includes('talk to the owner in Brazilian Portuguese in everything made for the owner to read: chat, reports, artifacts and pickers. Only text for an outside audience is in English'), b);
    assert.ok(!t.includes('session-policy.json') && !t.includes('Melhoria de harness'), b);
    // The ten commandments (Issue #77) open every brief, before the mission.
    const first = t.split('\n').find((l) => l.startsWith('## '));
    assert.equal(first, '## Ten commandments for working with an agent harness every day', b);
    const titles = ['1. **Native first, thin on top, one source for all.**', '2. **Talk plainly with your agents.**',
      '3. **No build without an agreed document.**', '4. **The issue tracker is the bus; where a session runs does not matter.**',
      '5. **The orchestrator talks, the agents work, each with least privilege for its purpose and full',
      '6. **Defend the perimeter, teach the behaviour, clean without asking.**', "7. **Probe, don't pretend.**",
      '8. **Track agent harness consumption per Issue.**', '9. **Less is more, and design the context for attention.**',
      '10. **Use conflict between agents to reach consensus.**'];
    assert.equal(titles.filter((x) => t.split('\n').some((l) => l.startsWith(x))).length, 10, b);
    assert.ok(!t.includes('Talk like executives'), b);
    // ADR-0015's first lock, quoted word for word.
    const lockBrief = section(t, /^## Ethical lock on the owner/).filter((l) => l.startsWith('> ')).map((l) => l.slice(2)).join(' ').replace(/ +/g, ' ').trim();
    assert.equal(lockBrief, LOCK_ADR, b);
    assert.ok(/none does yet, and until a project.s does, this half is written/.test(t), b);
    assert.ok(/^policy only and does not change that project.s merge route/m.test(t), b);
    assert.ok(!t.includes("which each project's CI/CD carries"), b);
    // Codex truncates a brief past 32768 bytes.
    assert.ok(Buffer.byteLength(t) <= 32768, b + ' is ' + Buffer.byteLength(t) + ' bytes');
  }
  assert.equal(inst(H, ['--check']).code, 0);
  // The restart guard and /breaking-glass are removed (ADR-0028).
  const both = read(s) + /** @type {string} */ (read(H + '/.codex/hooks.json'));
  assert.ok(!both.includes('restart_guard') && !both.includes('breaking_glass'));
  assert.ok(!exists(data(H) + '/restart_guard.py') && !exists(data(H) + '/breaking_glass.py') && !exists(H + '/.claude/commands/breaking-glass.md'));
  assert.deepEqual(Object.keys(json(H + '/.codex/hooks.json').hooks), ['UserPromptSubmit']);
});

/** The lines of a markdown section, from the heading matching re to the next ## heading. @param {string} t @param {RegExp} re */
function section(t, re) {
  const lines = t.split('\n');
  const i = lines.findIndex((l) => re.test(l));
  if (i < 0) return [];
  const j = lines.findIndex((l, k) => k > i && l.startsWith('## '));
  return lines.slice(i + 1, j < 0 ? undefined : j);
}
const LOCK_ADR = (() => {
  if (!POSIX) return '';
  const t = /** @type {string} */ (read(path.join(ROOT, 'docs', 'adr', '0015-master-of-first-principles-ethical-locks-on-own-aims.md')));
  const lines = t.split('\n');
  const i = lines.findIndex((l) => l.startsWith('### Amendment'));
  const j = lines.findIndex((l, k) => k > i && l.startsWith('The first concrete lock protects'));
  const flat = lines.slice(i + 1, j < 0 ? undefined : j).join(' ').replace(/ +/g, ' ');
  const m = /(Local and recoverable work is autonomous by default\..*before material advancement\.)/.exec(flat);
  return m ? m[1] : '';
})();

test('2. the requirements document section 1c carries the brief\'s ten commandments word for word', { skip }, () => {
  /** @param {string} t @param {RegExp} re */
  const ten = (t, re) => section(t, re).filter((l) => /^ *[0-9]|^ {3}/.test(l)).join('\n');
  const brief = ten(/** @type {string} */ (read(path.join(ROOT, 'global', 'AGENTS.md'))), /^## Ten commandments/);
  const prd = ten(/** @type {string} */ (read(path.join(ROOT, 'docs', 'mhw-product-requirements-document-project.md'))), /^## 1c\. Ten commandments/);
  assert.ok(brief.length > 0);
  assert.equal(brief, prd);
});

test('2a. an earlier release\'s restart guard and breaking glass are removed cleanly, only by an install', { skip }, () => {
  const hl = dir('home-legacy');
  fs.mkdirSync(hl + '/.claude/commands', { recursive: true });
  fs.mkdirSync(hl + '/.codex', { recursive: true });
  inst(hl);
  fs.mkdirSync(data(hl) + '/restart-state', { recursive: true });
  const legacy = '/usr/bin/python3 -I -B "' + data(hl) + '/restart_guard.py" --harness claude-code';
  const s = json(hl + '/.claude/settings.json');
  s.hooks.SessionStart = [{ hooks: [{ type: 'command', command: legacy, timeout: 10 }] }];
  s.hooks.PreToolUse = [...(s.hooks.PreToolUse ?? []), { hooks: [{ type: 'command', command: legacy, timeout: 10 }] },
    { hooks: [{ type: 'command', command: '/foreign/pre.sh' }] },
    { matcher: 'AskUserQuestion', hooks: [{ type: 'command', command: '"' + data(hl) + '/hitl-escalation-guard.sh"', timeout: 5 }] }];
  fs.writeFileSync(hl + '/.claude/settings.json', JSON.stringify(s, null, 2) + '\n');
  const c = json(hl + '/.codex/hooks.json');
  c.hooks.SessionStart = [{ hooks: [{ type: 'command', command: legacy, timeout: 10 }] }];
  c.hooks.PreToolUse = [{ hooks: [{ type: 'command', command: legacy, timeout: 10 }] }];
  fs.writeFileSync(hl + '/.codex/hooks.json', JSON.stringify(c, null, 2) + '\n');
  for (const f of ['restart_guard.py', 'breaking_glass.py', 'hitl-escalation-guard.sh', 'hitl.conf']) {
    fs.writeFileSync(data(hl) + '/' + f, '#!/usr/bin/env python3\n# ' + MARKER + '; source: x\n');
  }
  fs.writeFileSync(hl + '/.claude/commands/breaking-glass.md', '---\n---\n<!-- ' + MARKER + '; source: x -->\n');
  fs.writeFileSync(data(hl) + '/restart-state/claude-code-0123.json', '{}');
  const ck = inst(hl, ['--check']);
  assert.equal(ck.code, 1, ck.out);
  assert.equal(ck.out.split('\n').filter((l) => l.startsWith('STALE')).length, 7, ck.out);
  assert.match(ck.out, /^DRIFT .*settings\.json/m);
  assert.match(ck.out, /^STALE .*hitl-escalation-guard\.sh/m);
  assert.match(ck.out, /^STALE .*hitl\.conf/m);
  assert.match(ck.out, /^STALE .*settings\.json: the removed HITL picker guard/m);
  assert.match(ck.out, /^DRIFT .*hooks\.json/m);
  assert.ok(exists(data(hl) + '/hitl-escalation-guard.sh') && exists(data(hl) + '/restart_guard.py'), 'check changed something');
  assert.equal(ours(hl + '/.claude/settings.json'), 1);
  assert.equal(inst(hl).code, 0);
  const both = read(hl + '/.claude/settings.json') + /** @type {string} */ (read(hl + '/.codex/hooks.json'));
  assert.ok(!both.includes('restart_guard') && !both.includes('breaking_glass'));
  for (const f of ['restart_guard.py', 'breaking_glass.py', 'restart-state', 'hitl-escalation-guard.sh', 'hitl.conf']) assert.ok(!exists(data(hl) + '/' + f), f);
  assert.ok(!exists(hl + '/.claude/commands/breaking-glass.md'));
  const after_ = json(hl + '/.claude/settings.json');
  assert.equal((after_.hooks.SessionStart ?? []).length, 0);
  assert.equal(after_.hooks.PreToolUse.flatMap((/** @type {any} */ g) => g.hooks).filter((/** @type {any} */ x) => x.command === '/foreign/pre.sh').length, 1);
  assert.equal(pours(hl + '/.claude/settings.json'), 1);
  assert.equal(ours(hl + '/.claude/settings.json'), 0);
  assert.ok(!both.includes('AskUserQuestion'));
  assert.equal(inst(hl, ['--check']).code, 0);
  fs.writeFileSync(hl + '/.claude/commands/breaking-glass.md', 'mine\n');
  const r = inst(hl);
  assert.equal(read(hl + '/.claude/commands/breaking-glass.md'), 'mine\n');
  assert.match(r.out, /^NOTE .*breaking-glass\.md/m);
});

test('2b. the deny floor, rendered for Claude Code and Codex', { skip }, () => {
  const s = H + '/.claude/settings.json';
  const doc = json(s);
  const ownAllow = doc[NAME + '-owned-allow']?.deny ?? [];
  assert.ok(FLOOR_RULES > 0);
  assert.equal(doc.permissions.deny.filter((/** @type {string} */ r) => !ownAllow.includes(r)).length, FLOOR_RULES);
  for (const r of ['Bash(rm -rf:*)', 'Bash(git push --force:*)', 'Bash(gh auth token:*)', 'Read(~/.ssh/id_*)', 'Edit(~/.aws/credentials)']) assert.equal(hasRule(s, r), 1, r);
  const rules = /** @type {string} */ (read(H + '/.codex/rules/workstation-deny-floor.rules'));
  assert.ok(hasLine(rules, 'prefix_rule(pattern=["git", "push", "--force"], decision="forbidden")'));
  assert.equal(rules.split('\n').filter((l) => l.startsWith('prefix_rule(')).length, FLOOR_CMDS);
  assert.ok(!rules.includes('decision="allow"'));
  // 2b'. one named rule per class the owner added on 2026-10-10 (ADR-0035).
  for (const r of ['Bash(terraform plan:*)', 'Bash(terraform env:*)', 'Bash(tofu env:*)', 'Bash(terraform state:*)', 'Bash(terraform init:*)',
    'Bash(terraform force-unlock:*)', 'Bash(tofu output:*)', 'Bash(tofu apply:*)', 'Bash(terraform -chdir=*)', 'Bash(tofu -chdir=*)',
    'Bash(aws ssm get-parameter --with-decryption:*)', 'Bash(aws ssm get-parameters-by-path --with-decryption:*)', 'Bash(git commit --no-verify:*)',
    'Bash(git commit -n:*)', 'Bash(git push --no-verify:*)', 'Bash(aws sso login:*)', 'Read(**/.env)', 'Edit(**/.env)', 'Read(**/.env.*)',
    'Read(**/*.pem)', 'Edit(**/*.pem)', 'Read(**/credentials*)', 'Edit(**/credentials*)']) assert.equal(hasRule(s, r), 1, r);
  for (const p of ['terraform plan', 'tofu state', 'terraform env', 'aws ssm get-parameter --with-decryption', 'git commit --no-verify', 'git push --no-verify', 'aws sso login']) {
    assert.ok(hasLine(rules, 'prefix_rule(pattern=[' + p.split(' ').map((w) => '"' + w + '"').join(', ') + '], decision="forbidden")'), p);
  }
  assert.ok(!rules.split('\n').filter((l) => l.startsWith('prefix_rule(')).some((l) => l.includes('*') || l.includes('-chdir')));
  // The subcommands the owner left open stay open.
  for (const c of ['terraform fmt -recursive', 'terraform validate', 'terraform version', 'tofu fmt', 'tofu validate', 'tofu version']) {
    assert.equal(ccDeny(s, c, false), '', c);
  }
});

/**
 * Claude Code's matcher, as install.test.sh modelled it (read from the 2.1.319 bundle): a rule ending in
 * ":*" is a word prefix; any other rule holding "*" is anchored at both ends with "*" read as ".*"; a rule
 * with no "*" is exact. The first rule that denies the command, or ''. full=false is the older, narrower
 * model of section 2b (prefix and trailing-star glob only).
 * @param {string} f @param {string} c @param {boolean} [full]
 */
function ccDeny(f, c, full = true) {
  for (const r of json(f).permissions?.deny ?? []) {
    if (!r.startsWith('Bash(')) continue;
    const b = r.slice(5, -1);
    if (b.endsWith(':*')) {
      const p = b.slice(0, -2);
      if (c === p || c.startsWith(p + ' ')) return r;
    } else if (!full && b.endsWith('*')) {
      if (c.startsWith(b.slice(0, -1))) return r;
    } else if (full && b.includes('*')) {
      const re = new RegExp('^' + b.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replaceAll('*', '.*') + '$');
      if (re.test(c)) return r;
    } else if (full && c === b) return r;
  }
  return '';
}

test('2b\'\'. Issue #466: the trunk push through git -C <checkout> for the overlay\'s two checkouts', { skip }, () => {
  const s = H + '/.claude/settings.json';
  const miss = [];
  const over = [];
  for (const p of ['/Users/tadeumen/git-reps/tadeumendonca-io', '/Users/tadeumen/git-reps/tadeumendonca-skills']) {
    for (const d of [p, p + '/']) {
      for (const f of ['origin main', 'origin main:main', 'origin main:refs/heads/main', 'origin main --force', 'origin HEAD:main', 'origin HEAD:refs/heads/main',
        'origin refs/heads/main', 'origin +main', 'origin :main', 'origin --delete main', '-u origin main', '-u origin HEAD:main', '--set-upstream origin main',
        '--set-upstream origin HEAD:main', '--all']) {
        if (!ccDeny(s, 'git -C ' + d + ' push ' + f)) miss.push('git -C ' + d + ' push ' + f);
      }
      for (const f of ['push -u origin loop/466-x', 'push origin loop/466-x', 'push origin HEAD:loop/466-x', 'status', 'fetch origin main']) {
        const hit = ccDeny(s, 'git -C ' + d + ' ' + f);
        if (hit) over.push('git -C ' + d + ' ' + f + ' <- ' + hit);
      }
    }
  }
  assert.deepEqual(miss, []);
  assert.deepEqual(over, []);
  const rules = /** @type {string} */ (read(H + '/.codex/rules/workstation-deny-floor.rules'));
  assert.ok(!rules.split('\n').filter((l) => l.startsWith('prefix_rule(')).some((l) => l.includes('"/') || l.includes('"-C"')));
  const kp = /** @type {string} */ (read(H + '/.kiro/settings/permissions.yaml'));
  assert.ok(kp.includes('git -C /Users/tadeumen/git-reps/tadeumendonca-skills/ push origin HEAD:main*'));
  assert.ok(kp.includes('git -C /Users/tadeumen/git-reps/tadeumendonca-io push -u origin main*'));
  const codex = which('codex');
  if (codex) {
    /** @param {string[]} argv */
    const decision = (...argv) => JSON.parse(spawnSync(codex, ['execpolicy', 'check', '--rules', H + '/.codex/rules/workstation-deny-floor.rules', ...argv], { encoding: 'utf8' }).stdout).decision ?? 'none';
    assert.equal(decision('git', '-C', '/Users/tadeumen/git-reps/tadeumendonca-io', 'push', 'origin', 'main'), 'none');
    assert.equal(decision('git', 'push', '--force', 'origin', 'x'), 'forbidden');
    assert.equal(decision('git', 'push', 'origin', 'x'), 'none');
  }
});

test('2c. the paste filter: its settings, one UserPromptSubmit entry for Claude Code, a managed hooks.json for Codex, no LaunchAgent', { skip }, () => {
  assert.ok(!exists(data(H) + '/clipboard_guard.py'), 'the Python core was installed');
  const cc = data(H) + '/clipboard.conf';
  const conf = /** @type {string} */ (read(cc));
  assert.ok(hasLine(conf, 'block_categories=employer-client-term,credential,email,payment-card,cpf,cnpj,phone,health,colleague-name'));
  assert.match(conf, /^notice_blocked=Filtro de colagem/m);
  assert.ok(!exists(data(H) + '/local-overlay'), 'the installer created the local overlay');
  const s = H + '/.claude/settings.json';
  assert.equal(pours(s), 1);
  const want = hookCmd('claude', cc);
  assert.equal(json(s).hooks.UserPromptSubmit.flatMap((/** @type {any} */ g) => g.hooks).filter((/** @type {any} */ x) => x.command === want && x.timeout === 30).length, 1);
  const ch = json(H + '/.codex/hooks.json');
  assert.ok(ch.description.startsWith(MARKER));
  assert.equal(ch.hooks.UserPromptSubmit.flatMap((/** @type {any} */ g) => g.hooks).filter((/** @type {any} */ x) => x.command === hookCmd('codex', cc) && x.type === 'command').length, 1);
  assert.deepEqual(Object.keys(ch.hooks), ['UserPromptSubmit']);
  // The registered commands, run as a harness runs them: a hit blocks, a clean prompt prints nothing.
  const cmd = json(s).hooks.UserPromptSubmit[0].hooks[0].command;
  let out = runPaste(H, cmd, 'deploy with ' + SYNTHETIC_KEY + ' please').stdout;
  const blocked = JSON.parse(out);
  assert.equal(blocked.decision, 'block');
  assert.equal(blocked.hookSpecificOutput.suppressOriginalPrompt, true);
  assert.ok(!out.includes(SYNTHETIC_KEY) && out.includes('REDACTED:credential'));
  assert.equal(runPaste(H, cmd, 'refactor the parser').stdout, '');
  out = runPaste(H, ch.hooks.UserPromptSubmit[0].hooks[0].command, 'deploy with ' + SYNTHETIC_KEY + ' please').stdout;
  const cb = JSON.parse(out);
  assert.equal(cb.decision, 'block');
  assert.ok(!('hookSpecificOutput' in cb) && !out.includes(SYNTHETIC_KEY));
  assert.ok(!exists(H + '/Library/LaunchAgents'), 'a LaunchAgent was written');
});

test('2c\'. the paste wrapper: mhw paste-wrapper, a managed snippet of shell functions', { skip }, () => {
  assert.ok(!exists(data(H) + '/paste_wrapper.py'));
  const sn = data(H) + '/paste-filter.sh';
  const cc = data(H) + '/clipboard.conf';
  const t = /** @type {string} */ (read(sn));
  assert.ok(t.split('\n')[0].startsWith('# ' + MARKER));
  assert.ok(hasLine(t, 'claude() { "' + NODE + '" "' + WRAP_MHW + '" paste-wrapper run --config "' + cc + '" -- claude "$@"; }'));
  assert.equal(t.split('"' + NODE + '" "' + WRAP_MHW + '" paste-wrapper run ').length - 1, 3);
  assert.match(t, /^kiro-cli\(\) /m);
  assert.match(t, /^codex\(\) /m);
  // PR #521 lens A1: when node on PATH is the same file as MHW_NODE, the snippet names node on PATH.
  const nb = dir('node-pin');
  fs.mkdirSync(nb + '/cellar/26.0.0/bin', { recursive: true });
  fs.mkdirSync(nb + '/bin', { recursive: true });
  fs.mkdirSync(nb + '/other', { recursive: true });
  const real = process.execPath;
  fs.symlinkSync(real, nb + '/cellar/26.0.0/bin/node');
  fs.symlinkSync(nb + '/cellar/26.0.0/bin/node', nb + '/bin/node');
  const hn = dir('home-node-same');
  inst(hn, [], { MHW_NODE: nb + '/cellar/26.0.0/bin/node', PATH: nb + '/bin:' + process.env.PATH });
  const same = /** @type {string} */ (read(data(hn) + '/paste-filter.sh'));
  assert.ok(same.includes('claude() { "' + nb + '/bin/node" "' + WRAP_MHW + '" paste-wrapper run '));
  assert.ok(!same.includes(nb + '/cellar'));
  fs.writeFileSync(nb + '/other/node', '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  const hd = dir('home-node-different');
  inst(hd, [], { MHW_NODE: real, PATH: nb + '/other:' + process.env.PATH });
  assert.ok(/** @type {string} */ (read(data(hd) + '/paste-filter.sh')).includes('claude() { "' + real + '" "' + WRAP_MHW + '" paste-wrapper run '));
  // An MHW_NODE that is not an executable file is refused, exit 2: no snippet and no prompt hook written.
  const hx = dir('home-node-refused');
  fs.writeFileSync(nb + '/not-node', 'not a program\n');
  const r = inst(hx, ['--overlay=none'], { MHW_NODE: nb + '/not-node' });
  assert.equal(r.code, 2, r.out);
  assert.ok(!exists(data(hx) + '/paste-filter.sh'));
  assert.ok(r.out.includes('REFUSE  paste filter: MHW_NODE (' + nb + '/not-node) is not an executable file; the hook is not registered'));
  assert.ok(!exists(hx + '/.claude/settings.json') || pours(hx + '/.claude/settings.json') === 0);
  assert.ok(!exists(hx + '/.codex/hooks.json'));
  // An earlier install's Python wrapper (managed) is retired by the next install.
  const hr = dir('home-retire');
  fs.mkdirSync(data(hr), { recursive: true });
  fs.writeFileSync(data(hr) + '/paste_wrapper.py', '#!/usr/bin/python3\n# ' + MARKER + '; source: global/clipboard/paste_wrapper.py\n');
  assert.ok(inst(hr, ['--check']).out.includes('STALE   ' + data(hr) + '/paste_wrapper.py: the Python paste wrapper, replaced by mhw paste-wrapper (Node, #487); install removes it'));
  const ri = inst(hr);
  assert.ok(!exists(data(hr) + '/paste_wrapper.py'));
  assert.ok(ri.out.includes('REMOVED ' + data(hr) + '/paste_wrapper.py (the Python paste wrapper, replaced by mhw paste-wrapper (Node, #487))'));
  // Issue #145: the block goes into the start-up file of $SHELL (zsh here) and nowhere else.
  for (const rc of ['.bashrc', '.bash_profile', '.profile', '.zprofile', '.zshenv']) assert.ok(!exists(H + '/' + rc), rc);
  assert.equal(read(H + '/.zshrc'), blockOf(H));
  assert.ok(!exists(H + '/.zshrc.pmhwc-backup'));
  assert.ok(hasLine(freshOut, 'CHANGED ' + H + '/.zshrc: paste-wrapper start-up block absent -> present (new file); new shells clean pastes'));
  assert.ok(!freshOut.includes('automatic paste cleaning'));
  // The snippet's function, sourced by a real zsh and bash, reaches the real program through the wrapper.
  const fb = dir('fakebin');
  fs.writeFileSync(fb + '/claude', '#!/bin/sh\nprintf "fake-claude:"\nprintf "%s|" "$@"\nexit 5\n', { mode: 0o755 });
  for (const shl of ['zsh', 'bash']) {
    const sh = which(shl);
    if (!sh) continue;
    const p = spawnSync(sh, ['-c', '. "' + sn + '"; claude a \'b c\' < /dev/null'], { encoding: 'utf8', env: { HOME: H, PATH: fb + ':' + process.env.PATH } });
    assert.equal(p.stdout, 'fake-claude:a|b c|', shl);
    assert.equal(p.status, 5, shl);
  }
});

const RC_BEGIN = '# >>> ' + NAME + ': paste wrapper (ADR-0011); managed block, mhw uninstall removes it';
const RC_END = '# <<< ' + NAME + ': paste wrapper';
/** The block install writes for a HOME (no final newline, as $(cat) reads it). @param {string} home */
const block = (home) => RC_BEGIN + '\n[ -r "' + data(home) + '/paste-filter.sh" ] && . "' + data(home) + '/paste-filter.sh"\n' + RC_END;
/** The block, with its final newline (a whole file). @param {string} home */
const blockOf = (home) => block(home) + '\n';
/** $(cat f): the text without its trailing newlines. @param {string} f */
const cat = (f) => (read(f) ?? '').replace(/\n+$/, '');

test('2c\'\'. the shell start-up block, against throwaway rc files only', { skip }, () => {
  const h3 = dir('home-rc');
  const rc = h3 + '/zshrc-throwaway';
  fs.writeFileSync(rc, 'export SYNTHETIC_OWNER_SETTING=1\n# owner line two\n');
  const orig = read(rc);
  let r = inst(h3, ['--dry-run', '--shell-rc=' + rc]);
  assert.equal(r.code, 0);
  assert.equal(read(rc), orig);
  assert.ok(hasLine(r.stdout, 'WOULD CHANGE ' + rc + ': paste-wrapper start-up block absent -> present (backup ' + rc + '.pmhwc-backup):'));
  r = inst(h3, ['--check', '--shell-rc=' + rc]);
  assert.equal(r.code, 1);
  assert.match(r.stdout, new RegExp('^MISSING ' + esc(rc) + ': no paste-wrapper start-up block', 'm'));
  r = inst(h3, ['--shell-rc=' + rc]);
  assert.equal(r.code, 0);
  assert.equal(cat(rc), 'export SYNTHETIC_OWNER_SETTING=1\n# owner line two\n' + block(h3));
  assert.equal(read(rc + '.pmhwc-backup'), orig);
  assert.ok(hasLine(r.stdout, 'CHANGED ' + rc + ': paste-wrapper start-up block absent -> present (previous file kept as ' + rc + '.pmhwc-backup); new shells clean pastes'));
  const once = read(rc);
  r = inst(h3, ['--shell-rc=' + rc]);
  assert.equal(r.code, 0);
  assert.equal(read(rc), once);
  assert.ok(hasLine(r.stdout, 'OK      ' + rc + ' activates the paste wrapper (managed block)'));
  assert.ok(!r.stdout.includes('CHANGED ' + rc));
  assert.equal(inst(h3, ['--check', '--shell-rc=' + rc]).code, 0);
  for (const shl of ['zsh', 'bash']) {
    const sh = which(shl);
    if (!sh) continue;
    const p = spawnSync(sh, ['-c', '. "' + rc + '"; type claude'], { encoding: 'utf8', env: { HOME: h3, PATH: process.env.PATH } });
    assert.match((p.stdout + p.stderr).split('\n')[0], /function/, shl);
  }
  // The owner edits inside the block: it is replaced whole, still once.
  fs.writeFileSync(rc, /** @type {string} */ (read(rc)).replace(' && . ', ' && true ; . '));
  assert.equal(inst(h3, ['--check', '--shell-rc=' + rc]).code, 1);
  r = inst(h3, ['--shell-rc=' + rc]);
  assert.equal(r.code, 0);
  assert.equal(read(rc), once);
  assert.match(r.stdout, new RegExp('^CHANGED ' + esc(rc) + ': paste-wrapper start-up block a different block -> present', 'm'));
  // Uninstall removes exactly the block.
  r = inst(h3, ['--uninstall', '--shell-rc=' + rc]);
  assert.equal(r.code, 0, r.out);
  assert.equal(read(rc), orig);
  assert.ok(hasLine(r.stdout, 'CHANGED ' + rc + ': paste-wrapper start-up block present -> absent (previous file kept as ' + rc + '.pmhwc-backup)'));
  // The earlier one-line form is replaced by the block, once.
  const old = h3 + '/old-form-rc';
  fs.writeFileSync(old, 'export A=1\n[ -r "/old/paste-filter.sh" ] && . "/old/paste-filter.sh"  # ' + NAME + ': paste wrapper (ADR-0011)\nexport B=2\n');
  r = inst(h3, ['--shell-rc=' + old]);
  assert.equal(r.code, 0);
  assert.equal(cat(old), 'export A=1\nexport B=2\n' + block(h3));
  assert.match(r.stdout, new RegExp('^CHANGED ' + esc(old) + ': paste-wrapper start-up block the earlier one-line form -> present', 'm'));
  // The unmarked two-line form an owner added by hand.
  const l2c = '# ' + NAME + ': clean pastes into claude/codex/kiro-cli (ADR-0011)';
  const l2s = '. "$HOME/.local/share/' + NAME + '/paste-filter.sh"';
  const two = h3 + '/two-line-rc';
  fs.writeFileSync(two, 'export A=1\n' + l2c + '\n' + l2s + '\n' + block(h3) + '\nexport B=2\n');
  const twoOrig = read(two);
  r = inst(h3, ['--check', '--shell-rc=' + two]);
  assert.equal(r.code, 1);
  assert.ok(hasLine(r.stdout, 'DRIFT   ' + two + ': paste-wrapper start-up block is sourced twice (an unmarked two-line form beside the block); install replaces it'));
  r = inst(h3, ['--shell-rc=' + two]);
  assert.equal(r.code, 0);
  assert.equal(cat(two), 'export A=1\nexport B=2\n' + block(h3));
  assert.equal(read(two + '.pmhwc-backup'), twoOrig);
  assert.ok(hasLine(r.stdout, 'CHANGED ' + two + ': paste-wrapper start-up block sourced twice (an unmarked two-line form beside the block) -> present (previous file kept as ' + two + '.pmhwc-backup); new shells clean pastes'));
  assert.equal(inst(h3, ['--check', '--shell-rc=' + two]).code, 0);
  // Near misses are the owner's.
  const near = h3 + '/two-line-near-rc';
  fs.writeFileSync(near, l2c + '\nexport C=3\n' + l2s + '\n' + l2c + '\n\n' + l2s + '\n');
  const nearOrig = cat(near);
  r = inst(h3, ['--shell-rc=' + near]);
  assert.equal(r.code, 0);
  assert.equal(cat(near), nearOrig + '\n' + block(h3));
  assert.match(r.stdout, new RegExp('^CHANGED ' + esc(near) + ': paste-wrapper start-up block absent -> present', 'm'));
  // PR #153 lens: a pair that is the whole body of an if is left in place and reported.
  const rif = h3 + '/two-line-if-rc';
  fs.writeFileSync(rif, 'if true; then\n' + l2c + '\n' + l2s + '\nfi\n');
  r = inst(h3, ['--shell-rc=' + rif]);
  assert.equal(r.code, 0);
  assert.deepEqual(/** @type {string} */ (read(rif)).split('\n').slice(1, 3), [l2c, l2s]);
  const bash = which('bash');
  if (bash) assert.equal(spawnSync(bash, ['-n', rif]).status, 0);
  assert.match(r.stdout, new RegExp('^NOTE    ' + esc(rif) + ": an unmarked two-line paste-filter source opens a compound command's body", 'm'));
  // Uninstall over the two-line form alone.
  const twoOnly = h3 + '/two-line-only-rc';
  fs.writeFileSync(twoOnly, 'export A=1\n' + l2c + '\n' + l2s + '\n');
  r = inst(h3, ['--uninstall', '--shell-rc=' + twoOnly]);
  assert.equal(r.code, 0);
  assert.equal(cat(twoOnly), 'export A=1');
  assert.match(r.stdout, new RegExp('^CHANGED ' + esc(twoOnly) + ': paste-wrapper start-up block present -> absent', 'm'));
  // A file with no newline at its end gets one, then the block.
  const nl = h3 + '/no-newline-rc';
  fs.writeFileSync(nl, 'export X=1');
  assert.equal(inst(h3, ['--shell-rc=' + nl]).code, 0);
  assert.equal(cat(nl), 'export X=1\n' + block(h3));
  // Damaged markers are refused, nothing written.
  const bad = h3 + '/damaged-rc';
  fs.writeFileSync(bad, 'x\n' + RC_BEGIN + '\nmine\n');
  const badBefore = read(bad);
  r = inst(h3, ['--shell-rc=' + bad]);
  assert.equal(r.code, 3);
  assert.equal(read(bad), badBefore);
  assert.match(r.stdout, new RegExp('^REFUSE  ' + esc(bad) + ": the paste-wrapper block's markers are damaged", 'm'));
  // A start-up file that is a symbolic link stays one, written through.
  fs.mkdirSync(h3 + '/dotfiles', { recursive: true });
  fs.writeFileSync(h3 + '/dotfiles/zshrc', 'export DOT=1\n');
  fs.symlinkSync(h3 + '/dotfiles/zshrc', h3 + '/link-rc');
  assert.equal(inst(h3, ['--shell-rc=' + h3 + '/link-rc']).code, 0);
  assert.ok(fs.lstatSync(h3 + '/link-rc').isSymbolicLink());
  assert.equal(cat(h3 + '/dotfiles/zshrc'), 'export DOT=1\n' + block(h3));
  const never = h3 + '/never-created-rc';
  r = inst(h3, ['--check', '--shell-rc=' + never]);
  assert.equal(r.code, 1);
  assert.match(r.stdout, new RegExp('^MISSING ' + esc(never), 'm'));
  assert.ok(!exists(never));
  fs.mkdirSync(h3 + '/rc-is-a-dir');
  assert.equal(inst(h3, ['--shell-rc=' + h3 + '/rc-is-a-dir']).code, 3);
  r = inst(h3, ['--shell-rc=relative-rc']);
  assert.equal(r.code, 2);
  assert.ok(!exists(h3 + '/relative-rc'));
  // bash gets ~/.bashrc; uninstall deletes the ~/.bashrc install created.
  const hb = dir('home-bash');
  assert.equal(inst(hb, [], { SHELL: '/bin/bash' }).code, 0);
  assert.equal(read(hb + '/.bashrc'), blockOf(hb));
  assert.ok(!exists(hb + '/.zshrc'));
  assert.equal(inst(hb, ['--uninstall'], { SHELL: '/bin/bash' }).code, 0);
  assert.ok(!exists(hb + '/.bashrc'));
  // A start-up file that is a symbolic link to nothing is refused visibly, and the later steps still run.
  const hdl = dir('home-dangling-rc');
  fs.symlinkSync(hdl + '/missing-dotfiles/zshrc', hdl + '/.zshrc');
  r = inst(hdl);
  assert.equal(r.code, 3);
  assert.ok(hasLine(r.out, 'REFUSE  ' + hdl + '/.zshrc is a symbolic link to a missing file; nothing written. Fix or remove the link, or add this line yourself:'));
  assert.ok(fs.lstatSync(hdl + '/.zshrc').isSymbolicLink() && !exists(hdl + '/missing-dotfiles') && exists(hdl + '/.claude/settings.json'));
  assert.match(r.out, /^FLOOR {3}/m);
  assert.doesNotMatch(r.out, /no such file|cannot create|directory nonexistent/i);
});

test('2c\'\'. the bash login start-up file (macOS) and ZDOTDIR', { skip }, () => {
  const hl = dir('home-bash-login');
  fs.writeFileSync(hl + '/.bash_profile', 'export OWNER_LOGIN=1\n[ -r ~/.bashrc ] && . ~/.bashrc\n', { mode: 0o644 });
  const lsum = read(hl + '/.bash_profile');
  let r = inst(hl, [], { SHELL: '/bin/bash' });
  assert.equal(r.code, 0);
  if (process.platform === 'darwin') {
    assert.equal(cat(hl + '/.bash_profile'), 'export OWNER_LOGIN=1\n[ -r ~/.bashrc ] && . ~/.bashrc\n' + block(hl));
    assert.equal(read(hl + '/.bash_profile.pmhwc-backup'), lsum);
    assert.equal(mode(hl + '/.bash_profile.pmhwc-backup'), '600');
    assert.equal(read(hl + '/.bashrc'), blockOf(hl));
    assert.ok(hasLine(r.stdout, 'CHANGED ' + hl + '/.bash_profile: paste-wrapper start-up block absent -> present (previous file kept as ' + hl + '/.bash_profile.pmhwc-backup); new shells clean pastes'));
    const t = spawnSync('/bin/bash', ['-l', '-c', 'type claude'], { encoding: 'utf8', env: { HOME: hl, PATH: '/usr/bin:/bin' } });
    assert.match((t.stdout + t.stderr).split('\n')[0], /function/);
    assert.equal(inst(hl, ['--check'], { SHELL: '/bin/bash' }).code, 0);
    assert.equal(inst(hl, ['--uninstall'], { SHELL: '/bin/bash' }).code, 0);
    assert.equal(read(hl + '/.bash_profile'), lsum);
    const hl2 = dir('home-bash-login2');
    fs.writeFileSync(hl2 + '/.bash_login', 'export OWNER_BASH_LOGIN=1\n');
    assert.equal(inst(hl2, [], { SHELL: '/bin/bash' }).code, 0);
    assert.ok(!exists(hl2 + '/.bash_profile') && hasLine(/** @type {string} */ (read(hl2 + '/.bash_login')), RC_END));
    const hl3 = dir('home-bash-profile-only');
    fs.writeFileSync(hl3 + '/.profile', 'export OWNER_PROFILE=1\n');
    r = inst(hl3, [], { SHELL: '/bin/bash' });
    assert.equal(r.code, 0);
    assert.equal(read(hl3 + '/.profile'), 'export OWNER_PROFILE=1\n');
    for (const f of ['.profile.pmhwc-backup', '.bash_profile', '.bash_login']) assert.ok(!exists(hl3 + '/' + f), f);
    assert.match(r.stdout, /^NOTE {4}automatic paste cleaning: no bash login start-up file is written \(for a bash login shell: only ~\/\.profile is there/m);
    const hl4 = dir('home-bash-login-none');
    assert.equal(inst(hl4, [], { SHELL: '/bin/bash' }).code, 0);
    assert.equal(read(hl4 + '/.bash_profile'), blockOf(hl4));
    r = inst(hl4, ['--uninstall'], { SHELL: '/bin/bash' });
    assert.equal(r.code, 0);
    assert.ok(!exists(hl4 + '/.bash_profile') && !exists(hl4 + '/.bashrc'));
    assert.ok(hasLine(r.out, 'REMOVED ' + hl4 + '/.bash_profile (install created it and only the paste-wrapper block was in it)'));
    const hl5 = dir('home-bash-login-empty');
    fs.writeFileSync(hl5 + '/.bash_profile', '');
    assert.equal(inst(hl5, [], { SHELL: '/bin/bash' }).code, 0);
    assert.equal(inst(hl5, ['--uninstall'], { SHELL: '/bin/bash' }).code, 0);
    assert.equal(read(hl5 + '/.bash_profile'), '');
  } else {
    assert.equal(read(hl + '/.bash_profile'), lsum);
    assert.ok(!exists(hl + '/.bash_profile.pmhwc-backup'));
  }
  const hz = dir('home-zdotdir');
  fs.mkdirSync(hz + '/zdot');
  assert.equal(inst(hz, [], { ZDOTDIR: hz + '/zdot' }).code, 0);
  assert.ok(exists(hz + '/zdot/.zshrc') && !exists(hz + '/.zshrc'));
  // PR #146 lens H1: an inherited ZDOTDIR outside HOME is never written, by install or by uninstall.
  const hs2 = dir('home-zdot-outside');
  const zs = dir('zdotdir-sentinel');
  fs.writeFileSync(zs + '/.zshrc', 'export OWNER_ZSH=1\n' + block(BASE + '/elsewhere') + '\n');
  const zsum = read(zs + '/.zshrc');
  r = inst(hs2, [], { ZDOTDIR: zs });
  assert.equal(r.code, 0);
  assert.equal(inst(hs2, ['--uninstall'], { ZDOTDIR: zs }).code, 0);
  assert.equal(read(zs + '/.zshrc'), zsum);
  assert.equal(files(zs).length, 1);
  assert.ok(r.out.includes('no shell start-up file is written (ZDOTDIR=' + zs + ' is outside HOME=' + hs2 + ')'));
  for (const c of ['fish', 'none']) {
    const hn = dir('home-noshell-' + c);
    r = c === 'fish' ? inst(hn, [], { SHELL: '/usr/local/bin/fish' }) : inst(hn, ['--shell-rc=none']);
    assert.equal(r.code, 0, c);
    assert.equal(fs.readdirSync(hn).filter((n) => n.startsWith('.') && n.endsWith('rc')).length, 0, c);
    assert.match(r.stdout, /^NOTE {4}automatic paste cleaning: no shell start-up file is written/m);
    assert.ok(r.stdout.includes('. "' + data(hn) + '/paste-filter.sh"'), c);
  }
});

/** A string as a literal regular expression. @param {string} s */
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

test('2d. a managed watcher plist left by an earlier version is removed on install; launchctl never runs', { skip }, () => {
  const h2 = dir('home-oldplist');
  const pl = h2 + '/Library/LaunchAgents/local.' + NAME + '.clipboard-guard.plist';
  fs.mkdirSync(path.dirname(pl), { recursive: true });
  fs.writeFileSync(pl, '<?xml version="1.0" encoding="UTF-8"?>\n<!-- ' + MARKER + '; source: global/install.sh (clipboard guard, ADR-0011); version: 0.7.2 -->\n<plist version="1.0"><dict/></plist>\n');
  const fakebin = dir('fakebin-launchctl');
  const calls = BASE + '/launchctl.calls';
  fs.writeFileSync(fakebin + '/launchctl', '#!/bin/sh\necho launchctl >> "' + calls + '"\n', { mode: 0o755 });
  const PATHX = fakebin + ':' + process.env.PATH;
  let r = inst(h2, ['--check'], { PATH: PATHX });
  assert.equal(r.code, 1);
  assert.match(r.stdout, /^STALE .*clipboard-guard\.plist/m);
  assert.ok(exists(pl));
  r = inst(h2, ['--dry-run'], { PATH: PATHX });
  assert.equal(r.code, 0);
  assert.match(r.stdout, /^WOULD REMOVE .*clipboard-guard\.plist/m);
  assert.ok(exists(pl));
  r = inst(h2, [], { PATH: PATHX });
  assert.equal(r.code, 0);
  assert.ok(!exists(pl));
  assert.ok(r.stdout.includes('launchctl bootout gui/$(id -u)/local.' + NAME + '.clipboard-guard'));
  assert.ok(!exists(calls), 'the installer ran launchctl');
  assert.equal(inst(h2, ['--check']).code, 0);
  fs.writeFileSync(pl, 'my own agent\n');
  r = inst(h2);
  assert.equal(r.code, 0);
  assert.equal(read(pl), 'my own agent\n');
  assert.ok(r.stdout.includes('NOT managed by this project; left alone'));
});

test('3. idempotent re-run', { skip }, () => {
  const before = fingerprint(H);
  assert.equal(inst(H).code, 0);
  assert.deepEqual(fingerprint(H), before);
});

test('4. drift detection, then repair', { skip }, () => {
  fs.appendFileSync(H + '/.codex/AGENTS.md', 'local edit\n');
  assert.equal(inst(H, ['--check']).code, 1);
  assert.equal(inst(H).code, 0);
  assert.equal(inst(H, ['--check']).code, 0);
  const s = H + '/.claude/settings.json';
  /** @param {(d: any) => void} edit */
  const editS = (edit) => {
    const d = json(s);
    edit(d);
    fs.writeFileSync(s, JSON.stringify(d, null, 2) + '\n');
  };
  editS((d) => { d.hooks.PreToolUse = [...(d.hooks.PreToolUse ?? []), { matcher: 'AskUserQuestion', hooks: [{ type: 'command', command: '"' + data(H) + '/hitl-escalation-guard.sh"' }] }]; });
  let r = inst(H, ['--check']);
  assert.equal(r.code, 1);
  assert.match(r.stdout, /^STALE .*settings\.json: the removed HITL picker guard/m);
  assert.equal(inst(H).code, 0);
  assert.equal(ours(s), 0);
  editS((d) => { d.permissions.deny = d.permissions.deny.filter((/** @type {string} */ x) => x !== 'Bash(rm -rf:*)'); });
  r = inst(H, ['--check']);
  assert.equal(r.code, 1);
  assert.ok(r.out.includes('1 deny-floor rule(s) missing'));
  assert.equal(inst(H).code, 0);
  assert.equal(hasRule(s, 'Bash(rm -rf:*)'), 1);
  fs.rmSync(H + '/.codex/rules/workstation-deny-floor.rules');
  assert.equal(inst(H, ['--check']).code, 1);
  inst(H);
  fs.appendFileSync(data(H) + '/clipboard.conf', 'block_categories=email\n');
  assert.equal(inst(H, ['--check']).code, 1);
  inst(H);
  editS((d) => { delete d.hooks.UserPromptSubmit; });
  assert.equal(inst(H, ['--check']).code, 1);
  assert.equal(inst(H).code, 0);
  assert.equal(pours(s), 1);
  const ch = json(H + '/.codex/hooks.json');
  ch.hooks.UserPromptSubmit = [];
  fs.writeFileSync(H + '/.codex/hooks.json', JSON.stringify(ch));
  assert.equal(inst(H, ['--check']).code, 1);
  assert.equal(inst(H).code, 0);
});

test('5. refuse an unmanaged file', { skip }, () => {
  const h = dir('home-unmanaged');
  fs.mkdirSync(h + '/.claude');
  fs.writeFileSync(h + '/.claude/CLAUDE.md', 'my own hand-written brief\n');
  assert.equal(inst(h).code, 3);
  assert.equal(read(h + '/.claude/CLAUDE.md'), 'my own hand-written brief\n');
  assert.equal(inst(h, ['--check']).code, 3);
  // A file is managed only with the marker in its first five lines: on line six it is refused.
  fs.writeFileSync(h + '/.claude/CLAUDE.md', 'a\nb\nc\nd\ne\n<!-- ' + MARKER + ' -->\n');
  const r = inst(h);
  assert.equal(r.code, 3);
  assert.ok(r.out.includes('REFUSE  ' + h + '/.claude/CLAUDE.md: exists and is NOT managed by this project'));
  fs.writeFileSync(h + '/.claude/CLAUDE.md', 'a\nb\nc\nd\n<!-- ' + MARKER + ' -->\n');
  const r5 = inst(h);
  assert.ok(!r5.out.includes('REFUSE  ' + h + '/.claude/CLAUDE.md'), r5.out);
  assert.match(r5.stdout, new RegExp('^WROTE   ' + esc(h) + '/\\.claude/CLAUDE\\.md', 'm'));
});

test('6. merge into an existing settings file keeps everything else', { skip }, () => {
  const h = dir('home-settings');
  fs.mkdirSync(h + '/.claude');
  const s = h + '/.claude/settings.json';
  fs.writeFileSync(s, '{\n    "model" : "some-model",\n    "enabledPlugins" : { "a@b" : true },\n'
    + '    "permissions" : { "allow" : [ "Bash(ls:*)" ], "ask" : [ "Edit(\\/x)" ], "deny" : [ "Bash(my-own-rule:*)", "Bash(rm -rf:*)" ] },\n'
    + '    "hooks" : {\n        "PreToolUse" : [ { "hooks" : [ { "type" : "command", "command" : "\\/opt\\/status" } ] } ],\n'
    + '        "Stop" : [ { "hooks" : [ { "type" : "command", "command" : "\\/opt\\/status" } ] } ]\n    }\n}\n', { mode: 0o600 });
  const orig = json(s);
  let r = inst(h, ['--dry-run']);
  assert.equal(r.code, 0);
  assert.deepEqual(json(s), orig);
  assert.ok(r.out.includes('re-serialized'));
  assert.equal(inst(h).code, 0);
  const d = json(s);
  d.hooks.PreToolUse = d.hooks.PreToolUse.filter((/** @type {any} */ g) => g.hooks.every((/** @type {any} */ x) => !String(x.command).includes(NAME + '/')));
  delete d.hooks.UserPromptSubmit;
  delete d.hooks.SessionStart;
  for (const k of [NAME, NAME + '-owned-deny', NAME + '-owned-allow']) delete d[k];
  delete d.permissions.defaultMode;
  d.permissions.deny = d.permissions.deny.slice(0, 2);
  d.permissions.allow = d.permissions.allow.slice(0, 1);
  assert.deepEqual(d, orig, 'pre-existing content changed');
  const full = json(s);
  const ownAllow = full[NAME + '-owned-allow']?.deny ?? [];
  assert.equal(full.permissions.deny.filter((/** @type {string} */ x) => !ownAllow.includes(x)).length, FLOOR_RULES + 1);
  assert.equal(hasRule(s, 'Bash(rm -rf:*)'), 1);
  assert.equal(hasRule(s, 'Bash(my-own-rule:*)'), 1);
  assert.deepEqual(json(s + '.pmhwc-backup'), orig);
  assert.equal(mode(s), '600');
  const snap = read(s);
  assert.equal(inst(h).code, 0);
  assert.equal(read(s), snap);
  // 7. stale and duplicate entries of the removed picker guard all go; foreign hooks in the same group survive.
  let x = json(s);
  x.hooks.PreToolUse.push({ matcher: 'AskUserQuestion', hooks: [{ type: 'command', command: '/old/path/' + NAME + '/hitl-escalation-guard.sh' }] },
    { matcher: 'AskUserQuestion', hooks: [{ type: 'command', command: '/old2/' + NAME + '/hitl-escalation-guard.sh' }, { type: 'command', command: '/someone/else.sh' }] });
  fs.writeFileSync(s, JSON.stringify(x, null, 2));
  assert.equal(inst(h).code, 0);
  assert.equal(ours(s), 0);
  assert.equal(json(s).hooks.PreToolUse.flatMap((/** @type {any} */ g) => g.hooks).filter((/** @type {any} */ y) => y.command === '/someone/else.sh').length, 1);
  x = json(s);
  x.hooks.UserPromptSubmit.push({ hooks: [{ type: 'command', command: '/usr/bin/python3 /old/' + NAME + '/clipboard_guard.py prompt-hook' }] },
    { hooks: [{ type: 'command', command: '/usr/bin/python3 /old2/' + NAME + '/clipboard_guard.py prompt-hook' }, { type: 'command', command: '/someone/prompt-logger.sh' }] });
  fs.writeFileSync(s, JSON.stringify(x, null, 2));
  assert.equal(inst(h).code, 0);
  assert.equal(pours(s), 1);
  assert.equal(json(s).hooks.UserPromptSubmit.flatMap((/** @type {any} */ g) => g.hooks).filter((/** @type {any} */ y) => y.command === '/someone/prompt-logger.sh').length, 1);
  // 7b. a group that held only a stale entry of ours is removed, not left empty.
  const groups = json(s).hooks.PreToolUse.length;
  x = json(s);
  x.hooks.PreToolUse.push({ matcher: 'AskUserQuestion', hooks: [{ type: 'command', command: '/stale/' + NAME + '/hitl-escalation-guard.sh' }] });
  fs.writeFileSync(s, JSON.stringify(x, null, 2));
  assert.equal(inst(h).code, 0);
  assert.equal(json(s).hooks.PreToolUse.length, groups);
  assert.ok(json(s).hooks.PreToolUse.every((/** @type {any} */ g) => g.hooks.length > 0));
  r = inst(h, ['--check']);
  assert.equal(r.code, 0, r.out);
});

test('8. invalid settings are refused and left untouched', { skip }, () => {
  const h = dir('home-badjson');
  fs.mkdirSync(h + '/.claude');
  fs.writeFileSync(h + '/.claude/settings.json', '{ "model": \n');
  assert.equal(inst(h).code, 3);
  assert.equal(read(h + '/.claude/settings.json'), '{ "model": \n');
});

test('9. --overlay=none renders the generic policy only', { skip }, () => {
  const h = dir('home-generic');
  assert.equal(inst(h, ['--overlay=none']).code, 0);
  assert.doesNotMatch(/** @type {string} */ (read(h + '/.claude/CLAUDE.md')), /^## Owner overlay/m);
  assert.doesNotMatch(/** @type {string} */ (read(data(h) + '/clipboard.conf')), /^notice_blocked=/m);
});

test('9b. a structured profile changed without regeneration is refused before writing any target', { skip }, () => {
  const pd = dir('profile-stale');
  for (const f of ['profile.json', 'AGENTS.md', 'clipboard.conf', 'desktop-instructions.md', 'profile-plan.json']) fs.copyFileSync(path.join(REPO_OVERLAY, f), pd + '/' + f);
  const p = json(pd + '/profile.json');
  p.session_start.priority = 'speed';
  fs.writeFileSync(pd + '/profile.json', JSON.stringify(p, null, 2) + '\n');
  const h = dir('home-profile-stale');
  assert.equal(inst(h, ['--overlay=' + pd]).code, 1);
  assert.deepEqual(files(h), []);
  const g = spawnSync(process.execPath, [MHW, 'profile', 'render', '--source', 'profile.json', '--output', '.'], { cwd: pd, encoding: 'utf8' });
  assert.equal(g.status, 0, g.stderr);
  assert.equal(inst(h, ['--overlay=' + pd]).code, 0);
  assert.ok(/** @type {string} */ (read(h + '/.claude/CLAUDE.md')).includes('Prioritize lower latency'));
  // With no node at all the profile overlay is refused before anything is written.
  const hn = dir('home-profile-no-node');
  const r = inst(hn, ['--dry-run', '--overlay=' + pd], { PATH: '/usr/bin:/bin', MHW_NODE: undefined });
  if (!fs.existsSync('/usr/bin/node') && !fs.existsSync('/bin/node')) {
    assert.equal(r.code, 2, r.out);
    assert.ok(r.out.includes('profile overlay requires node (26 or later); no target was written'));
  }
});

test('10. a permissions section of the wrong shape is refused and left untouched', { skip }, () => {
  const h = dir('home-badperms');
  fs.mkdirSync(h + '/.claude');
  fs.writeFileSync(h + '/.claude/settings.json', '{ "permissions": { "deny": "Bash(rm -rf:*)" } }\n');
  assert.equal(inst(h).code, 3);
  assert.equal(read(h + '/.claude/settings.json'), '{ "permissions": { "deny": "Bash(rm -rf:*)" } }\n');
});

test('11. an overlay adds floor entries; an invalid entry stops the run before anything is written', { skip }, () => {
  const ov = dir('overlay-floor');
  fs.writeFileSync(ov + '/deny-floor.conf', '# owner extra\ncmd terraform destroy\n');
  const h = dir('home-overlay');
  assert.equal(inst(h, ['--overlay=' + ov]).code, 0);
  assert.equal(hasRule(h + '/.claude/settings.json', 'Bash(terraform destroy:*)'), 1);
  assert.ok(hasLine(/** @type {string} */ (read(h + '/.codex/rules/workstation-deny-floor.rules')), 'prefix_rule(pattern=["terraform", "destroy"], decision="forbidden")'));
  let i = 0;
  for (const e of ['cmd rm "-rf"', 'cmd git push --force*', 'path ~/.ssh', 'file ~/a ~/b', 'cmd', 'glob terraform*', 'glob terraform -chdir=*x',
    'glob terraform -c*hdir=*', 'glob terraform -chdir=**', 'glob terraform *', 'glob terraform plan:*']) {
    i++;
    fs.writeFileSync(ov + '/deny-floor.conf', e + '\n');
    const hb = dir('home-badfloor-' + i);
    const r = inst(hb, ['--overlay=' + ov]);
    assert.equal(r.code, 2, e);
    assert.deepEqual(files(hb), [], e);
    assert.match(r.stderr, /^invalid deny-floor entry \(/, e);
  }
});

test('12. XDG_DATA_HOME is honoured: the paste filter and its data go there, and the entries point there', { skip }, () => {
  const h = dir('home-xdg');
  const x = dir('xdg-data');
  assert.equal(inst(h, [], { XDG_DATA_HOME: x }).code, 0);
  const xd = x + '/' + NAME;
  assert.ok(exists(xd + '/clipboard.conf') && !exists(data(h)));
  assert.equal(json(h + '/.claude/settings.json').hooks.UserPromptSubmit.flatMap((/** @type {any} */ g) => g.hooks)
    .filter((/** @type {any} */ y) => String(y.command).includes(xd + '/clipboard.conf')).length, 1);
  assert.ok(/** @type {string} */ (read(h + '/.codex/hooks.json')).includes(xd + '/clipboard.conf'));
  assert.equal(inst(h, ['--check'], { XDG_DATA_HOME: x }).code, 0);
  // CODEX_HOME is honoured the same way: the Codex brief, rules and hooks go there.
  const hc = dir('home-codex-home');
  const ch = dir('codex-home');
  assert.equal(inst(hc, [], { CODEX_HOME: ch }).code, 0);
  for (const f of ['AGENTS.md', 'rules/workstation-deny-floor.rules', 'hooks.json']) assert.ok(exists(ch + '/' + f), f);
  assert.ok(!exists(hc + '/.codex/AGENTS.md'));
  assert.equal(inst(hc, ['--check'], { CODEX_HOME: ch }).code, 0);
});

test('12b. #488: an install over an earlier release retires the Python core and names a Keychain-salted term list', { skip }, () => {
  const h = dir('home-488');
  fs.mkdirSync(data(h) + '/local-overlay', { recursive: true });
  fs.mkdirSync(h + '/.claude');
  fs.writeFileSync(data(h) + '/clipboard_guard.py', '#!/usr/bin/python3\n# ' + MARKER + '; source: global/clipboard/clipboard_guard.py; release: v1.0.0; commit: x; do not edit, re-run the installer\n');
  fs.writeFileSync(h + '/.claude/settings.json', JSON.stringify({ hooks: { UserPromptSubmit: [{ hooks: [{ type: 'command', command: '/usr/bin/python3 -I -B /x/' + NAME + '/clipboard_guard.py prompt-hook --harness claude' }] }] } }) + '\n');
  fs.writeFileSync(data(h) + '/local-overlay/clipboard-terms', '# header\n' + 'ab'.repeat(32) + '\n');
  const r = inst(h);
  assert.equal(r.code, 0, r.out);
  assert.ok(!exists(data(h) + '/clipboard_guard.py'));
  assert.match(r.out, /^REMOVED .*clipboard_guard\.py \(the Python prompt hook core/m);
  assert.equal(pours(h + '/.claude/settings.json'), 1);
  const want = hookCmd('claude', data(h) + '/clipboard.conf');
  assert.equal(json(h + '/.claude/settings.json').hooks.UserPromptSubmit.flatMap((/** @type {any} */ g) => g.hooks).filter((/** @type {any} */ y) => y.command === want).length, 1);
  assert.match(r.out, /^SKIP {4}.*clipboard-terms: its hashes were made with the macOS Keychain salt, which mhw no longer reads \(#488\); nothing was migrated/m);
  assert.ok(!exists(data(h) + '/local-overlay/clipboard-salt'));
});

test('13. a data path the hook command cannot quote safely: the paste filter is refused, not mis-quoted', { skip }, () => {
  const h = dir('home-quote');
  const x = dir('xdg-q"uote');
  fs.mkdirSync(h + '/.claude');
  fs.writeFileSync(h + '/.claude/settings.json', JSON.stringify({ hooks: { UserPromptSubmit: [{ hooks: [{ type: 'command', command: '/usr/bin/python3 /old/' + NAME + '/clipboard_guard.py prompt-hook' }] }] } }) + '\n');
  const r = inst(h, [], { XDG_DATA_HOME: x });
  assert.equal(r.code, 2, r.out);
  assert.match(r.out, /^REFUSE {2}paste filter/m);
  assert.ok(!exists(h + '/.codex/hooks.json'));
  assert.equal(pours(h + '/.claude/settings.json'), 0);
});

test('14. --hooks=managed: the user layer drops every hook entry of ours and the Codex hooks.json', { skip }, () => {
  const h = dir('home-managed');
  fs.mkdirSync(h + '/.claude');
  fs.writeFileSync(h + '/.claude/settings.json', JSON.stringify({ hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: '/foreign/guard.sh' }] }] } }) + '\n');
  assert.equal(inst(h).code, 0);
  assert.equal(inst(h, ['--check', '--hooks=managed']).code, 1);
  const r = inst(h, ['--hooks=managed']);
  assert.equal(r.code, 0, r.out);
  const s = h + '/.claude/settings.json';
  assert.equal(ours(s), 0);
  assert.equal(pours(s), 0);
  assert.ok(!/** @type {string} */ (read(s)).includes(NAME + '/restart_guard.py'));
  assert.ok(!exists(h + '/.codex/hooks.json'));
  assert.match(r.out, /^REMOVED .*hooks\.json/m);
  assert.equal(json(s).hooks.PreToolUse.flatMap((/** @type {any} */ g) => g.hooks).filter((/** @type {any} */ y) => y.command === '/foreign/guard.sh').length, 1);
  assert.ok(json(s).permissions.deny.includes('Bash(sudo:*)'));
  assert.ok(exists(h + '/.claude/CLAUDE.md') && exists(data(h) + '/clipboard.conf'));
  assert.equal(inst(h, ['--check', '--hooks=managed']).code, 0);
  assert.equal(inst(h, ['--check']).code, 1);
});

/** The release and commit of a file's stamp (settings: our key). @param {string} f */
function stampIn(f) {
  const text = f.endsWith('/settings.json') ? String(json(f)[NAME] ?? '') : (/** @type {string} */ (read(f)).split('\n').find((l) => l.includes(MARKER)) ?? '');
  const m = /.*; (release: [^;"]*; commit: [^;"]*);/.exec(text);
  return m ? m[1] : '';
}

test('15. the provenance stamp: every rendered file names the release and commit it came from', { skip }, () => {
  const hs = dir('stamp');
  const r = inst(hs);
  assert.equal(r.code, 0, r.out);
  const src = (r.stdout.split('\n').find((l) => l.startsWith('SOURCE  ')) ?? '').slice('SOURCE  '.length);
  const git = which('git');
  const head = git ? spawnSync(git, ['-C', ROOT, 'rev-parse', '--verify', 'HEAD'], { encoding: 'utf8' }).stdout.trim() : 'unknown';
  if (head && spawnSync(/** @type {string} */ (git), ['-C', ROOT, 'rev-parse', '--show-toplevel'], { encoding: 'utf8' }).stdout.trim() === fs.realpathSync(ROOT)) {
    assert.match(src, new RegExp('^release: .*; commit: ' + head + '(-dirty)?$'));
  }
  assert.deepEqual(targets(hs).filter((f) => stampIn(f) !== src), []);
  const c0 = inst(hs, ['--check']);
  assert.equal(c0.code, 0);
  assert.ok(c0.stdout.split('\n').filter((l) => /^OK .*release: /.test(l)).length >= targets(hs).length);
  const other = '0123456789abcdef0123456789abcdef01234567';
  for (const f of [hs + '/.claude/CLAUDE.md', hs + '/.codex/hooks.json', hs + '/.claude/settings.json']) {
    fs.writeFileSync(f, /** @type {string} */ (read(f)).replace(/; commit: [^;"]*;/, '; commit: ' + other + ';'));
  }
  const c1 = inst(hs, ['--check']);
  assert.equal(c1.code, 1);
  assert.equal(c1.stdout.split('\n').filter((l) => new RegExp('^STAMP .*commit: ' + other).test(l)).length, 3, c1.out);
  assert.doesNotMatch(c1.stdout, /^DRIFT/m);
  assert.equal(inst(hs).code, 0);
  assert.equal(inst(hs, ['--check']).code, 0);
  fs.appendFileSync(data(hs) + '/clipboard.conf', 'x\n');
  const c2 = inst(hs, ['--check']);
  assert.equal(c2.code, 1);
  assert.match(c2.stdout, /^DRIFT .*clipboard\.conf/m);
});

test('15b. which release a stamp names: the tag rule, in a throwaway git repository', { skip: skip || (!which('git') && 'needs git') }, () => {
  const tr = dir('tagrepo');
  for (const d of ['global', 'overlay', 'bin', 'src', '.bumpversion.toml', 'package.json', 'method']) fs.cpSync(path.join(ROOT, d), path.join(tr, d), { recursive: true });
  const git = /** @type {string} */ (which('git'));
  /** @param {string[]} a */
  const g = (...a) => spawnSync(git, ['-C', tr, '-c', 'user.name=t', '-c', 'user.email=t@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'tag.gpgSign=false', ...a], { encoding: 'utf8' });
  const home = dir('tag-home');
  const stamp = () => {
    const p = spawnSync(process.execPath, [path.join(tr, 'bin', 'mhw.js'), 'install-user', '--dry-run', '--overlay=none', '--managed-root=' + path.join(BASE, 'no-admin')],
      { encoding: 'utf8', env: { PATH: process.env.PATH || '', HOME: home, LANG: 'C', TMPDIR: dir('tmp') } });
    return (p.stdout.split('\n').find((l) => l.startsWith('SOURCE  ')) ?? '').slice('SOURCE  '.length);
  };
  g('-c', 'init.defaultBranch=main', 'init', '-q');
  g('add', '-A');
  g('commit', '-qm', 'one');
  const c1 = g('rev-parse', 'HEAD').stdout.trim();
  assert.equal(stamp(), 'release: unreleased, no tag reachable; commit: ' + c1);
  g('tag', 'v9.8.7');
  assert.equal(stamp(), 'release: v9.8.7; commit: ' + c1);
  fs.appendFileSync(tr + '/global/clipboard.conf', '# local edit\n');
  assert.equal(stamp(), 'release: unreleased, after v9.8.7; commit: ' + c1 + '-dirty');
  g('commit', '-qam', 'two');
  const c2 = g('rev-parse', 'HEAD').stdout.trim();
  assert.equal(stamp(), 'release: unreleased, after v9.8.7; commit: ' + c2);
  // A tag that is not purely numeric is never a release (ADR-0002): when it is the nearest, the stamp says
  // no tag is reachable, as install.sh's did (git describe returns it, and it fails the numeric test).
  g('tag', 'v9.9.0-rc1');
  assert.equal(stamp(), 'release: unreleased, no tag reachable; commit: ' + c2);
  // Outside a git checkout, the fields come from .workstation-archive, taken only in exactly its shape.
  const ar = dir('archive-tree');
  for (const d of ['global', 'bin', 'src', '.bumpversion.toml', 'package.json', 'method']) fs.cpSync(path.join(tr, d), path.join(ar, d), { recursive: true });
  const archStamp = () => {
    const p = spawnSync(process.execPath, [path.join(ar, 'bin', 'mhw.js'), 'install-user', '--dry-run', '--overlay=none', '--managed-root=' + path.join(BASE, 'no-admin')],
      { encoding: 'utf8', env: { PATH: process.env.PATH || '', HOME: home, LANG: 'C', TMPDIR: dir('tmp') } });
    return (p.stdout.split('\n').find((l) => l.startsWith('SOURCE  ')) ?? '').slice('SOURCE  '.length);
  };
  const sha = 'a'.repeat(40);
  const version = /current_version\s*=\s*"([0-9.]+)"/.exec(/** @type {string} */ (read(ar + '/.bumpversion.toml')))?.[1];
  for (const [describe, want] of [['v1.2.3', 'release: v1.2.3; commit: ' + sha], ['v1.2.3-4-gabc1234', 'release: unreleased, after v1.2.3; commit: ' + sha],
    ['', 'release: unreleased, no tag reachable; commit: ' + sha], ['$Format:%(describe)$', 'release: unknown, not a git checkout (.bumpversion.toml says ' + version + '); commit: unknown']]) {
    fs.writeFileSync(ar + '/.workstation-archive', 'commit: ' + sha + '\ndescribe: ' + describe + '\n');
    assert.equal(archStamp(), want, describe);
  }
  fs.writeFileSync(ar + '/.workstation-archive', 'commit: $Format:%H$\n');
  assert.equal(archStamp(), 'release: unknown, not a git checkout (.bumpversion.toml says ' + version + '); commit: unknown');
});

test('16. --check reports which layer carries the deny floor; the report never changes the exit status', { skip }, () => {
  const hf = dir('floor-layer');
  const mr = dir('floor-root');
  assert.equal(inst(hf, ['--managed-root=' + mr]).code, 0);
  let r = inst(hf, ['--check', '--managed-root=' + mr]);
  assert.equal(r.code, 0);
  assert.match(r.out, new RegExp('^FLOOR {3}Claude Code: user layer ' + FLOOR_RULES + '/' + FLOOR_RULES + ' rules; admin layer 0/' + FLOOR_RULES + ' rules', 'm'));
  assert.match(r.out, /^FLOOR {3}carried by: the user layer only/m);
  const mgr = path.join(ROOT, 'global', 'install-managed.sh');
  const tmp = dir('tmp-mgr');
  const render = spawnSync('/bin/sh', [mgr, '--root=' + mr], { encoding: 'utf8', env: { PATH: process.env.PATH || '', HOME: hf, TMPDIR: tmp, LANG: 'C' } });
  const line = (render.stdout + render.stderr).split('\n').find((l) => l.startsWith('RUN     ')) ?? '';
  const stage = /--apply="([^"]*)"/.exec(line)?.[1];
  const sha = /--sha256=([0-9a-f]*)/.exec(line)?.[1];
  const apply = spawnSync('/bin/sh', [mgr, '--apply=' + stage, '--sha256=' + sha, '--root=' + mr], { encoding: 'utf8', env: { PATH: process.env.PATH || '', TMPDIR: tmp, LANG: 'C' } });
  assert.equal(apply.status, 0, apply.stdout + apply.stderr);
  r = inst(hf, ['--check', '--managed-root=' + mr]);
  assert.equal(r.code, 0);
  assert.ok(r.out.includes('admin layer ' + FLOOR_RULES + '/' + FLOOR_RULES + ' rules'));
  assert.ok(r.out.includes('admin requirements ' + FLOOR_CMDS + '/' + FLOOR_CMDS + ' prefix rules'));
  assert.match(r.out, /^FLOOR {3}carried by: the admin layer/m);
  const drop = process.platform === 'darwin' ? mr + '/Library/Application Support/ClaudeCode/managed-settings.d/50-' + NAME + '.json'
    : mr + '/etc/claude-code/managed-settings.d/50-' + NAME + '.json';
  const dd = json(drop);
  dd.permissions.deny = dd.permissions.deny.filter((/** @type {string} */ x) => x !== 'Bash(sudo:*)');
  fs.writeFileSync(drop, JSON.stringify(dd, null, 2));
  r = inst(hf, ['--check', '--managed-root=' + mr]);
  assert.ok(r.out.includes('admin layer ' + (FLOOR_RULES - 1) + '/' + FLOOR_RULES + ' rules'));
  assert.match(r.out, /^FLOOR {3}carried by: the user layer; the admin copy is INCOMPLETE/m);
  const req = mr + '/etc/codex/requirements.toml';
  fs.writeFileSync(req, /** @type {string} */ (read(req)).split('\n').filter((l) => !l.includes('{ token = "sudo" }]')).join('\n'));
  r = inst(hf, ['--check', '--managed-root=' + mr]);
  assert.ok(r.out.includes('admin requirements ' + (FLOOR_CMDS - 1) + '/' + FLOOR_CMDS + ' prefix rules'));
});

test('17. the session-start model defaults, through the installer with the repository overlay', { skip }, () => {
  const policy = json(path.join(REPO_OVERLAY, 'model-defaults.json'));
  const hm = dir('home-models');
  fs.mkdirSync(hm + '/.claude');
  fs.writeFileSync(hm + '/.claude/settings.json', '{"theme": "dark"}\n');
  const ov = ['--overlay=' + REPO_OVERLAY];
  assert.equal(inst(hm, ov).code, 0);
  let s = json(hm + '/.claude/settings.json');
  assert.equal(s.model, policy['claude-code'].model);
  assert.equal(s.effortLevel, policy['claude-code'].effort);
  assert.equal(s.theme, 'dark');
  const toml = /** @type {string} */ (read(hm + '/.codex/config.toml'));
  assert.ok(hasLine(toml, 'model = "' + policy.codex.model + '"'));
  assert.ok(hasLine(toml, 'model_reasoning_effort = "' + policy.codex.effort + '"'));
  assert.equal(json(hm + '/.kiro/settings/cli.json')['chat.defaultModel'], policy['kiro-cli'].model);
  assert.equal(inst(hm, ['--check', ...ov]).code, 0);
  s.model = 'opus[1m]';
  fs.writeFileSync(hm + '/.claude/settings.json', JSON.stringify(s, null, 2) + '\n');
  const pinned = policy['claude-code'].model;
  let r = inst(hm, ['--check', ...ov]);
  assert.equal(r.code, 1);
  assert.ok(r.out.includes('DRIFT   ' + hm + '/.claude/settings.json: install would change model "opus[1m]" -> "' + pinned + '"'));
  assert.doesNotMatch(r.out, /^KEPT/m);
  r = inst(hm, ov);
  assert.equal(r.code, 0);
  assert.equal(json(hm + '/.claude/settings.json').model, pinned);
  assert.ok(r.out.includes('CHANGED ' + hm + '/.claude/settings.json: model "opus[1m]" -> "' + pinned + '"'));
  assert.ok(!r.out.includes('Delete the key'));
  assert.equal(inst(hm, ['--check', ...ov]).code, 0);
  inst(hm, ['--uninstall']);
  s = json(hm + '/.claude/settings.json');
  assert.deepEqual({ model: s.model, effortLevel: s.effortLevel ?? null, theme: s.theme }, { model: 'opus[1m]', effortLevel: null, theme: 'dark' });
  assert.doesNotMatch(/** @type {string} */ (read(hm + '/.codex/config.toml')), /^model/m);
  assert.equal(json(hm + '/.kiro/settings/cli.json')['chat.defaultModel'], undefined);
  const hm2 = dir('home-models-owner');
  fs.mkdirSync(hm2 + '/.claude');
  fs.mkdirSync(hm2 + '/.codex');
  fs.writeFileSync(hm2 + '/.claude/settings.json', '{"theme": "dark", "model": "opus[1m]"}\n');
  fs.writeFileSync(hm2 + '/.codex/config.toml', 'model_reasoning_effort = "high"\n');
  r = inst(hm2, ov);
  assert.equal(r.code, 0);
  assert.equal(json(hm2 + '/.claude/settings.json').model, pinned);
  assert.ok(hasLine(/** @type {string} */ (read(hm2 + '/.codex/config.toml')), 'model_reasoning_effort = "' + policy.codex.effort + '"'));
  assert.ok(r.out.includes('model_reasoning_effort "high" -> '));
  inst(hm2, ['--uninstall']);
  s = json(hm2 + '/.claude/settings.json');
  assert.deepEqual({ model: s.model, theme: s.theme }, { model: 'opus[1m]', theme: 'dark' });
  assert.ok(hasLine(/** @type {string} */ (read(hm2 + '/.codex/config.toml')), 'model_reasoning_effort = "high"'));
});

test('18. the user-level allow entries the policy retired are removed with a backup, old -> new', { skip }, () => {
  const ha = dir('home-allow-retired');
  fs.mkdirSync(ha + '/.claude');
  const s = ha + '/.claude/settings.json';
  fs.writeFileSync(s, JSON.stringify({ permissions: { allow: ['Bash(ls:*)', 'Bash(find:*)', 'Bash(awk:*)', 'Bash(find *)', 'Bash(find*)', 'Bash(awk *)', 'Bash(awk*)', 'Bash(gawk:*)', 'Bash(findmnt:*)', 'Bash(find)', 'Bash(awk)'] }, theme: 'dark' }) + '\n');
  const seed = read(s);
  const what = 'Bash(awk *) present -> absent; Bash(awk*) present -> absent; Bash(awk:*) present -> absent; Bash(find *) present -> absent; Bash(find*) present -> absent; Bash(find:*) present -> absent';
  const kept = ['Bash(ls:*)', 'Bash(gawk:*)', 'Bash(findmnt:*)', 'Bash(find)', 'Bash(awk)'];
  let r = inst(ha, ['--check']);
  assert.equal(r.code, 1);
  assert.ok(r.out.includes('DRIFT   ' + s + ': install would change permissions.allow ' + what));
  inst(ha, ['--dry-run']);
  assert.equal(read(s), seed);
  r = inst(ha);
  assert.equal(r.code, 0);
  /** @param {string[]} l */
  const pick = (l) => l.filter((x) => /^Bash\((ls|find|awk|gawk)/.test(x));
  assert.deepEqual(pick(json(s).permissions.allow), kept);
  assert.equal(json(s).theme, 'dark');
  assert.equal(json(s + '.pmhwc-allow-backup').permissions.allow.filter((/** @type {string} */ x) => /^Bash\((find|awk)/.test(x)).length, 9);
  assert.ok(r.out.includes('CHANGED ' + s + ': permissions.allow ' + what + ' (retired, ADR-0035 decision 4; previous file kept as ' + s + '.pmhwc-allow-backup)'));
  assert.equal(inst(ha, ['--check']).code, 0);
  r = inst(ha);
  assert.doesNotMatch(r.out, /^CHANGED .*permissions\.allow/m);
  r = inst(ha, ['--uninstall']);
  assert.deepEqual(json(s).permissions.allow, kept);
  assert.ok(r.out.includes('NOTE    ' + s + ': the allow entries the policy retired are in ' + s + '.pmhwc-allow-backup'));
});

test('19. the retired-server removal is gone: an aws-api table stays, no MCP backup, no value printed', { skip }, () => {
  const hc = dir('home-mcp-retired');
  fs.mkdirSync(hc + '/.codex');
  const canary = 'canary-' + 'value-' + '7311';
  fs.writeFileSync(hc + '/.codex/config.toml', 'approval_policy = "on-request"\n\n[mcp_servers.aws-api]\ncommand = "uvx"\n\n[mcp_servers.aws-api.env]\nAWS_PROFILE = "' + canary + '"\n\n[mcp_servers.keep]\ncommand = "keep"\n', { mode: 0o600 });
  const r = inst(hc);
  assert.equal(r.code, 0, r.out);
  const t = /** @type {string} */ (read(hc + '/.codex/config.toml'));
  assert.ok(hasLine(t, '[mcp_servers.aws-api]') && hasLine(t, '[mcp_servers.keep]'));
  assert.ok(!exists(hc + '/.codex/config.toml.pmhwc-mcp-backup'));
  assert.ok(!r.out.includes('aws-api') && !r.out.includes(canary));
});

test('19b. the policy MCP server: chrome-devtools in ~/.claude.json, old -> new, an 0600 backup, removed on uninstall', { skip }, () => {
  const hp = dir('home-mcp-policy');
  fs.mkdirSync(hp + '/.claude');
  fs.writeFileSync(hp + '/.claude.json', JSON.stringify({ numStartups: 2, mcpServers: { mine: { command: '/bin/echo' } } }) + '\n', { mode: 0o644 });
  const seed = read(hp + '/.claude.json');
  let r = inst(hp);
  assert.equal(r.code, 0);
  assert.ok(r.out.includes('CHANGED ' + hp + '/.claude.json: chrome-devtools absent -> /bin/sh -c '));
  const arg = json(hp + '/.claude.json').mcpServers['chrome-devtools'].args[1];
  assert.ok(arg.includes('--autoConnect') && !arg.includes('--allowedUrlPattern'));
  assert.equal(json(hp + '/.claude.json').mcpServers.mine.command, '/bin/echo');
  assert.equal(read(hp + '/.claude.json.pmhwc-mcp-policy-backup'), seed);
  assert.equal(mode(hp + '/.claude.json.pmhwc-mcp-policy-backup'), '600');
  assert.equal(inst(hp, ['--check']).code, 0);
  r = inst(hp, ['--uninstall']);
  assert.equal(r.code, 0);
  assert.ok(!('chrome-devtools' in json(hp + '/.claude.json').mcpServers));
  assert.equal(json(hp + '/.claude.json').mcpServers.mine.command, '/bin/echo');
  assert.match(r.out, new RegExp('CHANGED ' + esc(hp) + '/\\.claude\\.json: chrome-devtools .* -> absent'));
});

test('19d. Chrome\'s remote-debugging key, through the installer: an on key is reported OK and untouched', { skip }, () => {
  const hc = dir('home-chrome-debugging');
  const hcl = process.platform === 'darwin' ? hc + '/Library/Application Support/Google/Chrome/Local State' : hc + '/.config/google-chrome/Local State';
  fs.mkdirSync(path.dirname(hcl), { recursive: true });
  fs.writeFileSync(hcl, '{"devtools":{"remote_debugging":{"user-enabled":true}},"other":1}');
  let r = inst(hc);
  assert.equal(r.code, 0);
  assert.ok(r.out.includes('OK      ' + hcl + ': devtools.remote_debugging.user-enabled = true (Chrome remote debugging)'));
  assert.equal(read(hcl), '{"devtools":{"remote_debugging":{"user-enabled":true}},"other":1}');
  r = inst(hc, ['--check']);
  assert.equal(r.code, 0);
  assert.ok(r.out.includes('OK      ' + hcl + ': devtools.remote_debugging.user-enabled = true (Chrome remote debugging)'));
});

test('19c. the MCP active set, through the installer', { skip }, () => {
  const ha = dir('home-mcp-active');
  fs.mkdirSync(ha + '/.codex');
  fs.mkdirSync(data(ha) + '/local-overlay', { recursive: true });
  fs.writeFileSync(ha + '/.codex/config.toml', '[mcp_servers.set-a]\ncommand = "/bin/echo"\n\n[mcp_servers.out-b]\ncommand = "/bin/echo"\n');
  const seed = read(ha + '/.codex/config.toml');
  const def = data(ha) + '/local-overlay/mcp-servers.json';
  fs.writeFileSync(def, '{"version": 1, "servers": {"set-a": {"command": "/bin/echo"}}}\n');
  let r = inst(ha);
  assert.equal(r.code, 0);
  assert.equal(read(ha + '/.codex/config.toml'), seed);
  assert.ok(r.out.includes('SKIP    MCP active set: not declared'));
  fs.writeFileSync(def, '{"version": 1, "servers": {"set-a": {"command": "/bin/echo"}}, "active_set": {}}\n');
  assert.equal(inst(ha, ['--check']).code, 1);
  r = inst(ha);
  assert.equal(r.code, 0);
  assert.ok(r.out.includes('CHANGED codex: turned off out-b (1)'));
  assert.ok(hasLine(/** @type {string} */ (read(ha + '/.codex/config.toml')), 'enabled = false  # ' + MARKER + ' (mcp active set)'));
  assert.equal(inst(ha, ['--check']).code, 0);
  r = inst(ha, ['--uninstall']);
  assert.equal(r.code, 0);
  assert.equal(read(ha + '/.codex/config.toml'), seed);
  assert.ok(r.out.includes('turned back on out-b (1)'));
});

test('20. uninstall after a default install gives the owner\'s ~/.zshrc back byte for byte', { skip }, () => {
  const hu = dir('home-uninstall-rc');
  fs.writeFileSync(hu + '/.zshrc', 'export MINE=1\nalias ll="ls -l"\n');
  const z = read(hu + '/.zshrc');
  assert.equal(inst(hu).code, 0);
  const t = /** @type {string} */ (read(hu + '/.zshrc'));
  assert.ok(hasLine(t, RC_BEGIN) && t.split(RC_END).length === 2);
  assert.equal(inst(hu, ['--uninstall']).code, 0);
  assert.equal(read(hu + '/.zshrc'), z);
});

test('21. every backup of a harness config the installer writes is owner-only (0600)', { skip }, () => {
  const hb = dir('home-backups');
  fs.mkdirSync(hb + '/.claude');
  fs.mkdirSync(hb + '/.codex');
  fs.writeFileSync(hb + '/.claude/settings.json', '{"model": "owner-model", "permissions": {"allow": ["Bash(find:*)"]}}\n', { mode: 0o644 });
  fs.writeFileSync(hb + '/.codex/config.toml', 'model_reasoning_effort = "high"\n', { mode: 0o644 });
  fs.writeFileSync(hb + '/.zshrc', 'export MINE=1\n', { mode: 0o644 });
  assert.equal(inst(hb, ['--overlay=' + REPO_OVERLAY]).code, 0);
  const backups = files(hb).filter((f) => /\.pmhwc-.*backup$/.test(f));
  assert.equal(backups.length, 5, backups.join(' '));
  assert.deepEqual(backups.filter((b) => mode(b) !== '600'), []);
});

test('22. the uninstall backup of ~/.claude/settings.json is owner-only too', { skip }, () => {
  const hu = dir('home-uninstall-backup');
  assert.equal(inst(hu).code, 0);
  fs.chmodSync(hu + '/.claude/settings.json', 0o644);
  fs.rmSync(hu + '/.claude/settings.json.pmhwc-backup', { force: true });
  const r = inst(hu, ['--uninstall']);
  assert.equal(r.code, 0);
  const ub = hu + '/.claude/settings.json.pmhwc-backup';
  assert.equal(mode(ub), '600');
  assert.ok(json(ub)[NAME] !== undefined);
  assert.match(r.out, /^UNMERGED /m);
});

test('23. the README states each #145 behaviour still carried', () => {
  const readme = /** @type {string} */ (read(path.join(ROOT, 'README.md')));
  for (const needle of ['install writes the pin over any value', 'uninstall restores the value it replaced',
    'install also removes the user-level `Bash(find:*)` and `Bash(awk:*)`', 'one marked block that sources it in the start-up file', '`mhw uninstall` removes exactly']) {
    assert.ok(readme.includes(needle), needle);
  }
});

test('24. the Kiro deny floor merges beside the owner\'s rule; uninstall takes back only what it added', { skip }, () => {
  const hk = dir('kiro');
  fs.mkdirSync(hk + '/.kiro/settings', { recursive: true });
  const kp = hk + '/.kiro/settings/permissions.yaml';
  fs.writeFileSync(kp, 'rules:\n  - capability: shell\n    match:\n      - git *\n    effect: allow\n');
  let r = inst(hk);
  assert.equal(r.code, 0);
  assert.match(r.out, new RegExp('^MERGED  ' + esc(kp) + ' \\(', 'm'));
  const t = /** @type {string} */ (read(kp));
  assert.ok(t.includes('"git *"') && t.includes('"sudo *"') && t.includes('"~/.ssh/id_*"'));
  assert.equal(mode(kp + '.pmhwc-backup'), '600');
  r = inst(hk, ['--check']);
  assert.equal(r.code, 0);
  assert.match(r.out, new RegExp('^OK      ' + esc(kp) + ' \\(all [0-9]* deny-floor patterns present', 'm'));
  assert.match(r.out, /^FLOOR {3}Kiro: user permissions\.yaml ([0-9]+)\/\1 floor patterns/m);
  r = inst(hk, ['--uninstall']);
  assert.equal(r.code, 0);
  const after_ = /** @type {string} */ (read(kp));
  assert.ok(after_.includes('"git *"') && !after_.includes('sudo'));
  assert.ok(!exists(data(hk) + '/kiro-permissions-owned.json'));
});

test('24. Kiro CLI V3\'s user-level prompt hook: one managed file, run as Kiro runs it', { skip }, () => {
  const hh = dir('kirohook');
  const kh = hh + '/.kiro/hooks/' + NAME + '-paste-filter.json';
  let r = inst(hh);
  assert.equal(r.code, 0);
  const want = hookCmd('kiro', data(hh) + '/clipboard.conf');
  const doc = json(kh);
  assert.equal(doc.version, 'v1');
  assert.equal(doc.hooks.length, 1);
  assert.ok(doc.hooks[0].description.startsWith(MARKER + '; source: global/install.sh'));
  assert.equal(doc.hooks[0].trigger, 'UserPromptSubmit');
  assert.deepEqual(doc.hooks[0].action, { type: 'command', command: want });
  assert.equal(doc.hooks[0].timeout, 30);
  assert.ok(doc.hooks[0].name.length > 0);
  assert.ok(/** @type {string} */ (read(kh)).split('\n').slice(0, 5).some((l) => l.includes(MARKER)));
  const cmd = doc.hooks[0].action.command;
  let p = runPaste(hh, cmd, 'deploy with ' + SYNTHETIC_KEY + ' please', { PMHWC_PASTE_WRAPPER: '1' });
  assert.equal(p.status, 2);
  assert.equal(p.stdout, '');
  assert.ok(p.stderr.includes('REDACTED:credential') && !p.stderr.includes(SYNTHETIC_KEY));
  p = runPaste(hh, cmd, 'refactor the parser');
  assert.deepEqual([p.status, p.stdout, p.stderr], [0, '', '']);
  p = spawnSync('/bin/sh', ['-c', cmd], { input: 'not json', encoding: 'utf8', env: { PATH: process.env.PATH || '', HOME: hh } });
  assert.deepEqual([p.status, p.stdout], [0, '']);
  r = inst(hh, ['--check']);
  assert.equal(r.code, 0);
  assert.match(r.out, new RegExp('^OK      ' + esc(kh) + ' \\(', 'm'));
  r = inst(hh);
  assert.match(r.out, new RegExp('^OK      ' + esc(kh) + ' \\(', 'm'));
  assert.ok(!exists(kh + '.pmhwc-backup'));
  const edited = json(kh);
  edited.hooks[0].timeout = 1;
  fs.writeFileSync(kh, JSON.stringify(edited, null, 2));
  r = inst(hh, ['--check']);
  assert.equal(r.code, 1);
  assert.match(r.out, new RegExp('^DRIFT   ' + esc(kh) + ' \\(', 'm'));
  r = inst(hh);
  assert.equal(r.code, 0);
  assert.equal(mode(kh + '.pmhwc-backup'), '600');
  assert.equal(json(kh + '.pmhwc-backup').hooks[0].timeout, 1);
  assert.equal(json(kh).hooks[0].timeout, 30);
  assert.ok(r.out.includes('previous version kept as ' + kh + '.pmhwc-backup'));
  r = inst(hh, ['--uninstall']);
  assert.equal(r.code, 0);
  assert.ok(!exists(kh));
  assert.match(r.out, new RegExp('^REMOVED ' + esc(kh) + '$', 'm'));
  fs.writeFileSync(kh, '{"version": "v1", "hooks": [{"name": "mine", "trigger": "Stop", "action": {"type": "command", "command": "true"}}]}\n');
  r = inst(hh);
  assert.equal(r.code, 3);
  assert.match(r.out, new RegExp('^REFUSE  ' + esc(kh) + ': exists and is NOT managed', 'm'));
  assert.ok(/** @type {string} */ (read(kh)).includes('"mine"'));
  r = inst(hh, ['--uninstall']);
  assert.ok(/** @type {string} */ (read(kh)).includes('"mine"'));
  assert.match(r.out, new RegExp('^NOTE    ' + esc(kh) + ' exists and is NOT managed', 'm'));
});

test('mcp_step\'s two refusals: no node is a SKIP, an MHW_NODE that is not executable is refused, never another node', { skip }, async () => {
  const { mcpStep } = await import('../../src/commands/install-user.js');
  const notExec = path.join(dir('mcp-step'), 'not-executable');
  fs.writeFileSync(notExec, '#!/bin/sh\nexit 0\n', { mode: 0o644 });
  for (const [env, want] of [[{ PATH: dir('mcp-step-empty-path') }, 'SKIP    the policy MCP servers and the MCP active set: node (26 or later) is required\n'],
    [{ PATH: dir('mcp-step-empty-path'), MHW_NODE: notExec }, 'REFUSE  the MCP servers: MHW_NODE (' + notExec + ') is not an executable file; nothing written\n']]) {
    let out = '';
    const ctx = /** @type {any} */ ({ env, status: 0, mode: 'check', stamp: 'x', scriptDir: '/nonexistent', io: { out: (/** @type {string} */ s) => { out += s; }, err: () => {} } });
    mcpStep(ctx);
    assert.equal(out, want);
    assert.equal(ctx.status, 2);
  }
});
