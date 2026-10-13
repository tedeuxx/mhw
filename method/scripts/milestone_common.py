#!/usr/bin/env python3
"""Shared GitHub milestone transport for the reviewed tracker routes (#537)."""

import json
import re
import subprocess
from pathlib import Path

from confine import confined

# mhw #170 (Sonar S8705): a repository or a number shaped like a flag never reaches the gh argv.
REPO_RE = re.compile(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+")


class MilestoneError(Exception):
    """An actionable failure from the local input or the GitHub CLI."""


def run_gh(arguments):
    # A list argv with no shell. The repository and the number are validated by check_repo and check_number
    # before any call; every other value travels inside "-f key=value", never as an argument of its own.
    result = subprocess.run(["gh", *arguments], capture_output=True, text=True, check=False)  # NOSONAR pythonsecurity:S8705 - argv list, no shell; repo and number validated by check_repo/check_number, values only inside -f key=value
    if result.returncode:
        detail = result.stderr.strip() or result.stdout.strip() or f"exit {result.returncode}"
        raise MilestoneError(f"gh failed: {detail}")
    return result.stdout


def check_repo(repo):
    if not REPO_RE.fullmatch(repo or "") or repo.startswith("-") or any(set(p) == {"."} for p in repo.split("/")):
        raise MilestoneError("the repository must be <owner>/<repo>, letters, digits, '.', '_' and '-' only")
    return repo


def check_number(number):
    if type(number) is not int or number < 1:
        raise MilestoneError("the milestone number must be a positive integer")
    return number


def resolve_repo(repo):
    if repo:
        return check_repo(repo)
    value = run_gh(["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"]).strip()
    if not value:
        raise MilestoneError("gh returned an empty repository; pass --repo <owner>/<repo>")
    return check_repo(value)


def parse_json(raw, operation):
    try:
        value = json.loads(raw)
    except json.JSONDecodeError as error:
        raise MilestoneError(f"gh returned invalid JSON while {operation}: {error}") from error
    if not isinstance(value, dict):
        raise MilestoneError(f"gh returned a non-object while {operation}")
    return value


def read_milestone(repo, number):
    raw = run_gh(["api", f"repos/{check_repo(repo)}/milestones/{check_number(number)}"])
    value = parse_json(raw, "reading the milestone")
    required = ("number", "title", "description", "state", "open_issues", "closed_issues")
    missing = [field for field in required if field not in value]
    if missing:
        raise MilestoneError(f"gh milestone response is missing: {', '.join(missing)}")
    return value


def update_milestone(repo, number, **fields):
    arguments = ["api", f"repos/{check_repo(repo)}/milestones/{check_number(number)}", "-X", "PATCH"]
    for key, value in fields.items():
        arguments.extend(["-f", f"{key}={value}"])
    return parse_json(run_gh(arguments), "updating the milestone")


def text_from_file(path, purpose):
    # mhw #170 (Sonar S8707): the text is posted to the forge, so only a file under the current work tree or
    # the temporary directory is read.
    try:
        real = confined(path)
    except ValueError as error:
        raise MilestoneError(f"{purpose} file: {error}") from error
    try:
        value = Path(real).read_text(encoding="utf-8")
    except OSError as error:
        raise MilestoneError(f"cannot read {purpose} file {path}: {error}") from error
    # A text file normally carries one terminal LF while GitHub's description value does not.
    return value.removesuffix("\n")


def print_json(value):
    print(json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True))
