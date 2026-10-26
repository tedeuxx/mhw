#!/usr/bin/env python3
"""Regression suite for the workflow commands (Issues #71-#75): every one renders on all three agent harnesses.

    python3 -B global/method/method_commands_test.py [BASE_DIR]

Renders method/ into one throwaway HOME (BASE_DIR, default a new directory under TMPDIR) and asserts, per
command and per agent harness, that the command is present in that harness's native carrier, that the
Codex skill keeps implicit invocation off, and that every required section of the command reaches the
rendered text. For /handoff (#198) it runs the installed launch-line script with the harness each
carrier names and checks the line it prints. It also checks a synthetic session-handover prompt's sanitisation against the
workstation's paste-filter detector (#73; the /handover command itself was removed at #196). Nothing outside BASE_DIR is written.
"""

import json
import os
import re
import shutil
import stat
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parent.parent
RENDER = HERE / "method_render.py"
STAMP = "release: v9.9.9; commit: 0123456789abcdef0123456789abcdef01234567"
BASE = None

sys.path.insert(0, str(REPO / "global" / "clipboard"))
sys.path.insert(0, str(REPO / "global"))
import clipboard_guard as guard  # noqa: E402

# The sections each command must carry. The first four are shared; the rest are the behaviour its Issue
# asks for. "What this command never does" holds the merge, publish and hook prohibitions.
SHARED = ["## What this command never does"]
REQUIRED = {
    "new-prd": SHARED + ["## When to use", "## Steps", "## Interview rounds", "## The requirements document"],
    "prd-to-issues": SHARED + ["## When to use", "## Steps", "## Vertical slices", "## Definition of ready",
                                "## Opening the Issues"],
    "what-else": SHARED + ["## The anchored objective", "## Read the bus", "## The answer"],
    "blueprint": SHARED + ["## export", "## import", "## Alignment interview"],
    "handoff": SHARED + ["## When to use", "## Build the prompt", "## The prompt", "## Print it"],
    "need-me": SHARED + ["## The rules this command runs", "## Gather what is pending", "## When nothing is pending",
                         "## Ask one at a time", "## After he answers"],
}
# The four rites moved from the plugin at #130 (owner, 2026-10-12). They keep the plugin's text, so they are
# held to the headings that carry each rite, not to the workflow commands' "never" section.
RITES = {
    "sprint-planning": ["## The trigger", "## What this rite does NOT do", "## What nothing enforces, said before any green is read"],
    "sprint-review": ["## The trigger, and where it sits among the three rites", "## What this rite cannot see"],
    "sprint-retrospective": ["## The trigger", "## What this cannot catch"],
    "funnel-review": ["## The steps", "## What this rite cannot see"],
}
# The old names, kept for one release as deprecated aliases (owner, 2026-10-26: "-idea- deveria ser
# renomeado para -prd em todos comandos com esse termo"). Each must still run the whole command.
DEPRECATED = {"new-idea": "new-prd", "idea-to-issues": "prd-to-issues"}
RETIRED_NOTE = "> **Read this first: hooks named below are the retired plugin's, not controls you have (#61).**"
# Phrases that carry the behaviour the Issues require, beyond the headings.
PHRASES = {
    "new-prd": ["product-requirements-document-<subject>.md", "recommended answer", "Mermaid"],
    "prd-to-issues": ["--body-file", "Blocked by #N", "definition-of-ready", "acceptance criteria"],
    "what-else": ["native goal command (`/goal`)", "gh pr list --state open", "owner decisions"],
    "blueprint": ["product-requirements-document-agent-harness-setup.md", "Mermaid",
                  "Nothing is changed before the alignment interview is complete"],
    "handoff": ["re-derive the state from the tracker", "It prints only", "launch-line.py",
                "at most 280 characters", "Then stop working in this session"],
    # The owner's request (2026-10-26): HITL escalation on demand, under today's discipline, three options.
    "need-me": ["**Escalating to the owner**", "**owner overlay**", "Exactly **three** authored, mutually exclusive",
                "one line, the act and the link", "Put **only the first** to him", "**Never manufacture an ask**",
                "--state open --label owner-action", "queue was **not read**", "--body-file", "quoting his"],
}


