#!/usr/bin/env python3
"""Regression tests for ./mhw, formerly ./workstation (Issues #57 and #67): the version-key comparison and the status
output. Throwaway HOME and admin root only; never a real configuration, never sudo.

    python3 -B global/workstation_test.py
"""
import json
import contextlib
import io
import os
from pathlib import Path
import platform
import re
import shlex
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent))
import workstation as ws  # noqa: E402

# PR #146 lens H1: install writes the paste wrapper block into the start-up file of $SHELL (or
# $ZDOTDIR). Pinned to a shell install knows no file for, so no run here writes a start-up file.
os.environ.pop("ZDOTDIR", None)
os.environ.pop("PMHWC_PASTE_WRAPPER", None)
os.environ["SHELL"] = "/bin/sh"

STAMP = "release: v3.1.0; commit: " + "a" * 40
# Fixture names the status view used to export; the status view is Node since #493 (S22 of #470), so
# the install cases that still build these files name them here.
KEY_FILE = ".workstation-version"
PASTE = "clipboard_guard.py"
GUARD = "hitl-escalation-guard.sh"
# The installer's own FLOOR line for a user-only floor, word for word (global/install.sh).
USER_FLOOR = ("the user layer only; a session flag can drop it (--setting-sources project, measured); install the "
              "admin copy with ./mhw install --admin")


class BriefText(unittest.TestCase):
    """The user-level brief's sections the session-start rules live in (Issue #80)."""

    def test_brief_names_the_summary_command(self):
        brief = (ws.HERE / "AGENTS.md").read_text(encoding="utf-8")
        section = brief.split("## Session-start runtime summary", 1)[1].split("\n## ", 1)[0]
        section = " ".join(section.split())
        for needle in ("mhw status --summary", "mhw status --verbose", "Claude Code `/status`",
                       "Codex `/status`", "Kiro `/context show` and `/tools`", "agent harness"):
            with self.subTest(needle=needle):
                self.assertIn(needle, section)

    def test_brief_anchors_the_session_goal(self):
        # Issue #11, #65: agree the objective in one line at session start, native /goal where present.
        brief = (ws.HERE / "AGENTS.md").read_text(encoding="utf-8")
        self.assertIn("\n## Session goal anchor\n", brief)
        section = brief.split("## Session goal anchor", 1)[1].split("\n## ", 1)[0]
        section = " ".join(section.split())
        for needle in ("objective with the owner in one line", "Claude Code `/goal`", "Codex `/goal`",
                       "Kiro CLI `/goal`", "first reply", "not a hook"):
            with self.subTest(needle=needle):
                self.assertIn(needle, section)

    def brief_section(self, heading):
        brief = (ws.HERE / "AGENTS.md").read_text(encoding="utf-8")
        self.assertIn("\n## " + heading + "\n", brief)
        return " ".join(brief.split("\n## " + heading + "\n", 1)[1].split("\n## ", 1)[0].split())

    def test_brief_defines_the_session_close(self):
        # ADR-0035 decision 10: the close line plus evidence; never ask whether to close.
        section = self.brief_section("Session close")
        for needle in ("`Objective reached: <objective>`", "evidence", "Never ask him whether to close",
                       "what is left", "not a hook"):
            with self.subTest(needle=needle):
                self.assertIn(needle, section)

    def test_brief_keeps_hooks_for_existential_risk(self):
        # ADR-0035 decision 6: the principle as a rule, cc-status as the one exception with its measured
        # context cost, leftovers named as leftovers, all at instruction level.
        section = self.brief_section("Hooks only for existential risk")
        for needle in ("Use hooks on this workstation only to mitigate existential risk",
                       "The one declared exception", "`cc-status`", "make no permission decision",
                       "one-line output is added to the model's context on",
                       "each prompt submit and at session start (measured 2026-10-10)",
                       "leftover to remove, not an exception; `mhw status` lists it", "not enforcement"):
            with self.subTest(needle=needle):
                self.assertIn(needle, section)


