#!/usr/bin/env python3
"""mhw scan, the outbound scan (ADR-0035, decision 7): what a push or a pull request is about to send,
checked with the paste filter's own detection engine (global/clipboard/clipboard_guard.py, ADR-0011).
There is no second detector: find_spans() is called as it is, with the same categories.

    mhw scan                    what this branch would send beyond its upstream: the files changed
                                since the merge base of HEAD and @{upstream}, as they are in the working
                                tree (committed and uncommitted changes to tracked files; deleted files
                                are skipped), AND the lines added by every commit between that merge base
                                and HEAD, AND each of those commits' messages. Content added in one
                                commit and removed in a later one is therefore still reported.
    mhw scan --base=REF         the same, against REF instead of @{upstream} (CI passes the PR's base)
    mhw scan PATH...            exactly these files, provided git lists them under the current directory
                                (tracked, or untracked and not ignored). A PATH is only used to look a
                                file up in that list; the file opened is always git's own entry. A PATH
                                outside the current directory, a directory, a name that differs only in
                                case from a listed file, or a file git does not list (missing, ignored)
                                is SKIPPED, with the reason. Every mode needs a git repository.

One line per finding, never the text:
    path:line: category, N chars                    in the working tree
    <short-sha>:path:line: category, N chars        in a line that commit added
    <short-sha>:message: category, N chars          in that commit's message
The matched text, an excerpt or a hash of it is NEVER printed, on stdout or stderr (ADR-0005). A file
that is not scanned (binary, too large, unreadable, outside the directory) is named with the reason, so
nothing is skipped silently. A merge commit's message is scanned but not its own diff; the commits it
brings in are scanned one by one. In a commit message only, the vendor's no-reply address inside the
required attribution trailer ("Co-Authored-By: <name> <that address>", the key in any case) is not
reported: it is mandated, not a finding to clean. The name is scanned; only the vendor no-reply address
in that trailer is exempt. That address anywhere else is reported.

It informs and never blocks: the exit code is 0 with or without findings. Exit 2 means the scan itself
could not run (not in a git repository, no upstream and no --base, a --base that is not a commit, an
unknown argument),
which is not a finding.

Every category is reported, whatever block_categories says: that setting decides what blocks a prompt,
and this command blocks nothing. Employer and client terms are matched only where the owner's hashed
term list and its salt are readable without a prompt (SaltStore(interactive=False)). Whenever they are
not (no term list, an empty or unreadable one, or no salt), a NOTE line says that category was NOT
checked. In CI there is no term list, so the NOTE is printed there every time.

Standard library only, Python 3.9+. Reads files and git objects; writes nothing.
"""
import os
from pathlib import Path
import re
import subprocess
import sys

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE / "clipboard"))
import clipboard_guard as core  # noqa: E402

NO_REPOSITORY = "not inside a git repository; mhw scan needs one, in every mode"

OBJECT_ID = re.compile(r"[0-9a-f]{40}|[0-9a-f]{64}")
HUNK = re.compile(r"@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@")
# The attribution trailer the agent's own instructions require on every commit. In a commit message
# only, this exact address in it is exempt; the key and the name stay in the scanned text (ADR-0035,
# slice F).
ATTRIBUTION_ADDRESS = "noreply" + "@" + "anthropic.com"
ATTRIBUTION_TRAILER = re.compile(r"^(?i:co-authored-by):([^<>\n]*)<%s>[ \t]*$"
                                 % re.escape(ATTRIBUTION_ADDRESS), re.MULTILINE)


def installed_config():
    """The paste filter's installed settings (global/install.sh writes them there), or None."""
    path = os.path.join(core.data_dir(), "clipboard.conf")
    return path if os.path.isfile(path) else None


def _git(args):
    r = subprocess.run(["git"] + args, capture_output=True)
    return r.returncode, r.stdout.decode("utf-8", errors="replace")


def valid_base(base):
    """A --base value is a ref name, never an option: refused when empty or starting with '-'."""
    return bool(base) and not base.startswith("-")


