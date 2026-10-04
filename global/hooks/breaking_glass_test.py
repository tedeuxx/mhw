#!/usr/bin/env python3
"""Synthetic tests for breaking_glass.py. They use temporary directories and the current uid as the
stand-in owner; they never read or write the real switch directory."""
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import breaking_glass as bg  # noqa: E402

UID = os.getuid()


class SwitchTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        base = Path(self.tmp.name) / "base"
        base.mkdir(mode=0o755)
        os.chmod(base, 0o755)
        self.dir = base / "breaking-glass"
        self.now = 1_000_000.0

    def tearDown(self):
        self.tmp.cleanup()

    def until(self, layer="restart-guard", now=None):
        return bg.disabled_until(layer, self.dir, now or self.now, UID)

    def test_no_switch_keeps_layer_active(self):
        self.assertIsNone(self.until())

    def test_switch_disables_until_expiry_then_expires(self):
        bg.write_switch("restart-guard", 30, self.dir, now=self.now)
        os.utime(self.dir / "restart-guard.json", (self.now, self.now))
        self.assertEqual(self.until(), self.now + 1800)
        self.assertIsNone(self.until(now=self.now + 1800))
        self.assertIsNone(self.until("paste-filter"))

    def test_expiry_is_capped_from_file_mtime(self):
        self.dir.mkdir(mode=0o755)
        f = self.dir / "hitl-guard.json"
        f.write_text(json.dumps({"layer": "hitl-guard", "expires_at": self.now + 10 ** 7}))
        os.chmod(f, 0o644)
        os.utime(f, (self.now, self.now))
        self.assertEqual(self.until("hitl-guard"), self.now + bg.MAX_MINUTES * 60)

    def test_wrong_owner_keeps_layer_active(self):
        bg.write_switch("restart-guard", 30, self.dir, now=self.now)
        os.utime(self.dir / "restart-guard.json", (self.now, self.now))
        self.assertIsNone(bg.disabled_until("restart-guard", self.dir, self.now, UID + 1))

    def test_group_writable_or_symlink_keeps_layer_active(self):
        bg.write_switch("restart-guard", 30, self.dir, now=self.now)
        f = self.dir / "restart-guard.json"
        os.utime(f, (self.now, self.now))
        os.chmod(f, 0o664)
        self.assertIsNone(self.until())
        os.chmod(f, 0o644)
        os.chmod(self.dir, 0o775)
        self.assertIsNone(self.until())
        os.chmod(self.dir, 0o755)
        real = self.dir / "real.json"
        os.replace(f, real)
        os.symlink(real, f)
        self.assertIsNone(self.until())

    def test_malformed_or_mislabelled_keeps_layer_active(self):
        self.dir.mkdir(mode=0o755)
        f = self.dir / "restart-guard.json"
        for body in ("not json", "[]", json.dumps({"layer": "paste-filter", "expires_at": self.now + 60}),
                     json.dumps({"layer": "restart-guard", "expires_at": True})):
            f.write_text(body)
            os.chmod(f, 0o644)
            os.utime(f, (self.now, self.now))
            self.assertIsNone(self.until(), body)

    def test_unknown_layer_is_never_disabled(self):
        self.assertIsNone(bg.disabled_until("deny-floor", self.dir, self.now, UID))

    def test_switch_paths_come_only_from_the_layer_table(self):
        for bad in ("../escape", "deny-floor", "restart-guard/../x"):
            with self.assertRaises(KeyError):
                bg.write_switch(bad, 30, self.dir, now=self.now)
            with self.assertRaises(KeyError):
                bg.remove_switch(bad, self.dir)
        self.assertFalse((self.dir.parent / "escape.json").exists())

    def test_a_switch_hooks_cannot_read_keeps_the_layer_on(self):
        bg.write_switch("restart-guard", 30, self.dir, now=self.now)
        f = self.dir / "restart-guard.json"
        os.utime(f, (self.now, self.now))
        self.assertIsNotNone(self.until())
        os.chmod(f, 0o600)
        self.assertIsNone(self.until(), "file unreadable to others")
        os.chmod(f, 0o644)
        os.chmod(self.dir, 0o700)
        self.assertIsNone(self.until(), "directory not searchable by others")
        os.chmod(self.dir, 0o755)
        self.assertIsNotNone(self.until())

    def test_strict_umask_reports_an_unreadable_switch_and_the_layer_stays_on(self):
        old = os.umask(0o077)
        try:
            readable = bg.write_switch("restart-guard", 30, self.dir, now=self.now)
        finally:
            os.umask(old)
        self.assertFalse(readable)
        os.utime(self.dir / "restart-guard.json", (self.now, self.now))
        self.assertIsNone(self.until())
        old = os.umask(0o022)
        try:
            # The 0700 directory above hides every switch in it; a fresh one under 022 is readable.
            self.assertFalse(bg.write_switch("paste-filter", 30, self.dir, now=self.now))
            self.assertTrue(bg.write_switch("paste-filter", 30, self.dir.parent / "fresh", now=self.now))
        finally:
            os.umask(old)

    def test_remove_switch_reactivates(self):
        bg.write_switch("paste-filter", 30, self.dir, now=self.now)
        bg.remove_switch("paste-filter", self.dir)
        bg.remove_switch("paste-filter", self.dir)
        self.assertIsNone(self.until("paste-filter"))

    def test_notice_names_layer_without_content(self):
        self.assertEqual(bg.notice(self.dir, self.now, UID), "")
        bg.write_switch("paste-filter", 30, self.dir, now=self.now)
        os.utime(self.dir / "paste-filter.json", (self.now, self.now))
        text = bg.notice(self.dir, self.now, UID)
        self.assertIn("paste-filter", text)
        self.assertNotIn("restart-guard", text)

    def test_sudo_line_requires_root_owned_helper(self):
        helper = self.dir.parent / "bin" / "breaking_glass.py"
        self.assertIsNone(bg.sudo_line("disable", "restart-guard", 30, helper, UID))
        helper.parent.mkdir(mode=0o755)
        helper.write_text("")
        os.chmod(helper, 0o644)
        line = bg.sudo_line("disable", "restart-guard", 30, helper, UID)
        self.assertTrue(line.startswith("sudo /usr/bin/python3 -I -B "))
        self.assertTrue(line.endswith(" disable restart-guard --minutes 30"))
        self.assertTrue(bg.sudo_line("enable", "restart-guard", 30, helper, UID).endswith("enable restart-guard"))
        os.chmod(helper, 0o666)
        self.assertIsNone(bg.sudo_line("disable", "restart-guard", 30, helper, UID))

    def test_cli_rejects_out_of_range_minutes_and_non_root_writes(self):
        with self.assertRaises(SystemExit):
            bg.main(["sudo-line", "disable", "restart-guard", "--minutes", str(bg.MAX_MINUTES + 1)])
        if os.geteuid() != 0:
            self.assertEqual(bg.main(["disable", "restart-guard"]), 1)


if __name__ == "__main__":
    unittest.main()
