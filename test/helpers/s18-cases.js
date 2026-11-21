// The S18 golden cases (#489, S18 of #470): what the deleted global/method/method_render.py did, on a small
// synthetic method source and throwaway homes, so the Node renderer is held to it after the deletion.
// The fixture exercises every source form the renderer reads: quoted and plain scalars, lists, an
// argument hint, a purpose, tools as a list and as a comma list, an MCP grant narrowed by exclusions, a
// skill preload, {{agent-harness}} in a command body, {{method-scripts}} naming a document (and one
// document no body names), non-ASCII text, and two names whose sort differs by path part and by string
// (zeta, zeta-two). Every value is synthetic.
//
// Placeholders: {BASE} the case's directory; {HOME} {BASE}/home; {SRC} {BASE}/src/method, a fresh copy of
// FIXTURE per case. Steps: run (a mode, or args), write/bytes (a file under {BASE}), edit (from -> to in a
// file under {BASE}), rm, mkdir, symlink, crlf (every source file to \r\n).

export const STAMP = 'release: v9.9.9; commit: 0123456789abcdef0123456789abcdef01234567';
export const OTHER = 'release: v9.9.8; commit: fedcba9876543210fedcba9876543210fedcba98';
const MARK = 'managed-by: personal-multi-harness-workstation-configuration';
const DATA = '.local/share/personal-multi-harness-workstation-configuration/method/scripts';

/** @type {Record<string, string>} relative to {SRC} */
export const FIXTURE = {
  'skills/alpha/SKILL.md': [
    '---',
    'name: alpha',
    'description: "Alpha skill: reads \\"quoted\\" text, a backslash \\\\ and ção; use it first."',
    'purpose: Plain purpose text',
    '---',
    '# Alpha',
    '',
    'Read `{{method-scripts}}/alpha-contract/README.md` before acting.',
    'Ünïcødé line ✓ and an astral 🎉.',
    '',
  ].join('\n'),
  'skills/zeta/SKILL.md': ['---', 'name: zeta', 'description: Zeta: an unquoted description with a colon.', '---', 'Zeta body.', ''].join('\n'),
  'skills/zeta-two/SKILL.md': [
    '---', 'name: "zeta-two"', 'description: "Zeta two."', 'purpose: "Quoted purpose"', '', '---', '', 'Zeta two body.', '',
  ].join('\n'),
  'commands/run-it.md': [
    '---',
    'name: run-it',
    'description: "Runs it, owner-typed."',
    'argument-hint: "[target] [--flag]"',
    'purpose: Run',
    '---',
    '',
    '',
    'This copy is for {{agent-harness}}. Read $ARGUMENTS.',
    '',
    '## What this command never does',
    '',
    'It never merges, publishes or adds a hook.',
    '',
  ].join('\n'),
  'commands/listy.md': [
    '---', 'name: listy', 'description: A command whose hint and purpose are lists.', 'argument-hint:', '  - one', '  - "two"',
    'purpose:', '  - a', '  - b', '---', 'Listy body, no leading newline.', '',
  ].join('\n'),
  'agents/builder.md': [
    '---',
    'name: builder',
    'description: "Builds the slice."',
    'purpose: build',
    'tools: Read, Grep, Glob, Write, Edit, Bash',
    'skills:',
    '  - alpha',
    '  - zeta',
    '---',
    'Builder body.',
    '',
  ].join('\n'),
  'agents/looker.md': ['---', 'name: looker', 'description: Looks only.', 'tools: []', 'skills: []', '---', '', 'Looker body.', ''].join('\n'),
  'agents/browser.md': [
    '---',
    'name: browser',
    'description: "Reads pages."',
    'tools:',
    '  - Read',
    '  - WebFetch',
    '  - WebSearch',
    '  - mcp__chrome-devtools',
    'disallowed-tools: mcp__chrome-devtools__evaluate_script, mcp__chrome-devtools__fill',
    'skills:',
    '  - zeta-two',
    '---',
    '',
    '',
    'Browser body; the contract is `{{method-scripts}}/alpha-contract/README.md`.',
    '',
  ].join('\n'),
  'scripts/alpha-contract/README.md': '# Alpha contract\n\nThe store a rite reads.\n',
  'scripts/unnamed-contract/README.md': '# Read only by a test\n',
  'scripts/fixtures/a.tsv': 'x\ty\n',
};

