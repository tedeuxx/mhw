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

    def test_a_plain_scalar_that_is_not_a_string_is_refused_never_requoted(self):
        # PR #150 review advisory 2: refusing keeps a rule Kiro rejects rejected, rather than switching it on.
        for tok in (".5", "1e3", "0x1F", "0o7", "0b101", ".inf", "-.INF", ".nan", ".NaN", "~", "null", "NULL",
                    "nUlL", "true", "TrUe", "FALSE", "yes", "Off", "1_000", "-1", "+.5", "1.", "12:30", "3E-2"):
            for doc in ("rules:\n  - capability: %s\n    effect: deny\n" % tok,
                        "rules:\n  - capability: shell\n    match: [%s]\n    effect: deny\n" % tok,
                        "rules:\n  - capability: shell\n    match:\n      - %s\n    effect: deny\n" % tok):
                with self.assertRaises(kp.Refuse, msg=doc):
                    kp.parse(doc)
        for tok in ("git *", "e5", "v1.2", "true-ish", "1a", ".", "nullx", "~/x"):
            self.assertEqual(kp.parse("rules:\n  - capability: shell\n    match:\n      - %s\n    effect: deny\n"
                                      % tok)["rules"][0]["match"], [tok])


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
        self.assertEqual(json.loads(self.owned.read_text(encoding="utf-8"))["appended"][0],
                         {"capability": "shell", "match": ["gh auth token *", "terraform -chdir=*"]})
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

    def test_a_rule_that_gained_a_consent_pattern_is_left_whole(self):
        # The IDE appends a deny consent to the first deny rule. That rule can no longer be told apart from
        # one of his own, so uninstall leaves it whole and says so (the safe direction).
        self.run_mode("install")
        doc = kp.parse(self.path.read_text(encoding="utf-8"))
        doc["rules"][0]["match"].append("curl *")
        self.path.write_text(kp.emit(doc, STAMP, "x"), encoding="utf-8")
        code, out = self.run_mode("uninstall")
        self.assertEqual(code, 0, out)
        self.assertIn("NOTE    %s: the shell deny rule mhw appended (3 pattern(s)) was not found" % self.path, out)
        self.assertEqual(self.rules(), [doc["rules"][0]])

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
        self.assertEqual(json.loads(self.owned.read_text(encoding="utf-8"))["appended"][-1],
                         {"capability": "shell", "match": ["git push --force *"]})
        code, out = self.run_mode("uninstall", floor=grown)
        self.assertEqual(code, 0, out)
        self.assertFalse(self.path.exists(), out)

    def test_his_rules_holding_owned_patterns_are_untouched_by_uninstall(self):
        # PR #150 review advisory 4: an allow rule, an excluded deny and a plain deny of his own, each holding
        # a pattern mhw appended. Uninstall edits only mhw's own rule.
        # His rules before the install hold exactly what mhw then appends (an allow and an excluded deny do
        # not cover the floor), and come first: only the effect and the exclude list tell them apart.
        his_before = [{"capability": "shell", "effect": "allow",
                       "match": ["sudo *", "gh auth token *", "terraform -chdir=*"]},
                      {"capability": "fs_read", "effect": "deny", "match": ["~/.ssh/id_*", "**/.env"],
                       "exclude": ["a/.env"]}]
        self.owner_file(kp.emit({"rules": his_before, "policies": None}, STAMP, "x", header=False))
        self.run_mode("install")
        doc = kp.parse(self.path.read_text(encoding="utf-8"))
        self.assertEqual(doc["rules"][2], dict(his_before[0], effect="deny"))
        # Written by him after the install: a deny holding mhw's patterns and one more. Only the position
        # tells it apart from mhw's own rule.
        his_later = [{"capability": "shell", "effect": "deny",
                      "match": ["sudo *", "gh auth token *", "terraform -chdir=*", "curl *"]}]
        doc["rules"] += his_later
        self.path.write_text(kp.emit(doc, STAMP, "x"), encoding="utf-8")
        code, out = self.run_mode("uninstall")
        self.assertEqual(code, 0, out)
        self.assertEqual(self.rules(), his_before + his_later)

    def put(self, rules):
        self.path.write_text(kp.emit({"rules": rules, "policies": None}, STAMP, "x", header=False), encoding="utf-8")

    def record(self):
        return json.loads(self.owned.read_text(encoding="utf-8"))["appended"]

    def test_a_stale_record_never_claims_his_rule(self):
        # PR #150 re-review: install, he deletes mhw's rule, install again, he adds his own deny that starts
        # with the same pattern, uninstall. His rule must stay whole.
        self.floor.write_text("cmd sudo\n", encoding="utf-8")
        self.run_mode("install")
        self.put([{"capability": "shell", "effect": "allow", "match": ["ls *"]}])  # mhw's rule deleted
        code, out = self.run_mode("install")
        self.assertEqual(code, 0, out)
        self.assertIn("NOTE    %s: 1 recorded mhw rule(s) no longer in" % self.owned, out)
        self.assertEqual(self.record(), [{"capability": "shell", "match": ["sudo *"]}])
        his = {"capability": "shell", "effect": "deny", "match": ["sudo *", "curl *"]}
        self.put(self.rules() + [his])
        code, out = self.run_mode("uninstall")
        self.assertEqual(code, 0, out)
        self.assertEqual(self.rules(), [{"capability": "shell", "effect": "allow", "match": ["ls *"]}, his])

    def test_reconciled_even_when_nothing_is_missing(self):
        # He deletes mhw's rule but keeps a deny of his own that covers the floor: install has nothing to add,
        # and still forgets the entry.
        self.floor.write_text("cmd sudo\n", encoding="utf-8")
        self.run_mode("install")
        his = {"capability": "shell", "effect": "deny", "match": ["sudo *", "curl *"]}
        self.path.write_text(kp.emit({"rules": [his], "policies": None}, STAMP, "x"), encoding="utf-8")
        code, out = self.run_mode("install")
        self.assertEqual(code, 0, out)
        self.assertIn("OK      ", out)
        self.assertEqual(self.record(), [])
        self.assertEqual(self.run_mode("uninstall")[0], 0)
        self.assertEqual(self.rules(), [his])

    def test_uninstall_matches_each_entry_to_a_distinct_rule(self):
        # Defence in depth: a record holding two entries for one rule (written by an older or broken install)
        # takes that one rule only, and says so for the other.
        self.floor.write_text("cmd sudo\n", encoding="utf-8")
        self.run_mode("install")
        body = json.loads(self.owned.read_text(encoding="utf-8"))
        body["appended"] = body["appended"] * 2
        self.owned.write_text(json.dumps(body), encoding="utf-8")
        his = {"capability": "shell", "effect": "allow", "match": ["sudo *"]}
        self.put(self.rules() + [his])
        code, out = self.run_mode("uninstall")
        self.assertEqual(code, 0, out)
        self.assertIn("was not found as its own rule", out)
        self.assertEqual(self.rules(), [his])

    def test_the_exact_rule_is_preferred_over_his_earlier_prefix_rule(self):
        self.floor.write_text("cmd sudo\n", encoding="utf-8")
        self.run_mode("install")
        his = {"capability": "shell", "effect": "deny", "match": ["sudo *", "curl *"]}
        self.put([his] + self.rules())  # he inserts his rule above mhw's
        self.assertEqual(self.run_mode("uninstall")[0], 0)
        self.assertEqual(self.rules(), [his])

    def test_a_recorded_rule_edited_by_hand_is_left_alone_and_said(self):
        self.run_mode("install")
        doc = kp.parse(self.path.read_text(encoding="utf-8"))
        doc["rules"][0]["match"].reverse()  # no longer starts with what mhw appended
        self.path.write_text(kp.emit(doc, STAMP, "x"), encoding="utf-8")
        code, out = self.run_mode("uninstall")
        self.assertEqual(code, 0, out)
        self.assertIn("NOTE    %s: the shell deny rule mhw appended (3 pattern(s)) was not found" % self.path, out)
        self.assertEqual(self.rules(), [doc["rules"][0]])

    def test_install_never_writes_a_merge_that_does_not_read_back(self):
        # PR #150 review advisory 5: run() calls verify(); a broken serialiser must leave the file as it was.
        self.owner_file()
        before = self.path.read_bytes()
        real_emit, old_home = kp.emit, os.environ.get("HOME")
        kp.emit = lambda doc, stamp, floor_from, header=True: "rules: []\n"
        os.environ["HOME"] = str(self.home)
        try:
            code = kp.run("install", STAMP, kp.load_floor(self.floor), "x")
        finally:
            kp.emit = real_emit
            os.environ["HOME"] = old_home
        self.assertEqual(code, 3)
        self.assertEqual(self.path.read_bytes(), before)
        self.assertFalse(Path(str(self.path) + ".pmhwc-backup").exists())
        self.assertFalse(self.owned.exists())

    def test_a_planted_link_at_a_temporary_name_is_not_followed(self):
        # PR #150 review advisory 1: the temporary file is created with a random name and O_EXCL.
        self.owner_file()
        victim = self.home / "victim"
        victim.write_text("untouched\n", encoding="utf-8")
        planted = Path("%s.new.%d" % (self.path, os.getpid()))
        planted.symlink_to(victim)
        kp.write(self.path, "rules: []\n")
        self.assertEqual(victim.read_text(encoding="utf-8"), "untouched\n")
        self.assertEqual(self.path.read_text(encoding="utf-8"), "rules: []\n")
        self.assertEqual(sorted(p.name for p in self.path.parent.iterdir()),
                         sorted(["permissions.yaml", planted.name]))

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
