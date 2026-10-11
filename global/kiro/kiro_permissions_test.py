#!/usr/bin/env python3
"""Tests for kiro_permissions.py: the deny floor rendered into Kiro's user-level permissions.yaml, in
throwaway HOMEs only (ADR-0036, Issue #144). No Kiro runs here; the rule engine is outside this suite.

    kiro_permissions_test.py [base directory]   (default: a fresh directory under $TMPDIR)
"""
import json
import os
import stat
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
SCRIPT = HERE / "kiro_permissions.py"
REPO_FLOOR = HERE.parent / "deny-floor.conf"
_ROOT = Path(sys.argv.pop(1)) if len(sys.argv) > 1 else None
if _ROOT is not None:
    _ROOT.mkdir(parents=True, exist_ok=True)
# A fresh directory per run, so a second run against the same base starts clean.
BASE = Path(tempfile.mkdtemp(prefix="kiro-permissions-test.", dir=str(_ROOT) if _ROOT else None))
sys.path.insert(0, str(HERE))
import kiro_permissions as kp  # noqa: E402

STAMP = "release: v9.9.9; commit: " + "a" * 40
OTHER = "release: v9.9.8; commit: " + "b" * 40
FLOOR = ("# a comment\n"
         "cmd sudo\n"
         "cmd gh auth token\n"
         "file ~/.ssh/id_*\n"
         "file **/.env\n"
         "glob terraform -chdir=*\n")
# The style the IDE's own writer emits (the npm yaml package's stringify), with an owner comment, an allow
# rule, and an owner deny equal to one floor pattern.
OWNER = ("# my own rules\n"
         "rules:\n"
         "  - capability: shell\n"
         "    match:\n"
         "      - git *\n"
         "      - npm *\n"
         "    effect: allow\n"
         "  - capability: shell\n"
         "    match:\n"
         "      - sudo *\n"
         "    effect: deny\n"
         "  - capability: mcp\n"
         "    match: [\"my-server/*\"]\n"
         "    exclude: ['my-server/dangerous-tool']\n"
         "    effect: allow\n")
OWNER_RULES = [
    {"capability": "shell", "effect": "allow", "match": ["git *", "npm *"]},
    {"capability": "shell", "effect": "deny", "match": ["sudo *"]},
    {"capability": "mcp", "effect": "allow", "match": ["my-server/*"], "exclude": ["my-server/dangerous-tool"]},
]


class Base(unittest.TestCase):
    n = 0

    def setUp(self):
        Base.n += 1
        self.home = BASE / ("home-%d" % Base.n)
        self.home.mkdir(parents=True)
        self.path = self.home / ".kiro" / "settings" / "permissions.yaml"
        self.floor = self.home / "floor.conf"
        self.floor.write_text(FLOOR, encoding="utf-8")
        self.owned = self.home / ".local" / "share" / "personal-multi-harness-workstation-configuration" / \
            "kiro-permissions-owned.json"

    def run_mode(self, mode, stamp=STAMP, floor=None):
        env = {k: v for k, v in os.environ.items() if k != "XDG_DATA_HOME"}
        env["HOME"] = str(self.home)
        p = subprocess.run([sys.executable, "-B", str(SCRIPT), "--mode=" + mode, "--stamp=" + stamp,
                            "--floor=%s" % (floor or self.floor)], capture_output=True, text=True, env=env)
        return p.returncode, p.stdout + p.stderr

    def rules(self):
        return kp.parse(self.path.read_text(encoding="utf-8"))["rules"]

    def owner_file(self, text=OWNER):
        self.path.parent.mkdir(parents=True)
        self.path.write_text(text, encoding="utf-8")
        os.chmod(self.path, 0o644)


