// The prerequisites section of mhw check (Issue #89), moved from global/prerequisites_test.py with the check
// (#494, S23 of #470). Throwaway HOME, fake tool shims on a PATH that holds nothing else, a stub gh that
// never contacts GitHub, and a loopback service (test/check/fake-service.js, its own process) standing in
// for SonarCloud and HCP Terraform. Never a real account, never a real credential, never a write outside
// the temporary directory.
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import * as pq from '../../src/lib/prerequisites.js';
import { getSync } from '../../src/lib/http-get.js';
import { throwawayHome, which } from '../helpers/home.js';
import { item, GH_ITEM, GH_SHIM, LOGIN, TOKEN } from './cases.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const POSIX = process.platform !== 'win32';
const SHELL = POSIX && fs.existsSync('/bin/sh');

describe('the declaration', () => {
  test('the repository declaration is valid and generic', () => {
    const doc = pq.loadDeclaration(pq.DECLARATION);
    const ids = doc.items.map((/** @type {any} */ i) => i.id);
    for (const needed of ['claude', 'codex', 'github', 'sonarcloud', 'terraform-cloud', 'git', 'jq', 'python3', 'terraform', 'node']) assert.ok(ids.includes(needed), needed);
    for (const i of doc.items) assert.ok(i.manual.trim(), i.id);
    const text = fs.readFileSync(pq.DECLARATION, 'utf8');
    // Generic: no account, repository owner, e-mail or credential value.
    assert.doesNotMatch(text, /[\w.+-]+@[\w-]+\.[\w.]+/);
    assert.ok(!text.includes('tedeuxx'));
    assert.doesNotMatch(text, /(ghp_|gho_|github_pat_|sqp_|squ_)[A-Za-z0-9]/);
  });

  test('Node is required at the D11 floor, the engines.node of package.json (#494)', () => {
    const doc = pq.loadDeclaration(pq.DECLARATION);
    const node = doc.items.find((/** @type {any} */ i) => i.id === 'node');
    const engines = JSON.parse(fs.readFileSync(path.join(REPO, 'package.json'), 'utf8')).engines.node;
    const floor = /^>=(\d+)$/.exec(engines);
    assert.ok(floor, 'engines.node is a >=N floor: ' + engines);
    assert.equal(node.required, 'required');
    assert.equal(node.version.minimum, floor[1]);
    for (const lane of ['workstation', 'delivery']) assert.equal(node.lanes[lane], 'required', lane);
    assert.match(node.manual, new RegExp('Node\\.js ' + floor[1] + ' or later'));
  });

  test('the probe set is closed', () => {
    const lanes = { lanes: { site: '' } };
    const bad = [
      item('x', { version: { args: ['install'] } }),
      item('x', { presence: { commands: ['git'], args: ['--apply'] } }),
      item('x', { presence: { commands: ['git; rm'] } }),
      item('x', { presence: { commands: ['curl'] } }),
      // -p is xcode-select's path query only: claude -p would send a prompt to a model.
      item('x', { presence: { commands: ['claude'], args: ['-p'] } }),
      item('x', { cmd: 'claude', version: { args: ['-p'] } }),
      item('x', { presence: { commands: ['xcode-select', 'git'], args: ['-p'] } }),
      item('x', { cmd: 'terraform', version: { args: ['--version'] } }),
      item('x', { cmd: 'security', version: { args: ['--version'] } }),
      item('x', { auth: { kind: 'shell' } }),
      item('x', { auth: { kind: 'tfc-token', env: 'lower case' } }),
      item('x', { preferred: { kind: 'apply-settings' } }),
      item('x', { lanes: { nowhere: 'required' } }),
      item('x', { required: 'maybe' }),
      item('x', { manual: '' }),
    ];
    for (const b of bad) assert.throws(() => pq.validate({ ...lanes, items: [b] }), pq.DeclarationError, JSON.stringify(b));
    pq.validate({ ...lanes, items: [item('x', { version: { args: ['--version'], minimum: '1.2' }, lanes: { site: 'optional' } }),
      item('y', { presence: { commands: ['xcode-select'], args: ['-p'] } }), item('z', { cmd: 'terraform', version: { args: ['version'] } })] });
  });

  test('the agent harnesses are version-queried only', () => {
    for (const harness of ['claude', 'codex', 'kiro-cli']) assert.deepEqual(pq.COMMANDS[harness], { version: ['--version'] });
    assert.deepEqual(Object.entries(pq.COMMANDS).filter(([, a]) => a.path).map(([c]) => c), ['xcode-select']);
  });

  test('versions', () => {
    assert.deepEqual(pq.parseVersion('Terraform v1.9.5\non darwin_arm64'), [1, 9, 5]);
    assert.deepEqual(pq.parseVersion('ShellCheck - tool\nversion: 0.10.0'), [0, 10, 0]);
    assert.deepEqual(pq.parseVersion('v22'), [22, 0, 0]);
    assert.deepEqual(pq.parseVersion('v٢٦.1'), [26, 1, 0]);
    assert.equal(pq.parseVersion('no digits'), null);
    assert.equal(pq.parseVersion(0), null);
  });

  test('a base URL override is honoured for loopback HTTP with a port only', () => {
    const loop = 'http' + '://127.0.0.1';
    for (const [value, want] of [[loop + ':8080', loop + ':8080'], [loop + ':8080/', loop + ':8080'], ['https://evil.example', pq.SONAR_URL],
      [loop + '.evil:1', pq.SONAR_URL], ['http' + '://localhost:1', pq.SONAR_URL], [loop, pq.SONAR_URL], [loop + ':1@evil.example:2', pq.SONAR_URL],
      [loop + ':1/x', pq.SONAR_URL], ['http' + '://user@127.0.0.1:8080', pq.SONAR_URL], ['https://127.0.0.1:8080', pq.SONAR_URL],
      [loop + ':99999', pq.SONAR_URL], [loop + ':0', pq.SONAR_URL], [loop + ':08080', pq.SONAR_URL], [loop + ':1?x', pq.SONAR_URL],
      [loop + ':1#x', pq.SONAR_URL], ['HTTP' + '://127.0.0.1:7', loop + ':7'], ['', pq.SONAR_URL]]) {
      assert.equal(pq.baseUrl({ WORKSTATION_SONAR_URL: value }, 'WORKSTATION_SONAR_URL', pq.SONAR_URL), want, value);
    }
  });

  test('the base URL override reads every recorded input as urlsplit did (lens F3 on PR #538)', () => {
    const golden = JSON.parse(fs.readFileSync(path.join(REPO, 'test', 'golden', 'S23', 'base-url.json'), 'utf8'));
    assert.ok(golden.cases.length >= 37);
    for (const [input, want] of golden.cases) assert.equal(pq.baseUrl({ X: input }, 'X', 'D'), want, JSON.stringify(input));
  });

  test('the merge standard is the closed set of three', () => {
    // #206: the standard file names exactly the three settings gh repo view reads.
    assert.deepEqual(pq.repoStandard().map(([k]) => k), ['allow_merge_commit', 'allow_rebase_merge', 'allow_squash_merge']);
    assert.deepEqual(pq.repoStandard().map(([, , w]) => w), [true, false, false]);
    assert.ok(!fs.existsSync(path.join(REPO, 'global', 'github-repo-settings.sh')));
  });

  test('a GET starts no process: the token stays in memory, in a worker thread', () => {
    const text = fs.readFileSync(path.join(REPO, 'src', 'lib', 'http-get.js'), 'utf8');
    assert.deepEqual([...text.matchAll(/^import .* from '([^']+)';$/gm)].map((m) => m[1]), ['node:worker_threads']);
    assert.doesNotMatch(text, /process\.(env|argv)/);
  });
});

/**
 * A throwaway HOME, a bin directory that is the whole PATH (cat for the stub gh), an overlay directory.
 */
function sandbox() {
  const h = throwawayHome('prereq');
  const bin = path.join(h.dir, 'bin');
  const overlay = path.join(h.dir, 'overlay');
  fs.mkdirSync(bin);
  fs.mkdirSync(overlay);
  for (const t of ['cat']) {
    const real = which(t);
    if (real) fs.symlinkSync(real, path.join(bin, t));
  }
  const log = path.join(h.dir, 'gh.log');
  const repo = path.join(h.dir, 'repo.json');
  fs.writeFileSync(repo, JSON.stringify({ mergeCommitAllowed: true, squashMergeAllowed: false, rebaseMergeAllowed: false }));
  /** @type {Record<string, string>} */
  const env = { PATH: bin, HOME: h.home, STUB_LOG: log, STUB_REPO: repo, FAKE_LOGIN: LOGIN, WORKSTATION_OVERLAY: overlay };
  const s = {
    h, bin, overlay, log, repo, env,
    /** @param {string} name @param {string} text */
    shim(name, text) {
      fs.writeFileSync(path.join(bin, name), text);
      fs.chmodSync(path.join(bin, name), 0o700);
    },
    /** @param {string} name @param {string} line @param {number} [code] */
    tool(name, line, code = 0) {
      s.shim(name, "#!/bin/sh\necho '" + line + "'\nexit " + code + '\n');
    },
    /** @param {unknown[]} items @param {string[]} [lanes] */
    declare(items, lanes = ['workstation', 'site']) {
      const p = path.join(h.dir, 'decl.json');
      fs.writeFileSync(p, JSON.stringify({ lanes: Object.fromEntries(lanes.map((l) => [l, l])), items }));
      env.WORKSTATION_PREREQUISITES = p;
    },
    /** @param {unknown} doc */
    overlayFile(doc) {
      fs.writeFileSync(path.join(overlay, pq.OVERLAY_FILE), JSON.stringify(doc));
    },
    /** @param {string[]} extra @returns {[number | null, string]} */
    check(...extra) {
      const p = spawnSync(process.execPath, [path.join(REPO, 'bin', 'mhw.js'), 'check', '--prerequisites', ...extra], { env, encoding: 'utf8', timeout: 120000 });
      return [p.status, p.stdout + p.stderr];
    },
    calls: () => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8') : ''),
  };
  return s;
}

/** The stand-in service, its own process: its URL, its request log and a stop function. @param {string} dir */
function service(dir) {
  const portFile = path.join(dir, 'service.port');
  const log = path.join(dir, 'service.log');
  fs.writeFileSync(log, '');
  const child = spawn(process.execPath, [path.join(REPO, 'test', 'check', 'fake-service.js'), portFile, log], { stdio: 'ignore' });
  const wait = new Int32Array(new SharedArrayBuffer(4));
  for (let i = 0; i < 200 && !fs.existsSync(portFile); i++) Atomics.wait(wait, 0, 0, 25);
  return {
    url: 'http' + '://127.0.0.1:' + fs.readFileSync(portFile, 'utf8'),
    seen: () => fs.readFileSync(log, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)),
    stop: () => child.kill('SIGTERM'),
  };
}

