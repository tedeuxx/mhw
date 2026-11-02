#!/usr/bin/env python3
"""The merge-authority contract (#195): parse it, project it, and validate a project brief against it.

The contract is a fenced `merge-authority-contract` JSON block in the method's `merge-authority` skill
(method/skills/merge-authority/SKILL.md). `mhw check --project=DIR` calls check_project(), which reads the
INSTALLED copies of that skill and the project's root AGENTS.md, and reports:

  - fail closed (exit 2) when no installed copy carries a readable contract, the copies disagree, or the
    installed contract does not understand the declared format;
  - findings (exit 1) when the project's one declaration block is absent, duplicated, incomplete, names an
    unknown loop model or carries any key other than contract, loop-model, integration-branch and
    boundary-trigger; when a trunk brief describes a release candidate without declaring its integration
    branch (the contract's release-candidate hold then rests on prose); when a
    boundary trigger uses authority vocabulary; when the live prose carries a known legacy phrase; and when
    the live prose names a loop model other than the declared one.

Live prose excludes struck spans, code fences, blockquotes, HTML comments and quoted text. This parses one
bounded block and a short list of known phrases; it does not understand natural language, so an unrelated
paraphrase outside the block is a review-level false negative. A check you run, not a hook.
Standard library only, Python 3.9+.
"""
import json
from pathlib import Path
import re

FENCE_INFO = "merge-authority-contract"
SKILL = "merge-authority"
BEGIN = "<!-- merge-authority:begin -->"
END = "<!-- merge-authority:end -->"
PROJECTION_BEGIN = "<!-- merge-authority:projection"
PROJECTION_END = "<!-- merge-authority:end -->"
INSTALL = "run `mhw install --method` (./mhw install --method in a checkout), then check again"
ALLOWED = ("contract", "loop-model", "integration-branch", "boundary-trigger")
# Live prose that describes a release candidate or an rc/ branch: the release-candidate hold must then be
# declared, so it rests on the contract and not on prose the contract does not see.
RC_PROSE = re.compile(r"\brelease candidate\b|(?<![\w/])rc/[A-Za-z0-9._-]+", re.I)
BRANCH = re.compile(r"[A-Za-z0-9][A-Za-z0-9._/-]*")

# A key a project may not declare, by what it would override. Matched on the key, case-insensitive.
OVERRIDE_KEYS = (
    (re.compile(r"execut|merger|merged-by|merges?$|who-merges"), "executor override"),
    (re.compile(r"hold|ratif|escalat|human"), "hold override"),
    (re.compile(r"verdict|literal|approve"), "verdict override"),
    (re.compile(r"^(?:safe|boundary|class|classes|class-.*)$"), "class relationship override"),
)
# Words that assign authority rather than classify. A boundary trigger carrying one is refused.
AUTHORITY_WORDS = re.compile(r"APPROVE-|\bratif\w*|\bescalat\w*|\bholds?\b|\bmerges\b|\bmerged by\b|"
                             r"go/no-go|pending[- ]human", re.IGNORECASE)
# Known legacy phrases, matched on flattened live prose with emphasis and code marks removed.
LEGACY = (
    (re.compile(r"\bescalat\w*\s+(?:the\s+)?boundary\b", re.I),
     "the gate escalates the boundary class: that is a fifth hold the method does not have"),
    (re.compile(r"\bboundary(?:\s+class)?\s+(?:is|are|goes|go)\s+(?:escalated|held|handed up|ratified|to the owner)\b",
                re.I),
     "the boundary class is held for the owner: that is a fifth hold the method does not have"),
    (re.compile(r"\b(?:never|not|n't)\s+merges?\s+(?:the\s+)?boundary\b", re.I),
     "the gate does not merge the boundary class: that changes the method's executor"),
)
PRECEDENCE = re.compile(r"\bthis file wins\b", re.I)
LOOP_MODEL_PROSE = re.compile(r"\bloop model:\s*([a-z]+(?:-[a-z]+)+)", re.I)


class ContractError(Exception):
    pass


