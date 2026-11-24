// The S05 parity cases (#476, convention 3 of #470): `mhw launch-line` against the deleted
// method/scripts/launch-line.py, on the inputs its own suite used plus the edges a port gets wrong:
// confinement, control characters. Every value is synthetic. Placeholders in files and args: {D} the
// case's directory (also TMPDIR, so an allowed root), {CO} a git checkout under it whose name carries a
// space, `$` and backticks.
// The `mhw worklog` cases left with the command at #594 (CLI native baseline PRD, section 5): the worklog
// method skill records the event from each agent harness's own usage data, and
// test/method/worklog-skill.test.js holds it. Their transcripts left test/golden/S05/transcripts.json and
// their expected differences left expected-differences.json in the same slice.

/**
 * @typedef {{ name: string, cmd: 'launch-line', args: string[], files?: Record<string, string | Uint8Array>,
 *   dirs?: string[], cwd?: string, posix?: boolean, why?: string }} Case
 */

const PROMPT = ["Objective: ship the owner's handoff command",
  'Continue owner/repo#12 in this fresh session; the session that printed this prompt stops now.',
  "Next act: run the suite; it's green when 'OK' prints, not $HOME or $(date) or `id`.",
  'Evidence: ```fence``` and \\n and "quoted" and !! and \\\'\' stay as typed.',
  'Before acting, re-derive the state from the tracker: gh issue view 12 --repo owner/repo --comments.'].join('\n');

/** @param {string} name @param {string | Uint8Array} prompt @param {string[]} [extra] @param {string} [target] @returns {Case} */
const line = (name, prompt, extra = [], target = 'codex') => ({ name, cmd: 'launch-line', files: { 'prompt.txt': prompt }, dirs: ['{CO}/.git'], args: [target, '{D}/prompt.txt', '--cd', '{CO}', ...extra] });

/** @returns {Case[]} */
function launchLineCases() {
  return [
    { name: 'resolve-kept', cmd: 'launch-line', args: ['--resolve', 'claude-code'] },
    { name: 'resolve-consumed-alias', cmd: 'launch-line', args: ['--resolve', 'codex', 'kiro-cli'] },
    { name: 'resolve-kept-word', cmd: 'launch-line', args: ['--resolve', 'kiro', 'ship'] },
    { name: 'resolve-unknown-current', cmd: 'launch-line', args: ['--resolve', 'cursor'] },
    { name: 'resolve-no-argument', cmd: 'launch-line', args: ['--resolve'] },
    line('block-claude', PROMPT, [], 'claude'),
    line('block-claude-code', PROMPT, [], 'claude-code'),
    line('block-codex', PROMPT),
    line('block-kiro', PROMPT, [], 'kiro'),
    line('block-kiro-cli', PROMPT, [], 'kiro-cli'),
    line('block-backtick-fence', 'Objective: keep ```` four and ````` five backticks'),
    line('block-crlf-and-trailing-newlines', 'Objective: x\r\nNext act: y\r\n\r\n\n'),
    line('block-astral-line-at-limit', '\u{1f600}'.repeat(280)),
    line('block-bom-kept', '\ufeffObjective: x'),
    line('block-goal-in-a-later-line', 'Objective: x\nmention /goal here'),
    line('refuse-goal-first', '/goal ship it\nNext act: run it.'),
    line('refuse-goal-alone', '/goal'),
    line('refuse-long-line', 'Objective: ' + 'x'.repeat(300)),
    line('refuse-astral-line-over-limit', '\u{1f600}'.repeat(281)),
    line('refuse-private-path', 'Objective: fix it\nEvidence: /Use' + 'rs/someone/notes.txt'),
    line('refuse-private-folded', 'Objective: fix it\nEvidence: /U\u017fers/x and C:\\temp and .BRAND'),
    line('refuse-controls', 'Objective: fix it\nNext act: \x03 \x1b[201~ \x15 SENTINEL\nmore \t tab\nbidi \u202e here\nlone \r cr\ndel \x7f\nc1 \x85'),
    line('refuse-empty', '\n'),
    line('refuse-whitespace-only', ' \t\u3000\n'),
    line('refuse-env-not-declared', PROMPT, ['--env', 'CODEX_HOME=SENTINELVALUE', '--env', 'X=a\nb', '--env', 'Y=/home/x']),
    line('refuse-several-problems', '/goal\n' + 'y'.repeat(281) + '\n~/x', ['--env', 'Z=1']),
    { ...line('refuse-cd-relative', PROMPT), args: ['codex', '{D}/prompt.txt', '--cd', 'some/checkout'] },
    { ...line('refuse-cd-missing', PROMPT), args: ['codex', '{D}/prompt.txt', '--cd', '{D}/absent'] },
    { ...line('refuse-cd-no-git', PROMPT), dirs: ['plain'], args: ['codex', '{D}/prompt.txt', '--cd', '{D}/plain'] },
    { ...line('refuse-cd-newline', PROMPT), args: ['codex', '{D}/prompt.txt', '--cd', '{CO}\nid'] },
    { ...line('usage-cd-missing', PROMPT), args: ['codex', '{D}/prompt.txt'] },
    { ...line('usage-cd-twice', PROMPT), args: ['codex', '{D}/prompt.txt', '--cd', '{CO}', '--cd', '{CO}'] },
    { ...line('usage-env-without-equals', PROMPT), args: ['codex', '{D}/prompt.txt', '--cd', '{CO}', '--env', 'NOEQUALS'] },
    { ...line('usage-unknown-target', PROMPT), args: ['cursor', '{D}/prompt.txt', '--cd', '{CO}'] },
    { ...line('usage-dangling-option', PROMPT), args: ['codex', '{D}/prompt.txt', '--cd', '{CO}', '--env'] },
    { ...line('refuse-prompt-outside-roots', PROMPT), args: ['codex', '/etc/hosts', '--cd', '{CO}'], posix: true },
    { ...line('refuse-prompt-directory', PROMPT), dirs: ['{CO}/.git', 'adir'], args: ['codex', '{D}/adir', '--cd', '{CO}'] },
    { ...line('refuse-prompt-missing', PROMPT), args: ['codex', '{D}/nope.txt', '--cd', '{CO}'] },
    line('refuse-prompt-oversize', 'Objective: x\n' + ('y'.repeat(200) + '\n').repeat(400)),
    line('read-error-not-utf8', Uint8Array.from([0x4f, 0x62, 0xff, 0x0a])),
  ];
}

/** @type {Case[]} */
export const CASES = launchLineCases();
export const CHECKOUT_NAME = 'check out $HOME `id`';