describe('presence', { skip: !SHELL && 'needs a POSIX sh' }, () => {
  /** @type {ReturnType<typeof sandbox>} */
  let s;
  beforeEach(() => { s = sandbox(); });
  afterEach(() => s.h.cleanup());

  test('present, missing, optional and lane', () => {
    s.tool('git', 'git version 2.3.4');
    s.declare([item('alpha', { version: { args: ['--version'], minimum: '2.0' } }), item('beta', { required: 'optional', cmd: 'jq' }),
      item('gamma', { required: 'optional', cmd: 'checkov', lanes: { site: 'required' } })]);
    let [code, out] = s.check();
    assert.equal(code, 0, out);
    assert.match(out, /^OK {6}alpha \[required\]: present \(git 2\.3\.4\)$/m);
    assert.match(out, /^ABSENT {2}beta \[optional\]: missing \(jq not found\) -> STEP-beta$/m);
    assert.match(out, /^ABSENT {2}gamma \[optional; required for site\]: .* -> STEP-gamma$/m);
    assert.ok(out.includes('PREREQ  0 required item(s) missing; check-only, nothing was applied'));
    // The owner's overlay activates the site lane: its required item now fails the check.
    s.overlayFile({ lanes: ['site', 'bogus'] });
    [code, out] = s.check();
    assert.equal(code, 1, out);
    assert.match(out, /^MISSING gamma \[optional; required for site\]: .* -> STEP-gamma$/m);
    assert.ok(out.includes('invalid lanes ignored'));
    // A required item missing fails without any overlay.
    s.overlayFile({});
    fs.rmSync(path.join(s.bin, 'git'));
    [code, out] = s.check();
    assert.equal(code, 1, out);
    assert.match(out, /^MISSING alpha \[required\]: missing \(git not found\) -> STEP-alpha$/m);
    assert.ok(out.includes('PREREQ  1 required item(s) missing'));
  });

  test('version drift is reported, not fatal, and no probe can make a version manager install', () => {
    const marker = path.join(s.h.dir, 'installed');
    s.shim('terraform', '#!/bin/sh\n'
      + 'if [ "$TFENV_AUTO_INSTALL" != false ] || [ "$CHECKPOINT_DISABLE" != 1 ] || '
      + '[ "$GH_NO_UPDATE_NOTIFIER" != 1 ] || [ "$HOMEBREW_NO_AUTO_UPDATE" != 1 ]; then\n'
      + "  echo x >> '" + marker + "'; echo 'Installing now as TFENV_AUTO_INSTALL==true'; exit 126\nfi\necho 'Terraform v1.5.0'\n");
    s.declare([item('alpha', { cmd: 'terraform', version: { args: ['version'], minimum: '1.9' } })]);
    const [code, out] = s.check();
    assert.equal(code, 0, out);
    assert.match(out, /^DRIFT {3}alpha \[required\]: present \(terraform 1\.5\.0\) · drift: version 1\.5\.0 below minimum 1\.9 -> STEP-alpha$/m);
    assert.ok(!fs.existsSync(marker));
  });

  test('any-of, path probe, os and manual', () => {
    s.tool('podman', 'podman 1.0');
    s.tool('xcode-select', '', 2);
    s.declare([item('first', { presence: { commands: ['docker', 'podman'] } }), item('pathq', { presence: { commands: ['xcode-select'], args: ['-p'] } }),
      item('macos', { cmd: 'security', os: ['NoSuchOS'] }), item('sub', { presence: { kind: 'manual' } })]);
    const [code, out] = s.check();
    assert.equal(code, 1, out);
    assert.match(out, /^OK {6}first \[required\]: present \(podman\)$/m);
    // Present on PATH but its path query fails: not installed (xcode-select -p without the tools).
    assert.match(out, /^MISSING pathq /m);
    assert.match(out, /^SKIP {4}macos \[required\]: not applicable on /m);
    assert.match(out, /^MANUAL {2}sub \[required\]: not detectable here \(manual\) -> STEP-sub$/m);
  });

  test('an invalid declaration exits 2', () => {
    s.declare([item('x', { version: { args: ['install'] } })]);
    const [code, out] = s.check();
    assert.equal(code, 2, out);
    assert.ok(out.includes('declaration invalid, nothing checked'));
  });

  test('no probe child gets a declared token: every auth.env variable is removed from its environment (#494)', () => {
    // Logging shims: each probe child writes its name and the canary count of its own environment.
    const log = path.join(s.h.dir, 'children.log');
    const canary = 'CANARY_SECRET_VALUE_S23';
    /** @param {string} name @param {string} body */
    const logged = (name, body) => s.shim(name, '#!/bin/sh\nprintf \'%s %s\\n\' "' + name + ' $*" "$(/usr/bin/env | /usr/bin/grep -c ' + canary + ')" >> \'' + log + '\'\n' + body);
    logged('git', "case \"$1\" in -C) echo 'git@github.com:owner-x/repo-y.git' ;; *) echo 'git version 2.3.4' ;; esac\n");
    logged('terraform', "echo 'Terraform v1.9.0'\n");
    logged('gh', GH_SHIM.replace('#!/bin/sh\n', ''));
    s.declare([item('git', { version: { args: ['--version'] } }), item('tf', { cmd: 'terraform', version: { args: ['version'] } }), GH_ITEM,
      item('sonar', { required: 'optional', presence: { kind: 'account' }, auth: { kind: 'sonarcloud-token', env: 'SONAR_TOKEN' } }),
      item('tfc', { required: 'optional', presence: { kind: 'account' }, auth: { kind: 'tfc-token', env: 'MY_TFC_TOKEN' } })]);
    // No github_repos: the merge-settings read falls back to this checkout's origin through git.
    Object.assign(s.env, { SONAR_TOKEN: canary, MY_TFC_TOKEN: canary, UNDECLARED_NAME: 'kept', WORKSTATION_GITHUB_URL: 'http' + '://127.0.0.1:9',
      WORKSTATION_SONAR_URL: 'http' + '://127.0.0.1:9', WORKSTATION_TFC_URL: 'http' + '://127.0.0.1:9' });
    const [code, out] = s.check();
    assert.equal(code, 0, out);
    assert.ok(!out.includes(canary));
    const lines = fs.readFileSync(log, 'utf8').trim().split('\n');
    for (const name of ['git --version', 'git -C', 'terraform version', 'gh --version', 'gh auth status', 'gh repo view']) {
      assert.ok(lines.some((l) => l.startsWith(name)), name + ' ran: ' + lines.join(' | '));
    }
    assert.deepEqual(lines.filter((l) => !l.endsWith(' 0')), [], 'a probe child saw a declared token');
    // The removal is by name, and only the declared names go: the probe environment keeps everything else.
    const kept = pq.withoutTokens({ SONAR_TOKEN: 'x', MY_TFC_TOKEN: 'y', PATH: '/p', UNDECLARED_NAME: 'kept' },
      [item('a', { auth: { kind: 'sonarcloud-token', env: 'SONAR_TOKEN' } }), item('b', { auth: { kind: 'tfc-token', env: 'MY_TFC_TOKEN' } }), item('c')]);
    assert.deepEqual(kept, { PATH: '/p', UNDECLARED_NAME: 'kept' });
  });

  test('the repository declaration with nothing on PATH', () => {
    const [code, out] = s.check();
    assert.equal(code, 1, out);
    for (const required of ['claude', 'codex', 'github', 'git', 'jq', 'python3', 'node']) assert.match(out, new RegExp('^MISSING ' + required + ' \\[required\\]: missing ', 'm'));
    assert.match(out, /^ABSENT {2}terraform \[optional; required for site\]/m);
  });
});