def _load(text, where):
    """The one fenced contract block, decoded, with its top-level shape checked."""
    blocks = re.findall(r"(?ms)^```" + re.escape(FENCE_INFO) + r"[ \t]*\n(.*?)^```[ \t]*$", text)
    if len(blocks) != 1:
        raise ContractError("%s: expected one ```%s block, found %d" % (where, FENCE_INFO, len(blocks)))
    try:
        c = json.loads(blocks[0])
    except ValueError as exc:
        raise ContractError("%s: the contract is not valid JSON (%s)" % (where, exc))
    if not isinstance(c, dict) or c.get("contract") != "merge-authority":
        raise ContractError("%s: not a merge-authority contract" % where)
    dv = c.get("declaration-versions")
    if (not isinstance(c.get("version"), int) or not isinstance(dv, list) or not dv
            or not all(isinstance(v, int) for v in dv)):
        raise ContractError("%s: version and a non-empty list of integer declaration-versions are required" % where)
    if (not isinstance(c.get("verdicts"), list) or not isinstance(c.get("holds"), dict)
            or not isinstance(c.get("models"), dict) or not c["models"]):
        raise ContractError("%s: verdicts, holds and models are required" % where)
    return c


def _check_optional(c, where):
    """Optional keys (#133, #134): a copy installed before the evidence, discharge or owner-check rule still
    parses; a present key must be well formed."""
    for key in ("owner-evidence", "hold-discharge", "owner-check"):
        if key in c and (not isinstance(c[key], str) or not c[key].strip()):
            raise ContractError("%s: %s must be a non-empty string" % (where, key))
    retired = c.get("retired-verdicts", [])
    if (not isinstance(retired, list) or not all(isinstance(v, str) and v.strip() for v in retired)
            or set(retired) & set(c["verdicts"])):
        raise ContractError("%s: retired-verdicts must be a list of literals none of which is a live verdict" % where)


def _check_model(name, m, c, where):
    """One model's keys, verdict mappings and holds, its integration-branch variant included."""
    for key in ("executor", "safe", "boundary", "holds", "on-hold", "hold-executor", "executor-blocked",
                "changes"):
        if key not in m:
            raise ContractError("%s: model %s lacks %s" % (where, name, key))
    for key in ("safe", "boundary", "on-hold", "executor-blocked", "changes"):
        if m[key] not in c["verdicts"]:
            raise ContractError("%s: model %s maps %s to an unknown verdict %s" % (where, name, key, m[key]))
    variant = m.get("with-integration-branch")
    extra = []
    if variant is not None:
        if not isinstance(variant, dict) or not isinstance(variant.get("holds"), list) \
                or not variant["holds"] or "promotion-executor" not in variant:
            raise ContractError("%s: model %s has a malformed with-integration-branch" % (where, name))
        extra = variant["holds"]
    for h in list(m["holds"]) + extra:
        if h not in c["holds"]:
            raise ContractError("%s: model %s names an unknown hold %s" % (where, name, h))


def parse_contract(text, where="the contract"):
    """The one fenced merge-authority-contract block in a text, as a validated dict."""
    c = _load(text, where)
    _check_optional(c, where)
    for name, m in c["models"].items():
        _check_model(name, m, c, where)
    return c