class InstallLines(unittest.TestCase):
    """Issue #145: what install says about the settings it writes."""

    def test_an_owner_value_is_a_pending_write_and_no_owner_step(self):
        """Issue #145: install overwrites an owner's model value, so --check counts it as a pending write,
        and install names no owner step for it (no "delete the key and run install again")."""
        drift = ["DRIFT   /h/.claude/settings.json: install would change model \"opus[1m]\" -> "
                 "\"claude-opus-5-5[1m]\" (model defaults claude-code)",
                 "OK      /h/.codex/config.toml: x (model defaults codex)"]
        self.assertEqual(ws.issues(drift), 1)
        changed = ["CHANGED /h/.claude/settings.json: model \"opus[1m]\" -> \"claude-opus-5-5[1m]\" "
                   "(model defaults claude-code; previous file kept as /h/.claude/settings.json.pmhwc-models-backup)"]
        self.assertEqual(ws.issues(changed), 0)
        self.assertEqual(ws.owner_steps(drift + changed), [])

    def test_changed_lines_are_always_shown(self):
        """Issue #145: every setting install replaces is shown old -> new, without --verbose."""
        import contextlib
        import io
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            ws.show(["OK      /h/a", "CHANGED /h/.zshrc: paste-wrapper start-up block absent -> present (new file)",
                     "WROTE   /h/b"], verbose=False)
        self.assertEqual(buf.getvalue().splitlines(),
                         ["    CHANGED /h/.zshrc: paste-wrapper start-up block absent -> present (new file)"])


@unittest.skipUnless(os.name == "posix" and shutil.which("jq"), "needs a POSIX sh and jq")
class EndToEnd(unittest.TestCase):
    """The real installers in a throwaway HOME and admin root: install, then check. The status view of the
    same installs is Node since #493 (S22 of #470): test/status/status-golden.test.js (cases user-only,
    user-only-projects, drift) holds what this test used to assert about it, with a stand-in gh and stub
    agent harness CLIs instead of the ones on this machine's PATH."""

    def run_ws(self, *args):
        p = subprocess.run([str(ws.ROOT / "mhw")] + list(args), env=self.env, cwd=self.base,
                           capture_output=True, text=True)
        return p.returncode, p.stdout

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="workstation-e2e-")
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name)
        for d in ("home", "root", "tmp"):
            (self.base / d).mkdir()
        empty = self.base / "prereq.json"
        empty.write_text('{"lanes": {}, "items": []}', encoding="utf-8")
        self.env = {"PATH": os.environ["PATH"], "HOME": str(self.base / "home"),
                    "TMPDIR": str(self.base / "tmp"), "WORKSTATION_MANAGED_ROOT": str(self.base / "root"),
                    "WORKSTATION_PREREQUISITES": str(empty)}

    def test_install_then_check(self):
        code, out = self.run_ws("install", "--yes", "--no-admin", "--overlay=none")
        self.assertEqual(code, 0, out)
        self.assertIn("\nInstallation successful!\n", out)
        self.assertNotIn("System-wide", out)
        # --overlay=none reached the installer: the brief names no overlay as its source.
        marker = (self.base / "home" / ".claude" / "CLAUDE.md").read_text(encoding="utf-8").splitlines()[0]
        self.assertIn("source: global/AGENTS.md;", marker)
        code, out = self.run_ws("check", "--overlay=none")
        self.assertEqual(code, 0, out)
        # A hand edit to one installed file is a difference check must fail on.
        brief = self.base / "home" / ".claude" / "CLAUDE.md"
        brief.write_text(brief.read_text(encoding="utf-8") + "edited\n", encoding="utf-8")
        code, out = self.run_ws("check", "--overlay=none")
        self.assertNotEqual(code, 0, out)


@unittest.skipUnless(os.name == "posix" and shutil.which("jq") and os.access("/usr/bin/python3", os.X_OK),
                     "needs a POSIX sh, jq and /usr/bin/python3")
