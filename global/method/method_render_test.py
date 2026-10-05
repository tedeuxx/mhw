#!/usr/bin/env python3
"""Suite for the working-method renderer (Issue #61, ADR-0032). Throwaway HOMEs only.

    python3 -B global/method/method_render_test.py [BASE_DIR]

BASE_DIR (default: a new directory under TMPDIR) holds every throwaway home; nothing else is written.
The two regressions this suite exists for: a rendered agent that loses its tool list, and a rendered
file that loses its provenance stamp (ADR-0029). Both are asserted per file, in every agent harness.
"""

import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parent.parent
RENDER = HERE / "method_render.py"
SOURCE = REPO / "method"
MARKER = "managed-by: personal-multi-harness-workstation-configuration"
STAMP = "release: v9.9.9; commit: 0123456789abcdef0123456789abcdef01234567"
OTHER = "release: v9.9.8; commit: fedcba9876543210fedcba9876543210fedcba98"
KIRO = {"Read": "read", "Grep": "read", "Glob": "read", "Write": "write", "Edit": "write", "Bash": "shell"}
BASE = None

sys.path.insert(0, str(HERE))
import method_render as mr  # noqa: E402


def source_agents():
    out = {}
    for path in sorted((SOURCE / "agents").glob("*.md")):
        fields, _ = mr.split_front_matter(path.read_text(encoding="utf-8"), path.name)
        raw = fields["tools"]
        ex = fields.get("disallowed-tools", [])
        out[path.stem] = {"tools": raw if isinstance(raw, list) else [t.strip() for t in raw.split(",")],
                          "excluded": ex if isinstance(ex, list) else [t.strip() for t in ex.split(",")],
                          "skills": fields.get("skills", [])}
    return out


SKILLS = sorted(p.parent.name for p in (SOURCE / "skills").glob("*/SKILL.md"))
COMMANDS = sorted(p.stem for p in (SOURCE / "commands").glob("*.md"))
AGENTS = source_agents()


def front_matter(path):
    lines = path.read_text(encoding="utf-8").split("\n")
    end = lines.index("---", 1)
    return lines[1:end]


class Home:
    def __init__(self):
        self.root = Path(tempfile.mkdtemp(prefix="home-", dir=BASE))
        self.env = {"PATH": os.environ.get("PATH", "/usr/bin:/bin"), "HOME": str(self.root),
                    "TMPDIR": str(Path(BASE) / "tmp")}
        (Path(BASE) / "tmp").mkdir(exist_ok=True)

    def run(self, *args, stamp=STAMP, opt_in=True):
        cmd = [sys.executable, "-B", str(RENDER)] + list(args)
        if stamp is not None and not any(a.startswith("--stamp=") for a in args):
            cmd.append("--stamp=" + stamp)
        if opt_in:
            cmd.append("--opt-in")
        p = subprocess.run(cmd, env=self.env, capture_output=True, text=True)
        return p.returncode, p.stdout + p.stderr

    def p(self, rel):
        return self.root / rel

    def all_targets(self):
        out = []
        for s in SKILLS:
            out += [".claude/skills/%s/SKILL.md" % s, ".agents/skills/%s/SKILL.md" % s, ".kiro/skills/%s/SKILL.md" % s]
        for c in COMMANDS:
            out += [".claude/commands/%s.md" % c, ".agents/skills/%s/SKILL.md" % c,
                    ".agents/skills/%s/agents/openai.yaml" % c, ".kiro/skills/%s/SKILL.md" % c]
        for a in AGENTS:
            out += [".claude/agents/%s.md" % a, ".codex/agents/%s.toml" % a, ".kiro/agents/%s.json" % a]
        return out


def marker_line(path):
    if path.suffix == ".json":
        return json.loads(path.read_text(encoding="utf-8"))["prompt"].split("\n", 1)[0]
    for line in path.read_text(encoding="utf-8").split("\n")[:5]:
        if MARKER in line:
            return line
    return ""


