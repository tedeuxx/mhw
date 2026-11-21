// A loopback stand-in for SonarCloud, HCP Terraform and GitHub's /zen (#494, S23 of #470), moved from the
// Handler of global/prerequisites_test.py, and a stand-in HTTP proxy. Run as its own process, because the
// parity cases run mhw check with spawnSync and an in-process server would never answer:
//
//   node test/check/fake-service.js PORTFILE LOGFILE [proxy]
//
// It listens on 127.0.0.1 (port 0), writes its port to PORTFILE, and appends one JSON line per request
// ({"path": ..., "auth": ...}) to LOGFILE. Only the synthetic TOKEN below is accepted. With `proxy` it is a
// proxy that refuses everything: 502 to an absolute-form GET and to a CONNECT, logging the method and the
// target ({"proxy": "GET <url>" | "CONNECT <host:port>"}), never a header.
import fs from 'node:fs';
import http from 'node:http';

export const TOKEN = 'fake-token-for-tests-0000';

const [portFile, logFile, mode] = process.argv.slice(2);
/** @param {unknown} doc */
const log = (doc) => fs.appendFileSync(logFile, JSON.stringify(doc) + '\n');

/** @type {http.RequestListener} */
function service(req, res) {
  const auth = req.headers.authorization || '';
  const url = req.url || '';
  const good = auth === 'Bearer ' + TOKEN;
  let shown = '';
  if (auth) shown = good ? 'Bearer <TOKEN>' : 'Bearer <other>';
  log({ path: url, auth: shown });
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
    // A body on the redirect, so a reader that took a 3xx for success would show it.
    res.writeHead(302, { Location: 'http://127.0.0.1:9/elsewhere', 'Content-Type': 'application/json' });
    res.end('{"valid":true}');
    return;
  }
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(body);
}

/** @type {http.RequestListener} */
function refusingProxy(req, res) {
  log({ proxy: 'GET ' + (req.url || '') });
  res.writeHead(502);
  res.end();
}

const server = http.createServer(mode === 'proxy' ? refusingProxy : service);
if (mode === 'proxy') {
  server.on('connect', (req, socket) => {
    log({ proxy: 'CONNECT ' + (req.url || '') });
    socket.end('HTTP/1.1 502 Bad Gateway\r\n\r\n');
  });
}
server.listen(0, '127.0.0.1', () => {
  const addr = server.address();
  fs.writeFileSync(portFile, String(addr && typeof addr === 'object' ? addr.port : 0));
});
process.on('SIGTERM', () => server.close(() => process.exit(0)));
