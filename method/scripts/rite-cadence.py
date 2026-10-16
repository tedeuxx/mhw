#!/usr/bin/env python3
"""Date a rite by the artifacts that prove it ran, not by its artifact root (#128).

Usage: rite-cadence.py [--repo DIR] <root> [marker]

Session check 3 of agents-configuration reports how long since each rite last ran. Dating the root
(`git log -1 -- <root>`) also dates scaffolding: a README, or a report saying nothing was collected,
reads as a run. So when a rite declares a ran-marker (for /funnel-review, FUNNEL-REVIEW-RAN), only
files under the root whose committed content carries the marker as a whole line are dated.

Prints one line and exits 0:
    <root>: last ran <YYYY-MM-DD> (<short commit>), dated by files carrying <marker>
    <root>: never landed a file carrying <marker>
    <root>: last changed <YYYY-MM-DD> (<short commit>), no ran-marker declared
    <root>: never changed
Exits 1 when git fails (not a repository, no git, an object missing from the store) or HEAD names no
readable commit (a dangling or malformed branch ref), so those failures do not read as "never"; only
an unborn HEAD (a branch with no commit yet) reads as "never". Exits 2 on a usage error: an unknown option, an empty marker, or a root that
is empty, absolute or outside the repository. A value beginning with '-' is an unknown option unless
it follows `--`, where it is a literal path or marker like any other.

It reports and fires nothing. It is not a hook and nothing runs it but the session.

No value given here reaches git's command line. git runs in the repository as its working directory;
it lists the whole tree or the whole history, and the root is matched against git's own output here,
as a literal path: the root itself or anything under it, by whole path components, so `docs/*` names
a directory spelled with an asterisk and `docs/fr` does not reach `docs/frx`. The only paths handed
back to git are paths git printed. The marker is never passed to git at all.

With no marker, the root is dated as `git log -1 --format=%cs -- <root>` dated it: the committer
date of the newest commit, in git log's own order and history simplification, that touched a path
under the root, deletions included. It gets there by listing every path the history ever held under
the root and asking that same log about exactly those paths. One difference: that command read the
root as a pattern, and this reads it literally.

With a marker, which files count: files under the root in the commit HEAD names whose committed
content (the HEAD blob) carries the marker as a whole line (a CR ending a CRLF line is ignored).
Only regular files count: a symlink or a submodule under the root is never a run. The working copy
and the index play no part either way: a marker only there dates nothing, and a committed marker that
the working copy has deleted still counts. A repository with no commit yet has no such file.

Which commit dates them: the latest commit, by AUTHOR date, that in one of those files ADDS more
whole-line marker lines than it removes (matched with the same CR-only strip). Author date is kept by
a rebase, a cherry-pick and an amend, so moving a report's commit does not move its date. A later
edit that leaves the marker line alone, such as the `Ruled:` line /sprint-planning writes into a RAN
report, does not move the date; nor does a commit that only removes the marker, nor one that rewrites
it in place (a CRLF-to-LF normalisation, or a reorder that moves the line: one removed, one added).
A report that loses the marker and regains it is dated by the commit that regained it: that is the
commit that put the current marker line there. Reports are diffed as text whatever their attributes
say. Merge commits are not read (the commit that authored the line is), and renames are not followed
(a renamed report is dated by the rename). In a shallow clone, a report whose marker was added
before the shallow boundary is dated by the boundary commit, which is too recent; nothing here
detects that.
"""

import argparse
import os
import posixpath
import subprocess
import sys

sys.dont_write_bytecode = True

REGULAR_FILE_MODES = (b"100644", b"100755")


class GitError(Exception):
    pass


def git(cwd, *args, data=None):
    """Run git in cwd. Every argument is a constant here or a path git itself printed."""
    try:
        done = subprocess.run(["git", *args], cwd=cwd, input=data, capture_output=True)
    except OSError as error:
        raise GitError("rite-cadence: git could not run: %s" % error) from error
    if done.returncode != 0:
        raise GitError("rite-cadence: git %s failed: %s"
                       % (args[0], done.stderr.decode("utf-8", "replace").strip()))
    return done.stdout


