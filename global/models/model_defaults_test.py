#!/usr/bin/env python3
"""Tests for model_defaults.py: render, check, drift and uninstall per agent harness, in throwaway HOMEs.

    model_defaults_test.py [base directory]   (default: a fresh directory under $TMPDIR)
"""

import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
SCRIPT = HERE / "model_defaults.py"
BASE = Path(sys.argv.pop(1)) if len(sys.argv) > 1 else Path(tempfile.mkdtemp(prefix="model-defaults-test."))
STAMP = "release: v9.9.9; commit: " + "a" * 40
POLICY = {"version": 1,
          "claude-code": {"model": "claude-opus-5-5[1m]", "effort": "medium"},
          "codex": {"model": "gpt-5.6-sol", "effort": "medium"},
          "kiro-cli": {"model": "claude-sonnet-4.5"}}
# harness -> (relative file, {native key: wanted value}) for POLICY
EXPECT = {"claude-code": (".claude/settings.json", {"model": "claude-opus-5-5[1m]", "effortLevel": "medium"}),
          "codex": (".codex/config.toml", {"model": "gpt-5.6-sol", "model_reasoning_effort": "medium"}),
          "kiro-cli": (".kiro/settings/cli.json", {"chat.defaultModel": "claude-sonnet-4.5"})}
RECORD = ".local/share/personal-multi-harness-workstation-configuration/model-defaults.json"


def toml_top(path):
    """Top-level string keys of a TOML file, before its first table (enough for these tests)."""
    out = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        if line.startswith("["):
            break
        if "=" in line and not line.startswith("#"):
            k, v = line.split("=", 1)
            out[k.strip()] = json.loads(v.strip())
    return out


def read_keys(home, harness):
    rel, _ = EXPECT[harness]
    path = home / rel
    if not path.exists():
        return {}
    return toml_top(path) if path.suffix == ".toml" else json.loads(path.read_text(encoding="utf-8"))


