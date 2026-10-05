#!/usr/bin/env python3
"""Render the working method (method/) into each agent harness's user-level native carrier (ADR-0031).

    method_render.py --mode=install|check|dry-run|uninstall [--stamp="release: R; commit: C"] [--source=DIR]
                     [--home=DIR]

install.sh runs this as its own rendering step and passes the provenance stamp it derived (ADR-0029), so
the stamp is derived once. ./workstation install, check, status and uninstall reach it through install.sh.

Carriers (ADR-0027 matrix, ADR-0031):
    Claude Code  ~/.claude/agents/<n>.md (tools, disallowedTools, skills), ~/.claude/skills/<n>/SKILL.md,
                 ~/.claude/commands/<n>.md
    Codex        ${CODEX_HOME:-~/.codex}/agents/<n>.toml (no tool list exists: an instruction, plus a
                 read-only sandbox for an agent granted no tool), ~/.agents/skills/<n>/SKILL.md, and each
                 command as a skill with agents/openai.yaml policy.allow_implicit_invocation false
    Kiro         ~/.kiro/agents/<n>.json (tools, allowedTools, excludedTools, preloaded skills as files),
                 ~/.kiro/skills/<n>/SKILL.md, and each command as a skill (a slash command in CLI and IDE)

Every rendered file carries the managed-by line with the stamp, "source: method/...", in its own
format's comment (Markdown front matter, TOML, YAML) or, in the Kiro agent JSON, as the first line of its
prompt. A file without that line is never overwritten or removed. Output lines use install.sh's words:
OK, WROTE, RESTAMPED, STAMP, DRIFT, MISSING, STALE, REFUSE, REMOVED.
Exit codes: 0 ok; 1 a target differs (--check); 2 usage or invalid source; 3 an unmanaged file is in the way.
Standard library only, Python 3.9+.
"""

import json
import os
import re
import sys
from pathlib import Path

MARKER_ID = "managed-by: personal-multi-harness-workstation-configuration"
SOURCE_TAG = "source: method/"
HERE = Path(__file__).resolve().parent
DEFAULT_SOURCE = HERE.parent.parent / "method"
NAME_RE = re.compile(r"[a-z0-9]+(?:-[a-z0-9]+)*")
TOOL_RE = re.compile(r"[A-Za-z][A-Za-z0-9_*-]*")
# Claude Code tool names -> Kiro tool tags (Kiro agent configuration reference: read, write, shell, web,
# @server). Anything not listed here stops the render rather than being dropped silently.
KIRO_TOOLS = {"Read": "read", "Grep": "read", "Glob": "read", "Write": "write", "Edit": "write",
              "Bash": "shell", "WebFetch": "web", "WebSearch": "web"}
WRITING_TOOLS = {"Write", "Edit", "Bash"}
DESCRIPTION_MAX = 1024  # Agent Skills standard limit, read by Codex and Kiro


class SourceError(Exception):
    pass


# --------------------------------------------------------------------------------------------------
# Source parsing: a restricted front matter (key: scalar, or key: followed by "  - item" lines).

def split_front_matter(text, where):
    lines = text.split("\n")
    if not lines or lines[0] != "---":
        raise SourceError("%s: no front matter" % where)
    try:
        end = lines.index("---", 1)
    except ValueError:
        raise SourceError("%s: unterminated front matter" % where)
    fields, current = {}, None
    for line in lines[1:end]:
        if not line.strip():
            continue
        m = re.fullmatch(r"([a-z][a-z-]*):\s*(.*)", line)
        if m:
            current = m.group(1)
            if current in fields:
                raise SourceError("%s: duplicate key %s" % (where, current))
            value = m.group(2).strip()
            if value == "[]":
                fields[current] = []
            elif value == "":
                fields[current] = []
            elif value.startswith('"'):
                try:
                    fields[current] = json.loads(value)
                except ValueError:
                    raise SourceError("%s: invalid quoted value for %s" % (where, current))
            else:
                fields[current] = value
            continue
        m = re.fullmatch(r"\s+-\s+(\S+)", line)
        if m and current is not None and isinstance(fields[current], list):
            fields[current].append(m.group(1))
            continue
        raise SourceError("%s: unsupported front matter line: %s" % (where, line))
    body = "\n".join(lines[end + 1:])
    return fields, body