def head_exists(top):
    """True when HEAD names a commit; False when HEAD is unborn (no commit yet).

    "No commit" needs two signals: `rev-parse --verify HEAD` fails AND `symbolic-ref -q HEAD`
    still resolves HEAD to a branch name. The first also fails on a malformed branch ref (an empty
    loose ref file, a loose or packed ref holding text that is no object id, a garbage line in
    packed-refs); there `symbolic-ref` fails too, so that is raised as a git failure. A HEAD that
    names an object the store cannot read as a commit (a dangling ref, a tree, a blob) is raised as
    well. Both exit 1 rather than reading as "never". Measured on git 2.52.0 only: other git builds,
    Windows and reftable repositories are not measured.
    """
    try:
        git(top, "rev-parse", "--verify", "--quiet", "HEAD")
    except GitError:
        try:
            git(top, "symbolic-ref", "-q", "HEAD")
        except GitError as error:
            raise GitError("rite-cadence: HEAD names no readable commit") from error
        return False
    try:
        git(top, "rev-parse", "--verify", "--quiet", "HEAD^{commit}")
    except GitError as error:
        raise GitError("rite-cadence: HEAD names no readable commit") from error
    return True


def under(path, root):
    """True when the repository path is the root or lies under it, by whole path components."""
    return root == b"." or path == root or path.startswith(root + b"/")


def carries(data, marker):
    """True when one line of the content is exactly the marker (CR of a CRLF line ignored)."""
    return any(line.rstrip(b"\r") == marker for line in data.split(b"\n"))


def regular_files_under(top, root):
    """(blob id, path) of every regular file under the root in the HEAD tree."""
    listed = git(top, "ls-tree", "-r", "-z", "--full-tree", "HEAD")
    entries = []
    for record in listed.split(b"\0"):
        meta, _, path = record.partition(b"\t")
        fields = meta.split(b" ")
        if len(fields) == 3 and fields[0] in REGULAR_FILE_MODES and under(path, root):
            entries.append((fields[2], path))
    return entries


def read_blobs(top, oids):
    """The content of each blob, in order. A blob missing from the store is a git failure."""
    out = git(top, "cat-file", "--batch", data=b"".join(oid + b"\n" for oid in oids))
    bodies = []
    offset = 0
    for oid in oids:
        header_end = out.find(b"\n", offset)
        fields = out[offset:header_end].split(b" ")
        if header_end < 0 or len(fields) != 3:
            raise GitError("rite-cadence: git cat-file could not read blob %s"
                           % oid.decode("ascii", "replace"))
        size = int(fields[2])
        bodies.append(out[header_end + 1:header_end + 1 + size])
        offset = header_end + 1 + size + 1
    return bodies


def committed_with_marker(top, root, marker):
    """Paths of the regular files under the root whose HEAD blob carries the marker as a whole line."""
    if not head_exists(top):
        return []
    entries = regular_files_under(top, root)
    if not entries:
        return []
    bodies = read_blobs(top, [oid for oid, _ in entries])
    return [path for (_, path), body in zip(entries, bodies) if carries(body, marker)]


def commit_header(line):
    """(author time, author date, short commit) from a `%x00%at %as %h` line."""
    stamp, date, commit = line[1:].decode("utf-8").split(" ")
    return int(stamp), date, commit


def file_diffs(out):
    """Yield (commit, diff lines) for each file of each commit of a `log -p` output."""
    commit = None
    lines = []
    for line in out.split(b"\n"):
        if line.startswith((b"\0", b"diff --git ")):
            if commit is not None:
                yield commit, lines
            lines = []
            if line.startswith(b"\0"):
                commit = commit_header(line)
        else:
            lines.append(line)
    if commit is not None:
        yield commit, lines


