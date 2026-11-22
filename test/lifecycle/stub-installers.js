// Recording stand-ins for the user-layer installer (mhw install-user, global/install.sh until #503) and the
// admin-layer installer (mhw install-admin, global/install-managed.sh until #496) (#495, S24 of #470), for the
// lifecycle parity cases marked `stub`. Each appends one line per run to $STUB_LOG: its arguments, and the
// environment the lifecycle command hands the installers (WORKSTATION_OVERLAY, MHW_NODE, MHW_CMD and
// WORKSTATION_MANAGED_ROOT), so the golden pins the exact argv and env, which the written-tree comparison
// alone does not once the live arm retires. They write only under the case's own directories.
import fs from 'node:fs';
import path from 'node:path';

// The user layer is `mhw install-user` since #503 (S25): its stand-in replaces src/commands/install-user.js
// and logs the same line, named install-user (test/golden/S24/expected-differences.json).
const INSTALL_USER = `import fs from 'node:fs';
export function main(argv, env) {
  const v = (k) => (env[k] === undefined ? '<unset>' : env[k]);
  fs.appendFileSync(env.STUB_LOG, 'install-user' + argv.map((a) => ' [' + a + ']').join('')
    + ' | overlay=' + v('WORKSTATION_OVERLAY') + ' node=' + v('MHW_NODE') + ' cmd=' + v('MHW_CMD') + ' root=' + v('WORKSTATION_MANAGED_ROOT') + '\\n');
  const out = (s) => fs.writeSync(1, s + '\\n');
  if (argv.includes('--check')) {
    if (fs.existsSync(env.STUB_STATE)) { out('OK      stub user layer'); return 0; }
    out('MISSING stub user layer');
    return 1;
  }
  if (argv.includes('--uninstall')) { fs.rmSync(env.STUB_STATE, { force: true }); out('REMOVED stub user layer'); return 0; }
  fs.writeFileSync(env.STUB_STATE, '');
  out('WROTE   stub user layer');
  return 0;
}
`;

// The admin layer is `mhw install-admin` since #496 (S26): its stand-in replaces src/commands/install-admin.js,
// which src/cli.js starts as a child, and logs the same line, named install-admin
// (test/golden/S24/expected-differences.json). It answers as global/install-managed.sh's stand-in did.
const INSTALL_ADMIN = `import fs from 'node:fs';
import os from 'node:os';
const env = process.env;
const argv = process.argv.slice(2);
const v = (k) => (env[k] === undefined ? '<unset>' : env[k]);
fs.appendFileSync(env.STUB_LOG, 'install-admin' + argv.map((a) => ' [' + a + ']').join('')
  + ' | overlay=' + v('WORKSTATION_OVERLAY') + ' node=' + v('MHW_NODE') + ' cmd=' + v('MHW_CMD') + ' root=' + v('WORKSTATION_MANAGED_ROOT') + '\\n');
let root = '';
let mode = 'render';
for (const a of argv) {
  if (a.startsWith('--root=')) root = a.slice(7);
  else if (a === '--check') mode = 'check';
  else if (a === '--remove') mode = 'remove';
  else if (a.startsWith('--apply=')) mode = 'apply';
}
const d = root + (os.type() === 'Darwin' ? '/Library/Application Support/ClaudeCode' : '/etc/claude-code') + '/managed-settings.d';
const f = d + '/50-personal-multi-harness-workstation-configuration.json';
const out = (s) => fs.writeSync(1, s + '\\n');
if (mode === 'render') out('RUN     sudo "' + process.execPath + '" "' + process.argv[1] + '" install-admin --apply="' + env.STUB_STAGE + '" --sha256=abc123');
else if (mode === 'apply') {
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(f, '{"personal-multi-harness-workstation-configuration": "stub"}');
  out('APPLIED stub admin layer');
} else if (mode === 'check') {
  if (fs.existsSync(f)) out('OK      stub admin layer');
  else {
    out('MISSING stub admin layer');
    process.exitCode = 1;
  }
} else {
  fs.rmSync(f, { force: true });
  out('REMOVED stub admin layer');
}
`;

/** Replace a tree's two installers with the recorders. @param {string} tree */
export function stubInstallers(tree) {
  fs.writeFileSync(path.join(tree, 'src', 'commands', 'install-admin.js'), INSTALL_ADMIN);
  fs.writeFileSync(path.join(tree, 'src', 'commands', 'install-user.js'), INSTALL_USER);
}

/** The recorders' environment for a case directory. @param {string} dir */
export function stubEnv(dir) {
  return { STUB_LOG: path.join(dir, 'installers.log'), STUB_STATE: path.join(dir, 'user-layer'), STUB_STAGE: path.join(dir, 'stage') };
}

/** What the recorders logged since the last read; the log is cleared. @param {string} dir */
export function readLog(dir) {
  const log = path.join(dir, 'installers.log');
  if (!fs.existsSync(log)) return '<no installer ran>';
  const text = fs.readFileSync(log, 'utf8');
  fs.rmSync(log);
  return text;
}