def need(fields, key, where):
    value = fields.get(key)
    if not isinstance(value, str) or not value.strip():
        raise SourceError("%s: missing %s" % (where, key))
    if "\n" in value:
        raise SourceError("%s: %s must be one line" % (where, key))
    return value


def load(source):
    if not source.is_dir():
        raise SourceError("source not found: %s" % source)
    skills, agents, commands = {}, {}, {}
    for path in sorted((source / "skills").glob("*/SKILL.md")):
        name = path.parent.name
        where = "method/skills/%s/SKILL.md" % name
        fields, body = split_front_matter(path.read_text(encoding="utf-8"), where)
        if fields.get("name") != name or not NAME_RE.fullmatch(name) or len(name) > 64:
            raise SourceError("%s: name must equal the directory name (lowercase, hyphens, 64 at most)" % where)
        skills[name] = {"description": need(fields, "description", where), "purpose": fields.get("purpose", ""),
                        "body": body, "where": where}
    for path in sorted((source / "commands").glob("*.md")):
        name = path.stem
        where = "method/commands/%s.md" % name
        fields, body = split_front_matter(path.read_text(encoding="utf-8"), where)
        if fields.get("name") != name or not NAME_RE.fullmatch(name):
            raise SourceError("%s: name must equal the file name" % where)
        commands[name] = {"description": need(fields, "description", where), "purpose": fields.get("purpose", ""),
                          "hint": fields.get("argument-hint", ""), "body": body, "where": where}
    for path in sorted((source / "agents").glob("*.md")):
        name = path.stem
        where = "method/agents/%s.md" % name
        fields, body = split_front_matter(path.read_text(encoding="utf-8"), where)
        if fields.get("name") != name or not NAME_RE.fullmatch(name):
            raise SourceError("%s: name must equal the file name" % where)
        if "tools" not in fields:
            # Absence inherits every tool of the parent in Claude Code, so a missing key is refused.
            raise SourceError("%s: tools must be declared (an explicit [] for none)" % where)
        raw = fields["tools"]
        tools = raw if isinstance(raw, list) else [t.strip() for t in raw.split(",") if t.strip()]
        for t in tools:
            if not TOOL_RE.fullmatch(t):
                raise SourceError("%s: invalid tool name %r" % (where, t))
            if t not in KIRO_TOOLS and not t.startswith("mcp__"):
                raise SourceError("%s: tool %s has no Kiro mapping" % (where, t))
        raw = fields.get("disallowed-tools", [])
        excluded = raw if isinstance(raw, list) else [t.strip() for t in raw.split(",") if t.strip()]
        for t in excluded:
            # An exclusion narrows a granted MCP server to fewer of its tools: mcp__<server>__<tool>.
            m = re.fullmatch(r"mcp__([A-Za-z0-9_-]+?)__([A-Za-z0-9_-]+)", t)
            if not m or ("mcp__" + m.group(1)) not in tools:
                raise SourceError("%s: disallowed tool %r must be mcp__<server>__<tool> of a granted server"
                                  % (where, t))
        preload = fields.get("skills", [])
        if not isinstance(preload, list):
            raise SourceError("%s: skills must be a list" % where)
        for s in preload:
            if s not in skills:
                raise SourceError("%s: preloads unknown skill %s" % (where, s))
        agents[name] = {"description": need(fields, "description", where), "purpose": fields.get("purpose", ""),
                        "tools": tools, "excluded": excluded, "skills": preload, "body": body, "where": where}
    clash = set(skills) & set(commands)
    if clash:
        raise SourceError("a skill and a command share a name: %s" % ", ".join(sorted(clash)))
    if not skills or not agents or not commands:
        raise SourceError("method/ must hold agents, skills and commands")
    return skills, agents, commands


# --------------------------------------------------------------------------------------------------
# Rendering. Every function returns the file text.

def marker(where, stamp):
    return "%s; source: %s; %s; do not edit, re-run the installer" % (MARKER_ID, where, stamp)


def q(value):
    """A YAML double-quoted scalar (JSON string syntax is a subset YAML accepts)."""
    return json.dumps(value, ensure_ascii=False)


