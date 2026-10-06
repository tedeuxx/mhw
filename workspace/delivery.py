#!/usr/bin/env python3
"""Gated merge and read-only proof for both delivery routes. Python 3.9+, git and gh.

A slice PR targets the integration branch rc/next; only the release candidate (rc/next -> main) may
target main. No credentials, prompts or transcripts are read or persisted. Exit 1 means
pending/blocked. `merge` changes GitHub only after the local and remote gates pass; `verify` never
writes.
"""
import argparse
import json
from pathlib import Path
import re
import subprocess
import sys

ROOT = Path(__file__).resolve().parent.parent
INTEGRATION = "rc/next"
RELEASE = "main"
TESTS_WORKFLOW = "tests"
# Required per base. The semver-label workflow runs only on PRs into main, so a slice cannot carry it.
REQUIRED = {
    INTEGRATION: {"delivery-ci", "SonarCloud Code Analysis"},
    RELEASE: {"delivery-ci", "semver-label", "SonarCloud Code Analysis"},
}
# mergeStateStatus values a merge may proceed from; DIRTY, BEHIND, BLOCKED, UNKNOWN, UNSTABLE refuse.
MERGEABLE_STATES = {"CLEAN", "HAS_HOOKS"}

# Review artifacts, in the tadeumendonca-skills plugin's own formats (agents/quality-assurance.md,
# read at that repository's origin/main 01045b660fc31fa6cb4f063fc0c5a2f1aa04db7c). The plugin's merge
# floor guards a bare `gh pr merge`; it cannot see this script's subprocess, so the slice route reads
# the verdicts itself rather than leaving the review gate as an instruction.
# Only a strict header at the very top of a comment counts; nothing in the prose below it is read, so
# a fence, a blockquote or a sentence can never supply or override a verdict. Lines are compared whole
# (a trailing CR from a CRLF body is the only thing removed), never as substrings.
#   quality-assurance (the plugin's own required shape, lines 1-3 exactly as its brief fixes them):
#     line 1  <!-- gatekeeper-verdict: quality-assurance -->
#     line 2  one verdict literal, alone on the line
#     line 3  head: <full 40-character head SHA>
#   agents-lead: lines 1-2 are the plugin's required shape. LINE 3 IS THIS REPOSITORY'S CONTRACT, NOT
#   THE PLUGIN'S: the plugin brief asks for "the lens is CLOSED" in those words but fixes no position,
#   so a marker that only follows the plugin brief is refused here (fail closed) until line 3 says it.
#     line 1  <!-- harness-lead-verdict: <one-line summary> -->
#     line 2  commit: <full 40-character head SHA>
#     line 3  the lens is CLOSED      (any other line 3 means the lens is open)
#   Line 3 is pinned rather than searched for (option b over a): finding the sentence anywhere in the
#   body means parsing fences, blockquotes and prose again, which is exactly where the spoofs lived.
GATE_PREFIX = "<!-- gatekeeper-verdict"
GATE_HEADER = "<!-- gatekeeper-verdict: quality-assurance -->"
LENS_PREFIX = "<!-- harness-lead-verdict"
LENS_HEADER = re.compile(r"<!-- harness-lead-verdict: (?:(?!-->).)* -->")
LENS_CLOSED = "the lens is CLOSED"
# The plugin's verdict enum also has APPROVE-PENDING-HUMAN, APPROVE-EXECUTOR-BLOCKED and
# REQUEST-CHANGES; only these two exact lines authorize a merge, anything else on line 2 refuses.
MERGE_LITERALS = ("APPROVE-AND-MERGE", "APPROVE-AND-MERGE-BOUNDARY")
TRUSTED_AUTHORS = ("OWNER", "MEMBER", "COLLABORATOR")
HEAD_LINE = re.compile(r"head: ([0-9a-f]{40})")
COMMIT_LINE = re.compile(r"commit: ([0-9a-f]{40})")
# Hold 2's harness-path list for a consuming repository (no .claude-plugin/plugin.json), at any depth,
# plus this repository's own other harness carriers, .agents/ and .kiro/ (stricter, never looser).
# Compared by path component rather than a regex, so no anchor/alternation precedence is involved.
HARNESS_DIRS = {".claude", ".codex", ".github", ".agents", ".kiro"}
HARNESS_FILES = {"AGENTS.md", "CLAUDE.md"}
MERGED = "MERGED: "

