#!/usr/bin/env python3
"""Suite for the plugin packager (Issue #62, ADR-0032). Throwaway directories only.

    python3 -B global/method/method_package_test.py [BASE_DIR]

BASE_DIR (default: a new directory under TMPDIR) holds every throwaway package and checkout.

What it asserts: the package is the Claude Code plugin tadeumendonca-skills at the given version; every
agent keeps its tool list; every file carries the generated marker and the one provenance stamp
(ADR-0029); the package carries no hooks and no protections; `check` turns red on each of those breaking;
`sync` replaces only the generated paths of a checkout and leaves (and names) everything else.

The load test with the real CLI, `claude plugin validate --strict`, runs only where `claude` is on PATH
(the reference machine; not the CI runner, which has no Claude Code). Elsewhere it prints SKIP. What that
CLI check catches was calibrated by hand on 2.1.296 (method/README.md): a missing front matter, a skill
without a description, a non-string version and an unknown manifest key; it does not catch a malformed
YAML value.
"""

import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parent.parent
PACKAGE = HERE / "method_package.py"
SOURCE = REPO / "method"
MARKER = "managed-by: personal-multi-harness-workstation-configuration"
GENERATED = "generated, do not edit"
VERSION = "9.9.9"
STAMP = "release: v9.9.9; commit: 0123456789abcdef0123456789abcdef01234567"
BASE = None

sys.path.insert(0, str(HERE))
import method_render as mr  # noqa: E402

SKILLS = sorted(p.parent.name for p in (SOURCE / "skills").glob("*/SKILL.md"))
COMMANDS = sorted(p.stem for p in (SOURCE / "commands").glob("*.md"))
AGENTS = sorted(p.stem for p in (SOURCE / "agents").glob("*.md"))


def run(*args):
    p = subprocess.run([sys.executable, "-B", str(PACKAGE)] + [str(a) for a in args], capture_output=True, text=True)
    return p.returncode, p.stdout + p.stderr


def fresh(prefix):
    return Path(tempfile.mkdtemp(prefix=prefix, dir=BASE))


def build(version=VERSION, stamp=STAMP, source=SOURCE):
    out = fresh("pkg-") / "plugin"
    code, text = run("build", "--out=%s" % out, "--version=%s" % version, "--stamp=%s" % stamp, "--source=%s" % source)
    return out, code, text


def front(path):
    lines = path.read_text(encoding="utf-8").split("\n")
    end = lines.index("---", 1)
    return lines[1:end]


def source_tools(name):
    fields, _ = mr.split_front_matter((SOURCE / "agents" / (name + ".md")).read_text(encoding="utf-8"), name)
    raw = fields["tools"]
    return raw if isinstance(raw, list) else [t.strip() for t in raw.split(",") if t.strip()]