class StaleAdminLayer(unittest.TestCase):
    """Issue #52: an admin layer an earlier release installed (v2.1.0: no #66 stamp key, the restart
    guard, the picker guard with its session-intake exception, timed breaking-glass) must never read as
    absent or current. A plain install, check and status report it by name and fail; install --admin and
    its one line (root override, never sudo) clear it."""

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="workstation-stale-")
        self.addCleanup(self.temp.cleanup)
        b = self.base = Path(self.temp.name)
        for d in ("home", "root", "tmp", "proj"):
            (b / d).mkdir()
        empty = b / "prereq.json"
        empty.write_text('{"lanes": {}, "items": []}', encoding="utf-8")
        self.env = {"PATH": os.environ["PATH"], "HOME": str(b / "home"), "TMPDIR": str(b / "tmp"),
                    "WORKSTATION_MANAGED_ROOT": str(b / "root"), "WORKSTATION_PREREQUISITES": str(empty)}
        root = str(b / "root")
        darwin = sys.platform == "darwin"
        admin = Path(root + ("/Library/Application Support/" if darwin else "/etc/") + ws.NAME)
        dropin = Path(root + ("/Library/Application Support/ClaudeCode" if darwin else "/etc/claude-code")
                      + "/managed-settings.d/50-%s.json" % ws.NAME)
        bin_dir = admin / "bin"
        bin_dir.mkdir(parents=True)
        (admin / "breaking-glass").mkdir()
        for name in ("restart_guard.py", "breaking_glass.py", "hitl-escalation-guard.sh", "hitl.conf",
                     PASTE, "clipboard.conf"):
            (bin_dir / name).write_text("# v2.1.0\n", encoding="utf-8")

        def hook(cmd):
            return [{"hooks": [{"type": "command", "command": cmd}]}]
        restart = '/usr/bin/python3 -I -B "%s" --harness claude-code' % (bin_dir / "restart_guard.py")
        # The v2.1.0 drop-in shape, measured from install-managed.sh at tag v2.1.0: no stamp key.
        dropin.parent.mkdir(parents=True)
        dropin.write_text(json.dumps({"hooks": {
            "SessionStart": hook(restart),
            "PreToolUse": hook(restart) + hook('/bin/sh "%s"' % (bin_dir / GUARD)),
            "UserPromptSubmit": hook('/usr/bin/python3 -I -B "%s" prompt-hook' % (bin_dir / PASTE))}}),
            encoding="utf-8")
        req = Path(root + "/etc/codex/requirements.toml")
        req.parent.mkdir(parents=True)
        req.write_text("# %s; source: global/install-managed.sh; version: 2.1.0\n[hooks]\n"
                       "[[hooks.SessionStart]]\n[[hooks.SessionStart.hooks]]\ntype = \"command\"\n"
                       "command = \"/usr/bin/python3 -I -B \\\"%s\\\" --harness codex\"\n"
                       % (ws.MARKER, bin_dir / "restart_guard.py"), encoding="utf-8")

    def run_ws(self, *args):
        p = subprocess.run([str(ws.ROOT / "mhw")] + list(args) + ["--overlay=none"], env=self.env,
                           cwd=self.base, capture_output=True, text=True)
        return p.returncode, p.stdout + p.stderr

    def assert_named(self, out, prefix):
        self.assertIn(prefix + "STALE restart_guard.py, breaking_glass.py, hitl-escalation-guard.sh, hitl.conf, "
                      "clipboard_guard.py, breaking-glass\n", out)
        self.assertIn(prefix + "removed controls still installed: restart guard, picker guard, session intake "
                      "(the picker guard's intake exception), timed breaking-glass\n", out)
        self.assertRegex(out, r"(?m)^%sDRIFT .*clipboard\.conf" % re.escape(prefix))  # #488: the Python core is STALE now
        self.assertIn(prefix + ws.ADMIN_NEXT + "\n", out)

    def test_install_without_a_terminal_informs_then_yes_clears_it(self):
        # No terminal and no --yes: it says what it would change, changes nothing and exits 0.
        code, out = self.run_ws("install")
        self.assertEqual(code, 0, out)
        self.assertRegex(out, r"(?m)^  - System-wide protections: \d+ file\(s\) to update \(needs your "
                              r"administrator password, once\)$")
        self.assertIn("Nothing was changed: no terminal to confirm in.", out)
        self.assertNotIn("Installation successful!", out)
        code, out = self.run_ws("check")
        self.assertNotEqual(code, 0, out)
        self.assert_named(out, "ADMIN   ")
        # What status says about this admin layer is the S22 golden stale-admin-layer (#493), with a
        # stand-in gh; this test no longer runs status on this machine's PATH.

        # One install: the admin layer first (root override, so no sudo), then the user layer.
        code, out = self.run_ws("install", "--yes")
        self.assertEqual(code, 0, out)
        self.assertIn("==> Installing the system-wide protections\n", out)
        self.assertIn("\nInstallation successful!\n", out)
        self.assertNotRegex(out, r"(?m)^(RUN|STAGED|FLOOR|ADMIN|THEN) ")
        code, out = self.run_ws("install", "--yes")
        self.assertEqual(code, 0, out)
        self.assertIn("==> This workstation already matches this checkout\n", out)
        code, out = self.run_ws("check")
        self.assertEqual(code, 0, out)
        self.assertNotIn("STALE", out)