class Pending(Exception):
    pass


def run(*args):
    result = subprocess.run(args, cwd=ROOT, capture_output=True, text=True, timeout=60)
    if result.returncode:
        raise Pending("command failed or remote unavailable: " + args[0] + "; details omitted")
    return result.stdout.strip()


def api(repo, path):
    return json.loads(run("gh", "api", "repos/" + repo + "/" + path))


def version(tag):
    match = re.fullmatch(r"v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)", tag)
    if not match:
        raise Pending("release tag is not a numeric SemVer")
    return tuple(map(int, match.groups()))


def latest_checks(checks):
    """Keep only the most recent run of each check on this head.

    A re-run (or a later label event) reports a second entry with the same workflow and name; the
    superseded one must neither block nor satisfy the gate. Ordered by start time, then completion
    time, then rollup position, so a pending re-run still counts as pending.
    """
    latest = {}
    for index, check in enumerate(checks):
        key = (check.get("workflowName") or "", check.get("name", check.get("context")))
        stamp = (check.get("startedAt") or "", check.get("completedAt") or "", index)
        if key not in latest or stamp >= latest[key][0]:
            latest[key] = (stamp, check)
    return [check for _, check in latest.values()]


def tests_jobs():
    """The jobs the stable delivery-ci job aggregates, read from the workflow itself, not restated."""
    lines = (ROOT / ".github/workflows/tests.yml").read_text(encoding="utf-8").splitlines()
    # Line scan, no backtracking regex: the `needs:` key directly inside the delivery-ci job block.
    inside = False
    for line in lines:
        if line == "  delivery-ci:":
            inside = True
        elif inside and not line.startswith("    "):
            break
        elif inside and line.startswith("    needs: [") and line.endswith("]"):
            jobs = [job.strip() for job in line[len("    needs: ["):-1].split(",") if job.strip()]
            if jobs:
                return jobs
    raise Pending("cannot read the tests workflow's delivery-ci job list")


def tests_registered(checks, jobs):
    """The tests workflow must actually have run on this head: a CLEAN PR with no tests run is not green.

    Every job delivery-ci needs (a matrix job reports as "job (variant)") and delivery-ci itself must be
    reported by the tests workflow, not merely by a same-named check from somewhere else.
    """
    names = [c.get("name", c.get("context")) or "" for c in checks
             if c.get("workflowName") == TESTS_WORKFLOW]
    for job in list(jobs) + ["delivery-ci"]:
        if not any(n == job or n.startswith(job + " (") for n in names):
            raise Pending("the tests workflow has not registered on this head: " + job)


def checks_pass(pr, jobs=None):
    checks = latest_checks(pr.get("statusCheckRollup") or [])
    tests_registered(checks, tests_jobs() if jobs is None else jobs)
    for name in REQUIRED[pr.get("baseRefName")]:
        matches = [c for c in checks if c.get("name", c.get("context")) == name]
        if not matches or any(c.get("conclusion", c.get("state")) != "SUCCESS" for c in matches):
            raise Pending("required CI not successful: " + name)
    # Never ignore another failed or pending workflow reported for this head.
    for check in checks:
        if check.get("conclusion", check.get("state")) not in ("SUCCESS", "NEUTRAL", "SKIPPED"):
            raise Pending("another head check is pending or failed")


def pr_matches(pr, head):
    base = pr.get("baseRefName")
    if pr.get("headRefOid") != head or base not in REQUIRED or pr.get("isCrossRepository"):
        raise Pending("PR does not match this exact local head and a same-repository rc/next or main target")
    # A slice never goes straight to main: the only PR main accepts is the release candidate.
    if base == RELEASE and pr.get("headRefName") != INTEGRATION:
        raise Pending("only the rc/next release candidate may target main; open the slice against rc/next")
    if base == INTEGRATION and pr.get("headRefName") in (INTEGRATION, RELEASE):
        raise Pending("a slice must come from its own feature branch")
    labels = [v["name"] for v in pr.get("labels", []) if v["name"].startswith("semver:")]
    if len(labels) != 1 or labels[0] not in ("semver:major", "semver:minor", "semver:patch"):
        raise Pending("PR must carry exactly one valid semver label")