def skill_md(name, description, purpose, body, where, stamp):
    if len(description) > DESCRIPTION_MAX:
        raise SourceError("%s: description is %d characters; the limit is %d" % (where, len(description), DESCRIPTION_MAX))
    head = ["---", "# " + marker(where, stamp), "name: " + q(name), "description: " + q(description)]
    if purpose:
        head += ["metadata:", "  purpose: " + q(purpose)]
    return "\n".join(head + ["---"]) + "\n" + body


def command_preface(name, invoke):
    return ("> **Owner-typed command `%s`.** Run it only when the owner invokes it by name. Its arguments are the "
            "text he typed after the name; where this text says `$ARGUMENTS`, read that text.\n\n" % invoke)


def claude_command(c, name, stamp):
    head = ["---", "# " + marker(c["where"], stamp), "description: " + q(c["description"])]
    if c["hint"]:
        head.append("argument-hint: " + q(c["hint"]))
    return "\n".join(head + ["---"]) + "\n" + c["body"]


def command_as_skill(c, name, invoke, stamp):
    description = "Owner-typed command %s; run it only when the owner invokes it. %s" % (invoke, c["description"])
    return skill_md(name, description, c["purpose"], "\n" + command_preface(name, invoke) + c["body"].lstrip("\n"),
                    c["where"], stamp)


def codex_policy(where, stamp):
    return "# %s\npolicy:\n  allow_implicit_invocation: false\n" % marker(where, stamp)


def claude_agent(a, name, stamp):
    head = ["---", "# " + marker(a["where"], stamp), "name: " + name, "description: " + q(a["description"])]
    head.append("tools: " + (", ".join(a["tools"]) if a["tools"] else "[]"))
    if a["excluded"]:
        head.append("disallowedTools: " + ", ".join(a["excluded"]))
    if a["skills"]:
        head.append("skills:")
        head += ["  - " + s for s in a["skills"]]
    return "\n".join(head + ["---"]) + "\n" + a["body"]


def codex_role(name):
    return name.replace("-", "_")


def codex_agent(a, name, stamp):
    tools = ", ".join(a["tools"]) if a["tools"] else "none"
    preload = ", ".join("$" + s for s in a["skills"]) if a["skills"] else "none"
    read_only = not (set(a["tools"]) & WRITING_TOOLS)
    excluded = (" Excluded tools, even within a granted server: %s." % ", ".join(a["excluded"])) if a["excluded"] else ""
    instructions = (
        "You are the `%s` agent of the owner's working method (source: %s).\n\n"
        "Preloaded skills: %s. In Claude Code and Kiro these are loaded into your context before you start. "
        "A Codex custom agent has no preload field, so load each of them by name before you act and follow it.\n\n"
        "Allowed tools for this agent: %s.%s A Codex custom agent carries no tool list (ADR-0027): here this "
        "limit is an instruction, not a control. Do not use a tool outside it.%s\n\n---\n"
        % (name, a["where"], preload, tools, excluded,
           " This agent also runs in a read-only sandbox, the one native narrowing Codex offers." if read_only else "")
        + a["body"])
    lines = ["# " + marker(a["where"], stamp),
             "name = " + json.dumps(codex_role(name), ensure_ascii=False),
             "description = " + json.dumps(a["description"], ensure_ascii=False)]
    if read_only:
        lines.append('sandbox_mode = "read-only"')
    lines.append("developer_instructions = " + json.dumps(instructions, ensure_ascii=False))
    text = "\n".join(lines) + "\n"
    try:
        import tomllib  # Python 3.11+
    except ImportError:
        tomllib = None
    if tomllib is not None:
        parsed = tomllib.loads(text)
        if parsed["developer_instructions"] != instructions or parsed["name"] != codex_role(name):
            raise SourceError("%s: the Codex TOML serialisation changed the text" % a["where"])
    return text


def kiro_tools(tools):
    out = []
    for t in tools:
        tag = "@" + t[len("mcp__"):] if t.startswith("mcp__") else KIRO_TOOLS[t]
        if tag not in out:
            out.append(tag)
    return out


