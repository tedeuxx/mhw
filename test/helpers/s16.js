// The S16 parity cases (#487): the paste filter's state machine, the cleaner, the notices and the
// argument rule, as data. test/helpers/s16-record.py plays them on paste_wrapper.py (the Python original)
// and test/golden/S16/answers.json holds what it answered; test/clipboard/paste-wrapper-golden.test.js plays
// them on src/commands/paste-wrapper.js and compares. Every payload is SYNTHETIC, assembled here, and is
// stored as hex, so no credential-shaped or address-shaped text sits in a tracked file.
export const SALT = '5a'.repeat(32);
export const TERM = 'Zyxw ' + 'Quillon Synthetic';
export const EMAIL = 'pessoa.sintetica@' + 'dominio-sintetico.com.br';
export const AWS = 'AKIA' + 'QQQQRRRRSSSSTTTT';
export const PHONE = '+55 (11) 9' + '0000-0001';
export const ADDRESS = 'CEP 01' + '000-000';
const S = '\x1b[200~';
const E = '\x1b[201~';
// The hold windows of paste_wrapper.py (HOLD_SECONDS, HOLD_SEQUENCE_SECONDS, PASTE_IDLE_SECONDS).
const HOLD = 0.025;
const SEQ = 1.0;
const IDLE = 2.0;

/** latin1 text (one char per byte) or a Buffer, as hex. @param {string | Buffer} s */
export const hex = (s) => (Buffer.isBuffer(s) ? s : Buffer.from(s, 'latin1')).toString('hex');
/** UTF-8 text as latin1 bytes. @param {string} s */
const u = (s) => Buffer.from(s, 'utf8').toString('latin1');

/**
 * @typedef {['feed', string] | ['advance', number] | ['flush']} Op
 * @typedef {{ name: string, max_bytes: number, conf?: Record<string, string>, cleaner?: 'plain' | 'term' | 'boom', ops: Op[] }} FilterCase
 */

/** @returns {FilterCase[]} */
export function filterCases() {
  /** @type {FilterCase[]} */
  const cases = [];
  /** @param {string} name @param {Op[]} ops @param {Partial<FilterCase>} [more] */
  const add = (name, ops, more = {}) => cases.push({ name, max_bytes: 1000, ops, ...more });
  const typed = Buffer.concat([Buffer.from(Array.from({ length: 256 }, (_, i) => i).filter((b) => b !== 0x1b)), Buffer.from('\x1b[A\x1b[B\x1bOP\x1b[I', 'latin1')]);
  add('typed-bytes', [['feed', hex(typed)]]);
  const stream = 'ab' + S + u('contact ' + EMAIL + ' now') + E + 'cd';
  for (let cut = 1; cut < stream.length; cut++) {
    add('redacted-split-' + cut, [['feed', hex(stream.slice(0, cut))], ['feed', hex(stream.slice(cut))], ['advance', 1], ['flush']]);
  }
  add('no-finding', [['feed', hex(Buffer.concat([Buffer.from(S, 'latin1'), Buffer.from(Array.from({ length: 95 }, (_, i) => i + 32)),
    Buffer.from('\r\n\t\xc3\xa9\xff\xfe', 'latin1'), Buffer.from(E, 'latin1')]))]]);
  add('lone-escape', [['feed', hex('\x1b')], ['advance', HOLD / 2], ['flush'], ['advance', HOLD], ['flush']]);
  for (let k = 1; k < S.length; k++) {
    add('marker-split-' + k, [['feed', hex(S.slice(0, k))], ['advance', HOLD * 4], ['flush'], ['feed', hex(S.slice(k) + 'mail ' + EMAIL + E + 'x')]]);
  }
  const rest = S.slice(1);
  for (let j = 1; j < rest.length; j++) {
    add('marker-split-1-and-' + j, [['feed', hex('\x1b')], ['advance', HOLD * 4], ['flush'], ['feed', hex(rest.slice(0, j))],
      ['advance', 0.1], ['flush'], ['feed', hex(rest.slice(j) + EMAIL + E)]]);
  }
  add('escape-then-x', [['feed', hex('\x1b')], ['advance', HOLD + 0.001], ['flush'], ['feed', hex('x')]]);
  add('escape-then-arrow', [['feed', hex('\x1b')], ['advance', HOLD + 0.001], ['flush'], ['feed', hex('[A')]]);
  add('escape-then-late-marker', [['feed', hex('\x1b')], ['advance', HOLD + 0.001], ['flush'], ['advance', SEQ + 0.1], ['feed', hex('[200~abc')]]);
  add('prefix-held-longer', [['feed', hex('\x1b[20')], ['advance', HOLD * 4], ['flush'], ['feed', hex('0~' + EMAIL + E)]]);
  add('alt-bracket', [['feed', hex('\x1b[')], ['advance', SEQ + 0.01], ['flush']]);
  const big = (EMAIL + ' ').repeat(20);
  add('too-large', [['feed', hex(S + big.slice(0, 300))], ['feed', hex(big.slice(300) + E + 'x')]], { max_bytes: 50 });
  add('limit-in-end-chunk', [['feed', hex(S + 'a'.repeat(45))], ['feed', hex('b'.repeat(10) + E + 'typed')]], { max_bytes: 50 });
  add('oversized-single-chunk', [['feed', hex(S + 'x'.repeat(30) + E + 'typed')]], { max_bytes: 10 });
  for (let size = 32; size <= 48; size++) {
    const st = S + 'p'.repeat(size) + E + 'after';
    for (let step = 1; step <= 16; step++) {
      /** @type {Op[]} */
      const ops = [];
      for (let i = 0; i < st.length; i += step) ops.push(['feed', hex(st.slice(i, i + step))]);
      add('limit-sweep-' + size + '-' + step, ops, { max_bytes: 40 });
    }
  }
  add('cleaner-error', [['feed', hex(S + EMAIL + E)]], { cleaner: 'boom' });
  add('phone-blocked', [['feed', hex(S + 'tel ' + PHONE + E)]]);
  const reportConf = { block_categories: 'CATEGORIES-EXCEPT-phone', report_categories: 'phone' };
  add('phone-report-only', [['feed', hex(S + 'tel ' + PHONE + ' mail ' + EMAIL + E)], ['feed', hex(S + 'tel ' + PHONE + E)]], { conf: reportConf });
  add('no-end-idle', [['feed', hex(S + EMAIL)], ['advance', IDLE + 0.1], ['flush']]);
  add('term-and-credential', [['feed', hex(S + u('deploy for ' + TERM.toUpperCase() + ' key ' + AWS + ' mail ' + EMAIL + '\rline two') + E)]], { cleaner: 'term' });
  add('invalid-utf8-around-finding', [['feed', hex(Buffer.concat([Buffer.from(S, 'latin1'), Buffer.from([0xff, 0xc3, 0x28, 0xe2, 0x82]),
    Buffer.from(' ' + EMAIL + ' ', 'latin1'), Buffer.from([0xed, 0xa0, 0x80, 0xf0, 0x9f, 0x98, 0x80, 0xc0, 0xaf]), Buffer.from(E, 'latin1')]))]]);
  add('accents-around-finding', [['feed', hex(S + u('olá ' + EMAIL + ' ção 😀') + E)]]);
  return cases;
}

