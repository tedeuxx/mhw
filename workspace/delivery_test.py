#!/usr/bin/env python3
"""Synthetic negative and positive gates, no network and no writes."""
import unittest
import json
import subprocess
import sys
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

    def test_intake_does_not_restart_on_resume_or_compaction(self):
        for source in ("startup", "clear", "resume", "compact", "fork"):
            result = subprocess.run([sys.executable, "-B", str(d.ROOT / "workspace/startup.py")],
                                    input=json.dumps({"source": source}), text=True, capture_output=True)
            self.assertEqual(result.returncode, 0)
            self.assertEqual(bool(result.stdout.strip()), source in ("startup", "clear"))

    def test_declared_type_is_accepted_and_picker_is_the_fallback(self):
        policy = json.loads((d.ROOT / "workspace/session-policy.json").read_text())
        self.assertEqual(policy["entry_declared_in_first_prompt"], "accept")
        result = subprocess.run([sys.executable, "-B", str(d.ROOT / "workspace/startup.py")],
                                input=json.dumps({"source": "startup"}), text=True, capture_output=True)
        context = json.loads(result.stdout)["hookSpecificOutput"]["additionalContext"]
        for phrase in ("explicitly declares the session type", "ask no picker",
                       "Never infer a type", "Only when no type is declared",
                       "header 'Session type', labels 'Melhoria de harness' and 'Bugfix', in that order"):
            self.assertIn(phrase, context)
        # Every carrier of the contract states the same rule, so no harness keeps the old one.
        for carrier in ("AGENTS.md", "CLAUDE.md", "global/AGENTS.md", "workspace/README.md",
                        ".claude/commands/session-start.md", ".kiro/steering/workspace-session.md",
                        ".agents/skills/source-command-session-start/SKILL.md"):
            text = " ".join((d.ROOT / carrier).read_text().split())
            with self.subTest(carrier=carrier):
                self.assertRegex(text, r"(?i)declare[sd]? (the type )?explicitly|declares it there explicitly")
                self.assertRegex(text, r"(?i)only when (no type is|none is)|no selected or declared type")

    def test_old_draft_prerelease_and_unrelated_release_block(self):
        for changes in ({"tag_name": "v1.1.0"}, {"tag_name": "v1.2.0-rc.1"},
                        {"draft": True}, {"prerelease": True}, {"published_at": None}):
            with self.subTest(changes=changes), self.assertRaises(d.Pending):
                d.release_matches(dict(self.release, **changes), "1.1.0", {"status": "ahead"})
        with self.assertRaises(d.Pending):
            d.release_matches(self.release, "1.1.0", {"status": "diverged"})


if __name__ == "__main__":
    unittest.main(verbosity=2)
