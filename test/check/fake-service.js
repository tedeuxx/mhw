// A loopback stand-in for SonarCloud, HCP Terraform and GitHub's /zen (#494, S23 of #470), moved from the
// Handler of global/prerequisites_test.py. Run as its own process, because the parity cases run mhw check
// with spawnSync and an in-process server would never answer:
//
//   node test/check/fake-service.js PORTFILE LOGFILE
//
// It listens on 127.0.0.1 (port 0), writes its port to PORTFILE, and appends one JSON line per request
// ({"path": ..., "auth": ...}) to LOGFILE. Only the synthetic TOKEN below is accepted.
import fs from 'node:fs';
import http from 'node:http';

export const TOKEN = 'fake-token-for-tests-0000';

const [portFile, logFile] = process.argv.slice(2);
const server = http.createServer((req, res) => {
  const auth = req.headers.authorization || '';
  const url = req.url || '';
  fs.appendFileSync(logFile, JSON.stringify({ path: url, auth: auth ? (auth === 'Bearer ' + TOKEN ? 'Bearer <TOKEN>' : 'Bearer <other>') : '' }) + '\n');
  const good = auth === 'Bearer ' + TOKEN;
  let body = '';
  let code = 404;
  if (url === '/api/authentication/validate') {
    body = JSON.stringify({ valid: good });
    code = 200;
  } else if (url === '/api/v2/account/details') {
    body = '{}';
    code = good ? 200 : 401;
  } else if (url.startsWith('/api/components/show?component=')) {
    body = '{}';
    code = url.split('=')[1] === 'public-project' ? 200 : 404;
  } else if (url === '/redirect') {
    res.writeHead(302, { Location: 'http://127.0.0.1:9/elsewhere' });
    res.end();
    return;
  }
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(body);
});
server.listen(0, '127.0.0.1', () => {
  const addr = server.address();
  fs.writeFileSync(portFile, String(addr && typeof addr === 'object' ? addr.port : 0));
});
process.on('SIGTERM', () => server.close(() => process.exit(0)));
