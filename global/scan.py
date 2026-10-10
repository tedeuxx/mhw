#!/usr/bin/env python3
"""mhw scan, the outbound scan (ADR-0035, decision 7): what a push or a pull request is about to send,
checked with the paste filter's own detection engine (global/clipboard/clipboard_guard.py, ADR-0011).
There is no second detector: find_spans() is called as it is, with the same categories.

    mhw scan                    the files changed on this branch since it left its upstream: the merge
                                base of HEAD and @{upstream}, compared with the working tree (committed
                                and uncommitted changes to tracked files; deleted files are skipped)
    mhw scan --base=REF         the same, against REF instead of @{upstream} (CI passes the PR's base)
    mhw scan PATH...            exactly these files, whatever git says

One line per finding: `path:line: category, N chars`. The matched text, an excerpt or a hash of it is
NEVER printed, on stdout or stderr (ADR-0005). A file that is not scanned (binary, too large, unreadable)
is named with the reason, so nothing is skipped silently.

It informs and never blocks: the exit code is 0 with or without findings. Exit 2 means the scan itself
could not run (no git, no upstream and no --base, an unknown argument), which is not a finding.

Every category is reported, whatever block_categories says: that setting decides what blocks a prompt,
and this command blocks nothing. Employer and client terms are matched only where the owner's hashed
term list and its salt are readable without a prompt (SaltStore(interactive=False)); otherwise a NOTE
line says that category was not checked. In CI there is no term list, so that category is never checked.

Standard library only, Python 3.9+. Reads files; writes nothing.
"""
import os
from pathlib import Path
import subprocess
import sys

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE / "clipboard"))
import clipboard_guard as core  # noqa: E402


def installed_config():
    """The paste filter's installed settings (global/install.sh writes them there), or None."""
    path = os.path.join(core.data_dir(), "clipboard.conf")
    return path if os.path.isfile(path) else None


def _git(args):
    r = subprocess.run(["git"] + args, capture_output=True, text=True)
    return r.returncode, r.stdout


def changed_files(base=None):
    """(paths, error). Paths relative to the repository root, made relative to the current directory."""
    ref = base or "@{upstream}"
    code, top = _git(["rev-parse", "--show-toplevel"])
    if code:
        return None, "not inside a git repository; name the files to scan"
    code, mb = _git(["merge-base", "HEAD", ref])
    if code:
        if base:
            return None, "cannot find a merge base of HEAD and %s" % base
        return None, "this branch has no upstream; pass --base=REF (for example --base=origin/main)"
    code, out = _git(["diff", "--name-only", "-z", "--diff-filter=d", mb.strip()])
    if code:
        return None, "git diff failed"
    root = top.strip()
    paths = [os.path.relpath(os.path.join(root, p)) for p in out.split("\0") if p]
    return paths, None


def scan_text(text, terms=frozenset(), salt=None):
    """[(line, category, length)] for every finding in text, in order. Never the matched text."""
    found = []
    for start, end, cat in core.find_spans(text, terms, salt):
        found.append((text.count("\n", 0, start) + 1, cat, end - start))
    return sorted(found, key=lambda f: (f[0], core.CATEGORY_ORDER.index(f[1]), f[2]))


def scan(paths, conf, out=None, salts=None):
    """Print the findings for paths and a summary. Returns the number of findings."""
    out = out or sys.stdout
    terms = core.read_terms(conf["terms_file"])
    salt = None
    if terms:
        salt = (salts or core.SaltStore(conf, interactive=False)).get()
        if not salt:
            out.write("NOTE    the term list's salt could not be read without a prompt; employer-client-term "
                      "was NOT checked\n")
    limit = int(conf["max_bytes"])
    total, files_with, scanned = 0, 0, 0
    for path in paths:
        try:
            if os.path.getsize(path) > limit:
                out.write("SKIPPED %s: over %d bytes, not scanned\n" % (path, limit))
                continue
            with open(path, "rb") as fh:
                raw = fh.read()
        except OSError as exc:
            out.write("SKIPPED %s: unreadable (%s)\n" % (path, type(exc).__name__))
            continue
        if b"\0" in raw:
            out.write("SKIPPED %s: binary, not scanned\n" % path)
            continue
        scanned += 1
        findings = scan_text(raw.decode("utf-8", errors="replace"), terms, salt)
        for line, cat, length in findings:
            out.write("%s:%d: %s, %d chars\n" % (path, line, cat, length))
        total += len(findings)
        files_with += bool(findings)
    out.write("mhw scan: %d finding(s) in %d of %d file(s) scanned; informs only, never blocks; the matched "
              "text is never shown (ADR-0005)\n" % (total, files_with, scanned))
    return total


def main(argv, out=None):
    out = out or sys.stdout
    base, paths = None, []
    for arg in argv:
        if arg.startswith("--base="):
            base = arg[len("--base="):]
            if not base:
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
    if not paths:
        paths, error = changed_files(base)
        if error:
            sys.stderr.write("mhw scan: %s\n" % error)
            return 2
    try:
        conf = core.load_config(installed_config())
    except Exception as exc:      # an unreadable settings file: the built-in defaults, said visibly
        out.write("NOTE    the paste filter settings could not be read (%s); built-in defaults used\n"
                  % type(exc).__name__)
        conf = core.load_config(None)
    scan(paths, conf, out)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
