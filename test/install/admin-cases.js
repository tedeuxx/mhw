// The S26 parity scenarios (#496): the admin-layer installer's render, check, apply, uninstall and remove runs
// on a throwaway --root, each run recorded with its exit code, stdout, stderr and the admin root's tree. A run's
// arguments name the scenario's directories: R is the admin root (T/root), and STAGE and SHA are the stage and
// hash the scenario's latest render printed on its RUN line. A `before` function changes the throwaway tree
// first; it gets the scenario's paths. Tests only.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';

const NAME = 'personal-multi-harness-workstation-configuration';

/**
 * @typedef {{ T: string, root: string, stage: string, sha: string, t: Record<string, string> }} Paths
 * @typedef {{ args: string[], before?: (p: Paths) => void, label?: string, env?: Record<string, string | null> }} Run
 * @typedef {{ name: string, runs: Run[], declared?: boolean, uid0Skip?: boolean }} Scenario
 */

/** The digest --apply checks (the algorithm both installers implement): name, length and bytes per file. @param {string} dir */
export function stageDigest(dir) {
  const names = ['clipboard.conf', 'hook/package.json', 'hook/src/commands/hook-entry.js', 'hook/src/commands/hook-prompt.js',
    'hook/src/lib/clean.js', 'hook/src/lib/clean-unicode.js', 'hook/src/hooks/pattern-check.js', '../claude.json', '../requirements.toml', '../kiro.json'];
  const h = crypto.createHash('sha256');
  for (const n of names) {
    const data = fs.readFileSync(path.normalize(path.join(dir, 'bin', n)));
    h.update(Buffer.concat([Buffer.from(n + '\0' + data.length + '\0'), data]));
  }
  return h.digest('hex');
}

/** The admin targets under root, as both installers place them on this OS. @param {string} root */
export function targetsOf(root) {
  const darwin = os.type() === 'Darwin';
  const base = root + (darwin ? '/Library/Application Support/' : '/etc/') + NAME;
  const claudeDir = root + (darwin ? '/Library/Application Support/ClaudeCode' : '/etc/claude-code') + '/managed-settings.d';
  return {
    base, bin: base + '/bin', switches: base + '/breaking-glass', claudeDir, claude: claudeDir + '/50-' + NAME + '.json',
    codexDir: root + '/etc/codex', codex: root + '/etc/codex/requirements.toml',
    kiro: root + (darwin ? '/Library/Application Support/Kiro/managed-settings.json' : '/etc/kiro/managed-settings.json'),
  };
}