/** @returns {Array<{ key: string, values: Record<string, string | number>, conf?: Record<string, string> }>} */
export function noticeCases() {
  return [
    { key: 'notice_paste_too_large', values: { max: '1000000' } },
    { key: 'notice_paste_error', values: { error: 'ValueError' } },
    { key: 'notice_no_bracketed_paste', values: { program: 'claude' } },
    { key: 'notice_bracketed_paste_off', values: { program: 'codex' } },
    { key: 'notice_session_summary', values: { count: 2, categories: 'credential, email', replaced: 1 } },
    { key: 'notice_wrapper_no_salt', values: {} },
    { key: 'notice_wrapper_args_unmarked', values: { categories: '-' } },
    { key: 'notice_session_report_only', values: { count: 1, categories: 'postal-address' } },
    { key: 'notice_kiro_hook_on', values: {} },
    { key: 'notice_kiro_hook_off', values: {} },
    { key: 'notice_no_bracketed_paste', values: { program: 'x' }, conf: { notice_no_bracketed_paste: 'mine {program} {{literal}}\r\nend' } },
    { key: 'notice_no_bracketed_paste', values: { program: 'x' }, conf: { notice_no_bracketed_paste: 'bad {nosuch}' } },
    { key: 'notice_no_bracketed_paste', values: { program: 'x' }, conf: { notice_no_bracketed_paste: 'bad {' } },
  ];
}

/** @returns {Array<{ args: string[], no_salt: boolean, boom?: boolean }>} */
export function argCases() {
  return [
    { args: [], no_salt: false },
    { args: ['-p', 'reply OK', '--model', 'x'], no_salt: false },
    { args: ['mail ' + EMAIL, AWS], no_salt: false },
    { args: ['reply OK'], no_salt: false, boom: true },
    { args: ['reply OK'], no_salt: true },
    { args: [], no_salt: true },
    { args: ['-p', 'key ' + AWS], no_salt: false },
  ].map((c) => ({ ...c, args: c.args.map((a) => hex(u(a))) }));
}
