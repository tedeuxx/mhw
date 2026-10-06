#!/usr/bin/env python3
"""Regression tests for ./mhw, formerly ./workstation (Issues #57 and #67): the version-key comparison and the status
output. Throwaway HOME and admin root only; never a real configuration, never sudo.

    python3 -B global/workstation_test.py
"""
import json
import os
from pathlib import Path
import re
import shlex
import shutil
import subprocess
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parent))
import workstation as ws  # noqa: E402

STAMP = "release: v3.1.0; commit: " + "a" * 40
# The installer's own FLOOR line for a user-only floor, word for word (global/install.sh).
USER_FLOOR = ("the user layer only; a session flag can drop it (--setting-sources project, measured); install the "
              "admin copy with ./mhw install --admin")


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
         "floor": USER_FLOOR, "admin_state": "absent", "hooks": "user layer (paste filter)",
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
        self.assertIn("  check            3 target(s) differ (admin layer: 2); run ./mhw install --admin first",
                      out)
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

    def test_permissions_line(self):
        out = ws.render_status(facts(permissions="Claude Code: acceptEdits (user), 37 allow rules"))
        self.assertIn("  permissions      Claude Code: acceptEdits (user), 37 allow rules", out)
        self.assertFalse(any(line.startswith("  permissions") for line in ws.render_status(facts())))

    def test_issue_count(self):
        lines = ["OK      a", "STAMP   b", "DRIFT   c", "MISSING d", "STALE   e", "SKIP    f", "FLOOR   g",
                 "NOTE    h", "SOURCE  i"]
        self.assertEqual(ws.issues(lines), 4)


