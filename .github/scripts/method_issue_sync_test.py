#!/usr/bin/env python3
"""Tests for the method backlog sync (Issue #62): the workflow's structure and the agent's only route to
GitHub, .github/scripts/method_issue_sync.py.

The workflow is parsed with the runner's ruby (Psych, the parser the shellcheck job already uses), so no
third-party module is needed; the test fails, never skips, when ruby is absent. The script runs against a
stub `gh` on PATH that records every call and the token it was given (by name, never by value). No network,
no account, no real token. Writes only under a temporary directory.

Run: python3 -B .github/scripts/method_issue_sync_test.py
"""

import json
import os
import re
import shutil
import stat
import subprocess
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
WORKFLOW = os.path.join(ROOT, ".github", "workflows", "method-issue-sync.yml")
TESTS_WORKFLOW = os.path.join(ROOT, ".github", "workflows", "tests.yml")
ISOLATION_INSTALL = "sudo apt-get update -qq && sudo apt-get install -y --no-install-recommends bubblewrap socat"
SCRIPT = os.path.join(HERE, "method_issue_sync.py")

PIN_CHECKOUT = "actions/checkout@d23441a48e516b6c34aea4fa41551a30e30af803"
PIN_APP_TOKEN = "actions/create-github-app-token@bcd2ba49218906704ab6c1aa796996da409d3eb1"
PIN_CLAUDE = "anthropics/claude-code-action@1d6de8cb0c237e7c15e9e1bdf973826ebae490cc"
SECRETS = ("MHW_MIRROR_APP_ID", "MHW_MIRROR_APP_PRIVATE_KEY", "CLAUDE_CODE_OAUTH_TOKEN")
ALLOWED_TOOLS = {
    "Bash(python3 .github/scripts/method_issue_sync.py:*)",
    "Write(/${{ runner.temp }}/method-sync/**)",
}
MUST_DISALLOW = {"Read", "Glob", "Grep", "Edit", "MultiEdit", "NotebookEdit", "WebFetch", "WebSearch", "Task"}


def load_workflow(path=WORKFLOW):
    ruby = shutil.which("ruby")
    if not ruby:
        raise AssertionError("ruby is required to parse the workflow (preinstalled on the CI runners)")
    out = subprocess.run(
        [ruby, "-ryaml", "-rjson", "-e", "puts JSON.dump(YAML.safe_load(File.read(ARGV[0])))", path],
        stdout=subprocess.PIPE, stderr=subprocess.PIPE, universal_newlines=True, check=True).stdout
    doc = json.loads(out)
    # YAML 1.1 reads the bare key `on` as the boolean true.
    if "on" not in doc and "true" in doc:
        doc["on"] = doc.pop("true")
    return doc


def all_steps(doc):
    for name, job in doc["jobs"].items():
        for step in job.get("steps", []):
            yield name, step


def flag_value(args, flag):
    m = re.search(r'%s\s+"([^"]*)"' % re.escape(flag), args)
    return m.group(1) if m else None


