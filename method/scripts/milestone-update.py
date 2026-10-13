#!/usr/bin/env python3
"""Check then update a GitHub milestone description from file input (#537)."""

import argparse
import sys

sys.dont_write_bytecode = True

from milestone_common import MilestoneError, print_json, read_milestone, resolve_repo, text_from_file, update_milestone


def main():
    parser = argparse.ArgumentParser(description="Update one milestone description after a best-effort prior-text check.")
    parser.add_argument("number", type=int)
    parser.add_argument("--repo")
    parser.add_argument("--description-file", required=True)
    parser.add_argument("--expect-file", required=True)
    arguments = parser.parse_args()
    repo = resolve_repo(arguments.repo)
    current = read_milestone(repo, arguments.number)
    expected = text_from_file(arguments.expect_file, "expected-description")
    current_description = current["description"] or ""
    if current_description != expected:
        raise MilestoneError("milestone description was already stale when read; refusing to overwrite")
    description = text_from_file(arguments.description_file, "description")
    updated = update_milestone(repo, arguments.number, description=description)
    print_json({
        "action": "updated-description",
        "repository": repo,
        "number": arguments.number,
        "previous_description": current_description,
        "milestone": updated,
    })


if __name__ == "__main__":
    try:
        main()
    except MilestoneError as error:
        print(error, file=sys.stderr)
        raise SystemExit(1) from error