def net_marker_lines(lines, marker):
    """Whole-line marker lines added minus those removed, in the hunks of one file's diff."""
    in_hunk = False
    net = 0
    for line in lines:
        if line.startswith(b"@@"):
            in_hunk = True
        elif in_hunk and line[1:].rstrip(b"\r") == marker:
            net += {b"+": 1, b"-": -1}.get(line[:1], 0)
    return net


def last_marker_commit(top, paths, marker):
    """(author date, short commit) of the latest commit, by author date, that adds more marker lines
    than it removes in one of the paths; None when there is none."""
    if not paths:
        return None
    out = git(top, "--literal-pathspecs", "log", "-p", "--text", "--unified=0", "--no-color",
              "--no-ext-diff", "--no-textconv", "--no-renames", "--no-relative", "--diff-merges=off",
              "--format=%x00%at %as %h", "--", *paths)
    adds = [commit for commit, lines in file_diffs(out) if net_marker_lines(lines, marker) > 0]
    if not adds:
        return None
    _stamp, date, commit = max(adds, key=lambda found: found[0])
    return date, commit


def paths_ever_under(top, root):
    """Every path under the root that any commit reachable from HEAD added, changed or deleted."""
    if not head_exists(top):
        return []
    out = git(top, "log", "--format=", "--name-only", "-z", "--no-renames", "--no-relative", "--root",
              "--diff-merges=separate")
    return sorted({path for path in out.split(b"\0") if path and under(path, root)})


def last_change(top, root):
    """(committer date, short commit) of the newest commit touching the root, as `git log -1` orders
    it; None when nothing under the root was ever committed."""
    paths = paths_ever_under(top, root)
    if not paths:
        return None
    out = git(top, "--literal-pathspecs", "log", "-1", "--format=%cs %h", "--", *paths)
    date, _, commit = out.decode("utf-8").strip().partition(" ")
    return (date, commit) if date else None


def normalised_root(parser, root):
    """The root as a repository path in bytes, or a usage error when it is not one."""
    path = root.replace(os.sep, "/") if os.sep != "/" else root
    if not path or posixpath.isabs(path) or os.path.isabs(root):
        parser.error("root must be a path relative to the repository")
    path = posixpath.normpath(path)
    if path == ".." or path.startswith("../"):
        parser.error("root must not leave the repository")
    return path.encode("utf-8", "surrogateescape")


def parse_arguments():
    parser = argparse.ArgumentParser(description="Date a rite by its ran-marked artifacts.")
    parser.add_argument("--repo", default=".", help="the repository (default: the current directory)")
    parser.add_argument("root", help="the rite's artifact root, relative to the repository")
    parser.add_argument("marker", nargs="?", help="the rite's ran-marker, matched as a whole line")
    arguments = parser.parse_args()
    if arguments.marker is not None and not arguments.marker.strip():
        parser.error("marker must not be empty")
    return arguments, normalised_root(parser, arguments.root)


def repository_top(repo):
    directory = os.path.abspath(repo)
    if not os.path.isdir(directory):
        raise GitError("rite-cadence: not a directory: %s" % directory)
    return git(directory, "rev-parse", "--show-toplevel").decode("utf-8").strip()


def main():
    arguments, root = parse_arguments()
    top = repository_top(arguments.repo)

    if arguments.marker is None:
        found = last_change(top, root)
        if found:
            print("%s: last changed %s (%s), no ran-marker declared" % (arguments.root, found[0], found[1]))
        else:
            print("%s: never changed" % arguments.root)
        return

    marker = arguments.marker.encode("utf-8", "surrogateescape")
    found = last_marker_commit(top, committed_with_marker(top, root, marker), marker)
    if found:
        print("%s: last ran %s (%s), dated by files carrying %s"
              % (arguments.root, found[0], found[1], arguments.marker))
    else:
        print("%s: never landed a file carrying %s" % (arguments.root, arguments.marker))


if __name__ == "__main__":
    try:
        main()
    except GitError as error:
        print(error, file=sys.stderr)
        raise SystemExit(1) from error
