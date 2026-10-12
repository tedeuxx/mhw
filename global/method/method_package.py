#!/usr/bin/env python3
"""Package the working method (method/) as the Claude Code plugin tadeumendonca-skills (Issue #62, ADR-0032).

    method_package.py build --out=DIR --version=X.Y.Z --stamp="release: R; commit: C" [--source=DIR]
    method_package.py check --package=DIR
    method_package.py sync  --package=DIR --target=DIR

build   renders method/ into a new or empty DIR: .claude-plugin/plugin.json (name tadeumendonca-skills,
        version X.Y.Z), agents/<n>.md, skills/<n>/SKILL.md, commands/<n>.md, and the list of every
        generated file, .mhw-generated. It reuses method_render.py's parser and Claude Code renderers, so
        the plugin and the user-level install carry the same text. Every file carries the provenance stamp
        (ADR-0029) and a generated/do-not-edit marker: in the front matter of each Markdown file, in the
        description of plugin.json (JSON has no comment), and on the first line of .mhw-generated.
        No hooks, no settings, no MCP servers, no deny floor: the package carries no protection.
check   the structural load test of a built package, run before anything is pushed: the list matches
        the tree, plugin.json has the fields Claude Code reads and nothing that loads hooks or servers,
        every agent, skill and command has the front matter Claude Code needs, every file carries the
        marker and one stamp.
sync    replaces the generated paths of a checkout of the plugin repository with a built package:
        plugin.json, agents/<n>.md and commands/<n>.md for each generated name, and skills/<n>/ whole.
        Files a previous sync generated (its .mhw-generated) and this package no longer carries are
        removed, but only when they still carry the marker. Every other file is left untouched and named
        (LEFT), and a hooks/hooks.json in the checkout is named too (NOTE): Claude Code loads it, and the
        mirror never writes or removes hooks; their removal is the cutover's (#63).

Output words: WROTE, REMOVED, LEFT, NOTE, REFUSE, OK, FAIL.
Exit codes: 0 ok; 1 the check failed; 2 usage, invalid source or an unsafe list.
Standard library only, Python 3.9+.
"""

import json
import re
import shutil
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import method_render as mr  # noqa: E402

PLUGIN_NAME = "tadeumendonca-skills"
SOURCE_REPO = "tedeuxx/mhw"
TAIL = "generated, do not edit: edit method/ in %s, the next release replaces this file" % SOURCE_REPO
LIST = ".mhw-generated"
MANIFEST = ".claude-plugin/plugin.json"
VERSION_RE = re.compile(r"(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)")
STAMP_RE = re.compile(r"release: [^;\"\\]+; commit: [^;\"\\\s]+")
# Paths a list may name. Anything else in a list (absolute, "..", hooks, settings) is refused.
SAFE = re.compile(r"(\.claude-plugin/plugin\.json|\.mhw-generated|agents/[a-z0-9-]+\.md|commands/[a-z0-9-]+\.md"
                  r"|skills/[a-z0-9-]+/SKILL\.md)")
# What the package must never carry: hooks, settings, MCP servers, LSP servers, output styles.
FORBIDDEN_KEYS = ("hooks", "mcpServers", "lspServers", "outputStyles", "settings")


class PackageError(Exception):
    pass


# --------------------------------------------------------------------------------------------------
# build

def manifest_text(version, stamp):
    doc = {
        "name": PLUGIN_NAME,
        "version": version,
        "description": ("The owner's working method: agents, skills and commands. Generated from method/ in %s "
                        "(%s; %s; %s). Carries no hooks and no protections." % (SOURCE_REPO, mr.MARKER_ID, stamp, TAIL)),
        "author": {"name": "Luiz Tadeu Mendonça"},
        "repository": "https://github.com/tedeuxx/tadeumendonca-skills",
        "license": "MIT",
    }
    return json.dumps(doc, ensure_ascii=False, indent=2) + "\n"


def package_files(source, version, stamp):
    """{relative path: text} for every file of the package, the list included."""
    skills, agents, commands = mr.load(source)
    files = {MANIFEST: manifest_text(version, stamp)}
    for name, s in skills.items():
        files["skills/%s/SKILL.md" % name] = mr.skill_md(name, s["description"], s["purpose"], s["body"], s["where"],
                                                         stamp, TAIL)
    for name, c in commands.items():
        files["commands/%s.md" % name] = mr.claude_command(c, name, stamp, TAIL)
    for name, a in agents.items():
        files["agents/%s.md" % name] = mr.claude_agent(a, name, stamp, TAIL)
    listed = sorted(files) + [LIST]
    files[LIST] = "# %s; source: method/; %s; %s\n%s\n" % (mr.MARKER_ID, stamp, TAIL, "\n".join(listed))
    return files


