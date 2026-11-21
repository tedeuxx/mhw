// The S23 parity cases (#494, convention 3 of #470): `mhw check`, `--prerequisites` and `--project=DIR`,
// each case on a fresh throwaway HOME and admin root, every step through `node <tree>/bin/mhw.js`. At the
// base revision check ran global/workstation.py (prerequisites.py, merge_authority.py); at the head it runs
// src/commands/check.js. Steps marked setup run the same code on both sides and record only their exit code.
// Every name, value, token and file here is SYNTHETIC; gh is always a stand-in, never the real one, and the
// services are test/check/fake-service.js on 127.0.0.1.
import fs from 'node:fs';
import path from 'node:path';
import { BLOCK, CORRECTED_SECTION, HISTORY, LEGACY_SECTION, RC_BRIEF, brief } from './briefs.js';

export const NAME = 'personal-multi-harness-workstation-configuration';
export const LOGIN = 'fake-login-never-printed';
export const TOKEN = 'fake-token-for-tests-0000';

/**
 * @typedef {{ home: string, root: string, dir: string, tree: string }} Where
 * @typedef {{ args: string[], setup?: boolean, env?: Record<string, string>, archive?: string, cwd?: string,
 *   pre?: (w: Where) => void, post?: (w: Where) => string }} Step
 * @typedef {{ name: string, mode: 'bare' | 'full', package?: boolean, service?: boolean, stubs?: Record<string, string>,
 *   env?: Record<string, string>, setup?: (w: Where) => void, steps: Step[] }} Case
 */

/** @param {string} file @param {string | Buffer} text */
export function put(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}
/** @param {string} file @param {unknown} doc */
const putJson = (file, doc) => put(file, JSON.stringify(doc));

const darwin = process.platform === 'darwin';
/** @param {Where} w */
const adminDir = (w) => w.root + (darwin ? '/Library/Application Support/' : '/etc/') + NAME;
/** @param {Where} w */
const dropin = (w) => w.root + (darwin ? '/Library/Application Support/ClaudeCode' : '/etc/claude-code') + '/managed-settings.d/50-' + NAME + '.json';
/** @param {Where} w @param {string} name */
const proj = (w, name) => path.join(w.dir, 'work', name);

const NONE = '--overlay=none';
const OVERLAY = '<OVERLAY>';
/** A check step. @param {string[]} args @param {Partial<Step>} [more] */
const C = (args, more = {}) => ({ args: ['check', ...args], ...more });
/** A prerequisites step on the case's overlay. @param {Partial<Step>} [more] */
const P = (more = {}) => C(['--prerequisites', OVERLAY], more);
/** A setup step. @param {string[]} args @param {Partial<Step>} [more] */
const U = (args, more = {}) => ({ args, setup: true, ...more });

// ---------------------------------------------------------------------------------------------------
// The prerequisites declaration, the overlay and the stand-ins (global/prerequisites_test.py).

/**
 * A declaration item, as the Python suite's item().
 * @param {string} id @param {Record<string, unknown>} [kw]
 */
export function item(id, kw = {}) {
  const { required = 'required', cmd = 'git', ...rest } = /** @type {Record<string, any>} */ (kw);
  return { id, name: id, category: 'local-tool', required, manual: 'STEP-' + id, presence: { commands: [cmd] }, ...rest };
}
export const GH_ITEM = item('gh', { cmd: 'gh', version: { args: ['--version'] }, auth: { kind: 'gh-auth-status' }, preferred: { kind: 'github-repo-settings' } });

/** @param {Where} w @param {unknown[]} items @param {string[]} [lanes] */
export function declare(w, items, lanes = ['workstation', 'site']) {
  putJson(path.join(w.dir, 'decl.json'), { lanes: Object.fromEntries(lanes.map((l) => [l, l])), items });
}
/** @param {Where} w @param {unknown} doc */
export const overlayFile = (w, doc) => putJson(path.join(w.dir, 'overlay', 'prerequisites.local.json'), doc);
/** @param {Where} w @param {string} name @param {string} text */
export function shim(w, name, text) {
  const p = path.join(w.dir, 'bin', name);
  put(p, text);
  fs.chmodSync(p, 0o700);
}
/** @param {Where} w @param {string} name @param {string} line @param {number} [code] */
export const tool = (w, name, line, code = 0) => shim(w, name, "#!/bin/sh\necho '" + line + "'\nexit " + code + '\n');
/** @param {Where} w @param {unknown} doc */
export const repoJson = (w, doc) => putJson(path.join(w.dir, 'repo.json'), doc);