class RuntimeSummary(unittest.TestCase):
    """The session-start runtime summary (Issue #80): few lines, every item the brief names."""

    def row(self, out, label):
        hits = [line for line in out if line.startswith("  %-16s " % label)]
        self.assertEqual(len(hits), 1, (label, out))
        return hits[0][19:]

    def test_every_item_in_ten_lines(self):
        out = ws.render_summary(facts())
        self.assertLessEqual(len(out), 10)
        self.assertEqual(self.row(out, "agent harness"), "Claude Code 2.1.0")
        self.assertEqual(self.row(out, "model, effort"), "Claude Code: default; the session's own values: "
                                                         "Claude Code /status")
        self.assertEqual(self.row(out, "workstation"), "v3.1.0 @ aaaaaaa · version key: >=3.1 <4 match")
        self.assertEqual(self.row(out, "layers"), "managed: absent · user: installed · workspace: proj · "
                                                  "plugin: none")
        self.assertEqual(self.row(out, "overrides"), "no workspace setting overrides a user default")
        self.assertEqual(self.row(out, "cannot override"), "nothing (no admin layer) · deny floor NOT locked: "
                                                           + USER_FLOOR)
        self.assertIn("brief installed in 2/3 agent harnesses (an instruction)", self.row(out, "protections"))
        self.assertIn("evidence: installed; loaded and enforced need a session canary",
                      self.row(out, "protections"))
        self.assertEqual(self.row(out, "permission mode"), "Claude Code: default; session flags: "
                                                           "Claude Code /status")
        self.assertEqual(self.row(out, "runtime"), "host (Linux x86_64; no container marker found)")

    def test_workspace_overrides_user_and_hooks_off_is_named(self):
        settings = [("Claude Code", "user", "permissions.defaultMode", "default"),
                    ("Claude Code", "workspace", "permissions.defaultMode", "acceptEdits"),
                    ("Claude Code", "user", "model", "opus"),
                    ("Claude Code", "user", "disableAllHooks", "true"),
                    ("Codex", "user", "approval_policy", "on-request"),
                    ("Codex", "workspace", "sandbox_mode", "workspace-write"),
                    ("Codex", "user", "model_reasoning_effort", "high")]
        out = ws.render_summary(facts(settings=settings, admin=True,
                                      harnesses={"Claude Code": "2.1.0", "Codex": "0.1", "Kiro": None}))
        self.assertEqual(self.row(out, "overrides"),
                         "HOOKS OFF: disableAllHooks in Claude Code user; Claude Code permissions.defaultMode "
                         "= acceptEdits; Codex sandbox_mode = workspace-write")
        self.assertEqual(self.row(out, "permission mode"),
                         "Claude Code: permissions.defaultMode acceptEdits (workspace) · Codex: approval_policy "
                         "on-request (user), sandbox_mode workspace-write (workspace); session flags: "
                         "Claude Code /status, Codex /status")
        self.assertEqual(self.row(out, "model, effort"),
                         "Claude Code: model opus (user) · Codex: model_reasoning_effort high (user); "
                         "the session's own values: Claude Code /status, Codex /status")
        self.assertEqual(self.row(out, "cannot override"),
                         "managed layer (admin-owned) · deny floor NOT locked: " + USER_FLOOR)

    def test_floor_is_locked_only_in_the_admin_layer(self):
        admin_floor = "the admin layer; the user copy stays as a fallback until it is retired (ADR-0016)"
        out = ws.render_summary(facts(admin=True, admin_state="installed", floor=admin_floor))
        self.assertEqual(self.row(out, "cannot override"), "managed layer (admin-owned) · deny floor: " + admin_floor)
        none = "NO complete layer; run ./mhw install, then ./mhw install --admin"
        out = ws.render_summary(facts(floor=none))
        self.assertEqual(self.row(out, "cannot override"), "nothing (no admin layer) · deny floor NOT locked: " + none)

    def test_legacy_dropin_is_never_absent(self):
        for state, want in (("legacy", "installed (legacy, pre-#66; reinstall to update)"),
                            ("unreadable", "present, not read"), ("absent", "absent")):
            with self.subTest(state=state):
                out = ws.render_summary(facts(admin_state=state))
                self.assertTrue(self.row(out, "layers").startswith("managed: %s · " % want))
                status = ws.render_status(facts(admin_state=state))
                self.assertTrue(any(line.startswith("  layers           managed: %s · " % want) for line in status))
        status = ws.render_status(facts(admin_state="legacy"))
        self.assertIn("  installed        user: v3.1.0 @ aaaaaaa · admin: installed (legacy, pre-#66; reinstall "
                      "to update)", status)
        self.assertTrue(self.row(ws.render_summary(facts(admin_state="legacy")), "cannot override")
                        .startswith("managed layer (admin-owned) · deny floor NOT locked: "))

    def test_mismatch_and_no_harness(self):
        line = ws.mismatch_line(">=3.1 <4", "v3.0.0")
        out = ws.render_summary(facts(key={"required": ">=3.1 <4", "state": "mismatch", "line": line},
                                      harnesses={"Claude Code": None, "Codex": None, "Kiro": None}))
        self.assertEqual(out[-1], "  " + line)
        self.assertLessEqual(len(out), 11)
        self.assertEqual(self.row(out, "agent harness"), "none detected on PATH")
        self.assertIn("Kiro: not read by this view", self.row(out, "model, effort"))
        self.assertIn("Kiro /context show, /tools", self.row(out, "model, effort"))

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