def render(home):
    env = {"PATH": os.environ.get("PATH", "/usr/bin:/bin"), "HOME": str(home), "TMPDIR": str(home)}
    p = subprocess.run([sys.executable, "-B", str(RENDER), "--mode=install", "--stamp=" + STAMP, "--opt-in",
                        "--source=" + str(REPO / "method")], env=env, capture_output=True, text=True)
    return p.returncode, p.stdout + p.stderr


def carriers(home, name):
    """agent harness -> the rendered file that carries the command there."""
    return {"claude": home / ".claude" / "commands" / (name + ".md"),
            "codex": home / ".agents" / "skills" / name / "SKILL.md",
            "kiro": home / ".kiro" / "skills" / name / "SKILL.md"}


class Commands(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.home = Path(tempfile.mkdtemp(prefix="home-", dir=BASE))
        cls.code, cls.out = render(cls.home)

    def test_render_succeeds(self):
        self.assertEqual(self.code, 0, self.out)

    def test_every_command_is_in_every_carrier(self):
        for name in REQUIRED:
            for harness, path in carriers(self.home, name).items():
                self.assertTrue(path.is_file(), "%s missing in %s" % (name, harness))

    def test_codex_keeps_implicit_invocation_off(self):
        for name in REQUIRED:
            policy = self.home / ".agents" / "skills" / name / "agents" / "openai.yaml"
            self.assertIn("\npolicy:\n  allow_implicit_invocation: false\n", policy.read_text(encoding="utf-8"), name)

    def test_invocation_names_per_harness(self):
        for name in REQUIRED:
            c = carriers(self.home, name)
            # #196: argument-hint only on the plugin standard's allowlisted owner-typed commands (blueprint
            # here); the other workflow commands fold the hint text into their description.
            head = c["claude"].read_text(encoding="utf-8").split("\n---\n", 1)[0]
            (self.assertIn if name == "blueprint" else self.assertNotIn)("argument-hint:", head, name)
            self.assertIn("Owner-typed command $%s" % name, c["codex"].read_text(encoding="utf-8"), name)
            self.assertIn("Owner-typed command /%s" % name, c["kiro"].read_text(encoding="utf-8"), name)
            for harness in ("codex", "kiro"):
                head = c[harness].read_text(encoding="utf-8").split("\n---\n", 1)[0]
                self.assertIn("name: " + json.dumps(name), head, (name, harness))

    def test_required_sections_reach_every_carrier(self):
        missing = []
        for name, headings in REQUIRED.items():
            for harness, path in carriers(self.home, name).items():
                lines = path.read_text(encoding="utf-8").split("\n")
                missing += ["%s/%s: %s" % (name, harness, h) for h in headings if h not in lines]
                text = "\n".join(lines)
                missing += ["%s/%s: %r" % (name, harness, p) for p in PHRASES[name] if p not in text]
        self.assertEqual(missing, [])

    def test_deprecated_names_still_run_the_whole_command(self):
        missing = []
        for old, new in DEPRECATED.items():
            for harness, path in carriers(self.home, old).items():
                if not path.is_file():
                    missing.append("%s/%s: not rendered" % (old, harness))
                    continue
                text = path.read_text(encoding="utf-8")
                lines = text.split("\n")
                missing += ["%s/%s: %s" % (old, harness, h) for h in REQUIRED[new] if h not in lines]
                missing += ["%s/%s: %r" % (old, harness, p) for p in PHRASES[new] if p not in text]
                if "is the old name of `%s`" % new not in text:
                    missing.append("%s/%s: no deprecation note naming %s" % (old, harness, new))
            policy = self.home / ".agents" / "skills" / old / "agents" / "openai.yaml"
            if "allow_implicit_invocation: false" not in policy.read_text(encoding="utf-8"):
                missing.append("%s/codex: implicit invocation on" % old)
        self.assertEqual(missing, [])

    def test_never_section_forbids_merge_publish_and_hooks(self):
        for name in REQUIRED:
            text = carriers(self.home, name)["claude"].read_text(encoding="utf-8")
            never = text.split("## What this command never does", 1)[1]
            for word in ("merges", "publishes", "hook"):
                self.assertIn(word, never, (name, word))

    def test_rendered_commands_carry_no_secret_or_personal_data(self):
        for name in REQUIRED:
            for harness, path in carriers(self.home, name).items():
                self.assertEqual(guard.find_spans(path.read_text(encoding="utf-8")), [], (name, harness))


class NeedMe(unittest.TestCase):
    """The owner's /need-me (2026-10-26): it runs the escalation rules in force and restates none of them
    in a weaker form, asks one item at a time, and writes only the record of his answer."""

    @classmethod
    def setUpClass(cls):
        cls.text = (REPO / "method" / "commands" / "need-me.md").read_text(encoding="utf-8")
        cls.body = cls.text.split("\n---\n", 1)[1]

    def test_defers_to_the_rules_in_force(self):
        self.assertIn("This command adds no escalation rule of its own", self.body)
        self.assertIn("it follows the stricter", self.body)

    def test_no_weaker_option_count(self):
        # The overlay sets exactly three; the brief's ceiling of four must not reappear as this command's rule,
        # in the body or the front matter, bold or plain.
        flat = re.sub(r"\s+", " ", self.text.replace("*", "").replace("`", "")).lower()
        self.assertNotRegex(flat, r"\b(at most|up to|no more than|maximum of) (four|4)\b")
        self.assertNotRegex(flat, r"\b(two|four|five|2|4|5) (authored |direct |answer )?(options|choices)\b")
        self.assertIn("exactly three authored, mutually exclusive options", flat)

    def test_an_empty_list_is_not_an_empty_queue(self):
        # gh issue list with an absent label prints [] and exits 0 (measured, global/owner_actions.py), so the
        # command must confirm the label before reading [] as zero, as owner_actions.py does.
        flat = re.sub(r"\s+", " ", self.body)
        self.assertIn("gh label list --repo tedeuxx/mhw --limit 1000 --json name", flat)
        self.assertIn("An empty list is not yet an empty queue", flat)
        self.assertIn("If `owner-action` is not among the names, or either call fails, say the queue was **not read**", flat)
        self.assertIn("mhw status --summary", flat)
        import owner_actions  # noqa: E402 - the repository the status line reads must be the one named here
        queue = flat.split("**The owner-action queue**", 1)[1].split("Then filter", 1)[0]
        self.assertEqual(set(re.findall(r"--repo (\S+)", queue)), {owner_actions.REPO})
        self.assertEqual(len(re.findall(r"--repo ", queue)), 2)
        self.assertIn("--label %s " % owner_actions.LABEL, flat)

    def test_writes_only_the_record(self):
        never = self.body.split("## What this command never does", 1)[1]
        self.assertIn("It writes nothing except the comment that records his answer", never)
        self.assertIn("It never asks two things in one message", never)
        self.assertNotIn("gh issue create", self.body)
        self.assertNotIn("--add-label", self.body)


class Rites(unittest.TestCase):
    """#130: the four rites render for every agent harness method/ targets, in the method's shape."""

    @classmethod
    def setUpClass(cls):
        cls.home = Path(tempfile.mkdtemp(prefix="home-", dir=BASE))
        cls.code, cls.out = render(cls.home)

    def test_render_succeeds(self):
        self.assertEqual(self.code, 0, self.out)

    def test_every_rite_is_in_every_carrier(self):
        for name in RITES:
            for harness, path in carriers(self.home, name).items():
                self.assertTrue(path.is_file(), "%s missing in %s" % (name, harness))

    def test_codex_keeps_implicit_invocation_off(self):
        for name in RITES:
            policy = self.home / ".agents" / "skills" / name / "agents" / "openai.yaml"
            self.assertIn("\npolicy:\n  allow_implicit_invocation: false\n", policy.read_text(encoding="utf-8"), name)

    def test_invocation_names_and_front_matter(self):
        for name in RITES:
            c = carriers(self.home, name)
            head = c["claude"].read_text(encoding="utf-8").split("\n---\n", 1)[0]
            self.assertIn("argument-hint:", head, name)
            self.assertIn("Owner-typed command $%s" % name, c["codex"].read_text(encoding="utf-8"), name)
            self.assertIn("Owner-typed command /%s" % name, c["kiro"].read_text(encoding="utf-8"), name)
            source = (REPO / "method" / "commands" / (name + ".md")).read_text(encoding="utf-8")
            front = source.split("\n---\n", 1)[0]
            for key in ("name", "description", "purpose", "argument-hint"):
                self.assertRegex(front, r'(?m)^%s: "' % key, (name, key))
            self.assertIn('name: "%s"' % name, front)

    def test_headings_and_retired_note_reach_every_carrier(self):
        missing = []
        for name, headings in RITES.items():
            for harness, path in carriers(self.home, name).items():
                text = path.read_text(encoding="utf-8")
                lines = text.split("\n")
                missing += ["%s/%s: %s" % (name, harness, h) for h in headings if h not in lines]
                if RETIRED_NOTE not in text:
                    missing.append("%s/%s: the retired-hooks note" % (name, harness))
        self.assertEqual(missing, [])

    def test_no_plugin_namespaced_invocation(self):
        for name in RITES:
            text = (REPO / "method" / "commands" / (name + ".md")).read_text(encoding="utf-8")
            body = text.split(RETIRED_NOTE, 1)[1].split("\n\n", 1)[1]
            self.assertNotRegex(body, r"/tadeumendonca-skills:[a-z]", name)
        autonomy = (REPO / "method" / "commands" / "autonomy.md").read_text(encoding="utf-8")
        self.assertNotRegex(autonomy, r"/tadeumendonca-skills:(sprint|funnel)", "autonomy")

    def test_pointers_to_the_rites_resolve(self):
        import re
        unresolved = []
        for path in sorted((REPO / "method").rglob("*.md")):
            text = path.read_text(encoding="utf-8")
            for name in set(re.findall(r"commands/(sprint-planning|sprint-review|sprint-retrospective|funnel-review)\.md", text)) | \
                    set(re.findall(r"`/(sprint-planning|sprint-review|sprint-retrospective|funnel-review)\b", text)):
                if not (REPO / "method" / "commands" / (name + ".md")).is_file():
                    unresolved.append("%s -> %s" % (path.relative_to(REPO), name))
        self.assertEqual(unresolved, [])
        self.assertTrue(any((REPO / "method" / "commands" / (n + ".md")).is_file() for n in RITES))

    def test_rendered_rites_carry_no_secret_or_personal_data(self):
        for name in RITES:
            for harness, path in carriers(self.home, name).items():
                self.assertEqual(guard.find_spans(path.read_text(encoding="utf-8")), [], (name, harness))


SCRIPTS_REL = Path(".local/share/personal-multi-harness-workstation-configuration/method/scripts")
TOKEN = "{{method-scripts}}"
# QA's selector on #170: a repository `scripts/` executable named in prose, not a `hooks/scripts/` one.
SCRIPT_SELECTOR = re.compile(r"(?<!hooks/)(?<![a-z/])scripts/([a-z_-]+\.(?:py|sh))")
NOT_SHIPPED_LINE = "> **Not shipped by this method:**"


def method_markdown():
    return [p for p in sorted((REPO / "method").rglob("*.md")) if "scripts" not in p.relative_to(REPO / "method").parts[:1]]


def not_shipped(text):
    """The `scripts/<name>` the file's retired-plugin note lists as not shipped (the note's own block)."""
    out = set()
    for block in re.findall(r"(?m)^> \*\*Not shipped by this method:\*\*.*(?:\n>.*)*", text):
        out |= set(SCRIPT_SELECTOR.findall(block))
    return out


class MethodScripts(unittest.TestCase):
    """#170: the executables the rites run ship with the method, install to one user-level directory, and
    every rendered rite's path to them exists after a throwaway-home install."""

    @classmethod
    def setUpClass(cls):
        cls.home = Path(tempfile.mkdtemp(prefix="home-", dir=BASE))
        cls.code, cls.out = render(cls.home)
        cls.dir = cls.home / SCRIPTS_REL
        cls.source = {p.name: p for p in (REPO / "method" / "scripts").iterdir()
                      if p.is_file() and p.suffix in (".py", ".sh") and ".test." not in p.name}

    def test_render_succeeds(self):
        self.assertEqual(self.code, 0, self.out)

    def test_every_script_is_installed_executable_and_stamped(self):
        self.assertTrue(self.source, "method/scripts/ ships no script")
        for name, src in self.source.items():
            path = self.dir / name
            self.assertTrue(path.is_file(), name)
            self.assertTrue(path.stat().st_mode & stat.S_IXUSR, "%s is not executable" % name)
            self.assertEqual(stat.S_IMODE(path.stat().st_mode) & 0o077, 0, "%s is open to group or others" % name)
            lines = path.read_text(encoding="utf-8").split("\n")
            marked = [i for i, l in enumerate(lines[:3]) if "managed-by: personal-multi-harness-workstation-configuration; source: method/scripts/" + name in l]
            self.assertEqual(len(marked), 1, name)
            del lines[marked[0]]
            self.assertEqual("\n".join(lines), src.read_text(encoding="utf-8"), "%s differs from its source" % name)
        installed = sorted(p.name for p in self.dir.iterdir() if p.is_file())
        self.assertEqual(installed, sorted(self.source), "no test file or fixture is installed")
        # The one directory: the store contract a rite names (#181); no fixtures, no worklog contract.
        directories = sorted(p.relative_to(self.dir).as_posix() for p in self.dir.rglob("*") if p.is_file()
                             and p.parent != self.dir)
        self.assertEqual(directories, ["funnel-review-contract/README.md"])

    def test_rendered_paths_to_scripts_exist(self):
        """Table over every rendered carrier: each path into the installed directory names a file there,
        and no unresolved token is left."""
        rendered = [p for root in (".claude", ".agents", ".kiro", ".codex") for p in (self.home / root).rglob("*")
                    if p.is_file()]
        self.assertTrue(rendered)
        prefix = str(self.dir) + "/"
        refs, missing = 0, []
        for path in rendered:
            text = path.read_text(encoding="utf-8")
            self.assertNotIn(TOKEN, text, path)
            for name in re.findall(re.escape(prefix) + r"([A-Za-z0-9_.-]+(?:/[A-Za-z0-9_.-]+)*)", text):
                refs += 1
                if not (self.dir / name).is_file():
                    missing.append("%s -> %s" % (path.relative_to(self.home), name))
        self.assertEqual(missing, [])
        self.assertGreater(refs, 0, "no rendered file points into the scripts directory")
        planning = (self.home / ".claude" / "commands" / "sprint-planning.md").read_text(encoding="utf-8")
        self.assertIn("python3 %smilestone-create.py" % prefix, planning)

    def test_source_references_are_shipped_or_listed(self):
        """QA's table on #170, over method/**/*.md: every `{{method-scripts}}/<name>` names a shipped script,
        and every remaining `scripts/<name>` (QA's selector) is listed in that file's not-shipped note."""
        problems, tokens = [], 0
        for md in method_markdown():
            text = md.read_text(encoding="utf-8")
            rel = md.relative_to(REPO)
            for name in re.findall(re.escape(TOKEN) + r"/([A-Za-z0-9_.-]+(?:/[A-Za-z0-9_.-]+)*)", text):
                tokens += 1
                if name not in self.source and not ("/" in name and (REPO / "method" / "scripts" / name).is_file()):
                    problems.append("%s: %s/%s is not in method/scripts/" % (rel, TOKEN, name))
            listed = not_shipped(text)
            for name in SCRIPT_SELECTOR.findall(text):
                if name not in listed:
                    problems.append("%s: scripts/%s is neither shipped nor listed as not shipped" % (rel, name))
        self.assertEqual(problems, [])
        self.assertGreater(tokens, 0)

    def test_a_token_naming_no_script_stops_the_render(self):
        src = Path(tempfile.mkdtemp(prefix="src-", dir=BASE)) / "method"
        shutil.copytree(REPO / "method", src)
        p = src / "commands" / "autonomy.md"
        p.write_text(p.read_text(encoding="utf-8") + "\nRun `python3 %s/nope.py`.\n" % TOKEN, encoding="utf-8")
        home = Path(tempfile.mkdtemp(prefix="home-", dir=BASE))
        env = {"PATH": os.environ.get("PATH", "/usr/bin:/bin"), "HOME": str(home), "TMPDIR": str(home)}
        out = subprocess.run([sys.executable, "-B", str(RENDER), "--mode=install", "--stamp=" + STAMP, "--opt-in",
                              "--source=" + str(src)], env=env, capture_output=True, text=True)
        self.assertEqual(out.returncode, 2, out.stdout + out.stderr)
        self.assertIn("nope.py names no file in method/scripts/", out.stderr)
        self.assertFalse((home / SCRIPTS_REL).exists(), "nothing is written when the source is invalid")

    def test_uninstall_removes_the_scripts(self):
        home = Path(tempfile.mkdtemp(prefix="home-", dir=BASE))
        render(home)
        self.assertTrue(any((home / SCRIPTS_REL).iterdir()))
        env = {"PATH": os.environ.get("PATH", "/usr/bin:/bin"), "HOME": str(home), "TMPDIR": str(home)}
        subprocess.run([sys.executable, "-B", str(RENDER), "--mode=uninstall"], env=env, capture_output=True, text=True)
        self.assertEqual([p for p in (home / SCRIPTS_REL).iterdir()] if (home / SCRIPTS_REL).exists() else [], [])


# B2 on #170: every `CLAUDE.md` left in method/ is on this list, keyed by file and by a phrase of the line,
# so a reverted root-brief rename (a new line naming a project's root `CLAUDE.md`) turns this red.
CLAUDE_MD_ALLOWED = [
    ("agents/quality-assurance.md", "`CLAUDE.md`, `AGENTS.md`, `.claude/`, `.codex/` and `.github/` at any depth"),
    ("agents/quality-assurance.md", "`docs/CLAUDE.md` is in the consuming class"),
    ("agents/quality-assurance.md", "`AGENTS.md` · `CLAUDE.md`, **at any depth**"),
    ("agents/quality-assurance.md", "`apps/<unit>/CLAUDE.md` and `apps/<unit>/.claude/settings.json`"),
    ("agents/quality-assurance.md", "`CLAUDE.md` when it works in that subtree"),
    ("agents/quality-assurance.md", "a product diff that edits `.github/workflows/` or `CLAUDE.md`"),
    ("agents/quality-assurance.md", "`-io` #667 (`CLAUDE.md`,"),
    ("agents/quality-assurance.md", "`apps/fed/CLAUDE.md`), #647"),
    ("agents/quality-assurance.md", "`.mcp.json`, `AGENTS.md`, `CLAUDE.md` and the rite"),
    ("agents/quality-assurance.md", "`apps/café/CLAUDE.md` each carried"),
    ("agents/quality-assurance.md", "a quoted `.claude/`, `.codex/`, `.github/`, `AGENTS.md` or `CLAUDE.md`"),
    ("agents/quality-assurance.md", "corrected in `CLAUDE.md` this round"),
    ("agents/scrum-master.md", "# 5 issues -> README.md · CLAUDE.md"),
    ("commands/funnel-review.md", "`CLAUDE.md` until #562"),
    ("commands/new-issue.md", "`apps/*/AGENTS.md` or `apps/*/CLAUDE.md`"),
]


class RootBriefRename(unittest.TestCase):
    """#170 B2: the root brief is AGENTS.md across method/; a CLAUDE.md that remains is a path in a class
    list, a dated measurement or history, each named here."""

    def test_every_claude_md_is_allowlisted(self):
        found, unlisted = [], []
        for md in method_markdown():
            rel = str(md.relative_to(REPO / "method"))
            for n, line in enumerate(md.read_text(encoding="utf-8").split("\n"), 1):
                if "CLAUDE.md" not in line:
                    continue
                found.append((rel, n))
                if not any(rel == f and phrase in line for f, phrase in CLAUDE_MD_ALLOWED):
                    unlisted.append("%s:%d %s" % (rel, n, line.strip()[:120]))
        self.assertEqual(unlisted, [])
        self.assertEqual(len(found), len(CLAUDE_MD_ALLOWED), "an allowlisted line is gone; shrink the list")


LAUNCH_PREFIX = {"claude-code": "claude '", "codex": "codex '", "kiro": "kiro-cli chat '"}
IDE_PHRASE = "# Kiro IDE: there is no launch line"
TOKEN_RE = re.compile(r"\{\{[a-z][a-z-]*\}\}")
# A prompt the template could produce, with the two characters that break a hand-quoted line: a single
# quote and a newline. Built from public, synthetic values.
PROMPT = ("/goal ship the owner's handoff command\n"
          "Continue owner/repo#12 in this fresh session; the session that printed this prompt stops now.\n"
          "Next act: run the suite; it's green when 'OK' prints.\n"
          "Before acting, re-derive the state from the tracker: gh issue view 12 --repo owner/repo --comments.")


def run_launch_line(script, harness, prompt, base):
    f = Path(tempfile.mkdtemp(prefix="prompt-", dir=base)) / "prompt.txt"
    f.write_text(prompt, encoding="utf-8")
    return subprocess.run([sys.executable, "-B", str(script), harness, str(f)], capture_output=True, text=True)


class Handoff(unittest.TestCase):
    """#198: each carrier of /handoff names its own agent harness, the installed launch-line script prints
    that harness's launch line and no other, the line is valid shell that carries the prompt exactly, and
    no rendering token survives anywhere."""

    @classmethod
    def setUpClass(cls):
        cls.home = Path(tempfile.mkdtemp(prefix="home-", dir=BASE))
        cls.code, cls.out = render(cls.home)
        cls.script = cls.home / SCRIPTS_REL / "launch-line.py"

    def test_render_succeeds(self):
        self.assertEqual(self.code, 0, self.out)

    def test_each_carrier_prints_only_its_own_launch_line(self):
        expected = {"claude": "claude-code", "codex": "codex", "kiro": "kiro"}
        for carrier, path in carriers(self.home, "handoff").items():
            named = set(re.findall(r"launch-line\.py (\S+) ", path.read_text(encoding="utf-8")))
            self.assertEqual(named, {expected[carrier]}, carrier)
            out = run_launch_line(self.script, expected[carrier], PROMPT, BASE)
            self.assertEqual(out.returncode, 0, out.stderr)
            self.assertTrue(out.stdout.startswith(LAUNCH_PREFIX[expected[carrier]]), (carrier, out.stdout[:40]))
            for other, prefix in LAUNCH_PREFIX.items():
                if other != expected[carrier]:
                    self.assertFalse(re.search(r"(?m)^" + re.escape(prefix), out.stdout), (carrier, other))
            (self.assertIn if carrier == "kiro" else self.assertNotIn)(IDE_PHRASE, out.stdout, carrier)

    def test_no_rendering_token_survives(self):
        left = []
        for root in (".claude", ".agents", ".kiro", ".codex"):
            for p in (self.home / root).rglob("*"):
                if p.is_file() and TOKEN_RE.search(p.read_text(encoding="utf-8")):
                    left.append(str(p.relative_to(self.home)))
        self.assertEqual(left, [])

    def test_the_line_is_shell_and_carries_the_prompt_exactly(self):
        out = run_launch_line(self.script, "claude-code", PROMPT, BASE)
        self.assertEqual(out.returncode, 0, out.stderr)
        line = out.stdout.rstrip("\n")
        self.assertIn("'", PROMPT)
        self.assertIn("\n", PROMPT)
        shells = ["sh"] + (["zsh"] if shutil.which("zsh") else [])
        for shell in shells:
            p = subprocess.run([shell, "-n", "-c", line], capture_output=True, text=True)
            self.assertEqual(p.returncode, 0, (shell, p.stderr))
            # Replace the command with printf: what reaches the agent harness is exactly the prompt.
            p = subprocess.run([shell, "-c", "printf %s " + line[len("claude "):]], capture_output=True, text=True)
            self.assertEqual(p.stdout, PROMPT, shell)
        kiro = run_launch_line(self.script, "kiro", PROMPT, BASE).stdout
        for shell in shells:
            self.assertEqual(subprocess.run([shell, "-n", "-c", kiro]).returncode, 0, shell)

    def test_unsafe_prompts_are_refused_without_echo(self):
        local = "/Use" + "rs/someone/notes.txt"
        cases = {"no goal": "Continue owner/repo#12.", "long": "/goal " + "x" * 300,
                 "local path": "/goal fix it\nEvidence: " + local, "empty": "\n"}
        for label, prompt in cases.items():
            out = run_launch_line(self.script, "codex", prompt, BASE)
            self.assertEqual(out.returncode, 1, label)
            self.assertEqual(out.stdout, "", label)
            self.assertNotIn("someone", out.stderr, label)
        self.assertEqual(run_launch_line(self.script, "claude", PROMPT, BASE).returncode, 2)

    def test_a_prompt_file_outside_the_allowed_roots_is_refused(self):
        """Sonar S8707 on #198: the path is resolved and confined, so `..` cannot walk out of the temporary
        directory, a directory is not read, and an oversized file is refused; nothing reaches stdout."""
        inside = Path(tempfile.mkdtemp(prefix="prompt-", dir=BASE))
        traversal = str(inside) + "/.." * 40 + "/etc/hosts"
        big = inside / "big.txt"
        big.write_text("/goal x\n" + ("y" * 200 + "\n") * 400, encoding="utf-8")
        for label, path, needle in (("traversal", traversal, "outside the repository work tree"),
                                    ("directory", str(inside), "not a regular file"),
                                    ("size", str(big), "over 65536 bytes")):
            out = subprocess.run([sys.executable, "-B", str(self.script), "codex", path], capture_output=True,
                                 text=True)
            self.assertEqual(out.returncode, 1, label)
            self.assertEqual(out.stdout, "", label)
            self.assertIn(needle, out.stderr, label)

    def test_the_prompt_template_carries_no_secret_or_personal_data(self):
        text = (REPO / "method" / "commands" / "handoff.md").read_text(encoding="utf-8")
        template = re.search(r"## The prompt\n.*?```\n(.*?)```", text, re.S).group(1)
        self.assertTrue(template.startswith("/goal "))
        self.assertEqual(guard.find_spans(template), [])
        self.assertEqual(guard.find_spans(PROMPT), [])


class HandoverSanitisation(unittest.TestCase):
    """#73: a synthetic handover prompt with planted secret-shaped and personal data is caught by the
    paste filter's detector, and the same prompt without them passes. The planted values are built at run
    time, so no secret-shaped literal is stored in the repository."""

    CLEAN = ("Session type: Bugfix\nObjective: fix the release script.\nIssue: owner/repo#12\n"
             "Context: read scripts/release.sh and the comments on #12.\nConstraints: no merge.\n"
             "Done when: the release check passes.\nWhen done, comment on #12 under '## Return to the parent "
             "session' with the result and evidence, and print the same text as a return prompt.\n")

    def test_clean_prompt_has_no_finding(self):
        self.assertEqual(guard.find_spans(self.CLEAN), [])

    def test_planted_values_are_caught_and_redacted(self):
        token = "gh" + "p_" + "Q7" * 18
        mail = "ana.person" + "@" + "zyxw-mail.zyxw"
        dirty = self.CLEAN + "Token: %s\nContact: %s\n" % (token, mail)
        spans = guard.find_spans(dirty)
        self.assertEqual(guard.categories(spans), ["credential", "email"])
        cleaned = guard.sanitise(dirty, spans)
        self.assertNotIn(token, cleaned)
        self.assertNotIn(mail, cleaned)
        self.assertEqual(guard.find_spans(cleaned), [])


if __name__ == "__main__":
    BASE = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else tempfile.mkdtemp(prefix="method-commands-test-"))
    os.makedirs(BASE, exist_ok=True)
    sys.argv = sys.argv[:1]
    unittest.main(verbosity=1)
