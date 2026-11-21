// Recording stand-ins for the user-layer installer (mhw install-user, global/install.sh until #503) and global/install-managed.sh (#495, S24 of #470), for the
// lifecycle parity cases marked `stub`. Each appends one line per run to $STUB_LOG: its arguments, and the
// environment the lifecycle command hands the installers (WORKSTATION_OVERLAY, MHW_NODE, MHW_CMD and
// WORKSTATION_MANAGED_ROOT), so the golden pins the exact argv and env, which the written-tree comparison
// alone does not once the live arm retires. They write only under the case's own directories.
import fs from 'node:fs';
import path from 'node:path';

const LOG = `{ printf '%s' "$(basename "$0")"; for a in "$@"; do printf ' [%s]' "$a"; done
  printf ' | overlay=%s node=%s cmd=%s root=%s\\n' "\${WORKSTATION_OVERLAY-<unset>}" "\${MHW_NODE-<unset>}" "\${MHW_CMD-<unset>}" "\${WORKSTATION_MANAGED_ROOT-<unset>}"; } >> "$STUB_LOG"
`;

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

const MANAGED = `#!/bin/sh
${LOG}root=; mode=render
for a in "$@"; do
  case $a in --root=*) root=\${a#--root=} ;; --check) mode=check ;; --remove) mode=remove ;; --apply=*) mode=apply ;; esac
done
if [ "$(uname)" = Darwin ]; then d="$root/Library/Application Support/ClaudeCode/managed-settings.d"; else d="$root/etc/claude-code/managed-settings.d"; fi
f="$d/50-personal-multi-harness-workstation-configuration.json"
case $mode in
  render) echo "RUN     sudo /bin/sh \\"$0\\" --apply=\\"$STUB_STAGE\\" --sha256=abc123" ;;
  apply) mkdir -p "$d"; printf '{"personal-multi-harness-workstation-configuration": "stub"}' > "$f"; echo "APPLIED stub admin layer" ;;
  check) if [ -f "$f" ]; then echo "OK      stub admin layer"; exit 0; fi; echo "MISSING stub admin layer"; exit 1 ;;
  remove) rm -f "$f"; echo "REMOVED stub admin layer" ;;
esac
`;

/** Replace a tree's two installers with the recorders. @param {string} tree */
export function stubInstallers(tree) {
  fs.writeFileSync(path.join(tree, 'global', 'install-managed.sh'), MANAGED);
  fs.chmodSync(path.join(tree, 'global', 'install-managed.sh'), 0o700);
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
