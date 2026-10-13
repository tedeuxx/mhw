#!/usr/bin/env python3
"""Shared GitHub milestone transport for the reviewed tracker routes (#537)."""

import json
import subprocess
from pathlib import Path


class MilestoneError(Exception):
    """An actionable failure from the local input or the GitHub CLI."""


def run_gh(arguments):
    result = subprocess.run(["gh", *arguments], capture_output=True, text=True, check=False)
    if result.returncode:
        detail = result.stderr.strip() or result.stdout.strip() or f"exit {result.returncode}"
        raise MilestoneError(f"gh failed: {detail}")
    return result.stdout


def resolve_repo(repo):
    if repo:
        return repo
    value = run_gh(["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"]).strip()
    if not value:
        raise MilestoneError("gh returned an empty repository; pass --repo <owner>/<repo>")
    return value


def parse_json(raw, operation):
    try:
        value = json.loads(raw)
    except json.JSONDecodeError as error:
        raise MilestoneError(f"gh returned invalid JSON while {operation}: {error}") from error
    if not isinstance(value, dict):
        raise MilestoneError(f"gh returned a non-object while {operation}")
    return value


def read_milestone(repo, number):
    raw = run_gh(["api", f"repos/{repo}/milestones/{number}"])
    value = parse_json(raw, "reading the milestone")
    required = ("number", "title", "description", "state", "open_issues", "closed_issues")
    missing = [field for field in required if field not in value]
    if missing:
        raise MilestoneError(f"gh milestone response is missing: {', '.join(missing)}")
    return value


def update_milestone(repo, number, **fields):
    arguments = ["api", f"repos/{repo}/milestones/{number}", "-X", "PATCH"]
    for key, value in fields.items():
        arguments.extend(["-f", f"{key}={value}"])
    return parse_json(run_gh(arguments), "updating the milestone")


def text_from_file(path, purpose):
    try:
        value = Path(path).read_text(encoding="utf-8")
    except OSError as error:
        raise MilestoneError(f"cannot read {purpose} file {path}: {error}") from error
    # A text file normally carries one terminal LF while GitHub's description value does not.
    return value.removesuffix("\n")


def print_json(value):
    print(json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True))
