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
SCRIPTS = sorted(mr.load_scripts(SOURCE))
SCRIPTS_DIR = ".local/share/personal-multi-harness-workstation-configuration/method/scripts"
# Stated, not derived from the renderer: the documents a rite names and the render installs (#181).
DOCUMENTS = ["funnel-review-contract/README.md"]
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
        out += ["%s/%s" % (SCRIPTS_DIR, s) for s in SCRIPTS]
        out += ["%s/%s" % (SCRIPTS_DIR, d) for d in DOCUMENTS]
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
                                         "planning-poker", "code-review", "content-publishing",
                                         "orchestration"]))
        # The four rites moved at #130 (owner, 2026-10-12).
        # #198 added /handoff.
        self.assertEqual(COMMANDS, sorted(["autonomy", "new-issue", "new-idea", "idea-to-issues", "what-else",
                                           "blueprint", "sprint-planning", "sprint-review", "sprint-retrospective",
                                           "funnel-review", "handoff"]))

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


# Issue #176 (owner, 2026-10-13: "Mover pro mhw"): the review routing, the loop-mode contract and the ask
# rules live in the method's `orchestration` skill, not in a project's root brief. These assert the rules
# are WRITTEN there and that nothing in method/ still sends a reader to a project's copy; nothing here can
# assert that a session follows them.
ORCHESTRATION = SOURCE / "skills" / "orchestration" / "SKILL.md"
ROOT_BRIEF_BLOCKS = re.compile(r"loop-mode-contract|hitl-escalation-format|review-chain-routing")
CONSUMER_WORDS = re.compile(r"tadeumendonca|tedeuxx|apps/fed|\.brand/|-io\b", re.IGNORECASE)
# The prose forms the pointers took before #176, when they sent a reader to a project's root brief.
ROOT_BRIEF_PROSE = re.compile(r"root brief's \(`AGENTS\.md`\)|each repository's root brief \(`AGENTS\.md`\)"
                              r"|the root brief \(`AGENTS\.md`\), or the record|`AGENTS\.md`'s escalation section"
                              r"|`AGENTS\.md` wins|The root brief is where those rules bind")
# Every pointer site #176 wrote: ten repointed from a root brief, one added (new-issue.md). Per site:
# (file under method/, stable text of the pointer's paragraph, the pointer itself, the skill section it names)
FORMER_POINTERS = (
    ("commands/autonomy.md", "it lives in `docs/loop-mode.md`, and it is READ before the pool predicate",
     "the `orchestration` skill's *The loop-mode contract* section", "The loop-mode contract"),
    ("commands/autonomy.md", "surfaces what is missing",
     "the `orchestration` skill's *How to ask the owner* section", "How to ask the owner"),
    ("commands/funnel-review.md", "rule 4, that makes it a decision",
     "the `orchestration` skill's *How to ask the owner*", "How to ask the owner"),
    ("commands/funnel-review.md", "PR #528 found that it contradicts his own escalation rules",
     "(the root brief then, the `orchestration` skill since #176), so they win", "How to ask the owner"),
    # Added by #176, not repointed: before it this site named only the user-level brief.
    ("commands/new-issue.md", "This is the interview half of the HITL escalation format",
     "the method's `orchestration` skill, *How to ask the owner*", "How to ask the owner"),
    ("commands/sprint-planning.md", "It is not an independent source",
     "the `orchestration` skill's *How to ask the owner*", "How to ask the owner"),
    ("agents/scrum-master.md", "and `scrum` is one value of a closed enum of two",
     "*The loop-mode contract* in the `orchestration` skill", "The loop-mode contract"),
    ("agents/scrum-master.md", "two branches whose verdicts each attest a head",
     "*The loop-mode contract* of the `orchestration` skill", "The loop-mode contract"),
    ("skills/agents-configuration/SKILL.md", "Two artifacts carry it and neither is this file.",
     "*The loop-mode contract* in the `orchestration` skill", "The loop-mode contract"),
    ("skills/agents-configuration/SKILL.md", "These rows route INTAKE. The REVIEW chain is routed too",
     "It lives in the `orchestration` skill, *Review is routed by type*", "Review is routed by type"),
    ("skills/agents-configuration/SKILL.md", "THE REVIEW GATE DOES NOT",
     "*The loop-mode contract* of the `orchestration` skill", "The loop-mode contract"),
)


