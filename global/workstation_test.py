#!/usr/bin/env python3
"""Regression tests for ./workstation (Issues #57 and #67): the version-key comparison and the status
output. Throwaway HOME and admin root only; never a real configuration, never sudo.

    python3 -B global/workstation_test.py
"""
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parent))
import workstation as ws  # noqa: E402

STAMP = "release: v3.1.0; commit: " + "a" * 40


class VersionKey(unittest.TestCase):
    def verdict(self, required, release):
        return ws.key_verdict(required, release)[0]

    def test_range_bounds(self):
        cases = [
            (">=3.1 <4", "v3.1.0", "match"),
            (">=3.1 <4", "v3.9.12", "match"),
            (">=3.1 <4", "v3.0.9", "mismatch"),
            (">=3.1 <4", "v4.0.0", "mismatch"),
            (">=3.1,<4", "v3.2.0", "match"),
            (">3.1 <=3.2", "v3.1.0", "mismatch"),
            (">3.1 <=3.2", "v3.2.0", "match"),
            (">3.1 <=3.2", "v3.2.1", "mismatch"),
            ("=3.1.2", "v3.1.2", "match"),
            ("=3.1.2", "v3.1.3", "mismatch"),
            (">=v3", "v3.0.0", "match"),
        ]
        for required, release, want in cases:
            with self.subTest(required=required, release=release):
                self.assertEqual(self.verdict(required, release), want)

    def test_installed_release_forms(self):
        self.assertEqual(self.verdict(">=3.1 <4", "unreleased, after v3.1.0"), "match")
        self.assertEqual(self.verdict(">=3.1 <4", "unreleased, after v3.0.0"), "mismatch")
        for release in ("none", "", "unreleased, no tag reachable", "mixed",
                        "unknown, not a git checkout (.bumpversion.toml says 3.1.0)", "v3.1", "3.1.0",
                        "v3.1.0-rc1", "not v3.1.0"):
            with self.subTest(release=release):
                self.assertEqual(self.verdict(">=0", release), "mismatch")

    def test_invalid_ranges(self):
        for required in ("", "~3.1", ">=a", "3.1", ">= 3.1", ">=3.1.2.4"):
            with self.subTest(required=required):
                self.assertEqual(self.verdict(required, "v3.1.0"), "invalid")

    def test_key_file_first_meaningful_line(self):
        self.assertEqual(ws.read_key("# comment\n\n  >=3.1 <4  # why\n<9\n"), ">=3.1 <4")
        self.assertEqual(ws.read_key("# only a comment\n"), "")

    def test_mismatch_line_is_the_briefs_line(self):
        brief = (ws.HERE / "AGENTS.md").read_text(encoding="utf-8")
        template = re.search(r"^`(Workstation version key: required <range>.*)`$", brief, re.M).group(1)
        want = template.replace("<range>", ">=3.1 <4").replace("<release>", "v3.0.0")
        self.assertEqual(ws.key_verdict(">=3.1 <4", "v3.0.0"), ("mismatch", want))
        self.assertEqual(ws.key_verdict(">=3.1 <4", "v3.1.0"), ("match", ""))


def facts(**over):
    f = {"source": STAMP, "user_stamps": {"Claude Code": STAMP, "Codex": STAMP}, "admin": False,
         "admin_stamp": "none", "user_issues": 0, "admin_issues": 0,
         "user_lines": ["OK      /h/.claude/CLAUDE.md (x)"], "admin_lines": [],
         "harnesses": {"Claude Code": "2.1.0", "Codex": None, "Kiro": None},
         "workspace": {"name": "proj", "root": Path("/proj"), "carriers": [".workstation-version"]},
         "plugins": [], "brief": "installed in 2/3 agent harnesses (an instruction)",
         "floor": "the user layer only", "hooks": "user layer (picker guard, paste filter)",
         "key": {"required": ">=3.1 <4", "state": "match", "line": ""},
         "runtime": "host (Linux x86_64; no container marker found)"}
    f.update(over)
    return f