def build(out, source, version, stamp):
    if not VERSION_RE.fullmatch(version or ""):
        raise PackageError("--version must be numeric X.Y.Z (ADR-0002), got %r" % version)
    if not stamp or not STAMP_RE.fullmatch(stamp):
        raise PackageError("--stamp must be 'release: R; commit: C' (ADR-0029)")
    release = stamp.split(";", 1)[0][len("release: "):]
    if re.fullmatch(r"v[0-9]+\.[0-9]+\.[0-9]+", release) and release != "v" + version:
        raise PackageError("the stamp names release %s but --version is %s" % (release, version))
    if out.exists() and (not out.is_dir() or any(out.iterdir())):
        raise PackageError("%s exists and is not an empty directory; nothing was written" % out)
    try:
        files = package_files(source, version, stamp)
    except mr.SourceError as error:
        raise PackageError("the working method: %s" % error)
    for rel, text in sorted(files.items()):
        path = out / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8")
    print("OK      packaged %s %s into %s: %d agents, %d skills, %d commands (%s)" % (
        PLUGIN_NAME, version, out, sum(1 for r in files if r.startswith("agents/")),
        sum(1 for r in files if r.startswith("skills/")), sum(1 for r in files if r.startswith("commands/")), stamp))


# --------------------------------------------------------------------------------------------------
# check

def read_list(root, required):
    path = root / LIST
    if not path.is_file() or path.is_symlink():
        if required:
            raise PackageError("%s has no %s" % (root, LIST))
        return None
    lines = path.read_text(encoding="utf-8").split("\n")
    if not lines or mr.MARKER_ID not in lines[0]:
        raise PackageError("%s/%s does not open with the generated marker" % (root, LIST))
    names = [line for line in lines[1:] if line.strip()]
    for rel in names:
        if not SAFE.fullmatch(rel):
            raise PackageError("%s/%s names a path outside the generated set: %r" % (root, LIST, rel))
    return names


def front_matter(text):
    """Front matter keys and the comment lines, without parsing values beyond what Claude Code needs."""
    lines = text.split("\n")
    if not lines or lines[0] != "---" or "---" not in lines[1:]:
        return None, []
    end = lines.index("---", 1)
    keys, comments = {}, []
    for line in lines[1:end]:
        if line.startswith("#"):
            comments.append(line)
            continue
        m = re.fullmatch(r"([A-Za-z][A-Za-z-]*):\s*(.*)", line)
        if m:
            value = m.group(2).strip()
            if value.startswith('"'):
                try:
                    value = json.loads(value)
                except ValueError:
                    value = ""  # reported as a missing value by the caller, not as a traceback
            keys[m.group(1)] = value
    return keys, comments


def check(package):
    problems = []
    try:
        names = read_list(package, required=True)
    except PackageError as error:
        print("FAIL    %s" % error)
        return 1
    tree = sorted(str(p.relative_to(package)) for p in package.rglob("*") if p.is_file() or p.is_symlink())
    if sorted(names) != tree:
        problems.append("%s does not match the tree: listed only %s; present only %s" % (
            LIST, sorted(set(names) - set(tree)), sorted(set(tree) - set(names))))
    for forbidden in ("hooks", "settings.json", ".mcp.json", ".lsp.json"):
        if (package / forbidden).exists():
            problems.append("the package carries %s; it must carry no hooks and no protections" % forbidden)
    stamps = set()
    try:
        doc = json.loads((package / MANIFEST).read_text(encoding="utf-8"))
    except (OSError, ValueError) as error:
        doc = {}
        problems.append("%s does not load as JSON: %s" % (MANIFEST, error))
    if doc.get("name") != PLUGIN_NAME:
        problems.append("%s: name is %r, not %s" % (MANIFEST, doc.get("name"), PLUGIN_NAME))
    if not VERSION_RE.fullmatch(str(doc.get("version", ""))):
        problems.append("%s: version %r is not numeric X.Y.Z" % (MANIFEST, doc.get("version")))
    for key in FORBIDDEN_KEYS:
        if key in doc:
            problems.append("%s carries %r; the package carries no hooks and no protections" % (MANIFEST, key))
    description = str(doc.get("description", ""))
    if mr.MARKER_ID not in description or TAIL not in description:
        problems.append("%s: the description does not carry the generated marker" % MANIFEST)
    stamps.update(STAMP_RE.findall(description))
    for rel in names:
        if rel in (MANIFEST, LIST) or not (package / rel).is_file():
            continue
        text = (package / rel).read_text(encoding="utf-8")
        keys, comments = front_matter(text)
        if keys is None:
            problems.append("%s: no front matter" % rel)
            continue
        if not any(mr.MARKER_ID in c and TAIL in c for c in comments):
            problems.append("%s: no generated marker in the front matter" % rel)
        stamps.update(s for c in comments for s in STAMP_RE.findall(c))
        if not str(keys.get("description", "")).strip():
            problems.append("%s: no description" % rel)
        stem = rel.split("/")[-2] if rel.startswith("skills/") else Path(rel).stem
        if rel.startswith(("skills/", "agents/")) and keys.get("name") != stem:
            problems.append("%s: name %r does not equal %s" % (rel, keys.get("name"), stem))
        if rel.startswith("agents/") and "tools" not in keys:
            # Absent, Claude Code gives the agent every tool of its parent.
            problems.append("%s: no tools key" % rel)
    stamps.update(STAMP_RE.findall((package / LIST).read_text(encoding="utf-8").split("\n", 1)[0]))
    if len(stamps) != 1:
        problems.append("the package carries %d stamps, not one: %s" % (len(stamps), sorted(stamps)))
    for problem in problems:
        print("FAIL    %s" % problem)
    if problems:
        return 1
    print("OK      %s %s: %d files, one stamp (%s), no hooks, no protections" % (
        PLUGIN_NAME, doc.get("version"), len(names), next(iter(stamps))))
    return 0