export const GH_SHIM = `#!/bin/sh
printf '%s\\n' "$*" >> "$STUB_LOG"
case "$1 $2" in
  "--version "*) echo "gh version 2.40.1 (2024-01-01)"; exit 0 ;;
  "auth status") echo "\${FAKE_GH_MSG:-Logged in to github.com account} $FAKE_LOGIN"; exit "\${FAKE_GH_AUTH:-0}" ;;
  "repo view") [ -n "\${FAKE_VIEW_FAIL:-}" ] && { cat "$STUB_REPO"; exit 1; }; cat "$STUB_REPO"; exit 0 ;;
esac
exit 3
`;

const MATCHING = { mergeCommitAllowed: true, squashMergeAllowed: false, rebaseMergeAllowed: false };
/** The GitHub cases' common setup: the gh shim, the gh item, an overlay repository, a matching repository. @param {(w: Where) => void} [more] */
const github = (more) => (/** @type {Where} */ w) => {
  shim(w, 'gh', GH_SHIM);
  declare(w, [GH_ITEM]);
  overlayFile(w, { github_repos: ['owner-x/repo-y'] });
  repoJson(w, MATCHING);
  more?.(w);
};
// Never the real GitHub: a refused loopback port unless a case points it at the stand-in service.
const OFFLINE = { WORKSTATION_GITHUB_URL: 'http://127.0.0.1:9' };

const SERVICE_ITEMS = [
  item('sonar', { required: 'optional', presence: { kind: 'account' }, auth: { kind: 'sonarcloud-token', env: 'SONAR_TOKEN' }, preferred: { kind: 'sonarcloud-project' } }),
  item('tfc', { required: 'optional', presence: { kind: 'account' }, auth: { kind: 'tfc-token', env: 'TFC_API_TOKEN' } }),
];
const SERVICES = { WORKSTATION_SONAR_URL: '<SERVICE>', WORKSTATION_TFC_URL: '<SERVICE>' };

// The terraform shim of the version-manager case: it installs (leaves a marker and fails) unless every
// switch in PROBE_ENV is set, as tfenv does with TFENV_AUTO_INSTALL unset (measured on tfenv 3.0.0).
/** @param {Where} w */
const tfenvShim = (w) => shim(w, 'terraform', '#!/bin/sh\n'
  + 'if [ "$TFENV_AUTO_INSTALL" != false ] || [ "$CHECKPOINT_DISABLE" != 1 ] || '
  + '[ "$GH_NO_UPDATE_NOTIFIER" != 1 ] || [ "$HOMEBREW_NO_AUTO_UPDATE" != 1 ]; then\n'
  + "  echo x >> '" + path.join(w.dir, 'installed') + "'; echo 'Installing now as TFENV_AUTO_INSTALL==true'; exit 126\nfi\n"
  + "echo 'Terraform v1.5.0'\n");

// ---------------------------------------------------------------------------------------------------
// The merge-authority project briefs (global/merge_authority_test.py).