def outbound(base=None):
    """(root, paths, commits, error). paths: the changed files, relative to the current directory.
    commits: [(short sha, full sha, is_merge)] after the merge base up to HEAD, oldest first."""
    code, top = _git(["rev-parse", "--show-toplevel"])
    if code:
        return None, None, None, NO_REPOSITORY
    if base is not None and not valid_base(base):
        return None, None, None, "--base takes a git ref"
    # Resolve the ref to a commit id first, after --end-of-options, so nothing the caller passes can
    # reach git as an option. Only the verified id goes on to merge-base, again after --end-of-options.
    code, ref = _git(["rev-parse", "--verify", "--quiet", "--end-of-options",
                      (base or "@{upstream}") + "^{commit}"])
    ref = ref.strip()
    if code or not OBJECT_ID.fullmatch(ref):
        if base:
            return None, None, None, "--base=%s is not a commit" % base
        return None, None, None, "this branch has no upstream; pass --base=REF (for example --base=origin/main)"
    code, mb = _git(["merge-base", "--end-of-options", "HEAD", ref])
    mb = mb.strip()
    if code or not OBJECT_ID.fullmatch(mb):
        return None, None, None, "cannot find a merge base of HEAD and %s" % (base or "its upstream")
    code, out = _git(["diff", "--name-only", "-z", "--diff-filter=d", mb])
    if code:
        return None, None, None, "git diff failed"
    root = top.strip()
    paths = [os.path.relpath(os.path.join(root, p)) for p in out.split("\0") if p]
    code, log = _git(["log", "--reverse", "--format=%H %h %P", mb + "..HEAD"])
    if code:
        return None, None, None, "git log failed"
    commits = []
    for line in log.splitlines():
        parts = line.split()
        if len(parts) >= 2 and OBJECT_ID.fullmatch(parts[0]):
            commits.append((parts[1], parts[0], len(parts) > 3))
    return root, paths, commits, None


def _patch_path(name):
    """The path from a '+++ b/<path>' line; git ends a name holding a space with a tab, and quotes an
    unusual name in double quotes. None for /dev/null."""
    name = name.rstrip("\t")
    if len(name) > 1 and name.startswith('"') and name.endswith('"'):
        name = name[1:-1]
    return name[2:] if name.startswith("b/") else None


def _header_path(line):
    """The new-side path from a 'diff --git a/<path> b/<path>' line (a binary file has no '+++' line)."""
    head = line[len("diff --git "):]
    if head.endswith('"') and ' "b/' in head:
        return head.rsplit(' "b/', 1)[1][:-1]
    return head.rsplit(" b/", 1)[1] if " b/" in head else None


def added_blocks(patch):
    """[(path, first line, text or None)] from a -U0 patch: each hunk's added lines as one block, so a
    finding that spans lines (a PEM block) is still one finding. A binary file is one entry, text None."""
    blocks, path, current = [], None, None
    for line in patch.split("\n"):
        if line.startswith("diff --git "):
            current = None
            path = _header_path(line)
        elif current is None and line.startswith("+++ "):
            path = _patch_path(line[4:])          # None for /dev/null (a deleted file)
        elif current is None and line.startswith("Binary files ") and path:
            blocks.append((path, 0, None))
        elif line.startswith("@@"):
            m = HUNK.match(line)
            current = [path, int(m.group(1)), []] if (m and path) else None
            if current:
                blocks.append(current)
        elif current is not None and line.startswith("+"):
            current[2].append(line[1:])
    return [b if isinstance(b, tuple) else (b[0], b[1], "\n".join(b[2]) + "\n") for b in blocks]


def scan_text(text, terms=frozenset(), salt=None):
    """[(line, category, length)] for every finding in text, in order. Never the matched text."""
    found = []
    for start, end, cat in core.find_spans(text, terms, salt):
        found.append((text.count("\n", 0, start) + 1, cat, end - start))
    return sorted(found, key=lambda f: (f[0], core.CATEGORY_ORDER.index(f[1]), f[2]))