# --------------------------------------------------------------------------------------------------
# sync

def remove_file(target, rel):
    path = target / rel
    path.unlink()
    d = path.parent
    while d != target and target in d.parents:
        try:
            d.rmdir()
        except OSError:
            break
        d = d.parent


def sync(package, target):
    if not target.is_dir():
        raise PackageError("target %s is not a directory" % target)
    new = read_list(package, required=True)
    old = read_list(target, required=False) or []
    for rel in new:
        if not (package / rel).is_file():
            raise PackageError("the package lists %s but does not carry it" % rel)
    skills_dirs = sorted({rel.split("/")[1] for rel in new if rel.startswith("skills/")})
    # Remove first: what the previous sync generated and this package no longer carries.
    for rel in sorted(set(old) - set(new)):
        path = target / rel
        if not path.is_file() or path.is_symlink():
            continue
        if mr.MARKER_ID not in path.read_text(encoding="utf-8", errors="replace"):
            print("LEFT    %s: listed by the previous sync but no longer carries the marker" % rel)
            continue
        remove_file(target, rel)
        print("REMOVED %s (no longer in method/)" % rel)
    # A skill is replaced whole: a file the plugin's earlier copy kept beside SKILL.md would be stale.
    for name in skills_dirs:
        d = target / "skills" / name
        if d.is_symlink() or d.is_file():
            d.unlink()
        elif d.is_dir():
            shutil.rmtree(d)
    for rel in new:
        dest = target / rel
        if dest.is_symlink() or dest.is_dir():
            raise PackageError("%s in the target is a link or a directory; nothing more was written" % rel)
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(package / rel, dest)
        print("WROTE   %s" % rel)
    generated = set(new)
    for base in ("agents", "commands", "skills"):
        root = target / base
        if root.is_dir():
            for path in sorted(p for p in root.rglob("*") if p.is_file()):
                rel = str(path.relative_to(target))
                if rel not in generated:
                    print("LEFT    %s (not generated; untouched)" % rel)
    if (target / "hooks" / "hooks.json").exists():
        print("NOTE    hooks/hooks.json is in the target and Claude Code loads it; the mirror never writes or "
              "removes hooks (their removal is the cutover's, #63)")
    return 0


# --------------------------------------------------------------------------------------------------

def main(argv):
    if not argv or argv[0] not in ("build", "check", "sync"):
        print(__doc__.split("\n\n")[1], file=sys.stderr)
        return 2
    command, opts = argv[0], {}
    for arg in argv[1:]:
        m = re.fullmatch(r"--(out|version|stamp|source|package|target)=(.*)", arg, re.S)
        if not m:
            print("method_package: unknown argument %s" % arg, file=sys.stderr)
            return 2
        opts[m.group(1)] = m.group(2)
    try:
        if command == "build":
            if "out" not in opts:
                raise PackageError("build needs --out=DIR")
            build(Path(opts["out"]), Path(opts.get("source", mr.DEFAULT_SOURCE)), opts.get("version"),
                  opts.get("stamp"))
            return 0
        if "package" not in opts:
            raise PackageError("%s needs --package=DIR" % command)
        if command == "check":
            return check(Path(opts["package"]))
        if "target" not in opts:
            raise PackageError("sync needs --target=DIR")
        if check(Path(opts["package"])) != 0:
            raise PackageError("the package failed its check; nothing was synced")
        return sync(Path(opts["package"]), Path(opts["target"]))
    except PackageError as error:
        print("REFUSE  %s" % error, file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
