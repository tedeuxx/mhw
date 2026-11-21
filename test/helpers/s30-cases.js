// The S30 parity cases (#500, convention 3 of #470): the method issue sync's commands, on the scenarios of
// the deleted .github/scripts/method_issue_sync_test.py plus the edges a port gets wrong (an empty
// argument list, the usage text, a body with a byte-order mark or CRLF, Unicode beside a credential
// shape, a symlinked sync directory). Every value is synthetic. Credential shapes are built
// by concatenation, as the Python suite built them, so no file here carries one. Placeholders in args,
// env and paths: {D} the case directory, {SYNC} the sync directory under it.

/** @typedef {import('./s30.js').Case} Case */
/** @typedef {import('./s30.js').Step} Step */

const MARKED = '<!-- mhw-issue: tedeuxx/mhw#7 -->\nhttps://github.com/tedeuxx/mhw/issues/7\n';
export const GOOD_BODY = '<!-- mhw-issue: tedeuxx/mhw#7 -->\nMirrored from https://github.com/tedeuxx/mhw/issues/7\n## What changes in the plugin\n- skills: x\n';

/** @param {string} name @param {string} [text] @returns {Step} */
const body = (name, text = GOOD_BODY) => ({ write: '{SYNC}/' + name, text });
/** @param {string[]} args @param {Partial<{ issue: string, env: Record<string, string | null> }>} [o] @returns {Step} */
const run = (args, o = {}) => ({ run: args, ...o });
/** @param {string} file @returns {string[]} */
const create = (file, title = '[mhw#7] T') => ['skills-create', '--title', title, '--body-file', '{SYNC}/' + file];
const TWIN = /** @type {Step} */ ({ twin: {} });
const SCRUBBED = { MHW_TOKEN: null, MHW_SKILLS_TOKEN: null, GITHUB_TOKEN: null };
const HELD = 'Zq7'.repeat(20);
// The pieces of a private-key header, joined only at run time.
const D5 = '-'.repeat(5);
const PK = 'PRIVATE' + ' KEY';
const KEYS = () => [
  'ghs_' + 'a'.repeat(36), 'github_pat_' + 'b'.repeat(30), 'sk-ant-' + 'c'.repeat(20),
  '-'.repeat(5) + 'BEGIN RSA ' + 'PRIVATE KEY' + '-'.repeat(5), 'AKIA' + 'D'.repeat(16),
];
/** @param {string} name @param {unknown} value @returns {Step} */
const exec = (name, value) => ({ json: '{D}/' + name, value });