def term_detector(conf, out, salts=None):
    """(terms, salt), with a NOTE whenever employer-client-term cannot be checked. Never silent."""
    terms = core.read_terms(conf["terms_file"])
    if not terms:
        out.write("NOTE    no employer and client term list could be read (absent, empty or unreadable); "
                  "employer-client-term was NOT checked\n")
        return terms, None
    salt = (salts or core.SaltStore(conf, interactive=False)).get()
    if not salt:
        out.write("NOTE    the term list's salt could not be read without a prompt; employer-client-term "
                  "was NOT checked\n")
    return terms, salt


def listed_files():
    """(files, error). files: every path git lists under the current directory, tracked or untracked and
    not ignored, relative to it, exactly as git printed it."""
    code, out = _git(["ls-files", "-z", "--cached", "--others", "--exclude-standard"])
    if code:
        return None, NO_REPOSITORY
    return sorted(set(p for p in out.split("\0") if p)), None


def _lookup_key(arg, cwd):
    """The normalised path, relative to the current directory, that arg names, or None when it names
    something outside it. The last component is not resolved, so a symlink is looked up as itself, as git
    lists it. Only ever compared with git's entries; never opened."""
    full = os.path.normpath(os.path.join(cwd, arg))
    parent, name = os.path.split(full)
    try:
        rel = os.path.relpath(os.path.join(os.path.realpath(parent), name), os.path.realpath(cwd))
    except ValueError:                # Windows: a different drive is never under the current directory
        return None
    if rel == os.pardir or rel.startswith(os.pardir + os.sep) or os.path.isabs(rel):
        return None
    return rel


def explicit_targets(args, files):
    """[(label, path or None, skip reason or None)] for the PATH arguments, in order. path is always an
    entry of files (git's output), never a string built from an argument (SonarCloud S8707)."""
    cwd = os.getcwd()
    by_key = {os.path.normpath(f): f for f in files}
    dirs = set()
    for key in by_key:
        parent = os.path.dirname(key)
        while parent and parent not in dirs:
            dirs.add(parent)
            parent = os.path.dirname(parent)
    by_case = {}
    for key in by_key:
        by_case.setdefault(key.casefold(), key)
    targets = []
    for arg in args:
        key = _lookup_key(arg, cwd)
        if key is None:
            targets.append((arg, None, "outside the working directory, not scanned"))
        elif key in by_key:
            targets.append((arg, by_key[key], None))
        elif key == os.curdir or key in dirs:
            targets.append((arg, None, "a directory, name its files; not scanned"))
        elif key.casefold() in by_case:
            targets.append((arg, None, "differs only in case from %s, which git lists; name it as git does, "
                                       "not scanned" % by_case[key.casefold()]))
        else:
            targets.append((arg, None, "not a file git lists (missing or ignored), not scanned"))
    return targets


def scan(targets, conf, out=None, salts=None, root=None, commits=None):
    """Print the findings for targets (and, when given, commits) and a summary. Returns the number of
    findings. targets: [(label, path or None, skip reason or None)]; every path comes from git's own
    output and is relative to the current directory. A path must still resolve under root (default: the
    current directory), so a listed symlink pointing elsewhere is not followed."""
    out = out or sys.stdout
    terms, salt = term_detector(conf, out, salts)
    limit = int(conf["max_bytes"])
    cwd = os.getcwd()
    root = os.path.realpath(root or cwd)
    total, files_with, scanned = 0, 0, 0
    for label, path, reason in targets:
        if reason:
            out.write("SKIPPED %s: %s\n" % (label, reason))
            continue
        # path is git's entry, so this guard only catches a listed symlink resolving out of root.
        real = os.path.realpath(os.path.join(cwd, path))
        try:
            contained = os.path.commonpath([root, real]) == root
        except ValueError:            # Windows: a different drive is never inside root
            contained = False
        if not contained:
            out.write("SKIPPED %s: outside %s, not scanned\n" % (label, "the repository" if commits is not None
                                                                    else "the working directory"))
            continue
        try:
            if os.path.getsize(real) > limit:
                out.write("SKIPPED %s: over %d bytes, not scanned\n" % (label, limit))
                continue
            with open(real, "rb") as fh:
                raw = fh.read()
        except OSError as exc:
            out.write("SKIPPED %s: unreadable (%s)\n" % (label, type(exc).__name__))
            continue
        if b"\0" in raw:
            out.write("SKIPPED %s: binary, not scanned\n" % label)
            continue
        scanned += 1
        findings = scan_text(raw.decode("utf-8", errors="replace"), terms, salt)
        for line, cat, length in findings:
            out.write("%s:%d: %s, %d chars\n" % (label, line, cat, length))
        total += len(findings)
        files_with += bool(findings)
    summary = "%d of %d scanned file(s)" % (files_with, scanned)
    if commits is not None:
        commits_with = 0
        for short, full, is_merge in commits:
            found = scan_commit(short, full, is_merge, terms, salt, limit, out)
            total += found
            commits_with += bool(found)
        summary += " and %d of %d commit(s)" % (commits_with, len(commits))
    out.write("mhw scan: %d finding(s); %s had one; informs only, never blocks; the matched text is never "
              "shown (ADR-0005)\n" % (total, summary))
    return total