class Workflow(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.doc = load_workflow()
        cls.jobs = cls.doc["jobs"]
        with open(WORKFLOW, encoding="utf-8") as fh:
            cls.text = fh.read()

    def claude_step(self):
        steps = [s for _, s in all_steps(self.doc) if str(s.get("uses", "")).startswith("anthropics/")]
        self.assertEqual(len(steps), 1, "exactly one claude-code-action step")
        return steps[0]

    def test_triggers(self):
        on = self.doc["on"]
        self.assertEqual(sorted(on), ["issues", "workflow_dispatch"])
        self.assertEqual(on["issues"]["types"], ["labeled", "edited", "closed", "reopened"])
        issue_input = on["workflow_dispatch"]["inputs"]["issue"]
        self.assertFalse(issue_input.get("required", False), "the issue input is optional (empty = backfill)")

    def test_label_filter(self):
        cond = " ".join(self.jobs["select"]["if"].split())
        self.assertIn("github.event.action == 'labeled' && github.event.label.name == 'method'", cond)
        self.assertIn("github.event.action != 'labeled' && contains(github.event.issue.labels.*.name, 'method')", cond)
        self.assertIn("github.repository == 'tedeuxx/mhw'", cond)
        self.assertIn("github.event_name == 'workflow_dispatch'", cond)
        for job in ("sync", "backlink"):
            self.assertIn("select", self.jobs[job]["needs"])

    def test_backfill_lists_open_method_issues(self):
        pick = [s for s in self.jobs["select"]["steps"] if s.get("id") == "pick"][0]
        self.assertIn("gh issue list --repo \"$REPO\" --label method --state open", pick["run"])
        self.assertIn('index("method") != null', pick["run"], "a dispatched number must carry the label")

    def test_every_action_is_pinned_to_a_full_sha(self):
        uses = [s["uses"] for _, s in all_steps(self.doc) if "uses" in s]
        self.assertTrue(uses)
        for u in uses:
            self.assertRegex(u, r"^[\w.-]+/[\w.-]+@[0-9a-f]{40}$", u)
        self.assertIn(PIN_CHECKOUT, uses)
        self.assertIn(PIN_APP_TOKEN, uses)
        self.assertIn(PIN_CLAUDE, uses)

    def test_skip_on_missing_secrets(self):
        step = [s for s in self.jobs["select"]["steps"] if s.get("id") == "secrets"][0]
        for name in SECRETS:
            self.assertIn("${{ secrets.%s != '' }}" % name, step["env"].values())
            self.assertIn(name, step["run"])
        self.assertIn("::notice", step["run"])
        self.assertIn('echo "ready=false"', step["run"])
        self.assertNotIn("exit 1", step["run"], "a missing secret skips; it never fails the run")
        self.assertEqual(self.jobs["select"]["outputs"]["ready"], "${{ steps.secrets.outputs.ready }}")
        for job in ("sync", "backlink"):
            self.assertIn("needs.select.outputs.ready == 'true'", self.jobs[job]["if"])
        pick = [s for s in self.jobs["select"]["steps"] if s.get("id") == "pick"][0]
        self.assertEqual(pick["if"], "steps.secrets.outputs.ready == 'true'")

    def test_permissions_are_least_privilege(self):
        self.assertEqual(self.doc["permissions"], {})
        self.assertEqual(self.jobs["select"]["permissions"], {"issues": "read"})
        self.assertEqual(self.jobs["sync"]["permissions"], {"contents": "read", "issues": "read"})
        self.assertEqual(self.jobs["backlink"]["permissions"], {"contents": "read", "issues": "write"})
        self.assertNotIn("id-token", self.text)
        tokens = {}
        for job, step in all_steps(self.doc):
            if str(step.get("uses", "")).startswith("actions/create-github-app-token@"):
                w = step["with"]
                self.assertEqual(w["owner"], "tedeuxx")
                self.assertEqual(w["repositories"], "tadeumendonca-skills")
                self.assertEqual(w["app-id"], "${{ secrets.MHW_MIRROR_APP_ID }}")
                self.assertEqual(w["private-key"], "${{ secrets.MHW_MIRROR_APP_PRIVATE_KEY }}")
                self.assertEqual([k for k in w if k.startswith("permission-")], ["permission-issues"])
                tokens[job] = w["permission-issues"]
        self.assertEqual(tokens, {"sync": "write", "backlink": "read"})

    def test_no_token_is_printed(self):
        for _, step in all_steps(self.doc):
            run = step.get("run", "")
            self.assertNotIn("secrets.", run, "secrets reach a step only through with:/env:")
            self.assertNotIn("outputs.token", run)
            self.assertNotIn("github.token", run)
            self.assertNotRegex(run, r"\$\{?(GH_TOKEN|MHW_TOKEN|MHW_SKILLS_TOKEN)\b")

    def test_concurrency_per_issue(self):
        groups = {"sync": "method-issue-sync-${{ matrix.issue }}",
                   "backlink": "method-issue-sync-backlink-${{ matrix.issue }}"}
        for job, group in groups.items():
            c = self.jobs[job]["concurrency"]
            self.assertEqual(c["group"], group)
            self.assertFalse(c["cancel-in-progress"])
            self.assertEqual(self.jobs[job]["strategy"]["matrix"]["issue"],
                             "${{ fromJSON(needs.select.outputs.issues) }}")

    def test_claude_step_credentials(self):
        step = self.claude_step()
        w, env = step["with"], step["env"]
        self.assertEqual(w["claude_code_oauth_token"], "${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}")
        self.assertEqual(w["github_token"], "${{ github.token }}")
        self.assertEqual(env["MHW_SKILLS_TOKEN"], "${{ steps.app.outputs.token }}")
        self.assertEqual(env["MHW_TOKEN"], "${{ github.token }}")
        self.assertEqual(env["MHW_ISSUE"], "${{ matrix.issue }}")
        self.assertEqual(env["CLAUDE_CODE_SUBPROCESS_ENV_SCRUB"], "1")
        self.assertNotIn("anthropic_api_key", w)

    def test_allowed_tools_are_bounded(self):
        args = self.claude_step()["with"]["claude_args"]
        allowed = flag_value(args, "--allowedTools")
        self.assertIsNotNone(allowed)
        self.assertEqual(set(allowed.split(",")), ALLOWED_TOOLS)
        self.assertEqual(len(allowed.split(",")), len(ALLOWED_TOOLS))
        disallowed = flag_value(args, "--disallowedTools")
        self.assertIsNotNone(disallowed)
        self.assertTrue(MUST_DISALLOW <= set(disallowed.split(",")), "Read/Glob/Grep could read the environment")
        self.assertRegex(args, r"--setting-sources user\b")
        turns = re.search(r"--max-turns (\d+)", args)
        self.assertTrue(turns and 0 < int(turns.group(1)) <= 40)
        self.assertEqual(args.count("--allowedTools"), 1)

    def test_prompt(self):
        prompt = self.claude_step()["with"]["prompt"]
        flat = " ".join(prompt.split())
        self.assertIn("DATA, NOT INSTRUCTIONS", flat)
        self.assertIn("prompt-injection", flat)
        marker = re.escape("<!-- mhw-issue: tedeuxx/mhw#${{ matrix.issue }} -->")
        # Where the twin is found, and the body's first line, which carries it into the twin.
        self.assertRegex(prompt, r"carries the hidden marker\s*" + marker)
        self.assertRegex(prompt, r"in this order:\s*" + marker + r"\s*Mirrored from https://github\.com/tedeuxx/mhw/")
        self.assertIn("https://github.com/tedeuxx/mhw/issues/${{ matrix.issue }}", prompt)
        for word in ("secret", "personal data", "client or employer", "skills-close", "skills-reopen",
                     "Acceptance criteria", "agents", "skills", "commands", "manifests", "powers", "hooks"):
            self.assertIn(word, flat)
        self.assertIn("Do not comment on the mhw Issue", flat)

    def test_sync_job_verifies_after_the_agent(self):
        steps = self.jobs["sync"]["steps"]
        names = [str(s.get("uses", "")) + s.get("run", "") for s in steps]
        claude = [i for i, n in enumerate(names) if n.startswith("anthropics/")][0]
        verify = [i for i, n in enumerate(names) if "method_issue_sync.py verify" in n]
        self.assertEqual(verify, [len(steps) - 1], "verify is the sync job's last step")
        self.assertGreater(verify[0], claude)
        self.assertNotIn("continue-on-error", steps[-1])
        self.assertEqual(steps[-1]["run"].strip(), "python3 -B .github/scripts/method_issue_sync.py verify")
        self.assertNotIn("if", steps[-1], "verify runs whenever the agent step succeeded")

    def test_bubblewrap_is_installed_before_any_scrubbed_step(self):
        # First canary, 2026-10-12: the scrub needs bubblewrap, which ubuntu-latest does not ship.
        scrubbed = 0
        for job in self.jobs.values():
            steps = job.get("steps", [])
            for i, step in enumerate(steps):
                if str((step.get("env") or {}).get("CLAUDE_CODE_SUBPROCESS_ENV_SCRUB", "0")) == "0":
                    continue
                scrubbed += 1
                installs = [s.get("run", "") for s in steps[:i] if ISOLATION_INSTALL in s.get("run", "")]
                self.assertEqual(len(installs), 1, "bubblewrap is installed once, before the scrubbed step")
                self.assert_isolation_recipe(installs[0])
        self.assertEqual(scrubbed, 1, "the agent step carries the scrub")

    def assert_isolation_recipe(self, run):
        lines = [ln.strip() for ln in run.splitlines() if ln.strip() and not ln.strip().startswith("#")]
        self.assertIn(ISOLATION_INSTALL + " && break", lines)
        guard = ("if [ -f /proc/sys/kernel/apparmor_restrict_unprivileged_userns ] && command -v sudo >/dev/null; "
                 "then")
        self.assertIn(guard, lines)
        self.assertEqual(lines[lines.index(guard) + 1], "sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0")
        self.assertEqual(lines[-1], "bwrap --unshare-user --ro-bind / / /bin/true", "the smoke test ends the step")
        order = [lines.index(ISOLATION_INSTALL + " && break"), lines.index(guard), lines.index("bwrap --version"),
                 len(lines) - 1]
        self.assertEqual(order, sorted(order))
        self.assertNotIn("|| true", run)

    def test_isolation_recipe_also_runs_on_every_pr(self):
        tests = load_workflow(TESTS_WORKFLOW)
        job = tests["jobs"]["isolation-smoke"]
        self.assertEqual(job["runs-on"], "ubuntu-latest")
        self.assertIn("isolation-smoke", tests["jobs"]["delivery-ci"]["needs"])
        self.assertNotIn("continue-on-error", job)
        runs = [s["run"] for s in job["steps"] if "run" in s]
        self.assertEqual(len(runs), 1)
        self.assertNotIn("continue-on-error", job["steps"][0])
        sync_step = [s for s in self.jobs["sync"]["steps"] if ISOLATION_INSTALL in s.get("run", "")][0]
        self.assertNotIn("continue-on-error", sync_step)
        self.assertEqual(runs[0], sync_step["run"], "the PR job runs exactly the workflow's script")
        self.assert_isolation_recipe(runs[0])

    def test_backlink_runs_only_after_a_successful_sync(self):
        job = self.jobs["backlink"]
        cond = " ".join(job["if"].split())
        self.assertIn("needs.sync.result == 'success'", cond)
        self.assertTrue(cond.startswith("needs.sync.result == 'success' &&"), cond)
        self.assertNotIn("||", cond, "no alternative may bypass the sync-success condition")
        for loose in ("!cancelled()", "always()", "failure()"):
            self.assertNotIn(loose, cond)
        self.assertIn("sync", job["needs"])

    def test_backlink_job_runs_the_script_without_an_agent(self):
        steps = self.jobs["backlink"]["steps"]
        self.assertFalse([s for s in steps if str(s.get("uses", "")).startswith("anthropics/")])
        self.assertIn("method_issue_sync.py backlink", steps[-1]["run"])


STUB_GH = r'''#!/usr/bin/env python3
import json, os, sys
state_path = os.environ["STUB_STATE"]
with open(state_path) as fh:
    state = json.load(fh)
args = sys.argv[1:]
token = os.environ.get("GH_TOKEN", "")
who = {"tok-mhw": "MHW_TOKEN", "tok-skills": "MHW_SKILLS_TOKEN"}.get(token, "other")
with open(os.environ["STUB_LOG"], "a") as fh:
    fh.write(json.dumps({"args": args, "token": who, "github_token": "GITHUB_TOKEN" in os.environ}) + "\n")
def repo():
    return args[args.index("--repo") + 1] if "--repo" in args else None
def save():
    with open(state_path, "w") as fh:
        json.dump(state, fh)
if args[:2] == ["issue", "view"] and repo() == "tedeuxx/mhw":
    if "comments" in args:
        print(json.dumps({"comments": state["mhw_comments"]}))
    else:
        print(json.dumps(state["mhw"]))
elif args[:2] == ["issue", "comment"] and repo() == "tedeuxx/mhw":
    body = open(args[args.index("--body-file") + 1]).read()
    state["mhw_comments"].append({"body": body, "author": {"login": "github-actions"}}); save(); print("https://github.com/tedeuxx/mhw/issues/7#c")
elif args[:2] == ["issue", "list"] and repo() == "tedeuxx/tadeumendonca-skills":
    print(json.dumps(state["skills"]))
elif args[:2] == ["issue", "create"]:
    n = 900 + len(state["skills"])
    body = open(args[args.index("--body-file") + 1]).read()
    state["skills"].append({"number": n, "title": args[args.index("--title") + 1], "state": "OPEN",
                            "author": {"login": "app/tedeuxx-mhw-mirror"},
                            "url": "https://github.com/tedeuxx/tadeumendonca-skills/issues/%d" % n, "body": body})
    save(); print("https://github.com/tedeuxx/tadeumendonca-skills/issues/%d" % n)
elif args[:2] in (["issue", "close"], ["issue", "reopen"], ["issue", "edit"], ["issue", "comment"], ["issue", "view"]):
    print("ok")
else:
    sys.stderr.write("stub gh: unexpected call\n"); sys.exit(9)
'''


class Script(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="method-sync-test-")
        self.bin = os.path.join(self.tmp, "bin")
        os.mkdir(self.bin)
        gh = os.path.join(self.bin, "gh")
        with open(gh, "w") as fh:
            fh.write(STUB_GH)
        os.chmod(gh, os.stat(gh).st_mode | stat.S_IEXEC)
        self.sync = os.path.join(self.tmp, "sync")
        os.mkdir(self.sync)
        self.state = os.path.join(self.tmp, "state.json")
        self.log = os.path.join(self.tmp, "log.jsonl")
        self.set_state(mhw_state="OPEN", skills=[
            {"number": 5, "title": "other", "state": "OPEN", "url": "u5", "body": "unrelated"},
            {"number": 6, "title": "other twin", "state": "OPEN", "url": "u6",
             "body": "<!-- mhw-issue: tedeuxx/mhw#70 -->", "author": {"login": "app/tedeuxx-mhw-mirror"}},
        ])

    def tearDown(self):
        shutil.rmtree(self.tmp)

    def set_state(self, mhw_state, skills, comments=()):
        with open(self.state, "w") as fh:
            json.dump({"mhw": {"number": 7, "title": "T", "body": "B", "state": mhw_state,
                               "url": "https://github.com/tedeuxx/mhw/issues/7", "labels": []},
                       "mhw_comments": list(comments), "skills": skills}, fh)

    def add_twin(self, state="OPEN", number=42, author="app/tedeuxx-mhw-mirror"):
        with open(self.state) as fh:
            st = json.load(fh)
        st["skills"].append({"number": number, "title": "[mhw#7] T", "state": state, "url": "u%d" % number,
                             "author": {"login": author},
                             "body": "<!-- mhw-issue: tedeuxx/mhw#7 -->\nhttps://github.com/tedeuxx/mhw/issues/7"})
        with open(self.state, "w") as fh:
            json.dump(st, fh)

    def body(self, text, name="b.md"):
        path = os.path.join(self.sync, name)
        with open(path, "w") as fh:
            fh.write(text)
        return path

    def good_body(self, name="b.md"):
        return self.body("<!-- mhw-issue: tedeuxx/mhw#7 -->\nMirrored from https://github.com/tedeuxx/mhw/issues/7\n"
                         "## What changes in the plugin\n- skills: x\n", name)

    def run_script(self, *args, issue="7", extra_env=None):
        env = {"PATH": self.bin + os.pathsep + os.environ.get("PATH", ""), "STUB_STATE": self.state,
               "STUB_LOG": self.log, "MHW_ISSUE": issue, "MHW_TOKEN": "tok-mhw",
               "MHW_SKILLS_TOKEN": "tok-skills", "MHW_SYNC_DIR": self.sync, "GITHUB_TOKEN": "tok-other"}
        env.update(extra_env or {})
        return subprocess.run([sys.executable, "-B", SCRIPT] + list(args), env=env, stdout=subprocess.PIPE,
                              stderr=subprocess.PIPE, universal_newlines=True)

    def calls(self):
        if not os.path.exists(self.log):
            return []
        with open(self.log) as fh:
            return [json.loads(line) for line in fh]

    def writes(self):
        return [c for c in self.calls() if c["args"][1] in ("create", "edit", "comment", "close", "reopen")]

    def assert_refused(self, *args, issue="7", extra_env=None):
        before = len(self.writes())
        proc = self.run_script(*args, issue=issue, extra_env=extra_env)
        self.assertEqual(proc.returncode, 2, proc.stderr)
        self.assertIn("REFUSED", proc.stderr)
        self.assertEqual(len(self.writes()), before, "a refusal sends nothing")
        return proc

    def test_every_call_is_scoped_by_repo_and_token(self):
        self.assertEqual(self.run_script("mhw-view").returncode, 0)
        self.assertEqual(self.run_script("find-twin").returncode, 0)
        proc = self.run_script("skills-create", "--title", "[mhw#7] T", "--body-file", self.good_body())
        self.assertEqual(proc.returncode, 0, proc.stderr)
        for c in self.calls():
            self.assertFalse(c["github_token"], "GITHUB_TOKEN must not reach gh")
            repo = c["args"][c["args"].index("--repo") + 1]
            if repo == "tedeuxx/mhw":
                self.assertEqual(c["token"], "MHW_TOKEN")
                self.assertEqual(c["args"][:2], ["issue", "view"])
            else:
                self.assertEqual(repo, "tedeuxx/tadeumendonca-skills")
                self.assertEqual(c["token"], "MHW_SKILLS_TOKEN")

    def test_mhw_view_reads_only_this_runs_issue(self):
        self.assertEqual(self.run_script("mhw-view").returncode, 0)
        self.assert_refused("mhw-view", "8")
        self.assertEqual(self.calls()[0]["args"][2], "7")

    def test_find_twin_by_marker(self):
        self.assertEqual(json.loads(self.run_script("find-twin").stdout), {})
        self.add_twin()
        self.assertEqual(json.loads(self.run_script("find-twin").stdout)["number"], 42)
        # #70's marker must not match #7.
        self.assertEqual(json.loads(self.run_script("find-twin", issue="70").stdout)["number"], 6)

    def test_create_refused_when_twin_exists(self):
        self.add_twin()
        self.assert_refused("skills-create", "--title", "x", "--body-file", self.good_body())

    def test_twin_body_must_carry_marker_and_link(self):
        no_marker = self.body("Mirrored from https://github.com/tedeuxx/mhw/issues/7\n")
        self.assert_refused("skills-create", "--title", "x", "--body-file", no_marker)
        no_link = self.body("<!-- mhw-issue: tedeuxx/mhw#7 -->\n", "c.md")
        self.assert_refused("skills-create", "--title", "x", "--body-file", no_link)
        wrong = self.body("<!-- mhw-issue: tedeuxx/mhw#70 -->\nhttps://github.com/tedeuxx/mhw/issues/70\n", "d.md")
        self.assert_refused("skills-create", "--title", "x", "--body-file", wrong)

    def test_body_file_must_be_under_the_sync_dir(self):
        outside = os.path.join(self.tmp, "outside.md")
        with open(outside, "w") as fh:
            fh.write("<!-- mhw-issue: tedeuxx/mhw#7 -->\nhttps://github.com/tedeuxx/mhw/issues/7\n")
        self.assert_refused("skills-create", "--title", "x", "--body-file", outside)
        traversal = os.path.join(self.sync, "..", "outside.md")
        self.assert_refused("skills-create", "--title", "x", "--body-file", traversal)
        link = os.path.join(self.sync, "link.md")
        os.symlink(outside, link)
        self.assert_refused("skills-create", "--title", "x", "--body-file", link)
        self.assert_refused("skills-create", "--title", "x", "--body-file", "-")

    def test_credentials_are_refused(self):
        for i, leak in enumerate(("ghs_" + "a" * 36, "github_pat_" + "b" * 30, "sk-ant-" + "c" * 20,
                                  "-" * 5 + "BEGIN RSA " + "PRIVATE KEY" + "-" * 5, "AKIA" + "D" * 16)):
            path = self.body("<!-- mhw-issue: tedeuxx/mhw#7 -->\nhttps://github.com/tedeuxx/mhw/issues/7\n%s\n"
                             % leak, "leak%d.md" % i)
            self.assert_refused("skills-create", "--title", "x", "--body-file", path)
        self.assert_refused("skills-create", "--title", "ghp_" + "e" * 36, "--body-file", self.good_body())

    def test_writes_only_to_the_twin(self):
        self.add_twin()
        self.assert_refused("skills-edit", "5", "--body-file", self.good_body())
        self.assert_refused("skills-comment", "6", "--body-file", self.body("hi", "h.md"))
        self.assert_refused("skills-view", "5")
        proc = self.run_script("skills-edit", "42", "--title", "[mhw#7] T", "--body-file", self.good_body("e.md"))
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertEqual(self.writes()[-1]["args"][:3], ["issue", "edit", "42"])

    def test_unknown_commands_and_flags_are_refused(self):
        self.add_twin()
        self.assertEqual(self.run_script("issue", "delete", "42").returncode, 2)
        self.assert_refused("skills-edit", "42", "--add-label", "x")
        self.assert_refused("skills-create", "--title", "x", "--body", "inline")
        self.assert_refused("skills-close", "42", "--comment", "x")
        self.assert_refused("mhw-view", issue="7; rm")
        self.assertEqual(self.writes(), [])

    def test_state_mirrors_the_mhw_issue(self):
        self.add_twin()
        self.assert_refused("skills-close", "42")   # the mhw Issue is open
        self.assertEqual(self.run_script("skills-reopen", "42").returncode, 0)
        self.set_state(mhw_state="CLOSED", skills=[])
        self.add_twin()
        self.assert_refused("skills-reopen", "42")  # the mhw Issue is closed
        self.assertEqual(self.run_script("skills-close", "42").returncode, 0)
        self.assertEqual(self.writes()[-1]["args"], ["issue", "close", "42", "--repo", "tedeuxx/tadeumendonca-skills"])

    def test_backlink_once(self):
        proc = self.run_script("backlink")   # no twin: red, nothing posted, no link claimed
        self.assertEqual(proc.returncode, 1, proc.stdout + proc.stderr)
        self.assertIn("FAIL", proc.stdout)
        self.assertIn("nothing was linked", proc.stdout)
        self.assertEqual(self.writes(), [])
        self.add_twin()
        self.assertEqual(self.run_script("backlink").returncode, 0)
        self.assertEqual(self.run_script("backlink").returncode, 0)
        posted = [c for c in self.writes() if c["args"][:2] == ["issue", "comment"]]
        self.assertEqual(len(posted), 1, "the back-link is posted once")
        self.assertEqual(posted[0]["token"], "MHW_TOKEN")
        self.assertEqual(posted[0]["args"][2:5], ["7", "--repo", "tedeuxx/mhw"])
        with open(self.state) as fh:
            body = json.load(fh)["mhw_comments"][0]["body"]
        self.assertIn("<!-- mhw-twin: tedeuxx/tadeumendonca-skills#42 -->", body)
        self.assertIn("u42", body)

    def test_twin_must_be_app_authored(self):
        self.add_twin(number=43, author="outsider")
        proc = self.run_script("find-twin")
        self.assertEqual(json.loads(proc.stdout), {}, "a marked Issue by anyone else is not the twin")
        self.assertIn("::warning::ignored #43", proc.stderr)
        self.assert_refused("skills-edit", "43", "--body-file", self.good_body())
        self.assert_refused("skills-close", "43")
        self.add_twin()
        self.assertEqual(json.loads(self.run_script("find-twin").stdout)["number"], 42)
        self.assertEqual(self.run_script("backlink").returncode, 0)
        posted = [c for c in self.writes() if c["args"][:2] == ["issue", "comment"]]
        with open(self.state) as fh:
            self.assertIn("tadeumendonca-skills#42", json.load(fh)["mhw_comments"][0]["body"])
        self.assertEqual(len(posted), 1)

    def test_two_app_authored_twins_are_refused(self):
        self.add_twin()
        self.add_twin(number=44)
        proc = self.assert_refused("find-twin")
        self.assertIn("#42, #44", proc.stderr)
        self.assert_refused("skills-edit", "42", "--body-file", self.good_body())

    def test_body_size_cap(self):
        big = self.body("<!-- mhw-issue: tedeuxx/mhw#7 -->\nhttps://github.com/tedeuxx/mhw/issues/7\n"
                        + "x" * 60001, "big.md")
        self.assert_refused("skills-create", "--title", "x", "--body-file", big)

    def test_body_file_must_be_a_regular_file(self):
        os.mkdir(os.path.join(self.sync, "dir.md"))
        self.assert_refused("skills-create", "--title", "x", "--body-file", os.path.join(self.sync, "dir.md"))

    def test_title_is_one_line(self):
        self.assert_refused("skills-create", "--title", "a\nb", "--body-file", self.good_body())
        self.assert_refused("skills-create", "--title", "a\rb", "--body-file", self.good_body())
        self.assert_refused("skills-create", "--title", "x" * 257, "--body-file", self.good_body())

    def test_token_runs_are_refused_and_never_printed(self):
        held = "Zq7" * 20
        for name in ("MHW_SKILLS_TOKEN", "CLAUDE_CODE_OAUTH_TOKEN", "GITHUB_TOKEN"):
            path = self.body("<!-- mhw-issue: tedeuxx/mhw#7 -->\nhttps://github.com/tedeuxx/mhw/issues/7\n"
                             "see %s\n" % held[5:17], "t-%s.md" % name)
            proc = self.assert_refused("skills-create", "--title", "x", "--body-file", path,
                                       extra_env={name: held})
            self.assertNotIn(held[5:17], proc.stdout + proc.stderr)
            proc = self.assert_refused("skills-create", "--title", "t " + held[30:42],
                                       "--body-file", self.good_body(), extra_env={name: held})
        # 11 characters of a token are not a match.
        path = self.body("<!-- mhw-issue: tedeuxx/mhw#7 -->\nhttps://github.com/tedeuxx/mhw/issues/7\n"
                         "see %s\n" % held[5:16], "t-short.md")
        proc = self.run_script("skills-create", "--title", "x", "--body-file", path,
                               extra_env={"MHW_SKILLS_TOKEN": held})
        self.assertEqual(proc.returncode, 0, proc.stderr)

    def test_refusals_do_not_echo_argument_values(self):
        self.add_twin()
        for args in (("skills-edit", "42", "--sekrit-flag", "VALUE-XYZ"),
                     ("skills-view", "NUM-XYZ"),
                     ("skills-view", "77777")):
            proc = self.assert_refused(*args)
            for value in ("sekrit", "VALUE-XYZ", "NUM-XYZ", "77777"):
                self.assertNotIn(value, proc.stderr)

    def test_backlink_counts_only_comments_by_github_actions(self):
        self.set_state(mhw_state="OPEN", skills=[], comments=[
            {"body": "<!-- mhw-twin: tedeuxx/tadeumendonca-skills#1 -->", "author": {"login": "outsider"}}])
        self.add_twin()
        self.assertEqual(self.run_script("backlink").returncode, 0)
        self.assertEqual(len([c for c in self.writes() if c["args"][:2] == ["issue", "comment"]]), 1,
                         "a marker in someone else's comment does not suppress the back-link")
        self.assertEqual(self.run_script("backlink").returncode, 0)
        self.assertEqual(len([c for c in self.writes() if c["args"][:2] == ["issue", "comment"]]), 1)

    def test_verify(self):
        proc = self.run_script("verify")
        self.assertEqual(proc.returncode, 1)           # no twin
        self.add_twin(state="CLOSED")
        proc = self.run_script("verify")
        self.assertEqual(proc.returncode, 1)           # the mhw Issue is open, the twin closed
        self.assertIn("FAIL", proc.stdout)
        self.set_state(mhw_state="OPEN", skills=[])
        self.add_twin(state="OPEN")
        proc = self.run_script("verify")
        self.assertEqual(proc.returncode, 0, proc.stdout + proc.stderr)
        self.assertIn("PASS", proc.stdout)
        self.assertEqual(self.writes(), [])

    def test_token_values_never_printed(self):
        self.add_twin()
        outs = [self.run_script(*a) for a in (("mhw-view",), ("find-twin",), ("skills-view", "42"), ("backlink",),
                                               ("skills-edit", "9"))]
        for p in outs:
            for value in ("tok-mhw", "tok-skills", "tok-other"):
                self.assertNotIn(value, p.stdout + p.stderr)


if __name__ == "__main__":
    unittest.main(verbosity=1)
