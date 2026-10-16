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
Exits 1 when git fails (not a repository, no git), so a failure never reads as "never".
Exits 2 on a usage error. Every date is the commit's author date.

It reports and fires nothing. It is not a hook and nothing runs it but the session.

Which files count: files under the root in the commit HEAD names whose committed content (the HEAD
blob) carries the marker as a whole line (a CR ending a CRLF line is ignored). The working copy and
the index play no part either way: a marker only there dates nothing, and a committed marker that
the working copy has deleted still counts. A repository with no commit yet has no such file.

Which commit dates them: the latest commit, by author date, that in one of those files ADDS more
whole-line marker lines than it removes (matched with the same CR-only strip). Author date is kept by
a rebase, a cherry-pick and an amend, so moving a report's commit does not move its date. A later
edit that leaves the marker line alone, such as the `Ruled:` line /sprint-planning writes into a RAN
report, does not move the date; nor does a commit that only removes the marker, nor one that rewrites
it in place (a CRLF-to-LF normalisation, or a reorder that moves the line: one removed, one added).
A report that loses the marker and regains it is dated by the commit that regained it: that is the
commit that put the current marker line there. Merge commits are not read (the commit that authored
the line is), renames are not followed (a renamed report is dated by the rename), and file names are
passed to git literally, so `[ab].md` names that file only.
"""

import argparse
import subprocess
import sys

sys.dont_write_bytecode = True


class GitError(Exception):
    pass


def git(repo, *args):
    try:
        done = subprocess.run(["git", "-C", repo, *args], capture_output=True)
    except OSError as error:
        raise GitError("rite-cadence: git could not run: %s" % error) from error
    if done.returncode != 0:
        raise GitError("rite-cadence: git %s failed: %s"
                       % (args[0], done.stderr.decode("utf-8", "replace").strip()))
    return done.stdout


def carries(data, marker):
    """True when one line of the content is exactly the marker (CR of a CRLF line ignored)."""
    wanted = marker.encode("utf-8")
    return any(line.rstrip(b"\r") == wanted for line in data.split(b"\n"))


def head_exists(repo):
    """True when HEAD names a commit; False in a repository with no commit yet."""
    try:
        git(repo, "rev-parse", "--verify", "--quiet", "HEAD^{commit}")
    except GitError:
        return False
    return True


def committed_with_marker(repo, root, marker):
    """Files under the root whose blob in HEAD carries the marker as a whole line."""
    if not head_exists(repo):
        return []
    listed = git(repo, "--literal-pathspecs", "ls-tree", "-r", "-z", "HEAD", "--", root)
    entries = []
    for record in listed.split(b"\0"):
        if not record:
            continue
        meta, _, name = record.partition(b"\t")
        _mode, kind, oid = meta.split(b" ")
        if kind == b"blob":
            entries.append((oid, name.decode("utf-8", "surrogateescape")))
    if not entries:
        return []
    try:
        done = subprocess.run(["git", "-C", repo, "cat-file", "--batch"], capture_output=True,
                              input=b"".join(oid + b"\n" for oid, _ in entries))
    except OSError as error:
        raise GitError("rite-cadence: git could not run: %s" % error) from error
    if done.returncode != 0:
        raise GitError("rite-cadence: git cat-file failed: %s"
                       % done.stderr.decode("utf-8", "replace").strip())
    out = done.stdout
    found = []
    offset = 0
    for _oid, name in entries:
        header_end = out.index(b"\n", offset)
        size = int(out[offset:header_end].split(b" ")[2])
        body = out[header_end + 1:header_end + 1 + size]
        offset = header_end + 1 + size + 1
        if carries(body, marker):
            found.append(name)
    return found


def last_commit(repo, paths):
    """(author date, short commit) of the last commit touching any of the paths, or None."""
    if not paths:
        return None
    out = git(repo, "--literal-pathspecs", "log", "-1", "--format=%as %h", "--", *paths)
    out = out.decode("utf-8").strip()
    if not out:
        return None
    date, _, commit = out.partition(" ")
    return date, commit


def last_marker_commit(repo, paths, marker):
    """(date, short commit) of the latest commit, by author date, that adds more marker lines than it
    removes in one of the paths."""
    if not paths:
        return None
    out = git(repo, "--literal-pathspecs", "log", "-p", "--unified=0", "--no-color", "--no-ext-diff",
              "--no-textconv", "--no-renames", "--diff-merges=off", "--format=%x00%at %as %h",
              "--", *paths)
    wanted = marker.encode("utf-8")
    best = None
    current = None
    in_hunk = False
    added = removed = 0

    def settle():
        # One file of one commit is finished: it counts only on a net add.
        nonlocal best
        if current is not None and added > removed and (best is None or current[0] > best[0]):
            best = current

    for line in out.split(b"\n"):
        if line.startswith(b"\0"):
            settle()
            stamp, date, commit = line[1:].decode("utf-8").split(" ")
            current = (int(stamp), date, commit)
            in_hunk = False
            added = removed = 0
        elif line.startswith(b"diff --git "):
            settle()
            in_hunk = False
            added = removed = 0
        elif line.startswith(b"@@"):
            in_hunk = True
        elif in_hunk and line[:1] in (b"+", b"-") and line[1:].rstrip(b"\r") == wanted:
            if line.startswith(b"+"):
                added += 1
            else:
                removed += 1
    settle()
    if best is None:
        return None
    return best[1], best[2]


def main():
    parser = argparse.ArgumentParser(description="Date a rite by its ran-marked artifacts.")
    parser.add_argument("--repo", default=".", help="the repository (default: the current directory)")
    parser.add_argument("root", help="the rite's artifact root, relative to the repository")
    parser.add_argument("marker", nargs="?", help="the rite's ran-marker, matched as a whole line")
    arguments = parser.parse_args()
    if arguments.marker is not None and not arguments.marker.strip():
        parser.error("marker must not be empty")

    top = git(arguments.repo, "rev-parse", "--show-toplevel").decode("utf-8").strip()

    if arguments.marker is None:
        listed = git(top, "ls-files", "-z", "--", arguments.root).decode("utf-8")
        found = last_commit(top, [name for name in listed.split("\0") if name])
        if found:
            print("%s: last changed %s (%s), no ran-marker declared" % (arguments.root, found[0], found[1]))
        else:
            print("%s: never changed" % arguments.root)
        return

    files = committed_with_marker(top, arguments.root, arguments.marker)
    found = last_marker_commit(top, files, arguments.marker)
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
