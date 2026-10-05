#!/usr/bin/env python3
"""Synthetic negative and positive gates, no network and no writes."""
import contextlib
import io
import unittest
import json
from unittest import mock
import delivery as d


TESTS_RUN = [{"name": n, "workflowName": "tests", "conclusion": "SUCCESS"} for n in (
    "shellcheck", "profiles (ubuntu-latest)", "profiles (macos-latest)", "profiles (windows-latest)",
    "suites (ubuntu-latest)", "suites (macos-latest)", "windows (powershell)", "windows (pwsh)")]


class DeliveryTests(unittest.TestCase):
    def setUp(self):
        # The release candidate: rc/next -> main.
        self.pr = {"headRefOid": "a" * 40, "baseRefName": "main", "headRefName": "rc/next",
                   "isCrossRepository": False, "mergeStateStatus": "CLEAN",
                   "labels": [{"name": "semver:minor"}], "statusCheckRollup": TESTS_RUN + [
                       {"name": "delivery-ci", "workflowName": "tests", "conclusion": "SUCCESS"},
                       {"name": "semver-label", "workflowName": "semver-label", "conclusion": "SUCCESS"},
                       {"name": "SonarCloud Code Analysis", "conclusion": "SUCCESS"}]}
        # A slice: feature branch -> rc/next. semver-label never runs there.
        self.slice = dict(self.pr, baseRefName="rc/next", headRefName="feat/x", statusCheckRollup=[
            c for c in self.pr["statusCheckRollup"] if c["name"] != "semver-label"])
        self.release = {"tag_name": "v1.2.0", "draft": False, "prerelease": False,
                        "published_at": "2026-10-02T00:00:00Z"}

    def test_merge_is_a_real_merge_commit_never_squash(self):
        argv = d.merge_command(82, "o/r", "a" * 40)
        self.assertEqual(argv[:4], ("gh", "pr", "merge", "82"))
        self.assertIn("--merge", argv)
        for banned in ("--squash", "-s", "--rebase", "-r", "--auto", "--admin"):
            self.assertNotIn(banned, argv)
        self.assertEqual(argv[argv.index("--match-head-commit") + 1], "a" * 40)
        # The merge route in main() must go through merge_command, not a second spelling.
        with open(d.__file__, encoding="utf-8") as source:
            text = source.read()
        self.assertEqual(text.count('"gh", "pr", "merge"'), 1)
        self.assertNotIn('"--squash"', text)

    def test_good_exact_head_and_required_checks(self):
        d.pr_matches(self.pr, "a" * 40)
        d.checks_pass(self.pr)

    def test_stale_head_fork_wrong_base_and_labels_block(self):
        for changes in ({"headRefOid": "b" * 40}, {"isCrossRepository": True},
                        {"baseRefName": "other"}, {"labels": []},
                        {"labels": [{"name": "semver:minor"}, {"name": "semver:patch"}]}):
            with self.subTest(changes=changes), self.assertRaises(d.Pending):
                d.pr_matches(dict(self.pr, **changes), "a" * 40)

    def test_missing_failed_and_pending_checks_block(self):
        for checks in ([], [{"name": "delivery-ci", "conclusion": "SUCCESS"}],
                       self.pr["statusCheckRollup"] + [{"name": "extra", "conclusion": "FAILURE"}],
                       self.pr["statusCheckRollup"] + [{"name": "extra", "conclusion": ""}]):
            with self.subTest(checks=checks), self.assertRaises(d.Pending):
                d.checks_pass(dict(self.pr, statusCheckRollup=checks))

    def test_only_the_latest_run_of_each_check_counts(self):
        old = {"name": "semver-label", "workflowName": "semver", "conclusion": "FAILURE",
               "startedAt": "2026-10-04T10:00:00Z", "completedAt": "2026-10-04T10:00:05Z"}
        new = dict(old, conclusion="SUCCESS", startedAt="2026-10-04T10:01:00Z",
                   completedAt="2026-10-04T10:01:05Z")
        others = [c for c in self.pr["statusCheckRollup"] if c["name"] != "semver-label"]
        for order in ([old, new], [new, old]):
            with self.subTest(order=[c["conclusion"] for c in order]):
                d.checks_pass(dict(self.pr, statusCheckRollup=others + order))
        # A newer failed or still-running re-run blocks, whatever the older run said.
        for later in (dict(new, startedAt="2026-10-04T10:02:00Z", conclusion="FAILURE"),
                      dict(new, startedAt="2026-10-04T10:02:00Z", completedAt=None, conclusion="")):
            with self.subTest(later=later["conclusion"]), self.assertRaises(d.Pending):
                d.checks_pass(dict(self.pr, statusCheckRollup=others + [new, later]))
        # The same job name in a different workflow is a different check, not a re-run.
        foreign = dict(old, workflowName="other", startedAt="2026-10-04T09:00:00Z")
        with self.assertRaises(d.Pending):
            d.checks_pass(dict(self.pr, statusCheckRollup=others + [new, foreign]))

    def test_slice_to_rc_next_passes_without_semver_label_check(self):
        d.pr_matches(self.slice, "a" * 40)
        d.checks_pass(self.slice)
        d.mergeable(self.slice)

    def test_slice_pr_to_main_is_refused(self):
        # Only the release candidate may target main; any other head branch is a slice going straight
        # to main, whatever its checks say.
        for head in ("feat/x", "main", "", None, "rc/nextx"):
            with self.subTest(head=head), self.assertRaises(d.Pending):
                d.pr_matches(dict(self.pr, headRefName=head), "a" * 40)
        # And rc/next or main can never be a slice's own head branch.
        for head in ("rc/next", "main"):
            with self.subTest(slice_head=head), self.assertRaises(d.Pending):
                d.pr_matches(dict(self.slice, headRefName=head), "a" * 40)

    def test_missing_tests_run_is_refused(self):
        # The "CLEAN but no tests ran" case: Sonar green, merge state clean, the tests workflow absent.
        sonar_only = [c for c in self.slice["statusCheckRollup"] if c["name"] == "SonarCloud Code Analysis"]
        # delivery-ci reported by something other than the tests workflow does not count either.
        foreign_ci = sonar_only + [{"name": "delivery-ci", "workflowName": "other", "conclusion": "SUCCESS"}]
        # delivery-ci present but one aggregated job never registered.
        partial = [c for c in self.slice["statusCheckRollup"] if not c["name"].startswith("windows")]
        for checks in (sonar_only, foreign_ci, partial):
            with self.subTest(n=len(checks)), self.assertRaises(d.Pending):
                d.checks_pass(dict(self.slice, statusCheckRollup=checks))
        self.assertEqual(d.tests_jobs(), ["shellcheck", "profiles", "suites", "windows"])

    def test_pending_tests_or_dirty_merge_state_is_refused(self):
        pending = self.slice["statusCheckRollup"] + [
            {"name": "shellcheck", "workflowName": "tests", "conclusion": "", "startedAt": "9"}]
        with self.assertRaises(d.Pending):
            d.checks_pass(dict(self.slice, statusCheckRollup=pending))
        for state in ("DIRTY", "BEHIND", "BLOCKED", "UNKNOWN", "UNSTABLE", None):
            with self.subTest(state=state), self.assertRaises(d.Pending):
                d.mergeable(dict(self.slice, mergeStateStatus=state))

    def drive(self, action, pr, branch):
        """Run main() against a synthetic git/gh; returns every command it issued and the API paths."""
        calls, paths = [], []
        view = dict(pr, number=7, url="https://example.invalid/pr/7", state="OPEN", mergeCommit=None)

        def run(*args):
            calls.append(args)
            table = {("git", "status", "--porcelain"): "", ("git", "rev-parse", "HEAD"): "a" * 40,
                     ("git", "remote", "get-url", "origin"): "https://github.com/o/r.git",
                     ("git", "branch", "--show-current"): branch}
            if args in table:
                return table[args]
            if args[:3] == ("gh", "pr", "view"):
                return json.dumps(view)
            if args[:3] == ("git", "ls-remote", "--heads"):
                return "a" * 40 + "\trefs/heads/" + branch
            if args[:3] == ("gh", "pr", "merge"):
                return ""
            raise AssertionError("unexpected command " + repr(args))

        def api(repo, path):
            paths.append(path)
            return {"behind_by": 0}

        with mock.patch.object(d, "run", run), mock.patch.object(d, "api", api), \
                mock.patch("sys.argv", ["delivery.py", action, "--pr", "7"]), \
                contextlib.redirect_stdout(io.StringIO()):
            d.main()
        return calls, paths

    def test_slice_merge_route_end_to_end_is_a_pinned_merge_commit(self):
        calls, paths = self.drive("merge", self.slice, "feat/x")
        merges = [c for c in calls if c[:3] == ("gh", "pr", "merge")]
        self.assertEqual(len(merges), 1)
        self.assertIn("--merge", merges[0])
        self.assertNotIn("--squash", merges[0])
        self.assertEqual(merges[0][merges[0].index("--match-head-commit") + 1], "a" * 40)
        self.assertEqual(paths, ["compare/rc/next..." + "a" * 40])

    def test_slice_to_main_end_to_end_never_merges(self):
        for branch in ("feat/x",):
            with self.assertRaises(d.Pending):
                self.drive("merge", dict(self.pr, headRefName=branch), branch)

    def test_main_still_requires_semver_label_check(self):
        no_label = [c for c in self.pr["statusCheckRollup"] if c["name"] != "semver-label"]
        with self.assertRaises(d.Pending):
            d.checks_pass(dict(self.pr, statusCheckRollup=no_label))

    def test_new_release_with_ancestry_passes(self):
        d.release_matches(self.release, "1.1.0", {"status": "ahead"})

    def test_no_session_type_intake_is_registered_anywhere(self):
        # Issue #60 (owner, 2026-10-05): the session-type intake is removed. No project hook may
        # register it again, and no brief carrier may ask for it.
        self.assertFalse((d.ROOT / "workspace/startup.py").exists())
        self.assertFalse((d.ROOT / ".claude/commands/session-start.md").exists())
        self.assertFalse((d.ROOT / ".agents/skills/source-command-session-start").exists())
        for hooks_file in (".claude/settings.json", ".claude/settings.local.json", ".codex/hooks.json"):
            path = d.ROOT / hooks_file
            if path.exists():
                with self.subTest(hooks_file=hooks_file):
                    hooks = json.loads(path.read_text()).get("hooks", {})
                    self.assertNotIn("SessionStart", hooks)
                    self.assertNotIn("startup.py", json.dumps(hooks))
        policy = json.loads((d.ROOT / "workspace/session-policy.json").read_text())
        self.assertFalse([k for k in policy if k.startswith("entry_")])
        self.assertEqual(policy["integration_branch"], "rc/next")
        self.assertEqual(policy["release_merge"], "owner")
        for carrier in ("AGENTS.md", "CLAUDE.md", "global/AGENTS.md", "workspace/README.md",
                        ".kiro/steering/workspace-session.md", ".claude/commands/session-finish.md",
                        ".agents/skills/source-command-session-finish/SKILL.md",
                        "overlay/AGENTS.md", "overlay/desktop-instructions.md"):
            text = " ".join((d.ROOT / carrier).read_text().split())
            with self.subTest(carrier=carrier):
                for phrase in ("Melhoria de harness", "Session type", "improvement session"):
                    self.assertNotIn(phrase, text)

    def test_carriers_state_who_merges(self):
        # Issue #60: agents merge slices into rc/next; only the release candidate waits for the owner.
        for carrier in ("AGENTS.md", "CLAUDE.md", "workspace/README.md",
                        ".kiro/steering/workspace-session.md", ".claude/commands/session-finish.md"):
            text = " ".join((d.ROOT / carrier).read_text().split())
            with self.subTest(carrier=carrier):
                self.assertIn("rc/next", text)
                self.assertRegex(text, r"(?i)owner")

    def test_old_draft_prerelease_and_unrelated_release_block(self):
        for changes in ({"tag_name": "v1.1.0"}, {"tag_name": "v1.2.0-rc.1"},
                        {"draft": True}, {"prerelease": True}, {"published_at": None}):
            with self.subTest(changes=changes), self.assertRaises(d.Pending):
                d.release_matches(dict(self.release, **changes), "1.1.0", {"status": "ahead"})
        with self.assertRaises(d.Pending):
            d.release_matches(self.release, "1.1.0", {"status": "diverged"})


if __name__ == "__main__":
    unittest.main(verbosity=2)
