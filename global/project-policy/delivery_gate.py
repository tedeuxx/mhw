#!/usr/bin/env python3
"""The evidence gates of the reference CI/CD (ADR-0015 lock 4 of 5, Issue #246).

    python3 -B global/project-policy/delivery_gate.py contract    --project=DIR [--repository=OWNER/NAME]
    python3 -B global/project-policy/delivery_gate.py container   --project=DIR --evidence=FILE
                --revision=SHA --checkout-head=SHA --container-image=IMAGE [--require-container]
    python3 -B global/project-policy/delivery_gate.py installed-stg --project=DIR --evidence=FILE
                --revision=SHA --checkout-head=SHA
    python3 -B global/project-policy/delivery_gate.py classify    --project=DIR --rules=I[,J...]
    python3 -B global/project-policy/delivery_gate.py environment --name=ENV --protection=FILE

`mhw policy check` (lock 3) validates the contract a project declares and reads no evidence. This
script is what reads evidence: it applies a valid contract to one revision's results. Every command
re-validates the contract first, with the same validator, so a gate never runs on a broken one.

    exit 0  the gate passes; `classify` also prints `class=` and `approval=` lines for $GITHUB_OUTPUT
    exit 1  the gate blocks, one `BLOCK  <gate>: <reason>` line per reason on standard error
    exit 2  a usage error, or it cannot decide; it never answers "pass" when it cannot check

Fail closed throughout: a missing field, an unknown key, a result other than the literal `pass`, a
severity outside the scale and an unreadable file all block. The gates check that evidence is
complete, bound to the exact revision and inside the contract's floor. They cannot check that the
project's own test command told the truth; see docs/reference-cicd.md, "What it does not cover".
Standard library only, Python 3.9+, any operating system.
"""
import json
from pathlib import Path
import re
import sys

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import project_policy  # noqa: E402

SHA = re.compile(r"[0-9a-f]{40}")
IMAGE = re.compile(r"[^@\s]+@sha256:[0-9a-f]{64}")
BUG_ISSUE = re.compile(r"#[0-9]+|https://github\.com/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+/issues/[0-9]+")
SEVERITIES = project_policy.SEVERITIES
DOCKERENV = Path("/.dockerenv")

CONTAINER_KEYS = {"layer", "revision", "container_image", "test_layers", "coverage",
                  "critical_user_journeys", "risk_scenarios", "security_controls", "findings"}
INSTALLED_KEYS = {"layer", "revision", "stg_deployed_revision", "test_layers",
                  "critical_user_journeys", "risk_scenarios", "security_controls", "findings"}
FINDING_KEYS = {"id", "severity", "bug_issue"}


class Usage(Exception):
    """A usage error, or an input the gate cannot decide on: exit 2."""


# -- the contract ---------------------------------------------------------------------------------

def load_contract(project):
    """(contract, blocks). The contract is valid only when blocks is empty."""
    path = Path(project) / project_policy.FILE_NAME
    code, lines = project_policy.check(str(path))
    if code == 2:
        raise Usage("the validator cannot decide on %s: %s" % (path, "; ".join(lines)))
    if code != 0:
        return None, ["contract: %s" % line for line in lines]
    return json.loads(path.read_text(encoding="utf-8")), []


def madr_status_accepted(text):
    """True when the record's status line, with struck text removed, begins with `accepted`."""
    for line in text.splitlines():
        plain = re.sub(r"~~.*?~~", "", line).replace("*", "").strip().lstrip("-").strip()
        match = re.match(r"(?i)status\s*:\s*(.*)", plain)
        if match:
            return match.group(1).strip().lower().startswith("accepted")
    return False


def gate_contract(project, repository=None):
    """The contract is valid, governs this repository, and its MADR and runbook exist."""
    contract, blocks = load_contract(project)
    if blocks:
        return blocks
    if repository is not None and contract["project"] != repository:
        blocks.append("contract: it governs %s, this run is in %s" % (contract["project"], repository))
    madr = Path(project) / contract["madr"]["path"]
    try:
        text = madr.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError):
        blocks.append("contract: the project MADR %s is missing or unreadable" % contract["madr"]["path"])
    else:
        if not madr_status_accepted(text):
            blocks.append("contract: the project MADR %s has no status line reading accepted"
                          % contract["madr"]["path"])
    recovery = contract["recovery"]
    if recovery["mode"] == "manual":
        runbook = Path(project) / recovery["runbook"]["path"]
        if not runbook.is_file():
            blocks.append("contract: the recovery runbook %s is missing" % recovery["runbook"]["path"])
    return blocks