def header(comment, size=3):
    """The first lines of a comment, whole, with only a CRLF's trailing CR removed."""
    lines = [line[:-1] if line.endswith("\r") else line for line in (comment.get("body") or "").split("\n")]
    return (lines + [""] * size)[:size]


def trusted(comment):
    return comment.get("authorAssociation") in TRUSTED_AUTHORS


def newest(comments, prefix):
    """The newest trusted comment whose FIRST line opens with the envelope; a quoted one never counts."""
    found = [c for c in comments if trusted(c) and header(c, 1)[0].startswith(prefix)]
    return found[-1] if found else None


def gate_approves(comments, head):
    """The newest quality-assurance verdict must be well formed, name this exact head and authorize it.

    Newest wins whatever it says: a later REQUEST-CHANGES (or a malformed verdict) beats an earlier
    approval at the same head.
    """
    verdict = newest(comments, GATE_PREFIX)
    if verdict is None:
        raise Pending("no quality-assurance gatekeeper-verdict on the PR")
    envelope, literal, head_line = header(verdict)
    named = HEAD_LINE.fullmatch(head_line)
    if envelope != GATE_HEADER or not named:
        raise Pending("the newest gatekeeper-verdict is not in the strict header format")
    if named[1] != head:
        raise Pending("the newest gatekeeper-verdict does not name the current head")
    if literal not in MERGE_LITERALS:
        raise Pending("the newest gatekeeper-verdict does not authorize a merge: " + literal)


def harness_paths(paths):
    def is_harness(path):
        parts = path.split("/")
        return bool(HARNESS_DIRS.intersection(parts[:-1])) or parts[-1] in HARNESS_FILES
    return [p for p in paths if is_harness(p)]


def lens_closed(comments, head):
    """Hold 2: the newest agents-lead lens marker must name this exact head with line 3 CLOSED.

    No carry-forward: a marker for an older head never satisfies this route, and a newer marker that
    leaves the lens open withdraws an earlier closed one.
    """
    marker = newest(comments, LENS_PREFIX)
    if marker is None:
        raise Pending("harness paths changed and no agents-lead lens marker is on the PR")
    envelope, commit_line, state = header(marker)
    named = COMMIT_LINE.fullmatch(commit_line)
    if not LENS_HEADER.fullmatch(envelope) or not named:
        raise Pending("the newest agents-lead lens marker is not in the strict header format")
    if named[1] != head:
        raise Pending("the newest agents-lead lens marker does not name the current head")
    if state != LENS_CLOSED:
        raise Pending("the newest agents-lead lens marker at this head does not say the lens is CLOSED")


def review_gate(pr, head, paths):
    """The slice review gate: a QA approval at this head, and the lens closed at it on harness paths."""
    comments = pr.get("comments") or []
    gate_approves(comments, head)
    if harness_paths(paths):
        lens_closed(comments, head)


def mergeable(pr):
    state = pr.get("mergeStateStatus")
    if state not in MERGEABLE_STATES:
        raise Pending("PR merge state is not clean: " + str(state))


def merge_command(number, repo, head):
    """A real merge commit, never a squash or a rebase (owner, 2026-10-05: workstation standard).

    The merge commit keeps the session head as its second parent, so verify's ancestry check
    (merge commit contained in the release tag) holds for every session commit.
    """
    return ("gh", "pr", "merge", str(number), "--repo", repo, "--merge", "--match-head-commit", head)


