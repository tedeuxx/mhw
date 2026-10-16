#!/usr/bin/env python3
"""Date a rite by the artifacts that prove it ran, not by its artifact root (#128).

Usage: rite-cadence.py [--repo DIR] <root> [marker]

Session check 3 of agents-configuration reports how long since each rite last ran. Dating the root
(`git log -1 -- <root>`) also dates scaffolding: a README, or a report saying nothing was collected,
reads as a run. So when a rite declares a ran-marker (for /funnel-review, FUNNEL-REVIEW-RAN), only
tracked files under the root that carry the marker as a whole line are dated.

Prints one line and exits 0:
    <root>: last ran <YYYY-MM-DD> (<short commit>), dated by files carrying <marker>
    <root>: never landed a file carrying <marker>
    <root>: last changed <YYYY-MM-DD> (<short commit>), no ran-marker declared
    <root>: never changed
Exits 1 when git fails (not a repository, no git), so a failure never reads as "never".
Exits 2 on a usage error.

It reports and fires nothing. It is not a hook and nothing runs it but the session.

Which files count: tracked files under the root whose working copy carries the marker as a whole line
(a CR ending a CRLF line is ignored). An unreadable file does not count.

Which commit dates them: the latest commit (by committer date) whose diff ADDED the marker as a whole
line to one of those files, matched with the same CR-only strip. A later edit that leaves the marker
line alone, such as the `Ruled:` line /sprint-planning writes into a RAN report, does not move the
date; nor does a commit that only removes the marker. A report that loses the marker and regains it
is dated by the commit that regained it: that is the commit that put the current marker line there.
A marker present only in the working copy, or only staged, dates nothing. Merge commits are not
read (the commit that authored the line is), renames are not followed (a renamed report is dated by
the rename), and file names are passed to git literally, so `[ab].md` names that file only.
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


def carries(path, marker):
    """True when one line of the file is exactly the marker (CR of a CRLF line ignored)."""
    try:
        with open(path, "rb") as stream:
            data = stream.read()
    except OSError:
        return False
    wanted = marker.encode("utf-8")
    return any(line.rstrip(b"\r") == wanted for line in data.split(b"\n"))


def last_commit(repo, paths):
    """(date, short commit) of the last commit touching any of the paths, or None."""
    if not paths:
        return None
    out = git(repo, "--literal-pathspecs", "log", "-1", "--format=%cs %h", "--", *paths)
    out = out.decode("utf-8").strip()
    if not out:
        return None
    date, _, commit = out.partition(" ")
    return date, commit


def last_marker_commit(repo, paths, marker):
    """(date, short commit) of the latest commit that added the marker line to one of the paths."""
    if not paths:
        return None
    out = git(repo, "--literal-pathspecs", "log", "-p", "--unified=0", "--no-color", "--no-ext-diff",
              "--no-textconv", "--no-renames", "--diff-merges=off", "--format=%x00%ct %cs %h",
              "--", *paths)
    wanted = marker.encode("utf-8")
    best = None
    current = None
    in_hunk = False
    for line in out.split(b"\n"):
        if line.startswith(b"\0"):
            stamp, date, commit = line[1:].decode("utf-8").split(" ")
            current = (int(stamp), date, commit)
            in_hunk = False
        elif line.startswith(b"diff --git "):
            in_hunk = False
        elif line.startswith(b"@@"):
            in_hunk = True
        elif in_hunk and line.startswith(b"+") and line[1:].rstrip(b"\r") == wanted:
            if current is not None and (best is None or current[0] > best[0]):
                best = current
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
    listed = git(top, "ls-files", "-z", "--", arguments.root).decode("utf-8")
    files = [name for name in listed.split("\0") if name]

    if arguments.marker is None:
        found = last_commit(top, files)
        if found:
            print("%s: last changed %s (%s), no ran-marker declared" % (arguments.root, found[0], found[1]))
        else:
            print("%s: never changed" % arguments.root)
        return

    files = [name for name in files if carries(top + "/" + name, arguments.marker)]
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
