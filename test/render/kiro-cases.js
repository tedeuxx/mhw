// The S11 cases (#482): what test/render/kiro-permissions-golden.test.js runs on the Node renderer and, while
// the base revision still holds it, on global/kiro/kiro_permissions.py, and what test/golden/S11/ records.
//   READER   documents for the YAML subset reader: every document kiro_permissions_test.py parsed, every
//            Kiro-written shape it held (KIRO_STYLE and its folded and unquoted variants), and an edge corpus
//            for each branch of the reader (comments, quotes, escapes, line breaks, whitespace, indentation,
//            flow and block sequences, top-level keys, document markers).
//   SCALARS  tokens for the scalar reader on its own, including the ones a document cannot reach.
//   FLOORS   deny-floor files, as bytes, for the floor loader.
//   SCENARIOS command lines on a throwaway HOME, each a list of steps: a run of the renderer, or a fixture
//            change between runs. They port every command-line case of kiro_permissions_test.py and add the
//            usage, floor, admin-json, admin-validate and report cases its in-process tests reached directly.
export const STAMP = 'release: v9.9.9; commit: ' + 'a'.repeat(40);
export const OTHER = 'release: v9.9.8; commit: ' + 'b'.repeat(40);
export const FLOOR = '# a comment\ncmd sudo\ncmd gh auth token\nfile ~/.ssh/id_*\nfile **/.env\nglob terraform -chdir=*\n';
// The style the IDE's own writer emits, with an owner comment, an allow rule, and an owner deny equal to one
// floor pattern.
export const OWNER = '# my own rules\nrules:\n  - capability: shell\n    match:\n      - git *\n      - npm *\n    effect: allow\n'
  + '  - capability: shell\n    match:\n      - sudo *\n    effect: deny\n'
  + '  - capability: mcp\n    match: ["my-server/*"]\n    exclude: [\'my-server/dangerous-tool\']\n    effect: allow\n';
export const OWNER_RULES = [
  { capability: 'shell', effect: 'allow', match: ['git *', 'npm *'] },
  { capability: 'shell', effect: 'deny', match: ['sudo *'] },
  { capability: 'mcp', effect: 'allow', match: ['my-server/*'], exclude: ['my-server/dangerous-tool'] },
];
// What Kiro's writer (eemeli/yaml v2 stringify, lineWidth 80) leaves after a user-scope consent: no
// comments, plain scalars, quotes only where YAML needs them. The floor rules are FLOOR's, as appended.
/** @param {string} tail */
export const kiroStyle = (tail) => 'rules:\n  - capability: shell\n    effect: deny\n    match:\n      - sudo *\n'
  + '      - gh auth token *\n      - terraform -chdir=*\n  - capability: fs_read\n    effect: deny\n    match:\n'
  + '      - ~/.ssh/id_*\n      - "**/.env"\n  - capability: fs_write\n    effect: deny\n    match:\n      - ~/.ssh/id_*\n'
  + '      - "**/.env"\n  - capability: shell\n    effect: allow\n    match:\n' + tail;
export const FOLDED = '      - deploy-tool --environment production --region somewhere --profile somebody\n        --dry-run *\n';

const IMPLICIT = ['Yes', 'OFF', '1.5e3', '-.INF', '190:20:30.15', '0x1F', '0b1010', '190:20:30', '685_230', '02472256', '<<',
  '~', 'NULL', '2026-10-11', '2001-12-14t21:59:43.10-05:00', '2001-12-14T21:59:43.10Z', '2001-12-14 21:59:43.10 -5', '='];
const NOT_STRINGS = ['.5', '1e3', '0x1F', '0o7', '0b101', '.inf', '-.INF', '.nan', '.NaN', '~', 'null', 'NULL', 'nUlL', 'true',
  'TrUe', 'FALSE', 'yes', 'Off', '1_000', '-1', '+.5', '1.', '12:30', '3E-2'];
const STRINGS = ['git *', 'e5', 'v1.2', 'true-ish', '1a', '.', 'nullx', '~/x'];
/** @param {string} tok */
const inMatch = (tok) => [
  'rules:\n  - capability: ' + tok + '\n    effect: deny\n',
  'rules:\n  - capability: shell\n    match: [' + tok + ']\n    effect: deny\n',
  'rules:\n  - capability: shell\n    match:\n      - ' + tok + '\n    effect: deny\n',
];
/** @param {string} body a rule body after "  - capability: shell\n" */
const shell = (body) => 'rules:\n  - capability: shell\n' + body;

// An allow rule and an excluded deny: neither covers the floor.
export const ALLOW_OR_EXCLUDED = 'rules:\n  - capability: shell\n    match: [\'sudo *\']\n    effect: allow\n  - capability: shell\n'
  + '    match: [\'gh auth token *\']\n    exclude: [\'gh auth token x\']\n    effect: deny\n';

