#!/usr/bin/env python3
"""Create one GitHub milestone through the reviewed raw-API route (#375, #537).

THIS ROUTE WORKS BECAUSE A HOLE IS OPEN. Neither the permission matcher nor the
guard reads inside a Python script, so this reviewed, single-purpose route is an
accepted use of a raw-API capability that remains generally available. It does
not mean the raw-API route is closed.

The description arrives by file. There is deliberately no inline description
option: tracker text can contain shell syntax, and the shorter unsafe form must
not remain available for a later caller to choose.
"""

import argparse
import json
import sys

sys.dont_write_bytecode = True

from milestone_common import MilestoneError, parse_json, print_json, resolve_repo, run_gh, text_from_file


def parser():
    value = argparse.ArgumentParser(description="Create one GitHub milestone.")
    value.add_argument("title")
    value.add_argument("--repo")
    value.add_argument("--description-file")
    return value


def main():
    arguments = parser().parse_args()
    repo = resolve_repo(arguments.repo)
    raw = run_gh(["api", f"repos/{repo}/milestones?state=all&per_page=100", "--paginate", "--slurp"])
    try:
        pages = json.loads(raw)
    except json.JSONDecodeError as error:
        raise MilestoneError(f"gh returned invalid JSON while listing milestones: {error}") from error
    if not isinstance(pages, list) or any(not isinstance(page, list) for page in pages):
        raise MilestoneError("gh returned an invalid milestone list")
    if any(item.get("title") == arguments.title for page in pages for item in page if isinstance(item, dict)):
        raise MilestoneError(f'a milestone titled "{arguments.title}" already exists in {repo}')
    command = ["api", f"repos/{repo}/milestones", "-X", "POST", "-f", f"title={arguments.title}"]
    if arguments.description_file:
        command.extend(["-f", f"description={text_from_file(arguments.description_file, 'description')}"])
    created = parse_json(run_gh(command), "creating the milestone")
    print_json({"action": "created", "repository": repo, "milestone": created})


if __name__ == "__main__":
    try:
        main()
    except MilestoneError as error:
        print(error, file=sys.stderr)
        raise SystemExit(1) from error
