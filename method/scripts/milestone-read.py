#!/usr/bin/env python3
"""Read a GitHub milestone by number, including empty and closed milestones (#537)."""

import argparse
import sys

sys.dont_write_bytecode = True

from milestone_common import MilestoneError, print_json, read_milestone, resolve_repo


def main():
    parser = argparse.ArgumentParser(description="Read one GitHub milestone by number.")
    parser.add_argument("number", type=int)
    parser.add_argument("--repo")
    arguments = parser.parse_args()
    repo = resolve_repo(arguments.repo)
    milestone = read_milestone(repo, arguments.number)
    print_json({
        "number": milestone["number"],
        "title": milestone["title"],
        "description": milestone["description"],
        "state": milestone["state"],
        "open_issues": milestone["open_issues"],
        "closed_issues": milestone["closed_issues"],
        "repository": repo,
    })


if __name__ == "__main__":
    try:
        main()
    except MilestoneError as error:
        print(error, file=sys.stderr)
        raise SystemExit(1) from error
