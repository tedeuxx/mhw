#!/usr/bin/env python3
"""Tests for global/method/plugin_retire.py (Issue #130), in throwaway homes only; the real ~ is never read.

    python3 -B global/method/plugin_retire_test.py [BASE_DIR]
"""
import json
import os
import shutil
import stat
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

try:
    import tomllib
except ImportError:  # Python < 3.11
    tomllib = None

HERE = Path(__file__).resolve().parent
SCRIPT = HERE / "plugin_retire.py"
BASE = None
KEY = "tadeumendonca-skills@tadeumendonca"

SETTINGS = {
    "model": "some-model",
    "permissions": {"deny": ["Bash(rm -rf:*)"]},
    "enabledPlugins": {KEY: True, "other@vendor": True, "tadeumendonca-skills-fork@vendor": True},
    "extraKnownMarketplaces": {"tadeumendonca": {"source": {"source": "github", "repo": "o/tadeumendonca-skills"}},
                               "vendor": {"source": {"source": "github", "repo": "v/x"}}},
}
INSTALLED = {"version": 2, "plugins": {
    KEY: [{"scope": "user", "version": "2.0.107", "installPath": "/x"},
          {"scope": "project", "projectPath": "/repos/site", "version": "2.0.104"}],
    "other@vendor": [{"scope": "user", "version": "1.0.0"}],
}}
MARKETS = {"tadeumendonca": {"source": {"source": "github", "repo": "o/tadeumendonca-skills"}},
           "vendor": {"source": {"source": "github", "repo": "v/x"}}}
CODEX = """model = "m"

[marketplaces.vendor]
source = "https://example.invalid/v.git"

[marketplaces.tadeumendonca]
source_type = "git"
source = "https://example.invalid/tadeumendonca-skills.git"

[plugins."other@vendor"]
enabled = true

[plugins."tadeumendonca-skills@tadeumendonca"]
enabled = true

[mcp_servers.x]
command = "x"
"""


class Home:
    def __init__(self, plugin=True, project=True):
        self.root = Path(tempfile.mkdtemp(prefix="home-", dir=BASE))
        self.claude = self.root / ".claude"
        (self.claude / "plugins").mkdir(parents=True)
        (self.root / ".codex").mkdir()
        settings, installed, markets, codex = (json.loads(json.dumps(x)) for x in (SETTINGS, INSTALLED, MARKETS, 0))
        if not project:
            installed["plugins"][KEY] = installed["plugins"][KEY][:1]
        codex = CODEX
        if not plugin:
            del settings["enabledPlugins"][KEY]
            del settings["extraKnownMarketplaces"]["tadeumendonca"]
            del installed["plugins"][KEY]
            del markets["tadeumendonca"]
            codex = CODEX.replace('[plugins."tadeumendonca-skills@tadeumendonca"]\nenabled = true\n\n', "") \
                .replace('[marketplaces.tadeumendonca]\nsource_type = "git"\nsource = "https://example.invalid/tadeumendonca-skills.git"\n\n', "")
        self.write("settings", settings)
        self.write("installed", installed)
        self.write("markets", markets)
        self.p("codex").write_text(codex, encoding="utf-8")
        os.chmod(self.p("settings"), 0o640)

    def p(self, name):
        return {"settings": self.claude / "settings.json",
                "installed": self.claude / "plugins" / "installed_plugins.json",
                "markets": self.claude / "plugins" / "known_marketplaces.json",
                "codex": self.root / ".codex" / "config.toml"}[name]

    def write(self, name, doc):
        self.p(name).write_text(json.dumps(doc, indent=2) + "\n", encoding="utf-8")

    def read(self, name):
        return json.loads(self.p(name).read_text(encoding="utf-8"))

    def run(self, mode, opt_in=True, home_arg=False):
        env = {"PATH": os.environ.get("PATH", "/usr/bin:/bin"), "HOME": str(self.root), "TMPDIR": str(self.root)}
        args = [sys.executable, "-B", str(SCRIPT), "--mode=" + mode]
        if opt_in:
            args.append("--opt-in")
        if home_arg:
            env["HOME"] = str(self.root / "not-this-one")
            args.append("--home=" + str(self.root))
        p = subprocess.run(args, env=env, capture_output=True, text=True)
        return p.returncode, p.stdout + p.stderr

    def snapshot(self):
        return {n: self.p(n).read_bytes() for n in ("settings", "installed", "markets", "codex")}