def unstruck_paragraphs(path):
    """Blank-line paragraphs, whitespace-flattened, with `~~struck~~` spans removed."""
    return [re.sub(r"~~.*?~~", "", " ".join(p.split())) for p in path.read_text(encoding="utf-8").split("\n\n")]


def orchestration_section(heading, flat=True):
    """One `## heading` section of the skill; whitespace-flattened unless flat=False, so a rewrap is no red."""
    text = ORCHESTRATION.read_text(encoding="utf-8")
    start = text.index("\n## " + heading + "\n")
    end = text.find("\n## ", start + 1)
    section = text[start:end if end != -1 else len(text)]
    return " ".join(section.split()) if flat else section


class OrchestrationOwnsTheBlocks(unittest.TestCase):
    def test_no_method_file_points_at_a_root_brief_block(self):
        hits = []
        for path in sorted(SOURCE.rglob("*.md")):
            for n, line in enumerate(path.read_text(encoding="utf-8").split("\n"), 1):
                if ROOT_BRIEF_BLOCKS.search(line):
                    hits.append("%s:%d" % (path.relative_to(REPO), n))
        self.assertEqual(hits, [], "a method file still names a root-brief block")

    def test_the_review_route_has_one_row_per_type_and_keeps_the_gate(self):
        section = orchestration_section("Review is routed by type")
        for row in ("| `loop` | one `agents-lead` lens pass, plus the gate |",
                    "| `product` | the leads' lenses as the change warrants, plus the gate |",
                    "| `content` | `content-writer` drafts, `content-reviewer` repairs the draft in place "
                    "(two rounds at most), plus the gate |"):
            self.assertIn(row, section)
        for clause in ("The gate runs on every merge request, under both of its lenses.",
                       "never removes a hold and never changes a verdict literal",
                       "The reader-facing copy criterion fires whatever the type.",
                       "No rule keys on a round count.",
                       "`loop` by `agents-lead` alone, `content` by `product-lead` alone"):
            self.assertIn(clause, section)

    def test_the_loop_mode_contract_keeps_every_untouchable(self):
        section = orchestration_section("The loop-mode contract")
        for clause in ("never a permission rule", "the permission floor", "the gate and its lenses",
                       "head-scoped verdicts", "only-the-owner-opens-work", "(`sp:N` in both modes)",
                       "the routing labels or the container's existence", "`content` has no second mode",
                       "never on an empty pool", "Development parallelises; review does not.",
                       "Rebase onto the current trunk before the gate.", "`docs/loop-mode.md`",
                       "this contract wins", "One issue, one git worktree; no count bounds development.",
                       "At most one merge request is in review at a time",
                       "Remove a slice's worktree after its merge."):
            self.assertIn(clause, section)

    def test_no_method_file_reads_the_retired_wip_count(self):
        # Issue #216 (owner, 2026-10-19): the numeric work-in-progress ceiling is retired; development is
        # one issue per git worktree, and only the review gate is serial. The record's field may still be
        # NAMED inside a struck span (`~~...~~`, the struck-not-deleted convention), never outside one, so
        # no live instruction can send a reader to read or apply the count.
        field = re.compile(r"`wip:?`|\bwip: ?(?:\d|N\b)")
        hits = []
        for path in sorted(SOURCE.rglob("*.md")):
            for paragraph in unstruck_paragraphs(path):
                hits += ["%s: %s" % (path.relative_to(REPO), m.group(0)) for m in field.finditer(paragraph)]
        self.assertEqual(hits, [], "a method file still names the retired wip count outside a struck span")

    def test_autonomy_off_assumes_no_single_slice_in_flight(self):
        # Issue #216: with no count, several slices can be in flight, so `/autonomy off` finishes all of
        # them. Its table row, its ratified reading and its closing summary must not speak of ONE slice in
        # flight. Struck spans are removed first, so the kept history does not count.
        text = re.sub(r"~~.*?~~", "", (SOURCE / "commands" / "autonomy.md").read_text(encoding="utf-8"),
                      flags=re.DOTALL)
        row = re.search(r"(?m)^\| `off` \|.*$", text).group(0)
        reading = text[text.index("\n## Ratified reading (B)"):text.index("\n## What this does NOT do")]
        summary = text[text.index("\n## The closing summary"):]
        summary = summary[:summary.index("\n\n", summary.index("\n\n") + 2)]
        singular = re.compile(r"\b(?:the|whatever|this) (?:in-flight|current) slice\b|\bwhatever slice\b"
                              r"|\bthe slice (?:is )?(?:already )?in flight\b|\bafter the current slice\b",
                              re.IGNORECASE)
        hits = [m.group(0) for part in (row, reading, summary) for m in singular.finditer(" ".join(part.split()))]
        self.assertEqual(hits, [], "`/autonomy off` still assumes a single slice in flight")

    def test_autonomy_on_drains_without_a_slice_count(self):
        # Issue #216: `/autonomy on` drains one issue per worktree, with only the review gate serial. Its
        # table row and the opening paragraph of `# Mode: on` must not drain "one slice at a time". Struck
        # spans are removed and whitespace is collapsed first, so a phrase wrapped across lines is caught.
        text = re.sub(r"~~.*?~~", "", (SOURCE / "commands" / "autonomy.md").read_text(encoding="utf-8"),
                      flags=re.DOTALL)
        row = re.search(r"(?m)^\| `on` \|.*$", text).group(0)
        start = text.index("\n# Mode: `on`\n") + len("\n# Mode: `on`\n")
        opening = text[start:text.index("\n\n", start + 2)]
        count = re.compile(r"\bone (?:slice|issue|item|branch) at a time\b", re.IGNORECASE)
        hits = [m.group(0) for part in (row, opening) for m in count.finditer(" ".join(part.split()))]
        self.assertEqual(hits, [], "`/autonomy on` still drains one slice at a time")

    def test_how_to_ask_carries_the_five_rules(self):
        self.assertEqual(re.findall(r"(?m)^(\d)\. \*\*", orchestration_section("How to ask the owner", flat=False)),
                         ["1", "2", "3", "4", "5"])
        section = orchestration_section("How to ask the owner")
        for clause in ("One owner ask per activation or message.", "Never move the remainder into a prose or numbered list",
                       "the context lives in the options", "four is a ceiling",
                       "is an order and a link, not a question", "An interview takes no options; an escalation always does.",
                       "Do not rebuild it."):
            self.assertIn(clause, section)

    def test_the_skill_names_no_consumer(self):
        leaks = [line for line in ORCHESTRATION.read_text(encoding="utf-8").split("\n") if CONSUMER_WORDS.search(line)]
        self.assertEqual(leaks, [])

    def test_every_former_pointer_names_the_skill(self):
        # Per pointer, not per file: a file with two pointers must not stay green when one of them goes back
        # to a root brief while the other still names the skill. The anchor is stable text of the pointer's
        # own paragraph; struck spans are removed first, so a struck pointer does not count.
        for rel, anchor, pointer, heading in FORMER_POINTERS:
            self.assertIn("\n## " + heading + "\n", ORCHESTRATION.read_text(encoding="utf-8"), heading)
            paragraphs = [p for p in unstruck_paragraphs(SOURCE / rel) if anchor in p]
            self.assertEqual(len(paragraphs), 1, "%s: anchor %r" % (rel, anchor))
            self.assertIn(pointer, paragraphs[0], "%s: the pointer at %r no longer names the skill" % (rel, anchor))

    def test_no_method_file_keeps_a_root_brief_pointer_in_prose(self):
        hits = []
        for path in sorted(SOURCE.rglob("*.md")):
            for paragraph in unstruck_paragraphs(path):
                hits += ["%s: %s" % (path.relative_to(REPO), m) for m in ROOT_BRIEF_PROSE.findall(paragraph)]
        self.assertEqual(hits, [], "a method file still points at a root brief for an orchestration rule")

    def test_the_description_carries_the_trigger(self):
        # Under the owner's "Sob demanda" ruling the description is the only route by which the main session
        # loads this skill, so its trigger clause is pinned.
        fields, _ = mr.split_front_matter(ORCHESTRATION.read_text(encoding="utf-8"), "orchestration")
        self.assertIn("Use before dispatching a review, before any pool query or rite, and before any question, "
                      "decision or action you put to the owner.", fields["description"])

    def test_the_tool_less_profile_and_the_lens_preload_it(self):
        for name in ("scrum-master", "agents-lead"):
            self.assertIn("orchestration", AGENTS[name]["skills"], name)