class Build(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.out, cls.code, cls.text = build()

    def test_builds(self):
        self.assertEqual(self.code, 0, self.text)
        self.assertIn("8 agents, 14 skills, 7 commands", self.text)

    def test_manifest(self):
        doc = json.loads((self.out / ".claude-plugin/plugin.json").read_text(encoding="utf-8"))
        self.assertEqual(doc["name"], "tadeumendonca-skills")
        self.assertEqual(doc["version"], VERSION)
        self.assertIn(MARKER, doc["description"])
        self.assertIn(STAMP, doc["description"])
        self.assertIn(GENERATED, doc["description"])
        for key in ("hooks", "mcpServers", "lspServers", "settings", "outputStyles"):
            self.assertNotIn(key, doc)

    def test_tree_is_exactly_the_method(self):
        tree = sorted(str(p.relative_to(self.out)) for p in self.out.rglob("*") if p.is_file())
        want = sorted([".claude-plugin/plugin.json", ".mhw-generated"] + ["agents/%s.md" % a for a in AGENTS]
                      + ["skills/%s/SKILL.md" % s for s in SKILLS] + ["commands/%s.md" % c for c in COMMANDS])
        self.assertEqual(tree, want)
        listed = (self.out / ".mhw-generated").read_text(encoding="utf-8").split("\n")
        self.assertIn(MARKER, listed[0])
        self.assertIn(STAMP, listed[0])
        self.assertEqual(sorted(line for line in listed[1:] if line), want)

    def test_no_hooks_no_protections(self):
        for name in ("hooks", "settings.json", ".mcp.json", ".lsp.json", "scripts"):
            self.assertFalse((self.out / name).exists(), name)

    def test_every_markdown_file_is_marked_and_stamped(self):
        for path in sorted(self.out.rglob("*.md")):
            fm = front(path)
            self.assertTrue(fm[0].startswith("# " + MARKER), path)
            self.assertIn(STAMP, fm[0], path)
            self.assertIn(GENERATED, fm[0], path)
            self.assertIn("edit method/ in tedeuxx/mhw", fm[0], path)

    def test_every_agent_keeps_its_tool_list(self):
        for name in AGENTS:
            fm = front(self.out / "agents" / (name + ".md"))
            tools = [line for line in fm if line.startswith("tools: ")]
            self.assertEqual(len(tools), 1, name)
            want = source_tools(name)
            self.assertEqual(tools[0], "tools: " + (", ".join(want) if want else "[]"), name)
            self.assertIn("name: " + name, fm)

    def test_same_text_as_the_user_level_install(self):
        # The plugin and the user-level install render the same body; only the marker's tail differs.
        skills, agents, commands = mr.load(SOURCE)
        for name, a in agents.items():
            installed = mr.claude_agent(a, name, STAMP)
            packaged = (self.out / "agents" / (name + ".md")).read_text(encoding="utf-8")
            self.assertEqual(installed.split("\n", 2)[2], packaged.split("\n", 2)[2], name)
        for name, s in skills.items():
            installed = mr.skill_md(name, s["description"], s["purpose"], s["body"], s["where"], STAMP)
            packaged = (self.out / "skills" / name / "SKILL.md").read_text(encoding="utf-8")
            self.assertEqual(installed.split("\n", 2)[2], packaged.split("\n", 2)[2], name)

    def test_check_passes(self):
        code, text = run("check", "--package=%s" % self.out)
        self.assertEqual(code, 0, text)
        self.assertIn("one stamp", text)

    def test_claude_plugin_validate(self):
        claude = shutil.which("claude")
        if not claude:
            print("\nSKIP    claude plugin validate: no claude on PATH (the structural check above still ran)")
            return
        p = subprocess.run([claude, "plugin", "validate", "--strict", str(self.out)], capture_output=True, text=True,
                           timeout=120)
        self.assertEqual(p.returncode, 0, p.stdout + p.stderr)
        self.assertIn("Validation passed", p.stdout + p.stderr)


class BuildRefusals(unittest.TestCase):
    def test_version_must_be_numeric(self):
        for bad in ("5.4", "v5.4.0", "5.4.0-dev", "05.4.0"):
            _, code, text = build(version=bad, stamp="release: unreleased, after v5.3.0; commit: abc")
            self.assertEqual(code, 2, bad + text)

    def test_stamp_must_name_the_same_release(self):
        _, code, text = build(version="9.9.8")
        self.assertEqual(code, 2, text)
        self.assertIn("names release v9.9.9", text)

    def test_unreleased_stamp_is_accepted(self):
        _, code, text = build(stamp="release: unreleased, after v9.9.8; commit: abc-dirty")
        self.assertEqual(code, 0, text)

    def test_stamp_shape(self):
        _, code, _ = build(stamp="v9.9.9")
        self.assertEqual(code, 2)

    def test_non_empty_out_is_refused(self):
        out = fresh("busy-")
        (out / "keep").write_text("x", encoding="utf-8")
        code, text = run("build", "--out=%s" % out, "--version=%s" % VERSION, "--stamp=%s" % STAMP)
        self.assertEqual(code, 2, text)
        self.assertEqual(sorted(p.name for p in out.iterdir()), ["keep"])

    def test_invalid_source_writes_nothing(self):
        src = fresh("src-") / "method"
        shutil.copytree(SOURCE, src)
        (src / "agents" / "developer.md").write_text("no front matter\n", encoding="utf-8")
        out, code, text = build(source=src)
        self.assertEqual(code, 2, text)
        self.assertFalse(out.exists())


class CheckTurnsRed(unittest.TestCase):
    """Each break of the package, made in the package itself, must turn check red."""

    def broken(self, mutate):
        out, code, text = build()
        self.assertEqual(code, 0, text)
        mutate(out)
        return run("check", "--package=%s" % out)

    def assertRed(self, mutate, needle):
        code, text = self.broken(mutate)
        self.assertEqual(code, 1, text)
        self.assertIn(needle, text)

    def test_hooks_dir(self):
        def m(out):
            (out / "hooks").mkdir()
            (out / "hooks" / "hooks.json").write_text("{}", encoding="utf-8")
        self.assertRed(m, "no hooks")

    def test_hooks_key(self):
        def m(out):
            p = out / ".claude-plugin/plugin.json"
            doc = json.loads(p.read_text(encoding="utf-8"))
            doc["hooks"] = "./hooks/hooks.json"
            p.write_text(json.dumps(doc), encoding="utf-8")
        self.assertRed(m, "'hooks'")

    def test_wrong_name(self):
        def m(out):
            p = out / ".claude-plugin/plugin.json"
            doc = json.loads(p.read_text(encoding="utf-8"))
            doc["name"] = "other"
            p.write_text(json.dumps(doc), encoding="utf-8")
        self.assertRed(m, "name is 'other'")

    def test_marker_dropped_from_an_agent(self):
        def m(out):
            p = out / "agents" / "developer.md"
            lines = p.read_text(encoding="utf-8").split("\n")
            p.write_text("\n".join([lines[0]] + lines[2:]), encoding="utf-8")
        self.assertRed(m, "agents/developer.md: no generated marker")

    def test_second_stamp(self):
        def m(out):
            p = out / "skills" / "shell" / "SKILL.md"
            p.write_text(p.read_text(encoding="utf-8").replace("v9.9.9", "v9.9.8", 1), encoding="utf-8")
        self.assertRed(m, "2 stamps")

    def test_agent_without_tools(self):
        def m(out):
            p = out / "agents" / "scrum-master.md"
            p.write_text("\n".join(l for l in p.read_text(encoding="utf-8").split("\n") if not l.startswith("tools:")),
                         encoding="utf-8")
        self.assertRed(m, "agents/scrum-master.md: no tools key")

    def test_unlisted_file(self):
        self.assertRed(lambda out: (out / "agents" / "extra.md").write_text("x", encoding="utf-8"),
                       "does not match the tree")

    def test_listed_file_missing(self):
        self.assertRed(lambda out: (out / "commands" / "autonomy.md").unlink(), "does not match the tree")

    def test_skill_without_description(self):
        def m(out):
            p = out / "skills" / "shell" / "SKILL.md"
            p.write_text("\n".join(l for l in p.read_text(encoding="utf-8").split("\n")
                                   if not l.startswith("description:")), encoding="utf-8")
        self.assertRed(m, "skills/shell/SKILL.md: no description")

    def test_malformed_quoted_description(self):
        def m(out):
            p = out / "commands" / "autonomy.md"
            p.write_text(p.read_text(encoding="utf-8").replace('description: "', 'description: "\\q', 1), encoding="utf-8")
        self.assertRed(m, "commands/autonomy.md: no description")

    def test_unsafe_list_entry(self):
        def m(out):
            p = out / ".mhw-generated"
            p.write_text(p.read_text(encoding="utf-8") + "../outside\n", encoding="utf-8")
        self.assertRed(m, "outside the generated set")


class Sync(unittest.TestCase):
    def checkout(self):
        """A checkout shaped like the plugin repository before the first mirror."""
        t = fresh("checkout-")
        files = {
            ".claude-plugin/plugin.json": '{"name": "tadeumendonca-skills", "version": "2.0.106"}\n',
            ".claude-plugin/marketplace.json": '{"name": "marketplace"}\n',
            "hooks/hooks.json": "{}\n",
            "hooks/scripts/guard.sh": "#!/bin/sh\n",
            "agents/developer.md": "---\nname: developer\n---\nold\n",
            "commands/sprint-planning.md": "---\ndescription: x\n---\nnot in the method\n",
            "skills/shell/SKILL.md": "---\nname: shell\n---\nold\n",
            "skills/shell/reference.md": "an old file beside the skill\n",
            "skills/backend/SKILL.md": "---\nname: backend\n---\nnot moved yet (#64)\n",
            "README.md": "readme\n",
        }
        for rel, text in files.items():
            (t / rel).parent.mkdir(parents=True, exist_ok=True)
            (t / rel).write_text(text, encoding="utf-8")
        return t

    def test_first_sync(self):
        out, code, text = build()
        self.assertEqual(code, 0, text)
        t = self.checkout()
        code, text = run("sync", "--package=%s" % out, "--target=%s" % t)
        self.assertEqual(code, 0, text)
        for rel in [".claude-plugin/plugin.json", "agents/developer.md", "skills/shell/SKILL.md", ".mhw-generated"]:
            self.assertEqual((t / rel).read_text(encoding="utf-8"), (out / rel).read_text(encoding="utf-8"), rel)
        self.assertFalse((t / "skills/shell/reference.md").exists(), "a generated skill is replaced whole")
        for rel in ["hooks/hooks.json", "hooks/scripts/guard.sh", ".claude-plugin/marketplace.json", "README.md",
                    "commands/sprint-planning.md", "skills/backend/SKILL.md"]:
            self.assertTrue((t / rel).exists(), rel)
        self.assertIn("LEFT    commands/sprint-planning.md", text)
        self.assertIn("LEFT    skills/backend/SKILL.md", text)
        self.assertIn("NOTE    hooks/hooks.json", text)

    def test_second_sync_removes_what_left_the_method(self):
        out, code, text = build()
        t = self.checkout()
        self.assertEqual(run("sync", "--package=%s" % out, "--target=%s" % t)[0], 0)
        # A method without the content-writer agent and the shell skill.
        src = fresh("src-") / "method"
        shutil.copytree(SOURCE, src)
        (src / "agents" / "content-writer.md").unlink()
        shutil.rmtree(src / "skills" / "shell")
        for agent in (src / "agents").glob("*.md"):
            agent.write_text("\n".join(l for l in agent.read_text(encoding="utf-8").split("\n") if l != "  - shell"),
                             encoding="utf-8")
        out2, code, text = build(source=src)
        self.assertEqual(code, 0, text)
        # A file the previous sync wrote, edited by hand and stripped of its marker, is left.
        hand = t / "commands" / "autonomy.md"
        hand.write_text("edited by hand\n", encoding="utf-8")
        listed = (t / ".mhw-generated").read_text(encoding="utf-8")
        (out2 / "commands" / "autonomy.md").unlink()
        (out2 / ".mhw-generated").write_text(
            (out2 / ".mhw-generated").read_text(encoding="utf-8").replace("commands/autonomy.md\n", ""), encoding="utf-8")
        self.assertIn("commands/autonomy.md", listed)
        code, text = run("sync", "--package=%s" % out2, "--target=%s" % t)
        self.assertEqual(code, 0, text)
        self.assertFalse((t / "agents/content-writer.md").exists())
        self.assertFalse((t / "skills/shell").exists())
        self.assertIn("REMOVED agents/content-writer.md", text)
        self.assertTrue(hand.exists())
        self.assertIn("LEFT    commands/autonomy.md: listed by the previous sync", text)
        self.assertTrue((t / "skills/backend/SKILL.md").exists())

    def test_tampered_target_list_is_refused(self):
        out, _, _ = build()
        t = self.checkout()
        victim = t / "README.md"
        (t / ".mhw-generated").write_text("# %s\n../README.md\nREADME.md\n" % MARKER, encoding="utf-8")
        code, text = run("sync", "--package=%s" % out, "--target=%s" % t)
        self.assertEqual(code, 2, text)
        self.assertTrue(victim.exists())
        self.assertEqual((t / "agents/developer.md").read_text(encoding="utf-8"), "---\nname: developer\n---\nold\n")

    def test_failed_package_is_not_synced(self):
        out, _, _ = build()
        (out / "hooks").mkdir()
        (out / "hooks" / "hooks.json").write_text("{}", encoding="utf-8")
        t = self.checkout()
        code, text = run("sync", "--package=%s" % out, "--target=%s" % t)
        self.assertEqual(code, 2, text)
        self.assertIn("nothing was synced", text)
        self.assertEqual((t / "agents/developer.md").read_text(encoding="utf-8"), "---\nname: developer\n---\nold\n")


class Workflow(unittest.TestCase):
    """The mirror job's shape, read from version-main.yml as text (no YAML parser in the standard library)."""

    text = (REPO / ".github/workflows/version-main.yml").read_text(encoding="utf-8")

    def job(self):
        return self.text[self.text.index("\n  mirror:"):]

    def test_after_the_release(self):
        self.assertIn("needs: bump", self.job())

    def test_app_token_pinned_and_scoped(self):
        job = self.job()
        self.assertRegex(job, r"uses: actions/create-github-app-token@[0-9a-f]{40}\n")
        self.assertIn("app-id: ${{ secrets.MHW_MIRROR_APP_ID }}", job)
        self.assertIn("private-key: ${{ secrets.MHW_MIRROR_APP_PRIVATE_KEY }}", job)
        self.assertIn("owner: tedeuxx", job)
        self.assertIn("repositories: tadeumendonca-skills", job)
        self.assertIn("permission-contents: write", job)

    def test_skips_without_secrets_and_never_fails_the_release(self):
        job = self.job()
        self.assertIn("::notice", job)
        self.assertIn("steps.gate.outputs.ready == 'true'", job)
        # Every step after the gate is conditional on it.
        steps = job.split("\n      - ")[2:]
        for step in steps:
            self.assertIn("if: steps.gate.outputs.ready == 'true'", step, step[:80])

    def test_checks_before_it_pushes(self):
        job = self.job()
        self.assertLess(job.index("method_package.py check"), job.index(" push origin "))
        self.assertIn("method_package.py sync", job)

    def test_token_never_echoed(self):
        job = self.job()
        self.assertNotRegex(job, r"echo[^\n]*steps\.app\.outputs\.token")
        self.assertNotIn("set -x", job)

    def test_every_action_pinned(self):
        for line in self.text.split("\n"):
            if "uses:" in line:
                self.assertRegex(line, r"uses: [^@\s]+@[0-9a-f]{40}$", line)


if __name__ == "__main__":
    base = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else tempfile.mkdtemp(prefix="method-package-test-"))
    Path(base).mkdir(parents=True, exist_ok=True)
    BASE = base
    sys.argv = sys.argv[:1]
    unittest.main(verbosity=1)