class SourceShape(unittest.TestCase):
    def test_the_target_set(self):
        self.assertEqual(sorted(AGENTS), sorted(["agents-lead", "tech-lead", "developer", "quality-assurance",
                                                 "scrum-master", "product-lead", "content-writer",
                                                 "content-reviewer"]))
        self.assertEqual(SKILLS, sorted(["agents-configuration", "shell", "documentation-standard",
                                         "engineering-standards", "definition-of-ready", "definition-of-done",
                                         "quality-gates", "published-voice", "scm", "ci", "provisioning",
                                         "planning-poker", "code-review", "content-publishing"]))
        self.assertEqual(COMMANDS, sorted(["autonomy", "new-issue", "new-idea", "idea-to-issues", "handover", "what-else",
                                           "blueprint"]))

    def test_planning_poker_no_longer_says_reference_pattern_only(self):
        fields, _ = mr.split_front_matter((SOURCE / "skills/planning-poker/SKILL.md").read_text(encoding="utf-8"), "pp")
        self.assertNotIn("reference pattern", fields["description"].lower())
        self.assertIn("agents", fields["description"])

    def test_every_agent_declares_tools_and_preloads_known_skills(self):
        for name, a in AGENTS.items():
            for s in a["skills"]:
                self.assertIn(s, SKILLS, name)
        self.assertEqual(AGENTS["scrum-master"]["tools"], [])
        # the browser grant stays read-only natively: the input-carrying tools are excluded
        self.assertIn("mcp__chrome-devtools__evaluate_script", AGENTS["product-lead"]["excluded"])



# Issue #97: the former devops skill is split by capability. Each capability skill names the tool it is
# written for in an opening disclaimer, and keeps every tool-specific word in one closing section, so a
# tool switch replaces that section only. Vendor words outside both are the regression.
CAPABILITY_SKILLS = {
    "scm": ("GitHub", r"\bGitHub\b|\bgh\b"),
    "ci": ("GitHub Actions", r"\bGitHub\b|\.github/|workflow_dispatch|\buses:"),
    "quality-gates": ("SonarCloud", r"Sonar|SONAR_"),
    "provisioning": ("Terraform Cloud", r"[Tt]erraform|\bTFC\b|TF_WORKSPACE"),
}
DISCLAIMER_RE = re.compile(r"> \*\*Written for the selected tool: (.+?)\.\*\*")


def capability_parts(name):
    """(tool in the disclaimer, disclaimer lines, tool-section lines, every other line) of one skill."""
    lines = (SOURCE / "skills" / name / "SKILL.md").read_text(encoding="utf-8").split("\n")
    end = lines.index("---", 1)
    body = lines[end + 1:]
    first = next(i for i, line in enumerate(body) if line.strip())
    m = DISCLAIMER_RE.match(body[first])
    tool = m.group(1) if m else None
    last = first
    while last < len(body) and body[last].startswith(">"):
        last += 1
    disclaimer = body[first:last] if m else []
    starts = [i for i, line in enumerate(body) if line.startswith("## Tool section")]
    section = body[starts[0]:] if len(starts) == 1 else []
    rest = lines[:end + 1] + body[:first] + (body[last:starts[0]] if (m and len(starts) == 1) else body)
    return tool, disclaimer, section, rest, starts


class CapabilitySkills(unittest.TestCase):
    def test_devops_is_gone_and_no_agent_preloads_it(self):
        self.assertNotIn("devops", SKILLS)
        for name, a in AGENTS.items():
            self.assertNotIn("devops", a["skills"], name)
        for name in CAPABILITY_SKILLS:
            self.assertIn(name, SKILLS)

    def test_each_opens_with_the_disclaimer_naming_its_tool(self):
        for name, (tool, _) in CAPABILITY_SKILLS.items():
            found, disclaimer, _, _, _ = capability_parts(name)
            self.assertEqual(found, tool, "%s: the body must open with the selected-tool disclaimer" % name)
            text = " ".join(line.lstrip("> ") for line in disclaimer)
            self.assertIn("replace that section only", text, name)

    def test_one_closing_tool_section_holds_the_tool(self):
        for name, (tool, _) in CAPABILITY_SKILLS.items():
            _, _, section, _, starts = capability_parts(name)
            self.assertEqual(len(starts), 1, "%s: exactly one tool section" % name)
            self.assertEqual(section[0], "## Tool section — %s" % tool, name)
            later = [line for line in section[1:] if line.startswith("## ")]
            self.assertEqual(later, [], "%s: the tool section must be the last section" % name)

    def test_scm_keeps_the_two_layers_and_deny_wins(self):
        _, _, _, rest, _ = capability_parts("scm")
        text = "\n".join(rest)
        self.assertIn("Deny from any layer wins", text)
        self.assertIn("settings.local.json", text)

    def test_no_tool_word_outside_the_disclaimer_and_the_tool_section(self):
        for name, (_, pattern) in CAPABILITY_SKILLS.items():
            _, _, _, rest, _ = capability_parts(name)
            leaks = [line for line in rest if re.search(pattern, line)]
            self.assertEqual(leaks, [], "%s: tool-specific text outside its tool section" % name)