def without_attribution_trailer(message):
    """The message with only the vendor address cut from each required attribution trailer line. The key
    and the name are kept, so the name is scanned, and the line count is kept. Only a commit message
    goes through this; the detection engine is unchanged."""
    return ATTRIBUTION_TRAILER.sub(lambda m: m.group(0)[:m.end(1) - m.start(0)] if m.group(1).strip()
                                   else m.group(0), message)


def scan_commit(short, full, is_merge, terms, salt, limit, out):
    """Findings in one commit's message and, unless it is a merge, in the lines it added."""
    found = 0
    code, message = _git(["log", "-1", "--format=%B", full])
    if code:
        out.write("SKIPPED %s:message: unreadable, not scanned\n" % short)
    else:
        for _line, cat, length in scan_text(without_attribution_trailer(message), terms, salt):
            out.write("%s:message: %s, %d chars\n" % (short, cat, length))
            found += 1
    if is_merge:
        return found
    code, patch = _git(["diff-tree", "-p", "-r", "-U0", "--root", "--no-commit-id", "--no-color",
                        "--no-ext-diff", "--no-textconv", "--no-renames", full])
    if code:
        out.write("SKIPPED %s: diff unreadable, not scanned\n" % short)
        return found
    for path, first, text in added_blocks(patch):
        if text is None:
            out.write("SKIPPED %s:%s: binary, not scanned\n" % (short, path))
            continue
        if len(text.encode("utf-8")) > limit:
            out.write("SKIPPED %s:%s: added lines over %d bytes, not scanned\n" % (short, path, limit))
            continue
        for line, cat, length in scan_text(text, terms, salt):
            out.write("%s:%s:%d: %s, %d chars\n" % (short, path, first + line - 1, cat, length))
            found += 1
    return found


def main(argv, out=None):
    out = out or sys.stdout
    base, paths = None, []
    for arg in argv:
        if arg.startswith("--base="):
            base = arg[len("--base="):]
            if not valid_base(base):
                sys.stderr.write("mhw scan: --base takes a git ref\n")
                return 2
        elif arg.startswith("-"):
            sys.stderr.write("mhw scan: unknown argument %s\n" % arg)
            return 2
        else:
            paths.append(arg)
    if paths and base:
        sys.stderr.write("mhw scan: name files or pass --base, not both\n")
        return 2
    root, commits = None, None
    if paths:
        files, error = listed_files()
        targets = [] if error else explicit_targets(paths, files)
    else:
        root, changed, commits, error = outbound(base)
        targets = [(p, p, None) for p in changed or ()]
    if error:
        sys.stderr.write("mhw scan: %s\n" % error)
        return 2
    try:
        conf = core.load_config(installed_config())
    except Exception as exc:      # an unreadable settings file: the built-in defaults, said visibly
        out.write("NOTE    the paste filter settings could not be read (%s); built-in defaults used\n"
                  % type(exc).__name__)
        conf = core.load_config(None)
    scan(targets, conf, out, root=root, commits=commits)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