class Overlay(unittest.TestCase):
    def test_only_none_or_an_existing_directory(self):
        self.assertEqual(ws.valid_overlay("none"), "none")
        with tempfile.TemporaryDirectory(prefix="workstation-overlay-") as d:
            here = os.getcwd()
            os.chdir(d)
            try:
                os.mkdir("prof")
                Path("file").write_text("x", encoding="utf-8")
                self.assertEqual(ws.valid_overlay("prof"), str((Path(d) / "prof").resolve()))
                for bad in ("file", "missing", "", "-x", "--hooks=user", "a\0b"):
                    with self.subTest(bad=bad):
                        self.assertIsNone(ws.valid_overlay(bad))
            finally:
                os.chdir(here)

    def test_main_refuses_before_running_anything(self):
        calls = []
        real = ws.run
        ws.run = lambda *a, **k: calls.append(a) or (0, [])
        try:
            for cmd in ("install", "check", "uninstall", "update"):  # status: test/status/status.test.js (#493)
                with self.subTest(cmd=cmd):
                    self.assertEqual(ws.main([cmd, "--overlay=/nonexistent/overlay/dir"]), 2)
        finally:
            ws.run = real
        self.assertEqual(calls, [])

    def test_overlay_travels_in_the_environment_not_argv(self):
        calls = []
        real, saved = ws.run, os.environ.get(ws.OVERLAY_ENV)
        ws.run = lambda *a, **k: calls.append(a[0]) or (0, [])
        # The prerequisites section (#89) reads this machine's PATH; an empty declaration keeps it out.
        empty = tempfile.NamedTemporaryFile("w", suffix=".json", delete=False)
        empty.write('{"lanes": {}, "items": []}')
        empty.close()
        os.environ["WORKSTATION_PREREQUISITES"] = empty.name
        try:
            self.assertEqual(ws.main(["check", "--overlay=none"]), 0)
            self.assertEqual(os.environ.get(ws.OVERLAY_ENV), "none")
        finally:
            ws.run = real
            os.environ.pop("WORKSTATION_PREREQUISITES", None)
            os.unlink(empty.name)
            if saved is None:
                os.environ.pop(ws.OVERLAY_ENV, None)
            else:
                os.environ[ws.OVERLAY_ENV] = saved
        self.assertTrue(calls)
        self.assertFalse([a for argv in calls for a in argv if "overlay" in a])


class LatestRelease(unittest.TestCase):
    def test_numeric_order_and_strictness(self):
        tags = ["v3.0.0", "v3.10.0", "v3.9.9", "v4.0.0-rc1", "v10", "latest", "v3.2.1"]
        self.assertEqual(ws.latest_release(tags), "v3.10.0")
        self.assertIsNone(ws.latest_release(["v1", "rc", "v2.0.0-beta"]))


