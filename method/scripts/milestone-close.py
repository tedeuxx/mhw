#!/usr/bin/env python3
"""Close one open GitHub milestone through the reviewed route (#537)."""

import argparse
import sys

sys.dont_write_bytecode = True

from milestone_common import MilestoneError, print_json, read_milestone, resolve_repo, update_milestone


def main():
    parser = argparse.ArgumentParser(description="Close one GitHub milestone after verifying it is open.")
    parser.add_argument("number", type=int)
    parser.add_argument("--repo")
    arguments = parser.parse_args()
    repo = resolve_repo(arguments.repo)
    current = read_milestone(repo, arguments.number)
    if current["state"] != "open":
        raise MilestoneError(f'milestone #{arguments.number} is {current["state"]}; refusing to close it again')
    updated = update_milestone(repo, arguments.number, state="closed")
    print_json({
        "action": "closed",
        "repository": repo,
        "number": arguments.number,
        "previous_state": current["state"],
        "milestone": updated,
    })


if __name__ == "__main__":
    try:
        main()
    except MilestoneError as error:
        print(error, file=sys.stderr)
        raise SystemExit(1) from error
