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
import clipboard_guard as guard  # noqa: E402

# The sections each command must carry. The first four are shared; the rest are the behaviour its Issue
# asks for. "What this command never does" holds the merge, publish and hook prohibitions.
SHARED = ["## What this command never does"]
REQUIRED = {
    "new-idea": SHARED + ["## When to use", "## Steps", "## Interview rounds", "## The requirements document"],
    "idea-to-issues": SHARED + ["## When to use", "## Steps", "## Vertical slices", "## Definition of ready",
                                "## Opening the Issues"],
    "what-else": SHARED + ["## The anchored objective", "## Read the bus", "## The answer"],
    "blueprint": SHARED + ["## export", "## import", "## Alignment interview"],
    "handoff": SHARED + ["## The arguments", "## When to use", "## Build the prompt", "## The prompt",
                         "## Print it"],
}
# The four rites moved from the plugin at #130 (owner, 2026-10-12). They keep the plugin's text, so they are
# held to the headings that carry each rite, not to the workflow commands' "never" section.
RITES = {
    "sprint-planning": ["## The trigger", "## What this rite does NOT do", "## What nothing enforces, said before any green is read"],
    "sprint-review": ["## The trigger, and where it sits among the three rites", "## What this rite cannot see"],
    "sprint-retrospective": ["## The trigger", "## What this cannot catch"],
    "funnel-review": ["## The steps", "## What this rite cannot see"],
}
RETIRED_NOTE = "> **Read this first: hooks named below are the retired plugin's, not controls you have (#61).**"
# Phrases that carry the behaviour the Issues require, beyond the headings.
PHRASES = {
    "new-idea": ["product-requirements-document-<subject>.md", "recommended answer", "Mermaid"],
    "idea-to-issues": ["--body-file", "Blocked by #N", "definition-of-ready", "acceptance criteria"],
    "what-else": ["native goal command (`/goal`)", "gh pr list --state open", "owner decisions"],
    "blueprint": ["product-requirements-document-agent-harness-setup.md", "Mermaid",
                  "Nothing is changed before the alignment interview is complete"],
    "handoff": ["re-derive the state from the tracker", "It prints only", "launch-line.py",
                "at most 280 characters", "Then stop working in this session", "--resolve",
                "--env NAME=VALUE", "and nothing after it"],
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
            # #196: argument-hint only on the owner-typed commands that take a typed argument (blueprint, and
            # handoff since its target-harness argument); the other workflow commands fold the hint text into
            # their description.
            head = c["claude"].read_text(encoding="utf-8").split("\n---\n", 1)[0]
            (self.assertIn if name in ("blueprint", "handoff") else self.assertNotIn)("argument-hint:", head, name)
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
IDE_PHRASE = "For the Kiro IDE, replace `kiro-cli chat` with `kiro chat`"
TOKEN_RE = re.compile(r"\{\{[a-z][a-z-]*\}\}")
# A prompt the template could produce, with the characters that break a hand-quoted line: a single quote,
# a newline, `$` (an expansion), backticks (a substitution and, three of them, a Markdown fence), a
# backslash, a double quote and `!`. Built from public, synthetic values.
PROMPT = ("/goal ship the owner's handoff command\n"
          "Continue owner/repo#12 in this fresh session; the session that printed this prompt stops now.\n"
          "Next act: run the suite; it's green when 'OK' prints, not $HOME or $(date) or `id`.\n"
          "Evidence: ```fence``` and \\n and \"quoted\" and !! and \\'' stay as typed.\n"
          "Before acting, re-derive the state from the tracker: gh issue view 12 --repo owner/repo --comments.")
SHELLS = ["sh", "bash"] + (["zsh"] if shutil.which("zsh") else [])


def run_launch_line(script, harness, prompt, base, *extra):
    f = Path(tempfile.mkdtemp(prefix="prompt-", dir=base)) / "prompt.txt"
    f.write_text(prompt, encoding="utf-8")
    return subprocess.run([sys.executable, "-B", str(script), harness, str(f)] + list(extra), capture_output=True,
                          text=True)


def the_block(stdout):
    """(the lines before the fenced block, the block's command line). Fails unless stdout ENDS with exactly
    one fenced block."""
    lines = stdout.rstrip("\n").split("\n")
    fences = [n for n, l in enumerate(lines) if re.fullmatch(r"`{3,}", l)]
    if len(fences) != 2 or fences[1] != len(lines) - 1 or lines[fences[0]] != lines[fences[1]]:
        raise AssertionError("not one fenced block at the end: %r" % stdout[:200])
    return lines[:fences[0]], "\n".join(lines[fences[0] + 1:fences[1]])


def argv_through(shell, line, command, env_names=()):
    """Run the block's line with the agent harness's command defined as a shell function that prints each
    argument (and the named environment variables) NUL-separated: what the agent harness would receive.
    A function, like the workstation's paste wrapper, so the environment prefix is measured through one."""
    printer = "".join('printf "%%s=%%s\\0" %s "$%s"; ' % (n, n) for n in env_names)
    # sh refuses a function named kiro-cli, so the command word is swapped for a valid name first.
    head = command.split()[0] + " "
    if head not in line:
        raise AssertionError("the command %r is not in the line" % head)
    script = "harness_argv() { %sprintf '%%s\\0' \"$@\"; }\n%s" % (printer, line.replace(head, "harness_argv ", 1))
    return subprocess.run([shell, "-c", script], capture_output=True, text=True)


class Handoff(unittest.TestCase):
    """#198: each carrier of /handoff names its own agent harness as the default target; the installed
    launch-line script prints one fenced block for the TARGET agent harness with the prompt inline as its
    argument; the block is valid shell that carries the prompt and the launch environment exactly; and no
    rendering token survives anywhere."""

    @classmethod
    def setUpClass(cls):
        cls.home = Path(tempfile.mkdtemp(prefix="home-", dir=BASE))
        cls.code, cls.out = render(cls.home)
        cls.script = cls.home / SCRIPTS_REL / "launch-line.py"

    def resolve(self, *argv):
        return subprocess.run([sys.executable, "-B", str(self.script), "--resolve"] + list(argv),
                              capture_output=True, text=True)

    def test_render_succeeds(self):
        self.assertEqual(self.code, 0, self.out)

    def test_each_carrier_defaults_to_its_own_harness(self):
        expected = {"claude": "claude-code", "codex": "codex", "kiro": "kiro"}
        for carrier, path in carriers(self.home, "handoff").items():
            named = set(re.findall(r"launch-line\.py --resolve (\S+) ", path.read_text(encoding="utf-8")))
            self.assertEqual(named, {expected[carrier]}, carrier)
            # No harness word in the arguments: the target is the current agent harness.
            for words in ((), ("ship",), ("Claude",), ("$x",)):
                out = self.resolve(expected[carrier], *words)
                self.assertEqual(out.stdout, "%s\nkept\n" % expected[carrier], (carrier, words))
            out = run_launch_line(self.script, expected[carrier], PROMPT, BASE)
            self.assertEqual(out.returncode, 0, out.stderr)
            _, line = the_block(out.stdout)
            self.assertTrue(line.startswith(LAUNCH_PREFIX[expected[carrier]]), (carrier, line[:40]))
            (self.assertIn if carrier == "kiro" else self.assertNotIn)(IDE_PHRASE, out.stdout, carrier)

    def test_an_explicit_target_overrides_the_current_harness(self):
        names = {"claude-code": "claude-code", "claude": "claude-code", "codex": "codex", "kiro": "kiro",
                 "kiro-cli": "kiro"}
        for current in LAUNCH_PREFIX:
            for word, target in names.items():
                out = self.resolve(current, word)
                self.assertEqual(out.stdout, "%s\nconsumed\n" % target, (current, word))
        for word, target in names.items():
            out = run_launch_line(self.script, word, PROMPT, BASE)
            self.assertEqual(out.returncode, 0, out.stderr)
            _, line = the_block(out.stdout)
            self.assertTrue(line.startswith(LAUNCH_PREFIX[target]), (word, line[:40]))
            for other, prefix in LAUNCH_PREFIX.items():
                if other != target:
                    self.assertFalse(line.startswith(prefix), (word, other))
        self.assertEqual(self.resolve("cursor").returncode, 2)
        self.assertEqual(self.resolve().returncode, 2)

    def test_the_block_carries_the_prompt_inline_and_exactly(self):
        for target, prefix in LAUNCH_PREFIX.items():
            out = run_launch_line(self.script, target, PROMPT, BASE)
            self.assertEqual(out.returncode, 0, out.stderr)
            before, line = the_block(out.stdout)
            self.assertEqual(len(before), 1 if target == "kiro" else 0, target)
            # The prompt is printed nowhere outside the block.
            self.assertNotIn("/goal", "\n".join(before), target)
            command = prefix[:-2]
            for shell in SHELLS:
                p = subprocess.run([shell, "-n", "-c", line], capture_output=True, text=True)
                self.assertEqual(p.returncode, 0, (target, shell, p.stderr))
                p = argv_through(shell, line, command)
                self.assertEqual(p.returncode, 0, (target, shell, p.stderr))
                self.assertEqual(p.stdout.split("\0")[:-1], command.split()[1:] + [PROMPT], (target, shell))

    def test_the_launch_environment_is_part_of_the_block(self):
        for value in ("https://example.org", "it's $x `y` \\ \"q\" !!"):
            out = run_launch_line(self.script, "claude", PROMPT, BASE, "--env", "HARNESS_SWEEP_ORIGIN=" + value)
            self.assertEqual(out.returncode, 0, out.stderr)
            _, line = the_block(out.stdout)
            self.assertTrue(line.startswith("HARNESS_SWEEP_ORIGIN='"), line[:60])
            for shell in SHELLS:
                p = argv_through(shell, line, "claude", ("HARNESS_SWEEP_ORIGIN",))
                self.assertEqual(p.stdout.split("\0")[:-1], ["HARNESS_SWEEP_ORIGIN=" + value, PROMPT], shell)
        for bad in ("1X=a", "X-Y=a", "HARNESS_SWEEP_ORIGIN=" + "/Use" + "rs/someone", "HARNESS_SWEEP_ORIGIN=a\nb"):
            out = run_launch_line(self.script, "codex", PROMPT, BASE, "--env", bad)
            self.assertEqual(out.returncode, 1, bad)
            self.assertEqual(out.stdout, "", bad)
            self.assertNotIn("someone", out.stderr, bad)
        for usage in (["--env"], ["--env", "NOEQUALS"], ["--other", "X=1"]):
            self.assertEqual(run_launch_line(self.script, "codex", PROMPT, BASE, *usage).returncode, 2, usage)

    def test_terminal_and_bidi_controls_are_refused_without_echo(self):
        """A paste into interactive zsh or bash: ^C or ^U can discard the open quote, ESC[201~ ends a
        bracketed paste early, and an unbracketed paste eats a TAB, so the rest of the prompt would run as
        commands. A bidi control makes the block read differently from what runs. Each is refused, in the
        prompt and in an --env value, and the refusal never echoes the line."""
        secret = "SENTINELTEXT"
        hostile = {"^C": "\x03", "ESC[201~": "\x1b[201~", "^U": "\x15", "TAB": "\t", "CR": "\r", "DEL": "\x7f",
                   "U+202E": "\u202e", "U+2066": "\u2066"}
        for label, ch in hostile.items():
            prompt = "/goal fix it\nNext act: %s %s; touch pwned" % (ch, secret)
            out = run_launch_line(self.script, "claude-code", prompt, BASE)
            self.assertEqual(out.returncode, 1, label)
            self.assertEqual(out.stdout, "", label)
            self.assertIn("line 2 carries a control character", out.stderr, label)
            self.assertNotIn(secret, out.stderr, label)
            out = run_launch_line(self.script, "codex", PROMPT, BASE, "--env",
                                  "HARNESS_SWEEP_ORIGIN=a%s%s" % (ch, secret))
            self.assertEqual(out.returncode, 1, label)
            self.assertEqual(out.stdout, "", label)
            self.assertIn("--env 1: the value carries a control character", out.stderr, label)
            self.assertNotIn(secret, out.stderr, label)
        # The newline is the one control a prompt may carry, and only outside an --env value.
        self.assertEqual(run_launch_line(self.script, "codex", PROMPT, BASE).returncode, 0)

    def test_only_declared_launch_variables_are_accepted(self):
        """An allowlist: a configuration home, a base URL, git's own configuration, an editor and a loader
        variable are all refused, as is a near-miss of the declared name; the value is never echoed."""
        secret = "SENTINELVALUE"
        for name in ("CLAUDE_CONFIG_DIR", "CODEX_HOME", "KIRO_HOME", "XDG_CONFIG_HOME", "ANTHROPIC_BASE_URL",
                     "OPENAI_BASE_URL", "GIT_CONFIG_COUNT", "GIT_CONFIG_PARAMETERS", "EDITOR", "GIT_ASKPASS",
                     "PATH", "NODE_OPTIONS", "DYLD_INSERT_LIBRARIES", "LD_PRELOAD", "harness_sweep_origin",
                     "HARNESS_SWEEP_ORIGIN_X", "HARNESS_SWEEP"):
            out = run_launch_line(self.script, "codex", PROMPT, BASE, "--env", "%s=%s" % (name, secret))
            self.assertEqual(out.returncode, 1, name)
            self.assertEqual(out.stdout, "", name)
            self.assertIn("--env 1: the name is not a declared launch variable", out.stderr, name)
            self.assertNotIn(secret, out.stderr, name)
        out = run_launch_line(self.script, "codex", PROMPT, BASE, "--env", "HARNESS_SWEEP_ORIGIN=https://example.org")
        self.assertEqual(out.returncode, 0, out.stderr)

    def test_a_backtick_run_cannot_close_the_fence(self):
        prompt = "/goal keep ```` four and ````` five backticks"
        out = run_launch_line(self.script, "codex", prompt, BASE)
        self.assertEqual(out.returncode, 0, out.stderr)
        _, line = the_block(out.stdout)
        self.assertTrue(out.stdout.startswith("``````\n"), out.stdout[:10])
        self.assertEqual(argv_through("sh", line, "codex").stdout.split("\0")[:-1], [prompt])

    def test_no_rendering_token_survives(self):
        left = []
        for root in (".claude", ".agents", ".kiro", ".codex"):
            for p in (self.home / root).rglob("*"):
                if p.is_file() and TOKEN_RE.search(p.read_text(encoding="utf-8")):
                    left.append(str(p.relative_to(self.home)))
        self.assertEqual(left, [])

    def test_the_claude_command_carries_the_argument_hint(self):
        head = carriers(self.home, "handoff")["claude"].read_text(encoding="utf-8").split("\n---\n")[0]
        self.assertIn('argument-hint: "[claude-code|claude|codex|kiro|kiro-cli] ', head)

    def test_unsafe_prompts_are_refused_without_echo(self):
        local = "/Use" + "rs/someone/notes.txt"
        cases = {"no goal": "Continue owner/repo#12.", "long": "/goal " + "x" * 300,
                 "local path": "/goal fix it\nEvidence: " + local, "empty": "\n"}
        for label, prompt in cases.items():
            out = run_launch_line(self.script, "codex", prompt, BASE)
            self.assertEqual(out.returncode, 1, label)
            self.assertEqual(out.stdout, "", label)
            self.assertNotIn("someone", out.stderr, label)
        self.assertEqual(run_launch_line(self.script, "cursor", PROMPT, BASE).returncode, 2)

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
