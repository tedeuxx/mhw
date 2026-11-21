// The method backlog sync (Issue #62; Node since #500, S30 of #470): the workflow's structure and the
// agent's only route to GitHub, .github/scripts/method-issue-sync.js. The cases of the deleted
// .github/scripts/method_issue_sync_test.py, as node:test.
//
// The workflow is parsed with the runner's ruby (Psych, the parser the shellcheck job already uses), so
// no YAML package is needed; on Linux, where the sync runs, the workflow tests fail and never skip when
// ruby is absent. The script runs against a stub gh on PATH (test/helpers/s30-stub-gh.js) that records
// every call and the token it was given (by name, never by value). No network, no account, no real token.
// Writes only under a temporary directory. The script cases are POSIX only: the stub gh is an executable
// script, and the sync runs on ubuntu-latest.
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { which } from '../helpers/home.js';
import { ROOT, SCRIPT, STUB, initialState, twin, DEFAULT_SKILLS } from '../helpers/s30.js';
import { GOOD_BODY } from '../helpers/s30-cases.js';

const WORKFLOW = path.join(ROOT, '.github', 'workflows', 'method-issue-sync.yml');
const TESTS_WORKFLOW = path.join(ROOT, '.github', 'workflows', 'tests.yml');
const ISOLATION_INSTALL = 'sudo apt-get update -qq && sudo apt-get install -y --no-install-recommends bubblewrap socat';
const RUN = 'node .github/scripts/method-issue-sync.js';
const PIN_CHECKOUT = 'actions/checkout@d23441a48e516b6c34aea4fa41551a30e30af803';
const PIN_APP_TOKEN = 'actions/create-github-app-token@bcd2ba49218906704ab6c1aa796996da409d3eb1';
const PIN_CLAUDE = 'anthropics/claude-code-action@1d6de8cb0c237e7c15e9e1bdf973826ebae490cc';
const PIN_NODE = 'actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1';
const SECRETS = ['MHW_MIRROR_APP_ID', 'MHW_MIRROR_APP_PRIVATE_KEY', 'CLAUDE_CODE_OAUTH_TOKEN'];
// The agent's whole allow list, as one exact string: the one Bash rule is a prefix on the script's path
// (node's own flags would come before it, so `node -e ...` matches nothing), and the Write tool's rule is
// an Edit rule, which Claude Code matches Write against (measured locally, 2.1.296). The Edit rule reaches
// *.md files directly in the body directory and nothing else: the second barrier (PR #541 lens), with the
// workflow's package.json, against `node <script>/../../../../<dir>/<file>`.
const ALLOWED_TOOLS = 'Bash(node .github/scripts/method-issue-sync.js:*),Edit(/${{ runner.temp }}/method-sync/*.md)';
// The core of the rule Claude Code 2.1.296 (the version the pinned action installs) uses to drop
// secret-shaped env names from subprocesses under CLAUDE_CODE_SUBPROCESS_ENV_SCRUB, copied from its
// bundle (read, not measured). A name the agent's script needs must not match it.
const SCRUB_WORDS = ['TOKEN', 'SECRET', 'PASSWORD', 'PASSWD', 'PASSPHRASE', 'KEY', 'AUTH', 'COOKIE', 'PAT', 'DSN',
  'WEBHOOK', 'CREDENTIAL', 'CREDENTIALS', 'CREDS', 'APIKEY', 'ACCESSKEY', 'SECRETKEY', 'ACCOUNTKEY', 'PRIVATEKEY',
  'AUTHKEY', 'SSHKEY', 'SIGNINGKEY', 'MASTERKEY', 'DEPLOYKEY', 'ENCRYPTIONKEY', 'PGPASSWORD', 'SSHPASS'];
const SCRUBBED_NAME = new RegExp('((^|_)(' + SCRUB_WORDS.join('|') + '|(KEY|SECRET|PASSWORD|CREDENTIAL)S)|_(PWD|PASS|JWT)|(TOKEN|SECRET|PASSWORD|PASSWD|PASSPHRASE))(?=$|[_0-9])', 'i');
const MUST_DISALLOW = ['Read', 'Glob', 'Grep', 'Edit', 'MultiEdit', 'NotebookEdit', 'WebFetch', 'WebSearch', 'Task'];
const POSIX = process.platform !== 'win32';
const RUBY = which('ruby');
const NO_RUBY = !RUBY && process.platform !== 'linux' && 'ruby parses the workflow; it is not on PATH here (on Linux, where the sync runs, this fails instead)';

/** @typedef {Record<string, any>} Obj */

/** @param {string} file @returns {Obj} */
function loadWorkflow(file) {
  if (!RUBY) throw new Error('ruby is required to parse the workflow (preinstalled on the CI runners)');
  const p = spawnSync(RUBY, ['-ryaml', '-rjson', '-e', 'puts JSON.dump(YAML.safe_load(File.read(ARGV[0])))', file], { encoding: 'utf8' });
  assert.equal(p.status, 0, p.stderr);
  const doc = JSON.parse(p.stdout);
  // YAML 1.1 reads the bare key `on` as the boolean true.
  if (!('on' in doc) && 'true' in doc) {
    doc.on = doc.true;
    delete doc.true;
  }
  return doc;
}

/** @param {Obj} doc @returns {Array<[string, Obj]>} */
const allSteps = (doc) => Object.entries(doc.jobs).flatMap(([name, job]) => (job.steps || []).map((/** @type {Obj} */ s) => /** @type {[string, Obj]} */ ([name, s])));

/** @param {string} args @param {string} flag */
function flagValue(args, flag) {
  const at = args.indexOf(flag + ' "');
  if (at === -1) return null;
  const start = at + flag.length + 2;
  const end = args.indexOf('"', start);
  return end === -1 ? null : args.slice(start, end);
}

/** @param {string} s */
const flat = (s) => s.split(/\s+/).filter(Boolean).join(' ');

