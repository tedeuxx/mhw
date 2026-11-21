// `mhw add-term [--list LIST] [--config FILE]` (#488, S17 of #470): add one term to a hashed term list,
// typed at the owner's own terminal with echo off. clipboard_guard.py's add-term, ported. LIST is
// employer-client-term (the default), health or colleague-name (Issue #36). No command takes a term as an
// argument, and the term is never read from the environment or a pipe.
//
// Properties kept from the Python original: it refuses inside an agent session (a session marker set), when
// stdin is not a terminal, and without a controlling terminal; the term is read twice from /dev/tty with
// nothing echoed, not even the newline; only salted hashes of its normalised forms are written, into a 0600
// file in a 0700 directory; the salt is created on first use (the Keychain through `security -i` on stdin,
// or a 0600 file). For the duration of each read the terminal is set to exactly the modes the read depends
// on (canonical with ICRNL on, INLCR and IGNCR off, ECHO and ECHONL off, ISIG on), through /bin/stty on the
// terminal, and the exact previous modes are restored on every exit path, Ctrl+C included.
// node: modules only.
import fs from 'node:fs';
import tty from 'node:tty';
import { spawnSync } from 'node:child_process';
import * as core from '../lib/clean.js';
import { SaltStore, addTermHashes } from '../lib/keychain.js';
import { loadConfig, errorClass } from './hook-prompt.js';

export const AGENT_MARKERS = Object.freeze(['CLAUDECODE', 'CLAUDE_CODE_ENTRYPOINT', 'AI_AGENT', 'CODEX_SANDBOX',
  'CODEX_SANDBOX_NETWORK_DISABLED']);
const LISTS = ['employer-client-term', ...Object.keys(core.TERM_LISTS)];
const STTY = '/bin/stty';

export class Cancelled extends Error {}
export class Interrupted extends Error {}

/**
 * /bin/stty run on the terminal fd.
 * @param {number} fd @param {string[]} args
 */
function stty(fd, args) {
  const p = spawnSync(STTY, args, { stdio: [fd, 'pipe', 'pipe'], encoding: 'utf8', timeout: 10000 });
  if (p.error || p.status !== 0) throw new Error('stty');
  return p.stdout.trim();
}

/**
 * Read one line from the terminal with nothing echoed, and return it without its line ending. Ctrl+D (end
 * of file) throws Cancelled; Ctrl+C throws Interrupted; an unterminated partial line is never returned.
 * @param {number} fd the terminal, opened read-write
 * @param {string} prompt
 * @returns {Promise<string>}
 */
export function readSecretLine(fd, prompt) {
  const saved = stty(fd, ['-g']);
  let restored = false;
  const restore = () => {
    if (restored) return;
    restored = true;
    try {
      stty(fd, [saved]);
    } finally {
      fs.writeSync(fd, '\n');
    }
  };
  return new Promise((resolve, reject) => {
    const onSigint = () => {
      process.removeListener('SIGINT', onSigint);
      restore();
      reject(new Interrupted());
    };
    process.on('SIGINT', onSigint);
    try {
      // Echo goes off BEFORE the prompt appears, so nothing typed after the prompt is ever echoed.
      stty(fd, ['icanon', 'isig', 'icrnl', '-inlcr', '-igncr', '-echo', '-echonl']);
      fs.writeSync(fd, prompt);
    } catch (e) {
      process.removeListener('SIGINT', onSigint);
      restore();
      reject(e);
      return;
    }
    /** @type {Buffer[]} */
    const chunks = [];
    const step = () => {
      const buf = Buffer.alloc(1024);
      fs.read(fd, buf, 0, buf.length, null, (err, n) => {
        if (restored) return;
        /** @param {Error} e */
        const fail = (e) => {
          process.removeListener('SIGINT', onSigint);
          restore();
          reject(e);
        };
        if (err) return fail(err);
        const chunk = buf.subarray(0, n);
        if (!n || chunk.includes(0x04)) return fail(new Cancelled()); // EOF; a literal ^D only if VEOF is off
        if (chunk.includes(0x03)) return fail(new Interrupted()); // a literal ^C only if VINTR is off
        chunks.push(chunk);
        const all = Buffer.concat(chunks);
        const ends = [all.indexOf(0x0a), all.indexOf(0x0d)].filter((i) => i >= 0);
        if (!ends.length) return step();
        process.removeListener('SIGINT', onSigint);
        restore();
        resolve(new TextDecoder('utf-8').decode(all.subarray(0, Math.min(...ends))));
      });
    };
    step();
  });
}