/** The installed skill copies, from the tree under test, behind a managed-by front matter. @param {Where} w @param {string[]} [harnesses] */
function installCopies(w, harnesses = ['.claude', '.agents', '.kiro']) {
  const skill = fs.readFileSync(path.join(w.tree, 'method', 'skills', 'merge-authority', 'SKILL.md'), 'utf8');
  for (const h of harnesses) put(path.join(w.home, h, 'skills', 'merge-authority', 'SKILL.md'), '---\nmanaged-by: x\n---\n' + skill);
}
/** @param {Where} w */
const kiroCopy = (w) => path.join(w.home, '.kiro', 'skills', 'merge-authority', 'SKILL.md');
/** A step that writes the project brief and checks it. @param {string} text @param {Partial<Step>} [more] */
const B = (text, more = {}) => C(['--prerequisites', NONE, '<P:p>'], { pre: (w) => put(path.join(proj(w, 'p'), 'AGENTS.md'), brief(text)), ...more });
/** @param {string} line */
const withLine = (line) => CORRECTED_SECTION.replace('- loop-model:', line + '\n- loop-model:');
const RC = CORRECTED_SECTION.replace('- loop-model: trunk-single-env\n', '- loop-model: trunk-single-env\n- integration-branch: rc/next\n');
/** @param {string} line */
const rcWith = (line) => RC.replace('- loop-model:', line + '\n- loop-model:');
const EMPTY_DECL = { WORKSTATION_PREREQUISITES: '<BASE>/empty.json' };
/** @param {(w: Where) => void} [more] */
const projectSetup = (more) => (/** @type {Where} */ w) => {
  put(path.join(w.dir, 'empty.json'), '{"lanes": {}, "items": []}');
  fs.mkdirSync(proj(w, 'p'), { recursive: true });
  installCopies(w);
  more?.(w);
};