class Floor(unittest.TestCase):
    def test_entries_render_to_kiro_patterns(self):
        p = BASE / "floor-unit.conf"
        p.write_text(FLOOR, encoding="utf-8")
        want = kp.load_floor(p)
        self.assertEqual(want["shell"], ["sudo *", "gh auth token *", "terraform -chdir=*"])
        self.assertEqual(want["fs_read"], ["~/.ssh/id_*", "**/.env"])
        self.assertEqual(want["fs_write"], want["fs_read"])

    def test_the_repository_floor_loads_whole(self):
        want = kp.load_floor(REPO_FLOOR)
        lines = [l.split() for l in REPO_FLOOR.read_text(encoding="utf-8").splitlines()
                 if l.strip() and not l.lstrip().startswith("#")]
        n_shell = len({" ".join(f[1:]) for f in lines if f[0] in ("cmd", "glob")})
        n_file = len({f[1] for f in lines if f[0] == "file"})
        self.assertEqual(len(want["shell"]), n_shell)
        self.assertEqual(len(want["fs_read"]), n_file)
        self.assertTrue(all(p.endswith("*") for p in want["shell"]))

    def test_invalid_entry_is_refused(self):
        p = BASE / "floor-bad.conf"
        p.write_text("cmd rm -rf *\n", encoding="utf-8")
        with self.assertRaises(ValueError):
            kp.load_floor(p)


class Reader(unittest.TestCase):
    def test_owner_style_reads(self):
        self.assertEqual(kp.parse(OWNER)["rules"], OWNER_RULES)

    def test_vendor_examples_read(self):
        # Verbatim from kiro.dev/docs/permissions (2026-10-11).
        doc = kp.parse('rules:\n  - capability: fs_write\n    match: ["*.env", "*.pem", "*.key"]\n    effect: deny\n'
                       '  - capability: shell\n    match: ["rm -rf *", "sudo *"]\n    effect: deny\n'
                       '  - capability: fs_read\n    effect: allow\n')
        self.assertEqual(doc["rules"][1], {"capability": "shell", "effect": "deny", "match": ["rm -rf *", "sudo *"]})
        self.assertEqual(doc["rules"][2], {"capability": "fs_read", "effect": "allow"})

    def test_compact_sequences_read(self):
        doc = kp.parse("rules:\n- capability: shell\n  match:\n  - git *\n  effect: allow\n")
        self.assertEqual(doc["rules"], [{"capability": "shell", "effect": "allow", "match": ["git *"]}])

    def test_empty_and_policies(self):
        self.assertEqual(kp.parse(""), {"rules": [], "policies": None})
        self.assertEqual(kp.parse("policies: [read-only]\nrules: []\n"), {"rules": [], "policies": ["read-only"]})

    def test_round_trip(self):
        doc = kp.parse(OWNER)
        self.assertEqual(kp.parse(kp.emit(doc, STAMP, "x")), doc)

    def test_refusals(self):
        for bad in ("rules:\n  - capability: shell\n    effect: deny\n    note: x\n",       # Kiro: fatal field
                    "rules:\n  - capability: shell\n    effect: block\n",                   # Kiro: fatal effect
                    "rules:\n  - effect: deny\n",                                           # no capability
                    "rules:\n  - &a capability: shell\n    effect: deny\n",                 # an anchor
                    "rules:\n  - capability: shell\n    match: [*x]\n    effect: deny\n",   # an alias
                    "rules:\n  - {capability: shell, effect: deny}\n",                      # a flow mapping
                    "rules:\n  - capability: shell\n    match: |\n      x\n    effect: deny\n",
                    "rules:\n  - capability: true\n    effect: deny\n",                     # not a string
                    "other: 1\nrules: []\n",                                                # unknown key
                    "rules: 3\n"):
            with self.assertRaises(kp.Refuse, msg=bad):
                kp.parse(bad)