export const READER = [
  // kiro_permissions_test.py, Reader and Install
  OWNER,
  'rules:\n  - capability: fs_write\n    match: ["*.env", "*.pem", "*.key"]\n    effect: deny\n'
    + '  - capability: shell\n    match: ["rm -rf *", "sudo *"]\n    effect: deny\n  - capability: fs_read\n    effect: allow\n',
  'rules:\n- capability: shell\n  match:\n  - git *\n  effect: allow\n',
  '',
  'policies: [read-only]\nrules: []\n',
  'rules:\n  - capability: shell\n    effect: deny\n    note: x\n',
  'rules:\n  - capability: shell\n    effect: block\n',
  'rules:\n  - effect: deny\n',
  'rules:\n  - &a capability: shell\n    effect: deny\n',
  'rules:\n  - capability: shell\n    match: [*x]\n    effect: deny\n',
  'rules:\n  - {capability: shell, effect: deny}\n',
  'rules:\n  - capability: shell\n    match: |\n      x\n    effect: deny\n',
  'rules:\n  - capability: true\n    effect: deny\n',
  'other: 1\nrules: []\n',
  'rules: 3\n',
  ...IMPLICIT.map((t) => 'rules:\n  - capability: shell\n    match:\n      - ' + t + '\n    effect: deny\n'),
  ...NOT_STRINGS.flatMap(inMatch),
  ...STRINGS.map((t) => 'rules:\n  - capability: shell\n    match:\n      - ' + t + '\n    effect: deny\n'),
  kiroStyle('      - ls *\n'),
  kiroStyle(FOLDED),
  kiroStyle('      - yes\n'),
  ALLOW_OR_EXCLUDED,
  'rules: []\n',
  'rules:\n  - capability: shell\n    effect: deny\n    comment: mine\n',
  // comments
  '# c\nrules: [] # trailing\n',
  shell('    effect: deny # why\n    match: [a] #x\n'),
  '#only a comment\n',
  'rules: []\n#x\n   # indented comment\n',
  shell('    effect: deny\n    match: ["a #b", \'c #d\', e#f]\n'),
  shell('    effect: deny\n    match:\n      - a #b\n      - c#d\n'),
  shell('    effect: deny\n    match: ["abc]\n'),
  shell("    effect: deny\n    match: ['abc]\n"),
  shell("    effect: deny\n    match: ['it''s']\n"),
  // quoted scalars
  shell('    effect: deny\n    match: ["a\\"b", "\\u00e9 *", "\\ud83d\\ude00 *", "tab\\there", "\\/x"]\n'),
  shell('    effect: deny\n    match: ["\\x41"]\n'),
  shell('    effect: deny\n    match:\n      - "a" "b"\n'),
  shell("    effect: deny\n    match:\n      - 'a'b'\n      - x\n"),
  shell("    effect: deny\n    match:\n      - ''\n      - \"\"\n      - 'a''''b'\n"),
  shell("    effect: deny\n    match:\n      - '\n"),
  shell('    effect: "deny"\n    match: [\'sudo *\']\n'),
  shell('    effect: Deny\n'),
  'rules:\n  - capability: "shell"\n    effect: \'ask\'\n    exclude: []\n    match: []\n',
  shell('    effect: deny\n    match: ["a\tb"]\n'),
  shell('    effect: deny\n    match:\n      - "\\ud800"\n'),
  // document markers
  '---\nrules: []\n',
  'rules: []\n---\n',
  '---\n---\nrules: []\n',
  '...\nrules: []\n...\n',
  'rules: []\n...\n',
  // whitespace and line breaks
  'rules:\n\t- capability: shell\n',
  'rules: []\t\n',
  'rules: []\u00a0\n',
  '\u00a0rules: []\n',
  '  \u00a0rules: []\n',
  'rules:\u3000[]\n',
  'rules:\r\n  - capability: shell\r\n    effect: deny\r\n',
  'rules:\r  - capability: shell\r    effect: deny\r',
  'rules:\x85  - capability: shell\x85    effect: deny\x85',
  'rules:\u2028  - capability: shell\u2029    effect: deny\n',
  'rules:\v  - capability: shell\f    effect: deny\n',
  'rules:\x1c  - capability: shell\x1d    effect: deny\x1e',
  'rules: []\x1f\n',
  'rules:\x1f[]\n',
  '\ufeffrules: []\n',
  'rules: []\n\n\n',
  '\n\nrules: []',
  // keys
  'rules  : []\n',
  'rules :[]\n',
  'rules:[]\n',
  'Rules: []\n',
  'rules: [ ]\n',
  'rules:\n',
  'rules\n',
  '9rules: []\n',
  'rules: []\nrules: []\n',
  '  rules: []\n',
  'rules:\n  - capability: shell\n    effect: deny\n  extra: 1\n',
  'rules:\n  - capability: shell\n    effect: deny\n - x\n',
  'rules:\n  - capability: shell\n    effect: deny\nother: 1\n',
  'policies:\n  - a\n  - \'b\'\nrules: []\n',
  'policies: []\nrules: []\n',
  'policies:\nrules: []\n',
  'policies: [a, [b]]\nrules: []\n',
  'policies: a\nrules: []\n',
  'policies: []\npolicies: []\nrules: []\n',
  'policies: [a]\n',
  'policies:\n- a\n- b\nrules:\n- capability: fs_read\n  effect: allow\n',
  // flow sequences
  shell('    effect: deny\n    match: [a, b]\n'),
  shell('    effect: deny\n    match: [a,]\n'),
  shell('    effect: deny\n    match: [,]\n'),
  shell('    effect: deny\n    match: [ ]\n'),
  shell('    effect: deny\n    match: [a, , b]\n'),
  shell('    effect: deny\n    match: ["a,b", \'c,d\']\n'),
  shell('    effect: deny\n    match: [a, {b}]\n'),
  shell('    effect: deny\n    match: [\'it\'\'s\', "q\\"x", "back\\\\"]\n'),
  shell('    effect: deny\n    match: [a\n'),
  shell('    effect: deny\n    match: a]\n'),
  // rules
  'rules:\n  -   capability: shell\n      effect: deny\n      match: [a]\n',
  'rules:\n  -   capability: shell\n    effect: deny\n',
  'rules:\n  -\n    capability: shell\n    effect: deny\n',
  'rules:\n  - {capability: shell}\n',
  shell('    effect: deny\n    effect: allow\n'),
  shell('    effect:\n'),
  shell('    match:\n    effect: deny\n'),
  shell('    effect: deny\n    match:\n      - a\n        b\n'),
  shell('    effect: deny\n    match:\n      -\n'),
  shell('    effect: deny\n    match:\n    - a\n    - b\n    exclude:\n    - c\n'),
  shell('    effect: deny\n    exclude:\n      - c\n    match: [d]\n'),
  shell('    effect: deny\n      match: [a]\n'),
  shell('    effect: deny\n    match: [a]\n    capability: fs_read\n'),
  'rules:\n  - capability: shell\n    effect: deny\n  - capability: fs_read\n    effect: deny\n    match:\n      - "~/.x"\n',
  shell('    effect: deny\n    match:\n      - - x\n'),
  // plain scalars refused or kept
  ...['& x', '? x', ': x', '-', '%x', '@x', '`x', '|', '>', '!tag', '*alias', '&anchor', '}', ',x', 'x: y', 'x:', 'a :b']
    .map((t) => shell('    effect: deny\n    match:\n      - ' + t + '\n')),
  shell('    effect: deny\n    match:\n      - café *\n      - 😀 *\n      - del\x7f\n      - a:b\n      - a-b\n      - ?x\n'),
];