/**
 * Hash one entered term into the list. The pure half of add-term: no terminal.
 * @param {Record<string, string>} conf
 * @param {string} first
 * @param {string} second
 * @param {string} listName
 * @param {import('../lib/keychain.js').KeychainCtx} ctx
 * @returns {{ code: number, out: string }}
 */
export function addEntered(conf, first, second, listName, ctx) {
  if (first !== second) return { code: 1, out: 'not added: the two entries differ.\n' };
  const forms = core.termForms(first);
  if (!forms.length || forms[0].split(' ').length > core.MAX_TERM_TOKENS || [...forms[0].replaceAll(' ', '')].length < core.MIN_TERM_CHARS) {
    return { code: 1, out: 'not added: a term has 1 to ' + core.MAX_TERM_TOKENS + ' words and at least ' + core.MIN_TERM_CHARS + ' letters or digits.\n' };
  }
  const salt = new SaltStore(conf, ctx).getOrCreate();
  const key = /** @type {Record<string, string>} */ (core.TERM_LISTS)[listName];
  const file = key ? conf[key] : conf.terms_file;
  const n = addTermHashes(file, forms.map((f) => core.termHash(salt, f)));
  return { code: 0, out: 'added: ' + n + ' new hash(es) to ' + file + '. The term itself was not stored anywhere.\n' };
}

/**
 * @param {string[]} argv the words after `mhw add-term`
 * @param {Record<string, string | undefined>} env
 * @param {{ platform?: string, ctx?: import('../lib/keychain.js').KeychainCtx }} [opts]
 * @returns {Promise<number>}
 */
export async function main(argv, env, opts = {}) {
  /** @param {string} s */
  const out = (s) => fs.writeSync(1, s);
  let config = null;
  let listName = 'employer-client-term';
  const rest = [...argv];
  while (rest.length) {
    const flag = /** @type {string} */ (rest.shift());
    if (flag === '--config' && rest.length) {
      config = rest.shift();
    } else if (flag === '--list' && rest.length) {
      listName = /** @type {string} */ (rest.shift());
      if (!LISTS.includes(listName)) {
        fs.writeSync(2, 'add-term: --list must be employer-client-term, ' + Object.keys(core.TERM_LISTS).join(' or ') + '\n');
        return 2;
      }
    } else {
      fs.writeSync(2, 'unknown or incomplete argument: ' + flag + ' (no term is ever taken from arguments)\n');
      return 2;
    }
  }
  const platform = opts.platform || process.platform;
  let conf;
  try {
    conf = loadConfig(config, { env, platform });
  } catch (e) {
    fs.writeSync(2, 'add-term: the settings file could not be read (' + errorClass(e) + ')\n');
    return 1;
  }
  const present = AGENT_MARKERS.filter((m) => env[m]);
  if (present.length) {
    out('refused: an agent session marker is set (' + present.join(', ') + '). Add terms from your own terminal, outside '
      + 'any agent session, so the term never enters a transcript.\n');
    return 2;
  }
  if (!tty.isatty(0)) {
    out('refused: stdin is not a terminal. The term is read only from the terminal, with echo off.\n');
    return 2;
  }
  let fd;
  try {
    fd = fs.openSync('/dev/tty', fs.constants.O_RDWR | (fs.constants.O_NOCTTY || 0));
  } catch {
    out('refused: no controlling terminal.\n');
    return 2;
  }
  let first;
  let second;
  try {
    first = await readSecretLine(fd, 'Term (not shown): ');
    second = await readSecretLine(fd, 'Again: ');
  } catch (e) {
    if (e instanceof Cancelled || e instanceof Interrupted) {
      out('not added: entry cancelled. Nothing was written.\n');
      return 130;
    }
    throw e;
  } finally {
    fs.closeSync(fd);
  }
  const r = addEntered(conf, first, second, listName, opts.ctx || { platform, env, python: null });
  first = second = '';
  out(r.out);
  return r.code;
}