def _model_line(name, m, c):
    """One model's projection line. #133 (contract v2): a hold is discharged by the owner's cited comment,
    then the named actor merges; a contract without hold-discharge (v1) renders the v1 wording unchanged."""
    holds = "; ".join("(%d) %s" % (i, c["holds"][h]) for i, h in enumerate(m["holds"], 1))
    discharge = c.get("hold-discharge")
    held = ("`%s` until %s, then `%s` merges" % (m["on-hold"], discharge, m["hold-executor"]) if discharge
            else "`%s`, the %s merges" % (m["on-hold"], m["hold-executor"]))
    line = ("- `%s`: `%s` merges what it clears; safe class -> `%s`; boundary class -> `%s`; %d holds -> "
            "%s: %s. Cleared but not executable -> `%s`; unmet Definition of Done -> `%s`."
            % (name, m["executor"], m["safe"], m["boundary"], len(m["holds"]), held, holds,
               m["executor-blocked"], m["changes"]))
    if "promotion-executor" in m:
        line += (" The promotion is held the same way, then `%s` merges it." % m["promotion-executor"]
                 if discharge else " The promotion is the %s's." % m["promotion-executor"])
    variant = m.get("with-integration-branch")
    if variant:
        vheld = ("`%s`, discharged the same way, then `%s` merges" % (m["on-hold"], variant["promotion-executor"])
                 if discharge else "`%s`, the %s merges" % (m["on-hold"], variant["promotion-executor"]))
        line += (" With a declared integration branch, slices merge into it under this rule, and %s: %s -> "
                 "%s."
                 % ("these holds are added" if len(variant["holds"]) > 1 else "this hold is added",
                    "; ".join(c["holds"][h] for h in variant["holds"]), vheld))
    return line


def projection(c):
    """The operational copy every method consumer carries, generated from the contract (exact text)."""
    out = [PROJECTION_BEGIN + " v%d: generated from the merge-authority skill; do not edit by hand -->" % c["version"]]
    out += [_model_line(name, c["models"][name], c) for name in c["models"]]
    if c.get("owner-evidence"):
        out.append("- Owner-dependent criteria: %s." % c["owner-evidence"])
    if c.get("owner-check"):
        out.append("- Owner check: %s." % c["owner-check"])
    if c.get("retired-verdicts"):
        out.append("- Retired verdicts, refused by every reader: %s."
                   % ", ".join("`%s`" % v for v in c["retired-verdicts"]))
    out.append("- Canonical source: the `merge-authority` skill. A project brief declares only its loop model, "
               "its integration branch if it has one, and its boundary triggers.")
    out.append(PROJECTION_END)
    return "\n".join(out)


def projection_block(text):
    """The projection block in a consumer's text, or None."""
    start = text.find(PROJECTION_BEGIN)
    if start == -1:
        return None
    end = text.find(PROJECTION_END, start)
    return None if end == -1 else text[start:end + len(PROJECTION_END)]


def method_copy_findings(text, contract, verdicts):
    """Drift of one method operational copy from the contract: its projection block must equal the
    projection, each verdict in `verdicts` must still be named outside the block, its live prose must name
    no retired verdict (#134; struck, fenced or quoted history may) and carry no known legacy phrase. A
    check over strings; a paraphrase elsewhere is not caught."""
    found = []
    block = projection_block(text)
    if block is None:
        found.append("no projection block")
    elif block != projection(contract):
        found.append("the projection block differs from the contract")
    rest = text.replace(block, "") if block else text
    for v in verdicts:
        if not re.search(r"(?<![A-Z-])" + re.escape(v) + r"(?![A-Z-])", rest):
            found.append("no longer names %s" % v)
    live = live_prose(rest)
    for v in contract.get("retired-verdicts", []):
        if re.search(r"(?<![A-Z-])" + re.escape(v) + r"(?![A-Z-])", live):
            found.append("its live prose names the retired verdict %s" % v)
    found += legacy_findings(text)
    return found


def live_prose(text):
    """Text a reader takes as a live instruction: no fences, struck spans, blockquotes, comments or quotes."""
    lines, kept, fence = text.split("\n"), [], None
    for line in lines:
        m = re.match(r"^ {0,3}(`{3,}|~{3,})", line)
        if fence:
            if m and m.group(1)[0] == fence[0] and len(m.group(1)) >= len(fence):
                fence = None
            continue
        if m:
            fence = m.group(1)
            continue
        if re.match(r"^\s*>", line):
            continue
        kept.append(line)
    text = "\n".join(kept)
    text = re.sub(r"<!--.*?-->", " ", text, flags=re.S)
    text = re.sub(r"~~.*?~~", " ", text, flags=re.S)
    for a, b in (("“", "”"), ("«", "»"), ('"', '"')):
        text = re.sub(re.escape(a) + r"[^\n]*?" + re.escape(b), " ", text)
    return text