# Issue #180 (owner, 2026-10-16): the owner reads a piece in the application's preview mode before it
# publishes, never a Claude Artifact. The rule lived in a skill none of the deciding actors loaded, so it
# is copied verbatim into the three surfaces they read. These are drift checks over STRINGS: they assert
# the sentence is written, identical and unopposed in method/, and cannot observe a session post an
# Artifact.
OWNER_READ = ("The owner reads a piece in the application's preview mode before it publishes: a new piece at "
              "its held preview, a correction to a published piece as a pending revision at the piece's own URL. "
              "Never a Claude Artifact, a paste, a file or a screenshot. Where the preview mode cannot render the "
              "case, say so to the owner and stop: nothing goes live, and the change waits. This governs his read "
              "of a publication only, not an Artifact he asked for elsewhere, such as a closing-rite report.")
OWNER_READ_SURFACES = ["agents/product-lead.md", "skills/content-publishing/SKILL.md",
                       "skills/orchestration/SKILL.md"]
CONTENT_PUBLISHING = SOURCE / "skills" / "content-publishing" / "SKILL.md"
# An instruction that routes the owner's read to an Artifact. Two alternatives: a word starting validat,
# read, review, approv or check, then at most 120 characters with no full stop, then "as a"/"as an" with an
# optional "rendered"/"Claude" before "Artifact"; or "Artifact", then at most 40 characters with no full
# stop, then "for him"/"for the owner" "to read/validate/review". "Artifact" is case-sensitive on purpose: the
# lower-case word is this method's generic "artifact of record".
# Out of scope: the owner's separate standing rule that closing-rite results reach him as a Claude Artifact.
# If a method file ever writes that rule down and this pattern turns red on it, exempt that file or section
# here BY NAME. Never reword the owner's rule to get past the pattern.
ARTIFACT_READ = re.compile(r"(?i:\b(?:validat|read|review|approv|check)\w*)\b[^.]{0,120}?"
                           r"(?i:\bas an? (?:rendered |claude )?)Artifact\b"
                           r"|\bArtifact\b[^.]{0,40}(?i:\bfor (?:him|the owner) to (?:read|validate|review)\b)")


