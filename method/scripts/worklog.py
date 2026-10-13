#!/usr/bin/env python3
"""Offline worklog event validator, export composer and deterministic sprint reporter."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from datetime import datetime
from pathlib import Path
from typing import Any

EVENT_MARKER = "<!-- worklog-event:v1 -->"
# An envelope is the marker ALONE ON ITS OWN LINE, which is how prepare-event emits it (#515). A marker quoted
# inside a sentence — `the <!-- worklog-event:v1 --> marker opens an event` — is prose, not an envelope, and
# used to abort the whole report as a "malformed worklog event body". A marker on its own line with no event
# fence after it is still malformed and still fails: only the prose form is released.
EVENT_RE = re.compile(r"^<!-- worklog-event:v1 -->[ \t]*\r?\n\s*```json\s*(\{.*?\})\s*```", re.S | re.M)
EVENT_MARKER_RE = re.compile(r"^<!-- worklog-event:v([^\s]+) -->[ \t]*\r?$", re.M)
EXPORT_URL_RE = re.compile(r"^https://github\.com/([^/\s]+/[^/\s]+)/issues/([1-9][0-9]*)$")
COMMENT_URL_RE = re.compile(r"^(https://github\.com/[^/\s]+/[^/\s]+/issues/[1-9][0-9]*)#issuecomment-([1-9][0-9]*)$")
ISSUE_RE = re.compile(r"^[^/\s]+/[^#\s]+#[1-9][0-9]*$")
REPO_RE = re.compile(r"^[^/\s]+/[^/#\s]+$")
SHA_RE = re.compile(r"^[0-9a-f]{7,40}$")
HASH_RE = re.compile(r"^[0-9a-f]{64}$")
VERSION = "1.0.0"
EVENT_TYPES = {"implementation_start", "checkpoint", "handoff", "outcome", "correction"}
OUTCOMES = {"accepted", "reopened", "cancelled", "superseded", "no_longer_relevant"}
PROVENANCE = {"observed", "declared", "unknown"}
PRIVATE_EVIDENCE = re.compile(r"(?:^|[\s`])(?:/Users/|/private/tmp/|file://|\.brand/)")
# The READER filter above is kept as it was, so retained history still reads. The PRODUCER filter below
# is stricter: it matches anywhere in a token, case-insensitively, and covers the other spellings of a
# machine-local location. It is a string check — copied private CONTENT carries none of these and passes.
STRICT_PRIVATE = re.compile(
    r"/tmp/|~/|/var/folders/|/home/|/Users/|/private/|file://|\.brand(?![A-Za-z0-9_-])|\b[A-Za-z]:\\", re.I)
# Continuity between sessions (#514). `next_act` is the one free-text field a resuming session acts on,
# so it is bounded: one line, public, at most FREE_TEXT_LIMIT characters, STRICT_PRIVATE everywhere it
# appears (it has no retained history to protect). The same bound applies to each evidence entry, but
# only when an event is PREPARED — retained history is read as it was written.
CONTINUITY_TYPES = {"checkpoint", "handoff"}
FREE_TEXT_LIMIT = 280


class ContractError(ValueError):
    pass


def canonical(value: Any) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def digest(value: Any) -> str:
    return hashlib.sha256(canonical(value).encode()).hexdigest()


def load(path: str) -> Any:
    try:
        return json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ContractError(f"cannot read JSON {path}: {exc}") from exc


def require(obj: dict[str, Any], fields: list[str], where: str) -> None:
    missing = [field for field in fields if field not in obj]
    if missing:
        raise ContractError(f"{where}: missing {', '.join(missing)}")


def nonempty_string(value: Any, where: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ContractError(f"{where}: must be a non-empty string")
    return value


def public_strings(value: Any, where: str, *, nonempty: bool = False) -> list[str]:
    if not isinstance(value, list) or not all(isinstance(item, str) for item in value):
        raise ContractError(f"{where}: must be a string array")
    if nonempty and not value:
        raise ContractError(f"{where}: must not be empty")
    if any(not item.strip() for item in value):
        raise ContractError(f"{where}: entries must be non-empty strings")
    if any(PRIVATE_EVIDENCE.search(item) for item in value):
        raise ContractError(f"{where}: contains private or machine-local material")
    return value


def bounded_line(value: Any, where: str) -> str:
    nonempty_string(value, where)
    if "\n" in value or "\r" in value:
        raise ContractError(f"{where}: must be a single line")
    if len(value) > FREE_TEXT_LIMIT:
        raise ContractError(f"{where}: must be at most {FREE_TEXT_LIMIT} characters")
    if STRICT_PRIVATE.search(value):
        raise ContractError(f"{where}: contains private or machine-local material")
    return value


def validate_prepared(event: dict[str, Any], where: str = "event") -> dict[str, Any]:
    """Producer-side bounds for a NEW event. Readers of retained history do not apply them.

    A correction is checked on its own fields AND on the event it carries, because the report reads the
    corrected event as the effective one — otherwise wrapping a handoff in a correction skips every bound.
    """
    if event["event_type"] == "handoff":
        require(event, ["next_act"], where)
    for index, item in enumerate(event["evidence"]):
        bounded_line(item, f"{where}.evidence[{index}]")
    for index, item in enumerate(event.get("acceptance_evidence", [])):
        if STRICT_PRIVATE.search(item):
            raise ContractError(f"{where}.acceptance_evidence[{index}]: contains private or machine-local material")
    if event["event_type"] == "correction":
        validate_prepared(event["corrected_event"], f"{where}.corrected_event")
    return event


def harness_key(value: str) -> str:
    """The cohort identity of a declared harness (#515).

    `harness` is free text, so `Kiro` and `kiro` on one Issue used to make a `mixed` cohort. The key folds case
    and drops everything but ASCII letters and digits, so `Claude Code`, `claude-code` and `ClaudeCode` are one
    harness. A value that folds to nothing is treated as `unknown`. The report keeps the value as written in
    every segment; only the cohort comparison uses the key.
    """
    key = re.sub(r"[^0-9a-z]", "", value.casefold())
    return key or "unknown"


def timestamp(value: Any, where: str) -> datetime:
    if not isinstance(value, str) or not value.endswith("Z"):
        raise ContractError(f"{where}: timestamp must be UTC and end in Z")
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as exc:
        raise ContractError(f"{where}: invalid timestamp") from exc


def validate_identity(identity: Any, where: str) -> None:
    if not isinstance(identity, dict):
        raise ContractError(f"{where}: attribution must be an object")
    require(identity, ["harness", "runtime_version", "plugin", "persona", "provenance"], where)
    nonempty_string(identity["provenance"], f"{where}.provenance")
    if identity["provenance"] not in PROVENANCE:
        raise ContractError(f"{where}: invalid provenance")
    for field in ("harness", "runtime_version", "persona"):
        nonempty_string(identity[field], f"{where}.{field}")
    if not isinstance(identity["plugin"], dict):
        raise ContractError(f"{where}: plugin must be an object")
    require(identity["plugin"], ["version", "source_revision"], f"{where}.plugin")
    nonempty_string(identity["plugin"]["version"], f"{where}.plugin.version")
    nonempty_string(identity["plugin"]["source_revision"], f"{where}.plugin.source_revision")


def validate_event(event: Any, where: str = "event") -> dict[str, Any]:
    if not isinstance(event, dict):
        raise ContractError(f"{where}: must be an object")
    require(event, ["schema_version", "event_id", "issue", "timestamp", "event_type", "stage",
                    "run_id", "attempt_id", "attribution", "revision", "evidence", "handoff"], where)
    if type(event["schema_version"]) is not int or event["schema_version"] != 1:
        raise ContractError(f"{where}: unsupported schema_version {event['schema_version']!r}")
    nonempty_string(event["event_id"], f"{where}.event_id")
    if not isinstance(event["issue"], str) or not ISSUE_RE.fullmatch(event["issue"]):
        raise ContractError(f"{where}: issue must be owner/repo#number")
    timestamp(event["timestamp"], where)
    nonempty_string(event["event_type"], f"{where}.event_type")
    if event["event_type"] not in EVENT_TYPES:
        raise ContractError(f"{where}: invalid event_type")
    for field in ("stage", "run_id", "attempt_id"):
        nonempty_string(event[field], f"{where}.{field}")
    for field in ("predecessor_event_id", "resume_of_event_id"):
        if field in event and event[field] is not None:
            nonempty_string(event[field], f"{where}.{field}")
    validate_identity(event["attribution"], f"{where}.attribution")
    revision = event["revision"]
    if not isinstance(revision, dict):
        raise ContractError(f"{where}.revision: must be an object")
    require(revision, ["repository", "branch", "commit"], f"{where}.revision")
    if not isinstance(revision["repository"], str) or not REPO_RE.fullmatch(revision["repository"]):
        raise ContractError(f"{where}.revision: repository must be owner/repo")
    nonempty_string(revision["branch"], f"{where}.revision.branch")
    if revision["commit"] not in (None, "unknown") and not SHA_RE.fullmatch(str(revision["commit"])):
        raise ContractError(f"{where}.revision: commit must be a git SHA, unknown, or null")
    public_strings(event["evidence"], f"{where}.evidence")
    if "acceptance_evidence" in event:
        public_strings(event["acceptance_evidence"], f"{where}.acceptance_evidence")
    if not isinstance(event["handoff"], dict):
        raise ContractError(f"{where}: handoff must be an object")
    require(event["handoff"], ["state", "to"], f"{where}.handoff")
    nonempty_string(event["handoff"]["state"], f"{where}.handoff.state")
    if event["handoff"]["to"] is not None:
        nonempty_string(event["handoff"]["to"], f"{where}.handoff.to")
    if "next_act" in event:
        if event["event_type"] not in CONTINUITY_TYPES:
            raise ContractError(f"{where}: next_act is only valid on checkpoint and handoff events")
        bounded_line(event["next_act"], f"{where}.next_act")
    if event["event_type"] == "implementation_start":
        require(event, ["frozen_estimate"], where)
        estimate = event["frozen_estimate"]
        if not isinstance(estimate, dict):
            raise ContractError(f"{where}.frozen_estimate: must be an object")
        require(estimate, ["points", "provenance", "commitment_points"], f"{where}.frozen_estimate")
        if type(estimate["points"]) is not int or estimate["points"] <= 0:
            raise ContractError(f"{where}.frozen_estimate: points must be a positive integer")
        if type(estimate["commitment_points"]) is not int or estimate["commitment_points"] <= 0:
            raise ContractError(f"{where}.frozen_estimate: commitment_points must be a positive integer")
        nonempty_string(estimate["provenance"], f"{where}.frozen_estimate.provenance")
    elif "frozen_estimate" in event:
        raise ContractError(f"{where}: frozen_estimate is only valid on implementation_start")
    if event["event_type"] == "outcome":
        require(event, ["outcome"], where)
        nonempty_string(event["outcome"], f"{where}.outcome")
        if event["outcome"] not in OUTCOMES:
            raise ContractError(f"{where}: invalid outcome")
        if event["outcome"] == "accepted":
            require(event, ["completion_sprint", "acceptance_evidence"], where)
            nonempty_string(event["completion_sprint"], f"{where}.completion_sprint")
            public_strings(event["acceptance_evidence"], f"{where}.acceptance_evidence", nonempty=True)
        elif "completion_sprint" in event or "acceptance_evidence" in event:
            raise ContractError(f"{where}: completion evidence is only valid on accepted outcomes")
    elif any(field in event for field in ("outcome", "completion_sprint", "acceptance_evidence")):
        raise ContractError(f"{where}: outcome fields are only valid on outcome events")
    if event["event_type"] == "correction":
        require(event, ["supersedes_event_id", "corrected_event"], where)
        nonempty_string(event["supersedes_event_id"], f"{where}.supersedes_event_id")
        validate_event(event["corrected_event"], f"{where}.corrected_event")
        if event["corrected_event"]["event_type"] == "correction":
            raise ContractError(f"{where}: corrected_event cannot itself be a correction")
        if event["corrected_event"]["event_id"] == event["event_id"]:
            raise ContractError(f"{where}: correction and corrected event IDs must differ")
    elif "supersedes_event_id" in event or "corrected_event" in event:
        raise ContractError(f"{where}: correction fields are only valid on correction events")
    return event


def validate_snapshot(snapshot: Any) -> dict[str, Any]:
    if not isinstance(snapshot, dict):
        raise ContractError("snapshot: must be an object")
    require(snapshot, ["schema_version", "sprint", "timezone", "starts_at", "ends_at",
                       "repositories", "counting_units"], "snapshot")
    if type(snapshot["schema_version"]) is not int or snapshot["schema_version"] != 1:
        raise ContractError("snapshot: unsupported schema_version")
    nonempty_string(snapshot["sprint"], "snapshot.sprint")
    nonempty_string(snapshot["timezone"], "snapshot.timezone")
    if snapshot["starts_at"] is not None:
        timestamp(snapshot["starts_at"], "snapshot.starts_at")
    if snapshot["ends_at"] is not None:
        timestamp(snapshot["ends_at"], "snapshot.ends_at")
    if not isinstance(snapshot["repositories"], list) or not snapshot["repositories"]:
        raise ContractError("snapshot: repositories must be a non-empty array")
    repositories: set[str] = set()
    for index, repo in enumerate(snapshot["repositories"]):
        if not isinstance(repo, dict):
            raise ContractError(f"snapshot.repositories[{index}]: must be an object")
        require(repo, ["repository", "milestone_number"], f"snapshot.repositories[{index}]")
        if not isinstance(repo["repository"], str) or not REPO_RE.fullmatch(repo["repository"]):
            raise ContractError(f"snapshot.repositories[{index}].repository: must be owner/repo")
        if repo["repository"] in repositories:
            raise ContractError(f"snapshot: duplicate repository {repo['repository']}")
        repositories.add(repo["repository"])
        if type(repo["milestone_number"]) is not int or repo["milestone_number"] <= 0:
            raise ContractError(f"snapshot.repositories[{index}].milestone_number: must be a positive integer")
    if not isinstance(snapshot["counting_units"], list):
        raise ContractError("snapshot: counting_units must be an array")
    seen: set[str] = set()
    for index, unit in enumerate(snapshot["counting_units"]):
        if not isinstance(unit, dict):
            raise ContractError(f"snapshot.counting_units[{index}]: must be an object")
        require(unit, ["issue", "planned_points", "work_type", "parent"], f"snapshot.counting_units[{index}]")
        if not isinstance(unit["issue"], str) or not ISSUE_RE.fullmatch(unit["issue"]):
            raise ContractError(f"snapshot.counting_units[{index}].issue: must be owner/repo#number")
        if unit["issue"].split("#")[0] not in repositories:
            raise ContractError(f"snapshot.counting_units[{index}]: issue repository is not declared")
        if type(unit["planned_points"]) is not int or unit["planned_points"] <= 0:
            raise ContractError(f"snapshot.counting_units[{index}].planned_points: must be a positive integer")
        nonempty_string(unit["work_type"], f"snapshot.counting_units[{index}].work_type")
        if unit["parent"] is not None and (not isinstance(unit["parent"], str) or not ISSUE_RE.fullmatch(unit["parent"])):
            raise ContractError(f"snapshot.counting_units[{index}].parent: must be owner/repo#number or null")
        if unit["issue"] in seen:
            raise ContractError(f"snapshot: duplicate counting unit {unit['issue']}")
        seen.add(unit["issue"])
    for unit in snapshot["counting_units"]:
        if unit["parent"] in seen:
            raise ContractError(f"snapshot: parent/child overlap {unit['parent']} and {unit['issue']}")
    return snapshot


def extract_events(export: Any) -> tuple[list[dict[str, Any]], list[str], dict[str, Any]]:
    if not isinstance(export, dict):
        raise ContractError("export: must be an object")
    require(export, ["schema_version", "cutoff", "repositories", "prior_inventory", "comments"], "export")
    if type(export["schema_version"]) is not int or export["schema_version"] != 1:
        raise ContractError("export: unsupported schema_version")
    cutoff = timestamp(export["cutoff"], "export.cutoff")
    warnings: list[str] = []
    if not isinstance(export["repositories"], list):
        raise ContractError("export.repositories: must be an array")
    if not export["repositories"]:
        warnings.append("missing repositories: export declares no repository source")
    exported_repositories: set[str] = set()
    for index, repo in enumerate(export["repositories"]):
        if not isinstance(repo, dict):
            raise ContractError(f"export.repositories[{index}]: must be an object")
        require(repo, ["repository", "pagination_complete"], f"export.repositories[{index}]")
        if not isinstance(repo["repository"], str) or not REPO_RE.fullmatch(repo["repository"]):
            raise ContractError(f"export.repositories[{index}].repository: must be owner/repo")
        if repo["repository"] in exported_repositories:
            raise ContractError(f"export: duplicate repository {repo['repository']}")
        exported_repositories.add(repo["repository"])
        if type(repo["pagination_complete"]) is not bool:
            raise ContractError(f"export.repositories[{index}].pagination_complete: must be a boolean")
        if not repo["pagination_complete"]:
            warnings.append(f"incomplete pagination: {repo['repository']}")
    prior = export["prior_inventory"]
    if not isinstance(prior, dict):
        raise ContractError("export.prior_inventory: must be an object")
    require(prior, ["complete", "comment_ids"], "export.prior_inventory")
    if type(prior["complete"]) is not bool:
        raise ContractError("export.prior_inventory.complete: must be a boolean")
    if not isinstance(prior["comment_ids"], list):
        raise ContractError("export.prior_inventory.comment_ids: must be an array")
    if not all((type(comment_id) is int) or
               (isinstance(comment_id, str) and bool(comment_id.strip()))
               for comment_id in prior["comment_ids"]):
        raise ContractError("export.prior_inventory.comment_ids: entries must be strings or integers")
    if not prior["complete"]:
        warnings.append("historical integrity unknown: prior inventory is absent or incomplete")
    comments = export["comments"]
    if not isinstance(comments, list):
        raise ContractError("export.comments: must be an array")
    records: list[dict[str, Any]] = []
    current_comment_ids: set[Any] = set()
    for index, comment in enumerate(comments):
        if not isinstance(comment, dict):
            raise ContractError(f"comment[{index}]: must be an object")
        require(comment, ["repository", "issue", "comment_id", "created_at", "updated_at", "body", "body_sha256"],
                f"comment[{index}]")
        if not isinstance(comment["repository"], str) or not REPO_RE.fullmatch(comment["repository"]):
            raise ContractError(f"comment[{index}].repository: must be owner/repo")
        if comment["repository"] not in exported_repositories:
            warnings.append(f"comment source repository is not declared: {comment['repository']}")
        if not isinstance(comment["issue"], str) or not ISSUE_RE.fullmatch(comment["issue"]):
            raise ContractError(f"comment[{index}].issue: must be owner/repo#number")
        if comment["issue"].split("#")[0] != comment["repository"]:
            raise ContractError(f"comment[{index}]: issue disagrees with repository")
        if not isinstance(comment["comment_id"], (str, int)) or isinstance(comment["comment_id"], bool):
            raise ContractError(f"comment[{index}].comment_id: must be a string or integer")
        created_at = timestamp(comment["created_at"], f"comment[{index}].created_at")
        if comment["updated_at"] is None:
            warnings.append(f"comment edit timestamp unavailable: comment {comment['comment_id']}")
            updated_at = created_at
        else:
            updated_at = timestamp(comment["updated_at"], f"comment[{index}].updated_at")
        if updated_at < created_at:
            raise ContractError(f"comment[{index}]: updated_at precedes created_at")
        if not isinstance(comment["body"], str):
            raise ContractError(f"comment[{index}].body: must be a string")
        if not isinstance(comment["body_sha256"], str) or not HASH_RE.fullmatch(comment["body_sha256"]):
            raise ContractError(f"comment[{index}].body_sha256: must be a SHA-256 hex digest")
        body_hash = hashlib.sha256(comment["body"].encode()).hexdigest()
        current_comment_ids.add(comment["comment_id"])
        if body_hash != comment["body_sha256"]:
            raise ContractError(f"comment[{index}]: body hash mismatch; record was edited or input is corrupt")
        if comment["updated_at"] is not None and comment["created_at"] != comment["updated_at"]:
            warnings.append(f"edited historical record: comment {comment['comment_id']}")
        marker_versions = EVENT_MARKER_RE.findall(comment["body"])
        unsupported = [version for version in marker_versions if version != "1"]
        if unsupported:
            raise ContractError(f"comment[{index}]: unsupported worklog marker version v{unsupported[0]}")
        matches = EVENT_RE.findall(comment["body"])
        if marker_versions and len(marker_versions) != len(matches):
            raise ContractError(f"comment[{index}]: malformed worklog event body")
        for match in matches:
            try:
                event = json.loads(match)
            except json.JSONDecodeError as exc:
                raise ContractError(f"comment[{index}]: invalid event JSON: {exc}") from exc
            event = validate_event(event, f"comment[{index}].event")
            if event["issue"] != comment["issue"] or event["issue"].split("#")[0] != comment["repository"]:
                raise ContractError(f"comment[{index}]: event issue disagrees with comment source")
            effective_at = timestamp(event["timestamp"], f"comment[{index}].event.timestamp")
            if created_at <= cutoff and effective_at <= cutoff:
                if event["event_type"] != "correction" or timestamp(
                        event["corrected_event"]["timestamp"], f"comment[{index}].event.corrected_event.timestamp") <= cutoff:
                    records.append({"event": event, "source": {
                        "repository": comment["repository"], "issue": comment["issue"],
                        "comment_id": comment["comment_id"], "created_at": comment["created_at"],
                        "updated_at": comment["updated_at"], "body_sha256": comment["body_sha256"]},
                        "available_at": comment["created_at"]})
    prior_ids = set(prior.get("comment_ids", [])) if isinstance(prior, dict) else set()
    deleted = sorted(prior_ids - current_comment_ids, key=str)
    if deleted:
        warnings.append("deleted historical records: " + ", ".join(map(str, deleted)))
    return records, warnings, export


def retained_graph(records: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], list[dict[str, Any]], set[str]]:
    """Validate the full retained ledger before deriving its effective leaves."""
    unique: dict[str, dict[str, Any]] = {}
    order: list[str] = []
    for record in records:
        event = record["event"]
        event_id = event["event_id"]
        if event_id in unique:
            if canonical(unique[event_id]["event"]) != canonical(event):
                raise ContractError(f"conflicting content for event_id {event_id}")
            continue
        unique[event_id] = record
        order.append(event_id)

    semantic = {event_id: record for event_id, record in unique.items()
                if record["event"]["event_type"] != "correction"}
    retained_ids = set(unique)
    corrections: list[dict[str, Any]] = []
    for event_id in order:
        record = unique[event_id]
        event = record["event"]
        if event["event_type"] == "correction":
            replacement = event["corrected_event"]
            replacement_id = replacement["event_id"]
            if replacement_id in retained_ids:
                raise ContractError(f"correction {event_id}: replacement event_id collision {replacement_id}")
            retained_ids.add(replacement_id)
            semantic[replacement_id] = {
                "event": replacement, "source": record["source"],
                "available_at": record["available_at"], "correction_event_id": event_id}
            corrections.append(record)

    successors: dict[str, str] = {}
    for record in corrections:
        event = record["event"]
        event_id = event["event_id"]
        target = event["supersedes_event_id"]
        replacement = event["corrected_event"]
        if target not in semantic:
            raise ContractError(f"correction {event_id}: missing superseded event {target}")
        if target in successors:
            raise ContractError(f"correction {event_id}: event {target} already superseded")
        if semantic[target]["event"]["issue"] != event["issue"] or replacement["issue"] != event["issue"]:
            raise ContractError(f"correction {event_id}: target and replacement must belong to {event['issue']}")
        successors[target] = replacement["event_id"]

    for start in successors:
        seen: set[str] = set()
        node = start
        while node in successors:
            if node in seen:
                raise ContractError(f"correction graph: cycle at {node}")
            seen.add(node)
            node = successors[node]

    effective = [record for event_id, record in semantic.items() if event_id not in successors]
    effective.sort(key=lambda item: (item["event"]["timestamp"], item["event"]["event_id"]))
    return effective, [unique[event_id] for event_id in order], retained_ids


def latest_outcome(events: list[dict[str, Any]]) -> dict[str, Any] | None:
    outcomes = [event for event in events if event["event_type"] == "outcome"]
    return outcomes[-1] if outcomes else None


def project_segment(record: dict[str, Any]) -> dict[str, Any]:
    event = record["event"]
    projected = {key: value for key, value in event.items() if key != "corrected_event"}
    projected["available_at"] = record["available_at"]
    projected["source"] = record["source"]
    if event["event_type"] == "correction":
        projected["corrected_event"] = event["corrected_event"]
    return projected


def report(snapshot: dict[str, Any], export: dict[str, Any], reproduction: str) -> dict[str, Any]:
    snapshot = validate_snapshot(snapshot)
    records, warnings, raw_export = extract_events(export)
    effective_records, ledger, retained_ids = retained_graph(records)
    current = [record["event"] for record in effective_records]
    for record in ledger:
        event = record["event"]
        nodes = [event] + ([event["corrected_event"]] if event["event_type"] == "correction" else [])
        for node in nodes:
            for field in ("predecessor_event_id", "resume_of_event_id"):
                reference = node.get(field)
                if reference and reference not in retained_ids:
                    warnings.append(f"missing {field} {reference} referenced by {node['event_id']}")
    by_issue: dict[str, list[dict[str, Any]]] = {}
    for event in current:
        by_issue.setdefault(event["issue"], []).append(event)
    ledger_by_issue: dict[str, list[dict[str, Any]]] = {}
    for record in ledger:
        ledger_by_issue.setdefault(record["event"]["issue"], []).append(record)
    units = {unit["issue"]: unit for unit in snapshot["counting_units"]}
    expected_repositories = {repo["repository"] for repo in snapshot["repositories"]}
    exported_repositories = {repo["repository"] for repo in raw_export["repositories"]}
    for repository in sorted(expected_repositories - exported_repositories):
        warnings.append(f"missing repository: {repository}")
    completed = planned = carryover = scope_changes = 0
    unestimated: list[str] = []
    mismatched: list[dict[str, str]] = []
    excluded: list[dict[str, str]] = []
    cohorts = {"sole": 0, "mixed": 0, "unknown": 0}
    cohort_items = {"sole": 0, "mixed": 0, "unknown": 0}
    items: list[dict[str, Any]] = []
    work_types: dict[str, int] = {}
    for issue, unit in units.items():
        planned += unit["planned_points"]
        issue_events = by_issue.get(issue, [])
        issue_ledger = ledger_by_issue.get(issue, [])
        if not issue_ledger:
            warnings.append(f"missing worklog history: {issue}")
        starts = [event for event in issue_events if event["event_type"] == "implementation_start"]
        if not starts:
            frozen = None
            if issue_ledger:
                warnings.append(f"missing frozen estimate: {issue}")
        else:
            frozen_values = {event["frozen_estimate"]["points"] for event in starts}
            if len(frozen_values) != 1:
                raise ContractError(f"{issue}: multiple uncorrected frozen estimates")
            frozen = next(iter(frozen_values))
            if frozen != unit["planned_points"]:
                scope_changes += 1
        harnesses = {harness_key(event["attribution"]["harness"]) for event in issue_events
                     if event["attribution"]["provenance"] != "unknown"
                     and harness_key(event["attribution"]["harness"]) != "unknown"}
        unknown = any(event["attribution"]["provenance"] == "unknown"
                      or harness_key(event["attribution"]["harness"]) == "unknown" for event in issue_events)
        if unknown:
            warnings.append(f"incomplete attribution coverage: {issue}")
        if not issue_events or (unknown and len(harnesses) <= 1):
            cohort = "unknown"
        elif len(harnesses) > 1:
            cohort = "mixed"
        elif len(harnesses) == 1 and not unknown:
            cohort = "sole"
        else:
            cohort = "unknown"
        cohort_items[cohort] += 1
        outcome = latest_outcome(issue_events)
        accepted = bool(outcome and outcome["outcome"] == "accepted")
        credited = bool(accepted and outcome.get("completion_sprint") == snapshot["sprint"] and frozen is not None)
        if credited:
            completed += frozen
            cohorts[cohort] += frozen
            work_types[unit["work_type"]] = work_types.get(unit["work_type"], 0) + frozen
        elif accepted and outcome.get("completion_sprint") != snapshot["sprint"]:
            # #515: an acceptance naming ANOTHER sprint earns nothing here, and it used to fall silently into
            # carryover with the report still COMPLETE — a mistyped sprint name read as zero delivery. It still
            # carries over (a later sprint's acceptance is genuine carryover from this one), but it is named,
            # and the report is PARTIAL, so a zero produced by a name mismatch can never read as a real zero.
            mismatched.append({"issue": issue, "completion_sprint": outcome["completion_sprint"]})
            warnings.append(f"completion sprint mismatch: {issue} was accepted in "
                            f"{outcome['completion_sprint']}, not {snapshot['sprint']}; no credit here")
            carryover += frozen or 0
        elif accepted and frozen is None:
            unestimated.append(issue)
        elif outcome and outcome["outcome"] in {"cancelled", "superseded", "no_longer_relevant"}:
            excluded.append({"issue": issue, "reason": outcome["outcome"]})
        else:
            carryover += frozen or 0
        items.append({"issue": issue, "planned_points": unit["planned_points"], "points": frozen,
                      "frozen_estimate_provenance": starts[0]["frozen_estimate"]["provenance"] if starts else None,
                      "work_type": unit["work_type"], "cohort": cohort,
                      "outcome": outcome["outcome"] if outcome else "unknown", "credited": credited,
                      "segments": [project_segment(record) for record in issue_ledger]})
    unmapped = sorted(set(by_issue) - set(units))
    if unmapped:
        warnings.append("missing sprint mapping: " + ", ".join(unmapped))
    if snapshot["starts_at"] is None or snapshot["ends_at"] is None:
        warnings.append("sprint boundary is unknown: duration and points-per-week are not measured")
        duration_days = None
        points_per_week = None
    else:
        start = timestamp(snapshot["starts_at"], "snapshot.starts_at")
        end = timestamp(snapshot["ends_at"], "snapshot.ends_at")
        duration_days = (end - start).total_seconds() / 86400
        if duration_days <= 0:
            raise ContractError("snapshot: ends_at must follow starts_at")
        points_per_week = round(completed * 7 / duration_days, 6)
    partial = bool(warnings or unestimated or unmapped)
    return {
        "report_version": VERSION, "schema_version": 1, "sprint": snapshot["sprint"],
        "cutoff": raw_export["cutoff"], "partial": partial, "warnings": sorted(set(warnings)),
        "source": {"snapshot_sha256": digest(snapshot), "export_sha256": digest(raw_export),
                   "repositories": raw_export["repositories"],
                   "comment_ids": sorted((comment["comment_id"] for comment in raw_export["comments"]), key=str)},
        "reproduction_command": reproduction,
        "totals": {"planned_points": planned, "completed_points": completed,
                   "carryover_points": carryover, "scope_changes": scope_changes,
                   "unestimated_completions": sorted(unestimated),
                   "completion_sprint_mismatches": sorted(mismatched, key=lambda item: item["issue"]),
                   "cohort_points": cohorts,
                   "cohort_items": cohort_items,
                   "work_type_points": dict(sorted(work_types.items())),
                   "duration_days": duration_days,
                   "points_per_week": points_per_week},
        "excluded": excluded, "items": items,
    }


def build_export(captures: list[Any], cutoff: str, prior: Any = None,
                 pagination_complete: bool = False) -> dict[str, Any]:
    """Compose the `--export` input from saved tracker captures (#515). Offline: it reads, never fetches.

    Each capture is the stdout of `gh issue view <n> --repo <owner/repo> --json url,comments`, saved to a file.
    Three things a capture cannot say are carried as the reader's own partial-evidence states, never guessed:

    - edit time: the capture has no `updatedAt`. `includesCreatedEdit: false` (unedited, per GitHub's schema
      documentation — read, not measured) becomes `updated_at = created_at`; anything else becomes null, which
      the report already treats as unknown edit time and PARTIAL.
    - pagination: whether the capture held every comment is not observable from it, so `pagination_complete`
      is the operator's declaration, false unless `--pagination-complete` is given.
    - prior inventory: absent unless `--prior` names an earlier export; its comment IDs are kept only for the
      Issues captured now, so an Issue left out of this capture does not read as deleted history. It is marked
      complete only when the prior declared `pagination_complete` for every repository captured now; a truncated
      prior cannot vouch for history, so otherwise it stays incomplete and the report stays PARTIAL.
    """
    timestamp(cutoff, "export.cutoff")
    comments: list[dict[str, Any]] = []
    repositories: set[str] = set()
    issues: set[str] = set()
    for index, capture in enumerate(captures):
        where = f"capture[{index}]"
        if not isinstance(capture, dict):
            raise ContractError(f"{where}: must be an object")
        require(capture, ["url", "comments"], where)
        match = EXPORT_URL_RE.fullmatch(capture["url"]) if isinstance(capture["url"], str) else None
        if not match:
            raise ContractError(f"{where}.url: must be a GitHub issue URL; capture with --json url,comments")
        repository, issue = match.group(1), f"{match.group(1)}#{match.group(2)}"
        if issue in issues:
            raise ContractError(f"{where}: {issue} is captured twice")
        issues.add(issue)
        repositories.add(repository)
        if not isinstance(capture["comments"], list):
            raise ContractError(f"{where}.comments: must be an array")
        for position, comment in enumerate(capture["comments"]):
            at = f"{where}.comments[{position}]"
            if not isinstance(comment, dict):
                raise ContractError(f"{at}: must be an object")
            require(comment, ["url", "createdAt", "body"], at)
            found = COMMENT_URL_RE.fullmatch(comment["url"]) if isinstance(comment["url"], str) else None
            if not found or found.group(1) != capture["url"]:
                raise ContractError(f"{at}.url: must be a comment URL on {capture['url']}")
            timestamp(comment["createdAt"], f"{at}.createdAt")
            if not isinstance(comment["body"], str):
                raise ContractError(f"{at}.body: must be a string")
            unedited = comment.get("includesCreatedEdit") is False
            comments.append({"repository": repository, "issue": issue, "comment_id": int(found.group(2)),
                             "created_at": comment["createdAt"],
                             "updated_at": comment["createdAt"] if unedited else None,
                             "body": comment["body"],
                             "body_sha256": hashlib.sha256(comment["body"].encode()).hexdigest()})
    if prior is None:
        inventory = {"complete": False, "comment_ids": []}
    else:
        extract_events(prior)
        # An inventory is only as complete as the capture it came from: a prior whose own pagination was not
        # declared complete, or that never captured a repository captured now, cannot vouch for history.
        prior_complete = {repo["repository"] for repo in prior["repositories"] if repo["pagination_complete"]}
        inventory = {"complete": repositories <= prior_complete, "comment_ids": sorted(
            {comment["comment_id"] for comment in prior["comments"] if comment["issue"] in issues}, key=str)}
    comments.sort(key=lambda item: (item["issue"], item["created_at"], str(item["comment_id"])))
    export = {"schema_version": 1, "cutoff": cutoff,
              "repositories": [{"repository": repository, "pagination_complete": pagination_complete}
                               for repository in sorted(repositories)],
              "prior_inventory": inventory, "comments": comments}
    extract_events(export)  # what this produces, the report must accept
    return export


def markdown(data: dict[str, Any]) -> str:
    status = "PARTIAL" if data["partial"] else "COMPLETE"
    totals = data["totals"]
    lines = [f"# {data['sprint']} worklog report", "", f"status: **{status}**",
             f"report version: `{data['report_version']}`", f"schema version: `{data['schema_version']}`",
             f"cutoff: `{data['cutoff']}`", f"snapshot sha256: `{data['source']['snapshot_sha256']}`",
             f"export sha256: `{data['source']['export_sha256']}`", "",
             f"- planned points: {totals['planned_points']}",
             f"- completed points: {totals['completed_points']}",
             f"- carryover points: {totals['carryover_points']}",
             f"- scope changes: {totals['scope_changes']}",
             f"- cohort points: `{canonical(totals['cohort_points'])}`",
             f"- cohort items: `{canonical(totals['cohort_items'])}`",
             f"- work-type points: `{canonical(totals['work_type_points'])}`",
             f"- unestimated completions: `{canonical(totals['unestimated_completions'])}`",
             f"- completion sprint mismatches: `{canonical(totals['completion_sprint_mismatches'])}`",
             f"- duration days: {totals['duration_days']}",
             f"- points per week: {totals['points_per_week']}", "", "## Sources", "",
             f"- repositories: `{canonical(data['source']['repositories'])}`",
             f"- comment IDs: `{canonical(data['source']['comment_ids'])}`", "", "## Warnings"]
    lines.extend([f"- {warning}" for warning in data["warnings"]] or ["- none"])
    lines.extend(["", "## Excluded", "", "```json",
                  json.dumps(data["excluded"], sort_keys=True, indent=2, ensure_ascii=False), "```",
                  "", "## Items and retained segments", "", "```json",
                  json.dumps(data["items"], sort_keys=True, indent=2, ensure_ascii=False), "```"])
    lines.extend(["", "## Reproduce", "", "```sh", data["reproduction_command"], "```", ""])
    return "\n".join(lines)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    validate = sub.add_parser("validate-event")
    validate.add_argument("event")
    prepare = sub.add_parser("prepare-event")
    prepare.add_argument("event")
    build = sub.add_parser("report")
    build.add_argument("--snapshot", required=True)
    build.add_argument("--export", required=True)
    build.add_argument("--format", choices=("json", "markdown"), default="json")
    build.add_argument("--reproduction-command", required=True)
    produce = sub.add_parser("export")
    produce.add_argument("--cutoff", required=True)
    produce.add_argument("--capture", action="append", required=True,
                         help="saved stdout of: gh issue view <n> --repo <owner/repo> --json url,comments")
    produce.add_argument("--prior", help="an earlier export, whose comment IDs become the prior inventory")
    produce.add_argument("--pagination-complete", action="store_true",
                         help="declare that every capture holds every comment; not observable from the capture")
    args = parser.parse_args()
    try:
        if args.command == "export":
            data = build_export([load(path) for path in args.capture], args.cutoff,
                                load(args.prior) if args.prior else None, args.pagination_complete)
            print(json.dumps(data, sort_keys=True, indent=2, ensure_ascii=False))
        elif args.command in {"validate-event", "prepare-event"}:
            event = validate_event(load(args.event))
            if args.command == "validate-event":
                print(canonical(event))
            else:
                validate_prepared(event)
                print(EVENT_MARKER)
                print("```json")
                print(json.dumps(event, sort_keys=True, indent=2, ensure_ascii=False))
                print("```")
        else:
            data = report(validate_snapshot(load(args.snapshot)), load(args.export), args.reproduction_command)
            print(json.dumps(data, sort_keys=True, indent=2, ensure_ascii=False) if args.format == "json" else markdown(data))
        return 0
    except ContractError as exc:
        print(f"worklog: error: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