class Retire(unittest.TestCase):
    def test_install_removes_the_plugin_at_user_scope_only(self):
        h = Home()
        code, out = h.run("install")
        self.assertEqual(code, 0, out)
        s = h.read("settings")
        self.assertNotIn(KEY, s["enabledPlugins"])
        self.assertTrue(s["enabledPlugins"]["other@vendor"])
        self.assertTrue(s["enabledPlugins"]["tadeumendonca-skills-fork@vendor"], "only the exact plugin name goes")
        self.assertNotIn("tadeumendonca", s["extraKnownMarketplaces"])
        self.assertIn("vendor", s["extraKnownMarketplaces"])
        self.assertEqual(s["model"], "some-model")
        self.assertEqual(s["permissions"], SETTINGS["permissions"])
        i = h.read("installed")
        self.assertEqual(i["plugins"][KEY], [INSTALLED["plugins"][KEY][1]], "the project-scope record stays")
        self.assertEqual(i["plugins"]["other@vendor"], INSTALLED["plugins"]["other@vendor"])
        self.assertIn("tadeumendonca", h.read("markets"), "a project install still uses the marketplace")
        self.assertIn("1 project-scope install(s) of the tadeumendonca-skills plugin left untouched", out)
        self.assertIn("/repos/site", out)
        self.assertIn("enabledPlugins.%s true -> absent" % KEY, out)
        self.assertIn('[plugins."tadeumendonca-skills@tadeumendonca"] present -> absent', out)
        if tomllib is not None:
            want = tomllib.loads(CODEX)
            del want["plugins"][KEY]
            del want["marketplaces"]["tadeumendonca"]
            self.assertEqual(tomllib.loads(h.p("codex").read_text()), want, "nothing else in config.toml changes")
        self.assertEqual(stat.S_IMODE(h.p("settings").stat().st_mode), 0o640, "the file keeps its mode")
        for name in ("settings", "installed", "codex"):
            backup = Path(str(h.p(name)) + ".pmhwc-plugin-backup")
            self.assertTrue(backup.is_file(), name)
            self.assertEqual(stat.S_IMODE(backup.stat().st_mode), 0o600, name)

    def test_marketplace_goes_when_no_project_install_uses_it(self):
        h = Home(project=False)
        code, out = h.run("install")
        self.assertEqual(code, 0, out)
        self.assertNotIn(KEY, h.read("installed")["plugins"])
        self.assertNotIn("tadeumendonca", h.read("markets"))
        self.assertIn("vendor", h.read("markets"))

    def test_second_install_is_a_no_op_and_keeps_the_backups(self):
        h = Home()
        h.run("install")
        backups = {n: Path(str(h.p(n)) + ".pmhwc-plugin-backup").read_bytes() for n in ("settings", "codex")}
        before = h.snapshot()
        code, out = h.run("install")
        self.assertEqual(code, 0, out)
        self.assertNotIn("CHANGED", out)
        self.assertEqual(h.snapshot(), before)
        for n, data in backups.items():
            self.assertEqual(Path(str(h.p(n)) + ".pmhwc-plugin-backup").read_bytes(), data, "a backup is not overwritten")

    def test_uninstall_restores_what_install_removed_and_is_idempotent(self):
        h = Home()
        original = {n: h.read(n) for n in ("settings", "installed", "markets")}
        h.run("install")
        code, out = h.run("uninstall", opt_in=False)
        self.assertEqual(code, 0, out)
        self.assertEqual(h.read("settings"), original["settings"])
        restored = h.read("installed")
        self.assertCountEqual(restored["plugins"][KEY], original["installed"]["plugins"][KEY])
        self.assertEqual(h.read("markets"), original["markets"])
        if tomllib is not None:
            self.assertEqual(tomllib.loads(h.p("codex").read_text()), tomllib.loads(CODEX))
        self.assertIn("RESTORED", out)
        again = h.snapshot()
        code, out = h.run("uninstall", opt_in=False)
        self.assertEqual(code, 0, out)
        self.assertNotIn("RESTORED", out)
        self.assertEqual(h.snapshot(), again)

    def test_uninstall_restores_the_marketplace_and_keeps_its_backups(self):
        h = Home(project=False)
        original = h.read("markets")
        h.run("install")
        self.assertNotIn("tadeumendonca", h.read("markets"))
        backups = {p: p.read_bytes() for p in h.root.rglob("*.pmhwc-plugin-backup")}
        self.assertEqual(len(backups), 4)
        code, out = h.run("uninstall", opt_in=False)
        self.assertEqual(code, 0, out)
        self.assertEqual(h.read("markets"), original)
        self.assertEqual({p: p.read_bytes() for p in backups}, backups, "a restore leaves the backups as they were")

    def test_a_codex_edit_that_would_change_more_is_refused(self):
        h = Home()
        text = CODEX.replace('[plugins."tadeumendonca-skills@tadeumendonca"]\nenabled = true\n',
                             '[plugins."tadeumendonca-skills@tadeumendonca"]\nenabled = true\n\n'
                             '[plugins."tadeumendonca-skills@tadeumendonca".mcp_servers]\nx = 1\n')
        h.p("codex").write_text(text, encoding="utf-8")
        code, out = h.run("install")
        self.assertEqual(code, 3, out)
        self.assertIn("would change more than its tables", out)
        self.assertEqual(h.p("codex").read_text(encoding="utf-8"), text)

    def test_plugin_absent_changes_nothing(self):
        h = Home(plugin=False)
        before = h.snapshot()
        code, out = h.run("install")
        self.assertEqual(code, 0, out)
        self.assertNotIn("CHANGED", out)
        self.assertEqual(h.snapshot(), before)
        self.assertFalse(list(h.root.rglob("*.pmhwc-plugin-backup")))

    def test_a_malformed_settings_file_is_refused_and_left_untouched(self):
        h = Home()
        h.p("settings").write_text('{"enabledPlugins": {"%s": true,}' % KEY, encoding="utf-8")
        bad = h.p("settings").read_bytes()
        code, out = h.run("install")
        self.assertEqual(code, 3, out)
        self.assertIn("REFUSE  %s: not valid JSON" % h.p("settings"), out)
        self.assertEqual(h.p("settings").read_bytes(), bad)
        # The other files are still processed: the user-scope install record goes.
        self.assertEqual([r["scope"] for r in h.read("installed")["plugins"][KEY]], ["project"])

    def test_without_the_method_the_plugin_is_left_alone(self):
        h = Home()
        before = h.snapshot()
        code, out = h.run("install", opt_in=False)
        self.assertEqual(code, 0, out)
        self.assertIn("left as it is: the working method is not installed", out)
        self.assertEqual(h.snapshot(), before)

    def test_check_and_dry_run_write_nothing(self):
        h = Home()
        before = h.snapshot()
        code, out = h.run("check")
        self.assertEqual(code, 1, out)
        self.assertIn("DRIFT", out)
        code, out = h.run("dry-run")
        self.assertEqual(code, 0, out)
        self.assertIn("WOULD CHANGE", out)
        self.assertEqual(h.snapshot(), before)
        h.run("install")
        code, out = h.run("check")
        self.assertEqual(code, 0, out)

    def test_home_argument_wins_over_HOME(self):
        # install.ps1 passes --home=<profile>, so a HOME set on Windows is never written to.
        h = Home()
        code, out = h.run("install", home_arg=True)
        self.assertEqual(code, 0, out)
        self.assertNotIn(KEY, h.read("settings")["enabledPlugins"])
        self.assertFalse((h.root / "not-this-one").exists())

    def test_status_reports_duplicate_until_the_plugin_is_retired(self):
        h = Home()
        probe = ("import sys; sys.path.insert(0, %r); import workstation as w; "
                 "print(w.method_text(w.method_state(['METHOD  installed: 1 agent'], w.enabled_plugins(None))))"
                 % str(HERE.parent))
        env = {"PATH": os.environ.get("PATH", "/usr/bin:/bin"), "HOME": str(h.root), "CODEX_HOME": str(h.root / ".codex")}
        before = subprocess.run([sys.executable, "-B", "-c", probe], env=env, capture_output=True, text=True)
        self.assertIn("DUPLICATE", before.stdout, before.stderr)
        self.assertIn("Claude Code and Codex", before.stdout)
        h.run("install")
        after = subprocess.run([sys.executable, "-B", "-c", probe], env=env, capture_output=True, text=True)
        self.assertNotIn("DUPLICATE", after.stdout, after.stderr)
        self.assertIn("installed in the user layer", after.stdout)


if __name__ == "__main__":
    if len(sys.argv) > 1 and not sys.argv[1].startswith("-"):
        BASE = sys.argv.pop(1)
        os.makedirs(BASE, exist_ok=True)
    unittest.main(verbosity=1)