def kiro_agent(a, name, stamp, kiro_skills):
    tools = kiro_tools(a["tools"])
    doc = {
        "name": name,
        "description": a["description"],
        "prompt": "<!-- %s -->\n\n%s" % (marker(a["where"], stamp), a["body"].lstrip("\n")),
        "tools": tools,
        "allowedTools": list(tools),
        "resources": [(kiro_skills / s / "SKILL.md").as_uri() for s in a["skills"]],
    }
    if a["excluded"]:
        # mcp__<server>__<tool> -> @<server>/<tool>; documented for Kiro IDE 1.x and CLI V3.
        doc["excludedTools"] = ["@%s/%s" % re.fullmatch(r"mcp__([A-Za-z0-9_-]+?)__([A-Za-z0-9_-]+)", t).groups()
                                for t in a["excluded"]]
    return json.dumps(doc, ensure_ascii=False, indent=2) + "\n"


# --------------------------------------------------------------------------------------------------
# Targets.

HOME_OVERRIDE = None  # --home=DIR (install.ps1 passes the profile directory, so HOME is never read there)


def homes():
    home = Path(HOME_OVERRIDE or os.environ.get("HOME") or Path.home()).absolute()
    codex = Path(os.environ.get("CODEX_HOME") or home / ".codex").absolute()
    return {"claude": home / ".claude", "codex": codex, "agents": home / ".agents", "kiro": home / ".kiro"}


def targets(skills, agents, commands, stamp):
    """[(path, text, format)] for every file the method renders."""
    h = homes()
    kiro_skills = h["kiro"] / "skills"
    out = []
    for name, s in skills.items():
        text = skill_md(name, s["description"], s["purpose"], s["body"], s["where"], stamp)
        out.append((h["claude"] / "skills" / name / "SKILL.md", text, "md"))
        out.append((h["agents"] / "skills" / name / "SKILL.md", text, "md"))
        out.append((kiro_skills / name / "SKILL.md", text, "md"))
    for name, c in commands.items():
        out.append((h["claude"] / "commands" / (name + ".md"), claude_command(c, name, stamp), "md"))
        out.append((h["agents"] / "skills" / name / "SKILL.md", command_as_skill(c, name, "$" + name, stamp), "md"))
        out.append((h["agents"] / "skills" / name / "agents" / "openai.yaml", codex_policy(c["where"], stamp), "md"))
        out.append((kiro_skills / name / "SKILL.md", command_as_skill(c, name, "/" + name, stamp), "md"))
    for name, a in agents.items():
        out.append((h["claude"] / "agents" / (name + ".md"), claude_agent(a, name, stamp), "md"))
        out.append((h["codex"] / "agents" / (name + ".toml"), codex_agent(a, name, stamp), "md"))
        out.append((h["kiro"] / "agents" / (name + ".json"), kiro_agent(a, name, stamp, kiro_skills), "json"))
    return out


def candidate_files():
    """Every file in the carriers' directories that could be one of ours (for STALE and uninstall)."""
    h = homes()
    patterns = [(h["claude"] / "agents", "*.md"), (h["claude"] / "commands", "*.md"),
                (h["claude"] / "skills", "*/SKILL.md"), (h["agents"] / "skills", "*/SKILL.md"),
                (h["agents"] / "skills", "*/agents/openai.yaml"), (h["codex"] / "agents", "*.toml"),
                (h["kiro"] / "agents", "*.json"), (h["kiro"] / "skills", "*/SKILL.md")]
    found = []
    for base, pattern in patterns:
        if base.is_dir():
            found += [p for p in sorted(base.glob(pattern)) if p.is_file() and not p.is_symlink()]
    return found


# --------------------------------------------------------------------------------------------------
# Managed detection and stamp comparison.

def marker_line(path, fmt=None):
    """The first managed-by line of a file, or None. For JSON, the first line of its prompt."""
    try:
        text = path.read_text(encoding="utf-8")
    except (OSError, UnicodeError):
        return None
    if fmt == "json" or (fmt is None and path.suffix == ".json"):
        try:
            prompt = json.loads(text).get("prompt", "")
        except (ValueError, AttributeError):
            return None
        first = prompt.split("\n", 1)[0] if isinstance(prompt, str) else ""
        return first if MARKER_ID in first else None
    for line in text.split("\n")[:5]:
        if MARKER_ID in line:
            return line
    return None


def ours(path, fmt=None):
    line = marker_line(path, fmt)
    return line is not None and SOURCE_TAG in line


def unstamp(text):
    return "\n".join(re.sub(r"; (version|release|commit): [^;\"\\]*", "", line) if MARKER_ID in line else line
                     for line in text.split("\n"))


def stamp_of(line):
    m = re.search(r"; (release: [^;\"\\]*; commit: [^;\"\\]*);", line or "")
    return m.group(1) if m else "none"


