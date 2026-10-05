#!/usr/bin/env python3
"""Regression suite for the workflow commands (Issues #71-#75): every one renders on all three agent harnesses.

    python3 -B global/method/method_commands_test.py [BASE_DIR]

Renders method/ into one throwaway HOME (BASE_DIR, default a new directory under TMPDIR) and asserts, per
command and per agent harness, that the command is present in that harness's native carrier, that the
Codex skill keeps implicit invocation off, and that every required section of the command reaches the
rendered text. It also checks the handover prompt's sanitisation against a synthetic fixture with the
workstation's paste-filter detector (#73). Nothing outside BASE_DIR is written.
"""

import json
import os
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
    "handover": SHARED + ["## When to use", "## Steps", "## Starting directory", "## Agent harness",
                          "## Launch line", "## The handover prompt", "## The return prompt", "## Sanitised"],
    "what-else": SHARED + ["## The anchored objective", "## Read the bus", "## The answer"],
    "blueprint": SHARED + ["## export", "## import", "## Alignment interview"],
}
# Phrases that carry the behaviour the Issues require, beyond the headings.
PHRASES = {
    "new-idea": ["product-requirements-document-<subject>.md", "recommended answer", "Mermaid"],
    "idea-to-issues": ["--body-file", "Blocked by #N", "definition-of-ready", "acceptance criteria"],
    "handover": ["fresh worktree", "status --porcelain", "Claude Code", "Codex", "Kiro", "kiro-cli chat",
                 "## Return to the parent session", "gh issue comment", "**Goal anchor**", "`/goal`"],
    "what-else": ["native goal command (`/goal`)", "gh pr list --state open", "owner decisions"],
    "blueprint": ["product-requirements-document-agent-harness-setup.md", "Mermaid",
                  "Nothing is changed before the alignment interview is complete"],
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
            self.assertIn("argument-hint:", c["claude"].read_text(encoding="utf-8").split("\n---\n", 1)[0], name)
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
