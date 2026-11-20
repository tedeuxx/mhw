// The pty library of the paste wrapper (#487, S16 of #470; D2 of the Node runtime requirements): node-pty
// 1.1.0, vendored under src/vendor/node-pty. mhw has no npm runtime dependency (#472: a git install leaves
// them unmet), so the library ships inside the package. test/vendor.test.js holds the lib/ files and the
// macOS prebuilds byte-identical to the devDependency npm ci fetched against its integrity, and the Linux
// prebuilds (which the npm package does not ship) to the sha256 recorded with the CI run that built them
// from the same pinned source (.github/workflows/node-pty-linux.yml; ADR-0042).
//
// loadPty() never throws. It returns the module, or the reason it cannot be used, so the wrapper can
// refuse visibly and `mhw status` can name the reason. The reasons, in the order they are checked:
//   - no prebuild for this platform and architecture (Windows: none is vendored, D7; a native build would
//     run node-gyp at install time, which this package does not do);
//   - on macOS, the prebuilt spawn-helper is not an executable file (the npm tarball carries it 0644; the
//     vendored copy is committed 0755, and an install route that drops the bit is caught here);
//   - the native module does not load (another Node ABI, a damaged file).
// MHW_PTY_MODULE (tests only): an absolute path to load instead of the vendored lib/index.js; any other
// value is refused, never resolved against the current directory.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

export const PTY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'vendor', 'node-pty');
export const PTY_NAME = 'node-pty 1.1.0';

/**
 * @typedef {{ write(data: string | Buffer): void, resize(cols: number, rows: number): void, kill(signal?: string): void,
 *   pid: number, onData(cb: (d: Buffer) => void): { dispose(): void }, onExit(cb: (e: { exitCode: number, signal?: number }) => void): { dispose(): void } }} Pty
 * @typedef {{ spawn(file: string, args: string[], opt: Record<string, unknown>): Pty }} PtyModule
 * @typedef {{ ok: true, pty: PtyModule } | { ok: false, reason: string }} PtyLoad
 */

/**
 * @param {{ env?: Record<string, string | undefined>, platform?: string, arch?: string, root?: string }} [opts]
 * @returns {PtyLoad}
 */
export function loadPty(opts = {}) {
  const env = opts.env || process.env;
  const platform = opts.platform || process.platform;
  const arch = opts.arch || process.arch;
  const root = opts.root || PTY_ROOT;
  const override = env.MHW_PTY_MODULE;
  if (override !== undefined && override !== '') {
    if (!path.isAbsolute(override)) return { ok: false, reason: 'MHW_PTY_MODULE is not an absolute path' };
    return requireModule(override);
  }
  const dir = path.join(root, 'prebuilds', platform + '-' + arch);
  if (!fs.existsSync(path.join(dir, 'pty.node'))) {
    return { ok: false, reason: PTY_NAME + ' has no prebuild for ' + platform + '-' + arch + ' in this package' };
  }
  // spawn-helper exists on macOS only: there node-pty starts the CLI through it with posix_spawn; on
  // Linux it uses forkpty and builds no helper (binding.gyp).
  if (platform === 'darwin') {
    const helper = path.join(dir, 'spawn-helper');
    try {
      if (!fs.statSync(helper).isFile()) throw new Error('not a file');
      fs.accessSync(helper, fs.constants.X_OK);
    } catch {
      return { ok: false, reason: PTY_NAME + "'s spawn-helper is not an executable file (" + helper + ')' };
    }
  }
  return requireModule(path.join(root, 'lib', 'index.js'));
}

/** @param {string} file @returns {PtyLoad} */
function requireModule(file) {
  try {
    const mod = createRequire(import.meta.url)(file);
    if (!mod || typeof mod.spawn !== 'function') return { ok: false, reason: PTY_NAME + ' did not load (no spawn function)' };
    return { ok: true, pty: mod };
  } catch (e) {
    const msg = e instanceof Error ? e.message.split('\n')[0] : String(e);
    return { ok: false, reason: PTY_NAME + ' did not load (' + msg + ')' };
  }
}