class Settings(unittest.TestCase):
    def test_reads_user_and_workspace_layers(self):
        with tempfile.TemporaryDirectory(prefix="workstation-settings-") as d:
            base = Path(d)
            saved = {k: os.environ.get(k) for k in ("HOME", "CODEX_HOME")}
            os.environ["HOME"] = str(base / "home")
            os.environ.pop("CODEX_HOME", None)
            try:
                (base / "home" / ".claude").mkdir(parents=True)
                (base / "home" / ".codex").mkdir()
                (base / "proj" / ".claude").mkdir(parents=True)
                (base / "home" / ".claude" / "settings.json").write_text(json.dumps(
                    {"model": "opus", "permissions": {"defaultMode": "plan", "deny": ["x"]}}), encoding="utf-8")
                (base / "proj" / ".claude" / "settings.json").write_text(json.dumps(
                    {"disableAllHooks": True}), encoding="utf-8")
                (base / "home" / ".codex" / "config.toml").write_text(
                    'model = "gpt-x"  # note\napproval_policy = \'never\'\n[profiles.a]\nsandbox_mode = "x"\n',
                    encoding="utf-8")
                got = ws.read_settings(base / "proj")
            finally:
                for k, v in saved.items():
                    if v is None:
                        os.environ.pop(k, None)
                    else:
                        os.environ[k] = v
        self.assertEqual(got, [("Claude Code", "user", "model", "opus"),
                               ("Claude Code", "user", "permissions.defaultMode", "plan"),
                               ("Claude Code", "workspace", "disableAllHooks", "true"),
                               ("Codex", "user", "approval_policy", "never"),
                               ("Codex", "user", "model", "gpt-x")])


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
        # --overlay=none reached the installer: the brief names no overlay as its source.
        marker = (self.base / "home" / ".claude" / "CLAUDE.md").read_text(encoding="utf-8").splitlines()[0]
        self.assertIn("source: global/AGENTS.md;", marker)
        self.assertIn("  version key      >=999 <1000: mismatch\n", out)
        self.assertIn("Workstation version key: required >=999 <1000, installed ", out)
        self.assertIn("hooks registered: admin: none · user: "
                      "paste filter (Claude Code), paste filter (Codex)\n", out)
        # The allow list (Issue #83): no admin floor, so the narrow tier, sized from the source itself.
        conf = (ws.HERE / "allow-list.conf").read_text(encoding="utf-8").splitlines()
        narrow = sum(1 for line in conf if line.startswith("narrow "))
        self.assertIn("  permissions      Claude Code: default (none set), %d allow rules · Codex: profile "
                      "workstation (on-request, read-only; with --profile workstation), %d allow rules · Kiro: agent "
                      "workstation, %d trusted commands\n" % (narrow, narrow, narrow), out)
        # The summary is fed by the same gathered facts: same stamp, key and hooks as the status view.
        code, out = self.run_ws("status", "--summary", "--overlay=none", project)
        self.assertEqual(code, 0)
        self.assertLessEqual(len(out.splitlines()), 11, out)
        self.assertIn("  workstation      %s · version key: >=999 <1000 mismatch\n" % source.split(" (")[0], out)
        self.assertIn("· hooks admin: none · user: paste filter (Claude Code)", out)
        self.assertRegex(out, r"(?m)^  Workstation version key: required >=999 <1000, installed ")
        # No admin layer: the floor is never listed as locked, and the installer's words arrive whole.
        _, verbose = self.run_ws("status", "--verbose", "--overlay=none", project)
        carried = re.search(r"(?m)^  \| FLOOR   carried by: (.*)$", verbose).group(1)
        self.assertIn("  cannot override  nothing (no admin layer) · deny floor NOT locked: %s\n" % carried, out)
        # The hooks moved out of the user layer with no admin layer: status must say none, not claim them.
        subprocess.run(["sh", str(ws.INSTALL), "--overlay=none", "--hooks=managed"], env=self.env,
                       capture_output=True, check=False)
        code, out = self.run_ws("status", "--overlay=none", project)
        self.assertIn("hooks registered: admin: none · user: none\n", out)
        code, out = self.run_ws("install", "--overlay=none")
        # A hand edit to one installed file is a difference status must count.
        brief = self.base / "home" / ".claude" / "CLAUDE.md"
        brief.write_text(brief.read_text(encoding="utf-8") + "edited\n", encoding="utf-8")
        code, out = self.run_ws("status", "--overlay=none", project)
        self.assertIn("  check            1 target(s) differ; run ./mhw install\n", out)
        code, _ = self.run_ws("check", "--overlay=none")
        self.assertNotEqual(code, 0)


