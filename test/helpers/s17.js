// The S17 parity cases (#488): the prompt hook's decision on every agent harness, its command line, the
// settings check and add-term's pure half, as data. test/helpers/s17-record.py plays them on
// clipboard_guard.py (the Python original) and test/golden/S17/answers.json holds what it answered;
// test/clipboard/hook-golden.test.js plays them on src/commands/hook-prompt.js and add-term.js and compares.
// Every payload is SYNTHETIC and assembled here at run time from pieces, and the payloads travel as hex,
// so no credential-shaped or personal-data-shaped text sits in a tracked file. The golden stores only what
// the hook printed: categories, notices and redacted copies.

/** @param {...string} parts */
export const J = (...parts) => parts.join('');
/** @param {string} prefix @param {number} n @param {string} [alphabet] */
const tok = (prefix, n, alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ234567') => prefix + alphabet.repeat(Math.ceil(n / alphabet.length) + 1).slice(0, n);

export const SALT = '5a'.repeat(32);
export const TERM = J('Zyxw ', 'Quillon Synthetic');
export const HEALTH = J('Zyxwitis ', 'Quillonica');
export const COLLEAGUE = J('Quellara ', 'Zyxwood');
export const EMAIL = J('ana', '@', 'zyxw-mail.zyxw');
export const CREDENTIALS = {
  aws: tok('AKIA', 16),
  github: tok(J('gh', 'p_'), 36, 'abcdefghijkmnpqrstuvwxyz0123456789'),
  slack: tok(J('xo', 'xb-'), 24, '0123456789abcdef-'),
  google: tok(J('AI', 'za'), 35, 'abcdefghijkmnpqrstuvwxyz0123456789_-'),
  stripe: tok(J('sk_', 'live_'), 24, 'abcdefghijkmnpqrstuvwxyz0123456789'),
  anthropic: tok(J('sk-', 'ant-'), 30, 'abcdefghijkmnpqrstuvwxyz0123456789'),
  jwt: J('ey', 'J', tok('', 20, 'abcdefghij'), '.ey', 'J', tok('', 20, 'klmnopqrst'), '.', tok('', 20, 'uvwxyz0123')),
  'private-key': J('-----BEGIN ', 'RSA PRIVATE KEY-----\n', tok('', 64, 'abcdefghij'), '\n-----END ', 'RSA PRIVATE KEY-----'),
};

/** Python's mod-11 check digit. @param {string} digits @param {number[]} weights */
function mod11(digits, weights) {
  const s = [...digits].reduce((a, d, i) => a + Number(d) * weights[i], 0) % 11;
  return s < 2 ? 0 : 11 - s;
}
/** @param {string} nine */
export function cpf(nine) {
  const d1 = mod11(nine, [10, 9, 8, 7, 6, 5, 4, 3, 2]);
  const d2 = mod11(nine + d1, [11, 10, 9, 8, 7, 6, 5, 4, 3, 2]);
  return J(nine.slice(0, 3), '.', nine.slice(3, 6), '.', nine.slice(6, 9), '-', String(d1), String(d2));
}
/** @param {string} twelve */
export function cnpj(twelve) {
  const w1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const d1 = mod11(twelve, w1);
  const d2 = mod11(twelve + d1, [6, ...w1]);
  return J(twelve.slice(0, 2), '.', twelve.slice(2, 5), '.', twelve.slice(5, 8), '/', twelve.slice(8, 12), '-', String(d1), String(d2));
}
/** @param {string} prefix15 */
export function luhnComplete(prefix15) {
  for (let last = 0; last < 10; last++) {
    const digits = prefix15 + last;
    let total = 0;
    [...digits].reverse().forEach((ch, i) => {
      let d = Number(ch);
      if (i % 2) d = d > 4 ? d * 2 - 9 : d * 2;
      total += d;
    });
    if (total % 10 === 0) return digits;
  }
  throw new Error('no check digit');
}

export const PHONE = J('ligue +55 (11) 9', '0000-0001 hoje');
export const ADDRESS = J('CEP 01', '000-000, centro');
export const CONTRACT = J('meu salário é R$', ' 12.500,00 por mês');
export const HEALTH_CODE = J('atestado com CID F', '32.1 anexo');
export const COLLEAGUE_PHRASE = J('minha gestora ', 'Zyxa Quellon pediu');

/** UTF-8 hex of a string. @param {string} s */
export const hex = (s) => Buffer.from(s, 'utf8').toString('hex');
/** A UserPromptSubmit payload, as each harness sends it (hex). @param {unknown} prompt @param {Record<string, unknown>} [more] */
const payload = (prompt, more = {}) => hex(JSON.stringify({ hook_event_name: 'UserPromptSubmit', prompt, ...more }));

/**
 * @typedef {{ name: string, harness: string, payload: string, conf?: Record<string, string>,
 *   lists?: { employer?: string[], health?: string[], colleague?: string[] }, salt?: string | null,
 *   marker?: string | null }} DecisionCase
 *   salt: what the salt store answers (null: unreadable); marker: PMHWC_PASTE_WRAPPER's value, or absent
 */

/** @returns {DecisionCase[]} */
export function decisionCases() {
  /** @type {DecisionCase[]} */
  const cases = [];
  const HARNESSES = ['claude', 'codex', 'kiro'];
  /** @param {string} name @param {string} p @param {Partial<DecisionCase>} [more] */
  const all = (name, p, more = {}) => {
    for (const harness of HARNESSES) cases.push({ name: name + '/' + harness, harness, payload: p, salt: SALT, ...more });
  };
  const term = { lists: { employer: [TERM] } };
  all('clean', payload('refactor the parser; see commit 3f1e2d4 and git@github.com:o/r.git'), term);
  all('employer-client-term', payload('notes for ' + TERM.toLowerCase()), term);
  all('email', payload('mail ' + EMAIL));
  all('cpf', payload('CPF ' + cpf('529982247')));
  all('cnpj', payload('CNPJ ' + cnpj('112223330001')));
  all('payment-card', payload('card ' + luhnComplete('411111111111111')));
  for (const [k, v] of Object.entries(CREDENTIALS)) all('credential-' + k, payload('use ' + v));
  all('block-message', payload(J('deploy for ', TERM, ' with ', CREDENTIALS.github, ', mail ', EMAIL)), term);
  all('paste-markers', payload(J('look at this\n<pasted_content id="p1">\nkey ', CREDENTIALS.aws, '\n</pasted_content id="p1">\nthanks')));
  all('paste-markers-edges', payload(J('<pasted_contentX>\nkey ', CREDENTIALS.aws, '\n\r<pasted_content>\n<pasted_content a>b\n</pasted_content>')));
  all('narrow-email-off', payload('mail ' + EMAIL), { conf: { block_categories: 'credential,employer-client-term' } });
  all('narrow-credential-on', payload('key ' + CREDENTIALS.aws), { conf: { block_categories: 'credential,employer-client-term' } });
  all('block-typo', payload('mail ' + EMAIL), { conf: { block_categories: 'credential,emial' } });
  all('phone', payload(PHONE));
  all('health-code', payload(HEALTH_CODE));
  all('colleague-phrase', payload(COLLEAGUE_PHRASE));
  all('report-only-address', payload(ADDRESS));
  all('report-only-contract', payload(CONTRACT));
  const reportConf = { block_categories: 'CATEGORIES-EXCEPT-phone-health', report_categories: 'phone,health' };
  all('report-only-phone', payload(PHONE), { conf: reportConf });
  all('report-both-blocks', payload(PHONE), { conf: { report_categories: 'phone' } });
  all('category-off', payload(PHONE), { conf: { block_categories: 'CATEGORIES-EXCEPT-phone-health' } });
  all('report-empty', payload(ADDRESS), { conf: { report_categories: '' } });
  all('report-typo', payload(ADDRESS), { conf: { report_categories: 'phone,fone' } });
  all('private-colleague', payload('ask ' + COLLEAGUE.toLowerCase()), { lists: { colleague: [COLLEAGUE] } });
  all('private-health', payload('notes: ' + HEALTH.toUpperCase()), { lists: { health: [HEALTH] } });
  all('no-salt-term', payload('hello ' + TERM), { ...term, salt: null });
  all('no-salt-generic-blocks', payload('hello key ' + CREDENTIALS.aws), { ...term, salt: null });
  all('no-salt-clean', payload('hello'), { ...term, salt: null });
  all('too-large', payload('key ' + CREDENTIALS.aws + ' ' + 'a'.repeat(200)), { conf: { max_bytes: '100' } });
  all('too-large-raw', payload('x'.repeat(10)), { conf: { max_bytes: '1' } });
  all('long-copy', payload('key ' + CREDENTIALS.aws + ' ' + 'word '.repeat(40)), { conf: { show_cleaned_chars: '50' } });
  all('long-copy-edge', payload('key ' + CREDENTIALS.aws), { conf: { show_cleaned_chars: '25' } });
  all('bad-json', hex('not json ' + CREDENTIALS.aws));
  all('prompt-not-string', hex(JSON.stringify({ prompt: 3 })));
  all('payload-array', hex('[]'));
  all('payload-null', hex('null'));
  all('no-prompt', hex('{"hook_event_name": "UserPromptSubmit"}'));
  all('bad-utf8', 'ff' + hex('{"prompt": "x"}'));
  all('bom', 'efbbbf' + hex('{"prompt": "x"}'));
  all('lone-surrogate', hex('{"prompt": "a \\ud800 b"}'));
  all('empty-stdin', '');
  all('unicode-escape', hex('{"prompt": "mail \\u00e9 ' + EMAIL + ' \\ud83d\\ude00 fim"}'));
  all('unicode-redacted-copy', payload('olá 😀 ' + EMAIL + ' ção'));
  all('redacted-markers', payload('see [REDACTED:email] and [REDACTED:credential]'));
  all('redacted-unknown', payload('see [REDACTED:nothing]'));
  all('redacted-and-report', payload('see [REDACTED:email] ' + ADDRESS));
  all('bad-template', payload('key ' + CREDENTIALS.aws), { conf: { notice_blocked: 'broken {nope}' } });
  all('template-overlay', payload('key ' + CREDENTIALS.aws), { conf: { notice_blocked: 'BLOCKED: {categories} {{literal}}' } });
  all('bad-max-bytes', payload('mail ' + EMAIL), { conf: { max_bytes: 'x', show_cleaned_chars: '0' } });
  all('duplicate-keys', hex('{"prompt": "a", "prompt": "mail ' + EMAIL + '"}'));
  all('extra-fields', payload('mail ' + EMAIL, { session_id: 's', cwd: '/x', transcript_path: '/t' }));
  for (const [label, marker] of /** @type {Array<[string, string]>} */ ([['marker-set', '1'], ['marker-wrong', 'yes'], ['marker-empty', '']])) {
    all(label, payload(J('deploy for ', TERM, ' with ', CREDENTIALS.github, ', mail ', EMAIL)), { ...term, marker });
    all(label + '-bad-json', hex('nope'), { marker });
  }
  return cases;
}

/**
 * Command-line cases, run as processes. conf: the settings file's lines ('DIR' is the case's directory);
 * null: no --config; BADBYTE stands for the byte 0xff. args: after the command words. stdin: hex.
 * @typedef {{ name: string, args: string[], stdin: string, conf?: string[] | null, configPath?: 'dir' | 'missing' }} CliCase
 * @returns {CliCase[]}
 */
export function cliCases() {
  const file = ['salt_store=file', 'terms_file=DIR/lo/terms', 'salt_file=DIR/lo/salt', 'health_terms_file=DIR/lo/th',
    'colleague_terms_file=DIR/lo/tc'];
  const dirty = payload('mail ' + EMAIL);
  /** @type {CliCase[]} */
  const cases = [
    { name: 'no-harness', args: [], stdin: dirty, conf: file },
    { name: 'bad-harness', args: ['--harness', 'cursor'], stdin: dirty, conf: file },
    { name: 'harness-no-value', args: ['--harness'], stdin: dirty, conf: file },
    { name: 'unknown-flag', args: ['--harness', 'claude', '--verbose'], stdin: dirty, conf: file },
    { name: 'list-flag', args: ['--harness', 'claude', '--list', 'health'], stdin: dirty, conf: file },
  ];
  for (const harness of ['claude', 'codex', 'kiro']) {
    cases.push({ name: 'dirty/' + harness, args: ['--harness', harness], stdin: dirty, conf: file });
    cases.push({ name: 'clean/' + harness, args: ['--harness', harness], stdin: payload('hello'), conf: file });
    cases.push({ name: 'config-is-a-directory/' + harness, args: ['--harness', harness], stdin: dirty, configPath: 'dir' });
    cases.push({ name: 'config-missing/' + harness, args: ['--harness', harness], stdin: dirty, configPath: 'missing' });
    cases.push({ name: 'config-keychain-relative/' + harness, args: ['--harness', harness], stdin: dirty, conf: [...file, 'keychain_path=rel.keychain'] });
    cases.push({ name: 'config-not-utf8/' + harness, args: ['--harness', harness], stdin: dirty, conf: ['salt_store=file', 'x=BADBYTE'] });
  }
  return cases;
}

/** add-term's pure half: the entered pair, and the list. @returns {Array<{ name: string, first: string, second: string, list: string }>} */
export function addTermCases() {
  return [
    { name: 'term', first: TERM, second: TERM, list: 'employer-client-term' },
    { name: 'again-no-new', first: TERM, second: TERM, list: 'employer-client-term' },
    { name: 'one-word', first: 'Quillonx', second: 'Quillonx', list: 'employer-client-term' },
    { name: 'differ', first: TERM, second: TERM + ' ', list: 'employer-client-term' },
    { name: 'too-short', first: 'ab', second: 'ab', list: 'employer-client-term' },
    { name: 'short-words', first: 'a b', second: 'a b', list: 'employer-client-term' },
    { name: 'three-chars', first: 'a b c', second: 'a b c', list: 'employer-client-term' },
    { name: 'too-many-words', first: 'a b c d e f g', second: 'a b c d e f g', list: 'employer-client-term' },
    { name: 'six-words', first: 'aa b c d e f', second: 'aa b c d e f', list: 'employer-client-term' },
    { name: 'empty', first: '', second: '', list: 'employer-client-term' },
    { name: 'punctuation-only', first: '--- !!', second: '--- !!', list: 'employer-client-term' },
    { name: 'accents', first: 'Ünïcødé Tërm', second: 'Ünïcødé Tërm', list: 'employer-client-term' },
    { name: 'health', first: HEALTH, second: HEALTH, list: 'health' },
    { name: 'colleague', first: COLLEAGUE, second: COLLEAGUE, list: 'colleague-name' },
  ];
}