def flatten(text):
    return " ".join(re.sub(r"[*_`]", "", text).split())


def legacy_findings(text):
    """Known conflicting phrases in the live prose of a text."""
    flat = flatten(live_prose(text))
    found = []
    for pattern, why in LEGACY:
        for m in pattern.finditer(flat):
            found.append("%s (%r)" % (why, m.group(0)))
    for sentence in re.split(r"(?<=[.;!?])\s+", flat):
        if PRECEDENCE.search(sentence) and not re.search(r"merge[- ]authority", sentence, re.I):
            found.append("the brief claims it wins over the method, which reaches merge authority (%r)"
                         % PRECEDENCE.search(sentence).group(0))
    return found


def declaration_blocks(text):
    """Each declaration block's inner lines, for blocks whose markers sit at column 0 outside a fence."""
    blocks, current, fence = [], None, None
    for line in text.split("\n"):
        m = re.match(r"^ {0,3}(`{3,}|~{3,})", line)
        if fence:
            if m and m.group(1)[0] == fence[0] and len(m.group(1)) >= len(fence):
                fence = None
            continue
        if m and current is None:
            fence = m.group(1)
            continue
        if line.rstrip() == BEGIN:
            current = []
        elif line.rstrip() == END and current is not None:
            blocks.append(current)
            current = None
        elif current is not None:
            current.append(line)
    if current is not None:
        blocks.append(None)  # opened, never closed
    return blocks


def check_declaration(lines, contract):
    """(findings, unsupported, loop model, integration branch declared) for one block's lines against the installed contract."""
    findings, entries = [], []
    for raw in lines:
        s = raw.strip()
        if not s:
            continue
        s = re.sub(r"^[-*]\s+", "", s)
        m = re.match(r"^([A-Za-z][A-Za-z0-9_-]*)\s*:\s*(.*)$", s)
        if not m:
            findings.append("the declaration carries a line that is not `key: value`: %r" % s[:60])
            continue
        entries.append((m.group(1).lower(), m.group(2).strip()))
    for key, value in entries:
        if key in ALLOWED:
            continue
        kind = next((k for p, k in OVERRIDE_KEYS if p.search(key)), None)
        if kind:
            findings.append("%s: a project may not declare `%s`; the method owns the executor, the verdicts "
                            "and the holds" % (kind, key))
        else:
            findings.append("unknown key `%s`: the declaration carries only %s" % (key, ", ".join(ALLOWED)))
    contracts = [v for k, v in entries if k == "contract"]
    models = [v for k, v in entries if k == "loop-model"]
    branches = [v for k, v in entries if k == "integration-branch"]
    unsupported = None
    if len(contracts) != 1:
        findings.append("the declaration needs exactly one `contract: merge-authority vN` line (found %d)"
                        % len(contracts))
    else:
        m = re.fullmatch(r"merge-authority\s+v(\d+)", contracts[0])
        if not m:
            findings.append("`contract: %s` does not reference the method contract (merge-authority vN)"
                            % contracts[0])
        else:
            n = int(m.group(1))
            known = contract["declaration-versions"]
            if n not in known:
                unsupported = (n, known)
    if len(models) != 1:
        findings.append("the declaration needs exactly one `loop-model` line (found %d)" % len(models))
    elif models[0] not in contract["models"]:
        findings.append("loop model `%s` is not one the contract maps (%s)"
                        % (models[0], ", ".join(sorted(contract["models"]))))
    if len(branches) > 1:
        findings.append("the declaration carries %d `integration-branch` lines; at most one" % len(branches))
    for b in branches:
        if not BRANCH.fullmatch(b.strip("`")):
            findings.append("`integration-branch: %s` is not a branch name" % b[:60])
    if branches and len(models) == 1 and models[0] in contract["models"] \
            and not contract["models"][models[0]].get("with-integration-branch"):
        findings.append("`integration-branch` is declared, but the contract gives `%s` no integration-branch "
                        "variant" % models[0])
    for key, value in entries:
        if key == "boundary-trigger":
            if not value:
                findings.append("an empty `boundary-trigger`")
            elif AUTHORITY_WORDS.search(value):
                findings.append("a boundary trigger may classify, not assign authority: %r uses %r"
                                % (value[:60], AUTHORITY_WORDS.search(value).group(0)))
    return findings, unsupported, (models[0] if len(models) == 1 else None), bool(branches)