# --------------------------------------------------------------------------------------------------
# Modes.

class Run:
    def __init__(self):
        self.status = 0

    def raise_to(self, code):
        self.status = max(self.status, code)


def write_atomic(path, text):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".new.%d" % os.getpid())
    tmp.write_text(text, encoding="utf-8")
    os.replace(tmp, path)


def process(run, mode, path, text, fmt, stamp):
    exists = path.exists() or path.is_symlink()
    if exists and (path.is_symlink() or not ours(path, fmt)):
        print("REFUSE  %s: exists and is NOT managed by this project's method step; move it aside or merge it "
              "by hand" % path, file=sys.stderr)
        run.raise_to(3)
        return
    restamp = False
    if exists:
        current = path.read_text(encoding="utf-8")
        if current == text:
            print("OK      %s (%s)" % (path, stamp))
            return
        if unstamp(current) == unstamp(text):
            restamp = True
    if mode == "check":
        if restamp:
            print("STAMP   %s: content matches, but it carries (%s) and the source is (%s)"
                  % (path, stamp_of(marker_line(path, fmt)), stamp))
        elif exists:
            print("DRIFT   %s (%s)" % (path, stamp_of(marker_line(path, fmt))))
        else:
            print("MISSING %s" % path)
        run.raise_to(1)
    elif mode == "dry-run":
        print("WOULD WRITE %s (%d bytes, from %s)" % (path, len(text.encode("utf-8")),
                                                       re.search(r"source: (\S+);", text).group(1)))
    else:
        write_atomic(path, text)
        print("%s %s (%s)" % ("RESTAMPED" if restamp else "WROTE  ", path, stamp))


def prune(path, stop):
    """Remove empty directories from path up to, not including, stop."""
    d = path.parent
    while d != stop and stop in d.parents:
        try:
            d.rmdir()
        except OSError:
            return
        d = d.parent


def remove(path):
    path.unlink()
    for stop in homes().values():
        if stop in path.parents:
            prune(path, stop)
            return


def main(argv):
    mode, stamp, source = None, None, DEFAULT_SOURCE
    for arg in argv:
        if arg.startswith("--mode="):
            mode = arg[len("--mode="):]
        elif arg.startswith("--stamp="):
            stamp = arg[len("--stamp="):]
        elif arg.startswith("--source="):
            source = Path(arg[len("--source="):])
        elif arg.startswith("--home="):
            global HOME_OVERRIDE
            HOME_OVERRIDE = arg[len("--home="):]
        else:
            print("method_render: unknown argument %s" % arg, file=sys.stderr)
            return 2
    if mode not in ("install", "check", "dry-run", "uninstall"):
        print("method_render: --mode must be install, check, dry-run or uninstall", file=sys.stderr)
        return 2
    run = Run()
    if mode == "uninstall":
        for path in candidate_files():
            if ours(path):
                remove(path)
                print("REMOVED %s" % path)
        return run.status
    if not stamp or not re.fullmatch(r"release: [^;\"\\]+; commit: [^;\"\\\s]+", stamp):
        print("method_render: --stamp must be 'release: R; commit: C' as install.sh derives it", file=sys.stderr)
        return 2
    try:
        skills, agents, commands = load(source)
        wanted = targets(skills, agents, commands, stamp)
    except SourceError as error:
        print("REFUSE  the working method: %s; nothing of it was written" % error, file=sys.stderr)
        return 2
    for path, text, fmt in wanted:
        process(run, mode, path, text, fmt, stamp)
    keep = {p for p, _, _ in wanted}
    for path in candidate_files():
        if path in keep or not ours(path):
            continue
        if mode == "check":
            print("STALE   %s: rendered by an earlier method; install removes it" % path)
            run.raise_to(1)
        elif mode == "dry-run":
            print("WOULD REMOVE %s (no longer in method/)" % path)
        else:
            remove(path)
            print("REMOVED %s (no longer in method/)" % path)
    print("METHOD  %d agents, %d skills, %d commands from method/ into Claude Code (agents, skills, commands), "
          "Codex (custom agents without a tool list, skills; commands as skills with implicit invocation off) "
          "and Kiro (agents, skills; commands as skills)" % (len(agents), len(skills), len(commands)))
    return run.status


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
