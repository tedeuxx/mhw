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
        self.assertEqual(out.count("WOULD CHANGE"), 3, out)
        self.assertIn('model (absent) -> "claude-opus-5-5[1m]"', out)
        self.assertEqual([p for p in self.home.rglob("*") if p.is_file()], [])

    # --- drift and the owner's own values ------------------------------------------------------

    def test_drift_in_each_harness_is_reported_then_overwritten_old_to_new(self):
        # Issue #145: the pinned value is written whatever the key holds. Drift as /model would leave it
        # is a pending write (check 1), install replaces it and says old -> new, and check then settles.
        self.run_mode("install")
        drifted = {"claude-code": ("model", "opus[1m]"), "codex": ("model_reasoning_effort", "high"),
                   "kiro-cli": ("chat.defaultModel", "auto")}
        for harness, (key, value) in drifted.items():
            with self.subTest(harness=harness):
                rel, want = EXPECT[harness]
                path = self.home / rel
                text = path.read_text(encoding="utf-8")
                if path.suffix == ".toml":
                    path.write_text(text.replace('%s = "medium"' % key, '%s = "%s"' % (key, value)), encoding="utf-8")
                else:
                    doc = json.loads(text)
                    doc[key] = value
                    path.write_text(json.dumps(doc), encoding="utf-8")
                code, out = self.run_mode("check")
                self.assertEqual(code, 1, out)
                self.assertIn('DRIFT   %s: install would change %s "%s" -> "%s"' % (path, key, value, want[key]), out)
                self.assertNotIn("KEPT", out)
                self.assertNotIn("REFUSE", out)
                code, out = self.run_mode("install")
                self.assertEqual(code, 0, out)
                self.assertIn('CHANGED %s: %s "%s" -> "%s"' % (path, key, value, want[key]), out)
                self.assertEqual(read_keys(self.home, harness)[key], want[key], "the pinned value was not written")
                self.assertNotIn("Delete the key", out)
                code, out = self.run_mode("check")
                self.assertEqual(code, 0, out)
        # PR #146 lens L1: each drifted value is the owner's latest, so it is recorded as replaced and
        # uninstall brings it back, not the absence that preceded mhw's first write.
        record = json.loads((self.home / RECORD).read_text(encoding="utf-8"))
        for harness, (key, value) in drifted.items():
            self.assertEqual(record["set"][str(self.home / EXPECT[harness][0])].get("replaced"), {key: value}, record)
        self.assertEqual(self.run_mode("uninstall")[0], 0)
        for harness, (key, value) in drifted.items():
            got = {k: v for k, v in read_keys(self.home, harness).items() if k in EXPECT[harness][1]}
            self.assertEqual(got, {key: value}, harness)

    def test_uninstall_restores_the_latest_owner_value(self):
        # PR #146 lens L1: owner X, install, owner Z, install, uninstall gives Z back (not X).
        path = self.seed(".codex/config.toml", 'model_reasoning_effort = "owner-x"\n')
        self.assertEqual(self.run_mode("install")[0], 0)
        path.write_text(path.read_text(encoding="utf-8").replace('"medium"', '"owner-z"'), encoding="utf-8")
        code, out = self.run_mode("install")
        self.assertEqual(code, 0, out)
        self.assertIn('model_reasoning_effort "owner-z" -> "medium"', out)
        record = json.loads((self.home / RECORD).read_text(encoding="utf-8"))
        self.assertEqual(record["set"][str(path)]["replaced"], {"model_reasoning_effort": "owner-z"})
        self.assertEqual(self.run_mode("uninstall")[0], 0)
        self.assertEqual(toml_top(path)["model_reasoning_effort"], "owner-z")

    def test_a_key_the_owner_deleted_is_removed_on_uninstall(self):
        # The owner's latest state was "absent": uninstall does not resurrect the value mhw first replaced.
        path = self.seed(".codex/config.toml", 'model_reasoning_effort = "owner-x"\n')
        self.assertEqual(self.run_mode("install")[0], 0)
        path.write_text("".join(l for l in path.read_text(encoding="utf-8").splitlines(keepends=True)
                                if not l.startswith("model_reasoning_effort")), encoding="utf-8")
        self.assertEqual(self.run_mode("install")[0], 0)
        self.assertEqual(self.run_mode("uninstall")[0], 0)
        self.assertNotIn("model_reasoning_effort", toml_top(path))

    def test_owner_value_present_before_install_is_replaced_and_uninstall_restores_it(self):
        seed = 'model = "gpt-5.6-sol"\nmodel_reasoning_effort = "high"\n'
        path = self.seed(".codex/config.toml", seed)
        code, out = self.run_mode("install")
        self.assertEqual(code, 0, out)
        self.assertEqual(toml_top(path)["model_reasoning_effort"], "medium")
        self.assertIn('CHANGED %s: model_reasoning_effort "high" -> "medium" (model defaults codex; previous file '
                      'kept as %s.pmhwc-models-backup)' % (path, path), out)
        self.assertNotIn("Delete the key", out)
        self.assertEqual(Path(str(path) + ".pmhwc-models-backup").read_text(encoding="utf-8"), seed)
        record = json.loads((self.home / RECORD).read_text(encoding="utf-8"))
        self.assertEqual(record["set"][str(path)], {"harness": "codex", "keys": {"model_reasoning_effort": "medium"},
                                                    "replaced": {"model_reasoning_effort": "high"}})
        # A repeated install settles: nothing more to write, check passes.
        code, out = self.run_mode("install")
        self.assertEqual(code, 0, out)
        self.assertNotIn("CHANGED", out)
        self.assertEqual(self.run_mode("check")[0], 0)
        # Uninstall puts the owner's value back; the model equal to the policy was his and is untouched.
        code, out = self.run_mode("uninstall")
        self.assertEqual(code, 0, out)
        self.assertIn('REMOVED %s: model_reasoning_effort "medium" -> "high"' % path, out)
        self.assertEqual(path.read_text(encoding="utf-8"), seed)

    def test_a_foreign_record_is_refused(self):
        record = self.home / RECORD
        record.parent.mkdir(parents=True)
        record.write_text(json.dumps({"set": {}}), encoding="utf-8")
        code, out = self.run_mode("install")
        self.assertEqual(code, 3, out)
        self.assertIn("NOT managed by this project", out)
        self.assertFalse((self.home / ".claude/settings.json").exists())

    def test_unreadable_owner_value_is_still_a_refusal(self):
        # A value mhw cannot read is not a settled owner state: it stays REFUSE, exit 3.
        self.seed(".codex/config.toml", 'model_reasoning_effort = ["high"]\n')
        code, out = self.run_mode("install")
        self.assertEqual(code, 3, out)
        self.assertIn("REFUSE  %s: model_reasoning_effort holds a value mhw cannot read"
                      % (self.home / ".codex/config.toml"), out)

    # --- the TOML editor ------------------------------------------------------------------------

    def test_quoted_key_spellings_are_found_never_duplicated(self):
        path = self.home / ".codex/config.toml"
        for spelling in ('"model"', "'model'", "model"):
            with self.subTest(spelling=spelling):
                for p in (path, self.home / RECORD):
                    if p.exists():
                        p.unlink()
                # The owner's quoted key: found, replaced in place (no second model line), restored on uninstall.
                self.seed(".codex/config.toml", '%s = "gpt-owner"\n' % spelling)
                code, out = self.run_mode("install")
                self.assertEqual(code, 0, out)
                self.assertIn('CHANGED %s: model "gpt-owner" -> "gpt-5.6-sol"' % path, out)
                self.assertEqual(self.model_lines(path), ['model = "gpt-5.6-sol"'])
                self.assertEqual(self.run_mode("uninstall")[0], 0)
                self.assertEqual(self.model_lines(path), ['model = "gpt-owner"'])
                # mhw's own value, respelt with a quoted key, is still recognised as mhw's: a policy change
                # replaces that line instead of inserting a duplicate.
                for p in (path, self.home / RECORD):
                    if p.exists():
                        p.unlink()
                self.assertEqual(self.run_mode("install")[0], 0)
                path.write_text(path.read_text(encoding="utf-8").replace('model = "gpt', '%s = "gpt' % spelling),
                                encoding="utf-8")
                changed = json.loads(json.dumps(POLICY))
                changed["codex"]["model"] = "gpt-5.7"
                self.write_policy(changed)
                code, out = self.run_mode("install")
                self.write_policy(POLICY)
                self.assertEqual(code, 0, out)
                self.assertEqual(self.model_lines(path), ['model = "gpt-5.7"'])

    @staticmethod
    def model_lines(path):
        return [line for line in path.read_text(encoding="utf-8").splitlines()
                if line.split("=")[0].strip().strip("\"'") == "model"]

    @unittest.skipUnless(sys.version_info >= (3, 11), "the parse guard needs tomllib (Python 3.11+)")
    def test_an_edit_that_would_not_parse_is_refused_and_nothing_is_written(self):
        # A top-level multi-line array with a line starting with "[" ends the line editor's top level
        # early, so the owner's model below it reads as absent and a second model line would be added.
        # The parse guard catches that duplicate before anything is written.
        original = 'arr = [\n  "x",\n["nested"]\n]\nmodel = "gpt-owner"\n'
        path = self.seed(".codex/config.toml", original)
        code, out = self.run_mode("install")
        self.assertEqual(code, 3, out)
        self.assertIn("REFUSE  %s: setting the model defaults would make it unparseable" % path, out)
        self.assertEqual(path.read_text(encoding="utf-8"), original)
        self.assertFalse(Path(str(path) + ".pmhwc-models-backup").exists())
        record = json.loads((self.home / RECORD).read_text(encoding="utf-8"))
        self.assertNotIn(str(path), record["set"], "a refused edit must not be recorded as mhw's")
        code, out = self.run_mode("check")
        self.assertEqual(code, 3, out)
        self.assertIn("REFUSE  %s: setting the model defaults would make it unparseable" % path, out)

    def test_a_recorded_file_outside_home_is_never_edited(self):
        outside = BASE / ("outside-%d" % ModelDefaults.n) / "settings.json"
        outside.parent.mkdir(parents=True)
        outside.write_text(json.dumps({"model": "claude-opus-5-5[1m]", "theme": "dark"}), encoding="utf-8")
        record = self.home / RECORD
        record.parent.mkdir(parents=True)
        record.write_text(json.dumps({
            "managed-by": "managed-by: personal-multi-harness-workstation-configuration; source: x; %s; x" % STAMP,
            "set": {str(outside): {"harness": "claude-code", "keys": {"model": "claude-opus-5-5[1m]"}}}}),
            encoding="utf-8")
        code, out = self.run_mode("uninstall")
        self.assertEqual(code, 0, out)
        self.assertIn("NOTE    %s: recorded, but outside" % outside, out)
        self.assertEqual(json.loads(outside.read_text(encoding="utf-8"))["model"], "claude-opus-5-5[1m]")
        self.assertFalse(Path(str(outside) + ".pmhwc-models-backup").exists())

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