def installed_skill_paths(home):
    home = Path(home)
    return [("Claude Code", home / ".claude" / "skills" / SKILL / "SKILL.md"),
            ("Codex", home / ".agents" / "skills" / SKILL / "SKILL.md"),
            ("Kiro", home / ".kiro" / "skills" / SKILL / "SKILL.md")]


def installed_contract(home):
    """The installed contract, or raise ContractError with the reason to fail closed."""
    found = []
    for harness, path in installed_skill_paths(home):
        if path.is_file():
            try:
                text = path.read_text(encoding="utf-8")
            except (OSError, UnicodeDecodeError) as exc:
                raise ContractError("%s copy %s cannot be read (%s)" % (harness, path, exc.__class__.__name__))
            found.append((harness, parse_contract(text, "%s copy %s" % (harness, path))))
    if not found:
        raise ContractError("no installed copy of the method's merge-authority contract (the method is not "
                            "installed, or it predates #195)")
    first = found[0][1]
    for harness, c in found[1:]:
        if c != first:
            raise ContractError("the installed copies of the contract disagree (%s and %s)" % (found[0][0], harness))
    return first


def check_project(root, home):
    """(exit code, report lines) for a project's root AGENTS.md against the installed contract."""
    tag = "PROJECT merge authority: "
    try:
        contract = installed_contract(home)
    except ContractError as exc:
        return 2, [tag + "CANNOT VALIDATE (fail closed): %s; %s" % (exc, INSTALL)]
    brief = Path(root) / "AGENTS.md"
    try:
        text = brief.read_text(encoding="utf-8")
    except OSError:
        return 1, [tag + "no AGENTS.md at %s; the project brief must declare its merge-authority block" % root]
    findings = []
    blocks = declaration_blocks(text)
    if not blocks:
        findings.append("no `%s` block: declare the loop model and the boundary triggers there and reference "
                        "the method contract instead of restating it" % BEGIN)
    elif len(blocks) > 1:
        findings.append("%d declaration blocks; there must be exactly one" % len(blocks))
    elif blocks[0] is None:
        findings.append("the declaration block is opened and never closed with `%s`" % END)
    else:
        block_findings, unsupported, model, branch = check_declaration(blocks[0], contract)
        if unsupported:
            n, known = unsupported
            if n > max(known):
                return 2, [tag + "CANNOT VALIDATE (fail closed): the project declares format v%d and the installed "
                           "contract (v%d) understands only %s; %s"
                           % (n, contract["version"], ", ".join("v%d" % k for k in known), INSTALL)]
            block_findings.append("the project declares format v%d, which the installed contract no longer reads "
                                  "(it reads %s); update the `contract` line"
                                  % (n, ", ".join("v%d" % k for k in known)))
        findings += block_findings
        if model and contract["models"].get(model, {}).get("with-integration-branch") and not branch:
            rc = RC_PROSE.search(flatten(live_prose(text)))
            if rc:
                findings.append("the prose describes a release candidate or an integration branch (%r) but the "
                                "declaration has no `integration-branch`; declare it so the contract's "
                                "release-candidate hold applies" % rc.group(0))
        if model:
            for m in LOOP_MODEL_PROSE.finditer(flatten(live_prose(text))):
                if m.group(1).lower() != model:
                    findings.append("the prose names loop model `%s`, the declaration `%s`" % (m.group(1), model))
    findings += ["changes method-owned merge authority: " + f for f in legacy_findings(text)]
    if findings:
        return 1, [tag + "FAIL " + f for f in findings]
    return 0, [tag + "OK (contract v%d)" % contract["version"]]
