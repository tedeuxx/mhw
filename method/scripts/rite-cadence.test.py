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

    def struck_command(self, root):
        """What the struck check-3 command printed, with the short commit the script also prints."""
        return subprocess.run(["git", "-C", str(self.repo), "log", "-1", "--format=%cs %h", "--", root],
                              env=self.env, check=True, capture_output=True, text=True).stdout.strip()

    def assertAsStruck(self, root):
        struck = self.struck_command(root)
        self.assertTrue(struck, "the fixture must give the struck command a date")
        date, _, commit = struck.partition(" ")
        result = self.run_script(root)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout, "%s: last changed %s (%s), no ran-marker declared\n"
                         % (root, date, commit))
        return date

    def short_head(self):
        return subprocess.run(["git", "-C", str(self.repo), "rev-parse", "--short", "HEAD"], env=self.env,
                              check=True, capture_output=True, text=True).stdout.strip()

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

    def test_a_run_is_dated_by_author_date_and_a_change_by_committer_date(self):
        # Author and committer dates differ: the marker path reads the author date, and the no-marker
        # path reads the committer date, as the struck `git log -1 --format=%cs -- <root>` did.
        (self.store / "sprint-02.md").write_text("%s\n" % RAN, encoding="utf-8")
        self.git("add", "--", str(self.store / "sprint-02.md"))
        env = dict(self.env, GIT_AUTHOR_DATE="2026-03-03T12:00:00+00:00",
                   GIT_COMMITTER_DATE="2026-01-01T12:00:00+00:00")
        subprocess.run(["git", "-C", str(self.repo), "commit", "-q", "-m", "ran"], env=env, check=True,
                       capture_output=True)
        commit = self.short_head()
        self.assertEqual(self.run_script("docs/funnel-review", RAN).stdout,
                         "docs/funnel-review: last ran 2026-03-03 (%s), dated by files carrying %s\n"
                         % (commit, RAN))
        self.assertEqual(self.run_script("docs/funnel-review").stdout,
                         "docs/funnel-review: last changed 2026-01-01 (%s), no ran-marker declared\n"
                         % commit)

    def test_rewriting_the_commit_later_does_not_move_the_date(self):
        # An amend (as a rebase or cherry-pick does) keeps the author date and sets a new committer date.
        self.commit("sprint-02.md", "%s\n" % RAN, "2026-03-03")
        env = dict(self.env, GIT_COMMITTER_DATE="2026-09-09T12:00:00+00:00")
        subprocess.run(["git", "-C", str(self.repo), "commit", "-q", "--amend", "--no-edit"], env=env,
                       check=True, capture_output=True)
        self.assertIn("last ran 2026-03-03 (%s)" % self.short_head(),
                      self.run_script("docs/funnel-review", RAN).stdout)

    def test_a_crlf_to_lf_normalisation_does_not_move_the_date(self):
        self.commit("sprint-02.md", "# sprint-02\r\n%s\r\nbody\r\n" % RAN, "2026-03-03")
        self.commit("sprint-02.md", "# sprint-02\n%s\nbody\n" % RAN, "2026-06-06")
        self.assertIn("last ran 2026-03-03 (", self.run_script("docs/funnel-review", RAN).stdout)

    def test_a_reorder_that_moves_the_marker_line_does_not_move_the_date(self):
        self.commit("sprint-02.md", "# sprint-02\n%s\n\nfirst\nsecond\n" % RAN, "2026-03-03")
        self.commit("sprint-02.md", "# sprint-02\n\nfirst\nsecond\n%s\n" % RAN, "2026-06-06")
        self.assertIn("last ran 2026-03-03 (", self.run_script("docs/funnel-review", RAN).stdout)

    def test_the_latest_date_wins_when_history_order_differs(self):
        # The newer commit in history carries the older author date, so the first add found is wrong.
        self.commit("sprint-02.md", "%s\n" % RAN, "2026-05-05")
        self.commit("sprint-03.md", "%s\n" % RAN, "2026-02-02")
        self.assertIn("last ran 2026-05-05 (", self.run_script("docs/funnel-review", RAN).stdout)

    def test_each_file_of_a_commit_is_counted_on_its_own(self):
        # One commit removes a marker line from one report (which keeps another) and adds one to a
        # second report. Summed across files that is zero; per file the second report is a net add.
        self.commit("sprint-02.md", "%s\nbody\n%s\n" % (RAN, RAN), "2026-03-03")
        (self.store / "sprint-02.md").write_text("%s\nbody\n" % RAN, encoding="utf-8")
        (self.store / "sprint-03.md").write_text("%s\n" % RAN, encoding="utf-8")
        self.git("add", "--", str(self.store))
        self.git("commit", "-q", "-m", "both", date="2026-06-06")
        self.assertIn("last ran 2026-06-06 (", self.run_script("docs/funnel-review", RAN).stdout)

    def test_a_withdrawn_marker_restored_only_in_the_working_copy_or_index_is_not_dated(self):
        self.commit("sprint-02.md", "%s\n" % RAN, "2026-03-03")
        self.commit("sprint-02.md", "withdrawn\n", "2026-04-04")
        self.assertNever(self.run_script("docs/funnel-review", RAN))
        (self.store / "sprint-02.md").write_text("%s\n" % RAN, encoding="utf-8")
        self.assertNever(self.run_script("docs/funnel-review", RAN))
        self.git("add", "--", str(self.store / "sprint-02.md"))
        self.assertNever(self.run_script("docs/funnel-review", RAN))

    def test_a_committed_marker_deleted_only_in_the_working_copy_is_still_dated(self):
        self.commit("sprint-02.md", "%s\n" % RAN, "2026-03-03")
        (self.store / "sprint-02.md").write_text("withdrawn\n", encoding="utf-8")
        self.assertIn("last ran 2026-03-03 (", self.run_script("docs/funnel-review", RAN).stdout)
        (self.store / "sprint-02.md").unlink()
        self.assertIn("last ran 2026-03-03 (", self.run_script("docs/funnel-review", RAN).stdout)

    def test_a_repository_with_no_commit_is_never(self):
        (self.store / "sprint-02.md").write_text("%s\n" % RAN, encoding="utf-8")
        self.git("add", "--", str(self.store / "sprint-02.md"))
        self.assertNever(self.run_script("docs/funnel-review", RAN))

    def test_a_dangling_head_is_a_git_failure_not_never(self):
        self.commit("sprint-02.md", "%s\n" % RAN, "2026-03-03")
        ref = subprocess.run(["git", "-C", str(self.repo), "symbolic-ref", "HEAD"], env=self.env,
                             check=True, capture_output=True, text=True).stdout.strip()
        ref_file = self.repo / ".git" / ref
        self.assertTrue(ref_file.is_file(), "the fixture needs a loose branch ref to overwrite")
        ref_file.write_text("1" * 40 + "\n", encoding="utf-8")
        for args in (("docs/funnel-review", RAN), ("docs/funnel-review",)):
            result = self.run_script(*args)
            self.assertEqual(result.returncode, 1, (args, result.stdout, result.stderr))
            self.assertEqual(result.stdout, "", args)
            self.assertEqual(result.stderr, "rite-cadence: HEAD names no readable commit\n", args)

    @unittest.skipIf(os.name == "nt" or (hasattr(os, "geteuid") and os.geteuid() == 0),
                     "file modes do not make a file unreadable here")
    def test_an_unreadable_working_copy_does_not_hide_a_committed_run(self):
        self.commit("sprint-02.md", "%s\n" % RAN, "2026-03-03")
        target = self.store / "sprint-02.md"
        target.chmod(0)
        try:
            self.assertIn("last ran 2026-03-03 (", self.run_script("docs/funnel-review", RAN).stdout)
        finally:
            target.chmod(0o600)

    def test_an_option_like_value_is_a_literal_path_and_never_a_git_option(self):
        # No argument reaches git's command line, so after "--" a root spelled like an option is the
        # path of that name. Had "--output=x" reached `git log` as an option it would write a file x.
        odd = self.repo / "--output=x"
        odd.mkdir()
        (odd / "r.md").write_text("%s\n-%s\n" % (RAN, RAN), encoding="utf-8")
        self.git("add", "--", str(odd / "r.md"))
        self.git("commit", "-q", "-m", "odd", date="2026-03-03")
        result = self.run_script("--", "--output=x", RAN)
        self.assertEqual(result.stdout, "--output=x: last ran 2026-03-03 (%s), dated by files carrying %s\n"
                         % (self.short_head(), RAN), result.stderr)
        self.assertIn("--output=x: last changed 2026-03-03 (", self.run_script("--", "--output=x").stdout)
        self.assertIn("last ran 2026-03-03 (", self.run_script("--", "--output=x", "-" + RAN).stdout)
        self.assertEqual(self.run_script("--", "-p", RAN).stdout, "-p: never landed a file carrying %s\n" % RAN)
        self.assertFalse((self.repo / "x").exists())
        # Without "--" the parser refuses them as unknown options: a usage error.
        for argv in (["--output=x", RAN], ["-p", RAN], ["--repo", str(self.repo), "-r", RAN]):
            result = self.run_script(*argv)
            self.assertEqual(result.returncode, 2, argv)
            self.assertEqual(result.stdout, "", argv)
        # A repository spelled like an option is a directory of that name, and there is none here.
        result = self.run_script("--repo=-p", "docs/funnel-review", RAN)
        self.assertEqual(result.returncode, 1, result.stderr)
        self.assertEqual(result.stdout, "")
        self.assertIn("rite-cadence: not a directory: ", result.stderr)

    def test_a_root_that_is_not_a_repository_path_is_a_usage_error(self):
        self.commit("sprint-02.md", "%s\n" % RAN, "2026-03-03")
        for root in ("", "/docs/funnel-review", "../x", "docs/../.."):
            result = self.run_script("--", root, RAN)
            self.assertEqual(result.returncode, 2, (root, result.stderr))
            self.assertEqual(result.stdout, "", root)

    def test_no_marker_dates_a_rebased_commit_as_the_struck_command_did(self):
        # The newest commit by git log's order was authored 03-01 and committed 09-09; another was
        # authored 09-01. The struck command printed 09-09, the committer date of the first.
        self.commit("README.md", "x\n", "2026-01-01")
        self.commit("a.md", "a\n", "2026-09-01")
        (self.store / "b.md").write_text("b\n", encoding="utf-8")
        self.git("add", "--", str(self.store / "b.md"))
        env = dict(self.env, GIT_AUTHOR_DATE="2026-03-01T12:00:00+00:00",
                   GIT_COMMITTER_DATE="2026-09-09T12:00:00+00:00")
        subprocess.run(["git", "-C", str(self.repo), "commit", "-q", "-m", "rebased"], env=env, check=True,
                       capture_output=True)
        self.assertEqual(self.assertAsStruck("docs/funnel-review"), "2026-09-09")

    def test_no_marker_dates_a_deletion_as_the_struck_command_did(self):
        self.commit("README.md", "x\n", "2026-01-01")
        self.git("rm", "-q", "--", str(self.store / "README.md"))
        self.git("commit", "-q", "-m", "gone", date="2026-05-05")
        self.assertEqual(self.assertAsStruck("docs/funnel-review"), "2026-05-05")

    def test_no_marker_dates_the_first_commit_whatever_log_show_root_says(self):
        # With log.showRoot off, `git log` prints no file list for the first commit unless asked.
        self.git("config", "log.showRoot", "false")
        self.commit("README.md", "x\n", "2026-01-01")
        self.assertEqual(self.assertAsStruck("docs/funnel-review"), "2026-01-01")

    def test_no_marker_dates_a_file_only_a_merge_added_as_the_struck_command_did(self):
        (self.repo / "base.md").write_text("x\n", encoding="utf-8")
        self.git("add", "base.md")
        self.git("commit", "-q", "-m", "base", date="2026-01-01")
        self.git("checkout", "-q", "-b", "side")
        (self.repo / "side.md").write_text("s\n", encoding="utf-8")
        self.git("add", "side.md")
        self.git("commit", "-q", "-m", "side", date="2026-02-02")
        self.git("checkout", "-q", "-")
        (self.repo / "main.md").write_text("m\n", encoding="utf-8")
        self.git("add", "main.md")
        self.git("commit", "-q", "-m", "main", date="2026-03-03")
        self.git("merge", "-q", "--no-commit", "side")
        (self.store / "merged.md").write_text("only the merge adds this\n", encoding="utf-8")
        self.git("add", "--", str(self.store / "merged.md"))
        self.git("commit", "-q", "-m", "merge", date="2026-04-04")
        self.assertEqual(self.assertAsStruck("docs/funnel-review"), "2026-04-04")

    def test_no_marker_reads_a_glob_character_in_the_root_literally(self):
        # docs/f[q] as a pattern matches the sibling docs/fq and not itself; read literally it is
        # only itself. The sibling is changed later, so the two readings give different dates.
        for directory, text, date in (("f[q]", "a\n", "2026-01-01"), ("fq", "b\n", "2026-03-03")):
            path = self.repo / "docs" / directory / "a.md"
            path.parent.mkdir()
            path.write_text(text, encoding="utf-8")
            self.git("add", "--", str(path))
            self.git("commit", "-q", "-m", "add " + directory, date=date)
        self.assertIn("docs/f[q]: last changed 2026-01-01 (", self.run_script("docs/f[q]").stdout)

    def test_a_ran_report_merged_with_no_ff_is_dated_by_the_commit_that_authored_it(self):
        # Every slice into an integration branch lands this way. The merge's first-parent diff adds the
        # marker line too, and the merge is the newer author date, so reading it would date the merge.
        self.git("commit", "-q", "--allow-empty", "-m", "base", date="2026-01-01")
        self.git("checkout", "-q", "-b", "slice")
        self.commit("sprint-02.md", "%s\n" % RAN, "2026-03-03")
        authored = self.short_head()
        self.git("checkout", "-q", "-")
        self.git("commit", "-q", "--allow-empty", "-m", "trunk moves", date="2026-04-04")
        self.git("merge", "-q", "--no-ff", "--no-edit", "slice", date="2026-05-05")
        self.assertEqual(self.run_script("docs/funnel-review", RAN).stdout,
                         "docs/funnel-review: last ran 2026-03-03 (%s), dated by files carrying %s\n"
                         % (authored, RAN))

    def test_a_root_is_a_literal_path_matched_by_whole_components(self):
        self.commit("sprint-02.md", "%s\n" % RAN, "2026-03-03")
        for root in ("docs/*", "docs/funnel"):
            self.assertEqual(self.run_script(root, RAN).stdout,
                             "%s: never landed a file carrying %s\n" % (root, RAN))
            self.assertEqual(self.run_script(root).stdout, "%s: never changed\n" % root)
        if os.name != "nt":
            star = self.repo / "docs" / "*"
            star.mkdir()
            (star / "r.md").write_text("%s\n" % RAN, encoding="utf-8")
            self.git("add", "--", str(star / "r.md"))
            self.git("commit", "-q", "-m", "star", date="2026-06-06")
            self.assertIn("docs/*: last ran 2026-06-06 (", self.run_script("docs/*", RAN).stdout)
        self.assertIn("last ran 2026-03-03 (", self.run_script("docs/funnel-review/", RAN).stdout)
        self.assertIn("last ran 2026-03-03 (", self.run_script("./docs//funnel-review", RAN).stdout)

    @unittest.skipIf(os.name == "nt", "symlinks need privileges here")
    def test_a_symlink_whose_target_is_the_marker_is_not_a_run(self):
        os.symlink(RAN, str(self.store / "link.md"))
        self.git("add", "--", str(self.store / "link.md"))
        self.git("commit", "-q", "-m", "link", date="2026-03-03")
        self.assertNever(self.run_script("docs/funnel-review", RAN))

    def test_a_submodule_under_the_root_is_skipped(self):
        self.commit("sprint-02.md", "%s\n" % RAN, "2026-03-03")
        # A gitlink names a commit of another repository: it is not in this object store.
        self.git("update-index", "--add", "--cacheinfo", "160000,%s,docs/funnel-review/sub" % ("1" * 40))
        self.git("commit", "-q", "-m", "submodule", date="2026-04-04")
        result = self.run_script("docs/funnel-review", RAN)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("last ran 2026-03-03 (", result.stdout)

    def test_a_blob_missing_from_the_store_is_a_clean_git_failure(self):
        self.commit("sprint-02.md", "%s\n" % RAN, "2026-03-03")
        oid = subprocess.run(["git", "-C", str(self.repo), "rev-parse", "HEAD:docs/funnel-review/sprint-02.md"],
                             env=self.env, check=True, capture_output=True, text=True).stdout.strip()
        (self.repo / ".git" / "objects" / oid[:2] / oid[2:]).unlink()
        result = self.run_script("docs/funnel-review", RAN)
        self.assertEqual(result.returncode, 1, result.stderr)
        self.assertEqual(result.stdout, "")
        self.assertEqual(result.stderr, "rite-cadence: git cat-file could not read blob %s\n" % oid)

    def test_a_report_marked_minus_diff_is_still_read(self):
        (self.repo / ".gitattributes").write_text("*.md -diff\n", encoding="utf-8")
        self.git("add", ".gitattributes")
        self.git("commit", "-q", "-m", "attributes", date="2026-01-01")
        self.commit("sprint-02.md", "%s\n" % RAN, "2026-03-03")
        self.assertIn("last ran 2026-03-03 (", self.run_script("docs/funnel-review", RAN).stdout)

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