describe('GitHub', { skip: !SHELL && 'needs a POSIX sh' }, () => {
  /** @type {ReturnType<typeof sandbox>} */
  let s;
  beforeEach(() => {
    s = sandbox();
    s.shim('gh', GH_SHIM);
    s.declare([GH_ITEM]);
    s.overlayFile({ github_repos: ['owner-x/repo-y'] });
    // Never the real GitHub: a refused loopback port unless a test starts a server.
    s.env.WORKSTATION_GITHUB_URL = 'http' + '://127.0.0.1:9';
  });
  afterEach(() => s.h.cleanup());

  test('authenticated and matching', () => {
    const [code, out] = s.check();
    assert.equal(code, 0, out);
    assert.match(out, /^OK {6}gh \[required\]: present \(gh 2\.40\.1\) · authenticated · merge settings match the standard \(owner-x\/repo-y\)$/m);
    assert.ok(!out.includes(LOGIN));
    assert.ok(s.calls().includes('repo view owner-x/repo-y --json mergeCommitAllowed,rebaseMergeAllowed,squashMergeAllowed'));
  });

  test('squash on is drift and never applied', () => {
    fs.writeFileSync(s.repo, JSON.stringify({ mergeCommitAllowed: true, squashMergeAllowed: true, rebaseMergeAllowed: false }));
    const [code, out] = s.check();
    assert.equal(code, 0, out);
    assert.match(out, /^DRIFT {3}gh \[required\]: .*drift owner-x\/repo-y: allow_squash_merge=true \(standard: false\) -> STEP-gh$/m);
    for (const word of ['PATCH', '--method', 'repo edit']) assert.ok(!s.calls().includes(word), word);
    assert.equal(JSON.parse(fs.readFileSync(s.repo, 'utf8')).squashMergeAllowed, true);
  });

  test('an unreadable repository is not credited', () => {
    s.env.FAKE_VIEW_FAIL = '1';
    const [code, out] = s.check();
    assert.equal(code, 0, out);
    assert.match(out, /^OK {6}gh \[required\]: .*merge settings not checked \(owner-x\/repo-y not readable with this login\)$/m);
    assert.ok(!out.includes('match the standard'));
  });

  test('an absent or non-boolean field reads unknown and is drift', () => {
    fs.writeFileSync(s.repo, JSON.stringify({ mergeCommitAllowed: true, squashMergeAllowed: null }));
    const [code, out] = s.check();
    assert.equal(code, 0, out);
    assert.match(out, /^DRIFT {3}gh \[required\]: .*drift owner-x\/repo-y: allow_rebase_merge=unknown \(standard: false\); allow_squash_merge=unknown \(standard: false\) -> STEP-gh$/m);
  });

  test('unauthenticated', () => {
    Object.assign(s.env, { FAKE_GH_AUTH: '1', FAKE_GH_MSG: 'You are not logged into any GitHub hosts.' });
    const [code, out] = s.check();
    assert.equal(code, 0, out);
    assert.match(out, /^NOAUTH {2}gh \[required\]: present \(gh 2\.40\.1\) · not authenticated · merge settings not checked \(credential not available\) -> STEP-gh$/m);
    assert.ok(!out.includes(LOGIN));
    assert.ok(!s.calls().includes('repo view'));
  });

  test('offline is not checked, and a failure with GitHub reachable is NOAUTH', () => {
    Object.assign(s.env, { FAKE_GH_AUTH: '1', FAKE_GH_MSG: 'The token in GH_TOKEN is invalid.' });
    let [code, out] = s.check();
    assert.equal(code, 0, out);
    assert.match(out, /^NOCHECK gh \[required\]: present \(gh 2\.40\.1\) · authentication not checked \(GitHub unreachable\) · merge settings not checked \(credential not available\) -> STEP-gh$/m);
    assert.ok(!out.includes(LOGIN));
    const svc = service(s.h.dir);
    try {
      s.env.WORKSTATION_GITHUB_URL = svc.url;
      [code, out] = s.check();
      assert.match(out, /^NOAUTH {2}gh \[required\]: .*not authenticated \(gh auth status failed with GitHub reachable\)/m);
      assert.deepEqual(svc.seen(), [{ path: '/zen', auth: '' }]);
    } finally {
      svc.stop();
    }
  });
});

