#!/usr/bin/env python3
"""Tests for chrome_debugging.py (Issue #224). Every case uses a fixture Local State under a throwaway
home, never the real file, and passes a stub for "is Chrome running"."""

import contextlib
import io
import json
import os
from pathlib import Path
import stat
import subprocess
import sys
import tempfile
import unittest
from unittest import mock

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import chrome_debugging as cd  # noqa: E402

SECRET = "fixture-private-value-7f3a"
DOC = {"profile": {"info_cache": {"Default": {"name": SECRET}}}, "browser": {"enabled_labs_experiments": []},
       "devtools": {"other": 1}, "zeta": "ünïcode"}


def not_running(_system=None):
    return False


def running(_system=None):
    return True


class Fixture(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="chrome-debugging-")
        self.home = self.temp.name
        self.path = cd.local_state("Darwin", self.home)
        self.path.parent.mkdir(parents=True)
        self.server({"command": "/bin/sh", "args": ["-c", "exec npx chrome-devtools-mcp@1.8.0 --autoConnect"]})

    def server(self, entry):
        """The Claude Code user configuration of the fixture home, with this chrome-devtools entry."""
        doc = {"mcpServers": {} if entry is None else {"chrome-devtools": entry}}
        Path(self.home, ".claude.json").write_text(json.dumps(doc), encoding="utf-8")

    def tearDown(self):
        self.temp.cleanup()

    def write(self, doc):
        self.path.write_text(json.dumps(doc), encoding="utf-8")
        os.chmod(self.path, 0o644)

    def run_mode(self, mode, is_running=not_running):
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            code = cd.run(mode, "Darwin", self.home, is_running)
        return code, out.getvalue()


class Install(Fixture):
    def test_sets_the_key_and_keeps_every_other_field(self):
        self.write(DOC)
        code, out = self.run_mode("install")
        self.assertEqual(code, 0)
        self.assertIn("CHANGED", out)
        self.assertIn("absent -> true", out)
        doc = json.loads(self.path.read_text(encoding="utf-8"))
        self.assertIs(doc["devtools"]["remote_debugging"]["user-enabled"], True)
        del doc["devtools"]["remote_debugging"]
        self.assertEqual(doc, DOC, "only the one key changed")
        self.assertEqual(list(json.loads(self.path.read_text(encoding="utf-8"))), list(DOC), "key order kept")
        self.assertEqual(stat.S_IMODE(os.stat(self.path).st_mode), 0o644, "file mode kept")
        self.assertEqual(sorted(os.listdir(self.path.parent)), ["Local State"], "no backup, no temp left")

    def test_false_becomes_true(self):
        self.write({"devtools": {"remote_debugging": {"user-enabled": False}}})
        code, out = self.run_mode("install")
        self.assertEqual(code, 0)
        self.assertIn("false -> true", out)
        self.assertIs(cd.read_value(self.path), True)

    def test_noop_when_already_on(self):
        self.write({"devtools": {"remote_debugging": {"user-enabled": True}}, "x": 1})
        before = self.path.read_bytes()
        mtime = os.stat(self.path).st_mtime_ns
        code, out = self.run_mode("install", is_running=running)
        self.assertEqual(code, 0)
        self.assertTrue(out.startswith("OK"))
        self.assertEqual(self.path.read_bytes(), before)
        self.assertEqual(os.stat(self.path).st_mtime_ns, mtime)

    def test_chrome_running_skips_and_writes_nothing(self):
        self.write(DOC)
        before = self.path.read_bytes()
        code, out = self.run_mode("install", is_running=running)
        self.assertEqual(code, 0)
        self.assertTrue(out.startswith("SKIP"))
        self.assertIn("Chrome is running", out)
        self.assertEqual(len(out.strip().splitlines()), 1, "one line")
        self.assertEqual(self.path.read_bytes(), before)

    def test_unreadable_is_refused_and_untouched(self):
        self.path.write_text("{not json " + SECRET, encoding="utf-8")
        before = self.path.read_bytes()
        code, out = self.run_mode("install")
        self.assertEqual(code, 3)
        self.assertTrue(out.startswith("REFUSE"))
        self.assertEqual(self.path.read_bytes(), before)

    def test_a_non_boolean_key_is_refused(self):
        self.write({"devtools": {"remote_debugging": {"user-enabled": "yes"}}})
        code, _ = self.run_mode("install")
        self.assertEqual(code, 3)

    def test_no_local_state_is_a_skip(self):
        code, out = self.run_mode("install")
        self.assertEqual(code, 0)
        self.assertTrue(out.startswith("SKIP"))
        self.assertFalse(self.path.exists())

    def test_output_never_carries_the_contents(self):
        self.write(DOC)
        outs = [self.run_mode(m)[1] for m in ("dry-run", "check", "install", "check", "uninstall")]
        outs.append(cd.status_text("Darwin", self.home))
        for out in outs:
            self.assertNotIn(SECRET, out)
            self.assertNotIn("info_cache", out)


