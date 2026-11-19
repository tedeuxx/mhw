// The S08 cases (#479, convention 3 of #470): every case of the deleted global/profile/profile_test.py,
// plus argument forms, JSON acceptance edges, path confinement and the preflight's refusals. Each case
// builds a throwaway working directory and runs `mhw profile` there one or more times; a run records
// stdout, stderr, the exit code and the directory's tree after it. Synthetic profiles only: the owner's
// overlay is read by the reference-profile case and nothing of it reaches a transcript.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const POSIX = process.platform !== 'win32';
export const EXAMPLE = JSON.parse(fs.readFileSync(path.join(ROOT, 'global', 'profile', 'profile.example.json'), 'utf8'));
export const MAX_BYTES = 65536;

/** @returns {any} a fresh copy of the example profile */
export const doc = () => structuredClone(EXAMPLE);

/**
 * @typedef {{ dir: string, write: (rel: string, data: string | Uint8Array) => void, json: (rel: string, v: unknown) => void,
 *   mkdir: (rel: string) => void, link: (rel: string, target: string, dir?: boolean) => void,
 *   read: (rel: string) => string, exists: (rel: string) => boolean,
 *   run: (args: string[], o?: { env?: Record<string, string>, cwd?: string }) => void }} Fixture
 * @typedef {{ name: string, cli?: boolean, posix?: boolean, build: (f: Fixture) => void }} Case
 */

const SRC = ['--source', 'profile.json'];
const OUT = ['--output', 'output'];
/** @param {any} d @returns {(f: Fixture) => void} */
const withDoc = (d) => (f) => f.json('profile.json', d);
/** @param {(d: any) => void} mutate */
const mutated = (mutate) => {
  const d = doc();
  mutate(d);
  return d;
};
/** @param {Fixture} f @param {string} text */
const validateText = (f, text) => {
  f.write('profile.json', text);
  f.run(['validate', ...SRC]);
};

