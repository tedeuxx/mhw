// One HTTPS or loopback-HTTP GET for the prerequisites section of mhw check (#494, S23 of #470), run as a
// child process so the check itself stays synchronous:
//
//   node src/lib/http-get.js URL       prints {"status": N, "body": "..."} on stdout, exit 0
//
// The token, when there is one, comes in the environment as MHW_HTTP_TOKEN (never in argv, which other
// users of the machine can read) and is sent as a Bearer Authorization header. A redirect is never
// followed (redirect: 'manual'): its status is returned with an empty body, as global/prerequisites.py
// refused redirects so a token could not travel to another host. Status 0: the host could not be reached,
// or the request did not finish within the timeout. A non-2xx status is returned with an empty body, as
// urllib's HTTPError gave it. The body is the first 65536 bytes, decoded as UTF-8 with replacement.
// node: modules only.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

export const TIMEOUT_MS = 15000;
export const MAX_BODY = 65536;

/**
 * @param {string} url
 * @param {string} [token]
 * @returns {Promise<{ status: number, body: string }>}
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
    await res.body?.cancel().catch(() => {});
    return { status: res.status, body: '' };
  }
  try {
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

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url))) {
  const url = process.argv[2] || '';
  get(url, process.env.MHW_HTTP_TOKEN || undefined).then((r) => {
    fs.writeSync(1, JSON.stringify(r));
  });
}