class AttachGate(Fixture):
    """Issue #224 lens: remote debugging is turned on only when an attaching chrome-devtools server is
    rendered; a refused server (no entry), an older isolated copy, or no configuration leave the key."""

    def test_refused_or_isolated_server_leaves_the_key(self):
        cases = (None, {"command": "/bin/sh", "args": ["-c", "exec npx chrome-devtools-mcp@1.8.0 --isolated"]},
                 "no file")
        for entry in cases:
            with self.subTest(entry=entry):
                if entry == "no file":
                    os.unlink(Path(self.home, ".claude.json"))
                else:
                    self.server(entry)
                self.write(DOC)
                before = self.path.read_bytes()
                for mode in ("install", "dry-run", "check"):
                    code, out = self.run_mode(mode)
                    self.assertEqual(code, 0, mode)
                    self.assertTrue(out.startswith("SKIP"), out)
                    self.assertIn("nothing would attach", out)
                self.assertEqual(self.path.read_bytes(), before)

    def test_an_on_key_is_reported_on_whatever_the_server(self):
        self.server(None)
        self.write({"devtools": {"remote_debugging": {"user-enabled": True}}})
        self.assertTrue(self.run_mode("check")[1].startswith("OK"))


class NotSyncedReport(Fixture):
    def test_a_failed_directory_sync_is_not_reported_as_nothing_written(self):
        self.write(DOC)
        real = os.fsync
        calls = []

        def second_fails(fd):
            calls.append(fd)
            if len(calls) == 2:
                raise OSError("sync failed")
            return real(fd)
        with mock.patch.object(cd.os, "fsync", second_fails):
            code, out = self.run_mode("install")
        self.assertEqual(code, 3)
        self.assertTrue(out.startswith("CHANGED"), out)
        self.assertIn("not synced", out)
        self.assertNotIn("nothing was written", out)
        self.assertIs(cd.read_value(self.path), True)


class OtherModes(Fixture):
    def test_check_dry_run_and_uninstall_write_nothing(self):
        self.write(DOC)
        before = self.path.read_bytes()
        self.assertEqual(self.run_mode("check")[0], 1)
        self.assertTrue(self.run_mode("check")[1].startswith("DRIFT"))
        self.assertTrue(self.run_mode("dry-run")[1].startswith("WOULD"))
        self.assertTrue(self.run_mode("uninstall")[1].startswith("NOTE"))
        self.assertEqual(self.path.read_bytes(), before)

    def test_uninstall_leaves_an_on_key_on(self):
        self.write({"devtools": {"remote_debugging": {"user-enabled": True}}})
        self.run_mode("uninstall")
        self.assertIs(cd.read_value(self.path), True)

    def test_unknown_system_is_skipped(self):
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            self.assertEqual(cd.run("install", "Windows", self.home, not_running), 0)
        self.assertTrue(out.getvalue().startswith("SKIP"))

    def test_usage(self):
        with contextlib.redirect_stderr(io.StringIO()):
            self.assertEqual(cd.main(["--mode=bogus"]), 2)
            self.assertEqual(cd.main(["--other"]), 2)