# gc.auto=0 and maintenance.auto=false: whether a commit triggers a detached auto-gc depends on how the
# object hashes fall (git samples one objects/ subdirectory), so some tree contents raced the clone below
# with "unable to read tree". The fixture never needs a gc.
GIT = ["git", "-c", "user.name=test", "-c", "user.email=test@example.invalid",
       "-c", "commit.gpgsign=false", "-c", "tag.gpgsign=false",
       "-c", "gc.auto=0", "-c", "maintenance.auto=false"]


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
        p = subprocess.run([str(self.clone / "mhw")] + list(args) + ["--overlay=none"], env=self.env,
                           capture_output=True, text=True)
        return p.returncode, p.stdout + p.stderr

    def head(self):
        return subprocess.run(["git", "-C", str(self.clone), "describe", "--tags", "--exact-match"],
                              capture_output=True, text=True).stdout.strip()

    def stamp(self):
        return ws.stamp_in(self.base / "home" / ".claude" / "CLAUDE.md")

    def test_update_latest_given_dirty_and_unknown(self):
        code, out = self.ws("update", "--yes")
        self.assertEqual(code, 0, out)
        self.assertEqual(self.head(), "v9.1.0")
        self.assertTrue(self.stamp().startswith("release: v9.1.0; commit: "), self.stamp())
        code, out = self.ws("update", "v9.0.0", "--yes")
        self.assertEqual(code, 0, out)
        self.assertEqual(self.head(), "v9.0.0")
        self.assertTrue(self.stamp().startswith("release: v9.0.0; commit: "), self.stamp())
        for ref in ("v8.0.0", "main"):
            code, out = self.ws("update", ref)
            self.assertEqual(code, 2, out)
            self.assertEqual(self.head(), "v9.0.0")
        # A release that predates ./workstation cannot receive --overlay: refused before any checkout.
        origin = self.base / "origin"
        self.git(origin, "rm", "-q", "global/workstation.py")
        self.git(origin, "commit", "-q", "-m", "old shape")
        self.git(origin, "tag", "v1.0.0")
        code, out = self.ws("update", "v1.0.0")
        self.assertEqual(code, 2, out)
        self.assertIn("predates ./mhw (then ./workstation)", out)
        self.assertEqual(self.head(), "v9.0.0")
        with open(self.clone / "README.md", "a", encoding="utf-8") as fh:
            fh.write("local edit\n")
        code, out = self.ws("update")
        self.assertEqual(code, 3, out)
        self.assertIn("REFUSE  the working tree has 1 tracked change(s)", out)
        self.assertEqual(self.head(), "v9.0.0")
        self.assertTrue(self.stamp().startswith("release: v9.0.0; commit: "), self.stamp())

    def test_uninstall_removes_ours_and_keeps_the_rest(self):
        home = self.base / "home"
        settings = home / ".claude" / "settings.json"
        settings.parent.mkdir(parents=True)
        # A rule the owner wrote himself that equals a floor rule: ours to keep, never to remove.
        settings.write_text(json.dumps({"permissions": {"deny": ["Bash(sudo:*)"]}}), encoding="utf-8")
        code, out = self.ws("install", "--yes", "--no-admin")
        self.assertEqual(code, 0, out)
        doc = json.loads(settings.read_text(encoding="utf-8"))
        doc["mine"] = 1
        doc["permissions"]["deny"].append("Bash(mytool:*)")
        settings.write_text(json.dumps(doc), encoding="utf-8")
        (home / ".codex" / "notes.md").write_text("mine\n", encoding="utf-8")
        code, out = self.ws("uninstall")
        self.assertEqual(code, 0, out)
        self.assertIn("Nothing was changed: no terminal to confirm in.", out)
        code, out = self.ws("uninstall", "--yes")
        self.assertEqual(code, 0, out)
        left = [p for p in home.rglob("*") if p.is_file() and not p.name.endswith("pmhwc-backup")
                and ws.MARKER in p.read_text(encoding="utf-8", errors="replace")]
        self.assertEqual(left, [])
        self.assertEqual(json.loads(settings.read_text(encoding="utf-8")),
                         {"mine": 1, "permissions": {"deny": ["Bash(sudo:*)", "Bash(mytool:*)"]}})
        self.assertEqual((home / ".codex" / "notes.md").read_text(encoding="utf-8"), "mine\n")
        self.assertNotIn("System-wide", out)
        self.assertIn("\nUninstall complete.\n", out)

    def test_uninstall_removes_the_admin_layer_too(self):
        code, out = self.ws("install", "--yes")
        self.assertEqual(code, 0, out)
        root = self.base / "root"
        self.assertTrue(any(p.is_file() for p in root.rglob("*")), out)
        code, out = self.ws("uninstall", "--yes")
        self.assertEqual(code, 0, out)
        self.assertIn("==> Removing the system-wide protections\n", out)
        self.assertNotIn("sudo", out)
        self.assertEqual([p for p in root.rglob("*") if p.is_file()], [])