describe('the workflow', { skip: NO_RUBY }, () => {
  /** @type {Obj} */
  let doc;
  /** @type {Obj} */
  let jobs;
  /** @type {string} */
  let text;
  const load = () => {
    if (!doc) {
      doc = loadWorkflow(WORKFLOW);
      jobs = doc.jobs;
      text = fs.readFileSync(WORKFLOW, 'utf8');
    }
  };
  const claudeStep = () => {
    load();
    const steps = allSteps(doc).map(([, s]) => s).filter((s) => String(s.uses || '').startsWith('anthropics/'));
    assert.equal(steps.length, 1, 'exactly one claude-code-action step');
    return steps[0];
  };

  test('triggers', () => {
    load();
    assert.deepEqual(Object.keys(doc.on).sort((a, b) => a.localeCompare(b)), ['issues', 'workflow_dispatch']);
    assert.deepEqual(doc.on.issues.types, ['labeled', 'edited', 'closed', 'reopened']);
    assert.ok(!doc.on.workflow_dispatch.inputs.issue.required, 'the issue input is optional (empty = backfill)');
  });

  test('label filter', () => {
    load();
    const cond = flat(jobs.select.if);
    assert.ok(cond.includes("github.event.action == 'labeled' && github.event.label.name == 'method'"));
    assert.ok(cond.includes("github.event.action != 'labeled' && contains(github.event.issue.labels.*.name, 'method')"));
    assert.ok(cond.includes("github.repository == 'tedeuxx/mhw'"));
    assert.ok(cond.includes("github.event_name == 'workflow_dispatch'"));
    for (const job of ['sync', 'backlink']) assert.ok([jobs[job].needs].flat().includes('select'));
  });

  test('backfill lists open method Issues', () => {
    load();
    const pick = jobs.select.steps.find((/** @type {Obj} */ s) => s.id === 'pick');
    assert.ok(pick.run.includes('gh issue list --repo "$REPO" --label method --state open'));
    assert.ok(pick.run.includes('index("method") != null'), 'a dispatched number must carry the label');
  });

  test('every action is pinned to a full sha', () => {
    load();
    const uses = allSteps(doc).map(([, s]) => s.uses).filter(Boolean);
    assert.ok(uses.length);
    for (const u of uses) assert.match(u, /^[\w.-]+\/[\w.-]+@[0-9a-f]{40}$/);
    for (const pin of [PIN_CHECKOUT, PIN_APP_TOKEN, PIN_CLAUDE, PIN_NODE]) assert.ok(uses.includes(pin), pin);
  });

  test('skip on missing secrets', () => {
    load();
    const step = jobs.select.steps.find((/** @type {Obj} */ s) => s.id === 'secrets');
    for (const name of SECRETS) {
      assert.ok(Object.values(step.env).includes("${{ secrets." + name + " != '' }}"));
      assert.ok(step.run.includes(name));
    }
    assert.ok(step.run.includes('::notice'));
    assert.ok(step.run.includes('echo "ready=false"'));
    assert.ok(!step.run.includes('exit 1'), 'a missing secret skips; it never fails the run');
    assert.equal(jobs.select.outputs.ready, '${{ steps.secrets.outputs.ready }}');
    for (const job of ['sync', 'backlink']) assert.ok(jobs[job].if.includes("needs.select.outputs.ready == 'true'"));
    const pick = jobs.select.steps.find((/** @type {Obj} */ s) => s.id === 'pick');
    assert.equal(pick.if, "steps.secrets.outputs.ready == 'true'");
  });

  test('permissions are least privilege', () => {
    load();
    assert.deepEqual(doc.permissions, {});
    assert.deepEqual(jobs.select.permissions, { issues: 'read' });
    assert.deepEqual(jobs.sync.permissions, { contents: 'read', issues: 'read' });
    assert.deepEqual(jobs.backlink.permissions, { contents: 'read', issues: 'write' });
    assert.ok(!text.includes('id-token'));
    /** @type {Record<string, string>} */
    const tokens = {};
    for (const [job, step] of allSteps(doc)) {
      if (!String(step.uses || '').startsWith('actions/create-github-app-token@')) continue;
      const w = step.with;
      assert.equal(w.owner, 'tedeuxx');
      assert.equal(w.repositories, 'tadeumendonca-skills');
      assert.equal(w['app-id'], '${{ secrets.MHW_MIRROR_APP_ID }}');
      assert.equal(w['private-key'], '${{ secrets.MHW_MIRROR_APP_PRIVATE_KEY }}');
      assert.deepEqual(Object.keys(w).filter((k) => k.startsWith('permission-')), ['permission-issues']);
      tokens[job] = w['permission-issues'];
    }
    assert.deepEqual(tokens, { sync: 'write', backlink: 'read' });
  });

  test('no token is printed', () => {
    load();
    for (const [, step] of allSteps(doc)) {
      const run = step.run || '';
      assert.ok(!run.includes('secrets.'), 'secrets reach a step only through with:/env:');
      assert.ok(!run.includes('outputs.token'));
      assert.ok(!run.includes('github.token'));
      assert.doesNotMatch(run, /\$\{?(GH_TOKEN|MHW_TOKEN|MHW_SKILLS_TOKEN)\b/);
    }
  });

  test('concurrency per Issue', () => {
    load();
    /** @type {Record<string, string>} */
    const groups = { sync: 'method-issue-sync-${{ matrix.issue }}', backlink: 'method-issue-sync-backlink-${{ matrix.issue }}' };
    for (const [job, group] of Object.entries(groups)) {
      const c = jobs[job].concurrency;
      assert.equal(c.group, group);
      assert.equal(c['cancel-in-progress'], false);
      assert.equal(jobs[job].strategy.matrix.issue, '${{ fromJSON(needs.select.outputs.issues) }}');
    }
  });

  test('the claude step credentials', () => {
    const step = claudeStep();
    const w = step.with;
    const env = step.env;
    assert.equal(w.claude_code_oauth_token, '${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}');
    assert.equal(w.github_token, '${{ github.token }}');
    assert.equal(env.MHW_ISSUE, '${{ matrix.issue }}');
    assert.equal(env.MHW_SYNC_DIR, '${{ runner.temp }}/method-sync');
    assert.equal(env.MHW_INPUT_DIR, '${{ runner.temp }}/method-sync-input');
    assert.equal(step.id, 'claude');
    // No token in the action's env: the scrub would drop it from the script anyway (run 38294048591).
    for (const [name, value] of Object.entries(env)) {
      assert.ok(!String(value).includes('outputs.token'));
      assert.ok(!String(value).includes('github.token'));
      if (!name.startsWith('CLAUDE_CODE_')) assert.doesNotMatch(name, SCRUBBED_NAME, name + ' would be scrubbed from the script');
      assert.ok(!name.startsWith('NODE_'), name + ' would change how the agent\'s node runs');
    }
    assert.equal(String(env.CLAUDE_CODE_SUBPROCESS_ENV_SCRUB), '1');
    assert.ok(!('anthropic_api_key' in w));
  });

  test('the allowed tools are exactly the script and the body directory', () => {
    const args = claudeStep().with.claude_args;
    // The exact string, so a widened rule (Bash(node:*), Bash(node *), a second script) cannot pass.
    assert.equal(flagValue(args, '--allowedTools'), ALLOWED_TOOLS);
    assert.equal(args.split('--allowedTools').length - 1, 1);
    const disallowed = /** @type {string} */ (flagValue(args, '--disallowedTools'));
    assert.ok(disallowed);
    for (const tool of MUST_DISALLOW) assert.ok(disallowed.split(',').includes(tool), tool + ' could read the environment');
    assert.match(args, /--setting-sources user\b/);
    const turns = /--max-turns (\d+)/.exec(args);
    assert.ok(turns && Number(turns[1]) > 0 && Number(turns[1]) <= 40);
    // Third canary (run 38307434605): a Write(path) rule is ignored by file permission checks, so a rule
    // spelled that way grants nothing; and no rule may widen to the cwd or the input directory.
    assert.ok(!args.includes('Write('));
    assert.ok(!args.includes('--add-dir'));
    assert.ok(!args.includes('--allowed-tools') && !args.includes('--dangerously'));
  });

  test('no other node or Bash rule exists anywhere in the workflow', () => {
    load();
    const rules = [...text.matchAll(/Bash\([^)]*\)/g)].map((m) => m[0]);
    assert.deepEqual(rules, ['Bash(node .github/scripts/method-issue-sync.js:*)']);
    // A rule on node itself, in either spelling Claude Code reads, would let the agent run any code.
    assert.doesNotMatch(text, /Bash\(node(:\*| \*|\*)\)/);
    assert.doesNotMatch(text, /Bash\(\*?\)/);
  });

  test('every step runs the Node script and names a command it has', async () => {
    load();
    const { COMMAND_NAMES } = await import(pathToFileURL(SCRIPT).href);
    const runs = allSteps(doc).map(([, s]) => String(s.run || '')).filter((r) => r.includes('.github/scripts/'));
    assert.equal(runs.length, 4, 'stash-inputs, final-line, verify, backlink');
    for (const r of runs) {
      const lines = r.split('\n').filter((l) => l.includes('.github/scripts/'));
      for (const line of lines) {
        const m = /(?:^|\s)node \.github\/scripts\/method-issue-sync\.js ([a-z-]+)/.exec(line);
        assert.ok(m, 'a script line runs the Node script: ' + line);
        assert.ok(COMMAND_NAMES.includes(m[1]), m[1]);
      }
    }
    assert.ok(!text.includes('python'), 'no step runs Python');
    // The prompt lists the agent's commands; each is one the script has.
    const prompt = claudeStep().with.prompt;
    assert.ok(prompt.includes('Your only route to GitHub is: ' + RUN + ' COMMAND'));
    for (const name of ['mhw-view', 'find-twin', 'skills-view', 'skills-create', 'skills-edit', 'skills-close', 'skills-reopen']) {
      assert.ok(prompt.includes(name), name);
      assert.ok(COMMAND_NAMES.includes(name), name);
    }
  });

  test('both jobs check out the script and its imports, and run it on the pinned node', () => {
    load();
    for (const job of ['sync', 'backlink']) {
      const steps = jobs[job].steps;
      const checkout = steps.find((/** @type {Obj} */ s) => s.uses === PIN_CHECKOUT);
      assert.deepEqual(checkout.with['sparse-checkout'].split('\n').filter(Boolean), ['.github/scripts', 'src/lib']);
      assert.notEqual(checkout.with['sparse-checkout-cone-mode'], false, 'cone mode brings package.json (ESM)');
      assert.equal(checkout.with['persist-credentials'], false);
      const node = steps.findIndex((/** @type {Obj} */ s) => s.uses === PIN_NODE);
      assert.ok(node > steps.indexOf(checkout), 'setup-node after checkout');
      assert.equal(steps[node].with['node-version'], '26.13.1');
      const first = steps.findIndex((/** @type {Obj} */ s) => String(s.run || '').includes(RUN));
      assert.ok(node < first, 'node is set up before the script first runs');
    }
    const tests = fs.readFileSync(TESTS_WORKFLOW, 'utf8');
    assert.ok(tests.includes('node-version: 26.13.1'), 'the same node as the node job');
  });

  test('the second barrier: the agent writes only *.md, in a module scope the workflow sets before it runs', () => {
    load();
    const steps = jobs.sync.steps;
    const args = claudeStep().with.claude_args;
    const edits = /** @type {string} */ (flagValue(args, '--allowedTools')).split(',').filter((t) => t.startsWith('Edit('));
    // One Edit rule, a single path component ending in .md: no **, no other extension, no subdirectory.
    assert.deepEqual(edits, ['Edit(/${{ runner.temp }}/method-sync/*.md)']);
    const claude = steps.findIndex((/** @type {Obj} */ s) => String(s.uses || '').startsWith('anthropics/'));
    const scratch = steps.findIndex((/** @type {Obj} */ s) => s.name === "Scratch directory for the agent's body files");
    assert.ok(scratch >= 0 && scratch < claude, 'the scope is set before the agent runs');
    const step = steps[scratch];
    assert.equal(step.env.SYNC_DIR, '${{ runner.temp }}/method-sync');
    const lines = step.run.split('\n').map((/** @type {string} */ l) => l.trim()).filter(Boolean);
    assert.deepEqual(lines, ['mkdir -p "$SYNC_DIR"', "printf '%s\\n' '{\"type\":\"module\"}' > \"$SYNC_DIR/package.json\""]);
    assert.ok(!('if' in step) && !('continue-on-error' in step));
    // package.json is not *.md, so the agent cannot replace it; and the prompt asks for .md names.
    assert.ok(claudeStep().with.prompt.includes('a NEW file whose name ends in .md'));
  });

  test('the sync job verifies after the agent', () => {
    load();
    const steps = jobs.sync.steps;
    const names = steps.map((/** @type {Obj} */ s) => String(s.uses || '') + (s.run || ''));
    const claude = names.findIndex((/** @type {string} */ n) => n.startsWith('anthropics/'));
    const verify = names.map((/** @type {string} */ n, /** @type {number} */ i) => (n.includes(RUN + ' verify') ? i : -1)).filter((/** @type {number} */ i) => i >= 0);
    assert.deepEqual(verify, [steps.length - 1], 'verify is the sync job\'s last step');
    assert.ok(verify[0] > claude);
    const last = steps.at(-1);
    assert.ok(!('continue-on-error' in last));
    assert.equal(last.run.trim(), RUN + ' verify');
    assert.ok(!('if' in last), 'verify runs whenever the agent step succeeded');
  });

  test('the scrub rule copy is calibrated', () => {
    // The copied rule must bite on the names it dropped in the re-run canary, or the check above is empty.
    for (const name of ['MHW_TOKEN', 'MHW_SKILLS_TOKEN', 'MHW_SECRETS_DIR', 'GH_TOKEN', 'APP_PRIVATE_KEY']) assert.match(name, SCRUBBED_NAME);
    for (const name of ['MHW_ISSUE', 'MHW_SYNC_DIR', 'MHW_INPUT_DIR', 'RUNNER_TEMP']) assert.doesNotMatch(name, SCRUBBED_NAME);
  });

  test('inputs are stashed before the agent', () => {
    load();
    const steps = jobs.sync.steps;
    const claude = steps.findIndex((/** @type {Obj} */ s) => String(s.uses || '').startsWith('anthropics/'));
    const stash = steps.map((/** @type {Obj} */ s, /** @type {number} */ i) => (String(s.run || '').includes(RUN + ' stash-inputs') ? i : -1)).filter((/** @type {number} */ i) => i >= 0);
    assert.equal(stash.length, 1);
    assert.ok(stash[0] < claude);
    const step = steps[stash[0]];
    assert.equal(step.run.trim(), RUN + ' stash-inputs');
    assert.ok(!('if' in step));
    const env = step.env;
    assert.equal(env.MHW_TOKEN, '${{ github.token }}');
    assert.equal(env.MHW_SKILLS_TOKEN, '${{ steps.app.outputs.token }}');
    assert.equal(env.MHW_ISSUE, '${{ matrix.issue }}');
    const claudeEnv = steps[claude].env;
    assert.equal(env.MHW_INPUT_DIR, claudeEnv.MHW_INPUT_DIR);
    assert.equal(env.MHW_SYNC_DIR, claudeEnv.MHW_SYNC_DIR);
    // The Write tool's directory must not contain the input directory.
    const rule = /** @type {string} */ (flagValue(steps[claude].with.claude_args, '--allowedTools')).split(',').find((t) => t.startsWith('Edit('));
    const writeDir = /** @type {string} */ (rule).slice('Edit(/'.length, -'/*.md)'.length);
    assert.equal(writeDir, env.MHW_SYNC_DIR);
    assert.ok(!(env.MHW_INPUT_DIR + '/').startsWith(writeDir + '/'));
  });

  test('the final line is printed after the agent', () => {
    load();
    const steps = jobs.sync.steps;
    const claude = steps.findIndex((/** @type {Obj} */ s) => String(s.uses || '').startsWith('anthropics/'));
    const final = steps.map((/** @type {Obj} */ s, /** @type {number} */ i) => (String(s.run || '').includes(RUN + ' final-line') ? i : -1)).filter((/** @type {number} */ i) => i >= 0);
    assert.equal(final.length, 1);
    assert.ok(claude < final[0] && final[0] < steps.length - 1, 'between the agent and verify');
    const step = steps[final[0]];
    assert.equal(step.if, 'always()');
    assert.equal(step.env.EXECUTION_FILE, '${{ steps.claude.outputs.execution_file }}');
    assert.equal(step.run.trim(), RUN + ' final-line "$EXECUTION_FILE"');
  });

  /** @param {string} run */
  const assertIsolationRecipe = (run) => {
    const lines = run.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
    assert.ok(lines.includes(ISOLATION_INSTALL + ' && break'));
    const guard = 'if [ -f /proc/sys/kernel/apparmor_restrict_unprivileged_userns ] && command -v sudo >/dev/null; then';
    assert.ok(lines.includes(guard));
    assert.equal(lines[lines.indexOf(guard) + 1], 'sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0');
    assert.equal(lines.at(-1), 'bwrap --unshare-user --ro-bind / / /bin/true', 'the smoke test ends the step');
    const order = [lines.indexOf(ISOLATION_INSTALL + ' && break'), lines.indexOf(guard), lines.indexOf('bwrap --version'), lines.length - 1];
    assert.deepEqual(order, [...order].sort((a, b) => a - b));
    assert.ok(!run.includes('|| true'));
  };

  test('bubblewrap is installed before any scrubbed step', () => {
    // First canary, 2026-10-12: the scrub needs bubblewrap, which ubuntu-latest does not ship.
    load();
    let scrubbed = 0;
    for (const job of Object.values(jobs)) {
      const steps = job.steps || [];
      steps.forEach((/** @type {Obj} */ step, /** @type {number} */ i) => {
        if (String((step.env || {}).CLAUDE_CODE_SUBPROCESS_ENV_SCRUB ?? '0') === '0') return;
        scrubbed += 1;
        const installs = steps.slice(0, i).map((/** @type {Obj} */ s) => String(s.run || '')).filter((/** @type {string} */ r) => r.includes(ISOLATION_INSTALL));
        assert.equal(installs.length, 1, 'bubblewrap is installed once, before the scrubbed step');
        assertIsolationRecipe(installs[0]);
      });
    }
    assert.equal(scrubbed, 1, 'the agent step carries the scrub');
  });

  test('the isolation recipe also runs on every PR, identical to the workflow\'s', () => {
    load();
    const tests = loadWorkflow(TESTS_WORKFLOW);
    const job = tests.jobs['isolation-smoke'];
    assert.equal(job['runs-on'], 'ubuntu-latest');
    assert.ok(tests.jobs['delivery-ci'].needs.includes('isolation-smoke'));
    assert.ok(!('continue-on-error' in job));
    const runs = job.steps.filter((/** @type {Obj} */ s) => 'run' in s).map((/** @type {Obj} */ s) => s.run);
    assert.equal(runs.length, 1);
    assert.ok(!('continue-on-error' in job.steps[0]));
    const syncStep = jobs.sync.steps.find((/** @type {Obj} */ s) => String(s.run || '').includes(ISOLATION_INSTALL));
    assert.ok(!('continue-on-error' in syncStep));
    assert.equal(runs[0], syncStep.run, 'the PR job runs exactly the workflow\'s script');
    assertIsolationRecipe(runs[0]);
  });

  test('backlink runs only after a successful sync', () => {
    load();
    const job = jobs.backlink;
    const cond = flat(job.if);
    assert.ok(cond.startsWith("needs.sync.result == 'success' &&"), cond);
    assert.ok(!cond.includes('||'), 'no alternative may bypass the sync-success condition');
    for (const loose of ['!cancelled()', 'always()', 'failure()']) assert.ok(!cond.includes(loose));
    assert.ok(job.needs.includes('sync'));
  });

  test('the backlink job runs the script without an agent', () => {
    load();
    const steps = jobs.backlink.steps;
    assert.ok(!steps.some((/** @type {Obj} */ s) => String(s.uses || '').startsWith('anthropics/')));
    assert.ok(steps.at(-1).run.includes(RUN + ' backlink'));
  });
});