class StatusText(Fixture):
    def test_values(self):
        self.assertEqual(cd.status_text("Darwin", self.home), "no Chrome Local State found")
        self.write({"devtools": {"remote_debugging": {"user-enabled": True}}})
        self.assertTrue(cd.status_text("Darwin", self.home).startswith("on (devtools.remote_debugging."
                                                                       "user-enabled = true; no DevToolsActivePort"))
        (self.path.parent / "DevToolsActivePort").write_text("x")
        self.assertIn("DevToolsActivePort present", cd.status_text("Darwin", self.home))
        self.write({"devtools": {"remote_debugging": {"user-enabled": False}}})
        self.assertTrue(cd.status_text("Darwin", self.home).startswith("off ("))
        self.write({})
        self.assertIn("absent", cd.status_text("Darwin", self.home))
        self.path.write_text("[", encoding="utf-8")
        self.assertTrue(cd.status_text("Darwin", self.home).startswith("not read"))
        self.assertTrue(cd.status_text("Windows", self.home).startswith("not read"))


class Running(unittest.TestCase):
    def test_unknown_system_counts_as_running(self):
        self.assertTrue(cd.chrome_running("Windows"))

    def test_linux_path(self):
        self.assertEqual(cd.local_state("Linux", "/h"), Path("/h/.config/google-chrome/Local State"))


class CommandLine(unittest.TestCase):
    def test_cli_runs_against_home(self):
        """The CLI reads the fixture at this system's path (PR #227 advisory A4: it asserted nothing on
        Linux)."""
        with tempfile.TemporaryDirectory(prefix="chrome-debugging-cli-") as home:
            path = cd.local_state(None, home)
            if path is None:
                self.skipTest("no default Chrome profile path on this system")
            path.parent.mkdir(parents=True)
            path.write_text(json.dumps({"devtools": {"remote_debugging": {"user-enabled": True}}}))
            p = subprocess.run([sys.executable, "-B", cd.__file__, "--mode=check", "--home=" + home],
                               capture_output=True, text=True, check=False)
            self.assertEqual(p.returncode, 0, p.stdout + p.stderr)
            self.assertTrue(p.stdout.startswith("OK      " + str(path)), p.stdout)


class PgrepOutcomes(unittest.TestCase):
    """PR #227 B2 (C1, C6): only pgrep's exit 1 means "not running"; an error or a missing pgrep must
    count as running, so an unknown answer never leads to a write."""

    def test_table(self):
        for code, want in ((0, True), (1, False), (2, True), (None, True)):
            with self.subTest(code=code), tempfile.TemporaryDirectory(prefix="pgrep-stub-") as d:
                if code is not None:
                    stub = Path(d, "pgrep")
                    stub.write_text("#!/bin/sh\nexit %d\n" % code)
                    stub.chmod(0o700)
                with mock.patch.dict(os.environ, {"PATH": d}):
                    self.assertIs(cd.chrome_running("Darwin"), want)


class Atomicity(Fixture):
    """PR #227 B2 (C2): the write lands by rename, and a failed write leaves the original untouched."""

    def test_install_renames_a_new_file_over_the_old(self):
        self.write(DOC)
        before = os.stat(self.path).st_ino
        self.assertEqual(self.run_mode("install")[0], 0)
        self.assertNotEqual(os.stat(self.path).st_ino, before)

    def test_a_failed_write_leaves_the_original_and_no_temporary(self):
        self.write(DOC)
        before = self.path.read_bytes()

        def boom(*_a, **_k):
            raise OSError("disk full")
        with mock.patch.object(cd.json, "dump", boom):
            code, out = self.run_mode("install")
        self.assertEqual(code, 3)
        self.assertTrue(out.startswith("REFUSE"))
        self.assertEqual(self.path.read_bytes(), before)
        self.assertEqual(sorted(os.listdir(self.path.parent)), ["Local State"])

    def test_the_directory_is_fsynced_after_the_rename(self):
        self.write(DOC)
        calls = []
        real = os.fsync

        def spy(fd):
            calls.append(fd)
            return real(fd)
        with mock.patch.object(cd.os, "fsync", spy):
            self.assertEqual(self.run_mode("install")[0], 0)
        self.assertEqual(len(calls), 2, "the file, then its directory")


if __name__ == "__main__":
    unittest.main()