@unittest.skipUnless(os.name == "posix" and shutil.which("jq"), "needs a POSIX sh, a pty and jq")
class InstallConversation(unittest.TestCase):
    """Issue #113: the install in a real terminal (a pty): RETURN installs, any other key aborts."""

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="workstation-pty-")
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name)
        for d in ("home", "root", "tmp"):
            (self.base / d).mkdir()
        self.env = {"PATH": os.environ["PATH"], "HOME": str(self.base / "home"), "TERM": "dumb",
                    "NO_COLOR": "1", "TMPDIR": str(self.base / "tmp"),
                    "WORKSTATION_MANAGED_ROOT": str(self.base / "root")}

    def in_terminal(self, key, *args):
        import pty
        import select
        main_fd, sub_fd = pty.openpty()
        p = subprocess.Popen([str(ws.ROOT / "mhw")] + list(args) + ["--overlay=none"], env=self.env,
                             stdin=sub_fd, stdout=sub_fd, stderr=sub_fd, close_fds=True)
        os.close(sub_fd)
        out, sent = b"", False
        while True:
            ready, _, _ = select.select([main_fd], [], [], 60)
            if not ready:
                p.kill()
                self.fail("no output within 60s: %r" % out)
            try:
                chunk = os.read(main_fd, 4096)
            except OSError:
                break
            if not chunk:
                break
            out += chunk
            if not sent and b"any other key to abort:" in out:
                os.write(main_fd, key)
                sent = True
        os.close(main_fd)
        return p.wait(), out.decode("utf-8", "replace").replace("\r\n", "\n")

    def test_return_installs_and_another_key_aborts(self):
        code, out = self.in_terminal(b"n", "install")
        self.assertEqual(code, 1, out)
        self.assertIn("Aborted; nothing was changed.", out)
        self.assertFalse((self.base / "home" / ".claude" / "CLAUDE.md").exists())
        code, out = self.in_terminal(b"\r", "install")
        self.assertEqual(code, 0, out)
        self.assertIn("Installation successful!", out)
        self.assertRegex(out, r"(?m)^1\. Open new Claude Code, Codex and Kiro sessions")
        self.assertTrue((self.base / "home" / ".claude" / "CLAUDE.md").exists())
        # Short: the result and the next steps, not the installers' lines (about 40 in v4.2.1).
        self.assertLessEqual(len(out.strip().splitlines()), 20, out)


@unittest.skipUnless(os.name == "posix" and shutil.which("jq"), "needs a POSIX sh and jq")
class AdminNotInstalled(unittest.TestCase):
    """PR #114 lens: when the planned admin layer is not installed, the result is not a success."""

    def test_skipped_admin_layer_is_partly_installed(self):
        import contextlib
        import io
        temp = tempfile.TemporaryDirectory(prefix="workstation-partial-")
        self.addCleanup(temp.cleanup)
        base = Path(temp.name)
        for d in ("home", "root", "tmp"):
            (base / d).mkdir()
        saved_env = dict(os.environ)
        saved_sudo = ws.admin_access
        os.environ.update({"HOME": str(base / "home"), "TMPDIR": str(base / "tmp"),
                           "WORKSTATION_MANAGED_ROOT": str(base / "root"), ws.OVERLAY_ENV: "none"})
        # Both win over HOME in the installers (the model-defaults record and Codex's config): a leaked
        # value would let this test edit the real files (PR #119 review).
        os.environ.pop("XDG_DATA_HOME", None)
        os.environ.pop("CODEX_HOME", None)
        ws.admin_access = lambda asking: False
        out = io.StringIO()
        try:
            with contextlib.redirect_stdout(out):
                code = ws.cmd_install(yes=True)
        finally:
            ws.admin_access = saved_sudo
            os.environ.clear()
            os.environ.update(saved_env)
        text = out.getvalue()
        self.assertEqual(code, 1, text)
        self.assertIn("Partly installed: your settings are in place; the system-wide protections are not.", text)
        self.assertNotIn("Installation successful!", text)
        self.assertRegex(text, r"(?m)^1\. Run `\S+ install` in a terminal to install the system-wide protections")
        self.assertTrue((base / "home" / ".claude" / "CLAUDE.md").exists())
        self.assertEqual([p for p in (base / "root").rglob("*") if p.is_file()], [])


