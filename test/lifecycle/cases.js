// The S24 parity cases (#495, convention 3 of #470): mhw install, update, uninstall, postinstall and the
// usage text, each case on a fresh throwaway HOME and admin root, every step through `node <tree>/bin/mhw.js`.
// At the base revision those commands ran global/workstation.py (through the shell ./mhw); at the head they
// run src/commands/lifecycle.js. Every value here is SYNTHETIC; npm is always a stand-in (MHW_NPM), never
// the real one, and an update runs only against the case's own git origin and clone, never this checkout.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { readLog } from './stub-installers.js';

export const NAME = 'personal-multi-harness-workstation-configuration';

/**
 * @typedef {{ home: string, root: string, dir: string, tree: string, git: string }} Where
 * @typedef {{ args: string[], env?: Record<string, string>, pre?: (w: Where) => void, post?: (w: Where) => string }} Step
 * @typedef {{ name: string, layout: 'checkout' | 'package' | 'git', env?: Record<string, string>, stub?: boolean,
 *   setup?: (w: Where) => void, steps: Step[] }} Case
 */

/** @param {string} file @param {string | Buffer} text */
export function put(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

const darwin = process.platform === 'darwin';
/** @param {Where} w */
const adminDir = (w) => w.root + (darwin ? '/Library/Application Support/' : '/etc/') + NAME;
/** @param {Where} w */
const dropin = (w) => w.root + (darwin ? '/Library/Application Support/ClaudeCode' : '/etc/claude-code') + '/managed-settings.d/50-' + NAME + '.json';
/** @param {Where} w */
const brief = (w) => path.join(w.home, '.claude', 'CLAUDE.md');

const NONE = '--overlay=none';
// A step argument the harness replaces with --overlay=<the case's own empty overlay directory>.
const OVERLAY = '<OVERLAY>';
/** The installers' log since the last step (stub cases). @param {Where} w */
const argv = (w) => readLog(w.dir);
/** @param {string[]} args @param {Partial<Step>} [more] @returns {Step} */
const S = (args, more = {}) => ({ args, ...more });

// gc.auto=0 and maintenance.auto=false: a commit must never start a detached gc that races the clone.
export const GIT = ['-c', 'user.name=test', '-c', 'user.email=test@example.invalid', '-c', 'commit.gpgsign=false',
  '-c', 'tag.gpgsign=false', '-c', 'gc.auto=0', '-c', 'maintenance.auto=false'];

/** @param {Where} w @param {string} cwd @param {string[]} args */
export function git(w, cwd, ...args) {
  const p = spawnSync(w.git, [...GIT, ...args], { cwd, encoding: 'utf8', env: { PATH: '/usr/bin:/bin', HOME: w.home, GIT_CONFIG_NOSYSTEM: '1',
    GIT_AUTHOR_DATE: '2026-01-01T00:00:00Z', GIT_COMMITTER_DATE: '2026-01-01T00:00:00Z' } });
  if (p.status !== 0) throw new Error('git ' + args.join(' ') + ': ' + p.stderr);
  return p.stdout;
}

/** The first line of the installed Claude Code brief, or <absent>. @param {Where} w */
const briefLine = (w) => (fs.existsSync(brief(w)) ? fs.readFileSync(brief(w), 'utf8').split('\n')[0] : '<absent>');
/** The tag the clone is on, and the installed brief's first line. @param {Where} w */
const onTag = (w) => {
  const p = spawnSync(w.git, ['-C', w.tree, 'describe', '--tags', '--exact-match'], { encoding: 'utf8' });
  return 'tag ' + p.stdout.trim() + '\n' + briefLine(w);
};

/** The stand-in npm's arguments, one per line. @param {Where} w */
const npmArgs = (w) => {
  const log = path.join(w.dir, 'npm-args');
  if (!fs.existsSync(log)) return '<npm not run>';
  const text = fs.readFileSync(log, 'utf8');
  fs.rmSync(log);
  return text;
};

/** @type {Case[]} */
export const CASES = [
  {
    name: 'usage-and-refusals',
    layout: 'checkout',
    steps: [S(['--help']), S(['-h']), S(['help']), S([]), S(['nope']), S(['nope', '--x']), S(['install', '--bogus']),
      S(['install', '--admin', '--no-admin']), S(['install', '--overlay=/nonexistent/overlay/dir']), S(['uninstall', '--overlay=']),
      S(['update', '--overlay=-x']), S(['update', 'v1.0.0', 'v2.0.0']), S(['update', '--admin']), S(['uninstall', '--method']),
      S(['postinstall']), S(['postinstall', '--method']), S(['postinstall', '--yes']), S(['install', 'extra']), S(['uninstall', '-v', '-y', '--bad']),
      S(['uninstall', '--no-admin']), S(['update', '--no-admin']), S(['postinstall', '--admin']), S(['update', '--method']), S(['postinstall', '-v']),
      S(['update', '-y', '-v', '--yes'], { env: { MHW_NPM: '/nonexistent/npm' } })],
  },
  {
    name: 'install-user-layer',
    layout: 'checkout',
    steps: [S(['install', NONE]), S(['install', '--no-admin', NONE]), S(['install', '--yes', '--no-admin', NONE], { post: briefLine }),
      S(['install', '--yes', '--no-admin', NONE]),
      S(['install', '-y', '--no-admin', '-v', NONE], { pre: (w) => fs.appendFileSync(brief(w), 'edited\n') }),
      S(['install', '--yes', '--no-admin', '--method', NONE])],
  },
  {
    name: 'install-and-uninstall-admin-layer',
    layout: 'checkout',
    steps: [S(['install', NONE]), S(['install', '--yes', NONE]), S(['install', '--yes', NONE]), S(['install', '--admin', '--yes', NONE]),
      S(['install', '--admin', '--yes', NONE], { pre: (w) => fs.appendFileSync(dropin(w).replace(/\.json$/, '.extra'), 'x\n') }),
      S(['uninstall', NONE]), S(['uninstall', '--yes', '--verbose', NONE])],
  },
  {
    name: 'install-admin-only-on-a-clean-machine',
    layout: 'checkout',
    steps: [S(['install', '--admin', NONE]), S(['install', '--admin', '--yes', NONE]), S(['uninstall', '--yes', NONE])],
  },
  {
    name: 'stale-admin-layer',
    layout: 'checkout',
    setup: (w) => {
      const bin = path.join(adminDir(w), 'bin');
      fs.mkdirSync(path.join(adminDir(w), 'breaking-glass'), { recursive: true });
      for (const n of ['restart_guard.py', 'breaking_glass.py', 'hitl-escalation-guard.sh', 'hitl.conf', 'clipboard_guard.py', 'clipboard.conf']) put(path.join(bin, n), '# v2.1.0\n');
      /** @param {string} cmd */
      const hook = (cmd) => [{ hooks: [{ type: 'command', command: cmd }] }];
      const restart = '/usr/bin/python3 -I -B "' + path.join(bin, 'restart_guard.py') + '" --harness claude-code';
      put(dropin(w), JSON.stringify({ hooks: { SessionStart: hook(restart), PreToolUse: [...hook(restart), ...hook('/bin/sh "' + path.join(bin, 'hitl-escalation-guard.sh') + '"')],
        UserPromptSubmit: hook('/usr/bin/python3 -I -B "' + path.join(bin, 'clipboard_guard.py') + '" prompt-hook') } }));
      put(w.root + '/etc/codex/requirements.toml', '# managed-by: ' + NAME + '; source: global/install-managed.sh; version: 2.1.0\n[hooks]\n'
        + '[[hooks.SessionStart]]\n[[hooks.SessionStart.hooks]]\ntype = "command"\ncommand = "/usr/bin/python3 -I -B \\"' + path.join(bin, 'restart_guard.py') + '\\" --harness codex"\n');
    },
    steps: [S(['install', NONE]), S(['install', '--no-admin', '--yes', NONE]), S(['install', '--yes', NONE]), S(['install', '--yes', NONE])],
  },
  {
    name: 'refused-install',
    layout: 'checkout',
    setup: (w) => put(brief(w), "the owner's own brief, not managed by this project\n"),
    steps: [S(['install', '--yes', '--no-admin', NONE], { post: briefLine }), S(['install', '--yes', NONE])],
  },
  {
    name: 'uninstall-keeps-the-owners-entries',
    layout: 'checkout',
    setup: (w) => put(path.join(w.home, '.claude', 'settings.json'), JSON.stringify({ permissions: { deny: ['Bash(sudo:*)'] } })),
    steps: [S(['install', '--yes', '--no-admin', NONE]),
      S(['uninstall', NONE], {
        pre: (w) => {
          const file = path.join(w.home, '.claude', 'settings.json');
          const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
          doc.mine = 1;
          doc.permissions.deny.push('Bash(mytool:*)');
          fs.writeFileSync(file, JSON.stringify(doc));
          put(path.join(w.home, '.codex', 'notes.md'), 'mine\n');
        },
      }),
      S(['uninstall', '--yes', NONE], { post: (w) => fs.readFileSync(path.join(w.home, '.claude', 'settings.json'), 'utf8') })],
  },
  {
    name: 'package-install-and-uninstall',
    layout: 'package',
    steps: [S(['postinstall']), S(['install']), S(['install', '--yes'], { post: briefLine }), S(['install', '--yes']), S(['uninstall']),
      S(['uninstall', '--yes'], { post: briefLine })],
  },
  {
    name: 'package-update',
    layout: 'package',
    env: { MHW_NPM: '<NPM>' },
    steps: [S(['update', '--yes'], { post: npmArgs }), S(['update', 'v9.1.0', '--yes', '--verbose'], { post: npmArgs }), S(['update', 'main'], { post: npmArgs }),
      S(['update', 'v4.2'], { post: npmArgs }), S(['update', '--yes'], { env: { NPM_EXIT: '7' }, post: npmArgs })],
  },
  {
    // The exact argv and environment install, uninstall and --admin hand the installers (stand-ins that
    // record them), in order: a wrong overlay, a dropped MHW_NODE or a reversed uninstall order is red here
    // even after the live arm has retired.
    name: 'installer-argv-checkout',
    layout: 'checkout',
    stub: true,
    steps: [S(['install', '--yes', OVERLAY], { post: argv }), S(['install', '--yes', OVERLAY], { post: argv }),
      S(['uninstall', '--yes', OVERLAY], { post: argv }), S(['install', '--admin', '--yes', NONE], { post: argv }),
      S(['install', '--no-admin', '--method', '--yes', '--verbose'], { post: argv }), S(['uninstall', '--yes'], { post: argv })],
  },
  {
    // npm mode: update runs npm (a stand-in), then the package's own install; the install's argv and env
    // are recorded, so the npm-mode entry (bin/mhw.js install, where workstation.py ran /bin/sh mhw install)
    // is pinned by what it hands the installers.
    name: 'installer-argv-package',
    layout: 'package',
    stub: true,
    env: { MHW_NPM: '<NPM>' },
    steps: [S(['update', '--yes', OVERLAY], { post: argv }), S(['update', 'v9.1.0', '--yes'], { post: argv }), S(['uninstall', '--yes'], { post: argv })],
  },
  {
    name: 'checkout-update',
    layout: 'git',
    steps: [S(['update', '--yes', NONE], { post: onTag }), S(['update', 'v9.0.0', '--yes', NONE], { post: onTag }),
      S(['update', 'v8.0.0', NONE], { post: onTag }), S(['update', 'main', NONE], { post: onTag }),
      S(['update', 'v1.0.0', NONE], {
        pre: (w) => {
          const origin = path.join(w.dir, 'origin');
          git(w, origin, 'rm', '-q', '--ignore-unmatch', 'global/workstation.py', 'src/commands/install.js');
          git(w, origin, 'commit', '-q', '-m', 'old shape');
          git(w, origin, 'tag', 'v1.0.0');
        },
        post: onTag,
      }),
      S(['update'], { pre: (w) => fs.appendFileSync(path.join(w.tree, 'README.md'), 'local edit\n'), post: onTag })],
  },
];
