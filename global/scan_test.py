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
TERM = "Quillmoor" + "vex"                                      # invented; matched only through its hash
SALT = "5a" * 32                                                # a fixed test salt, never a real one


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

    def short(self, rev):
        return subprocess.run(["git", "-C", str(self.repo), "rev-parse", "--short", rev], env=self.env,
                              check=True, capture_output=True, text=True).stdout.strip()

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
        sha = self.box.short("HEAD")
        self.assertIn("%s:touched.md:3: credential, %d chars" % (sha, len(AWS_EXAMPLE)), r.stdout)
        self.assertIn("%s:new.txt:5: cpf, %d chars" % (sha, len(CPF)), r.stdout)
        self.assertIn("SKIPPED %s:blob.bin: binary, not scanned" % sha, r.stdout)
        self.assertIn("mhw scan: 6 finding(s); 2 of 3 scanned file(s) and 1 of 1 commit(s) had one", r.stdout)
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
        self.assertIn("mhw scan: 1 finding(s); 1 of 1 scanned file(s) had one;", r.stdout)
        self.assertNoLeak(r)
        r = self.box.mhw("--base=base")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("mhw scan: 6 finding(s)", r.stdout)
        self.assertNoLeak(r)

    def test_no_findings_is_also_exit_zero(self):
        r = self.box.mhw("clean.txt")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("mhw scan: 0 finding(s); 0 of 1 scanned file(s) had one;", r.stdout)

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

    # History (agents-lead finding 1): what a push sends is every unpushed commit, not only the final tree.
    def test_added_in_one_commit_and_removed_in_a_later_one_is_reported(self):
        b = self.box
        b.write("extra.txt", "first\nreach " + EMAIL + "\n")
        b.git("add", "extra.txt")
        b.git("commit", "-q", "-m", "add notes")
        added = b.short("HEAD")
        b.git("rm", "-q", "extra.txt")
        b.git("commit", "-q", "-m", "remove notes")
        r = b.mhw()
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("%s:extra.txt:2: email, %d chars" % (added, len(EMAIL)), r.stdout)
        self.assertNotIn("\nextra.txt:", "\n" + r.stdout)     # gone from the working tree, still outbound
        self.assertIn("and 2 of 3 commit(s) had one", r.stdout)
        self.assertNoLeak(r)

    def test_commit_message_finding_is_reported(self):
        b = self.box
        b.git("commit", "-q", "--allow-empty", "-m", "subject\n\nbody with " + AWS_EXAMPLE)
        sha = b.short("HEAD")
        r = b.mhw()
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("%s:message: credential, %d chars" % (sha, len(AWS_EXAMPLE)), r.stdout)
        self.assertNoLeak(r)

    # The required attribution trailer (#120 review, B2): exempt in a commit message, as a whole line,
    # with the exact vendor address only. Each row: (message, email lengths the scan must report).
    def test_attribution_trailer_exemption_is_exact(self):
        b = self.box
        vendor = "noreply" + "@" + "anthropic.com"
        rows = [
            ("exact trailer", "s\n\nb\n\nCo-Authored-By: Claude Opus 5.5 (1M context) <%s>" % vendor, []),
            ("key in any case", "s\n\nco-authored-by: Claude <%s>\nCO-AUTHORED-BY: Claude <%s>  "
             % (vendor, vendor), []),
            ("address in the body", "s\n\nwrite to %s for help" % vendor, [len(vendor)]),
            ("address in the subject", "mail %s" % vendor, [len(vendor)]),
            ("address in another trailer", "s\n\nSigned-off-by: Claude <%s>" % vendor, [len(vendor)]),
            ("trailer with no name", "s\n\nCo-Authored-By: <%s>" % vendor, [len(vendor)]),
            ("trailer with more after it", "s\n\nCo-Authored-By: Claude <%s> and more" % vendor,
             [len(vendor)]),
            ("different address", "s\n\nCo-Authored-By: Person <%s>" % EMAIL, [len(EMAIL)]),
            ("lookalike domain", "s\n\nCo-Authored-By: Claude <%s>" % (vendor + ".fixture-mail.dev"),
             [len(vendor) + len(".fixture-mail.dev")]),
            ("lookalike spelling", "s\n\nCo-Authored-By: Claude <%s>" % vendor.replace("anthropic", "anthrop1c"),
             [len(vendor)]),
        ]
        shas = []
        for _name, message, _want in rows:
            b.git("commit", "-q", "--allow-empty", "-m", message)
            shas.append(b.short("HEAD"))
        r = b.mhw()
        self.assertEqual(r.returncode, 0, r.stderr)
        for (name, message, want), sha in zip(rows, shas):
            got = [l for l in r.stdout.splitlines() if l.startswith(sha + ":message: ")]
            self.assertEqual(got, ["%s:message: email, %d chars" % (sha, n) for n in want], name)
            # No leak, the addresses included: no 5-character window of any line of the message.
            for line in message.splitlines():
                for i in range(len(line) - 4):
                    if "@" in line[i:i + 5] or "." in line[i:i + 5]:
                        self.assertNotIn(line[i:i + 5], r.stdout + r.stderr, name)
        self.assertNoLeak(r)

    def test_attribution_trailer_is_not_exempt_in_a_file(self):
        b = self.box
        vendor = "noreply" + "@" + "anthropic.com"
        b.write("credits.txt", "Co-Authored-By: Claude <%s>\n" % vendor)
        b.git("add", "credits.txt")
        b.git("commit", "-q", "-m", "credits")
        sha = b.short("HEAD")
        r = b.mhw()
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("credits.txt:1: email, %d chars" % len(vendor), r.stdout)
        self.assertIn("%s:credits.txt:1: email, %d chars" % (sha, len(vendor)), r.stdout)
        self.assertNotIn(sha + ":message:", r.stdout)

    def test_a_multi_line_secret_added_by_a_commit_is_one_finding(self):
        b = self.box
        pem = ("-----BEGIN " + "RSA PRIVATE KEY-----\n" + "QUJD" * 16 + "\n" + "REVG" * 16 + "\n"
               "-----END " + "RSA PRIVATE KEY-----\n")
        b.write("key name.txt", "x\n" + pem)
        b.git("add", "-A")
        b.git("commit", "-q", "-m", "key")
        sha = b.short("HEAD")
        r = b.mhw()
        self.assertEqual(r.returncode, 0, r.stderr)
        tree = [l for l in r.stdout.splitlines() if l.startswith("key name.txt:")]
        hist = [l for l in r.stdout.splitlines() if l.startswith(sha + ":key name.txt:")]
        self.assertEqual(len(tree), 1, r.stdout)
        self.assertEqual([l.replace(sha + ":", "", 1) for l in hist], tree)   # same line, same length
        self.assertNotIn("QUJD", r.stdout)

    # SonarCloud S8705: a --base value is a ref, never an option.
    def test_base_starting_with_a_dash_is_refused(self):
        for value in ("--help", "-x", "--is-ancestor"):
            r = self.box.mhw("--base=" + value)
            self.assertEqual(r.returncode, 2, value)
            self.assertIn("--base takes a git ref", r.stderr)
            self.assertNotIn("usage: git", r.stdout + r.stderr)

    def test_base_that_is_not_a_commit_is_refused(self):
        r = self.box.mhw("--base=HEAD:touched.md")           # a blob, not a commit
        self.assertEqual(r.returncode, 2)
        self.assertIn("is not a commit", r.stderr)

    # SonarCloud S8707: an explicit path resolving outside the current directory is not opened.
    def test_explicit_paths_outside_the_directory_are_skipped(self):
        outside = self.box.root / "outside.txt"
        outside.write_text("key " + AWS_EXAMPLE + "\n", encoding="utf-8")
        for arg in ("../outside.txt", str(outside)):
            r = self.box.mhw(arg)
            self.assertEqual(r.returncode, 0, r.stderr)
            self.assertIn("SKIPPED %s: outside the working directory, not scanned" % arg, r.stdout)
            self.assertNotIn("credential", r.stdout)
            self.assertNoLeak(r)

    def test_tracked_symlink_to_outside_the_repository_is_skipped(self):
        outside = self.box.root / "outside.txt"
        outside.write_text("key " + AWS_EXAMPLE + "\n", encoding="utf-8")
        os.symlink(str(outside), str(self.box.repo / "link.txt"))
        self.box.git("add", "link.txt")
        self.box.git("commit", "-q", "-m", "link")
        r = self.box.mhw()
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("SKIPPED link.txt: outside the repository, not scanned", r.stdout)
        self.assertNoLeak(r)

    # agents-lead finding 2: employer-client-term is never skipped without a word.
    def _configure_terms(self, terms, salt):
        data = self.box.home / "data" / scan.core.PROJECT
        overlay = data / "local-overlay"
        overlay.mkdir(parents=True)
        (data / "clipboard.conf").write_text("salt_store=file\n", encoding="utf-8")
        if salt:
            (overlay / "clipboard-salt").write_text(salt + "\n", encoding="ascii")
        hashes = [scan.core.term_hash(SALT, f) for t in terms for f in scan.core.term_forms(t)]
        (overlay / "clipboard-terms").write_text(scan.core.TERMS_HEADER + "".join(h + "\n" for h in hashes),
                                                 encoding="ascii")

    def test_note_when_no_term_list(self):
        r = self.box.mhw("clean.txt")
        self.assertIn("NOTE    no employer and client term list could be read", r.stdout)
        self.assertIn("employer-client-term was NOT checked", r.stdout)

    def test_note_when_term_list_is_empty(self):
        self._configure_terms([], SALT)
        r = self.box.mhw("clean.txt")
        self.assertIn("NOTE    no employer and client term list could be read", r.stdout)

    def test_note_when_the_salt_cannot_be_read(self):
        self._configure_terms([TERM], None)
        r = self.box.mhw("clean.txt")
        self.assertIn("NOTE    the term list's salt could not be read without a prompt", r.stdout)
        self.assertNotIn("no employer and client term list", r.stdout)

    def test_synthetic_term_is_found_without_a_note(self):
        self._configure_terms([TERM], SALT)
        self.box.write("memo.txt", "one\nmet the " + TERM + " people\n")
        r = self.box.mhw("memo.txt")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("memo.txt:2: employer-client-term, %d chars" % len(TERM), r.stdout)
        self.assertNotIn("NOTE", r.stdout)
        for i in range(len(TERM) - 4):
            self.assertNotIn(TERM[i:i + 5], r.stdout + r.stderr)


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
