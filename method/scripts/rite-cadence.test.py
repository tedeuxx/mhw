#!/usr/bin/env python3
"""Behavioural tests for rite-cadence.py (#128), in throwaway git repositories.

The calibration the Issue asks for, in order: a root holding only a README dates as never; adding a
FUNNEL-REVIEW-NOT-COLLECTED report still dates as never; adding a FUNNEL-REVIEW-RAN report dates by
that report's commit. The "never" results are not vacuous: the same root, asked with no marker,
returns a date, so git did read the root and the marker filter is what said never.
"""

import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[2]
SCRIPT = Path(__file__).resolve().with_name("rite-cadence.py")
RAN = "FUNNEL-REVIEW-RAN"
NOT_COLLECTED = "FUNNEL-REVIEW-NOT-COLLECTED"


class RiteCadenceTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        base = Path(self.tmp.name)
        self.repo = base / "repo"
        self.repo.mkdir()
        empty = base / "gitconfig"
        empty.write_text("", encoding="utf-8")
        self.env = dict(os.environ, GIT_CONFIG_NOSYSTEM="1", GIT_CONFIG_GLOBAL=str(empty),
                        GIT_AUTHOR_NAME="t", GIT_AUTHOR_EMAIL="t@example.invalid",
                        GIT_COMMITTER_NAME="t", GIT_COMMITTER_EMAIL="t@example.invalid")
        self.git("init", "-q")
        self.store = self.repo / "docs" / "funnel-review"
        self.store.mkdir(parents=True)

    def tearDown(self):
        self.tmp.cleanup()

    def git(self, *args, date=None):
        env = dict(self.env)
        if date:
            env["GIT_AUTHOR_DATE"] = env["GIT_COMMITTER_DATE"] = date + "T12:00:00+00:00"
        subprocess.run(["git", "-C", str(self.repo), *args], env=env, check=True, capture_output=True)

    def commit(self, name, text, date):
        (self.store / name).write_text(text, encoding="utf-8")
        self.git("add", "--", str(self.store / name))
        self.git("commit", "-q", "-m", "add " + name, date=date)

    def append(self, name, text, date):
        with open(self.store / name, "a", encoding="utf-8", newline="") as stream:
            stream.write(text)
        self.git("add", "--", str(self.store / name))
        self.git("commit", "-q", "-m", "edit " + name, date=date)

    def run_script(self, *args, cwd=None):
        return subprocess.run([sys.executable, "-B", str(SCRIPT), *args], cwd=cwd or str(self.repo),
                              env=self.env, capture_output=True, text=True)

    def assertNever(self, result):
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout, "docs/funnel-review: never landed a file carrying %s\n" % RAN)

    def test_calibration_readme_then_not_collected_then_ran(self):
        self.commit("README.md", "# The store\n\nReports land here.\n", "2026-01-01")
        self.assertNever(self.run_script("docs/funnel-review", RAN))
        unmarked = self.run_script("docs/funnel-review")
        self.assertEqual(unmarked.returncode, 0, unmarked.stderr)
        self.assertTrue(unmarked.stdout.startswith("docs/funnel-review: last changed 2026-01-01 ("),
                        unmarked.stdout)

        self.commit("sprint-01.md", "# sprint-01\n\n%s\n\nNothing was read.\n" % NOT_COLLECTED, "2026-02-02")
        self.assertNever(self.run_script("docs/funnel-review", RAN))
        unmarked = self.run_script("docs/funnel-review")
        self.assertTrue(unmarked.stdout.startswith("docs/funnel-review: last changed 2026-02-02 ("),
                        unmarked.stdout)

        self.commit("sprint-02.md", "# sprint-02\n\n%s\n\n## Findings\n\nNone.\n" % RAN, "2026-03-03")
        ran = self.run_script("docs/funnel-review", RAN)
        self.assertEqual(ran.returncode, 0, ran.stderr)
        self.assertRegex(ran.stdout, r"^docs/funnel-review: last ran 2026-03-03 \([0-9a-f]+\), "
                                     r"dated by files carrying FUNNEL-REVIEW-RAN\n$")

    def test_a_later_scaffolding_commit_does_not_move_the_date(self):
        self.commit("sprint-02.md", "%s\n" % RAN, "2026-03-03")
        self.commit("README.md", "# The store\n", "2026-04-04")
        self.commit("sprint-03.md", "%s\n" % NOT_COLLECTED, "2026-05-05")
        self.assertIn("last ran 2026-03-03 (", self.run_script("docs/funnel-review", RAN).stdout)
        self.assertIn("last changed 2026-05-05 (", self.run_script("docs/funnel-review").stdout)

    def test_the_marker_must_be_a_whole_line(self):
        self.commit("README.md", "A ran report prints %s at column 0.\n  %s\n%s-NOT\n" % (RAN, RAN, RAN),
                    "2026-01-01")
        self.assertNever(self.run_script("docs/funnel-review", RAN))

    def test_a_crlf_report_counts(self):
        self.commit("sprint-02.md", "# sprint-02\r\n%s\r\n" % RAN, "2026-03-03")
        self.assertIn("last ran 2026-03-03 (", self.run_script("docs/funnel-review", RAN).stdout)

    def test_an_untracked_or_uncommitted_ran_report_is_not_dated(self):
        self.commit("README.md", "# The store\n", "2026-01-01")
        (self.store / "sprint-02.md").write_text("%s\n" % RAN, encoding="utf-8")
        self.assertNever(self.run_script("docs/funnel-review", RAN))
        self.git("add", "--", str(self.store / "sprint-02.md"))
        self.assertNever(self.run_script("docs/funnel-review", RAN))

    def test_a_file_outside_the_root_is_not_dated(self):
        (self.repo / "other.md").write_text("%s\n" % RAN, encoding="utf-8")
        self.git("add", "other.md")
        self.git("commit", "-q", "-m", "outside", date="2026-03-03")
        self.commit("README.md", "# The store\n", "2026-01-01")
        self.assertNever(self.run_script("docs/funnel-review", RAN))

    def test_an_empty_root_is_never(self):
        self.commit("README.md", "x\n", "2026-01-01")
        result = self.run_script("docs/nothing-here", RAN)
        self.assertEqual(result.stdout, "docs/nothing-here: never landed a file carrying %s\n" % RAN)
        self.assertEqual(self.run_script("docs/nothing-here").stdout, "docs/nothing-here: never changed\n")

    def test_runs_from_a_subdirectory_with_repo(self):
        self.commit("sprint-02.md", "%s\n" % RAN, "2026-03-03")
        result = self.run_script("--repo", str(self.store), "docs/funnel-review", RAN, cwd=self.tmp.name)
        self.assertIn("last ran 2026-03-03 (", result.stdout, result.stderr)

    def test_git_failure_is_an_error_not_never(self):
        outside = Path(self.tmp.name) / "not-a-repo"
        outside.mkdir()
        env = dict(self.env, GIT_CEILING_DIRECTORIES=self.tmp.name)
        result = subprocess.run([sys.executable, "-B", str(SCRIPT), "--repo", str(outside),
                                 "docs/funnel-review", RAN], env=env, capture_output=True, text=True)
        self.assertEqual(result.returncode, 1)
        self.assertEqual(result.stdout, "")
        self.assertIn("rite-cadence: git rev-parse failed", result.stderr)

    def test_a_ruled_line_written_at_planning_does_not_move_the_date(self):
        # /sprint-planning writes one Ruled: line under each open candidate of a RAN report.
        self.commit("sprint-02.md", "# sprint-02\n\n%s\n\nCandidate rule: x\n" % RAN, "2026-10-10")
        self.append("sprint-02.md", "Ruled: not adopted at /sprint-planning sprint-06\n", "2026-10-24")
        self.assertIn("last ran 2026-10-10 (", self.run_script("docs/funnel-review", RAN).stdout)
        self.assertIn("last changed 2026-10-24 (", self.run_script("docs/funnel-review").stdout)

    def test_a_marker_only_in_the_working_copy_of_a_committed_file_is_not_dated(self):
        self.commit("old.md", "plain\n", "2026-02-02")
        (self.store / "old.md").write_text("%s\n" % RAN, encoding="utf-8")
        self.assertNever(self.run_script("docs/funnel-review", RAN))
        self.git("add", "--", str(self.store / "old.md"))
        self.assertNever(self.run_script("docs/funnel-review", RAN))

    def test_a_report_that_loses_and_regains_the_marker_is_dated_by_the_regain(self):
        self.commit("sprint-02.md", "%s\n" % RAN, "2026-03-03")
        self.commit("sprint-02.md", "withdrawn\n", "2026-04-04")
        self.assertNever(self.run_script("docs/funnel-review", RAN))
        self.commit("sprint-02.md", "%s\n" % RAN, "2026-05-05")
        self.assertIn("last ran 2026-05-05 (", self.run_script("docs/funnel-review", RAN).stdout)

    def test_a_commit_that_only_removes_a_marker_line_does_not_date(self):
        self.commit("sprint-02.md", "%s\nbody\n%s\n" % (RAN, RAN), "2026-03-03")
        self.commit("sprint-02.md", "%s\nbody\n" % RAN, "2026-04-04")
        self.assertIn("last ran 2026-03-03 (", self.run_script("docs/funnel-review", RAN).stdout)

    def test_a_glob_character_in_a_marked_name_is_taken_literally(self):
        self.commit("[ab].md", "%s\n" % RAN, "2026-01-20")
        # a.md matches the pattern [ab].md; it once carried the marker and no longer does.
        self.commit("a.md", "%s\n" % RAN, "2026-07-07")
        self.commit("a.md", "plain\n", "2026-08-08")
        self.assertIn("last ran 2026-01-20 (", self.run_script("docs/funnel-review", RAN).stdout)

    def test_the_date_is_the_committer_date_in_iso_form(self):
        (self.store / "sprint-02.md").write_text("%s\n" % RAN, encoding="utf-8")
        self.git("add", "--", str(self.store / "sprint-02.md"))
        env = dict(self.env, GIT_AUTHOR_DATE="2026-01-01T12:00:00+00:00",
                   GIT_COMMITTER_DATE="2026-03-03T12:00:00+00:00")
        subprocess.run(["git", "-C", str(self.repo), "commit", "-q", "-m", "ran"], env=env, check=True,
                       capture_output=True)
        commit = subprocess.run(["git", "-C", str(self.repo), "rev-parse", "--short", "HEAD"],
                                env=self.env, check=True, capture_output=True, text=True).stdout.strip()
        self.assertEqual(self.run_script("docs/funnel-review", RAN).stdout,
                         "docs/funnel-review: last ran 2026-03-03 (%s), dated by files carrying %s\n"
                         % (commit, RAN))
        self.assertEqual(self.run_script("docs/funnel-review").stdout,
                         "docs/funnel-review: last changed 2026-03-03 (%s), no ran-marker declared\n"
                         % commit)

    @unittest.skipIf(os.name == "nt" or (hasattr(os, "geteuid") and os.geteuid() == 0),
                     "file modes do not make a file unreadable here")
    def test_an_unreadable_file_does_not_count(self):
        self.commit("sprint-02.md", "%s\n" % RAN, "2026-03-03")
        target = self.store / "sprint-02.md"
        target.chmod(0)
        try:
            self.assertNever(self.run_script("docs/funnel-review", RAN))
        finally:
            target.chmod(0o600)

    def test_an_empty_marker_is_a_usage_error(self):
        result = self.run_script("docs/funnel-review", " ")
        self.assertEqual(result.returncode, 2)
        self.assertEqual(result.stdout, "")


class CheckThreeNamesTheScriptTest(unittest.TestCase):
    """Drift: session check 3 names this script the way rites name installed scripts, and the marker."""

    def test_check_three(self):
        text = (ROOT / "method" / "skills" / "agents-configuration" / "SKILL.md").read_text(encoding="utf-8")
        start = text.index("3. **The rite cadence.**")
        check = text[start:text.index("4. **Finished worktrees.**", start)]
        self.assertIn("{{method-scripts}}/rite-cadence.py", check)
        self.assertIn(RAN, check)
        self.assertIn("never landed a file carrying", check)


if __name__ == "__main__":
    unittest.main()