/** A stamped file an earlier version rendered, in its own format. */
const md = (/** @type {string} */ src) => '---\n# ' + MARK + '; source: ' + src + '; ' + OTHER + '; do not edit, re-run the installer\nname: "old"\n---\nold body\n';
const yaml = (/** @type {string} */ src) => '# ' + MARK + '; source: ' + src + '; ' + OTHER + '; do not edit, re-run the installer\npolicy:\n  allow_implicit_invocation: false\n';
const json = (/** @type {string} */ src) => JSON.stringify({ name: 'old', prompt: '<!-- ' + MARK + '; source: ' + src + '; ' + OTHER + '; do not edit -->\n\nold' }, null, 2) + '\n';
const script = (/** @type {string} */ src) => '#!/usr/bin/env python3\n# ' + MARK + '; source: ' + src + '; ' + OTHER + '; do not edit, re-run the installer\nprint("old")\n';

/** Every file an earlier method left in the three agent harnesses' carriers and the scripts directory. */
const STALE = [
  { write: '{HOME}/.claude/agents/retired-persona.md', text: md('method/agents/retired-persona.md') },
  { write: '{HOME}/.claude/commands/old-command.md', text: md('method/commands/old-command.md') },
  { write: '{HOME}/.claude/skills/old-skill/SKILL.md', text: md('method/skills/old-skill/SKILL.md') },
  { write: '{HOME}/.agents/skills/old-skill/SKILL.md', text: md('method/skills/old-skill/SKILL.md') },
  { write: '{HOME}/.agents/skills/old-command/SKILL.md', text: md('method/commands/old-command.md') },
  { write: '{HOME}/.agents/skills/old-command/agents/openai.yaml', text: yaml('method/commands/old-command.md') },
  { write: '{HOME}/.codex/agents/retired-persona.toml', text: '# ' + MARK + '; source: method/agents/retired-persona.md; ' + OTHER + '; do not edit, re-run the installer\nname = "retired_persona"\n' },
  { write: '{HOME}/.kiro/agents/retired-persona.json', text: json('method/agents/retired-persona.md') },
  { write: '{HOME}/.kiro/skills/old-skill/SKILL.md', text: md('method/skills/old-skill/SKILL.md') },
  // The scripts an earlier version installed (#170): one per kind it shipped, plus a document no rite names.
  { write: '{HOME}/' + DATA + '/milestone-read.py', text: script('method/scripts/milestone-read.py') },
  { write: '{HOME}/' + DATA + '/funnel-review.sh', text: '#!/bin/sh\n# ' + MARK + '; source: method/scripts/funnel-review.sh; ' + OTHER + '; do not edit, re-run the installer\necho old\n' },
  { write: '{HOME}/' + DATA + '/old-contract/README.md', text: '<!-- ' + MARK + '; source: method/scripts/old-contract/README.md; ' + OTHER + '; do not edit, re-run the installer -->\n# old\n' },
];

/** Files the method step never touches: the owner's, and install.sh's own managed files. */
const NOT_OURS = [
  { write: '{HOME}/.claude/commands/breaking-glass.md', text: '<!-- ' + MARK + '; source: global/x; ' + STAMP + ' -->\n' },
  { write: '{HOME}/.claude/skills/owner-skill/SKILL.md', text: '---\nname: owner-skill\n---\n' },
  { write: '{HOME}/.kiro/agents/owner.json', text: '{"prompt": "mine"}\n' },
  { write: '{HOME}/.kiro/agents/list.json', text: '[1, 2]\n' },
  { write: '{HOME}/' + DATA + '/owner-notes.txt', text: 'mine\n' },
];

const ALIASES = { 'new-idea': 'run-it', 'idea-to-issues': 'listy' };
const ALIAS_FILES = Object.entries(ALIASES).flatMap(([alias, target]) => {
  const src = 'method/commands/' + target + '.md';
  const text = '---\n# ' + MARK + '; source: ' + src + '; ' + OTHER + '; do not edit, re-run the installer\nname: "' + alias + '"\ndescription: "Deprecated name of ' + target + '."\n---\nold body\n';
  return [
    { write: '{HOME}/.claude/commands/' + alias + '.md', text },
    { write: '{HOME}/.agents/skills/' + alias + '/SKILL.md', text },
    { write: '{HOME}/.agents/skills/' + alias + '/agents/openai.yaml', text: yaml(src) },
    { write: '{HOME}/.kiro/skills/' + alias + '/SKILL.md', text },
  ];
});

/**
 * One invalid source per case: the edit, the file it applies to, and the refusal (exit 2, nothing written).
 * @type {Array<[string, object[]]>}
 */