/** @type {Case[]} */
export const CASES = [
  // Argument forms: every parse error is one line; -h prints the help; an invalid choice before -h is an error.
  { name: 'argument-forms', cli: true, build: (f) => {
    withDoc(doc())(f);
    for (const args of [[], ['-h'], ['--help'], ['--he'], ['-hx'], ['-h', 'bogus'], ['bogus', '-h'], ['validate', '-h'],
      ['--source', 'profile.json', '-h'], ['validate'], ['bogus', ...SRC], ['validate', '--source'],
      ['validate', '--so', 'profile.json'], ['validate', '--source=profile.json'], ['--sourc', 'profile.json', 'plan'],
      ['validate', ...SRC, 'extra'], ['--', 'validate', ...SRC], ['validate', ...SRC, '--source', 'profile.json'],
      ['-1e3', ...SRC], ['validate', '--source', '-x'], ['validate', '-s', 'profile.json'], ['validate', '--', ...SRC],
      ['validate', '--source', 'profile.json', '--'], ['VALIDATE', ...SRC], ['valid', ...SRC], ['validate', '--=x', ...SRC]]) {
      f.run(args);
    }
  } },
  { name: 'help-wraps-to-the-columns', build: (f) => {
    for (const columns of ['200', '40', '20', '1', 'x']) f.run(['-h'], { env: { COLUMNS: columns } });
  } },
  // test_output_is_required_only_for_mutating_or_check_commands
  { name: 'output-required-only-for-render-and-check', cli: true, build: (f) => {
    withDoc(doc())(f);
    f.run(['render', ...SRC]);
    f.run(['check', ...SRC]);
    f.run(['validate', ...SRC, ...OUT]);
    f.run(['plan', ...SRC, ...OUT]);
    f.run(['validate', ...SRC, '--output', '']);
  } },
  // test_example_and_reference_profiles_validate (the CLI half; the reference values are asserted in-process)
  { name: 'example-validates-and-plans', cli: true, build: (f) => {
    withDoc(doc())(f);
    f.run(['validate', ...SRC]);
    f.run(['plan', ...SRC]);
  } },
  { name: 'reference-profile-validates', build: (f) => {
    f.write('profile.json', fs.readFileSync(path.join(ROOT, 'overlay', 'profile.json')));
    f.run(['validate', ...SRC]);
  } },
  // test_native_grants_are_rejected_without_echo
  { name: 'native-grant-rejected-without-echo', cli: true, build: (f) => {
    withDoc(mutated((d) => { d['synthetic-private-input-do-not-echo'] = { allow: ['all'] }; }))(f);
    f.run(['render', ...SRC, ...OUT]);
  } },
  // test_unknown_nested_field_and_invalid_choice_are_redacted
  { name: 'unknown-nested-field-and-invalid-choice-redacted', build: withDocRun(mutated((d) => {
    d.conversation.language = 'synthetic-private-value-do-not-echo';
    d.conversation['synthetic-private-value-do-not-echo'] = 'synthetic-private-value-do-not-echo';
  })) },
  // test_malformed_duplicate_and_oversized_json_are_rejected, and the JSON reader's edges
  { name: 'malformed-json-is-rejected', build: (f) => {
    for (const text of ['{"private":"synthetic-input",', '{"version":1,"version":1}', '{"version":NaN}',
      '{"version":Infinity}', '{"version":-Infinity}', ' '.repeat(MAX_BYTES + 1), '['.repeat(2000), '', ' ',
      '{"version":1,}', '[1,]', '{"a" 1}', '{1:1}', "{'a':1}", '{"a":"\\x"}', '{"a":"\\u12"}', '{"a":"\t"}',
      '{"a":01}', '{"a":1.}', '{"a":.5}', '{"a":-}', '{"a":+1}', '{"a":tru}', '{"a":nul}', '{} {}', '{}x',
      '{"version":"' + 'x', '\ufeff{}', '{"a":"\\ud800"}x', '{"a":[1 2]}', '{"a":1}}', '"x"', 'null', '1',
      '{"version":' + '1'.repeat(4301) + '}', '{"version":-' + '1'.repeat(4301) + '}']) {
      validateText(f, text);
    }
  } },
  { name: 'json-values-that-parse-then-fail-the-schema', build: (f) => {
    for (const text of ['[]', '{}', '"profile"', '{"version":1.0}', '{"version":1e0}', '{"version":true}',
      '{"version":"1"}', '{"version":null}', '{"version":' + '1'.repeat(4300) + '}', '{"version":-' + '1'.repeat(4300) + '}',
      '{"version":-0}', '{"version":1e400}', '{"__proto__":1}', '{"constructor":{}}', '{"version":1,"\\u0076ersion":1}',
      '{"a":"\\ud800","b":"\\udc00\\ud800","c":"\\ud83d\\ude00","d":"\\/\\b\\f\\n\\r\\t\\"\\\\"}']) {
      validateText(f, text);
    }
  } },
  { name: 'utf8-and-size-edges', build: (f) => {
    f.write('profile.json', Uint8Array.from([0x7b, 0xff, 0x7d]));
    f.run(['validate', ...SRC]);
    f.write('profile.json', Uint8Array.from([0x7b, 0x22, 0xed, 0xa0, 0x80, 0x22, 0x3a, 0x31, 0x7d]));
    f.run(['validate', ...SRC]);
    const valid = JSON.stringify(doc());
    f.write('profile.json', valid + ' '.repeat(MAX_BYTES - valid.length));
    f.run(['validate', ...SRC]);
    f.write('profile.json', valid + ' '.repeat(MAX_BYTES - valid.length + 1));
    f.run(['validate', ...SRC]);
    f.write('profile.json', valid.replace('"en"', '"\u00e9n"'));
    f.run(['validate', ...SRC]);
  } },
  { name: 'deep-nesting-inside-the-size-cap', build: (f) => {
    const deep = (/** @type {number} */ n) => '['.repeat(n) + ']'.repeat(n);
    validateText(f, '{"x":' + deep(30000) + '}');
    validateText(f, JSON.stringify(doc()).replace('["claude-code","codex","kiro-cli","claude-desktop"]', '[' + deep(15000) + ',' + deep(15000) + ']'));
    validateText(f, JSON.stringify(doc()).replace('["claude-code","codex","kiro-cli","claude-desktop"]', '[' + deep(15000) + ',' + deep(14999) + ']'));
    validateText(f, '{"x":' + '{"a":'.repeat(10000) + '1' + '}'.repeat(10000) + '}');
  } },
  // test_missing_fields_boolean_integer_and_bounds, each mutation as its own validate run
  { name: 'missing-fields-boolean-integer-and-bounds', build: (f) => {
    /** @type {Array<(d: any) => void>} */
    const mutations = [
      (d) => { delete d.conversation; },
      (d) => { d.version = true; },
      (d) => { d.version = 2; },
      (d) => { d.interaction.max_question_chars = true; },
      (d) => { d.interaction.max_question_chars = -1; },
      (d) => { d.interaction.max_question_chars = 10001; },
      (d) => { d.interaction.decision_options = 4; },
      (d) => { d.interaction.decision_options = true; },
      (d) => { d.desktop = { notifications: 'all' }; },
      (d) => { d.desktop = {}; },
      (d) => { d.surfaces = []; },
      (d) => { d.surfaces = ['codex', 'codex']; },
      (d) => { d.surfaces = [{}]; },
      (d) => { d.interaction.max_question_chars = 0; },
      (d) => { d.interaction.max_question_chars = 10000; },
      (d) => { d.interaction.decision_options = 3; },
      (d) => { d.surfaces = [1, true]; },
      (d) => { d.surfaces = [0, false, null]; },
      (d) => { d.surfaces = [[1], [1]]; },
      (d) => { d.surfaces = [{ a: 1 }, { a: 1 }]; },
      (d) => { d.surfaces = [{ a: 1 }, { a: 2 }]; },
      (d) => { d.surfaces = ['codex']; },
      (d) => { d.surfaces = 'codex'; },
      (d) => { d.conversation = []; },
      (d) => { d.session_start = { priority: 'balanced', extra: 1 }; },
      (d) => { delete d.version; delete d.surfaces; delete d.interaction.command_preference; },
      (d) => { d.conversation.cadence = 'fast'; d.conversation.context_discipline = 'minimum-sufficient'; },
      (d) => { d.conversation.decision_tone = 1; },
    ];
    for (const m of mutations) {
      f.json('profile.json', mutated(m));
      f.run(['validate', ...SRC]);
    }
    // Text the JSON serializer cannot produce from a JavaScript value: floats and a mixed int/float/bool list.
    validateText(f, JSON.stringify(doc()).replace('"max_question_chars":0', '"max_question_chars":280.0'));
    validateText(f, JSON.stringify(doc()).replace('["claude-code","codex","kiro-cli","claude-desktop"]', '[1, 1.0]'));
    validateText(f, JSON.stringify(doc()).replace('["claude-code","codex","kiro-cli","claude-desktop"]', '[2, 2.5, 1e400, 1e400]'));
    validateText(f, JSON.stringify(doc()).replace('["claude-code","codex","kiro-cli","claude-desktop"]', '[9007199254740993, 9007199254740992.0]'));
    validateText(f, JSON.stringify(doc()).replace('"version":1', '"version":3'));
  } },
  // test_plan_is_read_only_and_does_not_claim_installation
  { name: 'plan-is-read-only', build: (f) => {
    withDoc(mutated((d) => { d.desktop = { notifications: 'essential' }; d.session_start.priority = 'speed'; }))(f);
    f.run(['plan', ...SRC]);
  } },
  // test_render_preserves_unrelated_files_and_is_idempotent
  { name: 'render-keeps-unrelated-files-and-is-idempotent', cli: true, build: (f) => {
    withDoc(doc())(f);
    f.mkdir('output');
    f.write('output/keep.txt', 'keep');
    f.run(['render', ...SRC, ...OUT]);
    f.run(['render', ...SRC, ...OUT]);
    f.run(['check', ...SRC, ...OUT]);
  } },
  // test_drift_is_observed_then_repaired
  { name: 'drift-observed-then-repaired', cli: true, build: (f) => {
    withDoc(doc())(f);
    f.run(['render', ...SRC, ...OUT]);
    f.write('output/AGENTS.md', f.read('output/AGENTS.md') + 'synthetic drift\n');
    f.run(['check', ...SRC, ...OUT]);
    f.run(['render', ...SRC, ...OUT]);
    f.run(['check', ...SRC, ...OUT]);
    // A changed source drifts every file the digest reaches.
    withDoc(mutated((d) => { d.session_start.priority = 'speed'; }))(f);
    f.run(['check', ...SRC, ...OUT]);
    f.run(['render', ...SRC, ...OUT]);
  } },
  // test_missing_output_check_writes_nothing
  { name: 'missing-output-check-writes-nothing', build: (f) => {
    withDoc(doc())(f);
    f.run(['check', ...SRC, ...OUT]);
    f.run(['check', ...SRC, '--output', 'a/b/c']);
    f.run(['render', ...SRC, '--output', 'a/b/c']);
  } },
  // test_unmanaged_target_refuses_all_writes, and every other unmanaged form
  { name: 'unmanaged-target-refuses-all-writes', build: (f) => {
    withDoc(doc())(f);
    f.mkdir('output');
    f.write('output/clipboard.conf', 'unmanaged');
    f.run(['render', ...SRC, ...OUT]);
    f.run(['check', ...SRC, ...OUT]);
    f.write('output/clipboard.conf', '# managed-by: personal-multi-harness-workstation-configuration/profile-v1;x');
    f.run(['render', ...SRC, ...OUT]);
    f.write('output/AGENTS.md', '\ufeff<!-- managed-by: personal-multi-harness-workstation-configuration/profile-v1; x');
    f.run(['render', ...SRC, ...OUT]);
    f.write('output/AGENTS.md', '<!-- managed-by: personal-multi-harness-workstation-configuration/profile-v1 x');
    f.run(['render', ...SRC, ...OUT]);
  } },
  { name: 'profile-plan-json-ownership', build: (f) => {
    withDoc(doc())(f);
    f.mkdir('output');
    const m = 'personal-multi-harness-workstation-configuration/profile-v1';
    for (const text of ['{"managed_by":"' + m + '"}', '{"managed_by":"' + m + '","x":NaN}', '{"managed_by":"x","managed_by":"' + m + '"}',
      '{"managed_by":"' + m + '","managed_by":"x"}', '["' + m + '"]', '"' + m + '"', '{"managed_by":"' + m + '"', '',
      '{"managed_by":"' + m + '","x":' + '['.repeat(20000) + ']'.repeat(20000) + '}', '{"managed_by":"' + m + '","n":' + '1'.repeat(4301) + '}',
      '{"managed_by":"' + m + '"}\r\n', '{"managed_by":"' + m.toUpperCase() + '"}']) {
      f.write('output/profile-plan.json', text);
      f.run(['check', ...SRC, ...OUT]);
    }
  } },
  // test_symlink_refuses_all_writes
  { name: 'symlink-target-refuses-all-writes', posix: true, build: (f) => {
    withDoc(doc())(f);
    f.mkdir('output');
    f.write('other', 'untouched');
    f.link('output/clipboard.conf', '../other');
    f.run(['render', ...SRC, ...OUT]);
    f.link('output/AGENTS.md', 'missing-target');
    f.run(['check', ...SRC, ...OUT]);
  } },
  { name: 'non-file-target-and-output-shapes', build: (f) => {
    withDoc(doc())(f);
    f.mkdir('output/AGENTS.md');
    f.run(['render', ...SRC, ...OUT]);
    f.write('file-output', 'x');
    f.run(['render', ...SRC, '--output', 'file-output']);
    f.run(['check', ...SRC, '--output', 'file-output']);
    f.run(['render', ...SRC, '--output', '.']);
    f.run(['check', ...SRC, '--output', '.']);
    f.run(['check', ...SRC, '--output', './']);
  } },
  { name: 'output-through-a-directory-link-inside-the-directory', posix: true, build: (f) => {
    withDoc(doc())(f);
    f.mkdir('real');
    f.link('linked', 'real', true);
    f.run(['render', ...SRC, '--output', 'linked']);
    f.run(['check', ...SRC, '--output', 'real']);
  } },
  { name: 'undecodable-existing-target', build: (f) => {
    withDoc(doc())(f);
    f.mkdir('output');
    f.write('output/clipboard.conf', Uint8Array.from([0x23, 0xff]));
    f.run(['render', ...SRC, ...OUT]);
  } },
  // test_mentioning_marker_does_not_establish_ownership
  { name: 'mentioning-marker-is-not-ownership', build: (f) => {
    withDoc(doc())(f);
    f.mkdir('output');
    f.write('output/AGENTS.md', 'Notes about personal-multi-harness-workstation-configuration/profile-v1');
    f.run(['render', ...SRC, ...OUT]);
  } },
  // test_crlf_output_is_not_false_drift (and a lone CR)
  { name: 'crlf-output-is-not-drift', build: (f) => {
    withDoc(doc())(f);
    f.run(['render', ...SRC, ...OUT]);
    for (const name of ['AGENTS.md', 'clipboard.conf', 'desktop-instructions.md', 'profile-plan.json']) {
      f.write('output/' + name, f.read('output/' + name).replace(/\n/g, '\r\n'));
    }
    f.run(['check', ...SRC, ...OUT]);
    f.write('output/AGENTS.md', f.read('output/AGENTS.md').replace(/\r\n/g, '\r'));
    f.run(['check', ...SRC, ...OUT]);
    f.run(['render', ...SRC, ...OUT]);
  } },
  // test_pt_profile_localizes_notices_and_keeps_floor, through the CLI
  { name: 'pt-profile-renders', build: (f) => {
    withDoc(mutated((d) => {
      Object.assign(d.conversation, { language: 'pt-BR', decision_tone: 'executive-concise', cadence: 'paced', context_discipline: 'minimum-sufficient' });
      Object.assign(d.interaction, { max_question_chars: 280, decision_options: 3, command_preference: 'natural-language' });
      d.session_start.priority = 'balanced';
      d.desktop = { notifications: 'essential' };
      d.surfaces = ['codex'];
    }))(f);
    f.run(['render', ...SRC, ...OUT]);
    f.run(['plan', ...SRC]);
  } },
  // test_cli_cannot_read_or_write_outside_working_directory and test_symlink_ancestor_cannot_escape
  { name: 'cannot-read-or-write-outside-the-directory', build: (f) => {
    withDoc(doc())(f);
    f.mkdir('work');
    f.json('work/profile.json', doc());
    f.run(['validate', '--source', path.join(ROOT, 'global', 'profile', 'profile.example.json')], { cwd: 'work' });
    f.run(['validate', '--source', '../profile.json'], { cwd: 'work' });
    f.run(['render', '--source', 'profile.json', '--output', '../escape'], { cwd: 'work' });
    f.run(['render', '--source', 'profile.json', '--output', '..'], { cwd: 'work' });
    f.run(['validate', '--source', 'sub/../profile.json'], { cwd: 'work' });
    f.run(['validate', '--source', '.'], { cwd: 'work' });
    f.run(['validate', '--source', ''], { cwd: 'work' });
    f.run(['validate', '--source', 'missing.json'], { cwd: 'work' });
    f.run(['validate', '--source', 'work/../profile.json']);
  } },
  { name: 'symlinked-source-and-ancestor', posix: true, build: (f) => {
    withDoc(doc())(f);
    f.mkdir('work');
    f.json('work/profile.json', doc());
    f.link('work/link.json', 'profile.json');
    f.link('work/outside', '..', true);
    f.link('work/loop', 'loop');
    f.run(['validate', '--source', 'link.json'], { cwd: 'work' });
    f.run(['validate', '--source', 'link.json/'], { cwd: 'work' });
    f.run(['validate', '--source', './link.json'], { cwd: 'work' });
    f.run(['validate', '--source', 'outside/profile.json'], { cwd: 'work' });
    f.run(['validate', '--source', 'outside/work/profile.json'], { cwd: 'work' });
    f.run(['render', '--source', 'profile.json', '--output', 'outside/escape'], { cwd: 'work' });
    f.run(['validate', '--source', 'loop/x'], { cwd: 'work' });
    f.run(['check', '--source', 'profile.json', '--output', 'loop/x'], { cwd: 'work' });
  } },
];

