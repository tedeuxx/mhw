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
    text = (ROOT / ".github/workflows/tests.yml").read_text(encoding="utf-8")
    match = re.search(r"^  delivery-ci:\n(?:    .*\n)*?    needs: \[([^\]]+)\]", text, re.M)
    if not match:
        raise Pending("cannot read the tests workflow's delivery-ci job list")
    return [job.strip() for job in match[1].split(",") if job.strip()]


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
                        "mergeStateStatus,labels,statusCheckRollup"))
    pr_matches(pr, head)
    checks_pass(pr)
    base = pr["baseRefName"]
    if args.action == "merge":
        if pr["state"] == "MERGED":
            print("MERGED: " + pr["url"] + "; run verify for publication proof")
            return
        if pr["state"] != "OPEN":
            raise Pending("PR is not open")
        mergeable(pr)
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
            print("MERGED: " + pr["url"] + " into rc/next; no release is cut, run verify")
        else:
            print("MERGED: " + pr["url"] + "; CI publication is pending, run verify")
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
