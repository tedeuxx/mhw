#!/usr/bin/env python3
"""Synthetic negative and positive gates, no network and no writes."""
import contextlib
import io
import unittest
import json
import re
from unittest import mock
import delivery as d


TESTS_RUN = [{"name": n, "workflowName": "tests", "conclusion": "SUCCESS"} for n in (
    "shellcheck", "profiles (ubuntu-latest)", "profiles (macos-latest)", "profiles (windows-latest)",
    "suites (ubuntu-latest)", "suites (macos-latest)", "windows (powershell)", "windows (pwsh)")]


HEAD = "a" * 40
OLD_HEAD = "b" * 40


def gate(head=HEAD, literal="APPROVE-AND-MERGE", author="OWNER", prose="\n\nverdict table"):
    return {"authorAssociation": author,
            "body": "<!-- gatekeeper-verdict: quality-assurance -->\n" + literal + "\nhead: " + head + prose}


def lens(commit=HEAD, closed=True, author="OWNER", fenced=False, state=None):
    state = state if state is not None else ("the lens is CLOSED" if closed else "the lens is OPEN")
    body = "<!-- harness-lead-verdict: probe -->\ncommit: " + commit + "\n" + state + "\n\nfindings"
    if fenced:
        body = "earlier round:\n```\n" + body + "\n```"
    return {"authorAssociation": author, "body": body}