def markdown_section(path, heading):
    """One `### heading` section of a file, whitespace-flattened, up to the next heading of level 2 or 3."""
    text = path.read_text(encoding="utf-8")
    start = text.index("\n### " + heading)
    ends = [i for i in (text.find("\n## ", start + 1), text.find("\n### ", start + 1)) if i != -1]
    return " ".join(text[start:min(ends) if ends else len(text)].split())


class OwnerReadIsThePreviewMode(unittest.TestCase):
    def test_the_sentence_is_on_one_line_in_exactly_the_three_surfaces(self):
        # One line per copy, so `git grep -n -F` finds each; struck copies would not count as copies.
        found = {}
        for path in sorted(SOURCE.rglob("*.md")):
            lines = [n for n, line in enumerate(path.read_text(encoding="utf-8").split("\n"), 1)
                     if OWNER_READ in line and "~~" not in line]
            if lines:
                found[str(path.relative_to(SOURCE))] = lines
        self.assertEqual(sorted(found), OWNER_READ_SURFACES, "the owner-read sentence drifted or moved")
        for rel, lines in found.items():
            self.assertEqual(len(lines), 1, "%s: exactly one copy" % rel)

    def test_no_method_file_routes_the_owner_read_to_an_artifact(self):
        hits = []
        for path in sorted(SOURCE.rglob("*.md")):
            for paragraph in unstruck_paragraphs(path):
                hits += ["%s: %s" % (path.relative_to(REPO), m.group(0)) for m in ARTIFACT_READ.finditer(paragraph)]
        self.assertEqual(hits, [], "a method file routes the owner's read to an Artifact")

    def test_the_correction_case_is_specified(self):
        section = markdown_section(CONTENT_PUBLISHING, "A correction to an already-published piece")
        for clause in ("*«Construir modo revisão»*", "**The public enumeration** drops a flagged piece",
                       "to the locale home", "to the root redirect", "**The mechanism: a pending revision.**",
                       "It is **body-only**", "it is two merges", "**The revision merge.**", "**His read.**",
                       "**The release merge.**", "**His comment on this merge request, naming the URLs he read, "
                       "records his read**", "nothing goes live, and the correction waits."):
            self.assertIn(clause, section)
        self.assertEqual(CONSUMER_WORDS.findall(section), [], "the method names no consumer path")

    def test_the_conflicting_criterion_rule_and_step_8_artifact(self):
        text = " ".join(CONTENT_PUBLISHING.read_text(encoding="utf-8").split())
        self.assertIn("**An acceptance criterion that contradicts it is a conflict to name, not an instruction.**", text)
        step8 = markdown_section(CONTENT_PUBLISHING, "8 · His validation")
        self.assertIn("**What records his validation is his comment on the release merge request, naming the "
                      "preview URLs he read.**", step8)

    def test_the_descriptions_carry_the_owner_read(self):
        for path in (CONTENT_PUBLISHING, ORCHESTRATION):
            fields, _ = mr.split_front_matter(path.read_text(encoding="utf-8"), path.parent.name)
            self.assertIn("what the owner reads before a content merge", fields["description"], path.parent.name)
            self.assertIn("never a Claude Artifact", fields["description"], path.parent.name)


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
            # #196: argument-hint only on the plugin standard's allowlisted owner-typed commands.
            hinted = c not in ("idea-to-issues", "new-idea", "what-else", "handoff")
            head = "\n".join(front_matter(self.h.p(".claude/commands/%s.md" % c)))
            (self.assertIn if hinted else self.assertNotIn)("argument-hint:", head, c)

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

    def test_the_store_contract_ships_with_the_installed_rite(self):
        # Issue #181 AC1: the funnel-review store contract is read at run time by the rite's driver in a
        # consuming repository, so it is installed beside the scripts, and the rendered rite names a path
        # that exists there. The worklog contract is read only by a test in this source tree: it stays in
        # the source and is not installed. No method file still names the consumer store's README as the
        # contract.
        scripts = self.h.p(SCRIPTS_DIR)
        for directory in ("worklog-contract", "funnel-review-contract"):
            self.assertTrue((SOURCE / "scripts" / directory / "README.md").is_file(), directory)
            self.assertFalse(any(directory in name for name in SCRIPTS), directory)
        self.assertFalse((scripts / "worklog-contract").exists(), "the worklog contract was installed")
        installed = scripts / "funnel-review-contract" / "README.md"
        self.assertTrue(installed.is_file(), "the funnel-review contract was not installed")
        lines = installed.read_text(encoding="utf-8").split("\n")
        self.assertIn(MARKER, lines[0])
        self.assertIn("source: method/scripts/funnel-review-contract/README.md", lines[0])
        self.assertEqual("\n".join(lines[1:]), (SOURCE / "scripts" / "funnel-review-contract" / "README.md")
                         .read_text(encoding="utf-8"))
        self.assertTrue((scripts / "funnel-review.sh").is_file())
        rite = (SOURCE / "commands" / "funnel-review.md").read_text(encoding="utf-8")
        self.assertIn("`{{method-scripts}}/funnel-review-contract/README.md`", rite)
        for rendered in (".claude/commands/funnel-review.md", ".agents/skills/funnel-review/SKILL.md",
                         ".kiro/skills/funnel-review/SKILL.md"):
            self.assertIn("`%s`" % installed, self.h.p(rendered).read_text(encoding="utf-8"), rendered)
        old = "docs/funnel-review/" + "README.md"
        named = [str(p.relative_to(REPO)) for p in sorted(SOURCE.rglob("*")) if p.is_file()
                 and p.suffix in (".md", ".sh", ".py", ".tsv") and old in p.read_text(encoding="utf-8")]
        self.assertEqual(named, [], "a method file still names the consumer store's README as the contract")

    def test_the_installed_document_is_not_executable(self):
        # ADR-0032, amendment 2026-10-16: the 0700 chmod stays scoped to scripts.
        installed = self.h.p(SCRIPTS_DIR) / "funnel-review-contract" / "README.md"
        self.assertEqual(installed.stat().st_mode & 0o111, 0, oct(installed.stat().st_mode))

    def test_a_document_through_a_symbolic_link_stops_the_render(self):
        # ADR-0032, amendment 2026-10-16: a named document that is a symbolic link, or sits in a symlinked
        # directory, is not loaded, so the body naming it stops the render with nothing written.
        outside = Path(tempfile.mkdtemp(prefix="outside-", dir=BASE))
        (outside / "README.md").write_text("# outside\n", encoding="utf-8")
        for case in ("file", "directory"):
            h = Home()
            src = Path(tempfile.mkdtemp(prefix="link-source-", dir=BASE)) / "method"
            shutil.copytree(SOURCE, src)
            if case == "file":
                (src / "scripts" / "linked").mkdir()
                (src / "scripts" / "linked" / "README.md").symlink_to(outside / "README.md")
            else:
                (src / "scripts" / "linked").symlink_to(outside, target_is_directory=True)
            rite = src / "commands" / "funnel-review.md"
            rite.write_text(rite.read_text(encoding="utf-8") + "\nSee `{{method-scripts}}/linked/README.md`.\n",
                            encoding="utf-8")
            code, out = h.run("--mode=install", "--source=%s" % src)
            self.assertEqual(code, 2, (case, out))
            self.assertIn("linked/README.md names no file", out, case)
            self.assertEqual([p for p in h.root.rglob("*") if p.is_file()], [], case)

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