class Render(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.h = Home()
        cls.code, cls.out = cls.h.run("--mode=install")

    def test_install_writes_every_target(self):
        self.assertEqual(self.code, 0, self.out)
        for rel in self.h.all_targets():
            self.assertTrue(self.h.p(rel).is_file(), rel)
        self.assertIn("METHOD  installed: %d agents, %d skills, %d commands" % (len(AGENTS), len(SKILLS), len(COMMANDS)),
                      self.out)

    def test_every_rendered_file_carries_the_stamp(self):
        missing = []
        for rel in self.h.all_targets():
            line = marker_line(self.h.p(rel))
            if not (MARKER in line and "; source: method/" in line and ("; %s;" % STAMP) in line):
                missing.append(rel)
        self.assertEqual(missing, [])

    def test_claude_agent_carries_its_tool_list_and_preloads(self):
        for name, a in AGENTS.items():
            fm = front_matter(self.h.p(".claude/agents/%s.md" % name))
            tools = [l for l in fm if l.startswith("tools:")]
            want = "tools: " + (", ".join(a["tools"]) if a["tools"] else "[]")
            self.assertEqual(tools, [want], name)
            dis = [l for l in fm if l.startswith("disallowedTools:")]
            self.assertEqual(dis, ["disallowedTools: " + ", ".join(a["excluded"])] if a["excluded"] else [], name)
            got = [l.strip()[2:] for l in fm if l.startswith("  - ")]
            self.assertEqual(got, a["skills"], name)

    def test_kiro_agent_carries_its_tool_list(self):
        for name, a in AGENTS.items():
            doc = json.loads(self.h.p(".kiro/agents/%s.json" % name).read_text(encoding="utf-8"))
            want = []
            for t in a["tools"]:
                tag = "@" + t[5:] if t.startswith("mcp__") else KIRO[t]
                if tag not in want:
                    want.append(tag)
            self.assertIn("tools", doc, name)
            self.assertEqual(doc["tools"], want, name)
            # Kiro carries no deny floor, so nothing may be auto-approved (agents-lead lens, PR #94).
            self.assertNotIn("allowedTools", doc, name)
            ex = ["@%s/%s" % tuple(t[5:].split("__", 1)) for t in a["excluded"]]
            self.assertEqual(doc.get("excludedTools", []), ex, name)
            self.assertEqual(doc["resources"], [self.h.p(".kiro/skills/%s/SKILL.md" % s).as_uri()
                                                for s in a["skills"]], name)

    def test_codex_agent_carries_its_tool_list_as_an_instruction(self):
        for name, a in AGENTS.items():
            text = self.h.p(".codex/agents/%s.toml" % name).read_text(encoding="utf-8")
            doc = parse_toml(text)
            self.assertEqual(doc["name"], name.replace("-", "_"))
            tools = ", ".join(a["tools"]) if a["tools"] else "none"
            self.assertIn("Allowed tools for this agent: %s." % tools, doc["developer_instructions"], name)
            self.assertIn("carries no tool list", doc["developer_instructions"], name)
            self.assertIn("inherit the parent session's MCP", doc["developer_instructions"], name)
            self.assertNotIn("the one native narrowing", doc["developer_instructions"], name)
            if a["excluded"]:
                self.assertIn("Excluded tools, even within a granted server: %s." % ", ".join(a["excluded"]),
                              doc["developer_instructions"], name)
            writes = set(a["tools"]) & {"Write", "Edit", "Bash"}
            self.assertEqual(doc.get("sandbox_mode"), None if writes else "read-only", name)

    def test_commands_per_agent_harness(self):
        for c in COMMANDS:
            yaml_text = self.h.p(".agents/skills/%s/agents/openai.yaml" % c).read_text(encoding="utf-8")
            self.assertIn("\npolicy:\n  allow_implicit_invocation: false\n", yaml_text)
            self.assertIn("Owner-typed command $%s" % c, self.h.p(".agents/skills/%s/SKILL.md" % c).read_text(encoding="utf-8"))
            self.assertIn("Owner-typed command /%s" % c, self.h.p(".kiro/skills/%s/SKILL.md" % c).read_text(encoding="utf-8"))
            self.assertIn("argument-hint:", "\n".join(front_matter(self.h.p(".claude/commands/%s.md" % c))))

    def test_skill_front_matter_is_what_codex_and_kiro_read(self):
        for s in SKILLS + COMMANDS:
            fm = front_matter(self.h.p(".kiro/skills/%s/SKILL.md" % s))
            self.assertIn("name: %s" % json.dumps(s), fm)
            desc = [l for l in fm if l.startswith("description: ")]
            self.assertEqual(len(desc), 1)
            self.assertLessEqual(len(json.loads(desc[0][len("description: "):])), 1024)

    def test_check_is_clean_then_names_each_difference(self):
        h = Home()
        self.assertEqual(h.run("--mode=install")[0], 0)
        code, out = h.run("--mode=check")
        self.assertEqual(code, 0, out)
        self.assertEqual(len(re.findall(r"^OK ", out, re.M)), len(h.all_targets()))
        # another commit's stamp on unchanged content -> STAMP; a content change -> DRIFT; absent -> MISSING
        f1 = h.p(".claude/agents/developer.md")
        f1.write_text(f1.read_text(encoding="utf-8").replace(STAMP, OTHER), encoding="utf-8")
        f2 = h.p(".kiro/agents/developer.json")
        f2.write_text(f2.read_text(encoding="utf-8").replace('"read"', '"web"', 1), encoding="utf-8")
        h.p(".agents/skills/shell/SKILL.md").unlink()
        code, out = h.run("--mode=check")
        self.assertEqual(code, 1)
        self.assertRegex(out, r"(?m)^STAMP   .*\.claude/agents/developer\.md: .*commit: fedcba98")
        self.assertRegex(out, r"(?m)^DRIFT   .*\.kiro/agents/developer\.json")
        self.assertRegex(out, r"(?m)^MISSING .*\.agents/skills/shell/SKILL\.md")
        code, out = h.run("--mode=install")
        self.assertEqual(code, 0, out)
        self.assertRegex(out, r"(?m)^RESTAMPED .*developer\.md")
        self.assertEqual(h.run("--mode=check")[0], 0)

    def test_dry_run_writes_nothing(self):
        h = Home()
        code, out = h.run("--mode=dry-run")
        self.assertEqual(code, 0, out)
        self.assertEqual([p for p in h.root.rglob("*") if p.is_file()], [])
        self.assertEqual(len(re.findall(r"^WOULD WRITE ", out, re.M)), len(h.all_targets()))

    def test_off_by_default_then_kept_current(self):
        h = Home()
        for mode in ("install", "check", "dry-run"):
            code, out = h.run("--mode=" + mode, opt_in=False)
            self.assertEqual(code, 0, out)
            self.assertIn("METHOD  not installed", out)
        self.assertEqual([p for p in h.root.rglob("*") if p.is_file()], [])
        self.assertEqual(h.run("--mode=install")[0], 0)
        f = h.p(".claude/agents/developer.md")
        f.write_text(f.read_text(encoding="utf-8").replace(STAMP, OTHER), encoding="utf-8")
        code, out = h.run("--mode=check", opt_in=False)  # once present, it is checked without the flag
        self.assertEqual(code, 1, out)
        self.assertRegex(out, r"(?m)^STAMP   .*developer\.md")

    def test_home_argument_wins_over_HOME(self):
        # install.ps1 passes --home=<profile> so a HOME set on Windows is never written to.
        h, other = Home(), Home()
        code, out = h.run("--mode=install", "--home=%s" % other.root)
        self.assertEqual(code, 0, out)
        self.assertTrue(other.p(".claude/agents/developer.md").is_file())
        self.assertEqual([p for p in h.root.rglob("*") if p.is_file()], [])

    def test_unmanaged_file_is_refused_and_kept(self):
        h = Home()
        mine = h.p(".claude/agents/developer.md")
        mine.parent.mkdir(parents=True)
        mine.write_text("owner's own agent\n", encoding="utf-8")
        code, out = h.run("--mode=install")
        self.assertEqual(code, 3, out)
        self.assertRegex(out, r"REFUSE  .*developer\.md")
        self.assertEqual(mine.read_text(encoding="utf-8"), "owner's own agent\n")

    def test_stale_and_uninstall_touch_only_method_files(self):
        h = Home()
        self.assertEqual(h.run("--mode=install")[0], 0)
        stale = h.p(".claude/agents/retired-persona.md")
        stale.write_text("---\n# %s; source: method/agents/retired-persona.md; %s; do not edit\n---\n" % (MARKER, STAMP),
                         encoding="utf-8")
        other = h.p(".claude/commands/breaking-glass.md")  # install.sh's own managed file, not the method's
        other.write_text("<!-- %s; source: global/x; %s -->\n" % (MARKER, STAMP), encoding="utf-8")
        owner = h.p(".claude/skills/owner-skill/SKILL.md")
        owner.parent.mkdir(parents=True)
        owner.write_text("---\nname: owner-skill\n---\n", encoding="utf-8")
        code, out = h.run("--mode=check")
        self.assertEqual(code, 1)
        self.assertRegex(out, r"(?m)^STALE   .*retired-persona\.md")
        self.assertNotIn("breaking-glass", out)
        self.assertEqual(h.run("--mode=install")[0], 0)
        self.assertFalse(stale.exists())
        code, out = h.run("--mode=uninstall", stamp=None)
        self.assertEqual(code, 0, out)
        for rel in h.all_targets():
            self.assertFalse(h.p(rel).exists(), rel)
        self.assertTrue(other.exists() and owner.exists())

    def test_a_source_agent_without_tools_is_refused(self):
        h = Home()
        src = Path(tempfile.mkdtemp(prefix="bad-source-", dir=BASE)) / "method"
        shutil.copytree(SOURCE, src)
        f = src / "agents" / "developer.md"
        f.write_text(re.sub(r"(?m)^tools:.*\n", "", f.read_text(encoding="utf-8"), count=1), encoding="utf-8")
        code, out = h.run("--mode=install", "--source=%s" % src)
        self.assertEqual(code, 2, out)
        self.assertIn("tools must be declared", out)
        self.assertEqual([p for p in h.root.rglob("*") if p.is_file()], [])


class ThroughTheInstaller(unittest.TestCase):
    """install.sh runs the method as its own step, with its own stamp; uninstall removes it."""

    def test_install_check_uninstall(self):
        h = Home()
        inst = REPO / "global" / "install.sh"
        p = subprocess.run(["sh", str(inst)], env=h.env, capture_output=True, text=True)
        self.assertEqual(p.returncode, 0, p.stdout + p.stderr)
        self.assertIn("METHOD  not installed", p.stdout)  # off by default until the plugin cutover
        self.assertFalse(h.p(".claude/agents/developer.md").exists())
        p = subprocess.run(["sh", str(inst), "--method"], env=h.env, capture_output=True, text=True)
        self.assertEqual(p.returncode, 0, p.stdout + p.stderr)
        source = re.search(r"(?m)^SOURCE  (.*)$", p.stdout).group(1)
        self.assertIn("; %s;" % source, marker_line(h.p(".kiro/agents/quality-assurance.json")))
        self.assertIn("METHOD  installed: ", p.stdout)
        p = subprocess.run(["sh", str(inst), "--check"], env=h.env, capture_output=True, text=True)
        self.assertEqual(p.returncode, 0, p.stdout + p.stderr)
        p = subprocess.run(["sh", str(inst), "--uninstall"], env=h.env, capture_output=True, text=True)
        self.assertEqual(p.returncode, 0, p.stdout + p.stderr)
        self.assertFalse(h.p(".claude/agents/developer.md").exists())
        self.assertFalse(h.p(".codex/agents/developer.toml").exists())


def parse_toml(text):
    try:
        import tomllib
        return tomllib.loads(text)
    except ImportError:
        # Python < 3.11: the renderer writes only "# comment" lines and key = <JSON string> lines.
        doc = {}
        for line in text.split("\n"):
            if not line or line.startswith("#"):
                continue
            key, value = line.split(" = ", 1)
            doc[key] = json.loads(value)
        return doc


if __name__ == "__main__":
    base = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else tempfile.mkdtemp(prefix="method-render-test-"))
    Path(base).mkdir(parents=True, exist_ok=True)
    BASE = base
    sys.argv = sys.argv[:1]
    unittest.main(verbosity=1)