export const SCALARS = ['git *', '  padded  ', '', '   ', '"x"', '"x', '"\\q"', "'x'", "'x", "'", "'a'b'", "'a''b'", "''", '"a" # c',
  'a #b', 'a: b', 'a:', '- x', '? x', ': x', '-', '--', '-x', '&x', '*x', '!x', '|x', '>x', '{x', '}x', '%x', '@x', '`x', ',x', '[x',
  ']x', '#x', 'x#y', ...IMPLICIT, ...NOT_STRINGS, ...STRINGS, 'TRUE', 'Null', '0X1f', '0O7', '0B1', '1__2', '1:2:3', '1:', ':1',
  '1.2.3', '1e', 'e1', '.e1', '+', '+-1', '2026-1-1', '2026-01-01T1:00:00', '2026-01-01 1:00:00 +01:00', '2026-01-01  1:00:00',
  '2026-01-01\t1:00:00', '2026-01-01T1:00:00.5 z', '2026-01-01T1:00:00+1', '2026-01-01X', '\u212ay', 'ＴＲＵＥ', 'İnf'];

/** @param {string} s */
const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');
/** @type {Array<{ name: string, b64: string | null }>} null: no file */
export const FLOORS = [
  { name: 'the test floor', b64: b64(FLOOR) },
  { name: 'repeats kept once', b64: b64('cmd sudo\ncmd sudo\nfile a\nfile a\nglob x*\nglob x*\ncmd x\nglob x *\n') },
  { name: 'comments and blank lines', b64: b64('\n  \n# c\n  # indented\n\tcmd sudo  \n') },
  { name: 'crlf', b64: b64('cmd sudo\r\nfile ~/.x\r\n') },
  { name: 'cr only', b64: b64('cmd sudo\rfile ~/.x\r') },
  { name: 'unicode separators', b64: b64('cmd\u00a0sudo\u2028file ~/.x\x85glob a\u3000b*\n') },
  { name: 'a byte order mark', b64: b64('\ufeffcmd sudo\n') },
  { name: 'an unknown kind', b64: b64('deny sudo\n') },
  { name: 'a kind alone', b64: b64('cmd\n') },
  { name: 'a word outside the set', b64: b64('cmd rm -rf $HOME\n') },
  { name: 'a cmd word holding a star', b64: b64('cmd rm -rf *\n') },
  { name: 'a file entry of two paths', b64: b64('file a b\n') },
  { name: 'only comments', b64: b64('# nothing\n\n') },
  { name: 'empty', b64: '' },
  { name: 'invalid start byte', b64: Buffer.from('cmd sudo\n\xff\n', 'latin1').toString('base64') },
  { name: 'truncated sequence', b64: Buffer.from([0x63, 0xe2, 0x82]).toString('base64') },
  { name: 'invalid continuation', b64: Buffer.from([0x63, 0xe2, 0x82, 0x28]).toString('base64') },
  { name: 'a surrogate encoded', b64: Buffer.from([0xed, 0xa0, 0x80]).toString('base64') },
  { name: 'four-byte truncated', b64: Buffer.from([0xf0, 0x90]).toString('base64') },
  { name: 'missing', b64: null },
];