@unittest.skipUnless(os.name == "posix" and shutil.which("jq"), "needs a POSIX sh and jq")
class AdminNotRemoved(unittest.TestCase):
    """PR #114 lens: an uninstall that leaves the admin layer is not complete, and does not send the owner
    to npm uninstall, which would delete the only tool able to remove that layer."""

    def test_skipped_admin_removal_is_partly_removed(self):
        import contextlib
        import io
        temp = tempfile.TemporaryDirectory(prefix="workstation-partial-un-")
        self.addCleanup(temp.cleanup)
        base = Path(temp.name)
        for d in ("home", "root", "tmp"):
            (base / d).mkdir()
        env = {"HOME": str(base / "home"), "TMPDIR": str(base / "tmp"),
               "WORKSTATION_MANAGED_ROOT": str(base / "root"), ws.OVERLAY_ENV: "none"}
        saved_env, saved_access, saved_npm = dict(os.environ), ws.admin_access, ws.npm_package
        os.environ.update(env)
        os.environ.pop("XDG_DATA_HOME", None)  # see AdminNotInstalled: never the real record or Codex home
        os.environ.pop("CODEX_HOME", None)
        out = io.StringIO()
        try:
            with contextlib.redirect_stdout(out):
                self.assertEqual(ws.cmd_install(yes=True), 0, out.getvalue())
            self.assertTrue(ws.admin_present())
            ws.admin_access = lambda asking: False
            ws.npm_package = lambda root=None: True
            out = io.StringIO()
            with contextlib.redirect_stdout(out):
                code = ws.cmd_uninstall(yes=True)
            still = ws.admin_present()
        finally:
            ws.admin_access, ws.npm_package = saved_access, saved_npm
            os.environ.clear()
            os.environ.update(saved_env)
        text = out.getvalue()
        self.assertEqual(code, 1, text)
        self.assertTrue(still)
        self.assertIn("Partly removed: your settings are gone; the system-wide protections are still "
                      "installed.", text)
        self.assertNotIn("Uninstall complete.", text)
        self.assertNotIn("npm uninstall", text)
        self.assertRegex(text, r"(?m)^1\. Run `\S+ uninstall` in a terminal to remove the system-wide protections")


class OwnerSteps(unittest.TestCase):
    def test_install_sh_acts_become_next_steps(self):
        steps = ws.owner_steps([
            "NOTE    automatic paste cleaning: no shell start-up file is written (--shell-rc=none); add this "
            "line to yours:",
            '        [ -r "/h/snippet.sh" ] && . "/h/snippet.sh"',
            "RESTART REQUIRED: open fresh Claude Code and Codex sessions before further work; Codex hook "
            "trust remains an owner action in /hooks."])
        self.assertEqual(len(steps), 2, steps)
        self.assertIn('[ -r "/h/snippet.sh" ] && . "/h/snippet.sh"', steps[0])
        self.assertIn("/hooks", steps[1])
        # The step repeats install.sh's own reason; it never claims the shell is neither zsh nor bash.
        self.assertIn("(--shell-rc=none)", steps[0])
        self.assertNotIn("neither zsh nor bash", steps[0])
        fish = ws.owner_steps([
            "NOTE    automatic paste cleaning: no shell start-up file is written (your shell (SHELL=/bin/fish) "
            "is neither zsh nor bash); add this line to yours:", "        line"])
        self.assertIn("(your shell (SHELL=/bin/fish) is neither zsh nor bash)", fish[0])
        # macOS bash with only ~/.profile: ~/.bashrc got the block, so the step names the login file only.
        login = ws.owner_steps([
            "NOTE    automatic paste cleaning: no bash login start-up file is written (for a bash login shell: "
            "only ~/.profile is there, which sh also reads, and a new ~/.bash_profile would stop bash reading "
            "it); add this line to yours:", "        line"])
        self.assertEqual(len(login), 1, login)
        self.assertIn("mhw wrote no bash login start-up file (for a bash login shell: only ~/.profile", login[0])
        self.assertNotIn("no shell start-up file", login[0])
        self.assertEqual(ws.owner_steps(["OK      something"]), [])

    def test_sudo_never_runs_without_a_terminal(self):
        # Issue #113: an agent's shell has no terminal; not even cached credentials are tried there.
        calls = []
        saved_run, saved_root = ws.subprocess.run, os.environ.pop("WORKSTATION_MANAGED_ROOT", None)
        ws.subprocess.run = lambda *a, **k: calls.append(a) or subprocess.CompletedProcess(a, 0)
        try:
            self.assertFalse(ws.admin_access(False))
            self.assertTrue(ws.admin_access(True))
            self.assertEqual(calls, [])
            # One sudo call that asks for the password itself and ignores any cached credential; never
            # -n (it would rely on a cache that -k does not fill) and never -v followed by another call.
            cmd = ws.as_root(["/bin/sh", "x.sh", "--remove"])
            self.assertEqual(cmd[:2], [ws.SUDO, "-k"])
            self.assertNotIn("-n", cmd)
            self.assertNotIn("-v", cmd)
            self.assertEqual(cmd[-3:], ["/bin/sh", "x.sh", "--remove"])
        finally:
            ws.subprocess.run = saved_run
            if saved_root is not None:
                os.environ["WORKSTATION_MANAGED_ROOT"] = saved_root


if __name__ == "__main__":
    unittest.main(verbosity=1)
