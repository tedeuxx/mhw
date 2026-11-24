// One step of `mhw install-user` (src/commands/install-user.js, #503), run alone on a context built from the
// environment, the way the S20 and S21 parity tests cut one function out of global/install.sh and ran it
// before #503 deleted it. Its lines go to this process's stdout and stderr; the exit code is the step's
// status. Tests only.
//   A_PHASE        merge | uninstall | report (S20) · startup (S21) · models (S10)
//   A_MODE         install | check | dry-run | uninstall        A_HOOKS        user | managed
//   A_SCRIPT_DIR   the tree's global/                           A_NODE         the node the steps run
//   A_STAMP        the provenance stamp                         A_SETTINGS_WHY a refused node's reason
//   A_PASTE_OK     0 when the paste filter cannot run           A_WRAP_NODE, A_WRAP_MHW  the hook command's paths
//   A_PATTERN_OFF  1 to merge without the fixed-pattern check's entries (#588; the S20 goldens predate them)
//   A_PASTE_LEGACY 1 to merge the `mhw hook prompt` entry #600 removed (the S20 goldens were recorded with it)
//   A_FLOOR, A_FLOOR_CLAUDE, A_FLOOR_CODEX  the floor inputs     A_MANAGED_ROOT, A_OVERLAY, A_SHELL_RC, A_UNAME
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathsOf, finish, STDIO, startupStep, mergeSettings, uninstallUser, reportFloor, modelsStep, pasteWrap } from '../../src/commands/install-user.js';

const env = process.env;
const home = /** @type {string} */ (env.HOME);
const paths = pathsOf(home, env);
const scriptDir = /** @type {string} */ (env.A_SCRIPT_DIR);
const ctx = /** @type {import('../../src/commands/install-user.js').Ctx} */ (/** @type {unknown} */ ({
  env, io: STDIO, home, paths, scriptDir, repoRoot: path.dirname(scriptDir), dataDir: paths.dataDir, status: 0,
  mode: env.A_MODE || 'install', hooksMode: env.A_HOOKS || 'user', overlay: env.A_OVERLAY || '', managedRoot: env.A_MANAGED_ROOT || '',
  shellRc: env.A_SHELL_RC || '', stamp: env.A_STAMP || '', uname: env.A_UNAME || undefined,
  floor: env.A_FLOOR || '', floorFrom: 'global/deny-floor.conf', floorClaude: env.A_FLOOR_CLAUDE || '', floorCodex: env.A_FLOOR_CODEX || '',
  allowNode: env.A_NODE || null, settingsWhy: env.A_SETTINGS_WHY || '', pasteOk: env.A_PASTE_OK !== '0',
  wrapNode: env.A_WRAP_NODE || '', wrapMhw: env.A_WRAP_MHW || '', cmd: env.MHW_CMD || './mhw',
  mergeRefused: false, codexFloorRefused: false, kiroFloorRefused: false, processRefused: false,
  patternOff: env.A_PATTERN_OFF === '1', // #588: the S20 goldens predate the fixed-pattern check's entries
  // #600: the S20 goldens hold the merge placing `mhw hook prompt`'s entry, which mhw install-user no longer
  // passes; this is that command exactly as it was rendered (pasteWrap of the paste filter's command).
  legacyPasteCmd: env.A_PASTE_LEGACY === '1' ? pasteWrap('claude', '/usr/bin/env -u NODE_OPTIONS -u NODE_ICU_DATA -u NODE_PATH -u NODE_COMPILE_CACHE "'
    + (env.A_WRAP_NODE || '') + '" "' + (env.A_WRAP_MHW || '') + '" hook prompt --harness claude --config "' + paths.clipConfDest + '"') : '',
  work: fs.mkdtempSync(path.join(os.tmpdir(), 'mhw-step-')),
}));
/** @type {Record<string, (c: typeof ctx) => void>} */
const PHASES = { merge: mergeSettings, uninstall: uninstallUser, report: reportFloor, startup: startupStep, models: modelsStep };
const step = PHASES[env.A_PHASE || ''];
if (!step) throw new Error('unknown A_PHASE ' + env.A_PHASE);
process.exitCode = finish(ctx, (c) => {
  step(c);
  return c.status;
});
