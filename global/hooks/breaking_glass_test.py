#!/usr/bin/env python3
"""Synthetic tests for breaking_glass.py. They use temporary directories and the current uid as the
stand-in owner; they never read or write the real switch directory."""
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest import mock

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


class StatusTest(unittest.TestCase):
    """The status table reads only a throwaway home and root, never the real machine."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        t = Path(self.tmp.name)
        self.home, self.root = t / "home", t / "root"
        base = t / "base"
        base.mkdir(mode=0o755)
        os.chmod(base, 0o755)
        self.dir = base / "breaking-glass"
        self.now = 1_000_000.0
        self.codex_home = os.environ.pop("CODEX_HOME", None)

    def tearDown(self):
        if self.codex_home is not None:
            os.environ["CODEX_HOME"] = self.codex_home
        self.tmp.cleanup()

    def where(self):
        return dict(switch_dir=self.dir, now=self.now, owner_uid=UID, home=self.home, root=self.root)

    def put(self, path, text):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8")

    def admin_dropin(self):
        if sys.platform == "darwin":
            return self.root / "Library/Application Support/ClaudeCode/managed-settings.d" / (
                "50-%s.json" % bg.NAME)
        return self.root / "etc/claude-code/managed-settings.d" / ("50-%s.json" % bg.NAME)

    def states(self):
        return {row[0]: (row[1], row[3]) for row in bg.status_rows(**self.where())}

    def test_unregistered_layers_are_not_reported_active(self):
        self.assertEqual(set(s for s, _ in self.states().values()), {"unregistered"})
        self.assertIn("sem registro", bg.status_report(**self.where()))

    def test_registration_is_read_per_harness_and_level(self):
        self.put(self.admin_dropin(), '{"hooks": "/x/restart_guard.py /x/hitl-escalation-guard.sh"}')
        self.put(self.root / "etc/codex/requirements.toml", 'command = "/x/restart_guard.py"')
        self.put(self.home / ".claude/settings.json", '{"hooks": "/y/clipboard_guard.py prompt-hook"}')
        s = self.states()
        self.assertEqual(s["restart-guard"], ("on", ["claude:admin", "codex:admin"]))
        self.assertEqual(s["hitl-guard"], ("on", ["claude:admin"]))
        self.assertEqual(s["paste-filter"], ("on", ["claude:usuário"]))

    def test_switched_off_layer_shows_expiry_and_wins_over_registration(self):
        self.put(self.admin_dropin(), "/x/restart_guard.py")
        bg.write_switch("restart-guard", 30, self.dir, now=self.now)
        os.utime(self.dir / "restart-guard.json", (self.now, self.now))
        self.assertEqual(self.states()["restart-guard"][0], "off")
        self.assertIn("DESLIGADA até", bg.status_report(**self.where()))

    def test_colour_only_when_asked_and_markdown_uses_icons(self):
        self.put(self.admin_dropin(), "/x/restart_guard.py")
        plain = bg.status_report(**self.where())
        self.assertNotIn("\033[", plain)
        coloured = bg.status_report("text", True, **self.where())
        self.assertIn(bg.GREEN + "ativa", coloured)
        self.assertIn(bg.YELLOW + "sem registro", coloured)
        md = bg.status_report("markdown", **self.where())
        self.assertIn("| `restart-guard` | 🟢 ativa | claude:admin |", md)
        self.assertIn("🟡 sem registro", md)
        self.assertNotIn("\033[", md)

    def test_auto_colour_needs_a_terminal_and_honours_no_color(self):
        self.assertTrue(bg._use_color("always"))
        self.assertFalse(bg._use_color("never"))
        saved = os.environ.pop("NO_COLOR", None)
        try:
            with mock.patch.object(sys.stdout, "isatty", return_value=False):
                self.assertFalse(bg._use_color("auto"))
            with mock.patch.object(sys.stdout, "isatty", return_value=True):
                self.assertTrue(bg._use_color("auto"))
                os.environ["NO_COLOR"] = "1"
                self.assertFalse(bg._use_color("auto"))
        finally:
            os.environ.pop("NO_COLOR", None)
            if saved is not None:
                os.environ["NO_COLOR"] = saved

    def test_always_on_controls_report_briefs_and_rules(self):
        self.put(self.home / ".claude/CLAUDE.md", "# %s; source: x\nbrief\n" % bg.MARKER)
        self.put(self.home / ".claude/settings.json", '{"permissions": {"deny": ["a", "b"]}}')
        self.put(self.home / ".codex/rules/workstation-deny-floor.rules", 'prefix_rule(x)\nprefix_rule(y)\n# c\n')
        text = dict(bg.always_on(self.home))
        self.assertIn("em claude", text["brief global"])
        self.assertNotIn("codex", text["brief global"])
        self.assertIn("claude 2 regras deny", text["deny floor"])
        self.assertIn("codex 2 regras do floor", text["deny floor"])


if __name__ == "__main__":
    unittest.main()