def release_matches(release, baseline, comparison):
    if release.get("draft") or release.get("prerelease") or not release.get("published_at"):
        raise Pending("release is not publicly published as a stable release")
    if version(release.get("tag_name", "")) <= version("v" + baseline):
        raise Pending("no newer session release is published")
    if comparison.get("status") not in ("ahead", "identical"):
        raise Pending("release does not contain the session merge commit")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("merge", "verify"))
    parser.add_argument("--pr", required=True, type=int)
    args = parser.parse_args()
    if args.pr < 1:
        raise Pending("invalid PR number")
    if run("git", "status", "--porcelain"):
        raise Pending("workspace has uncommitted or untracked changes")
    head = run("git", "rev-parse", "HEAD")
    remote = run("git", "remote", "get-url", "origin")
    if remote.endswith(".git"):
        remote = remote[:-4]
    match = re.fullmatch(r"(?:https://github\.com/|git@github\.com:)([A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+)", remote)
    if not match:
        raise Pending("origin is not a supported GitHub repository URL")
    repo = match[1]
    pr = json.loads(run("gh", "pr", "view", str(args.pr), "--repo", repo, "--json",
                        "number,url,headRefOid,headRefName,baseRefName,isCrossRepository,state,mergeCommit,mergedAt,"
                        "mergeStateStatus,labels,statusCheckRollup,comments"))
    pr_matches(pr, head)
    checks_pass(pr)
    base = pr["baseRefName"]
    if args.action == "merge":
        if pr["state"] == "MERGED":
            print(MERGED + pr["url"] + "; run verify for publication proof")
            return
        if pr["state"] != "OPEN":
            raise Pending("PR is not open")
        mergeable(pr)
        if base == INTEGRATION:
            # A tree diff from the merge base, never the paginated PR file list.
            run("git", "fetch", "origin", base)
            paths = run("git", "diff", "--no-renames", "--name-only", "origin/" + base + "..." + head)
            review_gate(pr, head, paths.splitlines())
        branch = run("git", "branch", "--show-current")
        if branch in ("", base) or branch != pr["headRefName"]:
            raise Pending("check out the PR's head branch (the slice branch, or rc/next for a release)")
        refs = run("git", "ls-remote", "--heads", "origin", "refs/heads/" + branch).split()
        if not refs or refs[0] != head:
            raise Pending("session HEAD has not been pushed")
        if api(repo, "compare/" + base + "..." + head).get("behind_by", 1):
            raise Pending("head is behind " + base + "; update it and rerun CI")
        run(*merge_command(args.pr, repo, head))
        if base == INTEGRATION:
            print(MERGED + pr["url"] + " into rc/next; no release is cut, run verify")
        else:
            print(MERGED + pr["url"] + "; CI publication is pending, run verify")
        return
    if pr["state"] != "MERGED" or not pr.get("mergeCommit"):
        raise Pending("session PR is not merged")
    if base == INTEGRATION:
        # A slice only integrates: merged with its checks green at this head; no tag or release expected.
        print(json.dumps({"status": "integrated", "base": INTEGRATION, "session_head": head,
                          "pr": pr["url"], "merge_commit": pr["mergeCommit"]["oid"]}))
        return
    match = re.search(r'^current_version\s*=\s*"([0-9.]+)"',
                      (ROOT / ".bumpversion.toml").read_text(), re.M)
    if not match:
        raise Pending("cannot establish the session's baseline version")
    release = api(repo, "releases/latest")
    tag = release.get("tag_name", "")
    version(tag)  # validate before putting a remote value in an API path
    comparison = api(repo, "compare/" + pr["mergeCommit"]["oid"] + "..." + tag)
    release_matches(release, match[1], comparison)
    runs = api(repo, "actions/workflows/version-main.yml/runs?per_page=100")["workflow_runs"]
    matching = [r for r in runs if r.get("head_sha") == head and r.get("event") == "pull_request"]
    if not matching or max(matching, key=lambda r: r["id"]).get("conclusion") != "success":
        raise Pending("session version workflow is not verified successful")
    print(json.dumps({"status": "published", "session_head": head, "pr": pr["url"],
                      "version": tag, "release": release["html_url"]}))


if __name__ == "__main__":
    try:
        main()
    except (Pending, OSError, ValueError, KeyError, subprocess.TimeoutExpired) as error:
        print("PENDING: " + (str(error) if isinstance(error, Pending) else "verification unavailable; details omitted"), file=sys.stderr)
        sys.exit(1)
