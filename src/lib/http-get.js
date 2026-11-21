// One HTTPS or loopback-HTTP GET for the prerequisites section of mhw check (#494, S23 of #470), made
// synchronous so the check stays one synchronous pass, as global/prerequisites.py's urllib call was.
//
// getSync() runs the GET in a worker thread and waits for it (Atomics.wait), then reads the answer off a
// message port. The GET starts no process: the token, when there is one, is handed to the worker in
// memory and sent only as a Bearer Authorization header. (The probes of src/lib/prerequisites.js do start
// processes; they run with every declared token removed from their environment.) A redirect is never followed (redirect: 'manual'): its status is returned with
// an empty body, as prerequisites.py refused redirects so a token could not travel to another host.
// Status 0: the host could not be reached, or the request did not finish within the timeout. A non-2xx
// status is returned with an empty body, as urllib's HTTPError gave it. The body is the first 65536
// bytes, decoded as UTF-8 with replacement.
// Proxies (lens F2 and QA B2 on PR #538): urllib always honoured http_proxy, https_proxy and no_proxy
// (either case). So does this GET: the worker starts with --use-env-proxy and an environment holding only
// those variables, from the caller's environment, whatever NODE_USE_ENV_PROXY says (measured on Node
// 25.9: a worker honours the flag, lower and upper case, and NO_PROXY). On Node 26, the engines.node
// floor, a plain-http target goes to the proxy in absolute form as urllib sent it (measured in CI on
// 26.13.1, golden case prereq-proxy-from-the-environment); Node 25.9 opened a CONNECT tunnel instead. The
// residual: the macOS system proxy settings, which urllib read when no variable was set, are not read. A GET that cannot get through is status 0, so NOCHECK, never OK. node: modules only.
import { Worker, MessageChannel, receiveMessageOnPort, isMainThread, workerData } from 'node:worker_threads';

export const TIMEOUT_MS = 15000;
export const MAX_BODY = 65536;

/** @typedef {{ status: number, body: string }} Answer */

/**
 * The GET itself, in the worker.
 * @param {string} url @param {string | null} token
 * @returns {Promise<Answer>}
 */
export async function get(url, token) {
  /** @type {Record<string, string>} */
  const headers = { Accept: 'application/json' };
  if (token) headers.Authorization = 'Bearer ' + token;
  let res;
  try {
    res = await fetch(url, { headers, redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch {
    return { status: 0, body: '' };
  }
  if (res.status < 200 || res.status >= 300) {
    try {
      await res.body?.cancel();
    } catch {
      // the answer is the status
    }
    return { status: res.status, body: '' };
  }
  try {
    /** @type {Uint8Array[]} */
    const chunks = [];
    let size = 0;
    if (res.body) {
      for await (const chunk of res.body) {
        chunks.push(chunk);
        size += chunk.length;
        if (size >= MAX_BODY) break;
      }
    }
    const raw = Buffer.concat(chunks).subarray(0, MAX_BODY);
    return { status: res.status, body: new TextDecoder('utf-8').decode(raw) };
  } catch {
    return { status: 0, body: '' };
  }
}

/** The proxy variables urllib's getproxies() read, in either case. */
export const PROXY_VARS = Object.freeze(['http_proxy', 'https_proxy', 'no_proxy', 'HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY']);

/**
 * The worker's environment: the caller's proxy variables and nothing else (no token, no PATH).
 * @param {Record<string, string | undefined>} env
 */
export function proxyEnv(env) {
  /** @type {Record<string, string>} */
  const out = {};
  for (const name of PROXY_VARS) {
    const v = env[name];
    if (v) out[name] = v;
  }
  return out;
}

/**
 * [status, body] of one GET, waited for synchronously, through the caller's proxy variables as urllib did.
 * @param {string} url @param {string | null} token @param {Record<string, string | undefined>} [env] where the proxy variables are read
 * @returns {[number, string]}
 */
export function getSync(url, token, env = {}) {
  const [status, body] = getSyncSeen(url, token, env);
  return [status, body];
}

/**
 * getSync, and the names (never the values) of the variables the worker's environment held: what the
 * tests read to hold that the worker sees the proxy variables and nothing else (QA H4 on PR #538).
 * @param {string} url @param {string | null} token @param {Record<string, string | undefined>} [env]
 * @returns {[number, string, string[]]}
 */
export function getSyncSeen(url, token, env = {}) {
  const shared = new Int32Array(new SharedArrayBuffer(4));
  const { port1, port2 } = new MessageChannel();
  const worker = new Worker(new URL(import.meta.url), { workerData: { url, token, shared, port: port2 }, transferList: [port2], stdout: true, stderr: true,
    env: proxyEnv(env), execArgv: ['--use-env-proxy'] });
  worker.unref();
  const waited = Atomics.wait(shared, 0, 0, TIMEOUT_MS + 5000);
  const msg = receiveMessageOnPort(port1);
  port1.close();
  void worker.terminate();
  if (waited === 'timed-out' || !msg) return [0, '', []];
  const answer = /** @type {Answer & { env?: string[] }} */ (msg.message);
  return [Number(answer.status) || 0, String(answer.body ?? ''), answer.env || []];
}

if (!isMainThread && workerData?.shared instanceof Int32Array) {
  const { url, token, shared, port } = /** @type {{ url: string, token: string | null, shared: Int32Array, port: import('node:worker_threads').MessagePort }} */ (workerData);
  const answer = await get(url, token);
  // The names of this worker's environment, sorted; never a value.
  port.postMessage({ ...answer, env: Object.keys(process.env).sort() });
  Atomics.store(shared, 0, 1);
  Atomics.notify(shared, 0);
}
