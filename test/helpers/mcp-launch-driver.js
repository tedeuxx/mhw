// Test driver for the MCP launcher (#483): `node mcp-launch-driver.js <stub> <launcher args...>` runs the
// launcher's own main() with `security` pointed at the Node stub, so no test can reach the real binary
// or the real Keychain. It refuses any other security path.
import path from 'node:path';
import { main } from '../../src/commands/mcp-launch.js';

const [stub, ...argv] = process.argv.slice(2);
if (!stub || !path.isAbsolute(stub) || path.basename(stub) !== 'security-stub.js') {
  process.stderr.write('mcp-launch-driver: the first argument must be the absolute path of security-stub.js\n');
  process.exitCode = 64;
} else {
  process.exitCode = main(argv, process.env, { security: stub });
}
