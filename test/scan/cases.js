// The S15 scan cases (#486): every test of the deleted global/scan_test.py as a transcript case, plus
// edges of the port (encodings, line ends, file names, sizes, a merge, a moved config). Each case builds
// a throwaway git repository under a throwaway HOME and XDG_DATA_HOME, with the global and system git
// configuration switched off and fixed dates, so commit ids are the same on every machine.
// Every fixture is synthetic, assembled at run time (J), so this file carries no literal finding.
import { J, SALT } from '../clean/corpus.js';

export const AWS = J('AKIA', 'IOSFODNN7', 'EXAMPLE');
export const EMAIL = J('synthetic.person', '@', 'fixture-mail.dev');
export const CPF = J('123.456', '.789-09');
export const SECRETS = [AWS, EMAIL, CPF];
export const TERM = J('Quillmoor', 'vex');
export const HEALTH_TERM = J('Zyxwitis', 'Quill');
export const COLLEAGUE_TERM = J('Quellara ', 'Zyxwood');
export const VENDOR = J('noreply', '@', 'anthropic.com');
export const CODEX = J('noreply', '@', 'openai.com');
export const NEW_FIXTURES = [J('+55 (11) 9', '0000-0001'), J('CEP 01', '000-000'), J('salary ', 'US$', ' 90,000'), J('CID F', '32.1'),
  J('my colleague ', 'Quillo Zyxwer')];
export const NEW_SPANS = [J('+55 (11) 9', '0000-0001'), J('01', '000-000'), J('US$', ' 90,000'), J('CID F', '32.1'), J('Quillo ', 'Zyxwer')];
export { SALT };

/**
 * A step: write a file (text or base64 bytes), run git, make a directory or a symlink, remove a file,
 * chmod, set up the term lists, or run mhw scan (args, from a directory relative to the case's base).
 * @typedef {{ write?: string, text?: string, b64?: string, git?: string[], mkdir?: string, symlink?: [string, string],
 *   rm?: string, chmod?: [string, number], terms?: { employer?: string[], health?: string[], colleague?: string[], salt?: boolean, conf?: string },
 *   conf?: string, confBytes?: string, scan?: string[], cwd?: string, env?: Record<string, string>, outsideGit?: boolean }} Step
 * @typedef {{ name: string, posix?: boolean, bare?: boolean, steps: Step[] }} Case
 */

/** The fixture of scan_test.py's setUp: a base branch, then a feature branch tracking it. */
const SETUP = /** @type {Step[]} */ ([
  { git: ['init', '-q', '-b', 'base'] },
  { write: 'repo/old.txt', text: 'kept from before\nkey ' + AWS + '\n' },
  { write: 'repo/touched.md', text: 'line one\n' },
  { git: ['add', '-A'] },
  { git: ['commit', '-q', '-m', 'base'] },
  { git: ['checkout', '-q', '-b', 'feature', '--track', 'base'] },
  { write: 'repo/touched.md', text: 'line one\nline two\ncontact ' + EMAIL + ' and id ' + AWS + '\n' },
  { write: 'repo/new.txt', text: 'a\nb\nc\nd\ncpf ' + CPF + '\n' },
  { write: 'repo/blob.bin', b64: Buffer.concat([Buffer.from([0, 1]), Buffer.from(AWS)]).toString('base64') },
  { write: 'repo/clean.txt', text: 'nothing to report\n' },
  { git: ['add', '-A'] },
  { git: ['commit', '-q', '-m', 'feature'] },
]);

const PEM = J('-----BEGIN ', 'RSA PRIVATE KEY-----\n', 'QUJD'.repeat(16), '\n', 'REVG'.repeat(16), '\n-----END ', 'RSA PRIVATE KEY-----\n');

const TRAILERS = [
  J('s\n\nb\n\nCo-Authored-By: Claude Opus 5.5 (1M context) <', VENDOR, '>'),
  J('s\n\nb\n\nCo-Authored-By: Codex <', CODEX, '>'),
  J('s\n\nco-authored-by: Claude <', VENDOR, '>\nCO-AUTHORED-BY: Claude <', VENDOR, '>  '),
  J('s\n\nwrite to ', VENDOR, ' for help'),
  J('s\n\nwrite to ', CODEX, ' for help'),
  J('mail ', VENDOR),
  J('s\n\nSigned-off-by: Claude <', VENDOR, '>'),
  J('s\n\nSigned-off-by: Codex <', CODEX, '>'),
  J('s\n\nCo-Authored-By: <', VENDOR, '>'),
  J('s\n\nCo-Authored-By: Claude <', VENDOR, '> and more'),
  J('s\n\nCo-Authored-By: Person <', EMAIL, '>'),
  J('s\n\nCo-Authored-By: Claude <', VENDOR, '.fixture-mail.dev>'),
  J('s\n\nCo-Authored-By: Claude <', VENDOR.replace('anthropic', 'anthrop1c'), '>'),
  J('s\n\nCo-Authored-By: ', AWS, ' <', VENDOR, '>'),
  J('s\n\nCo-Authored-By: Person ', EMAIL, ' <', VENDOR, '>'),
  J('s\n\nCo-Authored-By: Person ', CPF, ' <', VENDOR, '>'),
  // Python's re.MULTILINE ^ and $ are at \n only: a trailer after a \r on the same line is not one.
  J('s\r\rCo-Authored-By: Claude <', VENDOR, '>'),
  J('s\n\nCo-Authored-By: Claude <', VENDOR, '>\u2028more'),
  J('s\n\nCo-Authored-By:   \t <', VENDOR, '>'),
];

