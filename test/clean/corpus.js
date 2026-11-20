// The S15 shared corpus (#486): the cases of global/clipboard/clipboard_guard_test.py and of the deleted
// global/scan_test.py, plus the edges where Python's re and JavaScript's RegExp disagree (Unicode classes,
// \b, case folding, code point offsets). Each case is a text and, where it exercises term matching, a
// synthetic salt and invented terms. test/golden/S15/corpus.json holds what the Python original answers.
//
// Every value is synthetic and obviously fake. Every would-be finding is assembled at run time from
// pieces (J), so this file itself carries no string the detectors, or mhw scan reading this file, report.

/** @param {...string} parts */
export const J = (...parts) => parts.join('');
/** @param {string} prefix @param {number} n @param {string} [alphabet] */
const tok = (prefix, n, alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ234567') => prefix + alphabet.repeat(Math.ceil(n / alphabet.length) + 1).slice(0, n);

export const SALT = '5a'.repeat(32);
const TERM = 'Zyxw Quillon Synthetic';
const HEALTH = 'Zyxwitis Quillonica';
const COLLEAGUE = 'Quellara Zyxwood';
const AWS = J('AKIA', 'IOSFODNN7', 'EXAMPLE');
const EMAIL = J('synthetic.person', '@', 'fixture-mail.dev');
const CPF = J('123.456', '.789-09');
const VENDOR = J('noreply', '@', 'anthropic.com');

const CREDENTIALS = {
  aws: tok('AKIA', 16),
  github: tok(J('gh', 'p_'), 36, 'abcdefghijkmnpqrstuvwxyz0123456789'),
  'github-fine-grained': tok(J('github', '_pat_'), 60, 'abcdefghijkmnpqrstuvwxyz0123456789_'),
  gitlab: tok(J('glp', 'at-'), 24, 'abcdefghijkmnpqrstuvwxyz0123456789'),
  slack: tok(J('xo', 'xb-'), 24, '0123456789abcdef-'),
  'slack-webhook': J('https://hooks', '.slack.com/services/', 'T0000/B0000/abcdefghijklmnopqrstuvwx'),
  google: tok(J('AI', 'za'), 35, 'abcdefghijkmnpqrstuvwxyz0123456789_-'),
  stripe: tok(J('sk_', 'live_'), 24, 'abcdefghijkmnpqrstuvwxyz0123456789'),
  anthropic: tok(J('sk-', 'ant-'), 30, 'abcdefghijkmnpqrstuvwxyz0123456789'),
  openai: tok(J('sk-', 'proj-'), 30, 'abcdefghijkmnpqrstuvwxyz0123456789'),
  npm: tok(J('np', 'm_'), 36, 'abcdefghijkmnpqrstuvwxyz0123456789'),
  jwt: J('ey', 'J', tok('', 20, 'abcdefghij'), '.ey', 'J', tok('', 20, 'klmnopqrst'), '.', tok('', 20, 'uvwxyz0123')),
  'private-key': J('-----BEGIN ', 'RSA PRIVATE KEY-----\n', tok('', 64, 'abcdefghij'), '\n-----END ', 'RSA PRIVATE KEY-----'),
  'private-key-unterminated': J('-----BEGIN ', 'OPENSSH PRIVATE KEY-----\n', tok('', 64, 'abcdefghij'), '\nno end line'),
};

/** Python's mod-11 check digit. @param {string} digits @param {number[]} weights */
function mod11(digits, weights) {
  const s = [...digits].reduce((a, d, i) => a + Number(d) * weights[i], 0) % 11;
  return s < 2 ? 0 : 11 - s;
}
/** @param {string} nine */
function cpf(nine) {
  const d1 = mod11(nine, [10, 9, 8, 7, 6, 5, 4, 3, 2]);
  const d2 = mod11(nine + d1, [11, 10, 9, 8, 7, 6, 5, 4, 3, 2]);
  const s = nine + d1 + d2;
  return J(s.slice(0, 3), '.', s.slice(3, 6), '.', s.slice(6, 9), '-', s.slice(9));
}
/** @param {string} twelve */
function cnpj(twelve) {
  const w1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const d1 = mod11(twelve, w1);
  const d2 = mod11(twelve + d1, [6, ...w1]);
  const s = twelve + d1 + d2;
  return J(s.slice(0, 2), '.', s.slice(2, 5), '.', s.slice(5, 8), '/', s.slice(8, 12), '-', s.slice(12));
}
/** @param {string} prefix15 */
function luhnComplete(prefix15) {
  for (const last of '0123456789') {
    const d = [...(prefix15 + last)].reverse().map(Number);
    /** @param {number} x @param {number} i */
    const term = (x, i) => {
      if (!(i % 2)) return x;
      return x > 4 ? x * 2 - 9 : x * 2;
    };
    if (d.reduce((t, x, i) => t + term(x, i), 0) % 10 === 0) return prefix15 + last;
  }
  throw new Error('no Luhn digit');
}
/** The same digits written in another decimal script, from that script's zero. @param {string} s @param {number} zero */
const script = (s, zero) => [...s].map((c) => (c >= '0' && c <= '9' ? String.fromCodePoint(zero + Number(c)) : c)).join('');

const CARD = luhnComplete('411111111111111');
const AMEX = luhnComplete('37828224631000').slice(0, 15);

/** @typedef {{ name: string, text: string, salt?: string, terms?: { employer?: string[], health?: string[], colleague?: string[] } }} Case */

/** @type {Case[]} */
const cases = [];
/** @param {string} name @param {string} text @param {Partial<Case>} [more] */
const add = (name, text, more = {}) => cases.push({ name, text, ...more });

// --- clipboard_guard_test.py: Patterns
for (const [name, secret] of Object.entries(CREDENTIALS)) add('credential/' + name, J('config: ', secret, ' # end'));
add('email/plain', J('write to ana.example', '@', 'zyxw-mail.zyxw today'));
for (const benign of [J('git', '@github.com:owner/repo.git'), J('user', '@example.com'), J('x', '@host.test'),
  J('1+me', '@users.noreply.github.com'), J('GIT', '@zyxw-host.dev'), J('a', '@b.EXAMPLE'), J('a', '@sub.Localhost')].entries()) {
  add('email/benign-' + (benign[0] + 1), benign[1]);
}
add('cpf/valid', J('CPF ', cpf('529982247')));
add('cpf/bad-check-digit', J('CPF ', cpf('529982247').slice(0, -1), '0'));
add('cpf/repeated', J('111.111', '.111-11'));
add('cnpj/valid', J('CNPJ ', cnpj('112223330001')));
add('cnpj/repeated', J('11.111', '.111/1111-11'));
add('payment-card/grouped', J('card ', CARD.slice(0, 4), '-', CARD.slice(4, 8), '-', CARD.slice(8, 12), '-', CARD.slice(12)));
add('payment-card/spaced', J('card ', CARD.slice(0, 4), ' ', CARD.slice(4, 8), ' ', CARD.slice(8, 12), ' ', CARD.slice(12)));
add('payment-card/amex', J('amex ', AMEX));
add('payment-card/wrong-luhn', J('card ', CARD.slice(0, -1), String((Number(CARD.at(-1)) + 1) % 10)));
add('payment-card/no-prefix', J('order ', luhnComplete('911111111111111')));
add('clean/engineering-text', 'commit 3f1e2d4c5b6a79880f1e2d4c5b6a79880f1e2d4c\nuuid 123e4567-e89b-12d3-a456-426614174000\n'
  + 'ssh git@github.com:o/r.git, port 8080, build 20261001, sk-test-shaped words, AKIA lowercase akia');

// --- clipboard_guard_test.py: NEW_POSITIVES and NEW_NEGATIVES (Issue #36)
const POSITIVES = {
  phone: [J('ligue +55 (11) 9', '0000-0001 hoje'), J('tel +55 21 3', '000 0000.'), J('fixo (21) 3', '000-0000'),
    J('cel (99) 9', '8888-7777, ok'), J('call +1 (555) 0', '10-0199 now'), J('call +44 20 7', '946 0000')],
  'postal-address': [J('CEP 01', '000-000, centro'), J('cep: 9', '9999999'), J('CEP 9', '9999999'),
    J('Rua das Flores Fictícias, ', '123 fundos'), J('na Avenida Zyxw Quillon nº ', '45'), J('at 12 Quillon Zyxw ', 'Street today')],
  'contract-value': [J('meu salário é R$', ' 12.500,00 por mês'), J('proposta PJ: R$', '18000'), J('contract rate US$', ' 90 per hour'),
    J('an offer of $', '120,000 base'), J('bonus of $', '15k'), J('pretensão salarial: BRL', ' 9.000')],
  health: [J('atestado com CID F', '32.1 anexo'), J('cid-10: J', '45'), J('ICD-10 F', '41.1'), J('CID U', '07.1')],
  'colleague-name': [J('minha gestora ', 'Zyxa Quellon pediu'), J('My colleague ', 'Quillo Zyxwer wrote'),
    J('meu colega de time ', 'Zyx da Quell disse'), J('our tech lead ', 'Zyxo approved')],
};
for (const [cat, texts] of Object.entries(POSITIVES)) texts.forEach((t, i) => add(cat + '/positive-' + (i + 1), t));
const NEGATIVES = {
  phone: ['(11) 1234', 'version 1.2.3-4567', 'date 2026-10-01', 'score +12 points', '@@ -10,7 +10,8 @@', '(01) 2345-6789',
    '+55 12', 'uuid 123e4567-e89b-12d3-a456-426614174000', 'call (11)91234-56789', 'x+1 (555) 010-0199', '+1 555', J('+1234567', '890123456')],
  'postal-address': ['ticket 12345-6789', 'v2.12345-678.1', 'ref 12345-678/2026', 'Rua sem número', 'a rua tem 3 casas',
    'Quillon Street', 'build ab12345-678', 'Avenida Paulista vale 10'],
  'contract-value': [J('R$', ' 30 a unidade'), J('budget USD', ' 50 per month'), 'salary=$1', 'the contract defines 3 fields',
    J('costs $', '1,000'), 'echo $100', J('price R$', ' 12.500,00 for the laptop')],
  health: ['acid F32', 'CID F3', 'ICD-10 J4', 'CID alone', 'ICD-10 codes', 'CIDR 10.0.0.0/8', 'cid:image001', 'CID-1 F32x',
    'the bug was diagnosed with a profiler'],
  'colleague-name': ['my manager said hi', 'my manager, Zyxa said', 'o gestor Zyxa', 'Meu colega disse', "my colleague's Zyxa",
    'minha gestora pediu'],
};
for (const [cat, texts] of Object.entries(NEGATIVES)) texts.forEach((t, i) => add(cat + '/negative-' + (i + 1), t));
const AMOUNT = J('R$ 1', '2.500,00');
add('contract-value/cue-next-line', 'salário\n' + AMOUNT);
add('contract-value/cue-beyond-window', 'salário ' + 'x'.repeat(81) + ' ' + AMOUNT);
add('contract-value/cue-at-window-edge', 'salário ' + 'x'.repeat(70) + ' ' + AMOUNT);
add('contract-value/cue-near', 'salário ' + 'x'.repeat(10) + ' ' + AMOUNT);
add('contract-value/cue-after', AMOUNT + ' de salário');
// The 80-character window, pinned on both sides of its edge, before the amount and after it.
for (const n of [71, 72, 73]) add('contract-value/window-before-' + n, 'salary ' + 'x'.repeat(n) + ' ' + AMOUNT);
for (const n of [71, 72, 73, 74]) add('contract-value/window-after-' + n, AMOUNT + ' ' + 'x'.repeat(n) + ' salary');
add('contract-value/lines-around', 'x\nproposta ' + AMOUNT + '\n' + AMOUNT + '\nbonus\n' + AMOUNT + ' bonus\n\n' + AMOUNT);
add('contract-value/newline-first', '\n' + AMOUNT + ' salário');
add('contract-value/cue-before-on-the-line-above-with-emoji', '\u{1F600} salário \u{1F600}\n\u{1F600} ' + AMOUNT + ' \u{1F600} pacote');
for (const cue of ['salário', 'salario', 'salários', 'salary', 'salaries', 'remuneração', 'remuneracao', 'compensation', 'pretensão',
  'pretensao', 'contrato', 'contratos', 'contract', 'contracts', 'proposta', 'offer', 'bônus', 'bonus', 'PLR', 'CLT', 'PJ',
  'honorários', 'honorarios', 'day rate', 'hourly rate', 'por hora', 'per hour', 'valor/hora', 'pacote', 'package',
  'stock option', 'stock options', 'equity']) {
  add('contract-value/cue ' + cue, cue + ' ' + J('R$', ' 9.000'));
}
add('contract-value/no-cue', 'word ' + J('R$', ' 9.000'));
add('phone/two-patterns-one-finding', J('+55 (11) 9', '0000-0001'));
add('contract-value/amount-forms', J('salary US$', ' 1.5 million, bonus R$', ' 2 mil, offer €', '90k, contract $', '1,200.50'));

// --- term matching (Normalisation, PrivateTermLists)
const terms = { employer: [TERM] };
for (const [i, v] of ['ZYXW quillon synthetic', 'zyxw-Quillon_synthetic!', 'Zÿxw Quillón Synthétic', 'ZyxwQuillonSynthetic',
  'a\nZyxw\tQuillon  Synthetic\nb'].entries()) add('employer-client-term/variant-' + (i + 1), v, { salt: SALT, terms });
for (const [i, v] of ['Zyxw Quillon', 'Quillon Synthetic', 'Zyxw Quillons Synthetic', 'zyxwquillon'].entries()) {
  add('employer-client-term/near-miss-' + (i + 1), v, { salt: SALT, terms });
}
add('employer-client-term/no-salt', TERM, { terms });
const lists = { health: [HEALTH], colleague: [COLLEAGUE] };
add('health/term-list', 'notes: ' + HEALTH.toLowerCase() + ', and ' + COLLEAGUE.toUpperCase(), { salt: SALT, terms: lists });
add('health/term-alone-is-not-a-term', 'Zyxwitis alone', { salt: SALT, terms: lists });
add('colleague-name/term-list-is-its-own-category', COLLEAGUE, { salt: SALT, terms: { employer: [COLLEAGUE] } });
add('employer-client-term/six-words-max', 'one two three four five six seven', { salt: SALT, terms: { employer: ['two three four five six seven'] } });

// --- the deleted scan_test.py's fixtures
add('scan/touched', 'line one\nline two\ncontact ' + EMAIL + ' and id ' + AWS + '\n');
add('scan/new', 'a\nb\nc\nd\ncpf ' + CPF + '\n');
add('scan/new-categories', [J('+55 (11) 9', '0000-0001'), J('CEP 01', '000-000'), J('salary ', 'US$', ' 90,000'), J('CID F', '32.1'),
  J('my colleague ', 'Quillo Zyxwer')].join('\n') + '\n');
add('scan/attribution-trailer', J('Co-Authored-By: Claude <', VENDOR, '>\n'));
add('scan/term', 'one\nmet the ' + J('Quillmoor', 'vex') + ' people\n', { salt: SALT, terms: { employer: [J('Quillmoor', 'vex')], health: [J('Zyxwitis', 'Quill')], colleague: [J('Quellara ', 'Zyxwood')] } });

// --- edges where Python's re and JavaScript's RegExp disagree
// \b: Python's \w is Unicode letters and numbers (not marks); JavaScript's is ASCII.
add('unicode/word-letter-before-key', J('é', AWS));
add('unicode/combining-mark-before-key', J('́', AWS));
add('unicode/greek-letter-after-key', J(AWS, 'α'));
add('unicode/superscript-after-key', J(AWS, '²'));
add('unicode/cjk-after-npm', J(CREDENTIALS.npm, '中'));
// \d: Python's is every decimal digit (Nd); its int() reads them.
add('unicode/arabic-indic-cpf', J(script('529.982.247', 0x660), '-', cpf('529982247').slice(-2)));
add('unicode/devanagari-phone', J('+55 (11) ', script('90000-0001', 0x966)));
add('unicode/fullwidth-card', J('card ', script(CARD, 0xff10)));
add('unicode/fullwidth-cnpj', script(cnpj('112223330001'), 0xff10));
add('unicode/mathematical-digits-amount', J('salary ', 'R$', ' ', script('9000', 0x1d7ce)));
add('unicode/bengali-cep', J('CEP ', script('99999999', 0x9e6)));
// \s: Python's has U+001C..U+001F and U+0085 and not U+FEFF; JavaScript's the reverse.
add('unicode/nel-in-street', J('Rua das Flores,\u0085', '123'));
add('unicode/nel-in-cep', J('CEP\u0085', '99999999'));
add('unicode/file-separator-before-amount', J('salary R$\u001c', '9.000'));
add('unicode/bom-before-amount', J('salary R$﻿', '9.000'));
add('unicode/nbsp-in-amount', J('salário R$ ', '9.000'));
add('unicode/ideographic-space-colleague', J('my　colleague ', 'Quillo Zyxwer'));
// case folding: Python's (?i) takes I for U+0130 and U+0131, K for U+212A, S for U+017F.
add('ignore-case/dotted-capital-I-in-CID', J('CİD F', '32.1'));
add('ignore-case/dotless-i-in-icd', J('ıcd-10 F', '41.1'));
add('ignore-case/upper-cue', J('SALÁRIO R$', ' 9.000'));
add('ignore-case/dotted-I-in-cue', J('SALÁRİO R$', ' 9.000'));
add('ignore-case/long-s-in-cue', J('ſalary R$', ' 9.000'));
add('ignore-case/kelvin-in-cue', J('stocK options R$', ' 9.000'));
add('ignore-case/kelvin-in-colleague', J('my coworKer ', 'Quillo Zyxwer'));
add('ignore-case/upper-colleague-prefix', J('MY COLLEAGUE ', 'Quillo Zyxwer'));
add('ignore-case/lower-name-is-not-a-name', 'my colleague quillo zyxwer');
add('ignore-case/cep-lower', J('cep ', '99999999'));
add('ignore-case/email-domain-upper', J('a', '@b.EXAMPLE.COM'));
add('ignore-case/credential-is-case-sensitive', J('akia', 'iosfodnn7example'));
// code points, not UTF-16 units: an astral character before each finding, and inside the contract window.
add('offsets/emoji-before-each', ['\u{1F600}', AWS, '\u{1F600}', EMAIL, '\u{1F600}', CPF, '\u{1F600}', J('CID F', '32.1')].join(' '));
add('offsets/emoji-in-contract-window', 'salário ' + '\u{1F600}'.repeat(70) + ' ' + AMOUNT);
add('offsets/emoji-beyond-contract-window', 'salário ' + '\u{1F600}'.repeat(81) + ' ' + AMOUNT);
add('offsets/astral-letters-in-term', J('\u{1D400}\u{1D401} ', 'zyxw quillon synthetic'), { salt: SALT, terms });
// normalisation of terms: casefold (ß to ss, final sigma), NFKD (combining accents, ligatures).
add('term/sharp-s-casefold', 'STRASSEWIX', { salt: SALT, terms: { employer: ['Straßewix'] } });
add('term/capital-sharp-s', 'straẞewix', { salt: SALT, terms: { employer: ['strassewix'] } });
add('term/final-sigma', 'ΖΥΞΩΣ', { salt: SALT, terms: { employer: ['ζυξως'] } });
add('term/combining-accent', 'Quillón', { salt: SALT, terms: { employer: ['Quillón'] } });
add('term/ligature', 'ﬁxwor', { salt: SALT, terms: { employer: ['fixwor'] } });
add('term/fullwidth', 'Ｚｙｘｗｏｌｄ', { salt: SALT, terms: { employer: ['zyxwold'] } });
add('term/leading-mark-skipped', '́zyxwold', { salt: SALT, terms: { employer: ['zyxwold'] } });
// overlaps and the merge in sanitise
add('overlap/key-inside-email', J(AWS.toLowerCase(), '@', 'fixture-mail.dev ', AWS));
add('overlap/pem-and-email', J(CREDENTIALS['private-key'], ' ', EMAIL));
add('lines/crlf', J('one\r\ntwo ', EMAIL, '\r\nthree ', CPF, '\r\n'));
add('empty', '');

export const CASES = cases;
