#!/usr/bin/env node
// Deprecated alias of mhw (Issue #68): the command was renamed. Same arguments, same behaviour, one
// notice on stderr. Removed in the next major release.
'use strict';
const mhw = require('./mhw.js');

console.error('`workstation` is renamed `mhw`; the alias will be removed in the next major');
const env = process.env;
// WORKSTATION_LAUNCHER_PLATFORM: tests only, as in mhw.js.
process.exitCode = mhw.main(process.argv.slice(2), env.WORKSTATION_LAUNCHER_PLATFORM || process.platform, env);