/** Rewrite a file through a function of its text. @param {string} f @param {(s: string) => string} fn */
const edit = (f, fn) => fs.writeFileSync(f, fn(fs.readFileSync(f, 'utf8')));
const OTHER = '0123456789abcdef0123456789abcdef01234567';
/** @param {string} s */
const restamp = (s) => s.replace(/; commit: [^;"]*;/, '; commit: ' + OTHER + ';');

/** The staged files a changed byte must invalidate. */
const STAGED = ['bin/hook/src/commands/hook-entry.js', 'bin/hook/src/lib/clean.js', 'bin/hook/package.json', 'bin/clipboard.conf',
  'claude.json', 'requirements.toml', 'kiro.json'];

/** @type {Scenario[]} */
export const SCENARIOS = [
  {
    // The whole life of the admin layer: render, check, a wrong hash, apply, check, a restamp, apply again,
    // drift in a conf, the drop-in and the Kiro copy, a Kiro copy Kiro would reject, uninstall, remove.
    name: 'lifecycle',
    runs: [
      { args: ['R'] },
      { args: ['--check', 'R'] },
      { args: ['--apply=STAGE', '--sha256=0000', 'R'], label: 'apply a wrong hash' },
      { args: ['--apply=STAGE', '--sha256=SHA', 'R'] },
      { args: ['--check', 'R'] },
      { args: ['--check', 'R'], label: 'check three restamped documents', before: (p) => { for (const f of [p.t.codex, p.t.claude, p.t.kiro]) edit(f, restamp); } },
      { args: ['--apply=STAGE', '--sha256=SHA', 'R'], label: 'apply restores the stamp' },
      { args: ['--check', 'R'], label: 'check a drifted conf', before: (p) => fs.appendFileSync(p.t.bin + '/clipboard.conf', '\n') },
      { args: ['--check', 'R'], label: 'check a floor rule removed from the drop-in',
        before: (p) => edit(p.t.claude, (s) => s.replace('      "Bash(sudo:*)",\n', '')) },
      { args: ['--check', 'R'], label: 'check a floor pattern removed from the Kiro copy',
        before: (p) => edit(p.t.kiro, (s) => s.replace('        "sudo *",\n', '')) },
      { args: ['--check', 'R'], label: 'check a Kiro copy over the condition ceiling',
        before: (p) => edit(p.t.kiro, (s) => {
          const d = JSON.parse(s);
          d.rules[0].exclude = Array.from({ length: 40 }, (_, i) => 'x' + i);
          return JSON.stringify(d, null, 2) + '\n';
        }) },
      { args: ['--uninstall', 'R'] },
      { args: ['--remove', 'R'] },
      { args: ['--check', 'R'], label: 'check after remove' },
    ],
  },
  {
    // The hash binds every staged file: a changed byte in any of them installs nothing. A Kiro rule over the
    // condition ceiling is refused even with a matching hash. The untouched stage still applies.
    name: 'tampered-stage',
    runs: [
      { args: ['R'] },
      ...STAGED.map((f, i) => ({
        args: ['--apply=STAGE', '--sha256=SHA', 'R'], label: 'apply a changed ' + f,
        before: (/** @type {Paths} */ p) => {
          if (i > 0) edit(path.join(p.stage, STAGED[i - 1]), (s) => s.slice(0, -1));
          fs.appendFileSync(path.join(p.stage, f), '\n');
        },
      })),
      { args: ['--apply=STAGE', '--sha256=SHA', 'R'], label: 'apply a Kiro rule over the ceiling with a matching hash',
        before: (p) => {
          edit(path.join(p.stage, STAGED[STAGED.length - 1]), (s) => s.slice(0, -1));
          fs.cpSync(p.stage, p.T + '/stage-big', { recursive: true });
          edit(p.T + '/stage-big/kiro.json', (s) => {
            const d = JSON.parse(s);
            d.rules[0].exclude = Array.from({ length: 40 }, (_, i) => 'x' + i);
            return JSON.stringify(d, null, 2) + '\n';
          });
          p.stage = p.T + '/stage-big';
          p.sha = stageDigest(p.stage);
        } },
      { args: ['R'], label: 'render again' },
      { args: ['--apply=STAGE', '--sha256=SHA', 'R'], label: 'the untouched stage applies' },
    ],
  },
  {
    // What an earlier release installed for the restart guard, the switches (ADR-0028) and the picker guard
    // (ADR-0013): --check names each, the next --apply deletes them and only them.
    name: 'legacy-leftovers',
    runs: [
      { args: ['R'] },
      { args: ['--apply=STAGE', '--sha256=SHA', 'R'] },
      { args: ['--check', 'R'], label: 'check the planted leftovers',
        before: (p) => {
          for (const f of ['restart_guard.py', 'breaking_glass.py', 'hitl-escalation-guard.sh', 'hitl.conf']) fs.writeFileSync(p.t.bin + '/' + f, '# old\n');
          fs.mkdirSync(p.t.switches, { recursive: true });
          fs.writeFileSync(p.t.switches + '/paste-filter.json', '{}');
        } },
      { args: ['--apply=STAGE', '--sha256=SHA', 'R'], label: 'apply over an earlier release' },
      { args: ['--check', 'R'], label: 'check after the cleanup' },
      { args: ['--remove', 'R'], label: 'remove the leftovers too',
        before: (p) => {
          fs.writeFileSync(p.t.bin + '/clipboard_guard.py', '# old\n');
          fs.mkdirSync(p.t.switches, { recursive: true });
          fs.writeFileSync(p.t.switches + '/hitl-guard.json', '{}');
        } },
    ],
  },
  {
    // A Codex requirements file that is not ours is never overwritten or removed.
    name: 'foreign-codex',
    runs: [
      { args: ['--root=T/clean'], label: 'render beside a clean root' },
      { args: ['R'], label: 'render beside a foreign requirements file',
        before: (p) => {
          fs.mkdirSync(p.root + '/etc/codex', { recursive: true });
          fs.writeFileSync(p.root + '/etc/codex/requirements.toml', '# owned by someone else\n');
        } },
      { args: ['--apply=STAGE', '--sha256=SHA', 'R'] },
      { args: ['--check', 'R'] },
      { args: ['--remove', 'R'] },
    ],
  },
  {
    // A Kiro managed-settings.json that is not ours (an organisation's policy) is never overwritten or removed,
    // and one that is not JSON at all is not ours either.
    name: 'foreign-kiro',
    runs: [
      { args: ['--root=T/clean'], label: 'render beside a clean root' },
      { args: ['R'], label: 'render beside a foreign Kiro file',
        before: (p) => {
          fs.mkdirSync(path.dirname(p.t.kiro), { recursive: true });
          fs.writeFileSync(p.t.kiro, '{"rules": [{"capability": "shell", "effect": "deny", "match": ["theirs *"]}]}\n');
        } },
      { args: ['--apply=STAGE', '--sha256=SHA', 'R'] },
      { args: ['--check', 'R'] },
      { args: ['--remove', 'R'] },
      { args: ['--apply=STAGE', '--sha256=SHA', 'R'], label: 'apply beside a Kiro file that is not JSON', before: (p) => fs.writeFileSync(p.t.kiro, 'not json\n') },
      { args: ['--check', 'R'], label: 'check beside a Kiro file of ours that is not JSON',
        before: (p) => fs.writeFileSync(p.t.kiro, '{"' + NAME + '": "managed-by: ' + NAME + '",\n') },
    ],
  },
  {
    // Refusals before anything is rendered: an unknown argument, --apply without its hash, an absolute MHW_NODE
    // that is not an executable file, an admin root holding a quote. And the root-only modes refused to a run
    // that is neither root nor under --root: they stop before any system path is read.
    name: 'refusals',
    uid0Skip: true,
    runs: [
      { args: ['--bogus', 'R'] },
      { args: ['--apply=STAGE', 'R'], label: 'apply without a hash' },
      { args: ['R'], label: 'an MHW_NODE that is not executable', env: { MHW_NODE: 'T/no-such-node' } },
      { args: ['--root=T/ro\'ot'], label: 'an admin root holding a quote' },
      { args: ['--uninstall'], label: 'uninstall prints the line for the real root' },
      { args: ['--apply=T/nowhere', '--sha256=0000'], label: 'apply as a non-root user' },
      { args: ['--remove'], label: 'remove as a non-root user' },
    ],
  },
];