class StatusOutput(unittest.TestCase):
    def test_short_view(self):
        out = ws.render_status(facts())
        self.assertLessEqual(len(out), 12)
        self.assertIn("  source           v3.1.0 @ aaaaaaa (this checkout)", out)
        self.assertIn("  installed        user: v3.1.0 @ aaaaaaa · admin: not installed", out)
        self.assertIn("  check            matches this checkout", out)
        self.assertIn("  agent harnesses  Claude Code", out)
        self.assertIn("  version key      >=3.1 <4: match", out)
        self.assertTrue(any(line.startswith("  layers           managed: absent · user: installed · "
                                            "workspace: proj (.workstation-version) · plugin: none")
                            for line in out))
        self.assertFalse(any(line.startswith("  |") for line in out))

    def test_mismatch_prints_the_line(self):
        line = ws.mismatch_line(">=3.1 <4", "v3.0.0")
        out = ws.render_status(facts(key={"required": ">=3.1 <4", "state": "mismatch", "line": line}))
        self.assertIn("  version key      >=3.1 <4: mismatch", out)
        self.assertIn("                   " + line, out)

    def test_differences_admin_and_absent_key(self):
        out = ws.render_status(facts(admin=True, admin_stamp=STAMP, user_issues=1, admin_issues=2, key=None))
        self.assertIn("  check            3 target(s) differ; run ./workstation install", out)
        self.assertIn("  installed        user: v3.1.0 @ aaaaaaa · admin: v3.1.0 @ aaaaaaa", out)
        self.assertTrue(any("managed: installed" in line for line in out))
        self.assertIn("  version key      none (.workstation-version absent in the workspace)", out)

    def test_two_user_stamps_are_both_shown(self):
        other = "release: unreleased, after v3.0.0; commit: " + "b" * 40 + "-dirty"
        out = ws.render_status(facts(user_stamps={"Claude Code": STAMP, "Codex": other}))
        self.assertIn("  installed        user: unreleased, after v3.0.0 @ bbbbbbb-dirty / v3.1.0 @ aaaaaaa"
                      " · admin: not installed", out)

    def test_verbose_adds_detail(self):
        out = ws.render_status(facts(plugins=["p@m"]), verbose=True)
        self.assertIn("  agent harness    Codex: not on PATH", out)
        self.assertIn("  plugin           p@m", out)
        self.assertIn("  | OK      /h/.claude/CLAUDE.md (x)", out)

    def test_issue_count(self):
        lines = ["OK      a", "STAMP   b", "DRIFT   c", "MISSING d", "STALE   e", "SKIP    f", "FLOOR   g",
                 "NOTE    h", "SOURCE  i"]
        self.assertEqual(ws.issues(lines), 4)


@unittest.skipUnless(os.name == "posix" and shutil.which("jq"), "needs a POSIX sh and jq")
class EndToEnd(unittest.TestCase):
    """The real installers in a throwaway HOME and admin root: status must read their output right."""

    def run_ws(self, *args):
        p = subprocess.run([str(ws.ROOT / "workstation")] + list(args), env=self.env, cwd=self.base,
                           capture_output=True, text=True)
        return p.returncode, p.stdout

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="workstation-e2e-")
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name)
        for d in ("home", "root", "tmp", "proj"):
            (self.base / d).mkdir()
        (self.base / "proj" / ws.KEY_FILE).write_text("# test\n>=999 <1000\n", encoding="utf-8")
        self.env = {"PATH": os.environ["PATH"], "HOME": str(self.base / "home"),
                    "TMPDIR": str(self.base / "tmp"), "WORKSTATION_MANAGED_ROOT": str(self.base / "root")}

    def test_install_then_status(self):
        code, out = self.run_ws("install", "--overlay=none")
        self.assertIn("CHECK   every user-level target matches this checkout", out)
        self.assertIn("ADMIN   not installed", out)
        project = "--project=" + str(self.base / "proj")
        code, out = self.run_ws("status", "--overlay=none", project)
        self.assertEqual(code, 0)
        source = re.search(r"^  source           (.*) \(this checkout\)$", out, re.M).group(1)
        self.assertIn("  installed        user: %s · admin: not installed\n" % source, out)
        self.assertIn("  check            matches this checkout\n", out)
        self.assertIn("managed: absent · user: installed", out)
        self.assertIn("brief: installed in 3/3 agent harnesses", out)
        self.assertIn("  version key      >=999 <1000: mismatch\n", out)
        self.assertIn("Workstation version key: required >=999 <1000, installed ", out)
        # A hand edit to one installed file is a difference status must count.
        brief = self.base / "home" / ".claude" / "CLAUDE.md"
        brief.write_text(brief.read_text(encoding="utf-8") + "edited\n", encoding="utf-8")
        code, out = self.run_ws("status", "--overlay=none", project)
        self.assertIn("  check            1 target(s) differ; run ./workstation install\n", out)
        code, _ = self.run_ws("check", "--overlay=none")
        self.assertNotEqual(code, 0)


class LatestRelease(unittest.TestCase):
    def test_numeric_order_and_strictness(self):
        tags = ["v3.0.0", "v3.10.0", "v3.9.9", "v4.0.0-rc1", "v10", "latest", "v3.2.1"]
        self.assertEqual(ws.latest_release(tags), "v3.10.0")
        self.assertIsNone(ws.latest_release(["v1", "rc", "v2.0.0-beta"]))


GIT = ["git", "-c", "user.name=test", "-c", "user.email=test@example.invalid",
       "-c", "commit.gpgsign=false", "-c", "tag.gpgsign=false"]