class HarnessToken(unittest.TestCase):
    """#198: {{agent-harness}} is substituted per carrier writer, with the harness passed explicitly, and
    stops the render anywhere but a command body."""

    COMMAND = {"description": "d", "purpose": "", "hint": "", "where": "method/commands/x.md",
               "body": "\nThis copy is for {{agent-harness}}.\n"}

    def test_each_writer_substitutes_its_own_harness(self):
        self.assertIn("This copy is for claude-code.", mr.claude_command(self.COMMAND, STAMP, "claude-code"))
        self.assertIn("This copy is for codex.", mr.command_as_skill(self.COMMAND, "x", "$x", STAMP, "codex"))
        self.assertIn("This copy is for kiro.", mr.command_as_skill(self.COMMAND, "x", "/x", STAMP, "kiro"))
        with self.assertRaises(mr.SourceError):
            mr.claude_command(self.COMMAND, STAMP, "claude")

    def test_the_rendered_carriers_differ_only_where_the_token_was(self):
        h = Home()
        self.assertEqual(h.run("--mode=install")[0], 0)
        expected = {".claude/commands/handoff.md": "claude-code", ".agents/skills/handoff/SKILL.md": "codex",
                    ".kiro/skills/handoff/SKILL.md": "kiro"}
        for rel, harness in expected.items():
            text = h.p(rel).read_text(encoding="utf-8")
            self.assertNotIn(mr.HARNESS_TOKEN, text, rel)
            self.assertIn("rendered for the agent harness `%s`" % harness, text, rel)

    def test_the_token_in_a_skill_or_agent_body_stops_the_render(self):
        for rel in ("skills/shell/SKILL.md", "agents/developer.md"):
            src = Path(tempfile.mkdtemp(prefix="src-", dir=BASE)) / "method"
            shutil.copytree(SOURCE, src)
            f = src / rel
            f.write_text(f.read_text(encoding="utf-8") + "\n{{agent-harness}}\n", encoding="utf-8")
            h = Home()
            code, out = h.run("--mode=install", "--source=" + str(src))
            self.assertEqual(code, 2, out)
            self.assertIn("{{agent-harness}} is for command bodies only", out)
            self.assertEqual([p for p in h.root.rglob("*") if p.is_file()], [], rel)


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

    def test_the_installer_no_longer_edits_the_plugin_settings(self):
        """#206: the plugin cutover step is removed. install.sh --method renders the method and leaves an
        enabled tadeumendonca-skills plugin, and the file holding it, exactly as they were."""
        h = Home()
        settings = h.p(".claude/settings.json")
        settings.parent.mkdir(parents=True, exist_ok=True)
        settings.write_text(json.dumps({"enabledPlugins": {"tadeumendonca-skills@tadeumendonca": True}}) + "\n",
                            encoding="utf-8")
        inst = REPO / "global" / "install.sh"
        p = subprocess.run(["sh", str(inst), "--method"], env=h.env, capture_output=True, text=True)
        self.assertEqual(p.returncode, 0, p.stdout + p.stderr)
        self.assertIn("METHOD  installed: ", p.stdout)
        self.assertNotIn("tadeumendonca-skills@tadeumendonca", p.stdout)
        self.assertIs(json.loads(settings.read_text())["enabledPlugins"]["tadeumendonca-skills@tadeumendonca"], True,
                      "the installer no longer retires the plugin")
        self.assertFalse(list(Path(h.root).rglob("*.pmhwc-plugin-backup")), "nothing was retired, so no backup")
        self.assertFalse((REPO / "global" / "method" / "plugin_retire.py").exists())


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
