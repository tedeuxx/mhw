#!/usr/bin/env node
// mhw, the command of the npm package (Issue #68, ADR-0034). npm links this file onto PATH; Node
// resolves the link, so src/cli.js finds the installed package from its own location, never from the
// current directory. Since #472 (S01 of #470) this is an ES module and the command line lives in
// src/cli.js, which still forwards every command to its current implementation.
// `mhw hook prompt` (#488) had a fast path here, ahead of the rest of the CLI; it left the CLI at #600,
// with the hook it ran: the fixed-pattern check (src/hooks/pattern-check.js) runs from native hooks and
// no hook command names mhw.

const env = process.env;
const { main } = await import('../src/cli.js');
// WORKSTATION_LAUNCHER_PLATFORM: tests only, so the Windows mapping is exercised on every runner.
process.exitCode = main(process.argv.slice(2), env.WORKSTATION_LAUNCHER_PLATFORM || process.platform, env);