# -- evidence -------------------------------------------------------------------------------------

def read_evidence(path):
    try:
        raw = Path(path).read_bytes()
    except OSError as exc:
        return None, ["evidence: %s is missing or unreadable (%s)" % (path, exc.strerror or exc)]
    try:
        doc = json.loads(raw.decode("utf-8"), object_pairs_hook=project_policy._no_duplicates,
                         parse_constant=project_policy._no_constant)
    except (ValueError, project_policy.Refusal, RecursionError) as exc:
        return None, ["evidence: %s is malformed (%s)" % (path, exc)]
    if not isinstance(doc, dict):
        return None, ["evidence: %s is not a JSON object" % path]
    return doc, []


def _results(gate, doc, key, required, blocks, require_all=True):
    """Each required id is reported, and every reported result is the literal `pass`."""
    value = doc.get(key)
    if not isinstance(value, dict):
        blocks.append("%s: %s missing (an object of id -> result)" % (gate, key))
        return
    for name in required if require_all else ():
        if name not in value:
            blocks.append("%s: %s %s has no result (missing mandatory evidence)" % (gate, key, name))
    for name, result in sorted(value.items()):
        if require_all and name not in required:
            blocks.append("%s: %s %s is not in the contract" % (gate, key, name))
        elif result == "inconclusive":
            blocks.append("%s: %s %s is inconclusive (inconclusive evidence blocks)" % (gate, key, name))
        elif result != "pass":
            blocks.append("%s: %s %s is %s, not pass" % (gate, key, name, json.dumps(result)))


def _findings(gate, doc, contract, blocks):
    findings = doc.get("findings")
    if not isinstance(findings, list):
        blocks.append("%s: findings missing (a list, empty when there are none)" % gate)
        return
    tolerated = set(contract["severity"]["tolerated"])
    for index, finding in enumerate(findings):
        where = "%s: finding %d" % (gate, index)
        if not isinstance(finding, dict):
            blocks.append("%s is not an object" % where)
            continue
        unknown = sorted(set(finding) - FINDING_KEYS)
        if unknown:
            blocks.append("%s carries unknown key(s) %s" % (where, ", ".join(unknown)))
        severity = finding.get("severity")
        if severity is None:
            blocks.append("%s has no severity (unclassified findings block)" % where)
        elif severity not in SEVERITIES:
            blocks.append("%s severity %s is not on the scale (unknown severity)"
                          % (where, json.dumps(severity)))
        elif severity not in tolerated:
            blocks.append("%s is %s, which the contract does not tolerate" % (where, severity))
        elif not (isinstance(finding.get("bug_issue"), str)
                  and BUG_ISSUE.fullmatch(finding["bug_issue"])):
            blocks.append("%s is a tolerated low finding without a bug Issue" % where)


def _binding(gate, doc, revision, checkout_head, blocks):
    if not SHA.fullmatch(revision or ""):
        raise Usage("--revision must be a full 40-character commit SHA")
    if checkout_head != revision:
        blocks.append("%s: the checkout is at %s, not the revision %s" % (gate, checkout_head, revision))
    if doc.get("revision") != revision:
        blocks.append("%s: the evidence names revision %s, not %s"
                      % (gate, json.dumps(doc.get("revision")), revision))


def _common(gate, doc, contract, keys, layer, blocks):
    unknown = sorted(set(doc) - keys)
    if unknown:
        blocks.append("%s: evidence carries unknown key(s) %s" % (gate, ", ".join(unknown)))
    if doc.get("layer") != layer:
        blocks.append("%s: evidence layer is %s, not %s" % (gate, json.dumps(doc.get("layer")), layer))
    layers = doc.get("test_layers")
    if not isinstance(layers, dict) or not layers:
        blocks.append("%s: test_layers missing or empty (every applicable layer reports)" % gate)
    else:
        _results(gate, doc, "test_layers", (), blocks, require_all=False)
    scenarios = contract["mandatory_scenarios"]
    _results(gate, doc, "critical_user_journeys",
             [j["id"] for j in scenarios["critical_user_journeys"]], blocks)
    _results(gate, doc, "risk_scenarios", [r["id"] for r in scenarios["risk_scenarios"]], blocks)
    _findings(gate, doc, contract, blocks)