const INVALID = [
  ['unknown-field-deprecated-aliases', [{ edit: '{SRC}/commands/run-it.md', from: '\npurpose: Run\n', to: '\npurpose: Run\ndeprecated-aliases:\n  - new-idea\n' }]],
  ['unknown-field-skill', [{ edit: '{SRC}/skills/zeta/SKILL.md', from: '\n---\nZeta', to: '\ncolour: blue\nzz-top: x\n---\nZeta' }]],
  ['unknown-field-agent', [{ edit: '{SRC}/agents/builder.md', from: 'purpose: build\n', to: 'purpose: build\ncolour: blue\n' }]],
  ['agent-without-tools', [{ edit: '{SRC}/agents/builder.md', from: 'tools: Read, Grep, Glob, Write, Edit, Bash\n', to: '' }]],
  ['harness-token-in-a-skill', [{ edit: '{SRC}/skills/zeta/SKILL.md', from: 'Zeta body.', to: 'Zeta {{agent-harness}} body.' }]],
  ['harness-token-in-an-agent', [{ edit: '{SRC}/agents/looker.md', from: 'Looker body.', to: 'Looker {{agent-harness}}.' }]],
  ['script-token-naming-nothing', [{ edit: '{SRC}/commands/listy.md', from: 'Listy body', to: 'Run `python3 {{method-scripts}}/nope.py`. Listy body' }]],
  ['script-token-naming-an-unnamed-depth', [{ edit: '{SRC}/skills/zeta/SKILL.md', from: 'Zeta body.', to: 'See {{method-scripts}}/a/b/c.md.' }]],
  ['document-not-markdown', [{ write: '{SRC}/scripts/alpha-contract/data.json', text: '{}\n' }, { edit: '{SRC}/skills/zeta/SKILL.md', from: 'Zeta body.', to: 'See {{method-scripts}}/alpha-contract/data.json.' }]],
  ['duplicate-key', [{ edit: '{SRC}/skills/zeta/SKILL.md', from: 'name: zeta\n', to: 'name: zeta\nname: zeta\n' }]],
  ['no-front-matter', [{ write: '{SRC}/skills/zeta/SKILL.md', text: 'name: zeta\n' }]],
  ['unterminated-front-matter', [{ write: '{SRC}/skills/zeta/SKILL.md', text: '---\nname: zeta\ndescription: x\n' }]],
  ['unsupported-line', [{ edit: '{SRC}/skills/zeta/SKILL.md', from: 'name: zeta\n', to: 'name: zeta\nNot A Key: x\n' }]],
  ['list-item-under-a-scalar', [{ edit: '{SRC}/skills/zeta/SKILL.md', from: 'name: zeta\n', to: 'name: zeta\n  - stray\n' }]],
  ['invalid-quoted-value', [{ edit: '{SRC}/skills/zeta/SKILL.md', from: 'description: Zeta', to: 'description: "unterminated Zeta' }]],
  ['quoted-value-extra-data', [{ edit: '{SRC}/skills/zeta/SKILL.md', from: 'description: Zeta: an unquoted description with a colon.', to: 'description: "a" "b"' }]],
  ['skill-name-mismatch', [{ edit: '{SRC}/skills/zeta/SKILL.md', from: 'name: zeta\n', to: 'name: zed\n' }]],
  ['command-name-mismatch', [{ edit: '{SRC}/commands/listy.md', from: 'name: listy\n', to: 'name: Listy\n' }]],
  ['agent-name-mismatch', [{ edit: '{SRC}/agents/looker.md', from: 'name: looker\n', to: 'name: "looker2"\n' }]],
  ['tool-without-kiro-mapping', [{ edit: '{SRC}/agents/builder.md', from: 'Edit, Bash', to: 'Edit, Bash, NotebookEdit' }]],
  ['invalid-tool-name', [{ edit: '{SRC}/agents/builder.md', from: 'Edit, Bash', to: "Edit, Bash, it's" }]],
  ['disallowed-of-an-ungranted-server', [{ edit: '{SRC}/agents/browser.md', from: 'mcp__chrome-devtools__fill', to: 'mcp__other__fill' }]],
  ['disallowed-not-an-mcp-tool', [{ edit: '{SRC}/agents/browser.md', from: 'mcp__chrome-devtools__fill', to: 'Bash' }]],
  ['preload-of-an-unknown-skill', [{ edit: '{SRC}/agents/builder.md', from: '  - zeta\n', to: '  - zeta\n  - nowhere\n' }]],
  ['skills-not-a-list', [{ edit: '{SRC}/agents/builder.md', from: 'skills:\n  - alpha\n  - zeta\n', to: 'skills: alpha\n' }]],
  ['skill-and-command-share-a-name', [{ write: '{SRC}/commands/zeta.md', text: '---\nname: zeta\ndescription: d\n---\nx\n' }]],
  ['missing-description', [{ edit: '{SRC}/commands/listy.md', from: 'description: A command whose hint and purpose are lists.\n', to: '' }]],
  ['blank-description', [{ edit: '{SRC}/commands/listy.md', from: 'description: A command whose hint and purpose are lists.', to: 'description: "   "' }]],
  ['multi-line-description', [{ edit: '{SRC}/skills/zeta/SKILL.md', from: 'description: Zeta: an unquoted description with a colon.', to: 'description: "two\\nlines"' }]],
  ['description-over-the-limit', [{ edit: '{SRC}/skills/zeta/SKILL.md', from: 'description: Zeta: an unquoted description with a colon.', to: 'description: ' + 'é'.repeat(1025) }]],
  ['command-description-over-the-limit', [{ edit: '{SRC}/commands/listy.md', from: 'description: A command whose hint and purpose are lists.', to: 'description: ' + 'x'.repeat(980) }]],
  ['no-commands', [{ rm: '{SRC}/commands/run-it.md' }, { rm: '{SRC}/commands/listy.md' }]],
  ['byte-order-mark', [{ bytes: '{SRC}/skills/zeta/SKILL.md', hex: 'efbbbf2d2d2d0a6e616d653a207a6574610a6465736372697074696f6e3a20640a2d2d2d0a780a' }]],
];