def raw(body, author="OWNER"):
    return {"authorAssociation": author, "body": body}


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
        self.slice = dict(self.pr, baseRefName="rc/next", headRefName="feat/x", comments=[gate()],
                          statusCheckRollup=[c for c in self.pr["statusCheckRollup"]
                                             if c["name"] != "semver-label"])
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
        # Every job name present, but reported by another workflow: the tests workflow still never ran.
        renamed = [dict(c, workflowName="other") if c.get("workflowName") == "tests" else c
                   for c in self.slice["statusCheckRollup"]]
        for checks in (sonar_only, foreign_ci, partial, renamed):
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

    def drive(self, action, pr, branch, changed=("workspace/delivery.py",), remote_head=HEAD, behind=0):
        """Run main() against a synthetic git/gh; returns every command it issued and the API paths.

        self.calls keeps the commands even when main() raises, so a refusal can be shown to issue no merge.
        """
        calls, paths = [], []
        self.calls = calls
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
                return remote_head + "\trefs/heads/" + branch
            if args[:3] == ("gh", "pr", "merge") or args[:2] == ("git", "fetch"):
                return ""
            if args[:2] == ("git", "diff"):
                return "\n".join(changed)
            raise AssertionError("unexpected command " + repr(args))

        def api(repo, path):
            paths.append(path)
            return {"behind_by": behind}

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

    def merged(self, calls):
        return [c for c in calls if c[:3] == ("gh", "pr", "merge")]

    def test_slice_without_a_verdict_is_refused(self):
        for comments in ([], [gate(author="NONE")], [lens()]):
            with self.subTest(n=len(comments)), self.assertRaises(d.Pending):
                self.drive("merge", dict(self.slice, comments=comments), "feat/x")

    def test_slice_verdict_for_an_older_head_or_not_approving_is_refused(self):
        for comments in ([gate(head=OLD_HEAD)], [gate(), gate(head=OLD_HEAD)],
                         [gate(literal="REQUEST-CHANGES")], [gate(literal="APPROVE-PENDING-HUMAN")],
                         [gate(), gate(literal="REQUEST-CHANGES")]):
            with self.subTest(comments=[c["body"][46:80] for c in comments]), self.assertRaises(d.Pending):
                self.drive("merge", dict(self.slice, comments=comments), "feat/x")

    def test_slice_on_harness_paths_needs_the_closed_lens_at_head(self):
        harness = ("workspace/delivery.py", ".agents/skills/x/SKILL.md")
        for comments in ([gate()], [gate(), lens(commit=OLD_HEAD)], [gate(), lens(closed=False)],
                         [gate(), lens(fenced=True)], [gate(), lens(author="NONE")],
                         [gate(), lens(), lens(closed=False)], [gate(), lens(commit=HEAD[:12])]):
            with self.subTest(n=len(comments)), self.assertRaises(d.Pending):
                self.drive("merge", dict(self.slice, comments=comments), "feat/x", changed=harness)
        calls, _ = self.drive("merge", dict(self.slice, comments=[gate(), lens()]), "feat/x", changed=harness)
        self.assertEqual(len(self.merged(calls)), 1)
        for path in ("AGENTS.md", "docs/CLAUDE.md", ".github/workflows/tests.yml", ".claude/x.md",
                     ".codex/hooks.json", ".kiro/steering/a.md"):
            self.assertTrue(d.harness_paths([path]), path)
        self.assertFalse(d.harness_paths(["workspace/delivery.py", "docs/adr/0001-x.md", "global/a.sh",
                                          "docs/CLAUDE.md.bak", "x.claude/a", "AGENTS.mdx", ".claude"]))

    def test_plugin_brief_shapes_against_this_repository_contract(self):
        # The plugin's agents-lead brief fixes lines 1-2 only, then a blank line and the scenarios; it
        # asks for "the lens is CLOSED" in those words at no fixed position. Such a marker is REFUSED
        # here: line 3 is this repository's contract, not the plugin's. Fail closed, by design.
        plugin_lens = ("<!-- harness-lead-verdict: PR #93 rc/next route - nothing falsifiable-and-false remains -->\n"
                       "commit: " + HEAD + "\n"
                       "\n"
                       "Scenarios: none open.\n"
                       "\n"
                       "the lens is CLOSED")
        with self.assertRaises(d.Pending):
            d.lens_closed([raw(plugin_lens)], HEAD)
        # The same plugin lines 1-2 with this repository's line 3 are accepted.
        lines = plugin_lens.split("\n")
        d.lens_closed([raw("\n".join(lines[:2] + ["the lens is CLOSED"] + lines[2:5]))], HEAD)
        # The plugin's quality-assurance shape already pins lines 1-3, including its closes: line after.
        plugin_gate = ("<!-- gatekeeper-verdict: quality-assurance -->\n"
                       "APPROVE-AND-MERGE\n"
                       "head: " + HEAD + "\n"
                       "closes: 52\n"
                       "\n"
                       "| criterion | verdict |")
        d.gate_approves([raw(plugin_gate)], HEAD)

    def test_strict_header_spoofs_are_refused(self):
        marker = "<!-- harness-lead-verdict: x -->\ncommit: " + HEAD + "\nthe lens is CLOSED"
        verdict = "<!-- gatekeeper-verdict: quality-assurance -->\nAPPROVE-AND-MERGE\nhead: " + HEAD
        lens_spoofs = {
            # Lens round 2, finding 1: a ~~~ fence holding a ``` line, then a quoted marker.
            "mixed fences": raw("quoting round 1:\n~~~\n```\n" + marker + "\n~~~"),
            "plain fence": raw("```\n" + marker + "\n```"),
            "blockquote": raw("> " + marker.replace("\n", "\n> ")),
            "indented": raw("    " + marker.replace("\n", "\n    ")),
            "marker after a blank line": raw("\n" + marker),
            # Finding 2: CLOSED only as a whole line 3, never a substring.
            "negated": lens(state="I cannot say the lens is CLOSED yet"),
            "quoted": lens(state="> round 1 said: the lens is CLOSED"),
            "trailing text": lens(state="the lens is CLOSED."),
            "lower case": lens(state="the lens is closed"),
            "CLOSED below line 3": raw(marker.replace("the lens is CLOSED", "\nthe lens is CLOSED")),
            "envelope with trailing text": raw(marker.replace("x -->", "x --> extra")),
            "envelope closed early": raw(marker.replace("x -->", "x --> y -->")),
            "uppercase SHA": lens(commit=HEAD.upper()),
            "abbreviated SHA": lens(commit=HEAD[:12]),
            "commit with trailing text": lens(commit=HEAD + " (approx)"),
            "newer open marker withdraws a closed one": [lens(), lens(closed=False)],
            "newer malformed marker": [lens(), raw("<!-- harness-lead-verdict: x -->\ncommit: tbd")],
        }
        gate_spoofs = {
            # Finding 3: prose starting with a literal never overrides the literal on line 2.
            "prose approve under REQUEST-CHANGES": gate(literal="REQUEST-CHANGES",
                                                        prose="\nAPPROVE-AND-MERGE would be premature"),
            "literal with trailing prose": gate(literal="APPROVE-AND-MERGE would be premature"),
            "unknown literal": gate(literal="APPROVE"),
            "literal on line 4": raw(verdict.replace("\nAPPROVE-AND-MERGE\nhead: " + HEAD,
                                                     "\nhead: " + HEAD + "\nAPPROVE-AND-MERGE")),
            "one-line verdict": raw("<!-- gatekeeper-verdict: quality-assurance --> APPROVE-AND-MERGE\n"
                                    "head: " + HEAD),
            "quoted inside a fence": raw("see:\n```\n" + verdict + "\n```"),
            "blockquoted": raw("> " + verdict.replace("\n", "\n> ")),
            "head with trailing text": gate(head=HEAD + " (approx)"),
            "other persona envelope": raw(verdict.replace("quality-assurance", "developer")),
            "later REQUEST-CHANGES at the same head": [gate(), gate(literal="REQUEST-CHANGES")],
            "later malformed verdict": [gate(), raw("<!-- gatekeeper-verdict: quality-assurance -->\nTBD")],
        }
        for name, spoof in lens_spoofs.items():
            spoofs = spoof if isinstance(spoof, list) else [spoof]
            with self.subTest(lens=name), self.assertRaises(d.Pending):
                d.lens_closed(spoofs, HEAD)
        for name, spoof in gate_spoofs.items():
            spoofs = spoof if isinstance(spoof, list) else [spoof]
            with self.subTest(gate=name), self.assertRaises(d.Pending):
                d.gate_approves(spoofs, HEAD)
        # Calibration: the strict forms pass, CRLF bodies included, and a later approval at the head
        # supersedes an earlier refusal.
        d.lens_closed([raw(marker)], HEAD)
        d.lens_closed([raw(marker.replace("\n", "\r\n"))], HEAD)
        d.gate_approves([raw(verdict)], HEAD)
        d.gate_approves([raw(verdict.replace("\n", "\r\n"))], HEAD)
        d.gate_approves([gate(literal="REQUEST-CHANGES"), gate(literal="APPROVE-AND-MERGE-BOUNDARY")], HEAD)
        # A later comment that only QUOTES a marker is neither a verdict nor a withdrawal of one.
        quoting = raw("context:\n```\n" + verdict.replace("APPROVE-AND-MERGE", "REQUEST-CHANGES") + "\n"
                      + marker.replace("CLOSED", "OPEN") + "\n```")
        d.gate_approves([raw(verdict), quoting], HEAD)
        d.lens_closed([raw(marker), quoting], HEAD)

    def test_main_calls_every_gate_before_merging(self):
        # One gate fails at a time while every other passes; main() must refuse and never merge.
        harness = ("workspace/delivery.py", "AGENTS.md")
        no_ci = [c for c in self.slice["statusCheckRollup"] if c["name"] != "delivery-ci"]
        table = {
            "pr_matches (stale head)": (dict(self.slice, headRefOid=OLD_HEAD), {}),
            "checks_pass (delivery-ci missing)": (dict(self.slice, statusCheckRollup=no_ci), {}),
            "mergeable (DIRTY)": (dict(self.slice, mergeStateStatus="DIRTY"), {}),
            "review_gate (no QA verdict)": (dict(self.slice, comments=[]), {}),
            "review_gate (harness, no lens)": (self.slice, {"changed": harness}),
            "local branch is not the PR head": (self.slice, {"branch": "other"}),
            "head not pushed": (self.slice, {"remote_head": OLD_HEAD}),
            "behind rc/next": (self.slice, {"behind": 1}),
        }
        for name, (pr, knobs) in table.items():
            knobs = dict(knobs)
            branch = knobs.pop("branch", "feat/x")
            with self.subTest(gate=name):
                with self.assertRaises(d.Pending):
                    self.drive("merge", pr, branch, **knobs)
                self.assertEqual(self.merged(self.calls), [])
        # Calibration: with every gate passing, the same harness does merge.
        self.drive("merge", dict(self.slice, comments=[gate(), lens()]), "feat/x", changed=harness)
        self.assertEqual(len(self.merged(self.calls)), 1)

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

    def test_brief_declares_the_personal_sphere(self):
        # ADR-0035 decision 1: one sphere line above the first section, declaration only.
        brief = (d.ROOT / "AGENTS.md").read_text()
        head = brief.split("\n## ", 1)[0]
        self.assertEqual(re.findall(r"(?m)^sphere: .*$", brief), ["sphere: personal"])
        self.assertRegex(head, r"(?m)^sphere: personal$")
        self.assertIn("stop-on-undeclared default is not adopted", " ".join(head.split()))

    def test_carriers_state_who_merges(self):
        # Issue #60: agents merge slices into rc/next; only the release candidate waits for the owner.
        for carrier in ("AGENTS.md", "CLAUDE.md", "workspace/README.md",
                        ".kiro/steering/workspace-session.md", ".claude/commands/session-finish.md"):
            text = " ".join((d.ROOT / carrier).read_text().split())
            with self.subTest(carrier=carrier):
                self.assertIn("rc/next", text)
                self.assertRegex(text, r"(?i)owner")

    def test_finish_carriers_route_slices_through_the_gate(self):
        # Slices merge through delivery.py's rc/next gate; no carrier tells an agent to merge by hand.
        for carrier in (".claude/commands/session-finish.md",
                        ".agents/skills/source-command-session-finish/SKILL.md",
                        "workspace/README.md", "AGENTS.md"):
            text = " ".join((d.ROOT / carrier).read_text().split())
            with self.subTest(carrier=carrier):
                self.assertIn("python3 -B workspace/delivery.py merge --pr", text)
                self.assertNotIn("gh pr merge NUMBER", text)

    def test_old_draft_prerelease_and_unrelated_release_block(self):
        for changes in ({"tag_name": "v1.1.0"}, {"tag_name": "v1.2.0-rc.1"},
                        {"draft": True}, {"prerelease": True}, {"published_at": None}):
            with self.subTest(changes=changes), self.assertRaises(d.Pending):
                d.release_matches(dict(self.release, **changes), "1.1.0", {"status": "ahead"})
        with self.assertRaises(d.Pending):
            d.release_matches(self.release, "1.1.0", {"status": "diverged"})


if __name__ == "__main__":
    unittest.main(verbosity=2)