/** @param {any} d @returns {(f: Fixture) => void} */
function withDocRun(d) {
  return (f) => {
    f.json('profile.json', d);
    f.run(['validate', ...SRC]);
  };
}

const ENUMS = {
  language: ['en', 'pt-BR'],
  publication_language: ['en', 'pt-BR'],
  decision_tone: ['concise', 'executive-concise', 'conversational', 'didactic'],
  command_preference: ['slash', 'natural-language'],
  priority: ['unselected', 'balanced', 'quality', 'speed'],
};
const SURFACES = [['claude-code', 'codex', 'kiro-cli', 'claude-desktop'], ['codex'], ['claude-desktop', 'kiro-cli']];

/** A deterministic generator, so the matrix is the same on every run. @param {number} seed */
function lcg(seed) {
  let x = seed;
  return (/** @type {number} */ n) => {
    x = (x * 1103515245 + 12345) % 2147483648;
    return x % n;
  };
}

/**
 * The compile matrix: valid profile texts covering every choice and every optional field, in varied key
 * orders and spacing (the digest sorts keys; the text does not). Each is compiled by the original and by
 * the Node command against a synthetic floor and locale, and the four outputs are compared.
 * @returns {string[]}
 */
export function matrix() {
  const pick = lcg(479);
  /** @type {string[]} */
  const out = [];
  for (let k = 0; k < 160; k++) {
    /** @type {Record<string, any>} */
    const d = {
      version: 1,
      conversation: { language: ENUMS.language[pick(2)], publication_language: ENUMS.publication_language[pick(2)],
        decision_tone: ENUMS.decision_tone[k % 4] },
      interaction: { max_question_chars: [0, 1, 280, 10000][pick(4)], command_preference: ENUMS.command_preference[pick(2)] },
      session_start: { priority: ENUMS.priority[(k >> 2) % 4] },
      surfaces: SURFACES[pick(3)],
    };
    if (pick(2)) d.conversation.cadence = 'paced';
    if (pick(2)) d.conversation.context_discipline = 'minimum-sufficient';
    if (pick(2)) d.interaction.decision_options = 3;
    if (pick(2)) d.desktop = { notifications: 'essential' };
    /** @param {any} v @returns {any} */
    const shuffle = (v) => {
      if (Array.isArray(v) || v === null || typeof v !== 'object') return v;
      const keys = Object.keys(v);
      for (let i = keys.length - 1; i > 0; i--) {
        const j = pick(i + 1);
        [keys[i], keys[j]] = [keys[j], keys[i]];
      }
      return Object.fromEntries(keys.map((key) => [key, shuffle(v[key])]));
    };
    out.push(JSON.stringify(pick(2) ? shuffle(d) : d, null, pick(2) ? 2 : undefined));
  }
  return out;
}

/**
 * The synthetic floor and locale the matrix compiles against: CRLF, a lone CR, and a trailing run where
 * Python's str.rstrip() and JavaScript's trimEnd() disagree (Python strips U+001F and U+0085 and keeps
 * U+FEFF; JavaScript strips U+FEFF and keeps U+0085). Escapes only, so no invisible character is in the file.
 */
export const SYNTHETIC = {
  floor: '# Synthetic floor\r\n\r\nA line.\r\nA lone CR\rends here. \u00e9\u3000\ufeff\u001f\u0085\n\n\u2028 \t\u00a0\u1680\n',
  locale: '# synthetic locale\r\nnotice_paste_redacted=synthetic\n',
};
