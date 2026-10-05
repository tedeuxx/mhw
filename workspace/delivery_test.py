#!/usr/bin/env python3
"""Synthetic negative and positive gates, no network and no writes."""
import unittest
import json
import delivery as d


class DeliveryTests(unittest.TestCase):
    def setUp(self):
        self.pr = {"headRefOid": "a" * 40, "baseRefName": "main", "isCrossRepository": False,
                   "labels": [{"name": "semver:minor"}], "statusCheckRollup": [
                       {"name": "delivery-ci", "conclusion": "SUCCESS"},
                       {"name": "semver-label", "conclusion": "SUCCESS"},
                       {"name": "SonarCloud Code Analysis", "conclusion": "SUCCESS"}]}
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