/** @type {Case[]} */
export const CASES = [
  { name: 'branch-changes-reported', steps: [...SETUP, { scan: [] }] },
  { name: 'uncommitted-changes-included', steps: [...SETUP, { write: 'repo/clean.txt', text: 'nothing\nnow ' + EMAIL + '\n' }, { scan: [] }] },
  { name: 'explicit-paths-and-base', steps: [...SETUP, { scan: ['old.txt'] }, { scan: ['--base=base'] }] },
  { name: 'no-findings-exit-zero', steps: [...SETUP, { scan: ['clean.txt'] }] },
  { name: 'cannot-run-exit-two', steps: [...SETUP, { git: ['checkout', '-q', '-b', 'orphanish'] }, { scan: [] }, { scan: ['--bogus'] },
    { scan: ['--base=nope-not-a-ref'] }, { scan: ['--base=base', 'new.txt'] }, { scan: ['-'] }, { scan: ['--file=a', '--file=b'] }] },
  { name: 'missing-file-named', steps: [...SETUP, { scan: ['absent.txt'] }, { rm: 'repo/clean.txt' }, { scan: ['clean.txt'] }] },
  { name: 'added-then-removed-reported', steps: [...SETUP, { write: 'repo/extra.txt', text: 'first\nreach ' + EMAIL + '\n' },
    { git: ['add', 'extra.txt'] }, { git: ['commit', '-q', '-m', 'add notes'] }, { git: ['rm', '-q', 'extra.txt'] },
    { git: ['commit', '-q', '-m', 'remove notes'] }, { scan: [] }] },
  { name: 'commit-message-finding', steps: [...SETUP, { git: ['commit', '-q', '--allow-empty', '-m', 'subject\n\nbody with ' + AWS] }, { scan: [] }] },
  { name: 'attribution-trailer-exemption-is-exact', steps: [...SETUP,
    ...TRAILERS.map((m) => /** @type {Step} */ ({ git: ['commit', '-q', '--allow-empty', '--cleanup=verbatim', '-m', m] })), { scan: [] }] },
  { name: 'attribution-trailer-not-exempt-in-a-file', steps: [...SETUP, { write: 'repo/credits.txt', text: J('Co-Authored-By: Claude <', VENDOR, '>\n') },
    { git: ['add', 'credits.txt'] }, { git: ['commit', '-q', '-m', 'credits'] }, { scan: [] }] },
  { name: 'multi-line-secret-one-finding', steps: [...SETUP, { write: 'repo/key name.txt', text: 'x\n' + PEM }, { git: ['add', '-A'] },
    { git: ['commit', '-q', '-m', 'key'] }, { scan: [] }] },
  { name: 'base-starting-with-a-dash-refused', steps: [...SETUP, { scan: ['--base=--help'] }, { scan: ['--base=-x'] }, { scan: ['--base=--is-ancestor'] }, { scan: ['--base='] }] },
  { name: 'base-not-a-commit-refused', steps: [...SETUP, { scan: ['--base=HEAD:touched.md'] }] },
  { name: 'explicit-paths-outside-skipped', steps: [...SETUP, { write: 'outside.txt', text: 'key ' + AWS + '\n' }, { scan: ['../outside.txt'] },
    { scan: ['{BASE}/outside.txt'] }] },
  { name: 'explicit-path-git-does-not-list', steps: [...SETUP, { write: 'repo/.gitignore', text: 'ignored.txt\n' },
    { write: 'repo/ignored.txt', text: 'key ' + AWS + '\n' }, { scan: ['ignored.txt'] }] },
  { name: 'explicit-path-spellings-and-directories', steps: [...SETUP, { mkdir: 'repo/sub' }, { write: 'repo/sub/inner.txt', text: 'x ' + EMAIL + '\n' },
    { git: ['add', '-A'] }, { git: ['commit', '-q', '-m', 'sub'] }, { scan: ['./old.txt'] }, { scan: ['{BASE}/repo/old.txt'] }, { scan: ['sub/../old.txt'] },
    { scan: ['sub'] }, { scan: ['sub/'] }, { scan: ['.'] }, { scan: ['sub/inner.txt'] }, { scan: ['inner.txt'], cwd: 'repo/sub' },
    { scan: ['../old.txt', '../absent.txt', '.'], cwd: 'repo/sub' }] },
  { name: 'explicit-symlink-to-outside', posix: true, steps: [...SETUP, { write: 'outside.txt', text: 'key ' + AWS + '\n' },
    { symlink: ['{BASE}/outside.txt', 'repo/link.txt'] }, { scan: ['link.txt'] }] },
  { name: 'explicit-paths-need-a-repository', steps: [{ mkdir: 'plain' }, { write: 'plain/f.txt', text: 'x\n' },
    { scan: ['f.txt'], cwd: 'plain', outsideGit: true }, { scan: [], cwd: 'plain', outsideGit: true }] },
  { name: 'explicit-path-in-another-case', steps: [...SETUP, { mkdir: 'repo/sub' }, { write: 'repo/sub/inner.txt', text: 'x\n' },
    { git: ['add', 'sub/inner.txt'] }, { git: ['commit', '-q', '-m', 'inner'] }, { scan: ['SUB/Inner.TXT'] }] },
  { name: 'tracked-symlink-outside-repository', posix: true, steps: [...SETUP, { write: 'outside.txt', text: 'key ' + AWS + '\n' },
    { symlink: ['{BASE}/outside.txt', 'repo/link.txt'] }, { git: ['add', 'link.txt'] }, { git: ['commit', '-q', '-m', 'link'] }, { scan: [] }] },
  { name: 'note-when-no-term-list', steps: [...SETUP, { scan: ['clean.txt'] }] },
  { name: 'note-when-term-list-empty', steps: [...SETUP, { terms: { employer: [], salt: true } }, { scan: ['clean.txt'] }] },
  { name: 'note-when-salt-unreadable', steps: [...SETUP, { terms: { employer: [TERM], salt: false } }, { scan: ['clean.txt'] }] },
  { name: 'synthetic-term-found-without-a-note', steps: [...SETUP, { terms: { employer: [TERM], health: [HEALTH_TERM], colleague: [COLLEAGUE_TERM], salt: true } },
    { write: 'repo/memo.txt', text: 'one\nmet the ' + TERM + ' people\n' }, { scan: ['memo.txt'] }] },
  { name: 'new-categories-by-line-category-length', steps: [...SETUP, { write: 'repo/contacts.txt', text: NEW_FIXTURES.map((v) => v + '\n').join('') },
    { scan: ['contacts.txt'] }] },
  { name: 'note-names-each-private-list', steps: [...SETUP, { terms: { employer: [TERM], salt: true } }, { scan: ['clean.txt'] }] },
  { name: 'private-list-terms-found', steps: [...SETUP, { terms: { employer: [], health: [HEALTH_TERM], colleague: [COLLEAGUE_TERM], salt: true } },
    { write: 'repo/notes.txt', text: 'a\n' + HEALTH_TERM.toLowerCase() + ' and ' + COLLEAGUE_TERM.toUpperCase() + '\n' }, { scan: ['notes.txt'] }] },
  { name: 'file-untracked-and-outside-git', steps: [...SETUP, { mkdir: 'scratch' },
    { write: 'scratch/post.txt', text: 'a draft post\n\nwrite to ' + EMAIL + '\nkey ' + AWS + '\n' }, { scan: ['--file={BASE}/scratch/post.txt'] },
    { scan: ['--file=post.txt'], cwd: 'scratch', outsideGit: true }] },
  { name: 'file-untracked-inside-repository', steps: [...SETUP, { write: 'repo/draft.txt', text: 'x\ncpf ' + CPF + '\n' }, { scan: ['--file=draft.txt'] }] },
  { name: 'file-clean', steps: [{ mkdir: 'scratch' }, { write: 'scratch/clean-post.txt', text: 'nothing sensitive in this post\n' },
    { scan: ['--file=clean-post.txt'], cwd: 'scratch', outsideGit: true }] },
  { name: 'file-missing-or-misused', steps: [...SETUP, { mkdir: 'scratch' }, { write: 'scratch/present.txt', text: 'x\n' },
    { scan: ['--file=absent.txt'], cwd: 'scratch', outsideGit: true }, { scan: ['--file=.'], cwd: 'scratch', outsideGit: true },
    { scan: ['--file='], cwd: 'scratch', outsideGit: true }, { scan: ['--file=present.txt', '--file=present.txt'], cwd: 'scratch', outsideGit: true },
    { scan: ['--file=new.txt', 'clean.txt'] }, { scan: ['--file=new.txt', '--base=base'] }] },
  { name: 'file-binary-skipped', steps: [...SETUP, { scan: ['--file=blob.bin'] }] },
  // edges of the port
  { name: 'encodings-bom-crlf-invalid-utf8', steps: [...SETUP,
    { write: 'repo/bom.txt', b64: Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(AWS + '\n')]).toString('base64') },
    { write: 'repo/crlf.txt', text: 'one\r\ntwo\r\n' + EMAIL + '\r\n' },
    { write: 'repo/latin1.txt', b64: Buffer.concat([Buffer.from('caf'), Buffer.from([0xe9, 0x0a, 0xed, 0xa0, 0x80, 0x0a]), Buffer.from(CPF + '\n')]).toString('base64') },
    { write: 'repo/astral.txt', text: '\u{1F600}\u{1F600} ' + AWS + ' \u{1F600}\n\u{1D400} ' + EMAIL + '\n' },
    { scan: ['bom.txt', 'crlf.txt', 'latin1.txt', 'astral.txt'] }, { git: ['add', '-A'] }, { git: ['commit', '-q', '-m', 'encodings'] }, { scan: [] }] },
  { name: 'file-names-quoted-and-spaced', steps: [...SETUP, { write: 'repo/café notes.txt', text: 'x ' + EMAIL + '\n' },
    { write: 'repo/tab\tname.txt', text: 'y ' + CPF + '\n' }, { git: ['add', '-A'] }, { git: ['commit', '-q', '-m', 'names'] }, { scan: [] }], posix: true },
  { name: 'deleted-file-and-binary-in-history', steps: [...SETUP, { git: ['rm', '-q', 'old.txt'] }, { git: ['commit', '-q', '-m', 'drop old'] }, { scan: [] }] },
  { name: 'max-bytes-from-the-installed-config', steps: [...SETUP, { conf: 'max_bytes=20\nsalt_store=file\n' }, { scan: [] }, { scan: ['clean.txt', 'touched.md'] }] },
  { name: 'unreadable-config-uses-defaults', steps: [...SETUP, { confBytes: Buffer.from([0x6d, 0x61, 0x78, 0xff, 0x0a]).toString('base64') }, { scan: ['new.txt'] }] },
  { name: 'unicode-digit-max-bytes-is-a-value-error', steps: [...SETUP, { conf: 'max_bytes=²³\nsalt_store=file\n' }, { scan: ['new.txt'] }] },
  { name: 'arabic-digit-max-bytes-is-read', steps: [...SETUP, { conf: 'max_bytes=٢٠\nsalt_store=file\n' }, { scan: ['new.txt', 'clean.txt'] }] },
  { name: 'unreadable-file', posix: true, steps: [...SETUP, { chmod: ['repo/new.txt', 0] }, { scan: ['new.txt'] }, { chmod: ['repo/new.txt', 0o644] }] },
  { name: 'merge-commit-message-only', steps: [...SETUP, { git: ['checkout', '-q', '-b', 'side', 'base'] }, { write: 'repo/side.txt', text: 'side ' + CPF + '\n' },
    { git: ['add', '-A'] }, { git: ['commit', '-q', '-m', 'side'] }, { git: ['checkout', '-q', 'feature'] },
    { git: ['merge', '-q', '--no-ff', '--no-edit', '-m', 'merge side ' + EMAIL, 'side'] }, { scan: [] }] },
  { name: 'subdirectory-labels-are-relative', steps: [...SETUP, { mkdir: 'repo/sub' }, { write: 'repo/sub/deep.txt', text: EMAIL + '\n' },
    { git: ['add', '-A'] }, { git: ['commit', '-q', '-m', 'deep'] }, { scan: [], cwd: 'repo/sub' }] },
  { name: 'unrelated-base-has-no-merge-base', steps: [...SETUP, { git: ['checkout', '-q', '--orphan', 'other'] }, { git: ['rm', '-rq', '--cached', '.'] },
    { write: 'repo/only.txt', text: 'x\n' }, { git: ['add', 'only.txt'] }, { git: ['commit', '-q', '-m', 'orphan'] }, { git: ['checkout', '-q', '-f', 'feature'] },
    { scan: ['--base=other'] }] },
  { name: 'upstream-mode-and-help-forms', steps: [...SETUP, { scan: ['--base=base', '--base=feature'] }, { scan: ['-h'] }] },
];