/** @type {Array<{ name: string, posix?: boolean, steps: object[] }>} */
export const CASES = [
  {
    name: 'off-by-default-then-kept-current',
    steps: [
      { run: 'install', optIn: false }, { run: 'check', optIn: false }, { run: 'dry-run', optIn: false },
      { run: 'install' },
      { edit: '{HOME}/.claude/agents/builder.md', from: STAMP, to: OTHER },
      { run: 'check', optIn: false },
    ],
  },
  {
    name: 'dry-run-install-check',
    steps: [{ run: 'dry-run' }, { run: 'install' }, { run: 'check' }, { run: 'dry-run' }, { run: 'install' }],
  },
  {
    name: 'check-names-each-difference',
    steps: [
      { run: 'install' },
      { edit: '{HOME}/.claude/agents/builder.md', from: STAMP, to: OTHER },
      { edit: '{HOME}/.kiro/agents/builder.json', from: '"read"', to: '"web"' },
      { edit: '{HOME}/.kiro/agents/browser.json', from: STAMP, to: OTHER },
      { edit: '{HOME}/.codex/agents/looker.toml', from: 'Looker body.', to: 'Looker edited.' },
      { rm: '{HOME}/.agents/skills/zeta/SKILL.md' },
      { rm: '{HOME}/' + DATA + '/alpha-contract/README.md' },
      { run: 'check' }, { run: 'dry-run' }, { run: 'install' }, { run: 'check' },
    ],
  },
  {
    name: 'stale-across-three-harnesses-and-old-scripts',
    steps: [
      { run: 'install' }, ...STALE, ...NOT_OURS,
      { run: 'check' }, { run: 'dry-run' }, { run: 'install' }, { run: 'check' },
    ],
  },
  {
    // pathlib's glob matches a name starting with a dot, so a stamped dot file in a carrier is a candidate.
    name: 'dot-named-stale-files-are-candidates',
    steps: [
      { run: 'install' },
      { write: '{HOME}/.claude/agents/.hidden.md', text: md('method/agents/hidden.md') },
      { write: '{HOME}/.claude/skills/.hidden/SKILL.md', text: md('method/skills/hidden/SKILL.md') },
      { write: '{HOME}/.kiro/agents/.json', text: json('method/agents/x.md') },
      { write: '{HOME}/.claude/commands/.md', text: md('method/commands/x.md') },
      { write: '{HOME}/' + DATA + '/.old.py', text: script('method/scripts/.old.py') },
      { run: 'check' }, { run: 'install' },
    ],
  },
  {
    name: 'stale-without-a-method-install-and-without-opt-in',
    steps: [...STALE.slice(9), { run: 'check', optIn: false }, { run: 'install', optIn: false }, { run: 'check', optIn: false }],
  },
  {
    name: 'retired-aliases-are-removed-and-an-unstamped-copy-kept',
    steps: [
      { run: 'install' }, ...ALIAS_FILES,
      { write: '{HOME}/.claude/commands/new-idea.md', text: '---\ndescription: "my own copy"\n---\nedited by hand\n' },
      { run: 'check' }, { run: 'install' }, { run: 'check' },
    ],
  },
  {
    name: 'uninstall-removes-only-method-files',
    steps: [
      { run: 'install' }, ...STALE, ...NOT_OURS,
      { run: 'uninstall', args: ['--mode=uninstall'] }, { run: 'uninstall', args: ['--mode=uninstall'] },
      { run: 'check', optIn: false },
    ],
  },
  {
    name: 'unmanaged-files-are-refused-and-kept',
    steps: [
      { write: '{HOME}/.claude/agents/builder.md', text: "owner's own agent\n" },
      { mkdir: '{HOME}/.kiro/agents/looker.json' },
      { bytes: '{HOME}/.claude/commands/run-it.md', hex: 'ff fe 00 0a'.replaceAll(' ', '') },
      { run: 'install' }, { run: 'check' }, { run: 'dry-run' },
    ],
  },
  {
    name: 'a-symbolic-link-at-a-target-is-refused',
    posix: true,
    steps: [
      { write: '{BASE}/elsewhere.toml', text: '# ' + MARK + '; source: method/agents/builder.md; ' + STAMP + '\n' },
      { symlink: '{HOME}/.codex/agents/builder.toml', target: '{BASE}/elsewhere.toml' },
      { symlink: '{HOME}/.claude/agents/looker.md', target: '{BASE}/nowhere.md' },
      { run: 'install' }, { run: 'check' },
    ],
  },
  {
    name: 'a-symbolic-link-in-a-carrier-is-not-a-candidate',
    posix: true,
    steps: [
      { run: 'install' },
      { write: '{BASE}/linked/SKILL.md', text: md('method/skills/linked/SKILL.md') },
      { symlink: '{HOME}/.claude/skills/linked', target: '{BASE}/linked' },
      { write: '{BASE}/file.md', text: md('method/agents/file.md') },
      { symlink: '{HOME}/.claude/agents/file.md', target: '{BASE}/file.md' },
      { run: 'check' }, { run: 'uninstall', args: ['--mode=uninstall'] },
    ],
  },
  {
    name: 'documents-through-a-symbolic-link-stop-the-render',
    posix: true,
    steps: [
      { write: '{BASE}/outside/README.md', text: '# outside\n' },
      { mkdir: '{SRC}/scripts/linked' },
      { symlink: '{SRC}/scripts/linked/README.md', target: '{BASE}/outside/README.md' },
      { symlink: '{SRC}/scripts/linkdir', target: '{BASE}/outside' },
      { edit: '{SRC}/skills/zeta/SKILL.md', from: 'Zeta body.', to: 'See `{{method-scripts}}/linked/README.md`.' },
      { run: 'install' },
      { edit: '{SRC}/skills/zeta/SKILL.md', from: 'See `{{method-scripts}}/linked/README.md`.', to: 'See `{{method-scripts}}/linkdir/README.md`.' },
      { run: 'install' },
    ],
  },
  {
    name: 'usage-errors',
    steps: [
      { run: 'x', args: [] },
      { run: 'x', args: ['--mode=bad'] },
      { run: 'x', args: ['--mode=install', '--frob'] },
      { run: 'x', args: ['--frob', '--mode=bad'] },
      { run: 'x', args: ['--mode=install', '--opt-in', '--source={SRC}'] },
      { run: 'x', args: ['--mode=install', '--opt-in', '--source={SRC}', '--stamp=v1'] },
      { run: 'x', args: ['--mode=install', '--opt-in', '--source={SRC}', '--stamp=release: v1; commit: a b'] },
      { run: 'x', args: ['--mode=install', '--opt-in', '--source={SRC}', '--stamp=release: v1; commit: a '] },
      { run: 'x', args: ['--mode=install', '--opt-in', '--source={SRC}', '--stamp=release: v"1; commit: a'] },
      { run: 'x', args: ['--mode=install', '--opt-in', '--source={SRC}', '--stamp='] },
      { run: 'x', args: ['--mode=install', '--source={SRC}'] },
      { run: 'x', args: ['--mode=check', '--mode=install', '--opt-in', '--source={BASE}/nowhere/', '--stamp=' + STAMP] },
      { run: 'x', args: ['--mode=uninstall', '--stamp=bad'] },
      { run: 'x', args: ['--mode=install', '--opt-in', '--source={SRC}', '--stamp=release: v1; commit: abc', '--stamp=' + STAMP] },
    ],
  },
  {
    name: 'relative-source-and-home',
    // str(Path) of a relative path prints with backslashes on Windows, outside the normaliser's <BASE>.
    posix: true,
    steps: [
      { run: 'x', args: ['--mode=install', '--opt-in', '--stamp=' + STAMP, '--source=./src//method/', '--home=./other/../home2'] },
      { run: 'x', args: ['--mode=install', '--opt-in', '--stamp=' + STAMP, '--source=./missing/./dir/'] },
      { run: 'x', args: ['--mode=check', '--opt-in', '--stamp=' + STAMP, '--source=src/method', '--home=home2'] },
    ],
  },
  {
    name: 'the-home-argument-codex-home-and-xdg-data-home',
    steps: [
      { run: 'install', home: '{BASE}/other' },
      { run: 'install', env: { CODEX_HOME: '{BASE}/codex-elsewhere', XDG_DATA_HOME: '{BASE}/xdg' } },
      { run: 'install', home: '{BASE}/third', env: { CODEX_HOME: '{BASE}/codex-third', XDG_DATA_HOME: '{BASE}/xdg' } },
      { run: 'check', env: { CODEX_HOME: '{BASE}/codex-elsewhere', XDG_DATA_HOME: '{BASE}/xdg' } },
      { run: 'uninstall', args: ['--mode=uninstall'], env: { CODEX_HOME: '{BASE}/codex-elsewhere', XDG_DATA_HOME: '{BASE}/xdg' } },
      { run: 'install', env: { HOME: '' }, home: '{BASE}/fourth' },
      { run: 'install', env: { MHW_CMD: 'mhw' }, optIn: false, home: '{BASE}/fifth' },
    ],
  },
  {
    name: 'a-home-path-with-characters-a-uri-encodes',
    // On Windows the normaliser stops at the quote and spaces of this home, so its separators stay \.
    posix: true,
    steps: [
      { mkdir: "{BASE}/it's a 100% é (home)" },
      { run: 'install', home: "{BASE}/it's a 100% é (home)" },
      { run: 'check', home: "{BASE}/it's a 100% é (home)" },
    ],
  },
  {
    name: 'a-crlf-source-renders-as-the-lf-source',
    steps: [{ crlf: true }, { run: 'install' }, { crlf: false }, { run: 'check' }],
  },
  {
    name: 'a-file-the-method-cannot-read-in-a-carrier',
    steps: [
      { run: 'install' },
      { bytes: '{HOME}/.claude/agents/binary.md', hex: 'ff00ff0a' },
      { bytes: '{HOME}/.kiro/agents/binary.json', hex: '7b22ff227d0a' },
      { write: '{HOME}/.kiro/agents/nan.json', text: '{"prompt": "<!-- ' + MARK + '; source: method/agents/nan.md; ' + OTHER + ' -->", "n": NaN}\n' },
      { write: '{HOME}/.kiro/agents/prompt-not-text.json', text: '{"prompt": ["<!-- ' + MARK + '; source: method/x -->"]}\n' },
      { write: '{HOME}/.claude/agents/deep-marker.md', text: '1\n2\n3\n4\n5\n# ' + MARK + '; source: method/agents/deep-marker.md\n' },
      { run: 'check' }, { run: 'install' },
    ],
  },
  {
    name: 'a-source-that-holds-scripts',
    steps: [
      { write: '{SRC}/scripts/tool.py', text: '#!/usr/bin/env python3\nprint("tool")\n' },
      { write: '{SRC}/scripts/helper.sh', text: 'echo helper\n' },
      { write: '{SRC}/scripts/tool.test.py', text: 'pass\n' },
      { run: 'install' }, { run: 'check' }, { run: 'uninstall', args: ['--mode=uninstall'] },
    ],
  },
  {
    name: 'a-token-naming-a-shipped-script',
    steps: [
      { write: '{SRC}/scripts/tool.py', text: '#!/usr/bin/env python3\nprint("tool")\n' },
      { edit: '{SRC}/commands/listy.md', from: 'Listy body', to: 'Run `python3 {{method-scripts}}/tool.py`. Listy body' },
      { run: 'install' },
    ],
  },
  ...INVALID.map(([name, steps]) => ({ name: 'invalid-source-' + name, steps: [...steps, { run: 'install' }, { run: 'check' }] })),
];
