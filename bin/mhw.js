#!/usr/bin/env node
// mhw, the command of the npm package (Issue #68, ADR-0034). npm links this file onto PATH; Node
// resolves the link, so src/cli.js finds the installed package from its own location, never from the
// current directory. Since #472 (S01 of #470) this is an ES module and the command line lives in
// src/cli.js, which still forwards every command to its current implementation.
// `mhw hook prompt` (#488, S17) is the prompt hook every agent harness runs on each prompt: it goes to
// src/commands/hook-entry.js before the rest of the CLI is loaded, so a module elsewhere in the CLI that
// fails to load can never stop the hook, and a failure of the hook's own modules is reported visibly.

const env = process.env;
const argv = process.argv.slice(2);
if (argv[0] === 'hook' && argv[1] === 'prompt') {
  let runHook = null;
  try {
    ({ runHook } = await import('../src/commands/hook-entry.js'));
  } catch {
    // The entry itself did not load: its notice, here, in the Claude Code and Codex form (on Kiro, stderr).
    const msg = 'Paste filter (ADR-0033): internal error (Error); this prompt was NOT checked.';
    if (argv.includes('kiro')) process.stderr.write(msg + '\n');
    else process.stdout.write('{"systemMessage": "' + msg + '"}\n');
  }
  if (runHook) process.exit(await runHook(argv.slice(2), env));
} else {
  const { main } = await import('../src/cli.js');
  // WORKSTATION_LAUNCHER_PLATFORM: tests only, so the Windows mapping is exercised on every runner.
  process.exitCode = main(argv, env.WORKSTATION_LAUNCHER_PLATFORM || process.platform, env);
}