/** @type {Case[]} */
export const CASES = [
  {
    name: 'prereq-present-missing-lanes',
    mode: 'bare',
    setup: (w) => {
      tool(w, 'git', 'git version 2.3.4');
      declare(w, [item('alpha', { version: { args: ['--version'], minimum: '2.0' } }), item('beta', { required: 'optional', cmd: 'jq' }),
        item('gamma', { required: 'optional', cmd: 'checkov', lanes: { site: 'required' } })]);
    },
    steps: [P(),
      // The owner's overlay activates the site lane: its required item now fails the check.
      P({ pre: (w) => overlayFile(w, { lanes: ['site', 'bogus'] }) }),
      // A required item missing fails without any overlay.
      P({ pre: (w) => {
        overlayFile(w, {});
        fs.rmSync(path.join(w.dir, 'bin', 'git'));
      } })],
  },
  {
    name: 'prereq-version-drift-probe-env',
    mode: 'bare',
    setup: (w) => {
      tfenvShim(w);
      declare(w, [item('alpha', { cmd: 'terraform', version: { args: ['version'], minimum: '1.9' } }),
        item('beta', { cmd: 'terraform', version: { args: ['version'], preferred: '1.5.1' } }),
        item('gamma', { cmd: 'terraform', version: { args: ['version'], minimum: 'v1', preferred: 1 } })]);
    },
    steps: [P({ post: (w) => 'installed marker: ' + fs.existsSync(path.join(w.dir, 'installed')) }),
      P({ pre: (w) => tool(w, 'terraform', 'no version here'), post: () => '' }),
      P({ pre: (w) => tool(w, 'terraform', 'Terraform v9.9.9', 1) })],
  },
  {
    name: 'prereq-any-of-path-os-manual',
    mode: 'bare',
    setup: (w) => {
      tool(w, 'podman', 'podman 1.0');
      tool(w, 'xcode-select', '', 2);
      declare(w, [item('first', { presence: { commands: ['docker', 'podman'] } }),
        item('pathq', { presence: { commands: ['xcode-select'], args: ['-p'] } }),
        item('macos', { cmd: 'security', os: ['NoSuchOS'] }),
        item('here', { cmd: 'security', os: ['Darwin', 'Linux'] }),
        item('sub', { presence: { kind: 'manual' } }),
        item('acct', { required: 'optional', presence: { kind: 'account' }, auth: { kind: 'none' } }),
        item('versionless', { cmd: 'podman', auth: { kind: 'none' } })]);
    },
    steps: [P(), P({ pre: (w) => tool(w, 'xcode-select', '/Library/Developer/CommandLineTools') })],
  },
  {
    name: 'prereq-invalid-declarations',
    mode: 'bare',
    setup: (w) => declare(w, [item('x', { version: { args: ['install'] } })]),
    steps: [P(),
      ...[
        [item('x', { presence: { commands: ['git'], args: ['--apply'] } })],
        [item('x', { presence: { commands: ['git; rm'] } })],
        [item('x', { presence: { commands: ['curl'] } })],
        [item('x', { presence: { commands: ['claude'], args: ['-p'] } })],
        [item('x', { cmd: 'claude', version: { args: ['-p'] } })],
        [item('x', { presence: { commands: ['xcode-select', 'git'], args: ['-p'] } })],
        [item('x', { cmd: 'terraform', version: { args: ['--version'] } })],
        [item('x', { cmd: 'security', version: { args: ['--version'] } })],
        [item('x', { auth: { kind: 'shell' } })],
        [item('x', { auth: { kind: 'tfc-token', env: 'lower case' } })],
        [item('x', { preferred: { kind: 'apply-settings' } })],
        [item('x', { lanes: { nowhere: 'required' } })],
        [item('x', { required: 'maybe' })],
        [item('x', { manual: '' })],
        [item('x'), item('x')],
        [item('x', { version: { args: ['--version'], minimum: 'none' } })],
        [item('x', { os: 'Darwin' })],
        [{ id: 'x', name: 'x', category: 'c', required: 'required', manual: 'm' }],
      ].map((items) => P({ pre: (w) => declare(w, items) })),
      P({ pre: (w) => put(path.join(w.dir, 'decl.json'), '{"items": "none"}') }),
      P({ pre: (w) => put(path.join(w.dir, 'decl.json'), 'not json') }),
      P({ pre: (w) => put(path.join(w.dir, 'decl.json'), Buffer.from([0x7b, 0xff, 0x7d])) }),
      P({ pre: (w) => fs.rmSync(path.join(w.dir, 'decl.json')) }),
      // A valid declaration: the probe set accepts these.
      P({ pre: (w) => declare(w, [item('x', { version: { args: ['--version'], minimum: '1.2' }, lanes: { site: 'optional' } }),
        item('y', { presence: { commands: ['xcode-select'], args: ['-p'] } }), item('z', { cmd: 'terraform', version: { args: ['version'] } })]) })],
  },
  {
    name: 'prereq-repository-declaration-nothing-on-path',
    mode: 'bare',
    env: { WORKSTATION_PREREQUISITES: '<FROZEN>' },
    steps: [P()],
  },
  {
    name: 'prereq-overlay-values',
    mode: 'bare',
    setup: (w) => {
      tool(w, 'git', 'git version 2.3.4');
      declare(w, [item('alpha', { required: 'optional', lanes: { site: 'required' } })]);
    },
    steps: [P({ pre: (w) => put(path.join(w.dir, 'overlay', 'prerequisites.local.json'), 'not json') }),
      P({ pre: (w) => overlayFile(w, ['site']) }),
      P({ pre: (w) => overlayFile(w, { lanes: 'site', github_repos: ['bad repo', 'o/r'], sonar_projects: [1, 'k:1'] }) }),
      P({ pre: (w) => fs.rmSync(path.join(w.dir, 'overlay', 'prerequisites.local.json')) }),
      C(['--prerequisites', NONE], { pre: (w) => overlayFile(w, { lanes: ['site'] }) })],
  },
  {
    name: 'prereq-github',
    mode: 'bare',
    env: OFFLINE,
    setup: github(),
    steps: [
      P({ post: ghLog }),
      // Squash on is drift, and never applied.
      P({ pre: (w) => repoJson(w, { mergeCommitAllowed: true, squashMergeAllowed: true, rebaseMergeAllowed: false }), post: (w) => ghLog(w) + '\nrepo.json: ' + fs.readFileSync(path.join(w.dir, 'repo.json'), 'utf8') }),
      // #206: an unreadable repository is not credited, even when gh printed a matching document.
      P({ pre: (w) => repoJson(w, MATCHING), env: { FAKE_VIEW_FAIL: '1' } }),
      // An absent or non-boolean field reads unknown and is drift.
      P({ pre: (w) => repoJson(w, { mergeCommitAllowed: true, squashMergeAllowed: null }) }),
      P({ pre: (w) => put(path.join(w.dir, 'repo.json'), '[1, 2]') }),
      P({ pre: (w) => repoJson(w, { mergeCommitAllowed: 1, squashMergeAllowed: false, rebaseMergeAllowed: false }) }),
      // Unauthenticated: no repository read.
      P({ pre: (w) => repoJson(w, MATCHING), env: { FAKE_GH_AUTH: '1', FAKE_GH_MSG: 'You are not logged into any GitHub hosts.' }, post: ghLog }),
      // Offline, gh auth status fails like a rejected token: not a claim of no login.
      P({ env: { FAKE_GH_AUTH: '1', FAKE_GH_MSG: 'The token in GH_TOKEN is invalid.' } }),
      // Two repositories, one drifting.
      P({ pre: (w) => overlayFile(w, { github_repos: ['owner-x/repo-y', 'owner-x/repo-z'] }) }),
    ],
  },
  {
    name: 'prereq-github-reachable',
    mode: 'bare',
    service: true,
    env: { WORKSTATION_GITHUB_URL: '<SERVICE>' },
    setup: github(),
    steps: [P({ env: { FAKE_GH_AUTH: '1', FAKE_GH_MSG: 'The token in GH_TOKEN is invalid.' }, post: serviceLog })],
  },
  {
    name: 'prereq-github-origin',
    mode: 'bare',
    package: true,
    env: OFFLINE,
    setup: github((w) => overlayFile(w, {})),
    steps: [P({ post: ghLog }), P({ pre: (w) => {
      const pkg = path.join(w.tree, 'package.json');
      put(pkg + '.s23', fs.readFileSync(pkg));
      const doc = JSON.parse(fs.readFileSync(pkg, 'utf8'));
      doc.repository = { url: 'https://example.invalid/not-github.git' };
      put(pkg, JSON.stringify(doc));
    }, post: (w) => {
      const pkg = path.join(w.tree, 'package.json');
      fs.renameSync(pkg + '.s23', pkg);
      return '';
    } })],
  },
  {
    name: 'prereq-github-checkout-without-origin',
    mode: 'bare',
    env: OFFLINE,
    setup: github((w) => overlayFile(w, {})),
    steps: [P()],
  },
  {
    name: 'prereq-services',
    mode: 'bare',
    service: true,
    env: SERVICES,
    setup: (w) => declare(w, SERVICE_ITEMS),
    steps: [
      // No credential, no call.
      P({ post: serviceLog }),
      P({ pre: (w) => overlayFile(w, { sonar_projects: ['public-project', 'missing-project'] }), env: { SONAR_TOKEN: TOKEN, TFC_API_TOKEN: TOKEN }, post: serviceLog }),
      P({ env: { SONAR_TOKEN: 'wrong', TFC_API_TOKEN: 'wrong' }, post: serviceLog }),
      // Unreachable is not checked.
      P({ env: { SONAR_TOKEN: TOKEN, WORKSTATION_SONAR_URL: 'http://127.0.0.1:9', WORKSTATION_TFC_URL: 'http://127.0.0.1:9', TFC_API_TOKEN: TOKEN } }),
      // A project lookup with no token, through the overlay's key.
      P({ env: { SONAR_TOKEN: '' }, post: serviceLog }),
    ],
  },
  {
    // #494, lens F1 on PR #538: prerequisites.py handed every probe child the caller's environment, tokens
    // included; the Node check removes each declared auth.env variable first. The shim answers another
    // version when it can see a token, so the transcript shows which side passed it on (declared).
    name: 'prereq-tokens-not-inherited',
    mode: 'bare',
    env: { SONAR_TOKEN: TOKEN, TFC_API_TOKEN: TOKEN, WORKSTATION_SONAR_URL: 'http://127.0.0.1:9', WORKSTATION_TFC_URL: 'http://127.0.0.1:9' },
    setup: (w) => {
      shim(w, 'git', '#!/bin/sh\nif [ -n "$SONAR_TOKEN$TFC_API_TOKEN" ]; then echo \'git version 9.9.9\'; else echo \'git version 2.3.4\'; fi\n');
      declare(w, [item('alpha', { version: { args: ['--version'] } }), ...SERVICE_ITEMS]);
    },
    steps: [P()],
  },
  {
    name: 'full-install-then-check',
    mode: 'full',
    env: EMPTY_DECL,
    setup: (w) => put(path.join(w.dir, 'empty.json'), '{"lanes": {}, "items": []}'),
    steps: [C([NONE]), U(['install', '--yes', '--no-admin', NONE]), C([NONE]),
      // A hand edit to one installed file is a difference check must fail on.
      C([NONE], { pre: (w) => fs.appendFileSync(path.join(w.home, '.claude', 'CLAUDE.md'), 'edited\n') }),
      C([NONE, '--prerequisites'])],
  },
  {
    name: 'full-admin-installed',
    mode: 'full',
    env: EMPTY_DECL,
    setup: (w) => put(path.join(w.dir, 'empty.json'), '{"lanes": {}, "items": []}'),
    steps: [U(['install', '--yes', NONE]), C([NONE]),
      C([NONE], { pre: (w) => fs.appendFileSync(dropin(w), ' ') })],
  },
  {
    name: 'full-stale-admin-layer',
    mode: 'full',
    env: EMPTY_DECL,
    setup: (w) => {
      put(path.join(w.dir, 'empty.json'), '{"lanes": {}, "items": []}');
      const bin = path.join(adminDir(w), 'bin');
      fs.mkdirSync(path.join(adminDir(w), 'breaking-glass'), { recursive: true });
      for (const n of ['restart_guard.py', 'breaking_glass.py', 'hitl-escalation-guard.sh', 'hitl.conf', 'clipboard_guard.py', 'clipboard.conf']) put(path.join(bin, n), '# v2.1.0\n');
      /** @param {string} cmd */
      const hook = (cmd) => [{ hooks: [{ type: 'command', command: cmd }] }];
      const restart = '/usr/bin/python3 -I -B "' + path.join(bin, 'restart_guard.py') + '" --harness claude-code';
      putJson(dropin(w), { hooks: { SessionStart: hook(restart), PreToolUse: [...hook(restart), ...hook('/bin/sh "' + path.join(bin, 'hitl-escalation-guard.sh') + '"')],
        UserPromptSubmit: hook('/usr/bin/python3 -I -B "' + path.join(bin, 'clipboard_guard.py') + '" prompt-hook') } });
      put(w.root + '/etc/codex/requirements.toml', '# managed-by: ' + NAME + '; source: global/install-managed.sh; version: 2.1.0\n[hooks]\n'
        + '[[hooks.SessionStart]]\n[[hooks.SessionStart.hooks]]\ntype = "command"\ncommand = "/usr/bin/python3 -I -B \\"' + path.join(bin, 'restart_guard.py') + '\\" --harness codex"\n');
    },
    steps: [C([NONE])],
  },
  {
    name: 'full-package-layout',
    mode: 'full',
    package: true,
    env: EMPTY_DECL,
    setup: (w) => put(path.join(w.dir, 'empty.json'), '{"lanes": {}, "items": []}'),
    steps: [C([NONE]), U(['install', '--yes', '--no-admin', NONE]), C([NONE]),
      C([NONE], { archive: 'v3.2.0' })],
  },
  {
    name: 'project-briefs',
    mode: 'bare',
    env: EMPTY_DECL,
    setup: projectSetup(),
    steps: [
      B(LEGACY_SECTION + '\n' + BLOCK), B(LEGACY_SECTION), B(CORRECTED_SECTION),
      ...['- executor: owner', '- merged-by: developer', '- merges: orchestrator'].map((l) => B(withLine(l))),
      ...['- hold: owner ratification for all published content', '- holds-removed: iac', '- holds: (1) iac (2) articles',
        '- verdict: APPROVE-PENDING-HUMAN for boundary', '- boundary: owner',
        '- boundary-trigger: published content, which the owner ratifies before merge', '- reviewer: product-lead',
        '- boundary-trigger:', 'not a key value line', '* contract: merge-authority v1'].map((l) => B(withLine(l))),
      B(CORRECTED_SECTION.replace('<!-- merge-authority:end -->', '- boundary-trigger: any change under `apps/edge/` or to a public route\'s metadata\n<!-- merge-authority:end -->')),
      B(CORRECTED_SECTION.replaceAll('trunk-single-env', 'gitflow-multi-env')),
      B(CORRECTED_SECTION.replace('- loop-model: trunk-single-env', '- loop-model: trunk-multi-env')),
      B(CORRECTED_SECTION.replace('- loop-model: trunk-single-env', '- loop-model: gitflow-multi-env')),
      B(CORRECTED_SECTION + HISTORY),
      B(CORRECTED_SECTION + HISTORY + '\nThe gate escalates the **boundary class** to the owner.\n'),
      B(CORRECTED_SECTION + '\nEvery boundary diff waits for the owner\'s own click.\n'),
      B(CORRECTED_SECTION.replace(BLOCK, '')),
      B(CORRECTED_SECTION + '\n' + BLOCK),
      B(CORRECTED_SECTION.replace('<!-- merge-authority:end -->', '')),
      B(CORRECTED_SECTION.replace('- contract: merge-authority v1\n', '')),
      B(CORRECTED_SECTION.replace('- contract: merge-authority v1\n', '- contract: merge-authority v1\n- contract: merge-authority v1\n')),
      B(CORRECTED_SECTION.replace('merge-authority v1', 'merge-authority one')),
      B(CORRECTED_SECTION + '\n- an example, quoted:\n\n    ```\n' + BLOCK + '    ```\n'),
      B(CORRECTED_SECTION.replace(BLOCK, BLOCK.split('\n').map((l) => '  ' + l).join('\n'))),
      B(RC_BRIEF + '\n' + BLOCK.replace('- loop-model: trunk-single-env\n', '- loop-model: trunk-single-env\n- integration-branch: rc/next\n')),
      B(RC_BRIEF + '\n' + BLOCK),
      ...['- rc-hold: none', '- promotion-executor: quality-assurance', '- integration-branch: rc/other', '- integration-branch: `not a branch!`'].map((l) => B(rcWith(l))),
      B(RC.replaceAll('trunk-single-env', 'gitflow-multi-env')),
      B(RC + '\nSlices merge into rc/next; the release candidate waits for the owner.\n'),
      B(CORRECTED_SECTION + '\nWhere the method and this file disagree, this file wins.\n'),
      B(CORRECTED_SECTION + '\nOn merge authority this file wins? No.\n'),
      B(CORRECTED_SECTION + '\nThe gate never merges the boundary; the boundary class is held for review. It does not merge boundary diffs.\n'),
      B(CORRECTED_SECTION + '\nLoop model: gitflow-multi-env, says «loop model: trunk-other» in a quote.\n'),
      B(CORRECTED_SECTION + '\n~~~\nThe gate escalates the boundary class.\n~~~\n'),
      B(CORRECTED_SECTION.replace('merge-authority v1', 'merge-authority v0')),
    ],
  },
  {
    name: 'project-fail-closed',
    mode: 'bare',
    env: EMPTY_DECL,
    setup: projectSetup((w) => put(path.join(proj(w, 'p'), 'AGENTS.md'), brief(CORRECTED_SECTION))),
    steps: [
      C(['--prerequisites', NONE, '<P:p>']),
      C(['--prerequisites', NONE, '<P:p>'], { pre: (w) => {
        const t = fs.readFileSync(kiroCopy(w), 'utf8');
        put(kiroCopy(w) + '.s23', t);
        put(kiroCopy(w), t.replace(/"version": \d+/, '"version": 0'));
      } }),
      C(['--prerequisites', NONE, '<P:p>'], { pre: (w) => put(kiroCopy(w), fs.readFileSync(kiroCopy(w) + '.s23', 'utf8').replace('```merge-authority-contract', '```json')) }),
      C(['--prerequisites', NONE, '<P:p>'], { pre: (w) => put(kiroCopy(w), Buffer.from([0xff, 0xfe, 0x00, 0x6e])) }),
      C(['--prerequisites', NONE, '<P:p>'], { pre: (w) => put(kiroCopy(w), fs.readFileSync(kiroCopy(w) + '.s23', 'utf8').replace('"declaration-versions": [1]', '"declaration-versions": []')) }),
      C(['--prerequisites', NONE, '<P:p>'], { pre: (w) => put(kiroCopy(w), fs.readFileSync(kiroCopy(w) + '.s23', 'utf8').replace('"contract": "merge-authority"', '"contract": "merge-authority",,')) }),
      C(['--prerequisites', NONE, '<P:p>'], { pre: (w) => put(kiroCopy(w), fs.readFileSync(kiroCopy(w) + '.s23', 'utf8').replace('"safe": "APPROVE-AND-MERGE"', '"safe": "APPROVE-SOMETHING"')) }),
      C(['--prerequisites', NONE, '<P:p>'], { pre: (w) => put(kiroCopy(w), fs.readFileSync(kiroCopy(w) + '.s23', 'utf8')) }),
      C(['--prerequisites', NONE, '<P:p>'], { pre: (w) => put(path.join(proj(w, 'p'), 'AGENTS.md'), brief(CORRECTED_SECTION.replace('merge-authority v1', 'merge-authority v2'))) }),
      C(['--prerequisites', NONE, '<P:p>'], { pre: (w) => {
        for (const h of ['.claude', '.agents', '.kiro']) fs.rmSync(path.join(w.home, h, 'skills'), { recursive: true, force: true });
      } }),
      C(['--prerequisites', NONE, '<P:p>'], { pre: (w) => installCopies(w, ['.agents']) }),
    ],
  },
  {
    name: 'project-paths',
    mode: 'bare',
    env: EMPTY_DECL,
    setup: projectSetup((w) => {
      put(path.join(proj(w, 'p'), 'AGENTS.md'), brief(CORRECTED_SECTION));
      fs.mkdirSync(proj(w, 'none'), { recursive: true });
      fs.mkdirSync(path.join(proj(w, 'dir'), 'AGENTS.md'), { recursive: true });
      put(path.join(w.home, 'proj', 'AGENTS.md'), brief(CORRECTED_SECTION));
      put(path.join(proj(w, 'file')), 'x');
      fs.symlinkSync(proj(w, 'p'), proj(w, 'link'));
    }),
    steps: [
      C(['--prerequisites', NONE, '<P:none>']),
      C(['--prerequisites', NONE, '<P:dir>']),
      C(['--prerequisites', NONE, '<P:file>']),
      C(['--prerequisites', NONE, '<P:missing>']),
      C(['--prerequisites', NONE, '<P:link>']),
      C(['--prerequisites', NONE, '--project=~/proj']),
      C(['--prerequisites', NONE, '--project=']),
      C(['--prerequisites', NONE, '--project=.'], { cwd: 'work/p' }),
      C(['--prerequisites', NONE, '--project=../p/'], { cwd: 'work/none' }),
    ],
  },
  {
    name: 'project-not-utf8',
    mode: 'bare',
    env: EMPTY_DECL,
    setup: projectSetup((w) => put(path.join(proj(w, 'p'), 'AGENTS.md'), Buffer.from([0x23, 0x20, 0xff, 0x0a]))),
    steps: [C(['--prerequisites', NONE, '<P:p>'])],
  },
  {
    name: 'usage-errors',
    mode: 'bare',
    env: EMPTY_DECL,
    setup: (w) => put(path.join(w.dir, 'empty.json'), '{"lanes": {}, "items": []}'),
    steps: [C(['--bogus']), C(['--verbose']), C(['-v']), C(['--yes']), C(['--overlay=/nonexistent/s23']), C(['--overlay=-x']),
      C(['--overlay=']), C(['--project']), C(['--prerequisites', '--summary']), C(['--prerequisites', '--overlay=work'])],
  },
];

/** The stand-in gh's call log, then emptied. @param {Where} w */
export function ghLog(w) {
  const f = path.join(w.dir, 'gh.log');
  const t = fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '';
  fs.rmSync(f, { force: true });
  return 'gh calls:\n' + t;
}

/** The stand-in service's request log, then emptied. @param {Where} w */
export function serviceLog(w) {
  const f = path.join(w.dir, 'service.log');
  const t = fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '';
  fs.writeFileSync(f, '');
  return 'service requests:\n' + t;
}