def gate_container(project, evidence, revision, checkout_head, image, require_container, dockerenv=None):
    """Containerised evidence for the exact revision, before STG and before PROD."""
    gate = "container"
    contract, blocks = load_contract(project)
    if blocks:
        return blocks
    doc, blocks = read_evidence(evidence)
    if blocks:
        return blocks
    if not IMAGE.fullmatch(image or ""):
        blocks.append("%s: image %s is not pinned by digest (name@sha256:<64 hex>)" % (gate, image))
    if require_container and not (dockerenv or DOCKERENV).exists():
        blocks.append("%s: this step is not running in a container" % gate)
    if doc.get("container_image") != image:
        blocks.append("%s: the evidence names image %s, not %s"
                      % (gate, json.dumps(doc.get("container_image")), image))
    _binding(gate, doc, revision, checkout_head, blocks)
    _common(gate, doc, contract, CONTAINER_KEYS, "container", blocks)
    coverage = doc.get("coverage")
    wanted = contract["coverage"]
    if not isinstance(coverage, dict) or set(coverage) != {"metric", "percent"}:
        blocks.append("%s: coverage missing (an object with metric and percent only)" % gate)
    elif coverage["metric"] != wanted["metric"]:
        blocks.append("%s: coverage is %s, the contract counts %s"
                      % (gate, json.dumps(coverage["metric"]), wanted["metric"]))
    elif (isinstance(coverage["percent"], bool) or not isinstance(coverage["percent"], (int, float))
          or coverage["percent"] < wanted["threshold_percent"]):
        blocks.append("%s: coverage %s is below the threshold %s"
                      % (gate, json.dumps(coverage["percent"]), wanted["threshold_percent"]))
    # The full minimum: every control the contract names reports pass in the container.
    _results(gate, doc, "security_controls", contract["mandatory_scenarios"]["security_controls"],
             blocks)
    return blocks


def gate_installed(project, evidence, revision, checkout_head):
    """The installed STG runs the exact revision, and its tests pass, before PROD."""
    gate = "installed-stg"
    contract, blocks = load_contract(project)
    if blocks:
        return blocks
    doc, blocks = read_evidence(evidence)
    if blocks:
        return blocks
    _binding(gate, doc, revision, checkout_head, blocks)
    deployed = doc.get("stg_deployed_revision")
    if deployed != revision:
        blocks.append("%s: STG reports it runs %s, not %s (an unreadable revision blocks too)"
                      % (gate, json.dumps(deployed), revision))
    _common(gate, doc, contract, INSTALLED_KEYS, "installed-stg", blocks)
    # Not every control applies to an installed environment, so only the reported ones are read;
    # at least one must be reported, and each reported one must pass.
    controls = doc.get("security_controls")
    if not isinstance(controls, dict) or not controls:
        blocks.append("%s: security_controls missing or empty (installed security validation)" % gate)
    else:
        _results(gate, doc, "security_controls",
                 contract["mandatory_scenarios"]["security_controls"], blocks, require_all=False)
        for name in sorted(set(controls) - set(contract["mandatory_scenarios"]["security_controls"])):
            blocks.append("%s: security_controls %s is not in the contract" % (gate, name))
    return blocks


# -- authorisation --------------------------------------------------------------------------------

def classify(project, rules):
    """(class, approval, blocks). A change matching a high rule is high; matching none blocks."""
    contract, blocks = load_contract(project)
    if blocks:
        return None, None, blocks
    model = contract["risk_classification"]["rules"]
    picked = [part.strip() for part in (rules or "").split(",") if part.strip()]
    if not picked:
        return None, None, ["classify: no rule matched (an unclassified change blocks before approval)"]
    classes = []
    for part in picked:
        if not re.fullmatch(r"[0-9]+", part) or int(part) >= len(model):
            blocks.append("classify: %s is not a rule index of the contract (0 to %d)"
                          % (json.dumps(part), len(model) - 1))
        else:
            classes.append(model[int(part)]["class"])
    if blocks:
        return None, None, blocks
    # Conservative conflict rule: a change that matches any high rule is high.
    risk = "high" if "high" in classes else "low"
    approval = contract["approval"]["high_risk" if risk == "high" else "low_risk"]
    return risk, approval, []


