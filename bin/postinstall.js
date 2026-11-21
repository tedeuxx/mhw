#!/usr/bin/env node
// The npm postinstall of mhw (Issue #68, ADR-0034; Issue #113): package.json's one lifecycle script. The
// decisions are src/commands/postinstall.js (#495, S24 of #470), re-exported here for any caller of this
// file; it runs only when it is the script node was started with. node: modules only: this file runs
// before npm has finished installing the package's own dependencies (npm's preparation of a git
// dependency).
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { run } from '../src/commands/postinstall.js';

export { ROOT, globalModules, decide, undoPrepareLink, run } from '../src/commands/postinstall.js';

/** @param {string} p */
const real = (p) => {
  try {
    return fs.realpathSync(p);
  } catch {
    return null;
  }
};
if (process.argv[1] && real(process.argv[1]) === real(fileURLToPath(import.meta.url))) {
  process.exitCode = run(process.env, process.env.WORKSTATION_LAUNCHER_PLATFORM || process.platform);
}
