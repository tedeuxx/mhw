#!/usr/bin/env python3
"""Gated session merge and read-only publication proof. Python 3.9+, git and gh.

No credentials, prompts or transcripts are read or persisted. Exit 1 means pending/blocked.
`merge` changes GitHub only after the local and remote gates pass; `verify` never writes.
"""
import argparse
import json
from pathlib import Path
import re
import subprocess
import sys

ROOT = Path(__file__).resolve().parent.parent
REQUIRED = {"delivery-ci", "semver-label", "SonarCloud Code Analysis"}


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


def checks_pass(pr):
    checks = latest_checks(pr.get("statusCheckRollup") or [])
    for name in REQUIRED:
        matches = [c for c in checks if c.get("name", c.get("context")) == name]
        if not matches or any(c.get("conclusion", c.get("state")) != "SUCCESS" for c in matches):
            raise Pending("required CI not successful: " + name)
    # Never ignore another failed or pending workflow reported for this head.
    for check in checks:
        if check.get("conclusion", check.get("state")) not in ("SUCCESS", "NEUTRAL", "SKIPPED"):
            raise Pending("another head check is pending or failed")


def pr_matches(pr, head):
    if pr.get("headRefOid") != head or pr.get("baseRefName") != "main" or pr.get("isCrossRepository"):
        raise Pending("PR does not match this exact local session head and same-repository main target")
    labels = [v["name"] for v in pr.get("labels", []) if v["name"].startswith("semver:")]
    if len(labels) != 1 or labels[0] not in ("semver:major", "semver:minor", "semver:patch"):
        raise Pending("PR must carry exactly one valid semver label")


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
                        "number,url,headRefOid,headRefName,baseRefName,isCrossRepository,state,mergeCommit,mergedAt,labels,statusCheckRollup"))
    pr_matches(pr, head)
    checks_pass(pr)
    if args.action == "merge":
        if pr["state"] == "MERGED":
            print("MERGED: " + pr["url"] + "; run verify for publication proof")
            return
        if pr["state"] != "OPEN":
            raise Pending("PR is not open")
        branch = run("git", "branch", "--show-current")
        if branch in ("", "main") or branch != pr["headRefName"]:
            raise Pending("use the session feature branch")
        refs = run("git", "ls-remote", "--heads", "origin", "refs/heads/" + branch).split()
        if not refs or refs[0] != head:
            raise Pending("session HEAD has not been pushed")
        if api(repo, "compare/main..." + head).get("behind_by", 1):
            raise Pending("session branch is behind main; update it and rerun CI")
        run(*merge_command(args.pr, repo, head))
        print("MERGED: " + pr["url"] + "; CI publication is pending, run verify")
        return
    if pr["state"] != "MERGED" or not pr.get("mergeCommit"):
        raise Pending("session PR is not merged")
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