class Install(Base):
    def test_fresh_home_check_dry_run_install_settles(self):
        code, out = self.run_mode("check")
        self.assertEqual((code, out.strip()), (1, "MISSING %s" % self.path))
        code, out = self.run_mode("dry-run")
        self.assertEqual(code, 0, out)
        self.assertIn("  + shell deny sudo *", out)
        self.assertFalse(self.path.exists())
        code, out = self.run_mode("install")
        self.assertEqual(code, 0, out)
        self.assertIn("MERGED  %s (new file; 7 deny-floor patterns)" % self.path, out)
        self.assertEqual(stat.S_IMODE(self.path.stat().st_mode), 0o600)
        self.assertEqual(self.rules(), [
            {"capability": "shell", "effect": "deny", "match": ["sudo *", "gh auth token *", "terraform -chdir=*"]},
            {"capability": "fs_read", "effect": "deny", "match": ["~/.ssh/id_*", "**/.env"]},
            {"capability": "fs_write", "effect": "deny", "match": ["~/.ssh/id_*", "**/.env"]}])
        self.assertIn(STAMP, self.path.read_text(encoding="utf-8").splitlines()[0])
        code, out = self.run_mode("check")
        self.assertEqual(code, 0, out)
        self.assertTrue(out.startswith("OK      "), out)
        before = self.path.read_bytes()
        self.assertEqual(self.run_mode("install")[0], 0)
        self.assertEqual(self.path.read_bytes(), before)
        code, out = self.run_mode("report")
        self.assertIn("FLOOR   Kiro: user permissions.yaml 7/7 floor patterns", out)

    def test_owner_rules_kept_backup_private_uninstall_removes_only_ours(self):
        self.owner_file()
        code, out = self.run_mode("check")
        self.assertEqual(code, 1, out)
        self.assertIn("DRIFT   %s (6 deny-floor pattern(s) missing; none)" % self.path, out)
        code, out = self.run_mode("install")
        self.assertEqual(code, 0, out)
        self.assertIn("6 deny-floor pattern(s) added", out)
        rules = self.rules()
        self.assertEqual(rules[:3], OWNER_RULES)
        self.assertEqual(rules[3]["match"], ["gh auth token *", "terraform -chdir=*"])  # sudo * was his already
        self.assertEqual(stat.S_IMODE(self.path.stat().st_mode), 0o644)
        backup = Path(str(self.path) + ".pmhwc-backup")
        self.assertEqual(backup.read_text(encoding="utf-8"), OWNER)
        self.assertEqual(stat.S_IMODE(backup.stat().st_mode), 0o600)
        self.assertEqual(json.loads(self.owned.read_text(encoding="utf-8"))["owned"]["shell"],
                         ["gh auth token *", "terraform -chdir=*"])
        code, out = self.run_mode("uninstall")
        self.assertEqual(code, 0, out)
        self.assertIn("UNMERGED", out)
        self.assertEqual(self.rules(), OWNER_RULES)  # his own "sudo *" deny stays
        self.assertFalse(self.owned.exists())

    def test_kiro_rewrite_drops_the_stamp_then_install_restamps(self):
        self.run_mode("install")
        # What the IDE's writer does after a user-scope consent: re-serialise without comments, and add an
        # allow rule.
        doc = kp.parse(self.path.read_text(encoding="utf-8"))
        doc["rules"].append({"capability": "shell", "effect": "allow", "match": ["ls *"]})
        self.path.write_text(kp.emit(doc, STAMP, "x", header=False), encoding="utf-8")
        code, out = self.run_mode("check")
        self.assertEqual(code, 1, out)
        self.assertIn("STAMP   %s: the deny-floor patterns match, but it carries (none)" % self.path, out)
        code, out = self.run_mode("install")
        self.assertIn("RESTAMPED", out)
        self.assertEqual(self.run_mode("check")[0], 0)
        self.assertIn({"capability": "shell", "effect": "allow", "match": ["ls *"]}, self.rules())

    def test_new_stamp_reads_stamp(self):
        self.run_mode("install")
        code, out = self.run_mode("check", stamp=OTHER)
        self.assertEqual(code, 1)
        self.assertIn("STAMP   ", out)

    def test_consent_pattern_in_our_rule_survives_uninstall(self):
        self.run_mode("install")
        doc = kp.parse(self.path.read_text(encoding="utf-8"))
        doc["rules"][0]["match"].append("curl *")  # the IDE appends a deny consent to the first deny rule
        self.path.write_text(kp.emit(doc, STAMP, "x"), encoding="utf-8")
        self.assertEqual(self.run_mode("uninstall")[0], 0)
        self.assertEqual(self.rules(), [{"capability": "shell", "effect": "deny", "match": ["curl *"]}])

    def test_created_file_is_removed_on_uninstall(self):
        self.run_mode("install")
        code, out = self.run_mode("uninstall")
        self.assertEqual(code, 0, out)
        self.assertFalse(self.path.exists())
        self.assertIn("REMOVED %s" % self.path, out)

    def test_an_allow_or_an_excluded_deny_does_not_count_as_the_floor(self):
        self.owner_file("rules:\n  - capability: shell\n    match: ['sudo *']\n    effect: allow\n"
                        "  - capability: shell\n    match: ['gh auth token *']\n    exclude: ['gh auth token x']\n"
                        "    effect: deny\n")
        self.run_mode("install")
        self.assertEqual(self.rules()[2]["match"], ["sudo *", "gh auth token *", "terraform -chdir=*"])

    def test_his_empty_file_stays_after_uninstall(self):
        self.owner_file("rules: []\n")
        self.run_mode("install")
        code, out = self.run_mode("uninstall")
        self.assertEqual(code, 0, out)
        self.assertTrue(self.path.exists(), out)
        self.assertEqual(self.rules(), [])

    def test_a_merge_that_does_not_read_back_is_refused(self):
        doc = kp.parse(OWNER)
        with self.assertRaises(kp.Refuse):
            kp.verify(kp.emit(doc, STAMP, "x"), {"rules": doc["rules"][:1], "policies": None})

    def test_no_record_uninstall_removes_nothing(self):
        self.owner_file()
        self.run_mode("install")
        self.owned.unlink()
        before = self.path.read_bytes()
        code, out = self.run_mode("uninstall")
        self.assertEqual(code, 0, out)
        self.assertIn("nothing removed", out)
        self.assertEqual(self.path.read_bytes(), before)

    def test_floor_grows_appends_only_the_new_pattern(self):
        self.run_mode("install")
        grown = self.home / "grown.conf"
        grown.write_text(FLOOR + "cmd git push --force\n", encoding="utf-8")
        code, out = self.run_mode("install", floor=grown)
        self.assertIn("1 deny-floor pattern(s) added", out)
        self.assertEqual(self.rules()[-1], {"capability": "shell", "effect": "deny", "match": ["git push --force *"]})
        self.assertIn("git push --force *",
                      json.loads(self.owned.read_text(encoding="utf-8"))["owned"]["shell"])

    def test_symlink_is_written_through(self):
        real = self.home / "dotfiles" / "permissions.yaml"
        real.parent.mkdir()
        real.write_text(OWNER, encoding="utf-8")
        self.path.parent.mkdir(parents=True)
        self.path.symlink_to(real)
        self.assertEqual(self.run_mode("install")[0], 0)
        self.assertTrue(self.path.is_symlink())
        self.assertEqual(kp.parse(real.read_text(encoding="utf-8"))["rules"][:3], OWNER_RULES)


class Refusals(Base):
    def test_json_beside_is_refused(self):
        self.path.parent.mkdir(parents=True)
        (self.path.parent / "permissions.json").write_text('{"rules": []}', encoding="utf-8")
        for mode in ("install", "check"):
            code, out = self.run_mode(mode)
            self.assertEqual(code, 3, out)
            self.assertIn("REFUSE", out)
        self.assertFalse(self.path.exists())

    def test_file_kiro_would_reject_is_left_untouched(self):
        bad = "rules:\n  - capability: shell\n    effect: deny\n    comment: mine\n"
        self.owner_file(bad)
        code, out = self.run_mode("install")
        self.assertEqual(code, 3, out)
        self.assertIn("drops every rule in the file", out)
        self.assertEqual(self.path.read_text(encoding="utf-8"), bad)
        self.assertFalse(Path(str(self.path) + ".pmhwc-backup").exists())

    def test_usage(self):
        p = subprocess.run([sys.executable, "-B", str(SCRIPT), "--mode=install"], capture_output=True, text=True)
        self.assertEqual(p.returncode, 2)


if __name__ == "__main__":
    unittest.main(verbosity=1)
