#!/usr/bin/env node
// Stub `security` for the Node MCP launcher suite (#483, the Node port of global/security.test.stub, which
// stays for the Python suites until S17). It NEVER runs the real binary and never reads or writes a real
// keychain or the keychain search list. A "keychain" here is a JSON file the stub itself creates. It
// supports only the verbs the suites use, always against an explicit absolute keychain path as the last
// argument; anything else exits 64, so code that drops its keychain argument fails instead of silently
// meaning "the default keychain".
//
// Every invocation is appended to $SECURITY_STUB_LOG (when set) as one JSON line: its argv, unredacted,
// because the suite asserts no secret value is ever in a child's argv (tests put values in through -i on
// stdin, whose -w values are redacted in the log), and its HOME.
import fs from 'node:fs';
import path from 'node:path';

const NOT_FOUND = 44;

class Exit extends Error {
  /** @param {number} code */
  constructor(code) {
    super('exit ' + code);
    this.code = code;
  }
}

/** @param {string} s */
const redact = (s) => s.replaceAll(/-w\s+(?:"[^"]*"|\S+)/g, '-w <redacted>');

/** @param {string[]} argv @param {string | null} stdin */
function log(argv, stdin) {
  const file = process.env.SECURITY_STUB_LOG;
  if (!file) return;
  fs.appendFileSync(file, JSON.stringify({ argv, home: process.env.HOME || '', stdin: redact(stdin || '') }) + '\n');
}

/** @typedef {{ s: string, a: string, text?: string, hex?: string }} Item */
/** @typedef {{ locked: boolean, items: Item[] }} Db */

/** @param {string} kc @returns {Db} */
const load = (kc) => JSON.parse(fs.readFileSync(kc, 'utf8'));
/** @param {string} kc @param {Db} db */
const save = (kc, db) => fs.writeFileSync(kc, JSON.stringify(db));

/**
 * `-x value` pairs and bare flags; the last argument is the keychain path.
 * @param {string[]} args
 * @returns {[string, Record<string, string | true>]}
 */
function opts(args) {
  if (!args.length || !path.isAbsolute(args.at(-1) || '')) throw new Exit(64);
  const kc = /** @type {string} */ (args.at(-1));
  const rest = args.slice(0, -1);
  /** @type {Record<string, string | true>} */
  const out = {};
  let i = 0;
  while (i < rest.length) {
    const a = rest[i];
    if (['-s', '-a', '-w', '-X', '-p'].includes(a) && i + 1 < rest.length) {
      out[a] = rest[i + 1];
      i += 2;
    } else if (['-w', '-g', '-U'].includes(a)) {
      out[a] = true;
      i += 1;
    } else {
      throw new Exit(64);
    }
  }
  return [kc, out];
}

/** @param {Item} item @param {Record<string, string | true>} o */
const match = (item, o) => item.s === o['-s'] && (!('-a' in o) || item.a === o['-a']);

/** @param {string[]} args @returns {number} */
function one(args) {
  if (!args.length) return 64;
  const [verb, ...rest] = args;
  if (verb === 'create-keychain') {
    const [kc] = opts(rest);
    if (fs.existsSync(kc)) return 48;
    save(kc, { locked: false, items: [] });
    return 0;
  }
  if (verb === 'delete-keychain' || verb === 'lock-keychain') {
    const [kc] = opts(rest);
    if (!fs.existsSync(kc)) return 50;
    if (verb === 'delete-keychain') {
      fs.rmSync(kc);
    } else {
      const db = load(kc);
      db.locked = true;
      save(kc, db);
    }
    return 0;
  }
  const [kc, o] = opts(rest);
  if (!fs.existsSync(kc)) {
    process.stderr.write('security: stub keychain ' + kc + ' does not exist\n');
    return 50;
  }
  const db = load(kc);
  if (verb === 'add-generic-password') {
    if (db.items.some((it) => match(it, o))) return 45;
    const s = String(o['-s']);
    const a = typeof o['-a'] === 'string' ? o['-a'] : '';
    if (typeof o['-X'] === 'string') db.items.push({ s, a, hex: o['-X'] });
    else if (typeof o['-w'] === 'string') db.items.push({ s, a, text: o['-w'] });
    else return 64;
    save(kc, db);
    return 0;
  }
  const found = db.items.filter((it) => match(it, o));
  if (verb === 'delete-generic-password') {
    if (!found.length) return NOT_FOUND;
    db.items.splice(db.items.indexOf(found[0]), 1);
    save(kc, db);
    return 0;
  }
  if (verb === 'find-generic-password') {
    if (!found.length || db.locked) {
      process.stderr.write('security: SecKeychainSearchCopyNext: The specified item could not be found in the keychain.\n');
      return NOT_FOUND;
    }
    const it = found[0];
    if (o['-w'] === true) process.stdout.write((it.text ?? it.hex) + '\n');
    else if (o['-g'] === true) {
      process.stderr.write(it.text === undefined ? 'password: 0x' + String(it.hex).toUpperCase() + '\n' : 'password: "' + it.text + '"\n');
    }
    return 0;
  }
  return 64;
}

/** The words of one -i line: double-quoted strings or runs of non-blanks. @param {string} line */
function words(line) {
  return [...line.matchAll(/"([^"]*)"|(\S+)/g)].map((m) => m[1] ?? m[2]);
}

/** @param {string[]} argv @returns {number} */
function main(argv) {
  if (argv.length === 1 && argv[0] === '-i') {
    const text = fs.readFileSync(0, 'utf8');
    log(argv, text);
    let rc = 0;
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      const code = one(words(line));
      rc = rc || code;
    }
    return rc;
  }
  log(argv, null);
  return one(argv);
}

try {
  process.exitCode = main(process.argv.slice(2));
} catch (e) {
  if (e instanceof Exit) process.exitCode = e.code;
  else {
    // a stub bug must fail loudly, never look like success
    process.stderr.write('security stub error: ' + String(e) + '\n');
    process.exitCode = 70;
  }
}
