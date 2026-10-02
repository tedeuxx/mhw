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
                       {"name": "semver-label", "conclusion": "SUCCESS"}]}
        self.release = {"tag_name": "v1.2.0", "draft": False, "prerelease": False,
                        "published_at": "2026-10-02T00:00:00Z"}

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

    def test_new_release_with_ancestry_passes(self):
        d.release_matches(self.release, "1.1.0", {"status": "ahead"})

    def test_intake_does_not_restart_on_resume_or_compaction(self):
        for source in ("startup", "clear", "resume", "compact", "fork"):
            result = subprocess.run([sys.executable, "-B", str(d.ROOT / "workspace/startup.py")],
                                    input=json.dumps({"source": source}), text=True, capture_output=True)
            self.assertEqual(result.returncode, 0)
            self.assertEqual(bool(result.stdout.strip()), source in ("startup", "clear"))

    def test_old_draft_prerelease_and_unrelated_release_block(self):
        for changes in ({"tag_name": "v1.1.0"}, {"tag_name": "v1.2.0-rc.1"},
                        {"draft": True}, {"prerelease": True}, {"published_at": None}):
            with self.subTest(changes=changes), self.assertRaises(d.Pending):
                d.release_matches(dict(self.release, **changes), "1.1.0", {"status": "ahead"})
        with self.assertRaises(d.Pending):
            d.release_matches(self.release, "1.1.0", {"status": "diverged"})


if __name__ == "__main__":
    unittest.main(verbosity=2)
