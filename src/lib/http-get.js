// One HTTPS or loopback-HTTP GET for the prerequisites section of mhw check (#494, S23 of #470), made
// synchronous so the check stays one synchronous pass, as global/prerequisites.py's urllib call was.
//
// getSync() runs the GET in a worker thread and waits for it (Atomics.wait), then reads the answer off a
// message port. No child process is started, so the token, when there is one, is never in an argv or an
// environment another process can read: it is handed to the worker in memory and sent as a Bearer
// Authorization header. A redirect is never followed (redirect: 'manual'): its status is returned with
// an empty body, as prerequisites.py refused redirects so a token could not travel to another host.
// Status 0: the host could not be reached, or the request did not finish within the timeout. A non-2xx
// status is returned with an empty body, as urllib's HTTPError gave it. The body is the first 65536
// bytes, decoded as UTF-8 with replacement. Unlike urllib, fetch does not use an HTTP proxy from the
// environment. node: modules only.
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

/**
 * [status, body] of one GET, waited for synchronously.
 * @param {string} url @param {string | null} token
 * @returns {[number, string]}
 */
export function getSync(url, token) {
  const shared = new Int32Array(new SharedArrayBuffer(4));
  const { port1, port2 } = new MessageChannel();
  const worker = new Worker(new URL(import.meta.url), { workerData: { url, token, shared, port: port2 }, transferList: [port2], stdout: true, stderr: true });
  worker.unref();
  const waited = Atomics.wait(shared, 0, 0, TIMEOUT_MS + 5000);
  const msg = receiveMessageOnPort(port1);
  port1.close();
  void worker.terminate();
  if (waited === 'timed-out' || !msg) return [0, ''];
  const answer = /** @type {Answer} */ (msg.message);
  return [Number(answer.status) || 0, String(answer.body ?? '')];
}

if (!isMainThread && workerData?.shared instanceof Int32Array) {
  const { url, token, shared, port } = /** @type {{ url: string, token: string | null, shared: Int32Array, port: import('node:worker_threads').MessagePort }} */ (workerData);
  const answer = await get(url, token);
  port.postMessage(answer);
  Atomics.store(shared, 0, 1);
  Atomics.notify(shared, 0);
}