test('the script imports only node: modules and src/lib files the sparse checkout carries, which import nothing else', () => {
  const seen = new Set();
  const queue = [SCRIPT];
  while (queue.length) {
    const file = /** @type {string} */ (queue.shift());
    if (seen.has(file)) continue;
    seen.add(file);
    const src = fs.readFileSync(file, 'utf8');
    for (const m of src.matchAll(/^\s*import\s[^'"]*['"]([^'"]+)['"]/gm)) {
      const spec = m[1];
      if (spec.startsWith('node:')) continue;
      assert.ok(spec.startsWith('.'), file + ' imports a package: ' + spec);
      const target = path.resolve(path.dirname(file), spec);
      const rel = path.relative(ROOT, target).split(path.sep).join('/');
      assert.ok(rel.startsWith('.github/scripts/') || rel.startsWith('src/lib/'), rel + ' is outside the sparse checkout');
      queue.push(target);
    }
    assert.doesNotMatch(src, /\bimport\(/, file + ' has a dynamic import');
  }
  assert.ok(seen.size >= 3);
});

// Measured on the node that runs this suite (the workflow's node is the same version, 26.13.1): what the
// second barrier rests on. Node resolves its entry path textually, so a path that names the script and then
// leaves it reaches another file; only an ES module scope makes it refuse a .md entry.
describe('the second barrier, on this node', { skip: !POSIX && 'POSIX paths' }, () => {
  /** @param {string} dir @param {string} file */
  const viaScript = (dir, file) => {
    const ups = SCRIPT.split('/').filter(Boolean).length;
    return SCRIPT + '/..'.repeat(ups) + dir + '/' + file;
  };
  /** @param {string} dir @param {string} file */
  const runVia = (dir, file) => spawnSync(process.execPath, [viaScript(dir, file)], { cwd: ROOT, encoding: 'utf8' });
  /** @type {string} */
  let dir;
  beforeEach(() => {
    dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 's30-barrier-')));
    for (const f of ['evil.md', 'evil']) fs.writeFileSync(path.join(dir, f), 'console.log("RAN-" + process.argv[1].length)\n');
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  test('calibration: without the module scope, node runs a .md and an extensionless file named through the script path', () => {
    for (const f of ['evil.md', 'evil']) {
      const p = runVia(dir, f);
      assert.equal(p.status, 0, p.stderr);
      assert.match(p.stdout, /^RAN-/, f + ' did not run, so the probe below proves nothing');
    }
  });

  test('with the workflow\'s package.json, node refuses a .md entry; an extensionless one is what the *.md rule keeps out', () => {
    fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}\n');
    const p = runVia(dir, 'evil.md');
    assert.notEqual(p.status, 0);
    assert.ok(!p.stdout.includes('RAN-'));
    assert.match(p.stderr, /ERR_UNKNOWN_FILE_EXTENSION/);
    // An extensionless file still runs in that scope: this is why the Edit rule names *.md, not the directory.
    assert.match(runVia(dir, 'evil').stdout, /^RAN-/);
  });
});