@unittest.skipUnless(os.name == "posix" and shutil.which("jq"), "needs a POSIX sh and jq")
class GatherLegacyDropin(unittest.TestCase):
    """Through gather(), with a workspace version key AND a pre-#66 admin drop-in: the managed layer
    must read legacy, never absent (the key's own verdict once overwrote the managed state)."""

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="workstation-gather-")
        self.addCleanup(self.temp.cleanup)
        b = Path(self.temp.name)
        for d in ("home", "root", "tmp", "proj"):
            (b / d).mkdir()
        keys = ("HOME", "TMPDIR", "WORKSTATION_MANAGED_ROOT", "XDG_DATA_HOME", "CODEX_HOME", ws.OVERLAY_ENV)
        saved = {k: os.environ.get(k) for k in keys}

        def restore():
            for k, v in saved.items():
                if v is None:
                    os.environ.pop(k, None)
                else:
                    os.environ[k] = v
        self.addCleanup(restore)
        os.environ.update({"HOME": str(b / "home"), "TMPDIR": str(b / "tmp"),
                           "WORKSTATION_MANAGED_ROOT": str(b / "root"), ws.OVERLAY_ENV: "none"})
        os.environ.pop("XDG_DATA_HOME", None)
        os.environ.pop("CODEX_HOME", None)
        self.proj = b / "proj"
        (self.proj / ws.KEY_FILE).write_text(">=3.1 <4\n", encoding="utf-8")

    def test_key_present_and_legacy_dropin(self):
        subprocess.run(["sh", str(ws.INSTALL), "--hooks=user"], capture_output=True, check=True)
        # The pre-#66 drop-in shape (install-managed.sh at 3742ffa): hooks and deny, no stamp key.
        legacy = {"hooks": {"PreToolUse": [{"matcher": "AskUserQuestion", "hooks": [
                      {"type": "command", "command": "/bin/sh /x/" + ws.GUARD, "timeout": 5}]}]},
                  "permissions": {"deny": ["Bash(sudo:*)"]}}
        ws.admin_dropin().parent.mkdir(parents=True)
        ws.admin_dropin().write_text(json.dumps(legacy), encoding="utf-8")
        f = ws.gather(str(self.proj))
        self.assertIn(f["key"]["state"], ("match", "mismatch"))
        self.assertEqual(f["admin_state"], "legacy")
        layers = [line for line in ws.render_summary(f) if line.startswith("  layers ")][0]
        self.assertIn("managed: installed (legacy, pre-#66; reinstall to update) · ", layers)
        self.assertTrue(any("managed: installed (legacy" in line for line in ws.render_status(f)))


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
                     ws.PASTE, "clipboard.conf"):
            (bin_dir / name).write_text("# v2.1.0\n", encoding="utf-8")

        def hook(cmd):
            return [{"hooks": [{"type": "command", "command": cmd}]}]
        restart = '/usr/bin/python3 -I -B "%s" --harness claude-code' % (bin_dir / "restart_guard.py")
        # The v2.1.0 drop-in shape, measured from install-managed.sh at tag v2.1.0: no stamp key.
        dropin.parent.mkdir(parents=True)
        dropin.write_text(json.dumps({"hooks": {
            "SessionStart": hook(restart),
            "PreToolUse": hook(restart) + hook('/bin/sh "%s"' % (bin_dir / ws.GUARD)),
            "UserPromptSubmit": hook('/usr/bin/python3 -I -B "%s" prompt-hook' % (bin_dir / ws.PASTE))}}),
            encoding="utf-8")
        req = Path(root + "/etc/codex/requirements.toml")
        req.parent.mkdir(parents=True)
        req.write_text("# %s; source: global/install-managed.sh; version: 2.1.0\n[hooks]\n"
                       "[[hooks.SessionStart]]\n[[hooks.SessionStart.hooks]]\ntype = \"command\"\n"
                       "command = \"/usr/bin/python3 -I -B \\\"%s\\\" --harness codex\"\n"
                       % (ws.MARKER, bin_dir / "restart_guard.py"), encoding="utf-8")

    def run_ws(self, *args):
        p = subprocess.run([str(ws.ROOT / "workstation")] + list(args) + ["--overlay=none"], env=self.env,
                           cwd=self.base, capture_output=True, text=True)
        return p.returncode, p.stdout + p.stderr

    def assert_named(self, out, prefix):
        self.assertIn(prefix + "STALE restart_guard.py, breaking_glass.py, hitl-escalation-guard.sh, hitl.conf, "
                      "breaking-glass\n", out)
        self.assertIn(prefix + "removed controls still installed: restart guard, picker guard, session intake "
                      "(the picker guard's intake exception), timed breaking-glass\n", out)
        self.assertRegex(out, r"(?m)^%sDRIFT .*%s" % (re.escape(prefix), re.escape(ws.PASTE)))
        self.assertIn(prefix + ws.ADMIN_NEXT + "\n", out)

    def test_plain_install_reports_stale_then_admin_install_clears_it(self):
        code, out = self.run_ws("install")
        self.assertNotEqual(code, 0, out)
        self.assertNotIn("ADMIN   not installed", out)
        self.assert_named(out, "ADMIN   ")
        code, out = self.run_ws("check")
        self.assertNotEqual(code, 0, out)
        self.assert_named(out, "ADMIN   ")
        code, out = self.run_ws("status", "--project=" + str(self.base / "proj"))
        self.assertEqual(code, 0, out)
        self.assertNotIn("matches this checkout", out)
        self.assertRegex(out, r"(?m)^  check            \d+ target\(s\) differ \(admin layer: \d+\); run "
                              r"\./mhw install --admin first$")
        self.assert_named(out, "  admin layer      ")
        self.assertIn("removed restart guard still registered (Claude Code)", out)
        self.assertIn("removed restart guard still registered (Codex)", out)

        # The documented order: install --admin, its one line (root override, no sudo), then install.
        code, out = self.run_ws("install", "--admin")
        self.assertEqual(code, 0, out)
        line = re.search(r"(?m)^RUN     sudo (.*)$", out).group(1)
        p = subprocess.run(shlex.split(line), env=self.env, capture_output=True, text=True)
        self.assertEqual(p.returncode, 0, p.stdout + p.stderr)
        code, out = self.run_ws("install")
        self.assertEqual(code, 0, out)
        self.assertIn("ADMIN   installed and matching this checkout", out)
        code, out = self.run_ws("check")
        self.assertEqual(code, 0, out)
        self.assertNotIn("STALE", out)
        code, out = self.run_ws("status", "--project=" + str(self.base / "proj"))
        self.assertIn("  check            matches this checkout\n", out)
        self.assertNotIn("restart guard", out)


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
            for cmd in ("install", "check", "status", "uninstall", "update"):
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


