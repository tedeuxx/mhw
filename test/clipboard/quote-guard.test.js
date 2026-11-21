// The single-quote guards of the rendered prompt-hook command (#488, PR #536 QA): since the start fallback the
// command is a /bin/sh -c '...', so a path holding a single quote would end the script early. Each of the
// three guards is run here, out of process, in throwaway HOMEs and a throwaway --root, never the real ones:
//   mhw install-user             the data directory, node and package paths (its paste_ok check;
//                                global/install.sh until #503)
//   global/install-managed.sh    the admin bin directory ($bin), and the node read back from the user-layer
//                                render (reached through a stand-in bin/mhw.js, since the real installer
//                                refuses such a node first)
// Each asserts REFUSE, exit 2 and that no prompt hook is registered.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ROOT } from '../helpers/s15.js';
import { which } from '../helpers/home.js';

const POSIX = process.platform !== 'win32';
const NAME = 'personal-multi-harness-workstation-configuration';
const SKIP = (!POSIX || !which('jq')) && 'POSIX, jq';
/** @type {Array<() => void>} */
const cleanups = [];
after(() => cleanups.forEach((f) => f()));

function fresh() {
  const dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'mhw-s17q-')));
  cleanups.push(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** A clean environment for an installer run under a throwaway HOME. @param {string} home @param {Record<string, string>} [more] */
const envFor = (home, more = {}) => ({ HOME: home, PATH: path.dirname(process.execPath) + ':/usr/bin:/bin:/usr/sbin:/sbin',
  SHELL: '/bin/sh', TMPDIR: path.dirname(home), LC_ALL: 'C', ...more });

/** No prompt hook of ours anywhere under home. @param {string} home */
function noHook(home) {
  const settings = path.join(home, '.claude', 'settings.json');
  if (fs.existsSync(settings)) {
    assert.ok(!fs.readFileSync(settings, 'utf8').includes('hook prompt --harness'), 'a Claude Code prompt hook was registered');
  }
  assert.ok(!fs.existsSync(path.join(home, '.codex', 'hooks.json')), 'a Codex hooks.json was written');
  assert.ok(!fs.existsSync(path.join(home, '.kiro', 'hooks', NAME + '-paste-filter.json')), 'a Kiro hook file was written');
}

test('mhw install-user refuses a data directory holding a single quote: REFUSE, exit 2, no prompt hook', { skip: !POSIX && 'POSIX' }, () => {
  const d = fresh();
  const home = path.join(d, 'home');
  const xdg = path.join(d, "xdg-q'uote");
  fs.mkdirSync(home);
  fs.mkdirSync(xdg);
  const r = spawnSync(process.execPath, [path.join(ROOT, 'bin', 'mhw.js'), 'install-user', '--overlay=none', '--shell-rc=none', '--managed-root=' + path.join(d, 'admin')],
    { env: envFor(home, { XDG_DATA_HOME: xdg, MHW_NODE: process.execPath }), encoding: 'utf8', timeout: 300000 });
  assert.equal(r.status, 2, r.stdout + r.stderr);
  assert.match(r.stderr, /^REFUSE {2}paste filter: the data directory, node or package path holds a quote \(single or double\), backslash, dollar sign or backtick$/m);
  noHook(home);
});

test('install-managed.sh refuses an admin directory holding a single quote: REFUSE, exit 2, nothing staged', { skip: SKIP }, () => {
  const d = fresh();
  const root = path.join(d, "ro'ot");
  fs.mkdirSync(root);
  const r = spawnSync('/bin/sh', [path.join(ROOT, 'global', 'install-managed.sh'), '--root=' + root],
    { env: envFor(path.join(d, 'home'), { MHW_NODE: process.execPath }), encoding: 'utf8', timeout: 300000 });
  assert.equal(r.status, 2, r.stdout + r.stderr);
  assert.match(r.stderr, /^REFUSE {2}.*ro'ot.* holds a quote, backslash, dollar sign or backtick$/m);
  assert.doesNotMatch(r.stdout, /^(STAGED|RUN) /m);
  assert.deepEqual(fs.readdirSync(root), [], 'something was written under the admin root');
});

test('install-managed.sh refuses a rendered node path holding a single quote: REFUSE, exit 2, nothing staged', { skip: SKIP }, () => {
  // A copy of install-managed.sh beside a stand-in bin/mhw.js whose `install-user` renders what the real one
  // would, with a node whose path holds a single quote (the real one refuses that node before
  // install-managed.sh sees it).
  const d = fresh();
  const tree = path.join(d, 'tree');
  fs.mkdirSync(path.join(tree, 'global'), { recursive: true });
  fs.copyFileSync(path.join(ROOT, 'global', 'install-managed.sh'), path.join(tree, 'global', 'install-managed.sh'));
  fs.symlinkSync(path.join(ROOT, 'src'), path.join(tree, 'src'));
  const node = path.join(d, "no'de");
  const cmd = "/bin/sh -c '/usr/bin/env -u NODE_OPTIONS -u NODE_ICU_DATA -u NODE_PATH -u NODE_COMPILE_CACHE \"" + node
    + "\" \"/x/bin/mhw.js\" hook prompt --harness claude --config \"/x/clipboard.conf\" || exit 0'";
  const settings = JSON.stringify({ hooks: { UserPromptSubmit: [{ hooks: [{ type: 'command', command: cmd, timeout: 30 }] }] },
    permissions: { deny: ['Bash(sudo:*)'] } });
  fs.mkdirSync(path.join(tree, 'bin'));
  fs.writeFileSync(path.join(tree, 'bin', 'mhw.js'), [
    '// stand-in for the S17 quote-guard test: renders a user layer whose prompt hook names a quoted node',
    "import fs from 'node:fs';",
    "const d = process.env.HOME + '/.local/share/" + NAME + "';",
    "fs.mkdirSync(d, { recursive: true });",
    "fs.mkdirSync(process.env.HOME + '/.claude', { recursive: true });",
    "fs.writeFileSync(d + '/clipboard.conf', " + JSON.stringify('# managed-by: ' + NAME + '; source: x; release: v0.0.1; commit: ' + 'a'.repeat(40) + '; do not edit\n') + ');',
    "fs.writeFileSync(process.env.HOME + '/.claude/settings.json', " + JSON.stringify(settings + '\n') + ');',
    '',
  ].join('\n'));
  const root = path.join(d, 'root');
  fs.mkdirSync(root);
  const r = spawnSync('/bin/sh', [path.join(tree, 'global', 'install-managed.sh'), '--root=' + root],
    { env: envFor(path.join(d, 'home'), { MHW_NODE: process.execPath }), encoding: 'utf8', timeout: 300000 });
  assert.equal(r.status, 2, r.stdout + r.stderr);
  assert.match(r.stderr, /^REFUSE {2}the node path holds a quote, backslash, dollar sign or backtick$/m);
  assert.doesNotMatch(r.stdout, /^(STAGED|RUN) /m);
  assert.deepEqual(fs.readdirSync(root), [], 'something was written under the admin root');
});