/** @type {Case[]} */
export const CASES = [
  { name: 'usage', steps: [run([]), run(['issue', 'delete', '42']), run(['--help'])] },
  { name: 'scoped-by-repo-and-token', steps: [run(['mhw-view']), run(['find-twin']), body('b.md'), run(create('b.md'))] },
  { name: 'mhw-view-only-this-runs-issue', steps: [run(['mhw-view']), run(['mhw-view', '8'])] },
  { name: 'find-twin-by-marker', steps: [run(['find-twin']), TWIN, run(['find-twin']), run(['find-twin'], { issue: '70' })] },
  { name: 'create-refused-when-twin-exists', steps: [TWIN, body('b.md'), run(create('b.md', 'x'))] },
  {
    name: 'twin-body-marker-and-link',
    steps: [
      body('a.md', 'Mirrored from https://github.com/tedeuxx/mhw/issues/7\n'), run(create('a.md', 'x')),
      body('c.md', '<!-- mhw-issue: tedeuxx/mhw#7 -->\n'), run(create('c.md', 'x')),
      body('d.md', '<!-- mhw-issue: tedeuxx/mhw#70 -->\nhttps://github.com/tedeuxx/mhw/issues/70\n'), run(create('d.md', 'x')),
    ],
  },
  {
    name: 'body-file-under-the-sync-dir',
    steps: [
      { write: '{D}/outside.md', text: MARKED }, run(['skills-create', '--title', 'x', '--body-file', '{D}/outside.md']),
      run(['skills-create', '--title', 'x', '--body-file', '{SYNC}/../outside.md']),
      { symlink: '{SYNC}/link.md', target: '{D}/outside.md' }, run(['skills-create', '--title', 'x', '--body-file', '{SYNC}/link.md']),
      run(['skills-create', '--title', 'x', '--body-file', '-']),
      run(['skills-create', '--title', 'x', '--body-file', '{SYNC}']),
      run(['skills-create', '--title', 'x', '--body-file', '{SYNC}/missing.md']),
      { symlink: '{SYNC}/loop.md', target: '{SYNC}/loop.md' }, run(['skills-create', '--title', 'x', '--body-file', '{SYNC}/loop.md']),
    ],
  },
  {
    name: 'sync-dir-through-a-link',
    steps: [
      { mkdir: '{D}/real' }, { symlink: '{D}/via', target: '{D}/real' }, { write: '{D}/real/b.md', text: GOOD_BODY },
      run(create('../via/b.md'), { env: { MHW_SYNC_DIR: '{D}/via' } }),
      run(['find-twin']),
      run(create('b.md'), { env: { MHW_SYNC_DIR: '{D}/absent' } }),
    ],
  },
  {
    name: 'credentials-refused',
    steps: [
      ...KEYS().flatMap((leak, i) => [body('leak' + i + '.md', MARKED + leak + '\n'), run(create('leak' + i + '.md', 'x'))]),
      body('b.md'), run(create('b.md', 'ghp_' + 'e'.repeat(36))),
      // Python's \b is Unicode: a letter before or after the shape is a word character, so these pass.
      body('u1.md', MARKED + '\u00e9ghs_' + 'f'.repeat(36) + '\n'), run(create('u1.md', 'x')),
    ],
  },
  {
    name: 'credentials-unicode-boundaries',
    steps: [
      body('u2.md', MARKED + 'AKIA' + 'G'.repeat(16) + '\u00e9\n'), run(create('u2.md', 'x')),
      body('u3.md', MARKED + '\u0661AKIA' + 'H'.repeat(16) + '\n'), run(create('u3.md', 'y')),
    ],
  },
  {
    name: 'private-key-header-shapes',
    steps: [
      body('k1.md', MARKED + D5 + 'BEGIN ' + PK + D5 + '\n'), run(create('k1.md', 'x')),
      body('k2.md', MARKED + D5 + 'BEGIN ENCRYPTED ' + PK + 'S' + D5 + '\n' + D5 + 'BEGIN ' + PK + '----\n'), run(create('k2.md', 'x')),
      body('k3.md', MARKED + D5 + 'BEGIN ' + D5 + 'BEGIN OPENSSH ' + PK + D5 + '\n'), run(create('k3.md', 'x')),
    ],
  },
  {
    name: 'writes-only-to-the-twin',
    steps: [
      TWIN, body('b.md'), run(['skills-edit', '5', '--body-file', '{SYNC}/b.md']),
      body('h.md', 'hi'), run(['skills-comment', '6', '--body-file', '{SYNC}/h.md']),
      run(['skills-view', '5']),
      body('e.md'), run(['skills-edit', '42', '--title', '[mhw#7] T', '--body-file', '{SYNC}/e.md']),
      run(['skills-view', '42']), run(['skills-comment', '42', '--body-file', '{SYNC}/h.md']),
    ],
  },
  {
    name: 'unknown-commands-and-flags',
    steps: [
      TWIN, run(['skills-edit', '42', '--add-label', 'x']), run(['skills-create', '--title', 'x', '--body', 'inline']),
      run(['skills-close', '42', '--comment', 'x']), run(['mhw-view'], { issue: '7; rm' }), run(['mhw-view'], { issue: '07' }),
      run(['skills-edit', '42']), run(['skills-edit']), run(['skills-comment', '42']), run(['skills-comment']),
      run(['skills-edit', '42', '--title']), run(['skills-edit', '42', '--title', 'a', '--title', 'b']),
      run(['skills-create', '--title', 'x']), run(['skills-view']), run(['skills-view', '42', '43']),
      run(['find-twin', 'x']), run(['verify', 'x']), run(['backlink', 'x']), run(['stash-inputs', 'x']), run(['final-line']),
    ],
  },
  {
    name: 'state-mirrors-the-mhw-issue',
    steps: [
      TWIN, run(['skills-close', '42']), run(['skills-reopen', '42']),
      { reset: { mhw_state: 'CLOSED' } }, TWIN, run(['skills-reopen', '42']), run(['skills-close', '42']),
      { reset: { mhw_state: '' } }, TWIN, run(['skills-close', '42']), run(['skills-reopen', '42']),
    ],
  },
  {
    name: 'backlink-once',
    steps: [run(['backlink']), TWIN, run(['backlink']), run(['backlink'])],
  },
  {
    name: 'twin-must-be-app-authored',
    steps: [
      { twin: { number: 43, author: 'outsider' } }, run(['find-twin']), body('b.md'),
      run(['skills-edit', '43', '--body-file', '{SYNC}/b.md']), run(['skills-close', '43']),
      TWIN, run(['find-twin']), run(['backlink']),
    ],
  },
  { name: 'two-app-authored-twins', steps: [TWIN, { twin: { number: 44 } }, run(['find-twin']), body('b.md'), run(['skills-edit', '42', '--body-file', '{SYNC}/b.md'])] },
  {
    name: 'body-size-and-kind',
    steps: [
      body('big.md', MARKED + 'x'.repeat(60001)), run(create('big.md', 'x')),
      { mkdir: '{SYNC}/dir.md' }, run(create('dir.md', 'x')),
      body('blank.md', ' \n\t\u3000\n'), run(create('blank.md', 'x')),
      body('fit.md', MARKED + 'x'.repeat(60000 - Buffer.byteLength(MARKED))), run(create('fit.md', 'x')),
    ],
  },
  {
    name: 'body-bom-and-crlf',
    steps: [
      body('bom.md', '\ufeff' + GOOD_BODY), run(create('bom.md')),
      { reset: { mhw_state: 'OPEN' } }, body('crlf.md', GOOD_BODY.split('\n').join('\r\n')), run(create('crlf.md')),
      body('bomonly.md', '\ufeff'), run(['skills-comment', '900', '--body-file', '{SYNC}/bomonly.md']),
    ],
  },
  {
    name: 'title-is-one-line',
    steps: [
      body('b.md'), run(create('b.md', 'a\nb')), run(create('b.md', 'a\rb')), run(create('b.md', 'x'.repeat(257))),
      run(create('b.md', '')), run(create('b.md', '\u{1f600}'.repeat(256))),
    ],
  },
  {
    name: 'token-runs-refused',
    steps: [
      ...['MHW_SKILLS_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN', 'GITHUB_TOKEN', 'GH_TOKEN', 'MHW_TOKEN'].flatMap((name) => [
        body('t-' + name + '.md', MARKED + 'see ' + HELD.slice(5, 17) + '\n'),
        run(create('t-' + name + '.md', 'x'), { env: { [name]: HELD } }),
        body('g-' + name + '.md'), run(create('g-' + name + '.md', 't ' + HELD.slice(30, 42)), { env: { [name]: HELD } }),
      ]),
      body('t-short.md', MARKED + 'see ' + HELD.slice(5, 16) + '\n'), run(create('t-short.md', 'x'), { env: { MHW_SKILLS_TOKEN: HELD } }),
    ],
  },
  {
    name: 'refusals-do-not-echo-values',
    steps: [TWIN, run(['skills-edit', '42', '--sekrit-flag', 'VALUE-XYZ']), run(['skills-view', 'NUM-XYZ']), run(['skills-view', '77777'])],
  },
  {
    name: 'backlink-counts-only-github-actions',
    steps: [
      { reset: { mhw_state: 'OPEN', comments: [{ body: '<!-- mhw-twin: tedeuxx/tadeumendonca-skills#1 -->', author: { login: 'outsider' } }] } },
      TWIN, run(['backlink']), run(['backlink']),
    ],
  },
  {
    name: 'backlink-recognises-each-actions-login',
    steps: [
      { reset: { mhw_state: 'OPEN', comments: [{ body: 'x <!-- mhw-twin: tedeuxx/tadeumendonca-skills#1 -->', author: { login: 'github-actions[bot]' } }] } },
      TWIN, run(['backlink']),
      { reset: { mhw_state: 'OPEN', comments: [{ body: '<!-- mhw-twin: x', author: { login: 'app/github-actions' } }, { body: null, author: null }] } },
      TWIN, run(['backlink']), run(['backlink'], { env: { MHW_SYNC_DIR: null } }),
    ],
  },
  {
    name: 'backlink-needs-the-sync-dir',
    steps: [TWIN, run(['backlink'], { env: { MHW_SYNC_DIR: null } }), run(['backlink'], { env: { MHW_SYNC_DIR: '{D}/absent' } })],
  },
  {
    name: 'missing-input-exit-3',
    steps: [
      run(['mhw-view'], { env: SCRUBBED }), run(['find-twin'], { env: SCRUBBED }), run(['find-twin'], { env: { MHW_ISSUE: null } }),
      run(['skills-view', 'x']), run(['verify'], { env: { MHW_SKILLS_TOKEN: null } }),
    ],
  },
  {
    name: 'stashed-inputs-reach-a-scrubbed-subprocess',
    steps: [
      run(['stash-inputs'], { env: { MHW_INPUT_DIR: '{D}/method-sync-input' } }),
      run(['mhw-view'], { env: { ...SCRUBBED, MHW_ISSUE: null, MHW_SYNC_DIR: null, MHW_INPUT_DIR: '{D}/method-sync-input' } }),
      body('b.md'), run(create('b.md'), { env: { ...SCRUBBED, MHW_ISSUE: null, MHW_SYNC_DIR: null, MHW_INPUT_DIR: '{D}/method-sync-input' } }),
      run(['find-twin'], { env: { ...SCRUBBED, MHW_ISSUE: null, MHW_SYNC_DIR: null, MHW_INPUT_DIR: null, RUNNER_TEMP: '{D}' } }),
      run(['verify'], { env: { ...SCRUBBED, MHW_ISSUE: null, MHW_SYNC_DIR: null, MHW_INPUT_DIR: '{D}/method-sync-input' } }),
    ],
  },
  {
    name: 'stashed-input-whitespace',
    steps: [
      { mkdir: '{D}/in' }, { write: '{D}/in/MHW_ISSUE', text: ' 7\n' }, { write: '{D}/in/MHW_TOKEN', text: '\u3000tok-mhw\u3000' },
      { write: '{D}/in/MHW_SKILLS_TOKEN', text: '\ufefftok-skills\n' },
      run(['mhw-view'], { env: { ...SCRUBBED, MHW_ISSUE: null, MHW_INPUT_DIR: '{D}/in' } }),
      run(['find-twin'], { env: { ...SCRUBBED, MHW_ISSUE: null, MHW_INPUT_DIR: '{D}/in' } }),
      { write: '{D}/in/MHW_ISSUE', text: '\x1c7\x85' }, run(['mhw-view'], { env: { ...SCRUBBED, MHW_ISSUE: null, MHW_INPUT_DIR: '{D}/in' } }),
    ],
  },
  {
    name: 'stashed-tokens-count-for-the-token-run-check',
    steps: [
      run(['stash-inputs'], { env: { MHW_INPUT_DIR: '{D}/method-sync-input', MHW_SKILLS_TOKEN: 'Kq9'.repeat(20) } }),
      body('run.md', MARKED + 'see ' + 'Kq9'.repeat(20).slice(3, 15) + '\n'),
      run(create('run.md', 'x'), { env: { ...SCRUBBED, MHW_INPUT_DIR: '{D}/method-sync-input' } }),
    ],
  },
  {
    name: 'stash-refuses-to-replace-or-to-sit-in-the-write-dir',
    steps: [
      run(['stash-inputs'], { env: { MHW_INPUT_DIR: '{D}/method-sync-input' } }),
      run(['stash-inputs'], { env: { MHW_INPUT_DIR: '{D}/method-sync-input', MHW_TOKEN: 'tok-replaced' } }),
      { mkdir: '{D}/loose', mode: 0o755 }, run(['stash-inputs'], { env: { MHW_INPUT_DIR: '{D}/loose' } }),
      run(['stash-inputs'], { env: { MHW_INPUT_DIR: '{SYNC}/inputs' } }),
      run(['stash-inputs'], { env: { MHW_INPUT_DIR: '{SYNC}' } }),
      run(['stash-inputs'], { env: { MHW_INPUT_DIR: '{D}/other', MHW_SKILLS_TOKEN: null } }),
      run(['stash-inputs'], { env: { MHW_INPUT_DIR: null } }),
      run(['stash-inputs'], { env: { MHW_INPUT_DIR: null, RUNNER_TEMP: '{D}/rt' } }),
      run(['stash-inputs'], { env: { MHW_INPUT_DIR: '{D}/deep/er/inputs' } }),
    ],
  },
  {
    name: 'final-line-prints-the-result-only',
    steps: [
      exec('exec.json', [
        { type: 'system', subtype: 'init', tools: ['Bash'] },
        { type: 'assistant', message: { content: [{ type: 'tool_use', input: { command: 'TOOL-IN-XYZ' } }] } },
        { type: 'user', message: { content: [{ type: 'tool_result', content: 'TOOL-OUT-XYZ' }] } },
        { type: 'result', subtype: 'success', num_turns: 2, is_error: false, permission_denials: [{ tool_name: 'Bash' }], result: 'REFUSED  MISSING-INPUT MHW_TOKEN' },
      ]),
      run(['final-line', '{D}/exec.json'], { env: { MHW_ISSUE: null } }),
    ],
  },
  {
    name: 'final-line-denials-count',
    steps: [
      exec('count.json', [{ type: 'result', subtype: 'success', num_turns: 2, is_error: false, permission_denials_count: 3, permission_denials: [{}], result: 'r' }]),
      run(['final-line', '{D}/count.json']),
      exec('zero.json', [{ type: 'result', permission_denials_count: 0, result: 'r' }]), run(['final-line', '{D}/zero.json']),
      exec('none.json', [{ type: 'result', result: 'r' }]), run(['final-line', '{D}/none.json']),
      exec('bool.json', [{ type: 'result', permission_denials_count: true, permission_denials: [1, 2], result: 'r' }]), run(['final-line', '{D}/bool.json']),
      { write: '{D}/float.json', text: '[{"type": "result", "permission_denials_count": 2.0, "num_turns": 3.0, "is_error": null, "result": 0}]' },
      run(['final-line', '{D}/float.json']),
      { write: '{D}/shapes.json', text: '[{"type": "result", "subtype": ["a", {"b": 1}], "num_turns": 1e400, "is_error": "x", "result": {"k": [true, false, null]}}]' },
      run(['final-line', '{D}/shapes.json']),
    ],
  },
  {
    name: 'final-line-last-result-capped',
    steps: [
      exec('cap.json', [{ type: 'result', result: 'first' }, { type: 'result', result: 'y'.repeat(2500) }]), run(['final-line', '{D}/cap.json']),
      exec('cap2.json', [{ type: 'result', result: '\u{1f600}'.repeat(2001) }]), run(['final-line', '{D}/cap2.json']),
      exec('exact.json', [{ type: 'result', result: 'z'.repeat(2000) }]), run(['final-line', '{D}/exact.json']),
    ],
  },
  {
    name: 'final-line-never-fails-and-withholds',
    steps: [
      run(['final-line', '{D}/absent.json']), exec('obj.json', { x: 1 }), run(['final-line', '{D}/obj.json']),
      exec('noresult.json', [{ type: 'assistant' }]), run(['final-line', '{D}/noresult.json']), run(['final-line', '']),
      exec('leak.json', [{ type: 'result', result: 'ghs_' + 'q'.repeat(36) }]), run(['final-line', '{D}/leak.json']),
      { write: '{D}/bom.json', text: '\ufeff[{"type": "result", "result": "r"}]' }, run(['final-line', '{D}/bom.json']),
      { write: '{D}/bad.json', text: '[{"type": "result",' }, run(['final-line', '{D}/bad.json']),
      { mkdir: '{D}/dir.json' }, run(['final-line', '{D}/dir.json']),
      exec('held.json', [{ type: 'result', result: 'see ' + HELD.slice(2, 14) }]), run(['final-line', '{D}/held.json'], { env: { MHW_TOKEN: HELD } }),
      { write: '{D}/nan.json', text: '[{"type": "result", "num_turns": NaN, "is_error": -Infinity, "result": "r"}, 7, "result"]' },
      run(['final-line', '{D}/nan.json']),
    ],
  },
  {
    name: 'verify',
    steps: [
      run(['verify']), { twin: { state: 'CLOSED' } }, run(['verify']),
      { reset: { mhw_state: 'OPEN' } }, TWIN, run(['verify']),
      { reset: { mhw_state: 'CLOSED' } }, { twin: { state: 'CLOSED' } }, run(['verify']),
      { reset: { mhw_state: 'CLOSED' } }, TWIN, run(['verify']),
    ],
  },
  {
    name: 'token-values-never-printed',
    steps: [TWIN, run(['mhw-view']), run(['find-twin']), run(['skills-view', '42']), run(['backlink']), run(['skills-edit', '9'])],
  },
  {
    name: 'non-ascii-issue-data',
    steps: [
      { reset: { mhw_state: 'OPEN', skills: [{ number: 42, title: 'caf\u00e9 \u2014 \u{1f600} "q" \\ \t', state: 'OPEN', url: 'u42', author: { login: 'app/tedeuxx-mhw-mirror' }, body: '<!-- mhw-issue: tedeuxx/mhw#7 --> \u00f1' }] } },
      run(['find-twin']), run(['mhw-view']),
    ],
  },
  { name: 'gh-on-a-path-of-its-own', steps: [TWIN, run(['find-twin'], { env: { PATH: '{D}/bin' } }), run(['verify'], { env: { PATH: '{D}/bin' } })] },
];