describe('services', { skip: !POSIX && 'needs POSIX' }, () => {
  /** @type {ReturnType<typeof sandbox>} */
  let s;
  /** @type {ReturnType<typeof service>} */
  let svc;
  beforeEach(() => {
    s = sandbox();
    svc = service(s.h.dir);
    Object.assign(s.env, { WORKSTATION_SONAR_URL: svc.url, WORKSTATION_TFC_URL: svc.url });
    s.declare([item('sonar', { required: 'optional', presence: { kind: 'account' }, auth: { kind: 'sonarcloud-token', env: 'SONAR_TOKEN' }, preferred: { kind: 'sonarcloud-project' } }),
      item('tfc', { required: 'optional', presence: { kind: 'account' }, auth: { kind: 'tfc-token', env: 'TFC_API_TOKEN' } })]);
  });
  afterEach(() => {
    svc.stop();
    s.h.cleanup();
  });

  test('no credential, no call', () => {
    const [code, out] = s.check();
    assert.equal(code, 0, out);
    assert.match(out, /^NOCHECK sonar \[optional\]: account, no local client to detect · authentication not checked \(credential not available\); \$SONAR_TOKEN unset · project not checked \(no project key in the overlay\) -> STEP-sonar$/m);
    assert.match(out, /^NOCHECK tfc .*not checked \(credential not available\); \$TFC_API_TOKEN unset/m);
    assert.deepEqual(svc.seen(), []);
  });

  test('valid and rejected tokens, and the project', () => {
    s.overlayFile({ sonar_projects: ['public-project', 'missing-project'] });
    Object.assign(s.env, { SONAR_TOKEN: TOKEN, TFC_API_TOKEN: TOKEN });
    let [code, out] = s.check();
    assert.equal(code, 0, out);
    assert.match(out, /^DRIFT {3}sonar \[optional\]: .*authenticated \(\$SONAR_TOKEN\) · project public-project reachable · project missing-project not reachable \(HTTP 404\) -> STEP-sonar$/m);
    assert.match(out, /^OK {6}tfc \[optional\]: .*authenticated \(\$TFC_API_TOKEN\)$/m);
    assert.ok(!out.includes(TOKEN));
    Object.assign(s.env, { SONAR_TOKEN: 'wrong', TFC_API_TOKEN: 'wrong' });
    [code, out] = s.check();
    assert.match(out, /^NOAUTH {2}sonar .*not authenticated \(\$SONAR_TOKEN rejected\)/m);
    assert.match(out, /^NOAUTH {2}tfc .*not authenticated \(\$TFC_API_TOKEN rejected\)/m);
    assert.ok(svc.seen().every((r) => r.path.startsWith('/api/')));
  });

  test('unreachable is not checked', () => {
    Object.assign(s.env, { SONAR_TOKEN: TOKEN, WORKSTATION_SONAR_URL: 'http' + '://127.0.0.1:9' });
    const [, out] = s.check();
    assert.match(out, /^NOCHECK sonar .*authentication not checked \(service unreachable\)/m);
  });

  test('a redirect is not followed: its status is the answer and the token goes nowhere else', () => {
    assert.deepEqual(getSync(svc.url + '/redirect', TOKEN), [302, '']);
    assert.deepEqual(svc.seen(), [{ path: '/redirect', auth: 'Bearer <TOKEN>' }]);
    // A 2xx answers its body; an unreachable host answers status 0.
    assert.deepEqual(getSync(svc.url + '/api/authentication/validate', TOKEN), [200, '{"valid":true}']);
    assert.deepEqual(getSync('http' + '://127.0.0.1:9/x', null), [0, '']);
  });
});
