// Recording stand-ins for global/install.sh and global/install-managed.sh (#495, S24 of #470), for the
// lifecycle parity cases marked `stub`. Each appends one line per run to $STUB_LOG: its arguments, and the
// environment the lifecycle command hands the installers (WORKSTATION_OVERLAY, MHW_NODE, MHW_CMD and
// WORKSTATION_MANAGED_ROOT), so the golden pins the exact argv and env, which the written-tree comparison
// alone does not once the live arm retires. They write only under the case's own directories.
import fs from 'node:fs';
import path from 'node:path';

const LOG = `{ printf '%s' "$(basename "$0")"; for a in "$@"; do printf ' [%s]' "$a"; done
  printf ' | overlay=%s node=%s cmd=%s root=%s\\n' "\${WORKSTATION_OVERLAY-<unset>}" "\${MHW_NODE-<unset>}" "\${MHW_CMD-<unset>}" "\${WORKSTATION_MANAGED_ROOT-<unset>}"; } >> "$STUB_LOG"
`;

const INSTALL = `#!/bin/sh
${LOG}case " $* " in
  *" --check "*) if [ -f "$STUB_STATE" ]; then echo "OK      stub user layer"; exit 0; fi; echo "MISSING stub user layer"; exit 1 ;;
  *" --uninstall "*) rm -f "$STUB_STATE"; echo "REMOVED stub user layer"; exit 0 ;;
  *) : > "$STUB_STATE"; echo "WROTE   stub user layer"; exit 0 ;;
esac
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
  for (const [name, text] of [['install.sh', INSTALL], ['install-managed.sh', MANAGED]]) {
    fs.writeFileSync(path.join(tree, 'global', name), text);
    fs.chmodSync(path.join(tree, 'global', name), 0o755);
  }
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
