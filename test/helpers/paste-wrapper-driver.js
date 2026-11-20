// Runs `mhw paste-wrapper run ...` in its own process as if both ends were a terminal (#487), so a test
// can drive the refusal path where no pty exists to provide one. Prints the exit status main returned on
// stdout; a wrapper that wrongly execs the CLI replaces this process and never prints it.
//   node paste-wrapper-driver.js run [...]
import { main } from '../../src/commands/paste-wrapper.js';

const code = main(process.argv.slice(2), process.env, { stdinTTY: true, stdoutTTY: true });
if (typeof code === 'number') {
  process.stdout.write('CODE ' + code + '\n');
  process.exitCode = code;
}