def gate_environment(name, protection):
    """The environment the owner approves in exists and requires a reviewer before a job runs."""
    gate = "environment"
    doc, blocks = read_evidence(protection)
    if blocks:
        return [b.replace("evidence:", "%s:" % gate, 1) for b in blocks]
    if doc.get("name") != name:
        return ["%s: the protection read is for %s, not %s (a missing environment is created "
                "unprotected when a job names it)" % (gate, json.dumps(doc.get("name")), name)]
    rules = doc.get("protection_rules")
    reviewers = [r for r in rules if isinstance(r, dict) and r.get("type") == "required_reviewers"
                 and r.get("reviewers")] if isinstance(rules, list) else []
    if not reviewers:
        return ["%s: %s has no required reviewer, so nothing waits for the owner's approval"
                % (gate, name)]
    return []


# -- command line ---------------------------------------------------------------------------------

def parse(args, allowed, flags=()):
    values = {}
    for arg in args:
        if arg in flags:
            values[arg[2:]] = True
            continue
        key, sep, value = arg.partition("=")
        if not sep or key not in allowed or not value or key[2:] in values:
            raise Usage("unknown, empty or repeated argument %s" % arg)
        values[key[2:]] = value
    return values


def main(argv):
    command, args = (argv[0], argv[1:]) if argv else ("", [])
    try:
        if command == "contract":
            v = parse(args, {"--project", "--repository"})
            blocks = gate_contract(v.get("project", "."), v.get("repository"))
            passed = ["OK  contract: valid, bound to this repository, MADR accepted"]
        elif command == "container":
            v = parse(args, {"--project", "--evidence", "--revision", "--checkout-head",
                             "--container-image"}, flags=("--require-container",))
            for key in ("evidence", "revision", "checkout-head", "container-image"):
                if key not in v:
                    raise Usage("container needs --%s" % key)
            blocks = gate_container(v.get("project", "."), v["evidence"], v["revision"],
                                    v["checkout-head"], v["container-image"],
                                    v.get("require-container", False))
            passed = ["OK  container: complete green evidence for %s" % v["revision"]]
        elif command == "installed-stg":
            v = parse(args, {"--project", "--evidence", "--revision", "--checkout-head"})
            for key in ("evidence", "revision", "checkout-head"):
                if key not in v:
                    raise Usage("installed-stg needs --%s" % key)
            blocks = gate_installed(v.get("project", "."), v["evidence"], v["revision"],
                                    v["checkout-head"])
            passed = ["OK  installed-stg: STG runs %s and its tests pass" % v["revision"]]
        elif command == "classify":
            # --rules may be empty on purpose: that is the unclassified case, and it blocks.
            rules = [a for a in args if a.startswith("--rules=")]
            v = parse([a for a in args if not a.startswith("--rules=")], {"--project"})
            if len(rules) != 1:
                raise Usage("classify needs exactly one --rules=I[,J...] (it may be empty)")
            risk, approval, blocks = classify(v.get("project", "."), rules[0][len("--rules="):])
            passed = ["class=%s" % risk, "approval=%s" % approval]
        elif command == "environment":
            v = parse(args, {"--name", "--protection"})
            if set(v) != {"name", "protection"}:
                raise Usage("environment needs --name and --protection")
            blocks = gate_environment(v["name"], v["protection"])
            passed = ["OK  environment: %s requires a reviewer" % v["name"]]
        else:
            raise Usage("a gate: contract, container, installed-stg, classify or environment")
    except Usage as exc:
        print("delivery_gate: %s" % exc, file=sys.stderr)
        return 2
    if blocks:
        for line in blocks:
            print("BLOCK  %s" % line, file=sys.stderr)
        return 1
    for line in passed:
        print(line)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