@unittest.skipUnless(os.name == "posix" and shutil.which("jq") and shutil.which("git"), "needs sh, jq, git")
class UpdateAndUninstall(unittest.TestCase):
    """update and uninstall against their own synthetic origin and clone, never this checkout."""

    def git(self, cwd, *args):
        subprocess.run(GIT + list(args), cwd=cwd, check=True, capture_output=True)

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="workstation-update-")
        self.addCleanup(self.temp.cleanup)
        b = self.base = Path(self.temp.name)
        for d in ("home", "root", "tmp"):
            (b / d).mkdir()
        origin = b / "origin"
        shutil.copytree(ws.ROOT, origin, ignore=shutil.ignore_patterns(".git"))
        self.git(origin, "init", "-q")
        self.git(origin, "add", "-A")
        self.git(origin, "commit", "-q", "-m", "base")
        self.git(origin, "tag", "v9.0.0")
        with open(origin / "global" / "AGENTS.md", "a", encoding="utf-8") as fh:
            fh.write("\nline added in 9.1\n")
        self.git(origin, "commit", "-q", "-am", "next")
        self.git(origin, "tag", "v9.1.0")
        self.clone = b / "clone"
        self.git(b, "clone", "-q", str(origin), str(self.clone))
        self.git(self.clone, "checkout", "-q", "v9.0.0")
        self.env = {"PATH": os.environ["PATH"], "HOME": str(b / "home"), "TMPDIR": str(b / "tmp"),
                    "WORKSTATION_MANAGED_ROOT": str(b / "root")}

    def ws(self, *args):
        p = subprocess.run([str(self.clone / "workstation")] + list(args) + ["--overlay=none"], env=self.env,
                           capture_output=True, text=True)
        return p.returncode, p.stdout + p.stderr

    def head(self):
        return subprocess.run(["git", "-C", str(self.clone), "describe", "--tags", "--exact-match"],
                              capture_output=True, text=True).stdout.strip()

    def stamp(self):
        return ws.stamp_in(self.base / "home" / ".claude" / "CLAUDE.md")

    def test_update_latest_given_dirty_and_unknown(self):
        code, out = self.ws("update")
        self.assertEqual(code, 0, out)
        self.assertEqual(self.head(), "v9.1.0")
        self.assertTrue(self.stamp().startswith("release: v9.1.0; commit: "), self.stamp())
        code, out = self.ws("update", "v9.0.0")
        self.assertEqual(code, 0, out)
        self.assertEqual(self.head(), "v9.0.0")
        self.assertTrue(self.stamp().startswith("release: v9.0.0; commit: "), self.stamp())
        for ref in ("v8.0.0", "main"):
            code, out = self.ws("update", ref)
            self.assertEqual(code, 2, out)
            self.assertEqual(self.head(), "v9.0.0")
        with open(self.clone / "README.md", "a", encoding="utf-8") as fh:
            fh.write("local edit\n")
        code, out = self.ws("update")
        self.assertEqual(code, 3, out)
        self.assertIn("REFUSE  the working tree has 1 tracked change(s)", out)
        self.assertEqual(self.head(), "v9.0.0")
        self.assertTrue(self.stamp().startswith("release: v9.0.0; commit: "), self.stamp())

    def test_uninstall_removes_ours_and_keeps_the_rest(self):
        code, out = self.ws("install")
        self.assertEqual(code, 0, out)
        home = self.base / "home"
        settings = home / ".claude" / "settings.json"
        doc = json.loads(settings.read_text(encoding="utf-8"))
        doc["mine"] = 1
        doc["permissions"]["deny"].append("Bash(mytool:*)")
        settings.write_text(json.dumps(doc), encoding="utf-8")
        (home / ".codex" / "notes.md").write_text("mine\n", encoding="utf-8")
        code, out = self.ws("uninstall")
        self.assertEqual(code, 0, out)
        left = [p for p in home.rglob("*") if p.is_file() and not p.name.endswith("pmhwc-backup")
                and ws.MARKER in p.read_text(encoding="utf-8", errors="replace")]
        self.assertEqual(left, [])
        self.assertEqual(json.loads(settings.read_text(encoding="utf-8")),
                         {"mine": 1, "permissions": {"deny": ["Bash(mytool:*)"]}})
        self.assertEqual((home / ".codex" / "notes.md").read_text(encoding="utf-8"), "mine\n")
        self.assertIn("ADMIN   not installed", out)

    def test_uninstall_prints_the_admin_sudo_line(self):
        self.ws("install")
        _, out = self.ws("install", "--admin")
        stage = re.search(r'--apply="([^"]+)"', out).group(1)
        digest = re.search(r"--sha256=([0-9a-f]+)", out).group(1)
        subprocess.run(["/bin/sh", str(self.clone / "global" / "install-managed.sh"), "--apply=" + stage,
                        "--sha256=" + digest, "--root=" + str(self.base / "root")],
                       check=True, capture_output=True)
        code, out = self.ws("uninstall")
        self.assertEqual(code, 0, out)
        self.assertRegex(out, r"(?m)^RUN     sudo /bin/sh .*install-managed\.sh\" --remove")


if __name__ == "__main__":
    unittest.main(verbosity=1)