class Hooks(unittest.TestCase):
    """read_hooks() reports only what the installed files register, per layer."""

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="workstation-hooks-")
        self.addCleanup(self.temp.cleanup)
        b = self.base = Path(self.temp.name)
        saved = {k: os.environ.get(k) for k in ("HOME", "WORKSTATION_MANAGED_ROOT", "XDG_DATA_HOME", "CODEX_HOME")}

        def restore():
            for k, v in saved.items():
                if v is None:
                    os.environ.pop(k, None)
                else:
                    os.environ[k] = v
        self.addCleanup(restore)
        os.environ["HOME"] = str(b / "home")
        os.environ["WORKSTATION_MANAGED_ROOT"] = str(b / "root")
        os.environ.pop("XDG_DATA_HOME", None)
        os.environ.pop("CODEX_HOME", None)
        self.data = b / "home" / ".local" / "share" / ws.NAME

    def write(self, path, text):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8")

    def entry(self, event, command):
        return {"hooks": {event: [{"hooks": [{"type": "command", "command": command}]}]}}

    def test_nothing_installed(self):
        self.assertEqual(ws.read_hooks(), {"user": [], "admin": []})
        self.assertEqual(ws.hooks_text(ws.read_hooks()), "admin: none · user: none")

    def test_user_entries_count_only_with_their_script(self):
        settings = Path(os.environ["HOME"]) / ".claude" / "settings.json"
        doc = self.entry("UserPromptSubmit", "python3 %s prompt-hook" % (self.data / ws.PASTE))
        self.write(settings, json.dumps(doc))
        self.assertEqual(ws.read_hooks()["user"], [])
        self.write(self.data / ws.PASTE, "#\n")
        self.write(Path(os.environ["HOME"]) / ".codex" / "hooks.json",
                   json.dumps(self.entry("UserPromptSubmit", "python3 %s" % (self.data / ws.PASTE))))
        self.assertEqual(ws.read_hooks()["user"], ["paste filter (Claude Code)", "paste filter (Codex)"])

    def test_a_removed_picker_guard_entry_is_named(self):
        # Issue #60: the picker guard is removed. An entry an earlier install left behind is named as a
        # leftover, with or without its script, so status never reads it as a protection or hides it.
        settings = Path(os.environ["HOME"]) / ".claude" / "settings.json"
        doc = self.entry("PreToolUse", "\"%s\"" % (self.data / ws.GUARD))
        self.write(settings, json.dumps(doc))
        self.assertEqual(ws.read_hooks()["user"], [ws.LEFTOVER])
        self.assertIn("removed", ws.LEFTOVER)

    def test_unreadable_is_not_read(self):
        self.write(Path(os.environ["HOME"]) / ".claude" / "settings.json", "not json")
        self.assertEqual(ws.read_hooks()["user"], "not read")
        self.assertEqual(ws.hooks_text(ws.read_hooks()), "admin: none · user: not read")

    def test_admin_state_reads_the_dropin(self):
        self.assertEqual(ws.admin_state(), "absent")
        # The pre-#66 drop-in shape, from install-managed.sh at 3742ffa: hooks and deny, no stamp key.
        legacy = {"hooks": {"PreToolUse": [{"matcher": "AskUserQuestion", "hooks": [
                      {"type": "command", "command": "/bin/sh \"/x/%s/bin/%s\"" % (ws.NAME, ws.GUARD), "timeout": 5}]}]},
                  "permissions": {"deny": ["Bash(sudo:*)"]}}
        self.write(ws.admin_dropin(), json.dumps(legacy))
        self.assertEqual(ws.admin_state(), "legacy")
        self.assertFalse(ws.admin_installed())
        self.write(ws.admin_dropin(), "{not json")
        self.assertEqual(ws.admin_state(), "unreadable")
        legacy[ws.NAME] = "stamp"
        self.write(ws.admin_dropin(), json.dumps(legacy))
        self.assertEqual(ws.admin_state(), "installed")

    def test_admin_layer(self):
        root = os.environ["WORKSTATION_MANAGED_ROOT"]
        bin_dir = Path(root + ("/Library/Application Support/" if sys.platform == "darwin" else "/etc/") + ws.NAME + "/bin")
        doc = self.entry("PreToolUse", "/bin/sh \"%s\"" % (bin_dir / ws.GUARD))
        doc["hooks"].update(self.entry("UserPromptSubmit", "py \"%s\"" % (bin_dir / ws.PASTE))["hooks"])
        # The removed picker guard's entry (an admin layer installed before Issue #60) is a leftover.
        doc[ws.NAME] = "stamp"
        self.write(ws.admin_dropin(), json.dumps(doc))
        req = Path(os.environ["WORKSTATION_MANAGED_ROOT"] + "/etc/codex/requirements.toml")
        self.write(req, "[[hooks.UserPromptSubmit]]\ncommand = \"%s\"\n" % (bin_dir / ws.PASTE))
        self.write(bin_dir / ws.PASTE, "#\n")
        self.assertEqual(ws.read_hooks()["admin"], [ws.LEFTOVER, "paste filter (Claude Code)"])
        self.write(req, "# %s\n[[hooks.UserPromptSubmit]]\ncommand = \"%s\"\n" % (ws.MARKER, bin_dir / ws.PASTE))
        self.assertEqual(ws.read_hooks()["admin"], [ws.LEFTOVER, "paste filter (Claude Code)",
                                                    "paste filter (Codex)"])