describe('the script', { skip: !POSIX && 'the stub gh is a POSIX executable; the sync runs on ubuntu-latest' }, () => {
  /** @type {string} */
  let tmp;
  /** @type {string} */
  let bin;
  /** @type {string} */
  let sync;
  /** @type {string} */
  let statePath;
  /** @type {string} */
  let logPath;

  /** @param {string} name @param {string} content */
  const writeGh = (name, content) => {
    const gh = path.join(bin, name);
    fs.writeFileSync(gh, content);
    fs.chmodSync(gh, 0o700);
  };
  /** @param {string} s */
  const q = (s) => "'" + s.split("'").join("'\\''") + "'";

  beforeEach(() => {
    tmp = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 's30-test-')));
    bin = path.join(tmp, 'bin');
    fs.mkdirSync(bin);
    writeGh('gh', '#!/bin/sh\nexec ' + q(process.execPath) + ' ' + q(STUB) + ' "$@"\n');
    sync = path.join(tmp, 'sync');
    fs.mkdirSync(sync);
    statePath = path.join(tmp, 'state.json');
    logPath = path.join(tmp, 'log.jsonl');
    setState('OPEN', DEFAULT_SKILLS);
  });
  afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

  /** @param {string} mhwState @param {unknown[]} skills @param {unknown[]} [comments] */
  function setState(mhwState, skills, comments = []) {
    fs.writeFileSync(statePath, JSON.stringify(initialState(mhwState, skills, comments)));
  }
  const readState = () => JSON.parse(fs.readFileSync(statePath, 'utf8'));
  /** @param {{ state?: string, number?: number, author?: string }} [t] */
  function addTwin(t = {}) {
    const st = readState();
    st.skills.push(twin(t));
    fs.writeFileSync(statePath, JSON.stringify(st));
  }
  /** @param {string} text @param {string} [name] */
  function body(text, name = 'b.md') {
    const p = path.join(sync, name);
    fs.writeFileSync(p, text);
    return p;
  }
  const goodBody = (name = 'b.md') => body(GOOD_BODY, name);
  const MARKED = '<!-- mhw-issue: tedeuxx/mhw#7 -->\nhttps://github.com/tedeuxx/mhw/issues/7\n';

  /** @param {string[]} args @param {{ issue?: string, env?: Record<string, string | null> }} [o] */
  function run(args, o = {}) {
    /** @type {Record<string, string>} */
    const env = {
      PATH: bin + path.delimiter + (process.env.PATH || ''), HOME: tmp, STUB_STATE: statePath, STUB_LOG: logPath,
      MHW_ISSUE: o.issue ?? '7', MHW_TOKEN: 'tok-mhw', MHW_SKILLS_TOKEN: 'tok-skills', MHW_SYNC_DIR: sync, GITHUB_TOKEN: 'tok-other',
    };
    for (const [k, v] of Object.entries(o.env || {})) {
      if (v === null) delete env[k];
      else env[k] = v;
    }
    const p = spawnSync(process.execPath, [SCRIPT, ...args], { env, cwd: tmp, encoding: 'utf8' });
    return { code: p.status, stdout: p.stdout, stderr: p.stderr };
  }
  /** @returns {Array<{ args: string[], token: string, github_token: boolean }>} */
  const calls = () => (fs.existsSync(logPath) ? fs.readFileSync(logPath, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
  const writes = () => calls().filter((c) => ['create', 'edit', 'comment', 'close', 'reopen'].includes(c.args[1]));
  /** @param {string[]} args @param {{ issue?: string, env?: Record<string, string | null> }} [o] */
  function assertRefused(args, o) {
    const before = writes().length;
    const p = run(args, o);
    assert.equal(p.code, 2, p.stderr);
    assert.ok(p.stderr.includes('REFUSED'));
    assert.equal(writes().length, before, 'a refusal sends nothing');
    return p;
  }
  const create = (/** @type {string} */ file, title = '[mhw#7] T') => ['skills-create', '--title', title, '--body-file', file];

  test('every call is scoped by repo and token', () => {
    assert.equal(run(['mhw-view']).code, 0);
    assert.equal(run(['find-twin']).code, 0);
    const p = run(create(goodBody()));
    assert.equal(p.code, 0, p.stderr);
    for (const c of calls()) {
      assert.equal(c.github_token, false, 'GITHUB_TOKEN must not reach gh');
      const repo = c.args[c.args.indexOf('--repo') + 1];
      if (repo === 'tedeuxx/mhw') {
        assert.equal(c.token, 'MHW_TOKEN');
        assert.deepEqual(c.args.slice(0, 2), ['issue', 'view']);
      } else {
        assert.equal(repo, 'tedeuxx/tadeumendonca-skills');
        assert.equal(c.token, 'MHW_SKILLS_TOKEN');
      }
    }
  });

  test('mhw-view reads only this run\'s Issue', () => {
    assert.equal(run(['mhw-view']).code, 0);
    assertRefused(['mhw-view', '8']);
    assert.equal(calls()[0].args[2], '7');
  });

  test('find-twin by marker', () => {
    assert.deepEqual(JSON.parse(run(['find-twin']).stdout), {});
    addTwin();
    assert.equal(JSON.parse(run(['find-twin']).stdout).number, 42);
    // #70's marker must not match #7.
    assert.equal(JSON.parse(run(['find-twin'], { issue: '70' }).stdout).number, 6);
  });

  test('create is refused when the twin exists', () => {
    addTwin();
    assertRefused(create(goodBody(), 'x'));
  });

  test('a twin body must carry the marker and the link back', () => {
    assertRefused(create(body('Mirrored from https://github.com/tedeuxx/mhw/issues/7\n'), 'x'));
    assertRefused(create(body('<!-- mhw-issue: tedeuxx/mhw#7 -->\n', 'c.md'), 'x'));
    assertRefused(create(body('<!-- mhw-issue: tedeuxx/mhw#70 -->\nhttps://github.com/tedeuxx/mhw/issues/70\n', 'd.md'), 'x'));
  });

  test('a body file must be under the sync directory', () => {
    const outside = path.join(tmp, 'outside.md');
    fs.writeFileSync(outside, MARKED);
    assertRefused(create(outside, 'x'));
    assertRefused(create(path.join(sync, '..', 'outside.md'), 'x'));
    const link = path.join(sync, 'link.md');
    fs.symlinkSync(outside, link);
    assertRefused(create(link, 'x'));
    assertRefused(create('-', 'x'));
    assertRefused(create(sync, 'x'));
    if (fs.existsSync('/proc/self/environ')) assertRefused(create('/proc/self/environ', 'x'));
  });

  test('credentials are refused', () => {
    const leaks = ['ghs_' + 'a'.repeat(36), 'github_pat_' + 'b'.repeat(30), 'sk-ant-' + 'c'.repeat(20),
      '-'.repeat(5) + 'BEGIN RSA ' + 'PRIVATE KEY' + '-'.repeat(5), 'AKIA' + 'D'.repeat(16)];
    leaks.forEach((leak, i) => assertRefused(create(body(MARKED + leak + '\n', 'leak' + i + '.md'), 'x')));
    assertRefused(create(goodBody(), 'ghp_' + 'e'.repeat(36)));
  });

  test('writes go only to the twin', () => {
    addTwin();
    assertRefused(['skills-edit', '5', '--body-file', goodBody()]);
    assertRefused(['skills-comment', '6', '--body-file', body('hi', 'h.md')]);
    assertRefused(['skills-view', '5']);
    const p = run(['skills-edit', '42', '--title', '[mhw#7] T', '--body-file', goodBody('e.md')]);
    assert.equal(p.code, 0, p.stderr);
    assert.deepEqual(writes().at(-1)?.args.slice(0, 3), ['issue', 'edit', '42']);
  });

  test('unknown commands and flags are refused', () => {
    addTwin();
    assert.equal(run(['issue', 'delete', '42']).code, 2);
    assertRefused(['skills-edit', '42', '--add-label', 'x']);
    assertRefused(['skills-create', '--title', 'x', '--body', 'inline']);
    assertRefused(['skills-close', '42', '--comment', 'x']);
    assertRefused(['mhw-view'], { issue: '7; rm' });
    // Names of Object.prototype are not commands.
    for (const name of ['constructor', '__proto__', 'toString', 'hasOwnProperty']) assert.equal(run([name]).code, 2, name);
    assert.deepEqual(writes(), []);
  });

  test('the state mirrors the mhw Issue', () => {
    addTwin();
    assertRefused(['skills-close', '42']); // the mhw Issue is open
    assert.equal(run(['skills-reopen', '42']).code, 0);
    setState('CLOSED', []);
    addTwin();
    assertRefused(['skills-reopen', '42']); // the mhw Issue is closed
    assert.equal(run(['skills-close', '42']).code, 0);
    assert.deepEqual(writes().at(-1)?.args, ['issue', 'close', '42', '--repo', 'tedeuxx/tadeumendonca-skills']);
  });

  test('the back-link is posted once', () => {
    const p = run(['backlink']); // no twin: red, nothing posted, no link claimed
    assert.equal(p.code, 1, p.stdout + p.stderr);
    assert.ok(p.stdout.includes('FAIL'));
    assert.ok(p.stdout.includes('nothing was linked'));
    assert.deepEqual(writes(), []);
    addTwin();
    assert.equal(run(['backlink']).code, 0);
    assert.equal(run(['backlink']).code, 0);
    const posted = writes().filter((c) => c.args[0] === 'issue' && c.args[1] === 'comment');
    assert.equal(posted.length, 1, 'the back-link is posted once');
    assert.equal(posted[0].token, 'MHW_TOKEN');
    assert.deepEqual(posted[0].args.slice(2, 5), ['7', '--repo', 'tedeuxx/mhw']);
    const comment = readState().mhw_comments[0].body;
    assert.ok(comment.includes('<!-- mhw-twin: tedeuxx/tadeumendonca-skills#42 -->'));
    assert.ok(comment.includes('u42'));
  });

  test('the twin must be App-authored', () => {
    addTwin({ number: 43, author: 'outsider' });
    const p = run(['find-twin']);
    assert.deepEqual(JSON.parse(p.stdout), {}, 'a marked Issue by anyone else is not the twin');
    assert.ok(p.stderr.includes('::warning::ignored #43'));
    assertRefused(['skills-edit', '43', '--body-file', goodBody()]);
    assertRefused(['skills-close', '43']);
    addTwin();
    assert.equal(JSON.parse(run(['find-twin']).stdout).number, 42);
    assert.equal(run(['backlink']).code, 0);
    const posted = writes().filter((c) => c.args[1] === 'comment');
    assert.ok(readState().mhw_comments[0].body.includes('tadeumendonca-skills#42'));
    assert.equal(posted.length, 1);
  });

  test('two App-authored twins are refused', () => {
    addTwin();
    addTwin({ number: 44 });
    const p = assertRefused(['find-twin']);
    assert.ok(p.stderr.includes('#42, #44'));
    assertRefused(['skills-edit', '42', '--body-file', goodBody()]);
  });

  test('the body size is capped', () => {
    assertRefused(create(body(MARKED + 'x'.repeat(60001), 'big.md'), 'x'));
  });

  test('a body file must be a regular file', () => {
    fs.mkdirSync(path.join(sync, 'dir.md'));
    assertRefused(create(path.join(sync, 'dir.md'), 'x'));
  });

  test('the title is one line', () => {
    assertRefused(create(goodBody(), 'a\nb'));
    assertRefused(create(goodBody(), 'a\rb'));
    assertRefused(create(goodBody(), 'x'.repeat(257)));
  });

  test('token runs are refused and never printed', () => {
    const held = 'Zq7'.repeat(20);
    for (const name of ['MHW_SKILLS_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN', 'GITHUB_TOKEN']) {
      const file = body(MARKED + 'see ' + held.slice(5, 17) + '\n', 't-' + name + '.md');
      let p = assertRefused(create(file, 'x'), { env: { [name]: held } });
      assert.ok(!(p.stdout + p.stderr).includes(held.slice(5, 17)));
      p = assertRefused(create(goodBody(), 't ' + held.slice(30, 42)), { env: { [name]: held } });
    }
    // 11 characters of a token are not a match.
    const file = body(MARKED + 'see ' + held.slice(5, 16) + '\n', 't-short.md');
    const p = run(create(file, 'x'), { env: { MHW_SKILLS_TOKEN: held } });
    assert.equal(p.code, 0, p.stderr);
  });

  test('refusals do not echo argument values', () => {
    addTwin();
    for (const args of [['skills-edit', '42', '--sekrit-flag', 'VALUE-XYZ'], ['skills-view', 'NUM-XYZ'], ['skills-view', '77777']]) {
      const p = assertRefused(args);
      for (const value of ['sekrit', 'VALUE-XYZ', 'NUM-XYZ', '77777']) assert.ok(!p.stderr.includes(value));
    }
  });

  test('the back-link counts only comments by GitHub Actions', () => {
    setState('OPEN', [], [{ body: '<!-- mhw-twin: tedeuxx/tadeumendonca-skills#1 -->', author: { login: 'outsider' } }]);
    addTwin();
    assert.equal(run(['backlink']).code, 0);
    const comments = () => writes().filter((c) => c.args[0] === 'issue' && c.args[1] === 'comment').length;
    assert.equal(comments(), 1, 'a marker in someone else\'s comment does not suppress the back-link');
    assert.equal(run(['backlink']).code, 0);
    assert.equal(comments(), 1);
  });

  // The scrubbed subprocess: no token names in the environment (re-run canary, run 38294048591).
  const SCRUBBED = { MHW_TOKEN: null, MHW_SKILLS_TOKEN: null, GITHUB_TOKEN: null };
  /** @param {string} folder @param {Record<string, string | null>} [extra] */
  const stash = (folder, extra = {}) => run(['stash-inputs'], { env: { MHW_INPUT_DIR: folder, ...extra } });

  test('a missing input is exit 3, and named', () => {
    let p = run(['mhw-view'], { env: SCRUBBED });
    assert.equal(p.code, 3, p.stderr);
    assert.ok(p.stderr.includes('REFUSED  MISSING-INPUT MHW_TOKEN:'));
    assert.deepEqual(calls(), [], 'nothing reaches gh without its token');
    p = run(['find-twin'], { env: SCRUBBED });
    assert.equal(p.code, 3);
    assert.ok(p.stderr.includes('MISSING-INPUT MHW_SKILLS_TOKEN'));
    p = run(['find-twin'], { env: { MHW_ISSUE: null } });
    assert.equal(p.code, 3);
    assert.ok(p.stderr.includes('MISSING-INPUT MHW_ISSUE'));
    // A refusal is still exit 2, so the two read differently.
    assert.equal(run(['skills-view', 'x']).code, 2);
  });

  test('stashed inputs reach a scrubbed subprocess', () => {
    const folder = path.join(tmp, 'method-sync-input');
    let p = stash(folder);
    assert.equal(p.code, 0, p.stderr);
    for (const value of ['tok-mhw', 'tok-skills', sync]) assert.ok(!(p.stdout + p.stderr).includes(value));
    assert.equal(fs.statSync(folder).mode & 0o777, 0o700);
    assert.deepEqual(fs.readdirSync(folder).sort((a, b) => a.localeCompare(b)), ['MHW_ISSUE', 'MHW_SKILLS_TOKEN', 'MHW_SYNC_DIR', 'MHW_TOKEN']);
    for (const name of fs.readdirSync(folder)) assert.equal(fs.statSync(path.join(folder, name)).mode & 0o777, 0o600);
    const scrubbed = { ...SCRUBBED, MHW_ISSUE: null, MHW_SYNC_DIR: null, MHW_INPUT_DIR: folder };
    assert.equal(run(['mhw-view'], { env: scrubbed }).code, 0);
    p = run(create(goodBody()), { env: scrubbed });
    assert.equal(p.code, 0, p.stderr);
    const tokens = Object.fromEntries(calls().map((c) => [c.args[1], c.token]));
    assert.equal(tokens.view, 'MHW_TOKEN');
    assert.equal(tokens.create, 'MHW_SKILLS_TOKEN');
    // RUNNER_TEMP/method-sync-input is the fallback when MHW_INPUT_DIR is gone too.
    assert.equal(run(['find-twin'], { env: { ...scrubbed, MHW_INPUT_DIR: null, RUNNER_TEMP: tmp } }).code, 0);
  });

  test('stashed tokens still count for the token-run check', () => {
    const folder = path.join(tmp, 'method-sync-input');
    const held = 'Kq9'.repeat(20);
    assert.equal(stash(folder, { MHW_SKILLS_TOKEN: held }).code, 0);
    const file = body(MARKED + 'see ' + held.slice(3, 15) + '\n', 'run.md');
    assertRefused(create(file, 'x'), { env: { ...SCRUBBED, MHW_INPUT_DIR: folder } });
  });

  test('stash refuses to replace an input or to sit in the write directory', () => {
    const folder = path.join(tmp, 'method-sync-input');
    assert.equal(stash(folder).code, 0);
    let p = stash(folder, { MHW_TOKEN: 'tok-replaced' });
    assert.equal(p.code, 2, p.stderr);
    assert.equal(fs.readFileSync(path.join(folder, 'MHW_TOKEN'), 'utf8'), 'tok-mhw');
    // An existing, empty, world-readable directory is tightened to 0700, not used as it is.
    const loose = path.join(tmp, 'loose');
    fs.mkdirSync(loose, 0o755);
    fs.chmodSync(loose, 0o755);
    assert.equal(stash(loose).code, 0);
    assert.equal(fs.statSync(loose).mode & 0o777, 0o700);
    p = stash(path.join(sync, 'inputs'));
    assert.equal(p.code, 2);
    assert.ok(!fs.existsSync(path.join(sync, 'inputs')));
    p = stash(path.join(tmp, 'other'), { MHW_SKILLS_TOKEN: null });
    assert.equal(p.code, 3);
    assert.ok(p.stderr.includes('MISSING-INPUT MHW_SKILLS_TOKEN'));
    assert.ok(!fs.existsSync(path.join(tmp, 'other', 'MHW_TOKEN')));
  });

  /** @param {unknown} messages @param {string} [name] */
  function executionFile(messages, name = 'exec.json') {
    const p = path.join(tmp, name);
    fs.writeFileSync(p, JSON.stringify(messages));
    return p;
  }

  test('final-line prints the result only', () => {
    const file = executionFile([
      { type: 'system', subtype: 'init', tools: ['Bash'] },
      { type: 'assistant', message: { content: [{ type: 'tool_use', input: { command: 'TOOL-IN-XYZ' } }] } },
      { type: 'user', message: { content: [{ type: 'tool_result', content: 'TOOL-OUT-XYZ' }] } },
      { type: 'result', subtype: 'success', num_turns: 2, is_error: false, permission_denials: [{ tool_name: 'Bash' }], result: 'REFUSED  MISSING-INPUT MHW_TOKEN' },
    ]);
    const p = run(['final-line', file], { env: { MHW_ISSUE: null } });
    assert.equal(p.code, 0, p.stderr);
    assert.ok(p.stdout.includes('subtype: success  turns: 2  is_error: False  permission_denials: 1'));
    assert.ok(p.stdout.includes('result: REFUSED  MISSING-INPUT MHW_TOKEN'));
    for (const hidden of ['TOOL-IN-XYZ', 'TOOL-OUT-XYZ', 'init']) assert.ok(!(p.stdout + p.stderr).includes(hidden));
    assert.deepEqual(calls(), []);
  });

  test('final-line prefers the denials count', () => {
    // The action's log reports permission_denials_count (run 38294048591); the SDK list is the fallback.
    let file = executionFile([{ type: 'result', subtype: 'success', num_turns: 2, is_error: false, permission_denials_count: 3, permission_denials: [{}], result: 'r' }], 'count.json');
    assert.ok(run(['final-line', file]).stdout.includes('permission_denials: 3'));
    file = executionFile([{ type: 'result', permission_denials_count: 0, result: 'r' }], 'zero.json');
    assert.ok(run(['final-line', file]).stdout.includes('permission_denials: 0'));
    file = executionFile([{ type: 'result', result: 'r' }], 'none.json');
    assert.ok(run(['final-line', file]).stdout.includes('permission_denials: ?'));
  });

  test('final-line takes the last result and caps it', () => {
    const out = run(['final-line', executionFile([{ type: 'result', result: 'first' }, { type: 'result', result: 'y'.repeat(2500) }])]).stdout;
    assert.ok(!out.includes('first'));
    assert.ok(out.includes('y'.repeat(2000) + ' [cut at 2000 characters]'));
    assert.ok(!out.includes('y'.repeat(2001)));
  });

  test('final-line never fails and withholds credentials', () => {
    for (const file of [path.join(tmp, 'absent.json'), executionFile({ x: 1 }, 'obj.json'), executionFile([{ type: 'assistant' }], 'noresult.json'), '']) {
      const p = run(['final-line', file]);
      assert.equal(p.code, 0, p.stderr);
      assert.ok(p.stdout.includes('final-line:'));
    }
    const leak = 'ghs_' + 'q'.repeat(36);
    const p = run(['final-line', executionFile([{ type: 'result', result: leak }], 'leak.json')]);
    assert.ok(!p.stdout.includes(leak));
    assert.ok(p.stdout.includes('withheld'));
  });

  test('verify: a refused or abandoned sync is red', () => {
    let p = run(['verify']);
    assert.equal(p.code, 1); // no twin
    addTwin({ state: 'CLOSED' });
    p = run(['verify']);
    assert.equal(p.code, 1); // the mhw Issue is open, the twin closed
    assert.ok(p.stdout.includes('FAIL'));
    setState('OPEN', []);
    addTwin({ state: 'OPEN' });
    p = run(['verify']);
    assert.equal(p.code, 0, p.stdout + p.stderr);
    assert.ok(p.stdout.includes('PASS'));
    assert.deepEqual(writes(), []);
  });

  test('token values are never printed', () => {
    addTwin();
    for (const args of [['mhw-view'], ['find-twin'], ['skills-view', '42'], ['backlink'], ['skills-edit', '9']]) {
      const p = run(args);
      for (const value of ['tok-mhw', 'tok-skills', 'tok-other']) assert.ok(!(p.stdout + p.stderr).includes(value));
    }
  });

  test('a gh failure passes its stderr and exit code through, and sends nothing after it', () => {
    writeGh('gh', '#!/bin/sh\necho "gh: HTTP 502" >&2\nexit 4\n');
    const p = run(['find-twin']);
    assert.equal(p.code, 4);
    assert.equal(p.stderr, 'gh: HTTP 502\n');
    assert.equal(p.stdout, '');
    writeGh('gh', '#!/bin/sh\nkill -TERM $$\n');
    assert.equal(run(['verify']).code, 256 - 15, 'a gh killed by a signal is the exit code Python gave it');
  });

  test('gh is looked up on absolute PATH entries only, and its absence is exit 1', () => {
    // A relative PATH entry naming a gh in the working directory is not used.
    fs.mkdirSync(path.join(tmp, 'rel'));
    fs.copyFileSync(path.join(bin, 'gh'), path.join(tmp, 'rel', 'gh'));
    fs.chmodSync(path.join(tmp, 'rel', 'gh'), 0o700);
    const p = run(['find-twin'], { env: { PATH: 'rel' } });
    assert.equal(p.code, 1);
    assert.equal(p.stderr, 'gh is not on PATH (absolute entries only)\n');
    assert.deepEqual(calls(), []);
  });

  test('a reply that is not JSON is exit 1 with one line, never a stack trace', () => {
    writeGh('gh', '#!/bin/sh\necho "not json"\n');
    const p = run(['find-twin']);
    assert.equal(p.code, 1);
    assert.equal(p.stderr.split('\n').filter(Boolean).length, 1, p.stderr);
    assert.ok(p.stderr.startsWith('method-issue-sync: '));
  });
});
