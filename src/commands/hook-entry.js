// The prompt hook's entry point (#488, S17 of #470). bin/mhw.js reaches it for `mhw hook prompt`, and the
// admin layer (global/install-managed.sh, ADR-0025) runs its root-owned copy directly:
//   node hook-entry.js --harness claude|codex|kiro [--config FILE]
// It imports nothing but node: modules statically. The hook itself (hook-prompt.js and the cleaning core
// under it) is loaded with import(), so a file that is missing, unreadable or does not parse is reported in
// the harness's protocol, by its error class, and the prompt is never passed silently: on Claude Code and
// Codex a visible systemMessage; on Kiro the same notice on stderr at exit 0, which Kiro drops (the Python
// original's contract on Kiro, unchanged). Exit codes: 0, or 2 on Kiro for a block, or 2 for a usage error.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const NOTICE_ERROR = 'Paste filter (ADR-0033): internal error ({error}); this prompt was NOT checked.';

/** The harness named on the command line, or null. @param {string[]} argv */
function harnessOf(argv) {
  const i = argv.indexOf('--harness');
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : null;
}

/** JSON as Python's json.dumps(..., ensure_ascii=True) writes this one shape. @param {string} msg */
function systemMessage(msg) {
  return '{"systemMessage": ' + JSON.stringify(msg).replaceAll(/[\u007f-￿]/g, (c) => String.raw`\u` + /** @type {number} */ (c.codePointAt(0)).toString(16).padStart(4, '0')) + '}\n';
}

/**
 * The error notice when the hook could not load, in the protocol of the harness named in argv.
 * @param {string[]} argv
 * @param {unknown} e
 */
export function loadFailure(argv, e) {
  const error = e instanceof Error && /^[A-Za-z]+$/.test(e.name) ? e.name : 'Error';
  const msg = NOTICE_ERROR.replace('{error}', error);
  if (harnessOf(argv) === 'kiro') return { stdout: '', stderr: msg + '\n', code: 0 };
  return { stdout: systemMessage(msg), stderr: '', code: 0 };
}

/**
 * @param {string[]} argv the words after `hook prompt`
 * @param {Record<string, string | undefined>} env
 * @param {string} [module] the hook module, relative to this file (tests only)
 * @returns {Promise<number>}
 */
export async function runHook(argv, env, module = './hook-prompt.js') {
  let mod;
  try {
    mod = await import(module);
  } catch (e) {
    const r = loadFailure(argv, e);
    if (r.stdout) fs.writeSync(1, r.stdout);
    if (r.stderr) fs.writeSync(2, r.stderr);
    return r.code;
  }
  try {
    return await mod.main(argv, env);
  } catch (e) {
    const r = loadFailure(argv, e);
    if (r.stdout) fs.writeSync(1, r.stdout);
    if (r.stderr) fs.writeSync(2, r.stderr);
    return r.code;
  }
}

// Run directly (the admin layer's copy): exit as soon as the answer is written, even if stdin stays open.
if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url))) {
  runHook(process.argv.slice(2), process.env).then((code) => process.exit(code), () => process.exit(0));
}