// --- command-line scenarios ---------------------------------------------------------------------------
// A step is ['run', ...args] or a fixture change: ['write', rel, text, mode?], ['bytes', rel, base64],
// ['mkdir', rel], ['rmdir', rel], ['rm', rel], ['chmod', rel, mode], ['symlink', rel, target]. In an
// argument and a symlink target {HOME} is the throwaway home; P is the permissions.yaml path under it.
export const P = '.kiro/settings/permissions.yaml';
const OWNED = '.local/share/personal-multi-harness-workstation-configuration/kiro-permissions-owned.json';
const F = '--floor={HOME}/floor.conf';
/** @param {string} mode @param {...string} more */
const r = (mode, ...more) => ['run', '--mode=' + mode, '--stamp=' + STAMP, F, ...more];
const NAME = 'personal-multi-harness-workstation-configuration';
const MARK = 'managed-by: ' + NAME + '; source: global/install-managed.sh via x; ' + STAMP + '; do not edit';
const FLOOR_RULES = [
  { capability: 'shell', effect: 'deny', match: ['sudo *', 'gh auth token *', 'terraform -chdir=*'] },
  { capability: 'fs_read', effect: 'deny', match: ['~/.ssh/id_*', '**/.env'] },
  { capability: 'fs_write', effect: 'deny', match: ['~/.ssh/id_*', '**/.env'] },
];
/** @param {unknown} rules @param {Record<string, unknown>} [extra] */
const admin = (rules, extra = {}) => JSON.stringify({ [NAME]: MARK, rules, ...extra });
/** @param {string} rel @param {string} json */
const validate = (rel, json) => [['write', rel, json], ['run', '--mode=admin-validate', '--file={HOME}/' + rel]];
const SUDO_ONLY = ['write', 'floor.conf', 'cmd sudo\n'];
const ON = ['  - capability: shell', '    effect: deny', '    match:'];

/**
 * @typedef {Array<string | number>} Step
 * @typedef {{ name: string, posix?: boolean, env?: Record<string, string>, steps: Step[] }} Scenario
 */
