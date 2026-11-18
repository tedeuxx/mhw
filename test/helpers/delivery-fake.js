// A synthetic git and gh for the delivery route (#474): one scenario answers every command the route
// issues, and anything else exits 97 so an unexpected command is never answered by accident. The same
// answer() serves the in-process runner (every OS) and the executables put first on PATH (POSIX), and it
// served workspace/delivery.py when its golden transcripts were recorded. No network, no writes.
//
// Run as a program: node delivery-fake.js <gh|git> args... with MHW_FAKE_SCENARIO (a JSON file) and
// MHW_FAKE_LOG (a file each call is appended to, one JSON array per line).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * @typedef {{
 *   porcelain?: string, head: string, remote: string, branch: string, remoteHead?: string,
 *   changed?: string[], pr: Record<string, unknown>, api?: Record<string, unknown>,
 *   ancestors?: Record<string, number>, mergeBases?: Record<string, string | string[]>, deltas?: Record<string, string[]>,
 *   fail?: string[]
 * }} Scenario
 * @typedef {{ code: number, stdout: string, stderr: string }} Answer
 */

/** @param {string} stdout @returns {Answer} */
const ok = (stdout) => ({ code: 0, stdout: stdout + '\n', stderr: '' });
/** @param {number} code @returns {Answer} */
const fail = (code) => ({ code, stdout: '', stderr: 'synthetic failure\n' });

/**
 * @param {Scenario} s @param {string} tool @param {string[]} args
 * @returns {Answer}
 */
export function answer(s, tool, args) {
  const line = [tool, ...args].join(' ');
  if ((s.fail || []).some((prefix) => line.startsWith(prefix))) return fail(1);
  const a = args.join(' ');
  if (tool === 'git') {
    if (a === 'status --porcelain') return ok(s.porcelain || '');
    if (a === 'rev-parse HEAD') return ok(s.head);
    if (a === 'remote get-url origin') return ok(s.remote);
    if (a === 'branch --show-current') return ok(s.branch);
    if (args[0] === 'fetch') return ok('');
    if (args[0] === 'ls-remote' && args[1] === '--heads') return ok((s.remoteHead ?? s.head) + '\trefs/heads/' + s.branch);
    if (args[0] === 'diff') {
      // --name-only output, newline-separated, or NUL-terminated under -z (where git quotes nothing).
      const z = args.includes('-z');
      const rest = args.filter((x) => x !== '-z');
      /** @param {string[]} paths */
      const names = (paths) => (z ? { code: 0, stdout: paths.map((p) => p + '\0').join(''), stderr: '' } : ok(paths.join('\n')));
      if (rest.length === 4 && rest[3].includes('...')) return names(s.changed || []);
      if (rest.length === 5) {
        const d = (s.deltas || {})[rest[3]];
        return d ? names(d) : fail(128);
      }
    }
    if (args[0] === 'merge-base' && args[1] === '--is-ancestor') {
      const code = (s.ancestors || {})[args[2]] ?? 1;
      return { code, stdout: '', stderr: '' };
    }
    if (args[0] === 'merge-base' && (args.length === 3 || (args.length === 4 && args[1] === '--all'))) {
      // A value may be one base or, for --all, several (one per line, in the order given).
      const mb = (s.mergeBases || {})[args[args.length - 1]];
      if (!mb) return fail(1);
      return ok(Array.isArray(mb) ? (args[1] === '--all' ? mb.join('\n') : mb[0]) : mb);
    }
  }
  if (tool === 'gh') {
    if (args[0] === 'pr' && args[1] === 'view') return ok(JSON.stringify(s.pr));
    if (args[0] === 'pr' && args[1] === 'merge') return ok('');
    if (args[0] === 'api' && args.length === 2) {
      const key = args[1].replace(/^repos\/[^/]+\/[^/]+\//, '');
      if (s.api && Object.hasOwn(s.api, key)) return ok(JSON.stringify(s.api[key]));
      return fail(1);
    }
  }
  return { code: 97, stdout: '', stderr: 'unexpected command: ' + line + '\n' };
}

/**
 * The directory of executables called gh and git that run this file with the absolute node (POSIX).
 * @param {string} dir
 */
export function writeFakeBin(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const me = fileURLToPath(import.meta.url);
  for (const tool of ['gh', 'git']) {
    const file = path.join(dir, tool);
    fs.writeFileSync(file, "#!/bin/sh\nexec '" + process.execPath + "' '" + me + "' " + tool + ' "$@"\n');
    fs.chmodSync(file, 0o755);
  }
  return dir;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [tool, ...args] = process.argv.slice(2);
  const scenario = JSON.parse(fs.readFileSync(String(process.env.MHW_FAKE_SCENARIO), 'utf8'));
  fs.appendFileSync(String(process.env.MHW_FAKE_LOG), JSON.stringify([tool, ...args]) + '\n');
  const r = answer(scenario, tool, args);
  process.stdout.write(r.stdout);
  process.stderr.write(r.stderr);
  process.exitCode = r.code;
}