class ModelDefaults(unittest.TestCase):
    n = 0

    def setUp(self):
        ModelDefaults.n += 1
        self.home = BASE / ("home-%d" % ModelDefaults.n)
        self.home.mkdir(parents=True)
        self.policy = self.home.parent / ("policy-%d.json" % ModelDefaults.n)
        self.write_policy(POLICY)

    def write_policy(self, doc):
        self.policy.write_text(json.dumps(doc), encoding="utf-8")

    def run_mode(self, mode, policy=None, stamp=STAMP):
        env = {k: v for k, v in os.environ.items() if k not in ("CODEX_HOME", "XDG_DATA_HOME")}
        p = subprocess.run([sys.executable, "-B", str(SCRIPT), "--mode=" + mode, "--stamp=" + stamp,
                            "--policy=" + str(policy or self.policy), "--home=" + str(self.home)],
                           capture_output=True, text=True, env=env)
        return p.returncode, p.stdout + p.stderr

    def seed(self, rel, text):
        path = self.home / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8")
        return path

    # --- render, check, per harness ------------------------------------------------------------

    def test_fresh_install_renders_each_harness_and_check_passes(self):
        code, out = self.run_mode("check")
        self.assertEqual(code, 1, out)
        self.assertEqual(out.count("MISSING"), 3, out)
        code, out = self.run_mode("install")
        self.assertEqual(code, 0, out)
        for harness, (_, want) in EXPECT.items():
            with self.subTest(harness=harness):
                got = read_keys(self.home, harness)
                self.assertEqual({k: got.get(k) for k in want}, want)
        record = json.loads((self.home / RECORD).read_text(encoding="utf-8"))
        self.assertIn(STAMP, record["managed-by"])
        self.assertEqual(len(record["set"]), 3)
        code, out = self.run_mode("check")
        self.assertEqual(code, 0, out)
        self.assertEqual(out.count("OK"), 4, out)

    def test_install_keeps_every_other_key_and_table(self):
        self.seed(".claude/settings.json", json.dumps({"theme": "dark", "permissions": {"deny": ["x"]}}))
        self.seed(".codex/config.toml", '# mine\napproval_policy = "on-request"\n\n[profiles.x]\nmodel = "other"\n')
        self.seed(".kiro/settings/cli.json", json.dumps({"chat.enableThinking": True}))
        code, out = self.run_mode("install")
        self.assertEqual(code, 0, out)
        claude = json.loads((self.home / ".claude/settings.json").read_text(encoding="utf-8"))
        self.assertEqual(claude["theme"], "dark")
        self.assertEqual(claude["permissions"], {"deny": ["x"]})
        toml = (self.home / ".codex/config.toml").read_text(encoding="utf-8")
        self.assertIn('approval_policy = "on-request"', toml)
        self.assertIn('[profiles.x]\nmodel = "other"', toml)
        self.assertTrue(json.loads((self.home / ".kiro/settings/cli.json").read_text(encoding="utf-8"))["chat.enableThinking"])
        for rel in (".claude/settings.json", ".codex/config.toml", ".kiro/settings/cli.json"):
            self.assertTrue((self.home / (rel + ".pmhwc-models-backup")).exists(), rel)

    def test_dry_run_writes_nothing(self):
        code, out = self.run_mode("dry-run")
        self.assertEqual(code, 0, out)
        self.assertEqual(out.count("WOULD SET"), 3, out)
        self.assertEqual([p for p in self.home.rglob("*") if p.is_file()], [])

    # --- drift and the owner's own values ------------------------------------------------------

    def test_drift_in_each_harness_is_reported_and_never_overwritten(self):
        self.run_mode("install")
        drifted = {"claude-code": ("model", "opus[1m]"), "codex": ("model_reasoning_effort", "high"),
                   "kiro-cli": ("chat.defaultModel", "auto")}
        for harness, (key, value) in drifted.items():
            with self.subTest(harness=harness):
                rel, _ = EXPECT[harness]
                path = self.home / rel
                text = path.read_text(encoding="utf-8")
                if path.suffix == ".toml":
                    path.write_text(text.replace('%s = "medium"' % key, '%s = "%s"' % (key, value)), encoding="utf-8")
                else:
                    doc = json.loads(text)
                    doc[key] = value
                    path.write_text(json.dumps(doc), encoding="utf-8")
                code, out = self.run_mode("check")
                self.assertEqual(code, 3, out)
                self.assertIn("REFUSE  %s: %s is \"%s\"" % (path, key, value), out)
                code, out = self.run_mode("install")
                self.assertEqual(code, 3, out)
                self.assertEqual(read_keys(self.home, harness)[key], value, "the owner's value was overwritten")

    def test_owner_value_present_before_install_is_refused(self):
        self.seed(".codex/config.toml", 'model = "gpt-5.6-sol"\nmodel_reasoning_effort = "high"\n')
        code, out = self.run_mode("install")
        self.assertEqual(code, 3, out)
        self.assertEqual(toml_top(self.home / ".codex/config.toml")["model_reasoning_effort"], "high")
        self.assertIn("Delete the key and re-run install", out)

    def test_policy_change_rolls_forward_a_value_mhw_set(self):
        self.run_mode("install")
        changed = json.loads(json.dumps(POLICY))
        changed["codex"]["effort"] = "low"
        self.write_policy(changed)
        code, out = self.run_mode("check")
        self.assertEqual(code, 1, out)
        self.assertIn("DRIFT", out)
        code, out = self.run_mode("install")
        self.assertEqual(code, 0, out)
        self.assertEqual(toml_top(self.home / ".codex/config.toml")["model_reasoning_effort"], "low")

    def test_stamp_change_is_reported_and_restamped(self):
        self.run_mode("install")
        other = "release: v9.9.10; commit: " + "b" * 40
        code, out = self.run_mode("check", stamp=other)
        self.assertEqual(code, 1, out)
        self.assertIn("STAMP", out)
        self.assertEqual(self.run_mode("install", stamp=other)[0], 0)
        self.assertEqual(self.run_mode("check", stamp=other)[0], 0)

    def test_empty_policy_removes_only_what_mhw_set(self):
        self.run_mode("install")
        code, out = self.run_mode("check", policy="none")
        self.assertEqual(code, 1, out)
        self.assertIn("STALE", out)
        code, out = self.run_mode("install", policy="none")
        self.assertEqual(code, 0, out)
        for harness in EXPECT:
            self.assertEqual({k: v for k, v in read_keys(self.home, harness).items()
                              if k in EXPECT[harness][1]}, {}, harness)
        self.assertFalse((self.home / RECORD).exists())

    # --- uninstall --------------------------------------------------------------------------------

    def test_uninstall_removes_only_what_mhw_set(self):
        self.seed(".claude/settings.json", json.dumps({"theme": "dark", "effortLevel": "medium"}))
        self.run_mode("install")
        # effortLevel was the owner's (equal to the policy before install): it is not recorded as ours.
        record = json.loads((self.home / RECORD).read_text(encoding="utf-8"))
        claude_rec = record["set"][str(self.home / ".claude/settings.json")]["keys"]
        self.assertEqual(claude_rec, {"model": "claude-opus-5-5[1m]"})
        # The owner later changes the Codex model himself: it is his now.
        path = self.home / ".codex/config.toml"
        path.write_text(path.read_text(encoding="utf-8").replace('"gpt-5.6-sol"', '"gpt-5.6-terra"'), encoding="utf-8")
        code, out = self.run_mode("uninstall")
        self.assertEqual(code, 0, out)
        claude = json.loads((self.home / ".claude/settings.json").read_text(encoding="utf-8"))
        self.assertEqual(claude, {"theme": "dark", "effortLevel": "medium"})
        codex = toml_top(path)
        self.assertEqual(codex, {"model": "gpt-5.6-terra"})
        self.assertNotIn("chat.defaultModel", read_keys(self.home, "kiro-cli"))
        self.assertFalse((self.home / RECORD).exists())
        self.assertEqual(self.run_mode("uninstall")[0], 0)

    # --- the policy itself ------------------------------------------------------------------------

    def test_policy_refuses_aliases_and_an_unverified_kiro_effort(self):
        bad = [{"claude-code": {"model": "opus[1m]"}}, {"claude-code": {"model": "opus"}},
               {"kiro-cli": {"model": "auto"}},
               {"kiro-cli": {"model": "claude-sonnet-4.5", "effort": "medium"}},
               {"codex": {"model": "gpt-5.6-sol", "effort": "huge"}}, {"gemini": {"model": "x"}}]
        for entry in bad:
            with self.subTest(entry=entry):
                self.write_policy(dict(entry, version=1))
                code, out = self.run_mode("install")
                self.assertEqual(code, 2, out)
                self.assertEqual([p for p in self.home.rglob("*") if p.is_file()], [])

    def test_repository_overlay_policy_is_valid(self):
        overlay = HERE.parent.parent / "overlay" / "model-defaults.json"
        code, out = self.run_mode("dry-run", policy=overlay)
        self.assertEqual(code, 0, out)


if __name__ == "__main__":
    BASE.mkdir(parents=True, exist_ok=True)
    unittest.main(verbosity=1)