/** @type {Scenario[]} */
export const SCENARIOS = [
  { name: 'fresh-home-settles', steps: [r('check'), r('dry-run'), r('install'), r('check'), r('install'), r('report'),
    ['run', '--mode=check', '--stamp=' + OTHER, F], r('report', '--admin={HOME}/no-admin.json'), r('uninstall'), r('check'), r('uninstall')] },
  { name: 'owner-rules-kept-backup-private', steps: [['write', P, OWNER, 0o644], r('check'), r('dry-run'), r('install'),
    r('check'), r('install'), r('uninstall'), r('check')] },
  { name: 'owner-file-mode-kept', posix: true, steps: [['write', P, OWNER, 0o640], r('install'), r('uninstall')] },
  { name: 'kiro-plain-rewrite-restamped', steps: [r('install'), ['write', P, kiroStyle('      - ls *\n')], r('check'), r('install'), r('check')] },
  { name: 'kiro-folded-rewrite-refused', steps: [r('install'), ['write', P, kiroStyle(FOLDED)], r('check'), r('install'), r('report'), r('uninstall')] },
  { name: 'kiro-yes-rewrite-refused', steps: [r('install'), ['write', P, kiroStyle('      - yes\n')], r('check'), r('install')] },
  { name: 'a-held-lock-refuses', steps: [['write', P, OWNER], ['mkdir', P + '.lock'], r('install'), r('uninstall'), r('check'),
    ['rmdir', P + '.lock'], r('install')] },
  { name: 'other-stamp-reads-stamp', steps: [r('install'), ['run', '--mode=check', '--stamp=' + OTHER, F],
    ['run', '--mode=install', '--stamp=' + OTHER, F], r('check')] },
  { name: 'a-consent-pattern-leaves-the-rule-whole', steps: [r('install'),
    ['write', P, 'rules:\n' + ON.join('\n') + '\n      - sudo *\n      - gh auth token *\n      - terraform -chdir=*\n      - curl *\n'
      + '  - capability: fs_read\n    effect: deny\n    match: ["~/.ssh/id_*", "**/.env"]\n'
      + '  - capability: fs_write\n    effect: deny\n    match: ["~/.ssh/id_*", "**/.env"]\n'], r('uninstall')] },
  { name: 'created-file-removed-on-uninstall', steps: [r('install'), r('uninstall')] },
  { name: 'an-allow-or-excluded-deny-is-not-the-floor', steps: [['write', P, ALLOW_OR_EXCLUDED], r('install'), r('uninstall')] },
  { name: 'his-empty-file-stays', steps: [['write', P, 'rules: []\n'], r('install'), r('uninstall')] },
  { name: 'his-policies-kept', steps: [['write', P, 'policies: [read-only, "x y"]\nrules: []\n'], r('install'), r('uninstall'),
    ['write', P, 'policies: []\nrules: []\n'], r('install'), r('uninstall')] },
  { name: 'created-file-with-policies-stays', steps: [r('install'),
    ['write', P, 'policies: [a]\nrules:\n  - capability: shell\n    effect: deny\n    match: ["sudo *", "gh auth token *", "terraform -chdir=*"]\n'
      + '  - capability: fs_read\n    effect: deny\n    match: ["~/.ssh/id_*", "**/.env"]\n'
      + '  - capability: fs_write\n    effect: deny\n    match: ["~/.ssh/id_*", "**/.env"]\n'], r('uninstall')] },
  { name: 'no-record-removes-nothing', steps: [['write', P, OWNER], r('install'), ['rm', OWNED], r('uninstall'), r('install')] },
  { name: 'no-record-no-file', steps: [r('uninstall')] },
  { name: 'record-without-file', steps: [r('install'), ['rm', P], r('uninstall')] },
  { name: 'record-not-json', steps: [['write', P, OWNER], r('install'), ['write', OWNED, '{not json'], r('install'), r('uninstall')] },
  { name: 'record-shapes-filtered', steps: [['write', P, OWNER], r('install'),
    ['write', OWNED, JSON.stringify({ created: 1, appended: [{ capability: 'shell', match: ['gh auth token *', 'terraform -chdir=*'] },
      'x', { capability: 'mcp', match: ['a'] }, { capability: 'shell', match: [] }, { capability: 'shell', match: [1] },
      { capability: 'fs_read', match: 'x' }, { capability: 'fs_read', match: ['~/.ssh/id_*', '**/.env'] }] })],
    r('install'), r('uninstall')] },
  { name: 'record-not-a-dict', steps: [['write', P, OWNER], r('install'), ['write', OWNED, '[1]'], r('uninstall'),
    ['write', OWNED, '{"appended": 3}'], r('uninstall'), ['write', OWNED, '{"appended": [], "x": NaN}'], r('uninstall')] },
  { name: 'floor-grows-appends-the-new-pattern', steps: [r('install'), ['write', 'grown.conf', FLOOR + 'cmd git push --force\n'],
    ['run', '--mode=install', '--stamp=' + STAMP, '--floor={HOME}/grown.conf'], ['run', '--mode=uninstall', '--stamp=' + STAMP, '--floor={HOME}/grown.conf']] },
  { name: 'his-rules-holding-owned-patterns-untouched', steps: [
    ['write', P, 'rules:\n  - capability: shell\n    effect: allow\n    match: ["sudo *", "gh auth token *", "terraform -chdir=*"]\n'
      + '  - capability: fs_read\n    effect: deny\n    match: ["~/.ssh/id_*", "**/.env"]\n    exclude: ["a/.env"]\n'],
    r('install'),
    ['write', P, 'rules:\n  - capability: shell\n    effect: allow\n    match: ["sudo *", "gh auth token *", "terraform -chdir=*"]\n'
      + '  - capability: fs_read\n    effect: deny\n    match: ["~/.ssh/id_*", "**/.env"]\n    exclude: ["a/.env"]\n'
      + '  - capability: shell\n    effect: deny\n    match: ["sudo *", "gh auth token *", "terraform -chdir=*"]\n'
      + '  - capability: fs_read\n    effect: deny\n    match: ["~/.ssh/id_*", "**/.env"]\n'
      + '  - capability: fs_write\n    effect: deny\n    match: ["~/.ssh/id_*", "**/.env"]\n'
      + '  - capability: shell\n    effect: deny\n    match: ["sudo *", "gh auth token *", "terraform -chdir=*", "curl *"]\n'],
    r('uninstall')] },
  { name: 'a-stale-record-never-claims-his-rule', steps: [SUDO_ONLY, r('install'),
    ['write', P, 'rules:\n  - capability: shell\n    effect: allow\n    match: ["ls *"]\n'], r('install'),
    ['write', P, 'rules:\n  - capability: shell\n    effect: allow\n    match: ["ls *"]\n  - capability: shell\n    effect: deny\n'
      + '    match: ["sudo *"]\n  - capability: shell\n    effect: deny\n    match: ["sudo *", "curl *"]\n'], r('uninstall')] },
  { name: 'reconciled-even-when-nothing-is-missing', steps: [SUDO_ONLY, r('install'),
    ['write', P, '# ' + 'managed-by: ' + NAME + '; source: x; ' + STAMP + '; re-run\nrules:\n  - capability: shell\n    effect: deny\n'
      + '    match: ["sudo *", "curl *"]\n'], r('install'), r('uninstall')] },
  { name: 'each-entry-matches-a-distinct-rule', steps: [SUDO_ONLY, r('install'),
    ['write', OWNED, JSON.stringify({ created: true, appended: [{ capability: 'shell', match: ['sudo *'] }, { capability: 'shell', match: ['sudo *'] }] })],
    ['write', P, 'rules:\n  - capability: shell\n    effect: deny\n    match: ["sudo *"]\n  - capability: shell\n    effect: allow\n    match: ["sudo *"]\n'],
    r('uninstall')] },
  { name: 'the-exact-rule-is-preferred', steps: [SUDO_ONLY, r('install'),
    ['write', P, 'rules:\n  - capability: shell\n    effect: deny\n    match: ["sudo *", "curl *"]\n  - capability: shell\n    effect: deny\n    match: ["sudo *"]\n'],
    r('uninstall')] },
  { name: 'a-recorded-rule-edited-by-hand-is-left', steps: [r('install'),
    ['write', P, 'rules:\n  - capability: shell\n    effect: deny\n    match: ["terraform -chdir=*", "gh auth token *", "sudo *"]\n'
      + '  - capability: fs_read\n    effect: deny\n    match: ["~/.ssh/id_*", "**/.env"]\n'
      + '  - capability: fs_write\n    effect: deny\n    match: ["~/.ssh/id_*", "**/.env"]\n'], r('uninstall')] },
  { name: 'a-symbolic-link-is-written-through', posix: true, steps: [['write', 'dotfiles/permissions.yaml', OWNER], ['mkdir', '.kiro/settings'],
    ['symlink', P, '{HOME}/dotfiles/permissions.yaml'], r('install'), r('check'), r('uninstall')] },
  { name: 'a-relative-link-and-a-dangling-link', posix: true, steps: [['mkdir', '.kiro/settings'], ['symlink', P, '../../dotfiles/p.yaml'],
    r('check'), r('install'), ['rm', P], ['symlink', P, 'elsewhere.yaml'], r('install'), r('uninstall')] },
  { name: 'json-beside-is-refused', steps: [['write', '.kiro/settings/permissions.json', '{"rules": []}'], r('install'), r('check'),
    r('report'), r('uninstall'), r('dry-run')] },
  { name: 'empty-json-beside-is-accepted', steps: [['write', '.kiro/settings/permissions.json', ' \n\t'], r('install'), r('check')] },
  { name: 'unreadable-json-beside-is-refused', steps: [['mkdir', '.kiro/settings/permissions.json'], r('install')] },
  { name: 'undecodable-json-beside-is-refused', steps: [['bytes', '.kiro/settings/permissions.json', Buffer.from([0xff]).toString('base64')], r('check')] },
  { name: 'a-file-kiro-would-reject-is-untouched', steps: [['write', P, 'rules:\n  - capability: shell\n    effect: deny\n    comment: mine\n'],
    r('install'), r('check'), r('dry-run'), r('report'), r('uninstall')] },
  { name: 'an-undecodable-file-is-left', steps: [['bytes', P, Buffer.from('rules: []\n\xff', 'latin1').toString('base64')], r('install'), r('report')] },
  { name: 'an-unreadable-file-is-left', posix: true, steps: [['write', P, OWNER], ['chmod', P, 0], r('install'), r('report'), ['chmod', P, 0o644]] },
  { name: 'a-directory-at-the-target', steps: [['mkdir', P], r('install'), r('check')] },
  { name: 'xdg-data-home-holds-the-record', env: { XDG_DATA_HOME: '{HOME}/xdg' }, steps: [r('install'), r('uninstall')] },
  { name: 'usage', steps: [['run'], ['run', '--mode=install'], ['run', '--mode=install', '--stamp=' + STAMP],
    ['run', '--mode=nope', '--stamp=' + STAMP, F], ['run', '--mode=install', '--stamp=', F], ['run', '--mode=install', '--stamp=' + STAMP, '--floor='],
    ['run', '--mode=install', '--stamp=' + STAMP, F, '--bogus=1'], ['run', '--mode=install', '--mode=check', '--stamp=' + STAMP, F],
    ['run', '--mode=install', '--stamp=' + STAMP, F, 'extra'], ['run', '--mode=check', '--stamp=' + STAMP, F, '--admin=/x'],
    ['run', '--mode=install', '--stamp=' + STAMP, F, '--from-yaml=/x'], ['run', '--mode=install', '--stamp=' + STAMP, F, '--file=/x'],
    ['run', '--mode=report', '--stamp=' + STAMP, F, '--admin='], ['run', '--mode=admin-validate'],
    ['run', '--mode=admin-validate', '--file=/x', '--stamp=x'], ['run', '--mode=admin-json', '--stamp=' + STAMP],
    ['run', '--mode=admin-json', '--stamp=', '--from-yaml=/x'], ['run', '--mode=admin-json', '--stamp=' + STAMP, '--from-yaml=/x', F],
    ['run', '--stamp=' + STAMP, F], ['run', '--mode=check', '--stamp=' + STAMP, F, '--floor-from=']] },
  { name: 'floor-from-names-the-source', steps: [['run', '--mode=install', '--stamp=' + STAMP, F, '--floor-from=global/deny-floor.conf + overlay'], r('check')] },
  { name: 'the-floor-is-refused', steps: [['write', 'bad.conf', 'cmd rm -rf *\n'], ['run', '--mode=install', '--stamp=' + STAMP, '--floor={HOME}/bad.conf'],
    ['run', '--mode=check', '--stamp=' + STAMP, '--floor={HOME}/missing.conf'], ['write', 'empty.conf', '# none\n'],
    ['run', '--mode=uninstall', '--stamp=' + STAMP, '--floor={HOME}/empty.conf'], ['bytes', 'u.conf', Buffer.from('cmd \xe9\n', 'latin1').toString('base64')],
    ['run', '--mode=report', '--stamp=' + STAMP, '--floor={HOME}/u.conf'], ['mkdir', 'dir.conf'], ['run', '--mode=check', '--stamp=' + STAMP, '--floor={HOME}/dir.conf']] },
  { name: 'admin-json-is-the-floor-install-rendered', steps: [r('install'), ['run', '--mode=admin-json', '--stamp=' + STAMP, '--from-yaml={HOME}/' + P],
    ['run', '--mode=admin-json', '--stamp=release: v1; commit: c', '--from-yaml={HOME}/' + P],
    ['run', '--mode=admin-json', '--stamp=no provenance', '--from-yaml={HOME}/' + P]] },
  { name: 'admin-json-refusals', steps: [['write', 'owner.yaml', OWNER], ['run', '--mode=admin-json', '--stamp=' + STAMP, '--from-yaml={HOME}/owner.yaml'],
    ['run', '--mode=admin-json', '--stamp=' + STAMP, '--from-yaml={HOME}/missing.yaml'], ['write', 'empty.yaml', 'rules: []\n'],
    ['run', '--mode=admin-json', '--stamp=' + STAMP, '--from-yaml={HOME}/empty.yaml'], ['write', 'bad.yaml', 'rules: 3\n'],
    ['run', '--mode=admin-json', '--stamp=' + STAMP, '--from-yaml={HOME}/bad.yaml'],
    ['write', 'excl.yaml', 'rules:\n  - capability: shell\n    effect: deny\n    match: [a]\n    exclude: [b]\n'],
    ['run', '--mode=admin-json', '--stamp=' + STAMP, '--from-yaml={HOME}/excl.yaml'],
    ['write', 'mcp.yaml', 'rules:\n  - capability: mcp\n    effect: deny\n    match: [a]\n'],
    ['run', '--mode=admin-json', '--stamp=' + STAMP, '--from-yaml={HOME}/mcp.yaml'],
    ['write', 'nomatch.yaml', 'rules:\n  - capability: shell\n    effect: deny\n    exclude: []\n  - capability: fs_write\n    effect: deny\n    match: ["~/.x", "~/.x", "\\u00e9"]\n'],
    ['run', '--mode=admin-json', '--stamp=' + STAMP, '--from-yaml={HOME}/nomatch.yaml'],
    ['bytes', 'u.yaml', Buffer.from([0x72, 0xff]).toString('base64')], ['run', '--mode=admin-json', '--stamp=' + STAMP, '--from-yaml={HOME}/u.yaml']] },
  { name: 'admin-validate', steps: [
    ...validate('good.json', admin(FLOOR_RULES)),
    ...validate('extra.json', admin([{ ...FLOOR_RULES[0], extra: 1 }])),
    ...validate('allow.json', admin([{ ...FLOOR_RULES[0], effect: 'allow' }])),
    ...validate('norules.json', admin([])),
    ...validate('rulesobj.json', admin({})),
    ...validate('emptymatch.json', admin([{ ...FLOOR_RULES[0], match: [] }])),
    ...validate('nomatch.json', admin([{ capability: 'shell', effect: 'deny' }])),
    ...validate('settings.json', admin(FLOOR_RULES, { settings: {} })),
    ...validate('noname.json', JSON.stringify({ rules: FLOOR_RULES })),
    ...validate('nostamp.json', JSON.stringify({ [NAME]: 'managed-by: ' + NAME, rules: FLOOR_RULES })),
    ...validate('stampnotstr.json', JSON.stringify({ [NAME]: ['managed-by: ' + NAME + '; release: x; commit: y'], rules: FLOOR_RULES })),
    ...validate('mcp.json', admin([{ capability: 'mcp', effect: 'deny', match: ['a'] }])),
    ...validate('notdict.json', admin(['x'])),
    ...validate('top.json', '[]'),
    ...validate('dup.json', admin([FLOOR_RULES[0], FLOOR_RULES[0]])),
    ...validate('matchstr.json', admin([{ ...FLOOR_RULES[0], match: 'sudo *' }])),
    ...validate('matchnum.json', admin([{ ...FLOOR_RULES[0], match: [1] }])),
    ...validate('matchempty.json', admin([{ ...FLOOR_RULES[0], match: [''] }])),
    ...validate('exclnull.json', admin([{ ...FLOOR_RULES[0], exclude: null }])),
    ...validate('ceiling.json', admin([{ ...FLOOR_RULES[0], exclude: Array.from({ length: 31 }, (_, i) => 'x' + i) }])),
    ...validate('over.json', admin([{ ...FLOOR_RULES[0], exclude: Array.from({ length: 32 }, (_, i) => 'x' + i) }])),
    ...validate('star.json', admin([{ ...FLOOR_RULES[0], match: ['*'], exclude: Array.from({ length: 32 }, (_, i) => 'x' + i) }])),
    ...validate('many.json', admin([{ capability: 'shell', effect: 'deny', match: Array.from({ length: 300 }, (_, i) => 'p' + i + ' *') }])),
    ...validate('notjson.json', '{not json'),
    ...validate('nan.json', '{"rules": NaN}'),
    ['bytes', 'bom.json', Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(admin(FLOOR_RULES))]).toString('base64')],
    ['run', '--mode=admin-validate', '--file={HOME}/bom.json'],
    ['bytes', 'u.json', Buffer.from([0x7b, 0xff, 0x7d]).toString('base64')], ['run', '--mode=admin-validate', '--file={HOME}/u.json'],
    ['run', '--mode=admin-validate', '--file={HOME}/missing.json'], ['mkdir', 'd.json'], ['run', '--mode=admin-validate', '--file={HOME}/d.json']] },
  { name: 'report-counts-the-admin-copy', steps: [
    r('report', '--admin={HOME}/admin.json'),
    ['write', 'admin.json', admin(FLOOR_RULES)], r('report', '--admin={HOME}/admin.json'),
    ['write', 'admin.json', admin([{ ...FLOOR_RULES[0], match: ['gh auth token *', 'terraform -chdir=*'] }, FLOOR_RULES[1], FLOOR_RULES[2]])],
    r('report', '--admin={HOME}/admin.json'),
    ['write', 'admin.json', admin([{ ...FLOOR_RULES[0], exclude: ['x'] }, FLOOR_RULES[1], FLOOR_RULES[2]])], r('report', '--admin={HOME}/admin.json'),
    ['write', 'admin.json', JSON.stringify({ rules: FLOOR_RULES })], r('report', '--admin={HOME}/admin.json'),
    ['write', 'admin.json', '[1]'], r('report', '--admin={HOME}/admin.json'),
    ['write', 'admin.json', 'not json'], r('report', '--admin={HOME}/admin.json'),
    ['write', 'admin.json', admin([{ ...FLOOR_RULES[0], extra: 1 }])], r('report', '--admin={HOME}/admin.json'),
    ['write', 'admin.json', '{not json'], r('report', '--admin={HOME}/admin.json'),
    ['write', 'admin.json', JSON.stringify({ [NAME]: ['x managed-by: ' + NAME + ' y'], rules: FLOOR_RULES })], r('report', '--admin={HOME}/admin.json'),
    ['write', 'admin.json', JSON.stringify({ [NAME]: null, rules: FLOOR_RULES })], r('report', '--admin={HOME}/admin.json'),
    ['bytes', 'admin.json', Buffer.from([0x7b, 0xff, 0x7d]).toString('base64')], r('report', '--admin={HOME}/admin.json'),
    ['rm', 'admin.json'], ['mkdir', 'admin.json'], r('report', '--admin={HOME}/admin.json'),
    r('install'), r('report', '--admin={HOME}/admin.json')] },
  { name: 'report-names-a-dangling-admin-link', posix: true, steps: [['symlink', 'admin.json', 'nowhere.json'], r('report', '--admin={HOME}/admin.json')] },
];
