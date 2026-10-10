#!/usr/bin/env python3
"""Regression tests for mhw scan, the outbound scan (ADR-0035, decision 7).

Every run is in a throwaway git repository under a throwaway HOME and XDG_DATA_HOME, with the global and
system git configuration switched off; never a real configuration. Every fixture is synthetic: the
credential is AWS's own documented example key id, the email address is at an invented domain, the CPF
is the well-known test number. They are assembled at run time, so this file carries no literal finding.

    python3 -B global/scan_test.py
"""
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

HERE = Path(__file__).resolve().parent
MHW = HERE.parent / "mhw"
sys.path.insert(0, str(HERE))
import scan  # noqa: E402

# Synthetic, and split so this file never matches its own detectors.
AWS_EXAMPLE = "AKIA" + "IOSFODNN7" + "EXAMPLE"                 # AWS documentation's example key id
EMAIL = "synthetic.person" + "@" + "fixture-mail.dev"           # invented domain
CPF = "123.456" + ".789-09"                                     # the common test CPF, valid check digits
SECRETS = (AWS_EXAMPLE, EMAIL, CPF)


class Sandbox:
    def __init__(self):
        self.root = Path(tempfile.mkdtemp(prefix="mhw-scan-test-"))
        self.home = self.root / "home"
        self.repo = self.root / "repo"
        self.home.mkdir()
        self.repo.mkdir()
        self.env = {
            "PATH": os.environ.get("PATH", "/usr/bin:/bin"),
            "HOME": str(self.home),
            "XDG_DATA_HOME": str(self.home / "data"),
            "GIT_CONFIG_GLOBAL": os.devnull,
            "GIT_CONFIG_NOSYSTEM": "1",
            "GIT_AUTHOR_NAME": "Fixture", "GIT_AUTHOR_EMAIL": "fixture@example.com",
            "GIT_COMMITTER_NAME": "Fixture", "GIT_COMMITTER_EMAIL": "fixture@example.com",
            "LC_ALL": "C",
        }

    def git(self, *args):
        subprocess.run(["git", "-C", str(self.repo)] + list(args), env=self.env, check=True,
                       capture_output=True)

    def write(self, name, content):
        path = self.repo / name
        if isinstance(content, bytes):
            path.write_bytes(content)
        else:
            path.write_text(content, encoding="utf-8")

    def mhw(self, *args):
        return subprocess.run(["/bin/sh", str(MHW), "scan"] + list(args), cwd=str(self.repo), env=self.env,
                              capture_output=True, text=True)

    def cleanup(self):
        shutil.rmtree(self.root, ignore_errors=True)


class OutboundScan(unittest.TestCase):
    def setUp(self):
        self.box = Sandbox()
        b = self.box
        b.git("init", "-q", "-b", "base")
        # Already on the base branch: a finding here was never this branch's to send.
        b.write("old.txt", "kept from before\nkey " + AWS_EXAMPLE + "\n")
        b.write("touched.md", "line one\n")
        b.git("add", "-A")
        b.git("commit", "-q", "-m", "base")
        b.git("checkout", "-q", "-b", "feature", "--track", "base")
        b.write("touched.md", "line one\nline two\ncontact " + EMAIL + " and id " + AWS_EXAMPLE + "\n")
        b.write("new.txt", "a\nb\nc\nd\ncpf " + CPF + "\n")
        b.write("blob.bin", b"\x00\x01" + AWS_EXAMPLE.encode())
        b.write("clean.txt", "nothing to report\n")
        b.git("add", "-A")
        b.git("commit", "-q", "-m", "feature")

    def tearDown(self):
        self.box.cleanup()

    def assertNoLeak(self, result):
        for secret in SECRETS:
            self.assertNotIn(secret, result.stdout)
            self.assertNotIn(secret, result.stderr)
        # Nor any excerpt: no 5-character window of a finding appears (an excerpt is a leak too, ADR-0005).
        both = result.stdout + result.stderr
        for secret in SECRETS:
            for i in range(len(secret) - 4):
                self.assertNotIn(secret[i:i + 5], both, "an excerpt of a finding was printed")

    def test_branch_changes_reported_with_file_line_category_and_length(self):
        r = self.box.mhw()
        self.assertEqual(r.returncode, 0, r.stderr)   # findings never block
        self.assertIn("touched.md:3: credential, %d chars" % len(AWS_EXAMPLE), r.stdout)
        self.assertIn("touched.md:3: email, %d chars" % len(EMAIL), r.stdout)
        self.assertIn("new.txt:5: cpf, %d chars" % len(CPF), r.stdout)
        self.assertIn("SKIPPED blob.bin: binary, not scanned", r.stdout)
        self.assertNotIn("old.txt", r.stdout)        # unchanged on this branch: not outbound
        self.assertIn("mhw scan: 3 finding(s) in 2 of 3 file(s) scanned", r.stdout)
        self.assertNoLeak(r)

    def test_uncommitted_changes_to_tracked_files_are_included(self):
        self.box.write("clean.txt", "nothing\nnow " + EMAIL + "\n")
        r = self.box.mhw()
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("clean.txt:2: email, %d chars" % len(EMAIL), r.stdout)
        self.assertNoLeak(r)

    def test_explicit_paths_and_base(self):
        r = self.box.mhw("old.txt")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("old.txt:2: credential, %d chars" % len(AWS_EXAMPLE), r.stdout)
        self.assertIn("mhw scan: 1 finding(s) in 1 of 1 file(s) scanned", r.stdout)
        self.assertNoLeak(r)
        r = self.box.mhw("--base=base")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("mhw scan: 3 finding(s)", r.stdout)
        self.assertNoLeak(r)

    def test_no_findings_is_also_exit_zero(self):
        r = self.box.mhw("clean.txt")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("mhw scan: 0 finding(s) in 0 of 1 file(s) scanned", r.stdout)

    def test_cannot_run_is_exit_two_not_a_finding(self):
        self.box.git("checkout", "-q", "-b", "orphanish")      # no upstream
        r = self.box.mhw()
        self.assertEqual(r.returncode, 2)
        self.assertIn("--base=REF", r.stderr)
        self.assertEqual(self.box.mhw("--bogus").returncode, 2)
        self.assertEqual(self.box.mhw("--base=nope-not-a-ref").returncode, 2)
        self.assertEqual(self.box.mhw("--base=base", "new.txt").returncode, 2)

    def test_missing_file_is_named_not_skipped_silently(self):
        r = self.box.mhw("absent.txt")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("SKIPPED absent.txt: unreadable", r.stdout)


class ScanText(unittest.TestCase):
    def test_returns_positions_never_text(self):
        text = "x\n\ny " + AWS_EXAMPLE + "\n"
        found = scan.scan_text(text)
        self.assertEqual(found, [(3, "credential", len(AWS_EXAMPLE))])
        for item in found:
            for part in item:
                self.assertNotIn(AWS_EXAMPLE, str(part))

    def test_reuses_the_paste_filter_engine(self):
        # One detector: scan's findings are exactly clipboard_guard.find_spans' categories and lengths.
        text = EMAIL + " " + CPF
        want = sorted((e - s, c) for s, e, c in scan.core.find_spans(text))
        self.assertEqual(sorted((n, c) for _, c, n in scan.scan_text(text)), want)
        self.assertTrue(want)


if __name__ == "__main__":
    unittest.main(verbosity=1)