class MethodStatus(unittest.TestCase):
    """Issue #61: the working method is opt-in, and status names a duplicate with the plugin."""

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.saved = os.environ.get("CODEX_HOME")
        os.environ["CODEX_HOME"] = str(self.tmp)

    def tearDown(self):
        if self.saved is None:
            os.environ.pop("CODEX_HOME", None)
        else:
            os.environ["CODEX_HOME"] = self.saved
        shutil.rmtree(self.tmp)

    def test_not_installed_by_default(self):
        m = ws.method_state(["METHOD  not installed (opt-in: ...)"], ["tadeumendonca-skills@tadeumendonca"])
        self.assertEqual(m, {"installed": False, "duplicate": []})
        self.assertIn("opt-in: ./mhw install --method", ws.method_text(m))

    def test_duplicate_named_per_agent_harness(self):
        (self.tmp / "config.toml").write_text('[plugins."tadeumendonca-skills@tadeumendonca"]\nenabled = true\n')
        m = ws.method_state(["METHOD  installed: 8 agents"], ["tadeumendonca-skills@tadeumendonca"])
        self.assertEqual(m["duplicate"], ["Claude Code", "Codex"])
        self.assertIn("DUPLICATE", ws.method_text(m))

    def test_codex_plugin_disabled_is_no_duplicate(self):
        (self.tmp / "config.toml").write_text('[plugins."tadeumendonca-skills@tadeumendonca"]\nenabled = false\n')
        m = ws.method_state(["METHOD  installed: 8 agents"], [])
        self.assertEqual(m["duplicate"], [])
        self.assertNotIn("DUPLICATE", ws.method_text(m))


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
        code, out = self.ws("install")
        self.assertEqual(code, 0, out)
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
                         {"mine": 1, "permissions": {"deny": ["Bash(sudo:*)", "Bash(mytool:*)"]}})
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
